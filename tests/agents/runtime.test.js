const test = require("node:test");
const assert = require("node:assert/strict");

test("Runtime Core: runId format & uniqueness", async () => {
  const { RunContext, generateRunId } = await import("../../js/agents/runtime/run-context.js");

  const now = new Date("2025-12-12T22:30:01.000Z");
  let i = 0;
  const ids = new Set();
  for (; i < 100; i++) {
    const id = generateRunId(now, () => (i + 1) / 1000);
    assert.match(id, /^run_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_[a-f0-9]{5}$/);
    ids.add(id);
  }
  assert.equal(ids.size, 100);

  const ctx1 = new RunContext({ mode: "textprep" });
  const ctx2 = new RunContext({ mode: "textprep" });
  assert.notEqual(ctx1.runId, ctx2.runId);
});

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
  } = await import("../../js/agents/runtime/constants.js");

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
  const { EventBus, isValidEventName } = await import("../../js/agents/runtime/event-bus.js");

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
  const { EventBus } = await import("../../js/agents/runtime/event-bus.js");

  const bus = new EventBus({ runId: "run_test" });
  let hits = 0;
  bus.on("run.log", () => {
    hits++;
  });

  bus.emit("run.log", { msg: "a" });
  assert.equal(hits, 1);
});

test("Runtime Core: EventBus backpressure batching + coalesce + order + seq", async () => {
  const { EventBus } = await import("../../js/agents/runtime/event-bus.js");

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
  const { EventBus } = await import("../../js/agents/runtime/event-bus.js");

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
  const { EventBus } = await import("../../js/agents/runtime/event-bus.js");

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
  const { EventBus } = await import("../../js/agents/runtime/event-bus.js");

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
  const { EventBus, createEventRecord } = await import("../../js/agents/runtime/event-bus.js");

  assert.throws(() => createEventRecord({ name: "Bad.Name" }), /Invalid event name/);

  const bus = new EventBus({ runId: "run_test" });
  assert.throws(() => bus.on("run.log", "nope"), /handler must be a function/);
  assert.throws(() => bus.on("Bad.Name", () => {}), /Invalid event name/);

  assert.throws(() => bus.enableBackpressure(123), /options must be an object/);
  assert.throws(() => bus.enableBackpressure({ batchWindowMs: -1 }), /batchWindowMs/);
  assert.throws(() => bus.enableBackpressure({ coalescePattern: "x" }), /coalescePattern/);
});

