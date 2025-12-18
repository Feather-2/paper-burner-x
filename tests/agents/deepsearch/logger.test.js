const test = require("node:test");
const assert = require("node:assert/strict");

function defer() {
  return new Promise((resolve) => setImmediate(resolve));
}

function withPatchedConsole(fn) {
  const calls = { log: [], warn: [], error: [] };
  const original = { log: console.log, warn: console.warn, error: console.error };
  console.log = (...args) => calls.log.push(args);
  console.warn = (...args) => calls.warn.push(args);
  console.error = (...args) => calls.error.push(args);
  const restore = () => {
    console.log = original.log;
    console.warn = original.warn;
    console.error = original.error;
  };
  return Promise.resolve()
    .then(() => fn(calls))
    .finally(restore);
}

test("Logger: createLogger emits structured events", async () => {
  const { createLogger } = await import("../../../js/agents/stages/deepsearch/logger.js");

  await withPatchedConsole(async (calls) => {
    const emitted = [];
    const logger = createLogger({
      emit: (name, payload, meta) => emitted.push({ name, payload, meta }),
      getContext: () => ({ runId: "run_1", iteration: 2, stage: "scan" }),
    });

    logger.info("hello", { data: { sourceCount: 3 } });

    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].name, "deepsearch.log.info");
    assert.equal(emitted[0].meta.status, "info");
    assert.equal(emitted[0].payload.level, "info");
    assert.equal(emitted[0].payload.message, "hello");
    assert.equal(emitted[0].payload.runId, "run_1");
    assert.equal(emitted[0].payload.iteration, 2);
    assert.equal(emitted[0].payload.stage, "scan");
    assert.deepEqual(emitted[0].payload.data, { sourceCount: 3 });
    assert.ok(typeof emitted[0].payload.timestamp === "string");

    assert.equal(calls.log.length, 1);
    assert.equal(calls.log[0][0], "[DeepSearch:scan]");
    assert.equal(calls.log[0][1], "hello");
  });
});

test("Logger: warn/error choose console method + status", async () => {
  const { createLogger } = await import("../../../js/agents/stages/deepsearch/logger.js");

  await withPatchedConsole(async (calls) => {
    const emitted = [];
    const logger = createLogger({
      emit: (name, payload, meta) => emitted.push({ name, payload, meta }),
      getContext: () => ({ runId: "run_2", stage: "gaps" }),
    });

    logger.warn("w1");
    logger.error("e1");

    assert.equal(calls.warn.length, 1);
    assert.equal(calls.error.length, 1);

    assert.equal(emitted.length, 2);
    assert.equal(emitted[0].name, "deepsearch.log.warn");
    assert.equal(emitted[0].meta.status, "info");
    assert.equal(emitted[1].name, "deepsearch.log.error");
    assert.equal(emitted[1].meta.status, "failed");
  });
});

test("Logger: data overrides context fields", async () => {
  const { createLogger } = await import("../../../js/agents/stages/deepsearch/logger.js");

  await withPatchedConsole(async () => {
    const emitted = [];
    const logger = createLogger({
      emit: (name, payload) => emitted.push({ name, payload }),
      getContext: () => ({ stage: "ctx_stage", runId: "run_ctx" }),
    });

    logger.info("override", { stage: "scan" });

    assert.equal(emitted[0].payload.stage, "scan");
    assert.equal(emitted[0].payload.runId, "run_ctx");
  });
});

test("Logger: enabled=false suppresses emit + console", async () => {
  const { createLogger } = await import("../../../js/agents/stages/deepsearch/logger.js");

  await withPatchedConsole(async (calls) => {
    const emitted = [];
    const logger = createLogger({ emit: (name, payload) => emitted.push({ name, payload }), enabled: false });
    logger.info("nope");
    assert.equal(emitted.length, 0);
    assert.equal(calls.log.length, 0);
    assert.equal(calls.warn.length, 0);
    assert.equal(calls.error.length, 0);
  });
});

test("Logger: multiple instances concurrent do not conflict", async () => {
  const { createLogger } = await import("../../../js/agents/stages/deepsearch/logger.js");

  await withPatchedConsole(async () => {
    const emitted = [];
    const emit = (name, payload) => emitted.push({ name, payload });

    const stateA = { runId: "run_A", iteration: 0, stage: "scan" };
    const stateB = { runId: "run_B", iteration: 100, stage: "gaps" };

    const loggerA = createLogger({ emit, getContext: () => ({ runId: stateA.runId, iteration: stateA.iteration, stage: stateA.stage }) });
    const loggerB = createLogger({ emit, getContext: () => ({ runId: stateB.runId, iteration: stateB.iteration, stage: stateB.stage }) });

    await Promise.all([
      (async () => {
        for (let i = 0; i < 20; i++) {
          stateA.iteration = i;
          loggerA.info("A", { seq: i });
          await defer();
        }
      })(),
      (async () => {
        for (let i = 0; i < 20; i++) {
          stateB.iteration = 100 + i;
          loggerB.info("B", { seq: i });
          await defer();
        }
      })(),
    ]);

    const aEvents = emitted.filter((e) => e.payload.message === "A");
    const bEvents = emitted.filter((e) => e.payload.message === "B");

    assert.equal(aEvents.length, 20);
    assert.equal(bEvents.length, 20);

    for (const e of aEvents) {
      assert.equal(e.payload.runId, "run_A");
      assert.equal(e.payload.stage, "scan");
      assert.ok(typeof e.payload.iteration === "number" && e.payload.iteration >= 0 && e.payload.iteration < 20);
    }

    for (const e of bEvents) {
      assert.equal(e.payload.runId, "run_B");
      assert.equal(e.payload.stage, "gaps");
      assert.ok(typeof e.payload.iteration === "number" && e.payload.iteration >= 100 && e.payload.iteration < 120);
    }
  });
});

test("Logger: trackToolCall success + failure", async () => {
  const { createLogger, trackToolCall } = await import("../../../js/agents/stages/deepsearch/logger.js");

  await withPatchedConsole(async () => {
    const emitted = [];
    const logger = createLogger({ emit: (name, payload) => emitted.push({ name, payload }) });

    const ok = await trackToolCall(logger, "grep", { pattern: "x" }, async () => ["a", "b"]);
    assert.deepEqual(ok, ["a", "b"]);

    await assert.rejects(
      () =>
        trackToolCall(logger, "glob", { pattern: "*.js" }, async () => {
          throw new Error("boom");
        }),
      /boom/
    );

    const toolEvents = emitted.filter((e) => e.payload.stage === "tool");
    assert.ok(toolEvents.length >= 4);
    assert.equal(toolEvents[0].payload.message, "Tool call: grep");
    assert.equal(toolEvents[1].payload.message, "Tool completed: grep");
    assert.equal(toolEvents[2].payload.message, "Tool call: glob");
    assert.equal(toolEvents[3].payload.message, "Tool failed: glob");
  });
});

test("Logger: deprecated logEvent exists", async () => {
  const { logEvent } = await import("../../../js/agents/stages/deepsearch/logger.js");

  await withPatchedConsole(async (calls) => {
    logEvent({ message: "legacy" });
    assert.equal(calls.log.length, 1);
    assert.equal(calls.log[0][0], "[DeepSearch]");
  });
});
