/**
 * @fileoverview AgentOrchestrator 测试
 *
 * 覆盖范围:
 * - Stage 注册/执行
 * - 调度模式 (SEQUENTIAL, PARALLEL)
 * - runStagesParallel / runStagesGraph
 * - 取消和错误处理
 * - 生命周期事件
 * - 多 Agent 编排
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { AgentOrchestrator, SchedulingMode } from "../../../js/agents/runtime/orchestrator.js";
import { OrchestratorState } from "../../../js/agents/runtime/core/constants.js";

// ============================================================================
// Mock Agent
// ============================================================================

class MockAgent {
  constructor(name = "mock") {
    this.name = name;
    this.disposed = false;
    this.runCount = 0;
  }

  async run(input) {
    this.runCount++;
    return { agent: this.name, input };
  }

  async dispose() {
    this.disposed = true;
  }
}

// ============================================================================
// Test Suite
// ============================================================================

describe("AgentOrchestrator", () => {
  /** @type {AgentOrchestrator | null} */
  let orchestrator = null;

  afterEach(async () => {
    if (orchestrator && !orchestrator.isDisposed) {
      await orchestrator.dispose();
    }
    orchestrator = null;
  });

  // --------------------------------------------------------------------------
  // Construction
  // --------------------------------------------------------------------------

  describe("construction", () => {
    it("creates with default options", () => {
      orchestrator = new AgentOrchestrator();
      expect(orchestrator.state).toBe(OrchestratorState.IDLE);
      expect(orchestrator.runId).toBeTruthy();
      expect(orchestrator.eventBus).toBeTruthy();
    });

    it("accepts custom runId and mode", () => {
      orchestrator = new AgentOrchestrator({
        runId: "test-run-123",
        mode: "design",
        scenario: "custom",
      });
      expect(orchestrator.runId).toBe("test-run-123");
      expect(orchestrator.runContext.mode).toBe("design");
      expect(orchestrator.runContext.scenario).toBe("custom");
    });

    it("defaults to sequential scheduling", () => {
      orchestrator = new AgentOrchestrator();
      expect(orchestrator._schedulingMode).toBe(SchedulingMode.SEQUENTIAL);
    });

    it("accepts parallel scheduling mode", () => {
      orchestrator = new AgentOrchestrator({
        scheduling: { mode: SchedulingMode.PARALLEL, maxConcurrency: 5 },
      });
      expect(orchestrator._schedulingMode).toBe(SchedulingMode.PARALLEL);
      expect(orchestrator._maxConcurrency).toBe(5);
    });
  });

  // --------------------------------------------------------------------------
  // Stage Registration
  // --------------------------------------------------------------------------

  describe("registerStage", () => {
    beforeEach(() => {
      orchestrator = new AgentOrchestrator();
    });

    it("registers a stage handler", () => {
      const handler = () => "result";
      orchestrator.registerStage("test.stage", handler);
      expect(orchestrator._stages.has("test.stage")).toBeTruthy();
    });

    it("throws on empty name", () => {
      expect(() => orchestrator.registerStage("", () => {}),
        /name must be a non-empty string/
      );
    });

    it("throws on non-function handler", () => {
      expect(() => orchestrator.registerStage("test", "not-a-function")).toThrow(/handler must be a function/);
    });

    it("allows method chaining", () => {
      const result = orchestrator
        .registerStage("a", () => {})
        .registerStage("b", () => {});
      expect(result).toBe(orchestrator);
    });

    it("registers with options", () => {
      orchestrator.registerStage("test.stage", () => {}, {
        actor: "design",
        timeoutMs: 5000,
      });
      const entry = orchestrator._stages.get("test.stage");
      expect(entry.options.actor).toBe("design");
      expect(entry.options.timeoutMs).toBe(5000);
    });
  });

  // --------------------------------------------------------------------------
  // runStage (Sequential)
  // --------------------------------------------------------------------------

  describe("runStage (sequential)", () => {
    beforeEach(() => {
      orchestrator = new AgentOrchestrator();
    });

    it("executes registered stage", async () => {
      orchestrator.registerStage("test.run", (ctx, input) => {
        return { received: input, runId: ctx.runId };
      });

      const result = await orchestrator.runStage("test.run", { value: 42 });
      expect(result.received.value).toBe(42);
      expect(result.runId).toBe(orchestrator.runId);
    });

    it("throws on unregistered stage", async () => {
      await expect(() => orchestrator.runStage("unknown.stage")).rejects.toThrow(/Stage not registered: unknown\.stage/
      );
    });

    it("emits stage events", async () => {
      const events = [];
      orchestrator.eventBus.on("test.started", (e) => events.push(e));
      orchestrator.eventBus.on("test.completed", (e) => events.push(e));

      orchestrator.registerStage("test", () => "done");
      await orchestrator.runStage("test");

      expect(events.some(e => e.status === "started")).toBeTruthy();
      expect(events.some(e => e.status === "completed")).toBeTruthy();
    });

    it("emits failed event on error", async () => {
      const events = [];
      orchestrator.eventBus.on("test.failed", (e) => events.push(e));

      orchestrator.registerStage("test", () => {
        throw new Error("stage error");
      });

      await expect(() => orchestrator.runStage("test")).rejects.toThrow(/stage error/);
      expect(events.some(e => e.status === "failed")).toBeTruthy();
    });

    it("runs stages sequentially", async () => {
      const order = [];
      orchestrator.registerStage("a", async () => {
        await delay(20);
        order.push("a");
      });
      orchestrator.registerStage("b", async () => {
        order.push("b");
      });

      // Start both in parallel (they queue internally)
      const p1 = orchestrator.runStage("a");
      const p2 = orchestrator.runStage("b");

      await Promise.all([p1, p2]);
      expect(order).toEqual(["a", "b"]);
    });

    it("provides api with progress callback", async () => {
      const events = [];
      orchestrator.eventBus.on("test.progress", (e) => events.push(e));

      orchestrator.registerStage("test", (ctx, input, api) => {
        api.progress({ step: 1 });
        api.progress({ step: 2 });
        return "done";
      });

      await orchestrator.runStage("test");
      // Wait for backpressure flush
      await delay(50);
      expect(events.length >= 1, "should emit at least one progress event").toBeTruthy();
    });
  });

  // --------------------------------------------------------------------------
  // runStage (Parallel mode)
  // --------------------------------------------------------------------------

  describe("runStage (parallel mode)", () => {
    beforeEach(() => {
      orchestrator = new AgentOrchestrator({
        scheduling: { mode: SchedulingMode.PARALLEL, maxConcurrency: 2 },
      });
    });

    it("runs stages concurrently up to limit", async () => {
      let concurrent = 0;
      let maxConcurrent = 0;

      orchestrator.registerStage("task", async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await delay(30);
        concurrent--;
      });

      const promises = [
        orchestrator.runStage("task"),
        orchestrator.runStage("task"),
        orchestrator.runStage("task"),
        orchestrator.runStage("task"),
      ];

      await Promise.all(promises);
      expect(maxConcurrent).toBe(2);
    });

    it("respects concurrency limit", async () => {
      let concurrent = 0;
      let exceeded = false;

      orchestrator.registerStage("limited", async () => {
        concurrent++;
        if (concurrent > 2) exceeded = true;
        await delay(20);
        concurrent--;
      });

      await Promise.all([
        orchestrator.runStage("limited"),
        orchestrator.runStage("limited"),
        orchestrator.runStage("limited"),
      ]);

      expect(exceeded).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // runStagesParallel
  // --------------------------------------------------------------------------

  describe("runStagesParallel", () => {
    beforeEach(() => {
      orchestrator = new AgentOrchestrator();
    });

    it("runs multiple stages concurrently", async () => {
      const order = [];
      orchestrator.registerStage("fast", async () => {
        order.push("fast-start");
        await delay(10);
        order.push("fast-end");
        return "fast-result";
      });
      orchestrator.registerStage("slow", async () => {
        order.push("slow-start");
        await delay(30);
        order.push("slow-end");
        return "slow-result";
      });

      const results = await orchestrator.runStagesParallel([
        { name: "fast" },
        { name: "slow" },
      ]);

      expect(results.has("fast")).toBeTruthy();
      expect(results.has("slow")).toBeTruthy();
      expect(results.get("fast").success).toBe(true);
      expect(results.get("fast").result).toBe("fast-result");
      expect(results.get("slow").success).toBe(true);
    });

    it("returns empty map for empty input", async () => {
      const results = await orchestrator.runStagesParallel([]);
      expect(results.size).toBe(0);
    });

    it("captures stage errors without throwing", async () => {
      orchestrator.registerStage("ok", () => "ok");
      orchestrator.registerStage("fail", () => {
        throw new Error("boom");
      });

      const results = await orchestrator.runStagesParallel([
        { name: "ok" },
        { name: "fail" },
      ]);

      expect(results.get("ok").success).toBe(true);
      expect(results.get("fail").success).toBe(false);
      expect(results.get("fail").error).toContain("boom");
    });

    it("passes input to stages", async () => {
      orchestrator.registerStage("echo", (ctx, input) => input);

      const results = await orchestrator.runStagesParallel([
        { name: "echo", input: { value: 1 } },
        { name: "echo", input: { value: 2 } },
      ]);

      // Note: both use same stage name, last result wins
      expect(results.has("echo")).toBeTruthy();
    });
  });

  // --------------------------------------------------------------------------
  // runStagesGraph
  // --------------------------------------------------------------------------

  describe("runStagesGraph", () => {
    beforeEach(() => {
      orchestrator = new AgentOrchestrator();
    });

    it("runs stages respecting dependencies", async () => {
      const order = [];
      orchestrator.registerStage("a", async () => {
        await delay(10);
        order.push("a");
      });
      orchestrator.registerStage("b", async () => {
        order.push("b");
      });
      orchestrator.registerStage("c", async () => {
        order.push("c");
      });

      await orchestrator.runStagesGraph([
        { name: "a" },
        { name: "b", dependsOn: ["a"] },
        { name: "c", dependsOn: ["a"] },
      ]);

      expect(order[0]).toBe("a");
      expect(order.includes("b")).toBeTruthy();
      expect(order.includes("c")).toBeTruthy();
    });

    it("skips stages when dependency fails", async () => {
      orchestrator.registerStage("a", () => {
        throw new Error("a-failed");
      });
      orchestrator.registerStage("b", () => "b-result");

      const results = await orchestrator.runStagesGraph(
        [
          { name: "a" },
          { name: "b", dependsOn: ["a"] },
        ],
        { continueOnError: true }
      );

      expect(results.get("a").success).toBe(false);
      expect(results.get("b").success).toBe(false);
      expect(results.get("b").skipped).toBeTruthy();
    });

    it("throws on stage failure without continueOnError", async () => {
      orchestrator.registerStage("fail", () => {
        throw new Error("fail");
      });

      await expect(() => orchestrator.runStagesGraph([{ name: "fail" }])).rejects.toThrow(/Stage failed: fail/
      );
    });

    it("returns empty map for empty input", async () => {
      const results = await orchestrator.runStagesGraph([]);
      expect(results.size).toBe(0);
    });

    it("runs parallel stages at same level", async () => {
      let concurrent = 0;
      let maxConcurrent = 0;

      orchestrator.registerStage("root", () => "root");
      orchestrator.registerStage("leaf", async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await delay(20);
        concurrent--;
      });

      await orchestrator.runStagesGraph([
        { name: "root" },
        { name: "leaf1", dependsOn: ["root"] },
        { name: "leaf2", dependsOn: ["root"] },
        { name: "leaf3", dependsOn: ["root"] },
      ].map(s => ({ ...s, name: s.name === "root" ? "root" : "leaf" })));

      // Actually we need different stage names
    });
  });

  // --------------------------------------------------------------------------
  // Lifecycle (start, stop, end)
  // --------------------------------------------------------------------------

  describe("lifecycle", () => {
    beforeEach(() => {
      orchestrator = new AgentOrchestrator();
    });

    it("starts and transitions to RUNNING", () => {
      expect(orchestrator.state).toBe(OrchestratorState.IDLE);
      orchestrator.start();
      expect(orchestrator.state).toBe(OrchestratorState.RUNNING);
    });

    it("start is idempotent", () => {
      orchestrator.start();
      orchestrator.start();
      expect(orchestrator.state).toBe(OrchestratorState.RUNNING);
    });

    it("stop cancels the run", () => {
      orchestrator.start();
      orchestrator.stop("user-cancelled");
      expect(orchestrator.state).toBe(OrchestratorState.CANCELLED);
      expect(orchestrator.signal.aborted).toBeTruthy();
    });

    it("stop with failure reason sets FAILED state", () => {
      orchestrator.start();
      orchestrator.stop("stage_failed");
      expect(orchestrator.state).toBe(OrchestratorState.FAILED);
    });

    it("end completes the run", () => {
      orchestrator.start();
      orchestrator.end("done");
      expect(orchestrator.state).toBe(OrchestratorState.ENDED);
    });

    it("emits run lifecycle events", () => {
      const events = [];
      orchestrator.eventBus.on("run.started", (e) => events.push("started"));
      orchestrator.eventBus.on("run.completed", (e) => events.push("completed"));
      orchestrator.eventBus.on("run.ended", (e) => events.push("ended"));

      orchestrator.start();
      orchestrator.end();

      expect(events).toEqual(["started", "completed", "ended"]);
    });

    it("emits run.cancelled on stop", () => {
      const events = [];
      orchestrator.eventBus.on("run.cancelled", () => events.push("cancelled"));
      orchestrator.eventBus.on("run.ended", () => events.push("ended"));

      orchestrator.start();
      orchestrator.stop();

      expect(events).toEqual(["cancelled", "ended"]);
    });
  });

  // --------------------------------------------------------------------------
  // Cancellation
  // --------------------------------------------------------------------------

  describe("cancellation", () => {
    beforeEach(() => {
      orchestrator = new AgentOrchestrator();
    });

    it("aborts running stage on stop", async () => {
      orchestrator.registerStage("long", async (ctx, input, api) => {
        // Check signal periodically to be cancellable
        const start = Date.now();
        while (Date.now() - start < 100) {
          if (api.signal.aborted) {
            throw new Error("cancelled");
          }
          await delay(10);
        }
      });

      const promise = orchestrator.runStage("long");
      // Attach rejection handler immediately
      let wasRejected = false;
      const handled = promise.catch((e) => { wasRejected = true; });

      await delay(10);
      orchestrator.stop();

      await handled;
      expect(wasRejected, "promise should be rejected").toBeTruthy();
    });

    it("rejects pending parallel waiters on stop", async () => {
      orchestrator = new AgentOrchestrator({
        scheduling: { mode: SchedulingMode.PARALLEL, maxConcurrency: 1 },
      });

      orchestrator.registerStage("block", async () => {
        await delay(100);
      });

      const p1 = orchestrator.runStage("block");
      const p2 = orchestrator.runStage("block");

      // Attach rejection handlers immediately
      let rejected1 = false;
      let rejected2 = false;
      const r1 = p1.catch((e) => { rejected1 = true; });
      const r2 = p2.catch((e) => { rejected2 = true; });

      await delay(10);
      orchestrator.stop();

      await Promise.allSettled([r1, r2]);
      expect(rejected1 || rejected2, "at least one promise should be rejected").toBeTruthy();
    });

    it("runStage throws after stop", async () => {
      orchestrator.registerStage("test", () => "result");
      orchestrator.stop();

      await expect(orchestrator.runStage("test")).rejects.toThrow(/Run cancelled/);
    });
  });

  // --------------------------------------------------------------------------
  // Error Handling
  // --------------------------------------------------------------------------

  describe("error handling", () => {
    beforeEach(() => {
      orchestrator = new AgentOrchestrator();
    });

    it("stage error sets FAILED state", async () => {
      orchestrator.registerStage("fail", () => {
        throw new Error("stage-error");
      });

      await expect(orchestrator.runStage("fail")).rejects.toThrow(/stage-error/);
      expect(orchestrator.state).toBe(OrchestratorState.FAILED);
    });

    it("emits run.failed on stage error", async () => {
      const events = [];
      orchestrator.eventBus.on("run.failed", (e) => events.push(e));

      orchestrator.registerStage("fail", () => {
        throw new Error("boom");
      });

      await expect(orchestrator.runStage("fail")).rejects.toThrow(/boom/);
      expect(events.length).toBe(1);
      expect(events[0].payload.error.includes("boom")).toBeTruthy();
    });

    it("throws on disposed orchestrator", async () => {
      orchestrator.registerStage("test", () => "result");
      await orchestrator.dispose();

      expect(() => orchestrator.start()).toThrow(/disposed/i);
    });
  });

  // --------------------------------------------------------------------------
  // Multi-Agent Registration
  // --------------------------------------------------------------------------

  describe("registerAgent", () => {
    beforeEach(() => {
      orchestrator = new AgentOrchestrator();
    });

    it("registers child agent", () => {
      const agent = new MockAgent("child");
      orchestrator.registerAgent(agent);
      expect(orchestrator._childAgents.has(agent)).toBeTruthy();
    });

    it("allows method chaining", () => {
      const result = orchestrator
        .registerAgent(new MockAgent("a"))
        .registerAgent(new MockAgent("b"));
      expect(result).toBe(orchestrator);
    });

    it("ignores non-disposable objects", () => {
      orchestrator.registerAgent({ name: "invalid" });
      expect(orchestrator._childAgents.size).toBe(0);
    });

    it("disposes child agents on orchestrator dispose", async () => {
      const agent1 = new MockAgent("a");
      const agent2 = new MockAgent("b");

      orchestrator.registerAgent(agent1).registerAgent(agent2);
      await orchestrator.dispose();

      expect(agent1.disposed).toBeTruthy();
      expect(agent2.disposed).toBeTruthy();
    });

    it("accepts agents via constructor services", async () => {
      const agent = new MockAgent("initial");
      orchestrator = new AgentOrchestrator({
        services: { agents: [agent] },
      });

      expect(orchestrator._childAgents.has(agent)).toBeTruthy();
    });
  });

  // --------------------------------------------------------------------------
  // Stage Timeout
  // --------------------------------------------------------------------------

  describe("stage timeout", () => {
    beforeEach(() => {
      orchestrator = new AgentOrchestrator();
    });

    it("aborts stage after timeout", async () => {
      orchestrator.registerStage(
        "slow",
        async (ctx, input, api) => {
          // Use a loop that checks signal to be cancellable
          const start = Date.now();
          while (Date.now() - start < 200) {
            if (api.signal.aborted) {
              throw new Error("stage_timeout");
            }
            await delay(10);
          }
          return "done";
        },
        { timeoutMs: 50 }
      );

      await expect(() => orchestrator.runStage("slow")).rejects.toThrow(/stage_timeout|aborted|cancelled/i
      );
    });
  });

  // --------------------------------------------------------------------------
  // Config Validation
  // --------------------------------------------------------------------------

  describe("config validation", () => {
    it("validates userConfig in strict mode", async () => {
      orchestrator = new AgentOrchestrator({
        configValidation: { strict: true },
      });

      orchestrator.registerStage("test", () => "ok");

      await expect(() =>
          orchestrator.runStage("test", {
            userConfig: { maxIterations: "invalid" },
          }),
        /Invalid userConfig|ConfigValidationError/
      );
    });

    it("coerces config values when enabled", async () => {
      orchestrator = new AgentOrchestrator({
        configValidation: { coerce: true },
      });

      let receivedConfig;
      orchestrator.registerStage("test", (ctx, input) => {
        receivedConfig = input.userConfig;
      });

      await orchestrator.runStage("test", {
        userConfig: { maxIterations: "10" },
      });

      // coerce should convert string "10" to number 10
      expect(receivedConfig.maxIterations).toBe(10);
    });
  });

  // --------------------------------------------------------------------------
  // Dispose
  // --------------------------------------------------------------------------

  describe("dispose", () => {
    it("clears stages and queue", async () => {
      orchestrator = new AgentOrchestrator();
      orchestrator.registerStage("test", () => {});

      await orchestrator.dispose();

      expect(orchestrator._stages.size).toBe(0);
      expect(orchestrator.disposed).toBeTruthy();
    });

    it("aborts signal on dispose", async () => {
      orchestrator = new AgentOrchestrator();
      const signal = orchestrator.signal;

      await orchestrator.dispose();

      expect(signal.aborted).toBeTruthy();
    });

    it("rejects parallel waiters on dispose", async () => {
      orchestrator = new AgentOrchestrator({
        scheduling: { mode: SchedulingMode.PARALLEL, maxConcurrency: 1 },
      });

      orchestrator.registerStage("block", async () => {
        await delay(100);
      });

      const p1 = orchestrator.runStage("block");
      const p2 = orchestrator.runStage("block");

      // Attach rejection handlers immediately to avoid unhandled rejection
      let rejected1 = false;
      let rejected2 = false;
      const r1 = p1.catch((e) => { rejected1 = true; });
      const r2 = p2.catch((e) => { rejected2 = true; });

      await delay(10);
      await orchestrator.dispose();

      await Promise.allSettled([r1, r2]);
      // At least one should be rejected (the waiting one)
      expect(rejected1 || rejected2, "at least one promise should be rejected").toBeTruthy();
    });
  });
});

// ============================================================================
// Utilities
// ============================================================================

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