test("Runtime Core: EventBus backpressure re-enable flushes queued and cancels timer", async () => {
  const { EventBus } = await import("../../js/agents/runtime/event-bus.js");

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
  const { EventBus } = await import("../../js/agents/runtime/event-bus.js");

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
  const { EventBus } = await import("../../js/agents/runtime/event-bus.js");

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
  const { RunStoreAdapter } = await import("../../js/agents/runtime/event-bus.js");

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

test("Runtime Core: RunContext constraints parsing + serialization", async () => {
  const { RunContext, parseConstraints } = await import("../../js/agents/runtime/run-context.js");

  assert.deepEqual(parseConstraints(null), {});
  assert.deepEqual(parseConstraints({}), {});

  const c = parseConstraints({
    audience: "技术团队",
    tone: "Academic",
    pageCount: "12",
    citationsPolicy: "footnotes",
    qualityMode: "high",
    ignored: "x",
  });
  assert.deepEqual(c, {
    audience: "技术团队",
    tone: "Academic",
    pageCount: 12,
    citationsPolicy: "footnotes",
    qualityMode: "high",
  });

  const ctx = new RunContext({ mode: "deepsearch", scenario: "business", constraints: c, runId: "run_test" });
  const json = ctx.toJSON();
  assert.equal(json.schemaVersion, "0.1");
  assert.equal(json.runId, "run_test");
  assert.equal(json.mode, "deepsearch");
  assert.equal(json.scenario, "business");
  assert.deepEqual(json.constraints, c);
  assert.ok(typeof json.startedAt === "string" && json.startedAt.includes("T"));
});

test("Runtime Core: Orchestrator run lifecycle + stage events", async () => {
  const { AgentOrchestrator } = await import("../../js/agents/runtime/orchestrator.js");

  const orch = new AgentOrchestrator({ mode: "textprep", scenario: "test" });
  const events = [];
  orch.eventBus.on("*", (e) => events.push(e));

  orch.registerStage(
    "textprep.chunk",
    async (_ctx, input, api) => {
      assert.deepEqual(input, { inputChars: 123 });
      api.progress({ step: 1 });
      api.progress({ step: 2 });
      return { chunks: 3 };
    },
    { actor: "textprep", timeoutMs: 1000 }
  );

  const out = await orch.run(async (o) => o.runStage("textprep.chunk", { inputChars: 123 }));
  assert.deepEqual(out, { chunks: 3 });

  assert.ok(events.some((e) => e.name === "run.started"));
  assert.ok(events.some((e) => e.name === "textprep.chunk.started" && e.status === "started"));
  assert.ok(events.some((e) => e.name === "textprep.chunk.progress" && e.status === "progress"));
  assert.ok(events.some((e) => e.name === "textprep.chunk.completed" && e.status === "completed"));
  assert.ok(events.some((e) => e.name === "run.completed"));
});

test("Runtime Core: Orchestrator error handling emits failed", async () => {
  const { AgentOrchestrator } = await import("../../js/agents/runtime/orchestrator.js");

  const orch = new AgentOrchestrator({ mode: "textprep" });
  const events = [];
  orch.eventBus.on("*", (e) => events.push(e));

  orch.registerStage("design.batch", async () => {
    throw new Error("boom");
  }, { actor: "design" });

  await assert.rejects(() => orch.run(async (o) => o.runStage("design.batch")), /boom/);

  assert.ok(events.some((e) => e.name === "design.batch.failed" && e.status === "failed"));
  assert.ok(events.some((e) => e.name === "run.failed" && e.status === "failed"));
});

test("Runtime Core: Orchestrator timeout + stop cancellation", async () => {
  const { AgentOrchestrator } = await import("../../js/agents/runtime/orchestrator.js");
  const { StageTimeoutError, StageCancelledError } = AgentOrchestrator;

  // Timeout
  {
    const orch = new AgentOrchestrator({ mode: "textprep" });
    const events = [];
    orch.eventBus.on("*", (e) => events.push(e));

    orch.registerStage("deepsearch.scan", async () => new Promise(() => {}), { actor: "deepsearch", timeoutMs: 20 });

    await assert.rejects(() => orch.run(async (o) => o.runStage("deepsearch.scan")), (err) => {
      assert.ok(err instanceof StageTimeoutError);
      assert.equal(err.stageName, "deepsearch.scan");
      return true;
    });

    assert.ok(events.some((e) => e.name === "deepsearch.scan.failed"));
    assert.ok(events.some((e) => e.name === "run.failed"));
  }

  // Stop/cancel
  {
    const orch = new AgentOrchestrator({ mode: "textprep" });
    const events = [];
    orch.eventBus.on("*", (e) => events.push(e));

    orch.registerStage(
      "textprep.normalize",
      async (_ctx, _input, api) =>
        new Promise((resolve, reject) => {
          if (api.signal?.aborted) return reject(new Error("aborted-too-early"));
          api.signal?.addEventListener("abort", () => reject(new StageCancelledError("cancelled", { stageName: "textprep.normalize" })), { once: true });
        }),
      { actor: "textprep", timeoutMs: 10_000 }
    );

    const p = orch.run(async (o) => o.runStage("textprep.normalize"));
    orch.stop("user_cancel");

    await assert.rejects(() => p, (err) => {
      assert.ok(err instanceof StageCancelledError);
      return true;
    });

    assert.ok(events.some((e) => e.name === "run.cancelled" && e.status === "cancelled"));
  }
});

test("Runtime Core: topologicalSort basic ordering", async () => {
  const { topologicalSort } = await import("../../js/agents/runtime/orchestrator.js");

  // Simple chain: A -> B -> C
  const stages = new Map([
    ["a", { fn: () => {}, dependsOn: [] }],
    ["b", { fn: () => {}, dependsOn: ["a"] }],
    ["c", { fn: () => {}, dependsOn: ["b"] }],
  ]);

  const { sorted, layers } = topologicalSort(stages);
  assert.deepEqual(sorted, ["a", "b", "c"]);
  assert.deepEqual(layers, [["a"], ["b"], ["c"]]);
});

test("Runtime Core: topologicalSort parallel layers", async () => {
  const { topologicalSort } = await import("../../js/agents/runtime/orchestrator.js");

  // Diamond: A -> B, A -> C, B -> D, C -> D
  const stages = new Map([
    ["a", { fn: () => {}, dependsOn: [] }],
    ["b", { fn: () => {}, dependsOn: ["a"] }],
    ["c", { fn: () => {}, dependsOn: ["a"] }],
    ["d", { fn: () => {}, dependsOn: ["b", "c"] }],
  ]);

  const { sorted, layers } = topologicalSort(stages);
  assert.equal(sorted[0], "a");
  assert.equal(sorted[3], "d");
  assert.ok(sorted.includes("b") && sorted.includes("c"));

  assert.deepEqual(layers[0], ["a"]);
  assert.ok(layers[1].includes("b") && layers[1].includes("c"));
  assert.deepEqual(layers[2], ["d"]);
});

test("Runtime Core: topologicalSort circular dependency detection", async () => {
  const { topologicalSort } = await import("../../js/agents/runtime/orchestrator.js");

  const stages = new Map([
    ["a", { fn: () => {}, dependsOn: ["c"] }],
    ["b", { fn: () => {}, dependsOn: ["a"] }],
    ["c", { fn: () => {}, dependsOn: ["b"] }],
  ]);

  assert.throws(() => topologicalSort(stages), /Circular dependency/);
});

test("Runtime Core: topologicalSort unknown dependency detection", async () => {
  const { topologicalSort } = await import("../../js/agents/runtime/orchestrator.js");

  const stages = new Map([
    ["a", { fn: () => {}, dependsOn: ["unknown"] }],
  ]);

  assert.throws(() => topologicalSort(stages), /depends on unknown stage/);
});

test("Runtime Core: Orchestrator registerStage with dependsOn validation", async () => {
  const { AgentOrchestrator } = await import("../../js/agents/runtime/orchestrator.js");

  const orch = new AgentOrchestrator({ mode: "test" });

  // Valid dependsOn
  orch.registerStage("a", () => {}, { dependsOn: [] });
  orch.registerStage("b", () => {}, { dependsOn: ["a"] });

  // Invalid dependsOn (not array)
  assert.throws(() => orch.registerStage("c", () => {}, { dependsOn: "a" }), /dependsOn must be an array/);

  // Invalid condition (not function)
  assert.throws(() => orch.registerStage("d", () => {}, { condition: "true" }), /condition must be a function/);
});

test("Runtime Core: Orchestrator getExecutionPlan returns correct layers", async () => {
  const { AgentOrchestrator } = await import("../../js/agents/runtime/orchestrator.js");

  const orch = new AgentOrchestrator({ mode: "test" });
  orch.registerStage("scan", () => {}, { dependsOn: [] });
  orch.registerStage("gaps", () => {}, { dependsOn: ["scan"] });
  orch.registerStage("retrieve", () => {}, { dependsOn: ["gaps"] });
  orch.registerStage("understand", () => {}, { dependsOn: ["retrieve"] });
  orch.registerStage("write", () => {}, { dependsOn: ["understand"] });

  const { sorted, layers } = orch.getExecutionPlan();
  assert.deepEqual(sorted, ["scan", "gaps", "retrieve", "understand", "write"]);
  assert.equal(layers.length, 5);
});

test("Runtime Core: Orchestrator runDAG executes stages in order", async () => {
  const { AgentOrchestrator } = await import("../../js/agents/runtime/orchestrator.js");

  const orch = new AgentOrchestrator({ mode: "test" });
  const execution = [];

  orch.registerStage("a", async () => {
    execution.push("a");
    return { fromA: true };
  }, { dependsOn: [] });

  orch.registerStage("b", async (_ctx, input) => {
    execution.push("b");
    assert.deepEqual(input, { fromA: true });
    return { fromB: true };
  }, { dependsOn: ["a"] });

  orch.registerStage("c", async (_ctx, input) => {
    execution.push("c");
    assert.deepEqual(input, { fromB: true });
    return { fromC: true };
  }, { dependsOn: ["b"] });

  const results = await orch.runDAG();

  assert.deepEqual(execution, ["a", "b", "c"]);
  assert.deepEqual(results.get("a"), { fromA: true });
  assert.deepEqual(results.get("b"), { fromB: true });
  assert.deepEqual(results.get("c"), { fromC: true });
});

test("Runtime Core: Orchestrator runDAG parallel execution", async () => {
  const { AgentOrchestrator } = await import("../../js/agents/runtime/orchestrator.js");

  const orch = new AgentOrchestrator({ mode: "test" });
  const startTimes = {};
  const endTimes = {};

  orch.registerStage("a", async () => {
    startTimes.a = Date.now();
    await new Promise((r) => setTimeout(r, 50));
    endTimes.a = Date.now();
    return "a";
  }, { dependsOn: [] });

  orch.registerStage("b", async () => {
    startTimes.b = Date.now();
    await new Promise((r) => setTimeout(r, 50));
    endTimes.b = Date.now();
    return "b";
  }, { dependsOn: ["a"] });

  orch.registerStage("c", async () => {
    startTimes.c = Date.now();
    await new Promise((r) => setTimeout(r, 50));
    endTimes.c = Date.now();
    return "c";
  }, { dependsOn: ["a"] });

  orch.registerStage("d", async (_ctx, input) => {
    startTimes.d = Date.now();
    return input;
  }, { dependsOn: ["b", "c"] });

  const results = await orch.runDAG({ parallel: true });

  // b and c should start at roughly the same time (parallel)
  const diff = Math.abs(startTimes.b - startTimes.c);
  assert.ok(diff < 30, `b and c should start in parallel, diff=${diff}ms`);

  // d should get merged input from b and c
  assert.deepEqual(results.get("d"), { b: "b", c: "c" });
});

test("Runtime Core: Orchestrator runDAG with condition", async () => {
  const { AgentOrchestrator } = await import("../../js/agents/runtime/orchestrator.js");

  const orch = new AgentOrchestrator({ mode: "test" });
  const events = [];
  orch.eventBus.on("*", (e) => events.push(e));
  const execution = [];

  orch.registerStage("a", async () => {
    execution.push("a");
    return { skip: true };
  }, { dependsOn: [] });

  orch.registerStage("b", async () => {
    execution.push("b");
    return "b";
  }, {
    dependsOn: ["a"],
    condition: (_ctx, results) => !results.get("a").skip,
  });

  orch.registerStage("c", async () => {
    execution.push("c");
    return "c";
  }, {
    dependsOn: ["a"],
    condition: (_ctx, results) => results.get("a").skip,
  });

  await orch.runDAG();

  assert.deepEqual(execution, ["a", "c"]);
  assert.ok(events.some((e) => e.name === "b.skipped"));
});

test("Runtime Core: Orchestrator runDAG with initialInput", async () => {
  const { AgentOrchestrator } = await import("../../js/agents/runtime/orchestrator.js");

  const orch = new AgentOrchestrator({ mode: "test" });

  orch.registerStage("root", async (_ctx, input) => {
    return { received: input };
  }, { dependsOn: [] });

  const results = await orch.runDAG({ initialInput: { foo: "bar" } });
  assert.deepEqual(results.get("root"), { received: { foo: "bar" } });
});

test("Runtime Core: Orchestrator runDAG onStageResult callback", async () => {
  const { AgentOrchestrator } = await import("../../js/agents/runtime/orchestrator.js");

  const orch = new AgentOrchestrator({ mode: "test" });
  const callbacks = [];

  orch.registerStage("x", async () => "resultX", { dependsOn: [] });
  orch.registerStage("y", async () => "resultY", { dependsOn: ["x"] });

  await orch.runDAG({
    onStageResult: (name, result) => callbacks.push({ name, result }),
  });

  assert.deepEqual(callbacks, [
    { name: "x", result: "resultX" },
    { name: "y", result: "resultY" },
  ]);
});

test("Runtime Core: EventBus subscribe with wildcard pattern", async () => {
  const { EventBus } = await import("../../js/agents/runtime/event-bus.js");

  const bus = new EventBus({ runId: "run_test" });
  const deepSearchEvents = [];
  const designEvents = [];

  bus.subscribe("deepsearch.*", (e) => deepSearchEvents.push(e));
  bus.subscribe("design.*", (e) => designEvents.push(e));

  bus.emit("deepsearch.scan.started", { status: "started" });
  bus.emit("deepsearch.gaps.completed", { status: "completed" });
  bus.emit("design.brainstorm.started", { status: "started" });
  bus.emit("run.started", { status: "started" });

  assert.equal(deepSearchEvents.length, 2);
  assert.equal(designEvents.length, 1);
  assert.ok(deepSearchEvents.every((e) => e.name.startsWith("deepsearch.")));
});

test("Runtime Core: EventBus subscribe returns unsubscribe function", async () => {
  const { EventBus } = await import("../../js/agents/runtime/event-bus.js");

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
  const { EventBus } = await import("../../js/agents/runtime/event-bus.js");

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
  const { EventBus } = await import("../../js/agents/runtime/event-bus.js");

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
  const { EventBus } = await import("../../js/agents/runtime/event-bus.js");

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
  const { EventBus } = await import("../../js/agents/runtime/event-bus.js");

  const bus = new EventBus({ runId: "run_test" });

  assert.throws(() => bus.subscribe("test.event", () => {}, { priority: "high" }), /priority must be a finite number/);
  assert.throws(() => bus.subscribe("test.event", () => {}, { priority: Infinity }), /priority must be a finite number/);
});
