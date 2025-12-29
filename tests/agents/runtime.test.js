const test = require("node:test");
const assert = require("node:assert/strict");

// 以下测试引用了已删除的 run-context.js，已移除

test("Runtime Constants: report enums + quality mode normalization", async () => {
  const {
    ReportTone,
    ReportAudience,
    ReportLanguage,
    ReportLength,
    QualityMode,
    normalizeReportTone,
    normalizeReportAudience,
    normalizeReportLanguage,
    normalizeReportLength,
    normalizeQualityMode,
  } = await import("../../js/agents/runtime/core/constants.js");

  assert.equal(normalizeReportTone("Business"), ReportTone.BUSINESS);
  assert.equal(normalizeReportTone("ACADEMIC"), ReportTone.ACADEMIC);
  assert.equal(normalizeReportTone("neutral"), undefined);

  assert.equal(normalizeReportAudience("EXECUTIVE"), ReportAudience.EXECUTIVE);
  assert.equal(normalizeReportAudience("expert"), ReportAudience.EXPERT);
  assert.equal(normalizeReportAudience("student"), undefined);

  assert.equal(normalizeReportLanguage("zh"), ReportLanguage.ZH);
  assert.equal(normalizeReportLanguage("AUTO"), ReportLanguage.AUTO);
  assert.equal(normalizeReportLanguage("fr"), undefined);

  assert.equal(normalizeReportLength("detailed"), ReportLength.DETAILED);
  assert.equal(normalizeReportLength("COMPREHENSIVE"), ReportLength.COMPREHENSIVE);
  assert.equal(normalizeReportLength("long"), undefined);

  assert.equal(normalizeQualityMode("HIGH"), QualityMode.HIGH);
  assert.equal(normalizeQualityMode("standard"), QualityMode.STANDARD);
  assert.equal(normalizeQualityMode("extreme"), undefined);
});

test("Runtime Core: EventBus on/off/once/emit + EventRecord fields", async () => {
  const { EventBus, isValidEventName } = await import("../../js/agents/runtime/events/event-bus.js");

  assert.ok(isValidEventName("run.started"));
  assert.ok(isValidEventName("textprep.chunk.completed"));
  assert.equal(isValidEventName("Run.Started"), false);
  assert.equal(isValidEventName("bad..name"), false);  // 连续点号不合法
  assert.ok(isValidEventName("bad_name"));  // 下划线现在合法

  const bus = new EventBus({ runId: "run_2025-12-12_22-30-01_a3f9f" });

  const seen = [];
  const offAny = bus.on("*", (e) => seen.push(e));

  let onceCount = 0;
  bus.once("run.started", () => {
    onceCount++;
  });

  const evt1 = bus.emit("run.started", { actor: "system", status: "started", payload: { mode: "textprep" } });
  const evt2 = bus.emit("run.started", { actor: "system", status: "started", payload: { mode: "textprep" } });

  assert.equal(onceCount, 1);
  assert.equal(evt1.schemaVersion, "0.1");
  assert.equal(evt1.runId, bus.runId);
  assert.equal(evt1.name, "run.started");
  assert.equal(evt1.actor, "system");
  assert.equal(evt1.status, "started");
  assert.deepEqual(evt1.payload, { mode: "textprep" });
  assert.ok(typeof evt1.eventId === "string" && evt1.eventId.startsWith("evt_"));
  assert.ok(typeof evt1.ts === "string" && evt1.ts.includes("T"));

  offAny();
  bus.emit("run.ended", { actor: "system", status: "ended" });
  assert.equal(seen.filter((e) => e.name === "run.ended").length, 0);

  // off(name, fn)
  let hits = 0;
  const fn = () => {
    hits++;
  };
  bus.on("run.ended", fn);
  bus.off("run.ended", fn);
  bus.emit("run.ended", { actor: "system", status: "ended" });
  assert.equal(hits, 0);

  // emit(name, payloadObject) convenience
  const evt3 = bus.emit("run.progress", { pct: 50 });
  assert.deepEqual(evt3.payload, { pct: 50 });
});

test("Runtime Core: EventBus backpressure default stays synchronous", async () => {
  const { EventBus } = await import("../../js/agents/runtime/events/event-bus.js");

  const bus = new EventBus({ runId: "run_test" });
  let hits = 0;
  bus.on("run.log", () => {
    hits++;
  });

  bus.emit("run.log", { msg: "a" });
  assert.equal(hits, 1);
});

