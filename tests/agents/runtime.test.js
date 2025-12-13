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

test("Runtime Core: EventBus on/off/once/emit + EventRecord fields", async () => {
  const { EventBus, isValidEventName } = await import("../../js/agents/runtime/event-bus.js");

  assert.ok(isValidEventName("run.started"));
  assert.ok(isValidEventName("textprep.chunk.completed"));
  assert.equal(isValidEventName("Run.Started"), false);
  assert.equal(isValidEventName("bad__name"), false);

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
  assert.ok(events.some((e) => e.name === "textprep.chunk.ended" && e.status === "ended"));
  assert.ok(events.some((e) => e.name === "run.ended"));
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
