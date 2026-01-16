import { describe, it, expect, beforeEach, afterEach } from "vitest";

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

it("EventBus persistence: no adapter keeps behavior unchanged", async () => {
  const { EventBus } = await import("../../js/agents/core/event-bus.js");

  const bus = new EventBus({ runId: "run_no_adapter" });

  const seen = [];
  bus.on("*", (e) => seen.push(e));

  const evt = bus.emit("run.started", { actor: "system", status: "started", payload: { ok: true } });
  expect(evt.runId).toBe("run_no_adapter");
  expect(seen.length).toBe(1);
  expect(seen[0].eventId).toBe(evt.eventId);
});

it("EventBus persistence: emit() calls adapter.appendEvents asynchronously", async () => {
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
  expect(calls.length).toBe(0);

  await tick();
  expect(calls.length).toBe(1);
  expect(Array.isArray(calls[0])).toBe(true);
  expect(calls[0].length).toBe(1);

  const persisted = calls[0][0];
  expect(persisted.runId).toBe("run_persist");
  expect(persisted.eventId).toBe(evt.eventId);
  expect(persisted.name).toBe("run.progress");
  expect(persisted.payload).toEqual({ pct: 50 });
});

it("EventBus replay(runId): calls getEvents, marks meta.replay, does not re-persist, seq unchanged", async () => {
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
  expect(evt1.eventId).toMatch(/_1$/);

  await tick();
  expect(persistedBatches.length).toBe(1);

  const seen = [];
  bus.on("run.progress", (e) => seen.push(e));

  const persistedCountBeforeReplay = persistedBatches.length;
  const replayed = await bus.replay("run_replay");

  expect(getEventsRunId).toBe("run_replay");
  expect(replayed.length).toBe(1);
  expect(seen.length).toBe(1);
  expect(seen[0].meta.replay).toBe(true);
  expect(seen[0].meta.fromStore).toBe(true);

  await tick();
  expect(persistedBatches.length).toBe(persistedCountBeforeReplay);

  const evt2 = bus.emit("run.progress", { pct: 2 });
  expect(evt2.eventId).toMatch(/_2$/);
});

it("EventBus replay(runId): syncs Lamport clock to replayed seq for cross-stage ordering", async () => {
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
  expect(evt.seq > remoteSeq).toBeTruthy();
  expect(evt._clock && evt._clock.seq > remoteSeq).toBeTruthy();
});

it("EventBus replay(runId): missing runId throws clear error", async () => {
  const { EventBus } = await import("../../js/agents/core/event-bus.js");

  const adapter = {
    appendEvents() {},
    async getEvents() {
      return null;
    },
  };

  const bus = new EventBus({ runId: "run_x", persistenceAdapter: adapter });
  await expect(() => bus.replay("run_missing")).rejects.toThrow(/no events found.*runId=run_missing/i);
});

it("EventBus persistenceAdapter validation: missing methods throws", async () => {
  const { EventBus } = await import("../../js/agents/core/event-bus.js");

  expect(() => new EventBus({ persistenceAdapter: {} })).toThrow(/persistenceAdapter\.appendEvents/i);
  expect(() => new EventBus({ persistenceAdapter: { appendEvents() {} } })).toThrow(/persistenceAdapter\.getEvents/i);
  expect(() => new EventBus({ persistenceAdapter: 123 })).toThrow(/persistenceAdapter must be an object/i);
});

it("RunStoreAdapter integrates with RunStore (IndexedDB via fake-indexeddb)", async () => {
  const { EventBus, RunStoreAdapter, createEventId, createEventRecord } = await import("../../js/agents/core/event-bus.js");
  const { RunStore } = await import("../../js/agents/storage/run-store.js");

  // Small extra coverage for helpers.
  expect(createEventId(null, 1)).toBe("evt_run_1");
  expect(() => createEventRecord({ name: "Bad.Name" })).toThrow(/Invalid event name/i);

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
  expect(storedBeforeReplay.length).toBe(2);
  expect(storedBeforeReplay[0].runId).toBe(runId);
  expect(storedBeforeReplay[0].eventId).toBeTruthy();

  const replayBus = new EventBus({ runId: "run_store_replay", persistenceAdapter: adapter });
  const replayedSeen = [];
  replayBus.on("*", (e) => replayedSeen.push(e));
  await replayBus.replay(runId);
  expect(replayedSeen.length).toBe(2);
  expect(replayedSeen.every(e => e.meta && e.meta.replay === true)).toBeTruthy();

  const storedAfterReplay = await runStore.getEvents(runId);
  expect(storedAfterReplay.length).toBe(2);

  await runStore.close();
  await deleteDb(dbName);
});