test("Runtime Core: EventBus backpressure batching + coalesce + order + seq", async () => {
  const { EventBus } = await import("../../js/agents/runtime/events/event-bus.js");

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const seqOf = (evt) => Number(String(evt.eventId).split("_").at(-1));

  const bus = new EventBus({ runId: "run_test" });
  bus.enableBackpressure({ batchWindowMs: 25 });

  const events = [];
  bus.on("*", (e) => events.push(e));

  bus.emit("run.progress", { i: 1 });
  bus.emit("run.log", { msg: "a" });
  bus.emit("run.progress", { i: 2 });
  bus.emit("run.log", { msg: "b" });
  bus.emit("run.progress", { i: 3 });
  bus.emit("run.progress", { i: 4 });
  bus.emit("run.progress", { i: 5 });

  assert.equal(events.length, 0);

  await sleep(60);

  assert.deepEqual(
    events.map((e) => e.name),
    ["run.log", "run.log", "run.progress"]
  );

  const progress = events.filter((e) => e.name === "run.progress");
  assert.equal(progress.length, 1);
  assert.deepEqual(progress[0].payload, { i: 5 });

  const logs = events.filter((e) => e.name === "run.log");
  assert.equal(logs.length, 2);
  assert.deepEqual(logs.map((e) => e.payload), [{ msg: "a" }, { msg: "b" }]);

  const seqs = events.map(seqOf);
  assert.ok(seqs[0] < seqs[1] && seqs[1] < seqs[2]);

  bus.emit("run.log", { msg: "c" });
  await sleep(60);
  assert.equal(events.filter((e) => e.payload?.msg === "c").length, 1);
  assert.ok(seqOf(events.at(-1)) > seqs.at(-1));
});

test("Runtime Core: EventBus backpressure custom coalescePattern + disable restores sync", async () => {
  const { EventBus } = await import("../../js/agents/runtime/events/event-bus.js");

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const bus = new EventBus({ runId: "run_test" });
  bus.enableBackpressure({ batchWindowMs: 20, coalescePattern: /\.log$/ });

  const progress = [];
  const logs = [];
  bus.on("run.progress", (e) => progress.push(e));
  bus.on("run.log", (e) => logs.push(e));

  bus.emit("run.progress", { i: 1 });
  bus.emit("run.progress", { i: 2 });
  bus.emit("run.progress", { i: 3 });

  bus.emit("run.log", { msg: "a" });
  bus.emit("run.log", { msg: "b" });
  bus.emit("run.log", { msg: "c" });

  await sleep(50);

  assert.equal(progress.length, 3);
  assert.deepEqual(progress.map((e) => e.payload), [{ i: 1 }, { i: 2 }, { i: 3 }]);

  assert.equal(logs.length, 1);
  assert.deepEqual(logs[0].payload, { msg: "c" });

  bus.disableBackpressure();

  let sync = false;
  bus.on("run.log", () => {
    sync = true;
  });
  bus.emit("run.log", { msg: "sync" });
  assert.equal(sync, true);
});

test("Runtime Core: EventBus backpressure batchWindowMs controls flush timing", async () => {
  const { EventBus } = await import("../../js/agents/runtime/events/event-bus.js");

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const bus = new EventBus({ runId: "run_test" });
  bus.enableBackpressure({ batchWindowMs: 40 });

  let hits = 0;
  bus.on("run.log", () => {
    hits++;
  });

  bus.emit("run.log", { msg: "delayed" });
  await sleep(10);
  assert.equal(hits, 0);

  await sleep(60);
  assert.equal(hits, 1);
});

test("Runtime Core: EventBus backpressure rAF scheduling branch", async () => {
  const { EventBus } = await import("../../js/agents/runtime/events/event-bus.js");

  const originalRaf = globalThis.requestAnimationFrame;
  const originalCancel = globalThis.cancelAnimationFrame;

  try {
    globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 25);
    globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

    const bus = new EventBus({ runId: "run_test" });
    bus.enableBackpressure();

    let hits = 0;
    bus.on("run.log", () => {
      hits++;
    });

    bus.emit("run.log", { msg: "x" });
    bus.disableBackpressure();
    assert.equal(hits, 1);

    // Exercise the empty-queue flush path.
    bus.enableBackpressure();
    bus.disableBackpressure();
  } finally {
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancel;
  }
});

