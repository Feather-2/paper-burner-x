const test = require("node:test");
const assert = require("node:assert/strict");

require("fake-indexeddb/auto");

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function waitFor(predicate, { timeoutMs = 1000 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return;
    await tick();
  }
  throw new Error("waitFor: timeout");
}

async function deleteDb(dbName) {
  await new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

test("EventBus persistence: no adapter keeps behavior unchanged", async () => {
  const { EventBus } = await import("../../js/agents/core/event-bus.js");

  const bus = new EventBus({ runId: "run_no_adapter" });

  const seen = [];
  bus.on("*", (e) => seen.push(e));

  const evt = bus.emit("run.started", { actor: "system", status: "started", payload: { ok: true } });
  assert.equal(evt.runId, "run_no_adapter");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].eventId, evt.eventId);
});

test("EventBus persistence: emit() calls adapter.appendEvents asynchronously", async () => {
  const { EventBus } = await import("../../js/agents/core/event-bus.js");

  const calls = [];
  const adapter = {
    appendEvents(events) {
      calls.push(events);
    },
    async getEvents() {
      return [];
    },
  };

  const bus = new EventBus({ runId: "run_persist", persistenceAdapter: adapter });

  const evt = bus.emit("run.progress", { pct: 50 });
  assert.equal(calls.length, 0);

  await tick();
  assert.equal(calls.length, 1);
  assert.equal(Array.isArray(calls[0]), true);
  assert.equal(calls[0].length, 1);

  const persisted = calls[0][0];
  assert.equal(persisted.runId, "run_persist");
  assert.equal(persisted.eventId, evt.eventId);
  assert.equal(persisted.name, "run.progress");
  assert.deepEqual(persisted.payload, { pct: 50 });
});

test("EventBus replay(runId): calls getEvents, marks meta.replay, does not re-persist, seq unchanged", async () => {
  const { EventBus } = await import("../../js/agents/core/event-bus.js");

  const persistedBatches = [];
  let getEventsRunId = null;

  const adapter = {
    appendEvents(events) {
      persistedBatches.push(events);
    },
    async getEvents(runId) {
      getEventsRunId = runId;
      return [
        {
          schemaVersion: "0.1",
          runId,
          eventId: "evt_run_replay_1",
          ts: "2025-12-12T22:30:01.000Z",
          name: "run.progress",
          actor: "system",
          status: "progress",
          payload: { pct: 10 },
          meta: { fromStore: true },
        },
      ];
    },
  };

  const bus = new EventBus({ runId: "run_replay", persistenceAdapter: adapter });

  const evt1 = bus.emit("run.progress", { pct: 1 });
  assert.match(evt1.eventId, /_1$/);

  await tick();
  assert.equal(persistedBatches.length, 1);

  const seen = [];
  bus.on("run.progress", (e) => seen.push(e));

  const persistedCountBeforeReplay = persistedBatches.length;
  const replayed = await bus.replay("run_replay");

  assert.equal(getEventsRunId, "run_replay");
  assert.equal(replayed.length, 1);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].meta.replay, true);
  assert.equal(seen[0].meta.fromStore, true);

  await tick();
  assert.equal(persistedBatches.length, persistedCountBeforeReplay);

  const evt2 = bus.emit("run.progress", { pct: 2 });
  assert.match(evt2.eventId, /_2$/);
});

test("EventBus replay(runId): syncs Lamport clock to replayed seq for cross-stage ordering", async () => {
  const { EventBus } = await import("../../js/agents/core/event-bus.js");

  const remoteSeq = 1_000_000_000;
  const adapter = {
    appendEvents() {},
    async getEvents(runId) {
      return [
        {
          schemaVersion: "0.1",
          runId,
          eventId: "evt_run_lamport_1",
          ts: "2025-12-12T22:30:01.000Z",
          name: "run.progress",
          actor: "system",
          status: "progress",
          payload: { pct: 10 },
          seq: remoteSeq, // legacy persisted field (no _clock)
        },
      ];
    },
  };

  const bus = new EventBus({ runId: "run_lamport", persistenceAdapter: adapter });
  await bus.replay("run_lamport");

  const evt = bus.emit("run.progress", { pct: 20 });
  assert.ok(evt.seq > remoteSeq);
  assert.ok(evt._clock && evt._clock.seq > remoteSeq);
});

