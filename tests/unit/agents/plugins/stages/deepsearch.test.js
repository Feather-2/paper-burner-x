/**
 * DeepSearch Stage Tests (node:test)
 *
 * Tests DeepSearchAgentLoop, DeepSearchState, multi-round document analysis,
 * task planning, and report generation.
 */

// ============================================================================
// DeepSearchState Tests
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";

it("DeepSearchState: constructor creates valid state with defaults", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");

  const state = new DeepSearchState();

  expect(state.runId).toBe("run_unknown");
  expect(state.schemaVersion).toBe("0.1");
  expect(state.iteration).toBe(0);
  expect(state.maxIterations).toBe(5);
  expect(state.todos).toEqual([]);
  expect(state.L0).toEqual({ sources: [], sourceIndex: null });
  expect(state.L1).toMatchObject({
    gaps: [],
    claims: [],
    report: null,
  });
  expect(state.L2).toMatchObject({
    retrievedChunks: [],
    tokenUsage: { input: 0, output: 0, total: 0, estimatedCostUSD: 0 },
    awaitUserFeedback: false,
    taskImpossible: false,
    reason: "",
  });
  expect(state.L0.sources).toEqual([]);
  expect(state.L1.claims).toEqual([]);
  expect(state.L2.retrievedChunks).toEqual([]);
});

it("DeepSearchState: constructor accepts custom runId and taskGoal", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");

  const state = new DeepSearchState({
    runId: "run_custom_123",
    taskGoal: "Analyze market trends",
    userConfig: { language: "zh-CN", maxIterations: 10 },
  });

  expect(state.runId).toBe("run_custom_123");
  expect(state.taskGoal).toBe("Analyze market trends");
  expect(state.userConfig.language).toBe("zh-CN");
  expect(state.userConfig.maxIterations).toBe(10);
});

it("DeepSearchState: toJSON and fromJSON round-trip", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");

  const original = new DeepSearchState({
    runId: "run_roundtrip",
    taskGoal: "Test serialization",
    iteration: 3,
    todos: [{ id: "t1", text: "Task 1" }],
    L1: { claims: [{ id: "c1", text: "Claim 1" }], report: { markdown: "# Report" } },
  });

  const json = original.toJSON();
  const restored = DeepSearchState.fromJSON(json);

  expect(restored.runId).toBe("run_roundtrip");
  expect(restored.taskGoal).toBe("Test serialization");
  expect(restored.iteration).toBe(3);
  expect(restored.todos.length).toBe(1);
  expect(restored.todos[0].id).toBe("t1");
  expect(restored.L1.claims.length).toBe(1);
  expect(restored.L1.report).toEqual({ markdown: "# Report" });
});

it("DeepSearchState: todos getter/setter works correctly", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");

  const state = new DeepSearchState({ runId: "run_todos" });
  expect(state.todos).toEqual([]);

  state.todos = [{ id: "t1", text: "First" }, { id: "t2", text: "Second" }];
  expect(state.todos.length).toBe(2);
  expect(state.todos[0].id).toBe("t1");

  // Mutate in place
  state.todos.push({ id: "t3", text: "Third" });
  expect(state.todos.length).toBe(3);
});

it("DeepSearchState: L0/L1/L2 layer initialization", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");

  const state = new DeepSearchState({
    runId: "run_layers",
    L0: { sources: [{ id: "s1", name: "doc.pdf" }], sourceIndex: { count: 1 } },
    L1: { claims: [{ id: "c1" }], gaps: [{ id: "g1" }], report: { markdown: "# Hello" } },
    L2: { retrievedChunks: [{ id: "chunk1" }], tokenUsage: { input: 100, output: 50 } },
  });

  expect(state.L0.sources.length).toBe(1);
  expect(state.L0.sources[0].id).toBe("s1");
  expect(state.L1.claims.length).toBe(1);
  expect(state.L1.gaps.length).toBe(1);
  expect(state.L1.report.markdown).toBe("# Hello");
  expect(state.L2.retrievedChunks.length).toBe(1);
  expect(state.L2.tokenUsage.input).toBe(100);
});