it("EventBus.on(): validates handler type and event name", async () => {
  const { EventBus } = await import("../../js/agents/core/event-bus.js");
  const bus = new EventBus({ runId: "run_on_validate" });

  expect(() => bus.on("run.started", 123)).toThrow(/handler must be a function/i);
  expect(() => bus.on("Run.Started", () => {})).toThrow(/Invalid event name/i);
});

it("EventBus.once()/off(): basic lifecycle", async () => {
  const { EventBus } = await import("../../js/agents/core/event-bus.js");
  const bus = new EventBus({ runId: "run_once_off" });

  let onceHits = 0;
  bus.once("run.started", () => {
    onceHits++;
  });
  bus.emit("run.started", { actor: "system", status: "started" });
  bus.emit("run.started", { actor: "system", status: "started" });
  expect(onceHits).toBe(1);

  let offHits = 0;
  const fn = () => {
    offHits++;
  };
  bus.on("run.ended", fn);
  bus.off("run.ended", fn);
  bus.emit("run.ended", { actor: "system", status: "ended" });
  expect(offHits).toBe(0);

  // Empty backpressure queue flush branch.
  bus.enableBackpressure({ batchWindowMs: 0 });
  bus.disableBackpressure();
});

it("EventBus backpressure: coalesces *.progress and keeps non-progress events", async () => {
  const { EventBus } = await import("../../js/agents/core/event-bus.js");
  const bus = new EventBus({ runId: "run_bp" });

  const seen = [];
  bus.on("*", (e) => seen.push(e));

  // Use a global regex to cover RegExp.lastIndex reset logic.
  bus.enableBackpressure({ batchWindowMs: 0, coalescePattern: /\.progress$/g });

  bus.emit("textprep.chunk.started", { actor: "system", status: "started" });
  for (let i = 1; i <= 5; i++) bus.emit("textprep.chunk.progress", { pct: i });
  bus.emit("textprep.chunk.ended", { actor: "system", status: "ended" });

  expect(seen.length).toBe(0);
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(seen.length).toBe(3);
  expect(seen[0].name).toBe("textprep.chunk.started");
  expect(seen[1].name).toBe("textprep.chunk.progress");
  expect(seen[1].payload).toEqual({ pct: 5 });
  expect(seen[2].name).toBe("textprep.chunk.ended");
});

it("EventBus backpressure: disableBackpressure flushes queue and restores synchronous emit", async () => {
  const { EventBus } = await import("../../js/agents/core/event-bus.js");
  const bus = new EventBus({ runId: "run_bp_disable" });

  let hits = 0;
  bus.on("run.started", () => hits++);

  bus.enableBackpressure({ batchWindowMs: 10_000 });
  bus.emit("run.started", { actor: "system", status: "started" });
  expect(hits).toBe(0);

  bus.disableBackpressure();
  expect(hits).toBe(1);

  bus.emit("run.started", { actor: "system", status: "started" });
  expect(hits).toBe(2);
});