test("Runtime Core: EventBus validation errors", async () => {
  const { EventBus, createEventRecord } = await import("../../js/agents/runtime/events/event-bus.js");

  assert.throws(() => createEventRecord({ name: "Bad.Name" }), /Invalid event name/);

  const bus = new EventBus({ runId: "run_test" });
  assert.throws(() => bus.on("run.log", "nope"), /handler must be a function/);
  assert.throws(() => bus.on("Bad.Name", () => {}), /Invalid event name/);

  assert.throws(() => bus.enableBackpressure(123), /options must be an object/);
  assert.throws(() => bus.enableBackpressure({ batchWindowMs: -1 }), /batchWindowMs/);
  assert.throws(() => bus.enableBackpressure({ coalescePattern: "x" }), /coalescePattern/);
});

test("Runtime Core: EventBus backpressure re-enable flushes queued and cancels timer", async () => {
  const { EventBus } = await import("../../js/agents/runtime/events/event-bus.js");

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const bus = new EventBus({ runId: "run_test" });
  const seen = [];
  bus.on("run.log", (e) => seen.push(e));

  bus.enableBackpressure({ batchWindowMs: 100 });
  bus.emit("run.log", { msg: "queued" });

  // Re-enabling should cancel the pending timer and flush queued events immediately.
  bus.enableBackpressure({ batchWindowMs: 1, coalescePattern: /\.progress$/g });
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].payload, { msg: "queued" });

  // Also exercise global-regexp coalescing behavior.
  const progress = [];
  bus.on("run.progress", (e) => progress.push(e));
  bus.emit("run.progress", { i: 1 });
  bus.emit("run.progress", { i: 2 });
  await sleep(20);
  assert.equal(progress.length, 1);
  assert.deepEqual(progress[0].payload, { i: 2 });
});

test("Runtime Core: EventBus persistence adapter best-effort appendEvents", async () => {
  const { EventBus } = await import("../../js/agents/runtime/events/event-bus.js");

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Promise-returning appendEvents should be caught (no unhandled rejection).
  {
    let calls = 0;
    const appended = [];
    const bus = new EventBus({
      runId: "run_test",
      persistenceAdapter: {
        appendEvents: (events) => {
          calls++;
          appended.push(...events);
          return Promise.reject(new Error("nope"));
        },
        getEvents: async () => [],
      },
    });

    bus.emit("run.log", { msg: "a" });
    await sleep(0);

    assert.equal(calls, 1);
    assert.equal(appended.length, 1);
    assert.equal(appended[0].name, "run.log");
  }

  // Throwing appendEvents should be swallowed.
  {
    const bus = new EventBus({
      runId: "run_test",
      persistenceAdapter: {
        appendEvents: () => {
          throw new Error("boom");
        },
        getEvents: async () => [],
      },
    });

    bus.emit("run.log", { msg: "b" });
    await sleep(0);
  }
});

test("Runtime Core: EventBus replay loads events and marks meta.replay", async () => {
  const { EventBus } = await import("../../js/agents/runtime/events/event-bus.js");

  // No adapter -> clear error.
  await assert.rejects(() => new EventBus().replay("run_test"), /persistenceAdapter is required/);

  // Bad runId.
  await assert.rejects(
    () =>
      new EventBus({
        persistenceAdapter: { appendEvents: async () => {}, getEvents: async () => [] },
      }).replay(123),
    /runId must be a string/
  );

  // getEvents throws -> wrapped error.
  await assert.rejects(
    () =>
      new EventBus({
        persistenceAdapter: {
          appendEvents: async () => {},
          getEvents: async () => {
            throw new Error("boom");
          },
        },
      }).replay("run_test"),
    /failed to load events/
  );

  // Successful replay.
  const replayed = [];
  let appendCalls = 0;
  const bus = new EventBus({
    persistenceAdapter: {
      appendEvents: async () => {
        appendCalls++;
      },
      getEvents: async () => [
        "skip-me",
        { name: "run.started", actor: "system", payload: { x: 1 }, meta: { foo: "bar" }, eventId: "evt_run_test_1", ts: new Date().toISOString(), runId: "run_test" },
      ],
    },
  });
  bus.on("*", (e) => replayed.push(e));

  const out = await bus.replay("run_test");
  assert.equal(out.length, 1);
  assert.equal(out[0].meta.replay, true);
  assert.equal(out[0].meta.foo, "bar");
  assert.equal(replayed.length, 1);

  // replay should not persist events.
  assert.equal(appendCalls, 0);
});