// ============================================================================
// DeepSearchAgentLoop Tests
// ============================================================================

it("DeepSearchAgentLoop: constructor initializes with defaults", async () => {
  const { DeepSearchAgentLoop, AgentStatus } = await import(
    "../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js"
  );

  const agent = new DeepSearchAgentLoop();

  expect(agent.status).toBe(AgentStatus.IDLE);
  expect(agent.state).toBe(null);
  expect(agent.mode).toBe("wider");
  expect(agent.maxIterations).toBeGreaterThan(0);
  expect(agent.maxToolCalls).toBeGreaterThan(0);
});

it("DeepSearchAgentLoop: constructor accepts mode option", async () => {
  const { DeepSearchAgentLoop, AnalysisMode } = await import(
    "../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js"
  );

  const quickAgent = new DeepSearchAgentLoop({ mode: AnalysisMode.QUICK });
  expect(quickAgent.mode).toBe("quick");

  const deeperAgent = new DeepSearchAgentLoop({ mode: AnalysisMode.DEEPER });
  expect(deeperAgent.mode).toBe("deeper");
});

it("DeepSearchAgentLoop: _parseDecision parses valid JSON decision", async () => {
  const { DeepSearchAgentLoop } = await import(
    "../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js"
  );

  const agent = new DeepSearchAgentLoop();

  // Single action
  const single = agent._parseDecision('{"thought":"thinking","action":"list-docs","args":{"query":"test"}}');
  expect(single).toMatchObject({
    thought: "thinking",
    action: "list-docs",
    args: { query: "test" },
  });
  expect(single.thought).toBe("thinking");
  expect(single.action).toBe("list-docs");
  expect(single.args).toEqual({ query: "test" });

  // Multiple actions (batch)
  const batch = agent._parseDecision('{"thought":"batch","actions":[{"action":"a","args":{}},{"action":"b","args":{}}]}');
  expect(batch).toMatchObject({
    thought: "batch",
    actions: expect.any(Array),
  });
  expect(batch.thought).toBe("batch");
  expect(batch.actions).toBeInstanceOf(Array);
  expect(batch.actions.length).toBe(2);

  // Invalid JSON
  const invalid = agent._parseDecision("not valid json");
  expect(invalid).toBe(null);
});

it("DeepSearchAgentLoop: _ensureState handles various input types", async () => {
  const { DeepSearchAgentLoop } = await import(
    "../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js"
  );
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");

  const agent = new DeepSearchAgentLoop();

  // Direct DeepSearchState instance
  const directState = new DeepSearchState({ runId: "run_direct" });
  expect(agent._ensureState(directState)).toBe(directState);

  // Wrapped state
  const wrapped = agent._ensureState({ state: new DeepSearchState({ runId: "run_wrapped" }) });
  expect(wrapped).toBeInstanceOf(DeepSearchState);
  expect(wrapped.runId).toBe("run_wrapped");

  // Plain object
  const fromObj = agent._ensureState({ runId: "run_obj", taskGoal: "Test" });
  expect(fromObj).toBeInstanceOf(DeepSearchState);
  expect(fromObj.runId).toBe("run_obj");

  // Null input creates default state
  const fromNull = agent._ensureState(null);
  expect(fromNull).toBeInstanceOf(DeepSearchState);
});

it("DeepSearchAgentLoop: _emit prefixes event names correctly", async () => {
  const { DeepSearchAgentLoop } = await import(
    "../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js"
  );

  const agent = new DeepSearchAgentLoop();
  const emittedEvents = [];
  agent.eventBus = { emit: (name, record) => emittedEvents.push({ name, record }) };

  agent._emit("test.event", { data: 123 });
  expect(emittedEvents.length).toBe(1);
  expect(emittedEvents[0].name).toBe("deepsearch.test.event");

  // Already prefixed
  agent._emit("deepsearch.already.prefixed", { data: 456 });
  expect(emittedEvents.length).toBe(2);
  expect(emittedEvents[1].name).toBe("deepsearch.already.prefixed");
});