it("EventBus backpressure: option validation and re-enable flushes pending queue", async () => {
  const { EventBus } = await import("../../js/agents/core/event-bus.js");
  const bus = new EventBus({ runId: "run_bp_opts" });

  expect(() => bus.enableBackpressure("nope")).toThrow(/options must be an object/i);
  expect(() => bus.enableBackpressure({ batchWindowMs: -1 })).toThrow(/batchWindowMs/i);
  expect(() => bus.enableBackpressure({ coalescePattern: "nope" })).toThrow(/coalescePattern/i);

  const seen = [];
  bus.on("run.started", (e) => seen.push(e));

  bus.enableBackpressure({ batchWindowMs: 10_000 });
  bus.emit("run.started", { actor: "system", status: "started" });
  expect(seen.length).toBe(0);

  // Calling enableBackpressure again flushes any pending queue.
  bus.enableBackpressure({ batchWindowMs: 0 });
  expect(seen.length).toBe(1);
});

it("EventBus backpressure: requestAnimationFrame scheduling and cancellation", async () => {
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

    expect(typeof rafCb).toBe("function");
    expect(hits).toBe(0);

    // Disable should cancel and flush immediately.
    bus.disableBackpressure();
    expect(cancelled).toEqual([1]);
    expect(hits).toBe(1);

    // Late rAF callback should be a no-op.
    rafCb();
    expect(hits).toBe(1);
  } finally {
    globalThis.requestAnimationFrame = prevRaf;
    globalThis.cancelAnimationFrame = prevCancel;
  }
});

it("EventBus persistence: adapter errors are best-effort (no unhandled rejection)", async () => {
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

it("EventBus.replay(runId): argument and adapter return validation", async () => {
  const { EventBus } = await import("../../js/agents/core/event-bus.js");

  const busNoAdapter = new EventBus({ runId: "run_no_adapter_2" });
  await expect(() => busNoAdapter.replay("run_no_adapter_2")).rejects.toThrow(/persistenceAdapter is required/i);

  const busBadRunId = new EventBus({
    runId: "run_bad_runid",
    persistenceAdapter: { appendEvents() {}, async getEvents() { return []; } },
  });
  await expect(() => busBadRunId.replay(null)).rejects.toThrow(/runId must be a string/i);

  const busNonArray = new EventBus({
    runId: "run_nonarray",
    persistenceAdapter: { appendEvents() {}, async getEvents() { return "nope"; } },
  });
  await expect(() => busNonArray.replay("run_nonarray")).rejects.toThrow(/must return an array/i);

  const busThrows = new EventBus({
    runId: "run_throws",
    persistenceAdapter: { appendEvents() {}, async getEvents() { throw new Error("db down"); } },
  });
  await expect(() => busThrows.replay("run_throws")).rejects.toThrow(/failed to load events.*db down/i);
});

it("RunStoreAdapter: supports appendEvent-only runStore and validates inputs", async () => {
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

  expect(() => new RunStoreAdapter({ appendEvents() {} })).toThrow(/getEvents/i);
  expect(() => new RunStoreAdapter({ getEvents() {} })).toThrow(/appendEvents\/appendEvent/i);
  await expect(() => adapter.appendEvents("nope")).rejects.toThrow(/events must be an array/i);
  await expect(() => adapter.appendEvents([{ eventId: "evt_x" }])).rejects.toThrow(/must include a string runId/i);

  const count = await adapter.appendEvents([
    { runId: "run_a", eventId: "evt_a_1", name: "run.started" },
    { runId: "run_a", eventId: "evt_a_2", name: "run.progress" },
  ]);
  expect(count).toBe(2);
  expect(appended.length).toBe(2);
});

it("isValidEventName allows underscores in segments", async () => {
  const { isValidEventName } = await import("../../js/agents/core/event-bus.js");

  // 带下划线的事件名应该有效
  expect(isValidEventName("deepsearch.write.react.parse_retry")).toBe(true);
  expect(isValidEventName("design.refine.finish_accepted")).toBe(true);
  expect(isValidEventName("a_b.c_d.e_f")).toBe(true);

  // 原有规则仍然有效
  expect(isValidEventName("run.started")).toBe(true);
  expect(isValidEventName("single")).toBe(true);

  // 无效情况
  expect(isValidEventName("")).toBe(false);
  expect(isValidEventName(".start")).toBe(false);
  expect(isValidEventName("end.")).toBe(false);
  expect(isValidEventName("A.B")).toBe(false); // 大写不允许
});