test("EventBus replay(runId): missing runId throws clear error", async () => {
  const { EventBus } = await import("../../js/agents/core/event-bus.js");

  const adapter = {
    appendEvents() {},
    async getEvents() {
      return null;
    },
  };

  const bus = new EventBus({ runId: "run_x", persistenceAdapter: adapter });
  await assert.rejects(() => bus.replay("run_missing"), /no events found.*runId=run_missing/i);
});

test("EventBus persistenceAdapter validation: missing methods throws", async () => {
  const { EventBus } = await import("../../js/agents/core/event-bus.js");

  assert.throws(() => new EventBus({ persistenceAdapter: {} }), /persistenceAdapter\.appendEvents/i);
  assert.throws(() => new EventBus({ persistenceAdapter: { appendEvents() {} } }), /persistenceAdapter\.getEvents/i);
  assert.throws(() => new EventBus({ persistenceAdapter: 123 }), /persistenceAdapter must be an object/i);
});

test("RunStoreAdapter integrates with RunStore (IndexedDB via fake-indexeddb)", async () => {
  const { EventBus, RunStoreAdapter, createEventId, createEventRecord } = await import("../../js/agents/core/event-bus.js");
  const { RunStore } = await import("../../js/agents/storage/run-store.js");

  // Small extra coverage for helpers.
  assert.equal(createEventId(null, 1), "evt_run_unknown_1");
  assert.throws(() => createEventRecord({ name: "Bad.Name" }), /Invalid event name/i);

  const dbName = `EventBusRunStoreAdapter_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  await deleteDb(dbName);

  const runId = "run_store";
  const runStore = new RunStore({ dbName });
  const adapter = new RunStoreAdapter(runStore);

  const bus = new EventBus({ runId, persistenceAdapter: adapter });
  bus.emit("run.started", { actor: "system", status: "started", payload: { a: 1 } });
  bus.emit("run.progress", { pct: 42 });

  await waitFor(async () => (await runStore.getEvents(runId)).length === 2);

  const storedBeforeReplay = await runStore.getEvents(runId);
  assert.equal(storedBeforeReplay.length, 2);
  assert.equal(storedBeforeReplay[0].runId, runId);
  assert.ok(storedBeforeReplay[0].eventId);

  const replayBus = new EventBus({ runId: "run_store_replay", persistenceAdapter: adapter });
  const replayedSeen = [];
  replayBus.on("*", (e) => replayedSeen.push(e));
  await replayBus.replay(runId);
  assert.equal(replayedSeen.length, 2);
  assert.ok(replayedSeen.every((e) => e.meta && e.meta.replay === true));

  const storedAfterReplay = await runStore.getEvents(runId);
  assert.equal(storedAfterReplay.length, 2);

  await runStore.close();
  await deleteDb(dbName);
});

test("EventBus.on(): validates handler type and event name", async () => {
  const { EventBus } = await import("../../js/agents/core/event-bus.js");
  const bus = new EventBus({ runId: "run_on_validate" });

  assert.throws(() => bus.on("run.started", 123), /handler must be a function/i);
  assert.throws(() => bus.on("Run.Started", () => {}), /Invalid event name/i);
});

test("EventBus.once()/off(): basic lifecycle", async () => {
  const { EventBus } = await import("../../js/agents/core/event-bus.js");
  const bus = new EventBus({ runId: "run_once_off" });

  let onceHits = 0;
  bus.once("run.started", () => {
    onceHits++;
  });
  bus.emit("run.started", { actor: "system", status: "started" });
  bus.emit("run.started", { actor: "system", status: "started" });
  assert.equal(onceHits, 1);

  let offHits = 0;
  const fn = () => {
    offHits++;
  };
  bus.on("run.ended", fn);
  bus.off("run.ended", fn);
  bus.emit("run.ended", { actor: "system", status: "ended" });
  assert.equal(offHits, 0);

  // Empty backpressure queue flush branch.
  bus.enableBackpressure({ batchWindowMs: 0 });
  bus.disableBackpressure();
});

test("EventBus backpressure: coalesces *.progress and keeps non-progress events", async () => {
  const { EventBus } = await import("../../js/agents/core/event-bus.js");
  const bus = new EventBus({ runId: "run_bp" });

  const seen = [];
  bus.on("*", (e) => seen.push(e));

  // Use a global regex to cover RegExp.lastIndex reset logic.
  bus.enableBackpressure({ batchWindowMs: 0, coalescePattern: /\.progress$/g });

  bus.emit("textprep.chunk.started", { actor: "system", status: "started" });
  for (let i = 1; i <= 5; i++) bus.emit("textprep.chunk.progress", { pct: i });
  bus.emit("textprep.chunk.ended", { actor: "system", status: "ended" });

  assert.equal(seen.length, 0);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(seen.length, 3);
  assert.equal(seen[0].name, "textprep.chunk.started");
  assert.equal(seen[1].name, "textprep.chunk.progress");
  assert.deepEqual(seen[1].payload, { pct: 5 });
  assert.equal(seen[2].name, "textprep.chunk.ended");
});

test("EventBus backpressure: disableBackpressure flushes queue and restores synchronous emit", async () => {
  const { EventBus } = await import("../../js/agents/core/event-bus.js");
  const bus = new EventBus({ runId: "run_bp_disable" });

  let hits = 0;
  bus.on("run.started", () => hits++);

  bus.enableBackpressure({ batchWindowMs: 10_000 });
  bus.emit("run.started", { actor: "system", status: "started" });
  assert.equal(hits, 0);

  bus.disableBackpressure();
  assert.equal(hits, 1);

  bus.emit("run.started", { actor: "system", status: "started" });
  assert.equal(hits, 2);
});

test("EventBus backpressure: option validation and re-enable flushes pending queue", async () => {
  const { EventBus } = await import("../../js/agents/core/event-bus.js");
  const bus = new EventBus({ runId: "run_bp_opts" });

  assert.throws(() => bus.enableBackpressure("nope"), /options must be an object/i);
  assert.throws(() => bus.enableBackpressure({ batchWindowMs: -1 }), /batchWindowMs/i);
  assert.throws(() => bus.enableBackpressure({ coalescePattern: "nope" }), /coalescePattern/i);

  const seen = [];
  bus.on("run.started", (e) => seen.push(e));

  bus.enableBackpressure({ batchWindowMs: 10_000 });
  bus.emit("run.started", { actor: "system", status: "started" });
  assert.equal(seen.length, 0);

  // Calling enableBackpressure again flushes any pending queue.
  bus.enableBackpressure({ batchWindowMs: 0 });
  assert.equal(seen.length, 1);
});

test("EventBus backpressure: requestAnimationFrame scheduling and cancellation", async () => {
  const { EventBus } = await import("../../js/agents/core/event-bus.js");

  const prevRaf = globalThis.requestAnimationFrame;
  const prevCancel = globalThis.cancelAnimationFrame;

  let rafCb = null;
  let rafId = 0;
  const cancelled = [];

  globalThis.requestAnimationFrame = (cb) => {
    rafCb = cb;
    rafId += 1;
    return rafId;
  };
  globalThis.cancelAnimationFrame = (id) => cancelled.push(id);

  try {
    const bus = new EventBus({ runId: "run_bp_raf" });
    let hits = 0;
    bus.on("run.progress", () => hits++);

    bus.enableBackpressure({ batchWindowMs: 0 });
    bus.emit("run.progress", { pct: 1 });

    assert.equal(typeof rafCb, "function");
    assert.equal(hits, 0);

    // Disable should cancel and flush immediately.
    bus.disableBackpressure();
    assert.deepEqual(cancelled, [1]);
    assert.equal(hits, 1);

    // Late rAF callback should be a no-op.
    rafCb();
    assert.equal(hits, 1);
  } finally {
    globalThis.requestAnimationFrame = prevRaf;
    globalThis.cancelAnimationFrame = prevCancel;
  }
});

test("EventBus persistence: adapter errors are best-effort (no unhandled rejection)", async () => {
  const { EventBus } = await import("../../js/agents/core/event-bus.js");

  {
    const bus = new EventBus({
      runId: "run_persist_throw",
      persistenceAdapter: {
        appendEvents() {
          throw new Error("boom");
        },
        async getEvents() {
          return [];
        },
      },
    });
    bus.emit("run.started", { actor: "system", status: "started" });
    await tick();
  }

  {
    const bus = new EventBus({
      runId: "run_persist_reject",
      persistenceAdapter: {
        appendEvents() {
          return Promise.reject(new Error("boom"));
        },
        async getEvents() {
          return [];
        },
      },
    });
    bus.emit("run.started", { actor: "system", status: "started" });
    await tick();
  }
});

test("EventBus.replay(runId): argument and adapter return validation", async () => {
  const { EventBus } = await import("../../js/agents/core/event-bus.js");

  const busNoAdapter = new EventBus({ runId: "run_no_adapter_2" });
  await assert.rejects(() => busNoAdapter.replay("run_no_adapter_2"), /persistenceAdapter is required/i);

  const busBadRunId = new EventBus({
    runId: "run_bad_runid",
    persistenceAdapter: { appendEvents() {}, async getEvents() { return []; } },
  });
  await assert.rejects(() => busBadRunId.replay(null), /runId must be a string/i);

  const busNonArray = new EventBus({
    runId: "run_nonarray",
    persistenceAdapter: { appendEvents() {}, async getEvents() { return "nope"; } },
  });
  await assert.rejects(() => busNonArray.replay("run_nonarray"), /must return an array/i);

  const busThrows = new EventBus({
    runId: "run_throws",
    persistenceAdapter: { appendEvents() {}, async getEvents() { throw new Error("db down"); } },
  });
  await assert.rejects(() => busThrows.replay("run_throws"), /failed to load events.*db down/i);
});

test("RunStoreAdapter: supports appendEvent-only runStore and validates inputs", async () => {
  const { RunStoreAdapter } = await import("../../js/agents/core/event-bus.js");

  const appended = [];
  const runStore = {
    async appendEvent(runId, evt) {
      appended.push({ runId, evt });
      return evt.eventId;
    },
    async getEvents(runId) {
      return appended.filter((x) => x.runId === runId).map((x) => x.evt);
    },
  };

  const adapter = new RunStoreAdapter(runStore);

  assert.throws(() => new RunStoreAdapter({ appendEvents() {} }), /getEvents/i);
  assert.throws(() => new RunStoreAdapter({ getEvents() {} }), /appendEvents\/appendEvent/i);
  await assert.rejects(() => adapter.appendEvents("nope"), /events must be an array/i);
  await assert.rejects(() => adapter.appendEvents([{ eventId: "evt_x" }]), /must include a string runId/i);

  const count = await adapter.appendEvents([
    { runId: "run_a", eventId: "evt_a_1", name: "run.started" },
    { runId: "run_a", eventId: "evt_a_2", name: "run.progress" },
  ]);
  assert.equal(count, 2);
  assert.equal(appended.length, 2);
});

test("isValidEventName allows underscores in segments", async () => {
  const { isValidEventName } = await import("../../js/agents/core/event-bus.js");

  // 带下划线的事件名应该有效
  assert.equal(isValidEventName("deepsearch.write.react.parse_retry"), true);
  assert.equal(isValidEventName("design.refine.finish_accepted"), true);
  assert.equal(isValidEventName("a_b.c_d.e_f"), true);

  // 原有规则仍然有效
  assert.equal(isValidEventName("run.started"), true);
  assert.equal(isValidEventName("single"), true);

  // 无效情况
  assert.equal(isValidEventName(""), false);
  assert.equal(isValidEventName(".start"), false);
  assert.equal(isValidEventName("end."), false);
  assert.equal(isValidEventName("A.B"), false); // 大写不允许
});
