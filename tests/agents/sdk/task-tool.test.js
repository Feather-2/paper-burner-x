
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { createTaskTool, ContextMode, TASK_TOOL_DEFINITION } from "../../../js/agents/runtime/tools/TaskTool.js";
import { SubagentRegistry } from "../../../js/agents/sdk/SubagentRegistry.js";
import { CicadaCompressor } from "../../../js/agents/runtime/compression/cicada-compressor.js";
import { Watchdog } from "../../../js/agents/runtime/compression/watchdog.js";

describe("TaskTool", () => {
  it("should have context_mode in schema", () => {
    const props = TASK_TOOL_DEFINITION.parameters.properties;
    expect(props).toHaveProperty("context_mode");
    expect(props.context_mode.enum).toEqual(["isolated", "shared", "handoff"]);
  });

  it("should export ContextMode enum", () => {
    expect(ContextMode.ISOLATED).toBe("isolated");
    expect(ContextMode.SHARED).toBe("shared");
    expect(ContextMode.HANDOFF).toBe("handoff");
  });

  it("isolated mode: only passes sharedContext", async () => {
    const registry = new SubagentRegistry();
    let receivedContext = null;

    registry.register("test", async (config) => {
      receivedContext = config.inheritedContext;
      return { run: async () => ({ ok: true }) };
    });

    const handler = createTaskTool({ registry });
    const context = {
      emit: () => {},
      logger: { info: () => {}, error: () => {} },
      signal: {},
      state: { sharedContext: { test: 1 } },
    };

    await handler({ subagent_type: "test", prompt: "do something", context_mode: "isolated" }, context);

    expect(receivedContext).toMatchObject({ sharedContext: { test: 1 } });
    expect(receivedContext.messages).toBe(undefined);
    expect(receivedContext.handoff).toBe(undefined);
  });

  it("shared mode: passes sharedContext only (no messages)", async () => {
    const registry = new SubagentRegistry();
    let receivedContext = null;

    registry.register("test", async (config) => {
      receivedContext = config.inheritedContext;
      return { run: async () => ({ ok: true }) };
    });

    const parentAgent = {
      _loop: { messages: [{ role: "user", content: "hello" }] },
      memory: { sharedContext: { shared: true } },
    };

    const handler = createTaskTool({ registry, parentAgent });
    const context = {
      emit: () => {},
      logger: { info: () => {}, error: () => {} },
      signal: {},
      state: {},
    };

    await handler({ subagent_type: "test", prompt: "do something", context_mode: "shared" }, context);

    expect(receivedContext).toMatchObject({ sharedContext: { shared: true } });
    // shared 模式不再传 messages（避免上下文膨胀）
    expect(receivedContext.messages).toBe(undefined);
  });

  it("handoff mode: passes handoff document", async () => {
    const registry = new SubagentRegistry();
    let receivedContext = null;

    registry.register("test", async (config) => {
      receivedContext = config.inheritedContext;
      return { run: async () => ({ ok: true }) };
    });

    const handler = createTaskTool({ registry });
    const context = {
      emit: () => {},
      logger: { info: () => {}, error: () => {} },
      signal: {},
      state: {
        taskGoal: "test goal",
        iteration: 5,
        todos: [{ status: "pending", text: "todo1" }],
        L1: { condensedMemory: { summary: "test summary" } },
        sharedContext: { sc: 1 },
      },
    };

    await handler({ subagent_type: "test", prompt: "do something", context_mode: "handoff" }, context);

    expect(receivedContext).toMatchObject({ handoff: expect.any(Object) });
    expect(receivedContext.handoff).toMatchObject({
      taskGoal: "test goal",
      iteration: 5,
      summary: "test summary",
    });
  });

  it("default mode is isolated", async () => {
    const registry = new SubagentRegistry();
    let receivedContext = null;

    registry.register("test", async (config) => {
      receivedContext = config.inheritedContext;
      return { run: async () => ({ ok: true }) };
    });

    const handler = createTaskTool({ registry });
    const context = {
      emit: () => {},
      logger: { info: () => {}, error: () => {} },
      signal: {},
      state: { sharedContext: { x: 1 } },
    };

    // 不传 context_mode
    await handler({ subagent_type: "test", prompt: "do something" }, context);

    expect(receivedContext).toMatchObject({ sharedContext: { x: 1 } });
    expect(receivedContext.messages).toBe(undefined);
    expect(receivedContext.handoff).toBe(undefined);
  });
});

describe("Watchdog", () => {
  it("should track iterations with tick()", () => {
    const watchdog = new Watchdog({});
    expect(watchdog._iterationCount).toBe(0);

    watchdog.tick();
    watchdog.tick();
    watchdog.tick();

    expect(watchdog._iterationCount).toBe(3);
  });

  it("should detect max iterations exceeded", () => {
    const watchdog = new Watchdog({});

    for (let i = 0; i < 10; i++) watchdog.tick();

    const result = watchdog.checkHealth({ maxIterations: 5 });
    expect(result.healthy).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "max_iterations" })])
    );
  });

  it("should be healthy when under limits", () => {
    const watchdog = new Watchdog({});
    watchdog.tick();

    const result = watchdog.checkHealth({ maxIterations: 50, maxTimeMs: 600000 });
    expect(result.healthy).toBe(true);
    expect(result.issues.length).toBe(0);
  });

  it("should reset counters", () => {
    const watchdog = new Watchdog({});
    for (let i = 0; i < 10; i++) watchdog.tick();

    watchdog.reset();

    expect(watchdog._iterationCount).toBe(0);
    const result = watchdog.checkHealth({ maxIterations: 5 });
    expect(result.healthy).toBe(true);
  });
});

describe("CicadaCompressor.buildHandoff", () => {
  it("should build handoff document from state", () => {
    const compressor = new CicadaCompressor({});

    const state = {
      runId: "run_123",
      taskGoal: "analyze data",
      iteration: 3,
      todos: [
        { status: "completed", text: "step 1" },
        { status: "pending", text: "step 2" },
      ],
      L1: {
        claims: [1, 2, 3],
        condensedMemory: { summary: "progress so far" },
      },
      L2: { warnings: ["warning 1"] },
    };

    const handoff = compressor.buildHandoff(state, null);

    expect(handoff.runId).toBe("run_123");
    expect(handoff.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(handoff.accomplished.claimCount).toBe(3);
    expect(handoff.accomplished.completedTodos).toEqual(["step 1"]);
    expect(handoff.pending.taskGoal).toBe("analyze data");
    expect(handoff.pending.todos.length).toBe(1);
    expect(handoff.resumeGuide.iteration).toBe(3);
    expect(handoff.resumeGuide.nextAction).toBe("step 2");
  });

  it("should handle empty state", () => {
    const compressor = new CicadaCompressor({});
    const handoff = compressor.buildHandoff({}, null);

    expect(handoff.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(handoff.accomplished.summary).toBe("");
    expect(handoff.accomplished.completedTodos).toEqual([]);
    expect(handoff.pending.todos).toEqual([]);
  });
});