test("Runtime Core: RunStoreAdapter validation + appendEvents branches", async () => {
  const { RunStoreAdapter } = await import("../../js/agents/runtime/events/event-bus.js");

  assert.throws(() => new RunStoreAdapter(null), /runStore.getEvents must be a function/);
  assert.throws(() => new RunStoreAdapter({ getEvents: async () => [] }), /appendEvents\/appendEvent/);

  // appendEvents path
  {
    const calls = [];
    const runStore = {
      getEvents: async (runId) => [{ runId, name: "run.log" }],
      appendEvents: async (runId, events) => {
        calls.push({ runId, events });
      },
    };
    const adapter = new RunStoreAdapter(runStore);

    await assert.rejects(() => adapter.appendEvents("nope"), /events must be an array/);
    assert.equal(await adapter.appendEvents([]), 0);

    const n = await adapter.appendEvents([
      { runId: "run_a", name: "run.log" },
      { runId: "run_a", name: "run.log" },
    ]);
    assert.equal(n, 2);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].runId, "run_a");
    assert.equal(calls[0].events.length, 2);

    const got = await adapter.getEvents("run_a");
    assert.equal(got[0].runId, "run_a");
  }

  // appendEvent (per-event) path + missing runId error
  {
    const calls = [];
    const runStore = {
      getEvents: async () => [],
      appendEvent: async (runId, evt) => {
        calls.push({ runId, evt });
      },
    };
    const adapter = new RunStoreAdapter(runStore);

    await assert.rejects(() => adapter.appendEvents([{ name: "run.log" }]), /must include a string runId/);

    const n = await adapter.appendEvents([
      { runId: "run_b", name: "run.log", payload: { i: 1 } },
      { runId: "run_b", name: "run.log", payload: { i: 2 } },
    ]);
    assert.equal(n, 2);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].runId, "run_b");
    assert.equal(calls[1].evt.payload.i, 2);
  }
});

// 以下测试引用了已删除的 run-context.js 和 orchestrator.js，已移除

test("Runtime Core: EventBus subscribe with wildcard pattern", async () => {
  const { EventBus } = await import("../../js/agents/runtime/events/event-bus.js");

  const bus = new EventBus({ runId: "run_test" });
  const deepSearchEvents = [];
  const designEvents = [];

	  bus.subscribe("deepsearch.*", (e) => deepSearchEvents.push(e));
	  bus.subscribe("design.*", (e) => designEvents.push(e));

	  bus.emit("deepsearch.scan.started", { status: "started" });
	  bus.emit("deepsearch.gaps.completed", { status: "completed" });
	  bus.emit("design.started", { status: "started" });
	  bus.emit("run.started", { status: "started" });

  assert.equal(deepSearchEvents.length, 2);
  assert.equal(designEvents.length, 1);
  assert.ok(deepSearchEvents.every((e) => e.name.startsWith("deepsearch.")));
});

test("Runtime Core: EventBus subscribe returns unsubscribe function", async () => {
  const { EventBus } = await import("../../js/agents/runtime/events/event-bus.js");

  const bus = new EventBus({ runId: "run_test" });
  const events = [];

  const unsubscribe = bus.subscribe("deepsearch.*", (e) => events.push(e));

  bus.emit("deepsearch.scan.started", {});
  assert.equal(events.length, 1);

  unsubscribe();

  bus.emit("deepsearch.scan.completed", {});
  assert.equal(events.length, 1); // no new events after unsubscribe
});

test("Runtime Core: EventBus subscribe with priority executes in order", async () => {
  const { EventBus } = await import("../../js/agents/runtime/events/event-bus.js");

  const bus = new EventBus({ runId: "run_test" });
  const execution = [];

  // 注册不同优先级的 handlers
  bus.subscribe("test.event", () => execution.push("low"), { priority: -10 });
  bus.subscribe("test.event", () => execution.push("normal"));  // priority 0
  bus.subscribe("test.event", () => execution.push("high"), { priority: 10 });
  bus.subscribe("test.event", () => execution.push("critical"), { priority: 100 });

  bus.emit("test.event", {});

  // 高优先级先执行
  assert.deepEqual(execution, ["critical", "high", "normal", "low"]);
});