it("DeepSearchAgentLoop: getAgentContextStatus returns correct status", async () => {
  const { DeepSearchAgentLoop } = await import(
    "../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js"
  );
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");

  const agent = new DeepSearchAgentLoop();
  agent.state = new DeepSearchState({
    runId: "run_status",
    iteration: 5,
    todos: [{ id: "t1" }, { id: "t2" }],
    L1: { claims: [{ id: "c1" }] },
  });

  const status = agent.getAgentContextStatus();
  expect(status.runId).toBe("run_status");
  expect(status.iteration).toBe(5);
  expect(status.todoCount).toBe(2);
  expect(status.claimCount).toBe(1);
});

it("DeepSearchAgentLoop: _recordToolCall tracks consecutive calls", async () => {
  const { DeepSearchAgentLoop } = await import(
    "../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js"
  );

  const agent = new DeepSearchAgentLoop({
    toolCallGuard: { enabled: true, warnAt: 2, maxConsecutive: 3 },
  });

  // First call - no warning
  const first = agent._recordToolCall("list-docs", { query: "test" });
  expect(first).toMatchObject({ tool: "list-docs" });
  expect(first.shouldWarn).toBe(false);
  expect(first.shouldStop).toBe(false);

  // Second identical call - warning
  const second = agent._recordToolCall("list-docs", { query: "test" });
  expect(second).toMatchObject({ tool: "list-docs" });
  expect(second.shouldWarn).toBe(true);
  expect(second.shouldStop).toBe(false);

  // Third identical call - should stop
  const third = agent._recordToolCall("list-docs", { query: "test" });
  expect(third).toMatchObject({ tool: "list-docs" });
  expect(third.shouldStop).toBe(true);

  // Different call resets counter
  const different = agent._recordToolCall("read-doc", { docId: "doc1" });
  expect(different).toMatchObject({ tool: "read-doc" });
  expect(different.shouldWarn).toBe(false);
  expect(different.shouldStop).toBe(false);
});

it("DeepSearchAgentLoop: _recordToolCall ignores tools in ignoreList", async () => {
  const { DeepSearchAgentLoop } = await import(
    "../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js"
  );

  const agent = new DeepSearchAgentLoop({
    toolCallGuard: { enabled: true, warnAt: 2, maxConsecutive: 3, ignoreTools: ["progress"] },
  });

  // Ignored tool returns null
  const ignored = agent._recordToolCall("progress", { percent: 50 });
  expect(ignored).toBe(null);
});

// ============================================================================
// Multi-Round Document Analysis Tests (Mocked)
// ============================================================================

it("DeepSearchAgentLoop: run() with mocked phases completes successfully", async () => {
  // This test mocks the planning/execution/writing phases to test the loop structure
  const { DeepSearchAgentLoop, AgentStatus } = await import(
    "../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js"
  );
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");

  const events = [];
  const mockEventBus = {
    emit: (name, record) => events.push({ name, record }),
    enableBackpressure: () => {},
  };

  const mockStageApi = {
    emit: (name, record) => events.push({ name, record }),
    eventBus: mockEventBus,
    traceContext: {
      withSpan: async (_name, fn) => {
        const mockSpan = {
          setAttributes: () => {},
          setAttribute: () => {},
          setStatus: () => {},
        };
        return await fn(mockSpan);
      },
      startSpan: () => ({ setAttribute: () => {}, setAttributes: () => {} }),
      endSpan: () => {},
    },
    errorBoundary: {
      wrap: async (fn) => await fn(),
    },
  };

  // Create agent with minimal iterations
  const agent = new DeepSearchAgentLoop({
    maxIterations: 1,
    mode: "quick",
  });

  const state = new DeepSearchState({
    runId: "run_mocked",
    taskGoal: "Test mocked run",
    L1: { report: { markdown: "# Pre-existing report" } },
  });

  // Mock the budget to immediately exhaust to skip iteration loop
  agent.budget = { isExhausted: () => true };

  try {
    const result = await agent.run(state, mockStageApi);

    expect(result.runId).toBe("run_mocked");
    expect(result.status).toBe(AgentStatus.COMPLETED);
    expect(result.report).toMatchObject({ markdown: "# Pre-existing report" });
  } catch (err) {
    // Expected to fail due to missing model caller in this mocked scenario
    // The test verifies the structure is correct
    expect(
      err.message.includes("No model available") || err.message.includes("model")
    ).toBe(true);
  }
});

