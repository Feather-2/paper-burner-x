import { describe, it, expect, beforeEach, afterEach } from "vitest";

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

it("Logger: createLogger emits structured events", async () => {
  const { createLogger } = await import("../../../js/agents/stages/deepsearch/runtime/logger.js");

  await withPatchedConsole(async (calls) => {
    const emitted = [];
    const logger = createLogger({
      emit: (name, payload, meta) => emitted.push({ name, payload, meta }),
      getContext: () => ({ runId: "run_1", iteration: 2, stage: "scan" }),
      actor: "deepsearch", // 显式指定 actor
    });

    logger.info("hello", { data: { sourceCount: 3 } });

    expect(emitted.length).toBe(1);
    expect(emitted[0].name).toBe("deepsearch.log.info");
    expect(emitted[0].meta.status).toBe("info");
    expect(emitted[0].payload.level).toBe("info");
    expect(emitted[0].payload.message).toBe("hello");
    expect(emitted[0].payload.runId).toBe("run_1");
    expect(emitted[0].payload.iteration).toBe(2);
    expect(emitted[0].payload.stage).toBe("scan");
    expect(emitted[0].payload.data).toEqual({ sourceCount: 3 });
    expect(emitted[0].payload.timestamp).toBeTypeOf("string");

    expect(calls.log.length).toBe(1);
    expect(calls.log[0][0]).toBe("[deepsearch:scan]");
    expect(calls.log[0][1]).toBe("hello");
  });
});

it("Logger: warn/error choose console method + status", async () => {
  const { createLogger } = await import("../../../js/agents/stages/deepsearch/runtime/logger.js");

  await withPatchedConsole(async (calls) => {
    const emitted = [];
    const logger = createLogger({
      emit: (name, payload, meta) => emitted.push({ name, payload, meta }),
      getContext: () => ({ runId: "run_2", stage: "gaps" }),
      actor: "deepsearch", // 显式指定 actor
    });

    logger.warn("w1");
    logger.error("e1");

    expect(calls.warn.length).toBe(1);
    expect(calls.error.length).toBe(1);

    expect(emitted.length).toBe(2);
    expect(emitted[0].name).toBe("deepsearch.log.warn");
    expect(emitted[0].meta.status).toBe("info");
    expect(emitted[1].name).toBe("deepsearch.log.error");
    expect(emitted[1].meta.status).toBe("failed");
  });
});

it("Logger: data overrides context fields", async () => {
  const { createLogger } = await import("../../../js/agents/stages/deepsearch/runtime/logger.js");

  await withPatchedConsole(async () => {
    const emitted = [];
    const logger = createLogger({
      emit: (name, payload) => emitted.push({ name, payload }),
      getContext: () => ({ stage: "ctx_stage", runId: "run_ctx" }),
    });

    logger.info("override", { stage: "scan" });

    expect(emitted[0].payload.stage).toBe("scan");
    expect(emitted[0].payload.runId).toBe("run_ctx");
  });
});

it("Logger: enabled=false suppresses emit + console", async () => {
  const { createLogger } = await import("../../../js/agents/stages/deepsearch/runtime/logger.js");

  await withPatchedConsole(async (calls) => {
    const emitted = [];
    const logger = createLogger({ emit: (name, payload) => emitted.push({ name, payload }), enabled: false });
    logger.info("nope");
    expect(emitted.length).toBe(0);
    expect(calls.log.length).toBe(0);
    expect(calls.warn.length).toBe(0);
    expect(calls.error.length).toBe(0);
  });
});

it("Logger: multiple instances concurrent do not conflict", async () => {
  const { createLogger } = await import("../../../js/agents/stages/deepsearch/runtime/logger.js");

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

    expect(aEvents.length).toBe(20);
    expect(bEvents.length).toBe(20);

    for (const e of aEvents) {
      expect(e.payload.runId).toBe("run_A");
      expect(e.payload.stage).toBe("scan");
      expect(e.payload.iteration).toBeTypeOf("number");
      expect(e.payload.iteration).toBeGreaterThanOrEqual(0);
      expect(e.payload.iteration).toBeLessThan(20);
    }

    for (const e of bEvents) {
      expect(e.payload.runId).toBe("run_B");
      expect(e.payload.stage).toBe("gaps");
      expect(e.payload.iteration).toBeTypeOf("number");
      expect(e.payload.iteration).toBeGreaterThanOrEqual(100);
      expect(e.payload.iteration).toBeLessThan(120);
    }
  });
});

it("Logger: trackToolCall success + failure", async () => {
  const { createLogger, trackToolCall } = await import("../../../js/agents/stages/deepsearch/runtime/logger.js");

  await withPatchedConsole(async () => {
    const emitted = [];
    const logger = createLogger({ emit: (name, payload) => emitted.push({ name, payload }) });

    const ok = await trackToolCall(logger, "grep", { pattern: "x" }, async () => ["a", "b"]);
    expect(ok).toEqual(["a", "b"]);

    await expect(
      trackToolCall(logger, "glob", { pattern: "*.js" }, async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow(/boom/);

    const toolEvents = emitted.filter((e) => e.payload.stage === "tool");
    expect(toolEvents.length).toBeGreaterThanOrEqual(4);
    expect(toolEvents[0].payload.message).toBe("Tool call: grep");
    expect(toolEvents[1].payload.message).toBe("Tool completed: grep");
    expect(toolEvents[2].payload.message).toBe("Tool call: glob");
    expect(toolEvents[3].payload.message).toBe("Tool failed: glob");
  });
});

it("Logger: deprecated logEvent exists", async () => {
  const { logEvent } = await import("../../../js/agents/stages/deepsearch/runtime/logger.js");

  await withPatchedConsole(async (calls) => {
    logEvent({ message: "legacy" });
    expect(calls.log.length).toBe(1);
    // logEvent 现在使用通用 [Agent] 前缀
    expect(calls.log[0][0]).toBe("[Agent]");
  });
});
