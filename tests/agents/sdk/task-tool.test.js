import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";

import { createTaskTool, ContextMode, TASK_TOOL_DEFINITION } from "../../../js/agents/runtime/tools/TaskTool.js";
import { SubagentRegistry } from "../../../js/agents/sdk/SubagentRegistry.js";
import { CicadaCompressor } from "../../../js/agents/runtime/compression/cicada-compressor.js";
import { Watchdog } from "../../../js/agents/runtime/compression/watchdog.js";

describe("TaskTool", () => {
  it("should have context_mode in schema", () => {
    const props = TASK_TOOL_DEFINITION.parameters.properties;
    assert.ok(props.context_mode);
    assert.deepEqual(props.context_mode.enum, ["isolated", "shared", "handoff"]);
  });

  it("should export ContextMode enum", () => {
    assert.equal(ContextMode.ISOLATED, "isolated");
    assert.equal(ContextMode.SHARED, "shared");
    assert.equal(ContextMode.HANDOFF, "handoff");
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

    assert.ok(receivedContext);
    assert.deepEqual(receivedContext.sharedContext, { test: 1 });
    assert.equal(receivedContext.messages, undefined);
    assert.equal(receivedContext.handoff, undefined);
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

    assert.ok(receivedContext);
    // shared 模式不再传 messages（避免上下文膨胀）
    assert.equal(receivedContext.messages, undefined);
    assert.deepEqual(receivedContext.sharedContext, { shared: true });
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

    assert.ok(receivedContext);
    assert.ok(receivedContext.handoff);
    assert.equal(receivedContext.handoff.taskGoal, "test goal");
    assert.equal(receivedContext.handoff.iteration, 5);
    assert.equal(receivedContext.handoff.summary, "test summary");
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

    assert.ok(receivedContext);
    assert.equal(receivedContext.messages, undefined);
    assert.equal(receivedContext.handoff, undefined);
  });
});

describe("Watchdog", () => {
  it("should track iterations with tick()", () => {
    const watchdog = new Watchdog({});
    assert.equal(watchdog._iterationCount, 0);

    watchdog.tick();
    watchdog.tick();
    watchdog.tick();

    assert.equal(watchdog._iterationCount, 3);
  });

  it("should detect max iterations exceeded", () => {
    const watchdog = new Watchdog({});

    for (let i = 0; i < 10; i++) watchdog.tick();

    const result = watchdog.checkHealth({ maxIterations: 5 });
    assert.equal(result.healthy, false);
    assert.ok(result.issues.some(i => i.type === "max_iterations"));
  });

  it("should be healthy when under limits", () => {
    const watchdog = new Watchdog({});
    watchdog.tick();

    const result = watchdog.checkHealth({ maxIterations: 50, maxTimeMs: 600000 });
    assert.equal(result.healthy, true);
    assert.equal(result.issues.length, 0);
  });

  it("should reset counters", () => {
    const watchdog = new Watchdog({});
    for (let i = 0; i < 10; i++) watchdog.tick();

    watchdog.reset();

    assert.equal(watchdog._iterationCount, 0);
    const result = watchdog.checkHealth({ maxIterations: 5 });
    assert.equal(result.healthy, true);
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

    assert.equal(handoff.runId, "run_123");
    assert.ok(handoff.timestamp);
    assert.equal(handoff.accomplished.claimCount, 3);
    assert.deepEqual(handoff.accomplished.completedTodos, ["step 1"]);
    assert.equal(handoff.pending.taskGoal, "analyze data");
    assert.equal(handoff.pending.todos.length, 1);
    assert.equal(handoff.resumeGuide.iteration, 3);
    assert.equal(handoff.resumeGuide.nextAction, "step 2");
  });

  it("should handle empty state", () => {
    const compressor = new CicadaCompressor({});
    const handoff = compressor.buildHandoff({}, null);

    assert.ok(handoff.timestamp);
    assert.equal(handoff.accomplished.summary, "");
    assert.deepEqual(handoff.accomplished.completedTodos, []);
    assert.deepEqual(handoff.pending.todos, []);
  });
});