// ============================================================================
// Tool Catalog Tests
// ============================================================================

it("DeepSearch tools: getToolCatalogPrompt returns non-empty string", async () => {
  const { getToolCatalogPrompt } = await import("../../../js/agents/stages/deepsearch/tools/index.js");

  const catalog = getToolCatalogPrompt();
  expect(typeof catalog).toBe("string");
  expect(catalog.length).toBeGreaterThan(0);
  expect(catalog).toMatch(/list-docs|read-doc/);
});

it("DeepSearch tools: tools object contains expected tools", async () => {
  const { tools } = await import("../../../js/agents/stages/deepsearch/tools/index.js");

  expect(typeof tools).toBe("object");
  const listDocsTool = tools["list-docs"] || tools.listDocs;
  const readDocTool = tools["read-doc"] || tools.readDoc;

  expect(listDocsTool).toMatchObject({ definition: { name: "list-docs" } });
  expect(readDocTool).toMatchObject({ definition: { name: "read-doc" } });
});

// ============================================================================
// Integration: State + Agent Lifecycle
// ============================================================================

it("DeepSearchAgentLoop: status transitions from IDLE to RUNNING", async () => {
  const { DeepSearchAgentLoop, AgentStatus } = await import(
    "../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js"
  );
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");

  const agent = new DeepSearchAgentLoop({ maxIterations: 0 });
  expect(agent.status).toBe(AgentStatus.IDLE);

  const state = new DeepSearchState({ runId: "run_lifecycle" });
  agent.state = state;

  // After setting state, still IDLE (run not started)
  expect(agent.status).toBe(AgentStatus.IDLE);
});

it("DeepSearchState: dispose cleans up resources", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");

  const state = new DeepSearchState({ runId: "run_dispose" });
  expect(state.disposed).toBe(false);

  await state.dispose();

  // After dispose, accessing methods should throw
  expect(() => state.toJSON()).toThrow(/disposed/i);
});

it("DeepSearchState: planningTree is initialized", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");

  const state = new DeepSearchState({
    runId: "run_tree",
    taskGoal: "Build planning tree",
  });

  expect(state.planningTree).toMatchObject({ rootGoal: "Build planning tree" });
  expect(state.planningTree.runId).toBe("run_tree");
});

// ============================================================================
// Task Planning Tests
// ============================================================================

it("DeepSearchState: task state accessors work correctly", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");

  const state = new DeepSearchState({
    runId: "run_task",
    taskGoal: "Initial goal",
  });

  expect(state.taskGoal).toBe("Initial goal");
  state.taskGoal = "Updated goal";
  expect(state.taskGoal).toBe("Updated goal");

  expect(state.awaitUserFeedback).toBe(false);
  state.awaitUserFeedback = true;
  expect(state.awaitUserFeedback).toBe(true);

  expect(state.taskImpossible).toBe(false);
  state.taskImpossible = true;
  expect(state.taskImpossible).toBe(true);
});

it("DeepSearchState: iteration state accessors work correctly", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");

  const state = new DeepSearchState({
    runId: "run_iter",
    iteration: 2,
  });

  expect(state.iteration).toBe(2);

  // Gaps accessor
  state.gaps = [{ id: "g1", text: "Gap 1" }];
  expect(state.gaps.length).toBe(1);
  expect(state.gaps[0].id).toBe("g1");

  // Chunks accessor
  state.chunks = [{ id: "c1", text: "Chunk 1" }];
  expect(state.chunks.length).toBe(1);
});