test("Runtime Core: EventBus subscribe with priority + wildcard", async () => {
  const { EventBus } = await import("../../js/agents/runtime/events/event-bus.js");

  const bus = new EventBus({ runId: "run_test" });
  const execution = [];

  // 通配符 + 优先级
  bus.subscribe("test.*", () => execution.push("wildcard-high"), { priority: 50 });
  bus.subscribe("test.*", () => execution.push("wildcard-normal"));
  bus.subscribe("test.event", () => execution.push("exact-low"), { priority: -5 });
  bus.subscribe("test.event", () => execution.push("exact-high"), { priority: 25 });

  bus.emit("test.event", {});

  assert.deepEqual(execution, ["wildcard-high", "exact-high", "wildcard-normal", "exact-low"]);
});

test("Runtime Core: EventBus subscribe priority unsubscribe cleanup", async () => {
  const { EventBus } = await import("../../js/agents/runtime/events/event-bus.js");

  const bus = new EventBus({ runId: "run_test" });
  const execution = [];

  const unsub1 = bus.subscribe("test.event", () => execution.push("a"), { priority: 10 });
  const unsub2 = bus.subscribe("test.*", () => execution.push("b"), { priority: 20 });

  bus.emit("test.event", {});
  assert.deepEqual(execution, ["b", "a"]);

  unsub1();
  unsub2();

  execution.length = 0;
  bus.emit("test.event", {});
  assert.deepEqual(execution, []);  // all unsubscribed
});

test("Runtime Core: EventBus subscribe priority validation", async () => {
  const { EventBus } = await import("../../js/agents/runtime/events/event-bus.js");

  const bus = new EventBus({ runId: "run_test" });

  assert.throws(() => bus.subscribe("test.event", () => {}, { priority: "high" }), /priority must be a finite number/);
  assert.throws(() => bus.subscribe("test.event", () => {}, { priority: Infinity }), /priority must be a finite number/);
});

test("Runtime Core: EventBus listener errors are isolated (sync + async)", async () => {
  const { EventBus } = await import("../../js/agents/runtime/events/event-bus.js");

  const errors = [];
  const bus = new EventBus({
    runId: "run_listener_errors",
    onListenerError(err, evt) {
      errors.push({ message: String(err?.message || err), name: evt?.name });
    },
  });

  const order = [];
  bus.on("run.log", () => {
    order.push("a");
    throw new Error("boom_sync");
  });
  bus.on("run.log", async () => {
    order.push("b");
    throw new Error("boom_async");
  });
  bus.on("run.log", () => {
    order.push("c");
  });

  assert.doesNotThrow(() => bus.emit("run.log", { msg: "x" }));
  assert.deepEqual(order, ["a", "b", "c"]);

  await new Promise((r) => setTimeout(r, 0));
  assert.equal(errors.length, 2);
  assert.ok(errors.some((e) => e.message.includes("boom_sync") && e.name === "run.log"));
  assert.ok(errors.some((e) => e.message.includes("boom_async") && e.name === "run.log"));
});

test("Runtime Telemetry: subscribeTelemetry keeps bounded in-memory timeline", async () => {
  const { EventBus } = await import("../../js/agents/runtime/events/event-bus.js");
  const { subscribeTelemetry } = await import("../../js/agents/runtime/telemetry/runstore-telemetry.js");

  const bus = new EventBus({ runId: "run_telemetry" });
  const stored = [];
  const runStore = {
    async appendEvent(runId, evt) {
      stored.push({ runId, evt });
    },
  };

  const sub = subscribeTelemetry(bus, runStore, { maxTimelineEntries: 3 });
  for (let i = 0; i < 5; i++) bus.emit("run.progress", { i });
  await sub.flush();

  assert.equal(stored.length, 5);
  assert.equal(sub.timeline.length, 3);
  assert.deepEqual(
    sub.timeline.map((r) => r.payload?.i),
    [2, 3, 4]
  );
  assert.equal(sub.snapshot().timeline.length, 3);
  sub.unsubscribe();
});