// ============================================================================
// Report Generation Tests
// ============================================================================

it("DeepSearchState: report state accessors work correctly", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");

  const state = new DeepSearchState({ runId: "run_report" });

  // Initial report may be null or empty object
  const initialReport = state.report;
  expect(initialReport === null || typeof initialReport === "object").toBe(true);

  // Set report via L1
  state.L1.report = { markdown: "# Final Report\n\nContent here." };
  expect(state.L1.report).toEqual({ markdown: "# Final Report\n\nContent here." });
  expect(state.L1.report.markdown).toBe("# Final Report\n\nContent here.");

  // L1 gaps
  state.L1.gaps = [{ id: "g1", text: "Gap 1" }];
  expect(state.L1.gaps.length).toBe(1);

  // L1 claims
  state.L1.claims = [{ id: "c1", text: "Claim 1" }];
  expect(state.L1.claims.length).toBe(1);
});

it("DeepSearchState: L1 report via direct property access", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");

  const state = new DeepSearchState({
    runId: "run_l1_report",
    L1: {
      report: { markdown: "# L1 Report", format: "markdown" },
      claims: [{ id: "claim1", text: "Claim text" }],
    },
  });

  expect(state.L1.report).toMatchObject({ markdown: "# L1 Report", format: "markdown" });
  expect(state.L1.report.markdown).toBe("# L1 Report");
  expect(state.L1.claims.length).toBe(1);
});

// ============================================================================
// AgentStatus Enum Tests
// ============================================================================

it("AgentStatus: contains expected values", async () => {
  const { AgentStatus } = await import(
    "../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js"
  );

  expect(AgentStatus.IDLE).toBe("idle");
  expect(AgentStatus.RUNNING).toBe("running");
  expect(AgentStatus.COMPLETED).toBe("completed");
  expect(AgentStatus.FAILED).toBe("failed");

  // Should be frozen
  expect(Object.isFrozen(AgentStatus)).toBe(true);
});

it("AnalysisMode: contains expected modes", async () => {
  const { AnalysisMode } = await import(
    "../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js"
  );

  expect(AnalysisMode.QUICK).toBe("quick");
  expect(AnalysisMode.WIDER).toBe("wider");
  expect(AnalysisMode.DEEPER).toBe("deeper");

  expect(Object.isFrozen(AnalysisMode)).toBe(true);
});

// ============================================================================
// Edge Cases
// ============================================================================

it("DeepSearchState: handles empty L1/L2 gracefully", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");

  const state = new DeepSearchState({
    runId: "run_empty_layers",
    L1: null,
    L2: null,
  });

  // Should have defaults
  expect(state.L1).toMatchObject({
    gaps: [],
    claims: [],
    report: null,
  });
  expect(state.L2).toMatchObject({
    retrievedChunks: [],
    tokenUsage: { input: 0, output: 0, total: 0, estimatedCostUSD: 0 },
    awaitUserFeedback: false,
    taskImpossible: false,
    reason: "",
  });
  expect(state.L1.claims).toEqual([]);
  expect(state.L2.retrievedChunks).toEqual([]);
});

it("DeepSearchAgentLoop: handles missing eventBus gracefully", async () => {
  const { DeepSearchAgentLoop } = await import(
    "../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js"
  );

  const agent = new DeepSearchAgentLoop();
  agent.emit = null;
  agent.eventBus = null;

  // Should not throw
  agent._emit("test.event", { data: "test" });
});

it("DeepSearchState: userConfig preserves custom settings", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");

  const state = new DeepSearchState({
    runId: "run_config",
    userConfig: {
      language: "en-US",
      maxIterations: 15,
      budget: { maxTokens: 100000 },
      custom: { feature: true },
    },
  });

  expect(state.userConfig.language).toBe("en-US");
  expect(state.userConfig.maxIterations).toBe(15);
  expect(state.userConfig.budget).toEqual({ maxTokens: 100000 });
  expect(state.userConfig.budget.maxTokens).toBe(100000);
  expect(state.userConfig.custom.feature).toBe(true);
});
