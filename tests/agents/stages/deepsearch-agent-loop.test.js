const test = require("node:test");
const assert = require("node:assert/strict");

async function loadModules() {
  const { DeepSearchAgentLoop, AgentCapabilities, AgentDecision, ThinkingMode, StreamingThinkConfig, runDeepSearchAgentLoop, resumeDeepSearchAgentLoop } = await import(
    "../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js"
  );
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");
  return { DeepSearchAgentLoop, AgentCapabilities, AgentDecision, ThinkingMode, StreamingThinkConfig, runDeepSearchAgentLoop, resumeDeepSearchAgentLoop, DeepSearchState };
}

function makeMinimalCompleteState(DeepSearchState, { runId = "test_run", sourceId = "src_1", text = "Test content here" } = {}) {
  const state = new DeepSearchState({
    runId,
    taskGoal: "Test",
    L0: { sources: [{ sourceId, sourceTextNormalized: text }] },
  });
  state.L1.gaps = [];
  state.L1.claims = [{ claimId: "c1", text: "Test claim", evidenceIds: ["e1"] }];
  state.L1.evidenceLedger = [
    {
      evidenceId: "e1",
      sourceId,
      quote: "Test",
      locator: { charStart: 0, charEnd: 4 },
    },
  ];
  state.L1.report = { title: "Test", markdown: "[1] Test", sections: [], citations: [] };
  return state;
}

function makeEventBus() {
  const events = [];
  return {
    events,
    emit: (name, record) => events.push({ name, record }),
    subscribe: () => () => {},
  };
}

test("DeepSearchAgentLoop initializes with correct defaults", async () => {
  const { DeepSearchAgentLoop } = await loadModules();
  const bus = makeEventBus();

  const agentLoop = new DeepSearchAgentLoop({ eventBus: bus });

  assert.equal(agentLoop.actor, "deepsearch");
  assert.equal(agentLoop.stageName, "deepsearch");
  assert.equal(agentLoop.isSubAgent, false);
  assert.equal(agentLoop.parentAgentId, null);
});

test("DeepSearchAgentLoop as SubAgent has correct flags", async () => {
  const { DeepSearchAgentLoop } = await loadModules();
  const bus = makeEventBus();

  const agentLoop = new DeepSearchAgentLoop({
    eventBus: bus,
    isSubAgent: true,
    parentAgentId: "parent_123",
  });

  assert.equal(agentLoop.isSubAgent, true);
  assert.equal(agentLoop.parentAgentId, "parent_123");
});

test("DeepSearchAgentLoop._ensureState creates state from input", async () => {
  const { DeepSearchAgentLoop, DeepSearchState } = await loadModules();
  const bus = makeEventBus();

  const agentLoop = new DeepSearchAgentLoop({ eventBus: bus });

  const input = {
    taskGoal: "Test goal",
    sources: [{ sourceId: "src_1", sourceTextNormalized: "Test content" }],
    userConfig: { maxIterations: 3 },
  };

  const state = agentLoop._ensureState({ runId: "run_123" }, input);

  assert.ok(state instanceof DeepSearchState);
  assert.equal(state.runId, "run_123");
  assert.equal(state.taskGoal, "Test goal");
  assert.equal(state.maxIterations, 3);
  assert.equal(state.L0.sources.length, 1);
});

test("DeepSearchAgentLoop._ensureState preserves existing DeepSearchState", async () => {
  const { DeepSearchAgentLoop, DeepSearchState } = await loadModules();
  const bus = makeEventBus();

  const agentLoop = new DeepSearchAgentLoop({ eventBus: bus });
  const existingState = new DeepSearchState({ runId: "existing_run", taskGoal: "Existing goal" });

  const state = agentLoop._ensureState({}, existingState);

  assert.strictEqual(state, existingState);
  assert.equal(state.runId, "existing_run");
});

test("AgentCapabilities exports correct capability constants", async () => {
  const { AgentCapabilities } = await loadModules();

  assert.ok(AgentCapabilities.RETRIEVE_LOCAL);
  assert.ok(AgentCapabilities.RETRIEVE_EXTERNAL);
  assert.ok(AgentCapabilities.EXTRACT_CLAIMS);
  assert.ok(AgentCapabilities.VALIDATE_SHADOW);
  assert.ok(AgentCapabilities.GENERATE_REPORT);
  assert.ok(AgentCapabilities.COMPRESS_MEMORY);
  assert.ok(AgentCapabilities.FORK_SUBAGENT);
});

test("AgentDecision exports correct decision constants", async () => {
  const { AgentDecision } = await loadModules();

  assert.equal(AgentDecision.CONTINUE, "continue");
  assert.equal(AgentDecision.RETRY, "retry");
  assert.equal(AgentDecision.BACKTRACK, "backtrack");
  assert.equal(AgentDecision.REPLAN, "replan");
  assert.equal(AgentDecision.COMPLETE, "complete");
  assert.equal(AgentDecision.ABORT, "abort");
});

test("DeepSearchAgentLoop._deduplicateClaims removes duplicates", async () => {
  const { DeepSearchAgentLoop } = await loadModules();
  const bus = makeEventBus();

  const agentLoop = new DeepSearchAgentLoop({ eventBus: bus });

  const claims = [
    { claimId: "c1", text: "First claim" },
    { claimId: "c2", text: "Second claim" },
    { claimId: "c3", text: "first claim" }, // duplicate (case-insensitive)
    { claimId: "c4", text: "Third claim" },
  ];

  const deduped = agentLoop._deduplicateClaims(claims);

  assert.equal(deduped.length, 3);
  assert.deepEqual(
    deduped.map((c) => c.claimId),
    ["c1", "c2", "c4"]
  );
});

test("DeepSearchAgentLoop._mergeGaps removes duplicate gaps", async () => {
  const { DeepSearchAgentLoop } = await loadModules();
  const bus = makeEventBus();

  const agentLoop = new DeepSearchAgentLoop({ eventBus: bus });

  const gaps = [
    { gapId: "g1", question: "What is X?" },
    { gapId: "g2", question: "What is Y?" },
    { gapId: "g3", question: "what is x?" }, // duplicate
    { gapId: "g4", question: "What is Z?" },
  ];

  const merged = agentLoop._mergeGaps(gaps);

  assert.equal(merged.length, 3);
  assert.deepEqual(
    merged.map((g) => g.gapId),
    ["g1", "g2", "g4"]
  );
});

test("DeepSearchAgentLoop._review returns COMPLETE when result.completed is true", async () => {
  const { DeepSearchAgentLoop, AgentDecision } = await loadModules();
  const bus = makeEventBus();

  const agentLoop = new DeepSearchAgentLoop({ eventBus: bus });

  const review = await agentLoop._review(
    { action: "complete" },
    { completed: true, reason: "all_done" },
    {},
    {}
  );

  assert.equal(review.decision, AgentDecision.COMPLETE);
  assert.equal(review.reason, "all_done");
});

test("DeepSearchAgentLoop._review returns ABORT when result.aborted is true", async () => {
  const { DeepSearchAgentLoop, AgentDecision } = await loadModules();
  const bus = makeEventBus();

  const agentLoop = new DeepSearchAgentLoop({ eventBus: bus });

  const review = await agentLoop._review(
    { action: "abort" },
    { aborted: true, reason: "user_cancelled" },
    {},
    {}
  );

  assert.equal(review.decision, AgentDecision.ABORT);
  assert.equal(review.reason, "user_cancelled");
});

test("DeepSearchAgentLoop._review returns CONTINUE by default", async () => {
  const { DeepSearchAgentLoop, AgentDecision } = await loadModules();
  const bus = makeEventBus();

  const agentLoop = new DeepSearchAgentLoop({ eventBus: bus });

  const review = await agentLoop._review(
    { action: "retrieve_and_extract" },
    { retrieved: true },
    {},
    {}
  );

  assert.equal(review.decision, AgentDecision.CONTINUE);
});

test("DeepSearchAgentLoop emits events during execution", async () => {
  const { DeepSearchAgentLoop, DeepSearchState } = await loadModules();
  const bus = makeEventBus();

  const agentLoop = new DeepSearchAgentLoop({ eventBus: bus });

  // Create a minimal state that will complete immediately
  const state = new DeepSearchState({
    runId: "test_run",
    taskGoal: "Test",
    L0: { sources: [{ sourceId: "src_1", sourceTextNormalized: "Test content here" }] },
  });
  state.L1.gaps = [];
  // Claims must have evidenceIds that reference existing evidence
  state.L1.claims = [{ claimId: "c1", text: "Test claim", evidenceIds: ["e1"] }];
  state.L1.evidenceLedger = [{
    evidenceId: "e1",
    sourceId: "src_1",
    quote: "Test content",
    locator: { charStart: 0, charEnd: 12 }
  }];
  state.L1.report = { title: "Test", markdown: "Content", sections: [], citations: [] };

  // Override capabilities to avoid actual LLM calls
  agentLoop.capabilities = {
    scanAndIdentifyGaps: async () => ({ scanned: true }),
    retrieveAndExtract: async () => ({ retrieved: true }),
    generateReport: async () => ({ reportGenerated: true }),
  };

  await agentLoop.run({ state }, { runContext: { runId: "test_run" }, eventBus: bus });

  const eventNames = bus.events.map((e) => e.name);
  assert.ok(eventNames.includes("deepsearch.agent.started"));
  assert.ok(eventNames.includes("deepsearch.agent.completed"));
});

test("runDeepSearchAgentLoop convenience function works", async () => {
  const { runDeepSearchAgentLoop, resumeDeepSearchAgentLoop, DeepSearchState } = await loadModules();
  const bus = makeEventBus();

  const state = new DeepSearchState({
    runId: "convenience_test",
    taskGoal: "Test",
    L0: { sources: [{ sourceId: "src_1", sourceTextNormalized: "Test content here" }] },
  });
  state.L1.gaps = [];
  state.L1.claims = [{ claimId: "c1", text: "Test", evidenceIds: ["e1"] }];
  state.L1.evidenceLedger = [{
    evidenceId: "e1",
    sourceId: "src_1",
    quote: "Test content",
    locator: { charStart: 0, charEnd: 12 }
  }];
  state.L1.report = { title: "Test", markdown: "Content", sections: [], citations: [] };

  const result = await runDeepSearchAgentLoop(
    { runId: "convenience_test" },
    { state },
    { eventBus: bus }
  );

  assert.ok(result);
  assert.ok(result.metadata || result.runId);
});

test("春秋蝉: DeepSearchAgentLoop respects maxBacktracks limit", async () => {
  const { DeepSearchAgentLoop } = await loadModules();
  const bus = makeEventBus();

  const agentLoop = new DeepSearchAgentLoop({
    eventBus: bus,
    maxBacktracks: 3,
  });

  assert.equal(agentLoop.maxBacktracks, 3);
  assert.equal(agentLoop._backtrackCount, 0);
});

test("春秋蝉: Default maxBacktracks is 3", async () => {
  const { DeepSearchAgentLoop } = await loadModules();
  const bus = makeEventBus();

  const agentLoop = new DeepSearchAgentLoop({ eventBus: bus });

  assert.equal(agentLoop.maxBacktracks, 3);
});

test("春秋蝉: Custom maxBacktracks can be set", async () => {
  const { DeepSearchAgentLoop } = await loadModules();
  const bus = makeEventBus();

  const agentLoop = new DeepSearchAgentLoop({
    eventBus: bus,
    maxBacktracks: 5,
  });

  assert.equal(agentLoop.maxBacktracks, 5);
});

test("交错思考: ThinkingMode exports correct constants", async () => {
  const { ThinkingMode } = await import(
    "../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js"
  );

  assert.equal(ThinkingMode.RULES, "rules");
  assert.equal(ThinkingMode.LLM, "llm");
  assert.equal(ThinkingMode.HYBRID, "hybrid");
});

test("交错思考: Default thinkingMode is RULES", async () => {
  const { DeepSearchAgentLoop, ThinkingMode } = await loadModules();
  const bus = makeEventBus();

  const agentLoop = new DeepSearchAgentLoop({ eventBus: bus });

  assert.equal(agentLoop.thinkingMode, ThinkingMode.RULES);
  assert.deepEqual(agentLoop._thinkingHistory, []);
});

test("交错思考: Custom thinkingMode can be set", async () => {
  const { DeepSearchAgentLoop, ThinkingMode } = await loadModules();
  const bus = makeEventBus();

  const agentLoop = new DeepSearchAgentLoop({
    eventBus: bus,
    thinkingMode: ThinkingMode.HYBRID,
  });

  assert.equal(agentLoop.thinkingMode, ThinkingMode.HYBRID);
});

test("交错思考: _think method exists and works in RULES mode", async () => {
  const { DeepSearchAgentLoop, ThinkingMode } = await loadModules();
  const bus = makeEventBus();

  const agentLoop = new DeepSearchAgentLoop({
    eventBus: bus,
    thinkingMode: ThinkingMode.RULES,
  });

  const observation = {
    sourceCount: 1,
    totalChars: 1000,
    estimatedTokens: 500,
    isLargeDoc: false,
    totalTodos: 0,
    openTodoCount: 0,
    completedTodoCount: 0,
    blockedTodoCount: 0,
    claimCount: 1,
    evidenceCount: 1,
    hasReport: true,
    iteration: 0,
    maxIterations: 5,
  };

  const decision = await agentLoop._think(observation, {}, {}, {});

  assert.equal(decision.action, "complete");
  assert.equal(decision.reason, "all_todos_resolved");
});

test("流式思考: StreamingThinkConfig exports correct constants", async () => {
  const { StreamingThinkConfig } = await import(
    "../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js"
  );

  assert.equal(StreamingThinkConfig.DEFAULT_CHUNK_SIZE, 20);
  assert.equal(StreamingThinkConfig.DEFAULT_CHUNK_DELAY, 50);
  assert.equal(StreamingThinkConfig.THOUGHT_DELTA_EVENT, "deepsearch.agent.thought.delta");
  assert.equal(StreamingThinkConfig.THOUGHT_COMPLETE_EVENT, "deepsearch.agent.thought.complete");
});

test("流式思考: Default streamingThink is false", async () => {
  const { DeepSearchAgentLoop } = await loadModules();
  const bus = makeEventBus();

  const agentLoop = new DeepSearchAgentLoop({ eventBus: bus });

  assert.equal(agentLoop.streamingThink, false);
  assert.equal(agentLoop.onThoughtDelta, null);
});

test("流式思考: onThoughtDelta callback can be set", async () => {
  const { DeepSearchAgentLoop } = await loadModules();
  const bus = makeEventBus();
  const deltas = [];

  const agentLoop = new DeepSearchAgentLoop({
    eventBus: bus,
    streamingThink: true,
    onThoughtDelta: (data) => deltas.push(data),
  });

  assert.equal(agentLoop.streamingThink, true);
  assert.equal(typeof agentLoop.onThoughtDelta, "function");
});

test("流式思考: _emitThoughtStream emits delta events", async () => {
  const { DeepSearchAgentLoop, StreamingThinkConfig } = await loadModules();
  const bus = makeEventBus();
  const deltas = [];

  const agentLoop = new DeepSearchAgentLoop({
    eventBus: bus,
    streamingThink: true,
    onThoughtDelta: (data) => deltas.push(data),
  });

  // 测试流式发出
  await agentLoop._emitThoughtStream({ runId: "test" }, "Hello World! Hello World! Hello");

  // 验证回调被调用
  assert.ok(deltas.length > 0);
  assert.ok(deltas[deltas.length - 1].done);

  // 验证事件被发出
  const deltaEvents = bus.events.filter(e => e.name === StreamingThinkConfig.THOUGHT_DELTA_EVENT);
  assert.ok(deltaEvents.length > 0);
});

test("DeepSearchAgentLoop 状态机: run() records expected status transitions", async () => {
  const { DeepSearchAgentLoop, DeepSearchState } = await loadModules();
  const { AgentLoopStatus } = await import("../../../js/agents/stages/deepsearch/constants.js");
  const bus = makeEventBus();

  const agentLoop = new DeepSearchAgentLoop({ eventBus: bus });
  const state = makeMinimalCompleteState(DeepSearchState, { runId: "flow_run" });

  await agentLoop.run({ state }, { runContext: { runId: "flow_run" }, eventBus: bus });

  assert.deepEqual(
    agentLoop.statusHistory.map((h) => h.to),
    [
      AgentLoopStatus.RUNNING,
      AgentLoopStatus.OBSERVING,
      AgentLoopStatus.THINKING,
      AgentLoopStatus.EXECUTING,
      AgentLoopStatus.REVIEWING,
      AgentLoopStatus.COMPLETED,
    ]
  );

  const executing = agentLoop.statusHistory.find((h) => h.to === AgentLoopStatus.EXECUTING);
  assert.ok(executing);
  assert.ok(typeof executing.checkpointId === "string");
  assert.ok(executing.checkpointId.includes(":"));

  const checkpoints = await agentLoop.archive.listCheckpoints("flow_run");
  assert.ok(checkpoints.length >= 1);
});

test("DeepSearchAgentLoop pause(): throws StagePausedError and saves checkpoint", async () => {
  const { DeepSearchAgentLoop, DeepSearchState } = await loadModules();
  const { AgentLoopStatus } = await import("../../../js/agents/stages/deepsearch/constants.js");
  const { StagePausedError } = await import("../../../js/agents/runtime/stage-errors.js");
  const bus = makeEventBus();

  const agentLoop = new DeepSearchAgentLoop({ eventBus: bus });
  const state = makeMinimalCompleteState(DeepSearchState, { runId: "pause_run" });

  agentLoop.pause("manual_pause");
  assert.equal(agentLoop.isPaused, true);

  let pausedError;
  await assert.rejects(
    () => agentLoop.run({ state }, { runContext: { runId: "pause_run" }, eventBus: bus }),
    (err) => {
      pausedError = err;
      assert.ok(err instanceof StagePausedError);
      assert.ok(typeof err.checkpointId === "string" && err.checkpointId.includes(":"));
      assert.equal(err.reason, "manual_pause");
      assert.ok(typeof err.timestamp === "string" && err.timestamp);
      return true;
    }
  );

  assert.equal(agentLoop.loopStatus, AgentLoopStatus.PAUSED);
  assert.ok(bus.events.some((e) => e.name === "deepsearch.agent.paused"));

  const restored = await agentLoop.archive.restore(pausedError.checkpointId);
  assert.ok(restored);
  assert.ok(restored.nodeStates);
  assert.deepEqual(
    {
      type: restored.metadata?.type,
      reason: restored.metadata?.reason,
      runId: restored.metadata?.runId,
    },
    { type: "pause", reason: "manual_pause", runId: "pause_run" }
  );
});

test("DeepSearchAgentLoop isPaused getter reflects pause() state", async () => {
  const { DeepSearchAgentLoop } = await loadModules();
  const bus = makeEventBus();

  const agentLoop = new DeepSearchAgentLoop({ eventBus: bus });
  assert.equal(agentLoop.isPaused, false);
  agentLoop.pause();
  assert.equal(agentLoop.isPaused, true);
});

test("DeepSearchAgentLoop pre-action checkpoint stores serializable metadata", async () => {
  const { DeepSearchAgentLoop, DeepSearchState } = await loadModules();
  const { AgentLoopStatus } = await import("../../../js/agents/stages/deepsearch/constants.js");
  const bus = makeEventBus();

  const agentLoop = new DeepSearchAgentLoop({ eventBus: bus });
  const state = makeMinimalCompleteState(DeepSearchState, { runId: "pre_action_meta" });

  await agentLoop.run({ state }, { runContext: { runId: "pre_action_meta" }, eventBus: bus });

  const executing = agentLoop.statusHistory.find((h) => h.to === AgentLoopStatus.EXECUTING);
  assert.ok(executing);
  assert.ok(typeof executing.checkpointId === "string" && executing.checkpointId.includes(":"));

  const restored = await agentLoop.archive.restore(executing.checkpointId);
  assert.ok(restored);
  assert.equal(restored.schemaVersion, "1.0");
  assert.ok(restored.nodeStates);
  assert.doesNotThrow(() => JSON.stringify(restored.nodeStates));
  assert.deepEqual(
    { type: restored.metadata?.type, runId: restored.metadata?.runId },
    { type: "pre-action", runId: "pre_action_meta" }
  );
});

test("DeepSearchAgentLoop runtime pause: StagePausedError uses pausedReason and updates runtime cursor", async () => {
  const { DeepSearchAgentLoop, DeepSearchState } = await loadModules();
  const { AgentLoopStatus } = await import("../../../js/agents/stages/deepsearch/constants.js");
  const { StagePausedError } = await import("../../../js/agents/runtime/stage-errors.js");
  const { setRuntimeState } = await import("../../../js/agents/runtime/loop-runtime-state.js");
  const bus = makeEventBus();

  const agentLoop = new DeepSearchAgentLoop({ eventBus: bus });
  const state = makeMinimalCompleteState(DeepSearchState, { runId: "runtime_pause_run" });
  const controller = new AbortController();

  const runtime = setRuntimeState(controller.signal, { status: "paused", pausedReason: "runtime_pause" });

  let pausedError;
  await assert.rejects(
    () =>
      agentLoop.run(
        { state },
        { signal: controller.signal, runContext: { runId: "runtime_pause_run" }, eventBus: bus }
      ),
    (err) => {
      pausedError = err;
      assert.ok(err instanceof StagePausedError);
      assert.equal(err.reason, "runtime_pause");
      assert.ok(typeof err.checkpointId === "string" && err.checkpointId.includes(":"));
      return true;
    }
  );

  assert.equal(agentLoop.loopStatus, AgentLoopStatus.PAUSED);
  assert.equal(runtime.lastCheckpointId, pausedError.checkpointId);
});

test("DeepSearchState.toJSON() is JSON-safe and checkpoints are references only", async () => {
  const { DeepSearchState } = await loadModules();

  const state = new DeepSearchState({ runId: "json_safe", taskGoal: "Goal" });
  state.L2.scratchpad.fn = () => {};
  state.L2.scratchpad.sym = Symbol("x");
  state.L2.scratchpad.weakMap = new WeakMap();
  state.L2.scratchpad.weakSet = new WeakSet();
  state.L2.scratchpad.map = new Map([
    ["a", 1],
    ["b", 2],
  ]);
  state.L2.scratchpad.set = new Set(["x", "y"]);
  state.saveCheckpoint({ checkpointId: "cp_1" });

  const payload = state.toJSON();
  assert.doesNotThrow(() => JSON.stringify(payload));

  assert.ok(Array.isArray(payload.checkpoints));
  assert.equal(payload.checkpoints[0].checkpointId, "cp_1");
  assert.equal(payload.checkpoints[0].stateSnapshot, undefined);
  assert.equal(payload.L2.scratchpad.fn, undefined);
  assert.equal(payload.L2.scratchpad.sym, undefined);
  assert.equal(payload.L2.scratchpad.weakMap, undefined);
  assert.equal(payload.L2.scratchpad.weakSet, undefined);
  assert.deepEqual(payload.L2.scratchpad.map, { a: 1, b: 2 });
  assert.deepEqual(payload.L2.scratchpad.set, ["x", "y"]);
});

test("DeepSearchAgentLoop._think covers key RULES branches", async () => {
  const { DeepSearchAgentLoop, ThinkingMode } = await loadModules();
  const bus = makeEventBus();
  const agentLoop = new DeepSearchAgentLoop({ eventBus: bus, thinkingMode: ThinkingMode.RULES });

  const base = {
    sourceCount: 1,
    totalChars: 100,
    estimatedTokens: 50,
    isLargeDoc: false,
    totalTodos: 1,
    openTodoCount: 0,
    completedTodoCount: 0,
    blockedTodoCount: 0,
    claimCount: 0,
    evidenceCount: 0,
    hasReport: false,
    iteration: 0,
    maxIterations: 5,
  };

  const aborted = await agentLoop._think({ ...base }, {}, {}, { aborted: true, isSubAgent: false });
  assert.equal(aborted.action, "abort");

  const budgetExhausted = await agentLoop._think({ ...base }, {}, {}, { budgetExhausted: true, isSubAgent: false });
  assert.equal(budgetExhausted.action, "complete");
  assert.equal(budgetExhausted.reason, "budget_exhausted");

  const fork = await agentLoop._think({ ...base, isLargeDoc: true, iteration: 0 }, {}, {}, { isSubAgent: false });
  assert.equal(fork.action, "fork_subagents");

  const maxIt = await agentLoop._think({ ...base, iteration: 5, maxIterations: 5 }, {}, {}, { isSubAgent: false });
  assert.equal(maxIt.reason, "max_iterations");

  const retrieve = await agentLoop._think({ ...base, openTodoCount: 2, totalTodos: 2 }, {}, {}, { isSubAgent: false });
  assert.equal(retrieve.action, "retrieve_and_extract");

  const write = await agentLoop._think({ ...base, claimCount: 1, evidenceCount: 1 }, {}, {}, { isSubAgent: false });
  assert.equal(write.action, "generate_report");

  const scan = await agentLoop._think({ ...base, totalTodos: 0 }, {}, {}, { isSubAgent: false });
  assert.equal(scan.action, "scan_and_identify_gaps");

  const noop = await agentLoop._think({ ...base, totalTodos: 1 }, {}, {}, { isSubAgent: false });
  assert.equal(noop.action, "complete");
  assert.equal(noop.reason, "no_action_needed");
});

test("DeepSearchAgentLoop state machine rejects invalid transitions", async () => {
  const { DeepSearchAgentLoop } = await loadModules();
  const { AgentLoopStatus } = await import("../../../js/agents/stages/deepsearch/constants.js");

  const agentLoop = new DeepSearchAgentLoop({ eventBus: makeEventBus() });

  assert.throws(
    () => agentLoop._applyTransition(AgentLoopStatus.THINKING),
    (err) => err && err.code === "INVALID_STATE_TRANSITION"
  );

  await assert.rejects(
    () => agentLoop._transitionTo(AgentLoopStatus.THINKING),
    (err) => err && err.code === "INVALID_STATE_TRANSITION"
  );
});

test("DeepSearchAgentLoop._think supports HYBRID mode (use LLM + fallback)", async () => {
  const { DeepSearchAgentLoop, ThinkingMode } = await loadModules();
  const bus = makeEventBus();

  const agentLoop = new DeepSearchAgentLoop({ eventBus: bus, thinkingMode: ThinkingMode.HYBRID });
  const logger = { info: () => {}, warn: () => {} };
  const observation = {
    openTodoCount: 1,
    claimCount: 1,
    hasReport: false,
    iteration: 0,
    maxIterations: 5,
  };

  agentLoop._thinkWithLLM = async () => ({ action: "complete", reason: "llm", thought: "t" });
  const decision = await agentLoop._think(observation, {}, {}, { logger, isSubAgent: false });
  assert.equal(decision.action, "complete");

  agentLoop._thinkWithLLM = async () => {
    throw new Error("boom");
  };
  const fallback = await agentLoop._think(observation, {}, {}, { logger, isSubAgent: false });
  assert.equal(fallback.action, "retrieve_and_extract");
});

test("DeepSearchAgentLoop._thinkWithLLM uses modelRouter and emits thought events", async () => {
  const { DeepSearchAgentLoop, DeepSearchState } = await loadModules();
  const bus = makeEventBus();
  const agentLoop = new DeepSearchAgentLoop({ eventBus: bus, streamingThink: true });

  const state = new DeepSearchState({ runId: "llm_think" });
  const observation = {
    sourceCount: 1,
    claimCount: 0,
    evidenceCount: 0,
    openTodoCount: 0,
    completedTodoCount: 0,
    blockedTodoCount: 0,
    hasReport: false,
    isLargeDoc: false,
    iteration: 0,
    maxIterations: 5,
  };

  const modelRouter = {
    call: async () => ({
      content: JSON.stringify({ thought: "A".repeat(25), action: "complete", reason: "ok" }),
    }),
  };

  const decision = await agentLoop._thinkWithLLM(observation, state, { modelRouter }, { logger: { warn: () => {} } });
  assert.equal(decision.action, "complete");
  assert.ok(agentLoop._thinkingHistory.length >= 1);

  const eventNames = bus.events.map((e) => e.name);
  assert.ok(eventNames.includes("deepsearch.agent.thought.complete"));
  assert.ok(eventNames.includes("deepsearch.agent.thought.delta"));
});

test("DeepSearchAgentLoop._thinkWithLLM falls back to rules when model call fails", async () => {
  const { DeepSearchAgentLoop, DeepSearchState } = await loadModules();
  const bus = makeEventBus();
  const agentLoop = new DeepSearchAgentLoop({ eventBus: bus });

  const state = new DeepSearchState({ runId: "llm_fallback" });
  const observation = {
    sourceCount: 1,
    claimCount: 1,
    evidenceCount: 1,
    openTodoCount: 0,
    completedTodoCount: 0,
    blockedTodoCount: 0,
    totalTodos: 1,
    hasReport: false,
    isLargeDoc: false,
    iteration: 0,
    maxIterations: 5,
  };

  const modelRouter = {
    call: async () => ({ content: "not-json" }),
  };

  const decision = await agentLoop._thinkWithLLM(observation, state, { modelRouter }, { logger: { warn: () => {} } });
  assert.equal(decision.action, "generate_report");
});

test("DeepSearchAgentLoop._execute covers actions (capabilities + defaults)", async () => {
  const { DeepSearchAgentLoop, DeepSearchState } = await loadModules();
  const bus = makeEventBus();
  const agentLoop = new DeepSearchAgentLoop({ eventBus: bus });
  const logger = { info: () => {}, warn: () => {}, error: () => {} };
  const state = new DeepSearchState({ runId: "execute_run" });

  agentLoop.capabilities.scanAndIdentifyGaps = async () => ({ scanned: true });
  const scanned = await agentLoop._execute({ action: "scan_and_identify_gaps" }, state, {}, { logger, runContext: {} });
  assert.equal(scanned.scanned, true);

  state.iteration = 0;
  agentLoop.capabilities.retrieveAndExtract = async () => ({ retrieved: true });
  const retrieved = await agentLoop._execute({ action: "retrieve_and_extract" }, state, {}, { logger, runContext: {} });
  assert.equal(retrieved.retrieved, true);
  assert.equal(state.iteration, 1);

  agentLoop.capabilities.generateReport = async () => ({ reportGenerated: true });
  const report = await agentLoop._execute({ action: "generate_report" }, state, {}, { logger, runContext: {} });
  assert.equal(report.reportGenerated, true);

  const forked = await agentLoop._execute(
    { action: "fork_subagents" },
    new DeepSearchState({ runId: "fork_run", L0: { sources: [{ sourceId: "s1", sourceTextNormalized: "Test" }] } }),
    {},
    { logger, runContext: {} }
  );
  assert.equal(forked.forked, false);
  assert.equal(forked.reason, "single_source");

  const completed = await agentLoop._execute({ action: "complete", reason: "done" }, state, {}, { logger, runContext: {} });
  assert.equal(completed.completed, true);

  const aborted = await agentLoop._execute({ action: "abort", reason: "stop" }, state, {}, { logger, runContext: {} });
  assert.equal(aborted.aborted, true);

  const unknown = await agentLoop._execute({ action: "???" }, state, {}, { logger, runContext: {} });
  assert.equal(unknown.completed, true);
  assert.equal(unknown.reason, "unknown_action");
});

test("DeepSearchAgentLoop._executeForkSubAgents runs subagents and merges results", async () => {
  const { DeepSearchAgentLoop, DeepSearchState } = await loadModules();
  const bus = makeEventBus();
  const agentLoop = new DeepSearchAgentLoop({ eventBus: bus });

  agentLoop.capabilities.scanAndIdentifyGaps = async (state) => {
    const source = Array.isArray(state?.L0?.sources) ? state.L0.sources[0] : null;
    const sourceId = source?.sourceId || "src";
    const text = typeof source?.sourceTextNormalized === "string" ? source.sourceTextNormalized : "Test content";

    state.L1.gaps = [{ gapId: `g_${sourceId}`, question: `Q_${sourceId}`, status: "filled" }];
    state.L1.claims = [{ claimId: `c_${sourceId}`, text: `Claim ${sourceId}`, evidenceIds: [`e_${sourceId}`] }];
    state.L1.evidenceLedger = [
      {
        evidenceId: `e_${sourceId}`,
        sourceId,
        quote: text.slice(0, 4),
        locator: { charStart: 0, charEnd: 4 },
      },
    ];
    state.L1.report = { title: "Sub", markdown: "ok", sections: [], citations: [] };
    return { completed: true, reason: "sub_done" };
  };

  const state = new DeepSearchState({
    runId: "lead",
    taskGoal: "Lead",
    L0: {
      sources: [
        { sourceId: "s1", sourceTextNormalized: "Test content 1" },
        { sourceId: "s2", sourceTextNormalized: "Test content 2" },
      ],
    },
  });

  const logger = { info: () => {}, warn: () => {} };
  const result = await agentLoop._executeForkSubAgents(state, {}, { logger, runContext: {} });
  assert.equal(result.forked, true);
  assert.equal(result.subAgentCount, 2);
  assert.ok(Array.isArray(state.L1.claims));
  assert.ok(state.L1.claims.length >= 2);
  assert.ok(Array.isArray(state.L1.evidenceLedger));
  assert.ok(state.L1.evidenceLedger.length >= 2);
});

test("DeepSearchAgentLoop._mergeSubAgentResults handles no-success scenario", async () => {
  const { DeepSearchAgentLoop, DeepSearchState } = await loadModules();
  const agentLoop = new DeepSearchAgentLoop({ eventBus: makeEventBus() });

  const state = new DeepSearchState({ runId: "merge_none" });
  const logger = { info: () => {}, warn: () => {} };

  await agentLoop._mergeSubAgentResults(state, [{ success: false, error: "boom" }], {}, { logger });
  assert.ok(Array.isArray(state.L1.claims));
});

test("DeepSearchAgentLoop._mergeSubAgentResults remaps ids and deduplicates evidence/claims", async () => {
  const { DeepSearchAgentLoop, DeepSearchState } = await loadModules();
  const agentLoop = new DeepSearchAgentLoop({ eventBus: makeEventBus() });
  const state = new DeepSearchState({ runId: "merge_ids" });
  const logger = { info: () => {}, warn: () => {} };

  const subAgentResults = [
    {
      success: true,
      index: 0,
      result: {
        claims: [
          { claimId: "c_1", text: "Same claim", evidenceIds: ["e_1"] },
          { claimId: "c_2", text: "Unique claim A", evidenceIds: ["e_2"] },
        ],
        evidenceLedger: [
          { evidenceId: "e_1", sourceId: "s1", quote: "Alpha", locator: { charStart: 0, charEnd: 5 } },
          { evidenceId: "e_2", sourceId: "s1", quote: "Beta", locator: { charStart: 6, charEnd: 10 } },
        ],
        gaps: [],
      },
    },
    {
      success: true,
      index: 1,
      result: {
        claims: [
          { claimId: "c_1", text: "Same claim", evidenceIds: ["e_1"] },
          { claimId: "c_3", text: "Unique claim B", evidenceIds: ["e_3"] },
        ],
        evidenceLedger: [
          { evidenceId: "e_1", sourceId: "s1", quote: "Alpha", locator: { charStart: 0, charEnd: 5 } },
          { evidenceId: "e_3", sourceId: "s2", quote: "Gamma", locator: { charStart: 0, charEnd: 5 } },
        ],
        gaps: [],
      },
    },
  ];

  await agentLoop._mergeSubAgentResults(state, subAgentResults, {}, { logger });

  assert.equal(state.L1.evidenceLedger.length, 3);
  assert.equal(state.L1.claims.length, 3);
  assert.equal(state.L1.evidenceLedger.filter((e) => e.quote === "Alpha").length, 1);
  assert.equal(state.L1.claims.filter((c) => c.text === "Same claim").length, 1);

  const evidenceIds = state.L1.evidenceLedger.map((e) => e.evidenceId);
  assert.equal(new Set(evidenceIds).size, evidenceIds.length);
  assert.ok(evidenceIds.every((id) => id.startsWith("sub")));

  const claimIds = state.L1.claims.map((c) => c.claimId);
  assert.ok(claimIds.every((id) => id.startsWith("sub")));

  const evidenceIdSet = new Set(evidenceIds);
  for (const c of state.L1.claims) {
    for (const eid of Array.isArray(c?.evidenceIds) ? c.evidenceIds : []) {
      assert.ok(evidenceIdSet.has(eid));
    }
  }
});

test("DeepSearchAgentLoop._review covers rules/shadow/custom branches", async () => {
  const { DeepSearchAgentLoop, AgentDecision } = await loadModules();
  const bus = makeEventBus();

  const agentLoop = new DeepSearchAgentLoop({
    eventBus: bus,
    customRules: {
      "deepsearch.scan_and_identify_gaps": [
        {
          check: () => false,
          severity: "error",
          message: "bad",
        },
      ],
    },
  });

  const ruleFail = await agentLoop._review({ action: "scan_and_identify_gaps" }, {}, {}, {});
  assert.equal(ruleFail.decision, AgentDecision.RETRY);
  assert.equal(ruleFail.layer, "rules");

  agentLoop._shadowAgent = {
    validateBatch: async () => [
      { valid: false, skipped: false },
      { valid: false, skipped: false },
    ],
  };
  const shadowRetry = await agentLoop._review(
    { action: "retrieve_and_extract" },
    { claims: [{ claimId: "c" }] },
    { L1: { evidenceLedger: [{ evidenceId: "e" }] }, iteration: 0 },
    {}
  );
  assert.equal(shadowRetry.decision, AgentDecision.RETRY);
  assert.equal(shadowRetry.layer, "shadow");

  agentLoop.capabilities.validateRules = async () => ({ pass: false, severity: "fatal", reason: "fatal" });
  const customAbort = await agentLoop._review(
    { action: "retrieve_and_extract" },
    { retrieved: true },
    { L1: { evidenceLedger: [] }, iteration: 0 },
    {}
  );
  assert.equal(customAbort.decision, AgentDecision.ABORT);
  assert.equal(customAbort.layer, "custom");
});

test("DeepSearchAgentLoop run(): covers BACKTRACK and ABORT error paths", async () => {
  const { DeepSearchAgentLoop, DeepSearchState, AgentDecision } = await loadModules();
  const { AgentLoopStatus } = await import("../../../js/agents/stages/deepsearch/constants.js");
  const bus = makeEventBus();

  const state = makeMinimalCompleteState(DeepSearchState, { runId: "backtrack_limit" });
  const loop = new DeepSearchAgentLoop({ eventBus: bus, maxBacktracks: 0 });

  loop._think = async () => ({ action: "complete", reason: "noop" });
  loop._review = async () => ({ decision: AgentDecision.BACKTRACK });

  await loop.run({ state }, { runContext: { runId: "backtrack_limit" }, eventBus: bus });
  assert.equal(loop.loopStatus, AgentLoopStatus.COMPLETED);

  const abortState = makeMinimalCompleteState(DeepSearchState, { runId: "abort_run" });
  const abortLoop = new DeepSearchAgentLoop({ eventBus: bus });
  abortLoop._think = async () => ({ action: "complete", reason: "noop" });
  abortLoop._review = async () => ({ decision: AgentDecision.ABORT, reason: "abort_reason" });

  await assert.rejects(
    () => abortLoop.run({ state: abortState }, { runContext: { runId: "abort_run" }, eventBus: bus }),
    (err) => err && String(err.message).includes("abort_reason")
  );
  assert.equal(abortLoop.loopStatus, AgentLoopStatus.ABORTED);
});

test("DeepSearchAgentLoop run(): covers BACKTRACK restore path", async () => {
  const { DeepSearchAgentLoop, DeepSearchState, AgentDecision } = await loadModules();
  const { AgentLoopStatus } = await import("../../../js/agents/stages/deepsearch/constants.js");
  const bus = makeEventBus();

  const state = makeMinimalCompleteState(DeepSearchState, { runId: "backtrack_restore" });
  const loop = new DeepSearchAgentLoop({ eventBus: bus, maxBacktracks: 2 });

  let calls = 0;
  loop._think = async () => ({ action: "complete", reason: "noop" });
  loop._review = async (_decision, _result, stateRef) => {
    calls += 1;
    if (calls === 1) {
      return {
        decision: AgentDecision.BACKTRACK,
        checkpointId: stateRef?.checkpoints?.[stateRef.checkpoints.length - 1]?.checkpointId,
      };
    }
    return { decision: AgentDecision.COMPLETE, reason: "done" };
  };

  const pkg = await loop.run(
    { state },
    { runContext: { runId: "backtrack_restore" }, eventBus: bus }
  );
  assert.ok(pkg);
  assert.equal(loop.loopStatus, AgentLoopStatus.COMPLETED);
  assert.equal(loop._backtrackCount, 1);
});

test("DeepSearchAgentLoop._compressMemory covers default + archive error + sharedContext", async () => {
  const { DeepSearchAgentLoop, DeepSearchState } = await loadModules();
  const bus = makeEventBus();
  const agentLoop = new DeepSearchAgentLoop({ eventBus: bus });
  const state = new DeepSearchState({ runId: "compress" });
  state.L1.claims = [{ claimId: "c", text: "t", evidenceIds: ["e"] }];
  state.L1.gaps = [{ gapId: "g", status: "open" }];
  state.L2.retrievedChunks = Array.from({ length: 101 }, (_, i) => ({ chunkId: `c${i}` }));

  agentLoop.sharedContext = { setSummary: () => {} };
  await agentLoop._compressMemory(state, {});
  assert.ok(state.L1.condensedMemory);
  assert.equal(state.L2.retrievedChunks.length, 50);

  agentLoop.archive = { save: async () => {
    throw new Error("nope");
  } };
  await agentLoop._compressMemory(state, {});

  agentLoop.capabilities.compressMemory = async () => ({ summary: { hello: "world" } });
  await agentLoop._compressMemory(state, {});
  assert.deepEqual(state.L1.condensedMemory, { hello: "world" });
});

test("DeepSearchAgentLoop pause(): defaults reason to user_requested when omitted", async () => {
  const { DeepSearchAgentLoop, DeepSearchState } = await loadModules();
  const { StagePausedError } = await import("../../../js/agents/runtime/stage-errors.js");
  const bus = makeEventBus();

  const agentLoop = new DeepSearchAgentLoop({ eventBus: bus });
  const state = makeMinimalCompleteState(DeepSearchState, { runId: "pause_default" });

  agentLoop.pause();

  await assert.rejects(
    () => agentLoop.run({ state }, { runContext: { runId: "pause_default" }, eventBus: bus }),
    (err) => {
      assert.ok(err instanceof StagePausedError);
      assert.equal(err.reason, "user_requested");
      return true;
    }
  );
});

test("DeepSearchAgentLoop pauses when awaitUserFeedback flag is set", async () => {
  const { DeepSearchAgentLoop, DeepSearchState } = await loadModules();
  const { StagePausedError } = await import("../../../js/agents/runtime/stage-errors.js");
  const bus = makeEventBus();

  const agentLoop = new DeepSearchAgentLoop({ eventBus: bus });
  const state = makeMinimalCompleteState(DeepSearchState, { runId: "pause_l2" });
  state.L2.awaitUserFeedback = true;
  state.L2.reason = "need user input";

  await assert.rejects(
    () => agentLoop.run({ state }, { runContext: { runId: "pause_l2" }, eventBus: bus }),
    (err) => {
      assert.ok(err instanceof StagePausedError);
      assert.equal(err.reason, "need user input");
      return true;
    }
  );
});

test("DeepSearchAgentLoop completes when taskImpossible flag is set", async () => {
  const { DeepSearchAgentLoop, DeepSearchState } = await loadModules();
  const bus = makeEventBus();

  const agentLoop = new DeepSearchAgentLoop({ eventBus: bus });
  const state = new DeepSearchState({
    runId: "task_impossible",
    taskGoal: "Test",
    L0: { sources: [{ sourceId: "s1", sourceTextNormalized: "Test content" }] },
  });
  state.todos = [{ todoId: "todo_1", text: "Do thing", status: "completed" }];
  state.L2.taskImpossible = true;
  state.L2.reason = "No data available";

  const pkg = await agentLoop.run({ state }, { runContext: { runId: "task_impossible" }, eventBus: bus });
  assert.ok(pkg);
  assert.equal(pkg.completionReason, "No data available");
  assert.equal(pkg.todoCompletionStats?.total, 1);
});

test("DeepSearchAgentLoop._saveCheckpoint ignores state.saveCheckpoint errors", async () => {
  const { DeepSearchAgentLoop } = await loadModules();
  const bus = makeEventBus();
  const agentLoop = new DeepSearchAgentLoop({ eventBus: bus });

  const state = {
    runId: "cp_run",
    iteration: 0,
    toJSON: () => ({ ok: true }),
    saveCheckpoint: () => {
      throw new Error("boom");
    },
  };

  const checkpointId = await agentLoop._saveCheckpoint(state, {
    runId: "cp_run",
    iteration: 0,
    kind: "pre_action",
  });

  assert.ok(typeof checkpointId === "string" && checkpointId.includes(":"));
});

test("DeepSearchAgentLoop directAnalysis: runs direct mode and skips main loop", async () => {
  const { DeepSearchAgentLoop, DeepSearchState } = await loadModules();
  const { AgentLoopStatus } = await import("../../../js/agents/stages/deepsearch/constants.js");
  const bus = makeEventBus();

  const agentLoop = new DeepSearchAgentLoop({ eventBus: bus });
  const state = new DeepSearchState({
    runId: "direct_mode",
    taskGoal: "Direct",
    userConfig: { directAnalysis: { enabled: true } },
    L0: { sources: [{ sourceId: "src_1", sourceTextNormalized: "Test content here" }] },
  });

  const modelRouter = {
    call: async () => ({
      content: JSON.stringify({
        gaps: [{ gapId: "gap_1", type: "definition", question: "What is it?", status: "filled" }],
        evidenceLedger: [{ evidenceId: "evi_1", quote: "Test", charStart: 0, charEnd: 4 }],
        claims: [{ claimId: "clm_1", text: "Test claim", importance: "core", gapIds: ["gap_1"], evidenceIds: ["evi_1"] }],
        report: { title: "Report", summary: "Summary", sections: [] },
      }),
    }),
  };

  const pkg = await agentLoop.run(
    { state },
    {
      runContext: { runId: "direct_mode", mode: "deepsearch", constraints: {} },
      eventBus: bus,
      modelRouter,
    }
  );

  assert.equal(pkg.mode, "deepsearch");
  assert.deepEqual(agentLoop.statusHistory.map((h) => h.to), [AgentLoopStatus.RUNNING, AgentLoopStatus.COMPLETED]);
  assert.ok(bus.events.some((e) => e.name === "deepsearch.agent.completed" && e.record?.payload?.mode === "direct"));
});

test("DeepSearchAgentLoop backtrack: swallows missing checkpoint restore errors", async () => {
  const { DeepSearchAgentLoop, DeepSearchState, AgentDecision } = await loadModules();
  const bus = makeEventBus();

  const state = makeMinimalCompleteState(DeepSearchState, { runId: "backtrack_fail" });
  const loop = new DeepSearchAgentLoop({ eventBus: bus, maxBacktracks: 2 });

  let calls = 0;
  loop._think = async () => ({ action: "complete", reason: "noop" });
  loop._review = async () => {
    calls += 1;
    if (calls === 1) return { decision: AgentDecision.BACKTRACK, checkpointId: "missing_checkpoint" };
    return { decision: AgentDecision.COMPLETE, reason: "done" };
  };

  await loop.run({ state }, { runContext: { runId: "backtrack_fail" }, eventBus: bus });
  assert.equal(loop._backtrackCount, 0);
});

test("DeepSearchAgentLoop run(): triggers _compressMemory when loopCount % 3 === 0", async () => {
  const { DeepSearchAgentLoop, DeepSearchState, AgentDecision } = await loadModules();
  const bus = makeEventBus();

  const state = makeMinimalCompleteState(DeepSearchState, { runId: "compress_in_loop" });
  const loop = new DeepSearchAgentLoop({ eventBus: bus });

  const originalCompress = loop._compressMemory.bind(loop);
  let compressCalls = 0;
  loop._compressMemory = async (...args) => {
    compressCalls += 1;
    return originalCompress(...args);
  };

  let reviewCalls = 0;
  loop._think = async () => ({ action: "complete", reason: "noop" });
  loop._review = async () => {
    reviewCalls += 1;
    if (reviewCalls <= 3) return { decision: AgentDecision.CONTINUE };
    return { decision: AgentDecision.COMPLETE, reason: "done" };
  };

  await loop.run({ state }, { runContext: { runId: "compress_in_loop" }, eventBus: bus });
  assert.equal(compressCalls, 1);
});

test("DeepSearchAgentLoop run(): swallows ABORTED transition failures", async () => {
  const { DeepSearchAgentLoop, DeepSearchState, AgentDecision } = await loadModules();
  const { AgentLoopStatus } = await import("../../../js/agents/stages/deepsearch/constants.js");
  const bus = makeEventBus();

  const state = makeMinimalCompleteState(DeepSearchState, { runId: "abort_transition_fail" });
  const loop = new DeepSearchAgentLoop({ eventBus: bus });

  const originalTransitionTo = loop._transitionTo.bind(loop);
  loop._transitionTo = async (to, meta) => {
    if (to === AgentLoopStatus.ABORTED) {
      const err = new Error("transition_failed");
      err.code = "TRANSITION_FAILED";
      throw err;
    }
    return originalTransitionTo(to, meta);
  };

  loop._think = async () => ({ action: "complete", reason: "noop" });
  loop._review = async () => ({ decision: AgentDecision.ABORT, reason: "abort_reason" });

  await assert.rejects(
    () => loop.run({ state }, { runContext: { runId: "abort_transition_fail" }, eventBus: bus }),
    (err) => err && String(err.message).includes("abort_reason")
  );
});

test("DeepSearchAgentLoop._think uses _thinkWithLLM in LLM mode", async () => {
  const { DeepSearchAgentLoop, ThinkingMode } = await loadModules();
  const bus = makeEventBus();
  const agentLoop = new DeepSearchAgentLoop({ eventBus: bus, thinkingMode: ThinkingMode.LLM });

  agentLoop._thinkWithLLM = async () => ({ action: "complete", reason: "llm" });
  const decision = await agentLoop._think({ openTodoCount: 0, hasReport: false }, {}, {}, { isSubAgent: false });
  assert.equal(decision.reason, "llm");
});

test("DeepSearchAgentLoop._think HYBRID covers late-iteration/backtrack triggers and no-LLM path", async () => {
  const { DeepSearchAgentLoop, ThinkingMode } = await loadModules();
  const bus = makeEventBus();
  const logger = { info: () => {}, warn: () => {} };

  const agentLoop = new DeepSearchAgentLoop({ eventBus: bus, thinkingMode: ThinkingMode.HYBRID });
  agentLoop._thinkWithLLM = async () => ({ action: "complete", reason: "llm" });

  const lateIteration = await agentLoop._think(
    { openTodoCount: 1, claimCount: 0, hasReport: false, iteration: 3, maxIterations: 4, totalTodos: 1 },
    {},
    {},
    { logger, isSubAgent: false }
  );
  assert.equal(lateIteration.reason, "llm");

  agentLoop._backtrackCount = 1;
  const backtrackTriggered = await agentLoop._think(
    { openTodoCount: 0, claimCount: 0, hasReport: false, iteration: 0, maxIterations: 5, totalTodos: 1 },
    {},
    {},
    { logger, isSubAgent: false }
  );
  assert.equal(backtrackTriggered.reason, "llm");

  agentLoop._backtrackCount = 0;
  agentLoop._thinkWithLLM = async () => {
    throw new Error("should_not_call");
  };
  const noLlMNeeded = await agentLoop._think(
    { openTodoCount: 0, claimCount: 0, hasReport: false, iteration: 0, maxIterations: 5, totalTodos: 1 },
    {},
    {},
    { logger, isSubAgent: false }
  );
  assert.equal(noLlMNeeded.action, "complete");
  assert.equal(noLlMNeeded.reason, "no_action_needed");
});

test("DeepSearchAgentLoop._thinkWithLLM falls back to rules when no model configured", async () => {
  const { DeepSearchAgentLoop, DeepSearchState } = await loadModules();
  const bus = makeEventBus();
  const agentLoop = new DeepSearchAgentLoop({ eventBus: bus });

  const state = new DeepSearchState({ runId: "no_model" });
  const observation = {
    sourceCount: 1,
    claimCount: 1,
    evidenceCount: 1,
    openTodoCount: 0,
    completedTodoCount: 0,
    blockedTodoCount: 0,
    totalTodos: 1,
    hasReport: false,
    isLargeDoc: false,
    iteration: 0,
    maxIterations: 5,
  };

  const decision = await agentLoop._thinkWithLLM(observation, state, {}, { logger: { warn: () => {} } });
  assert.equal(decision.action, "generate_report");
});

test("DeepSearchAgentLoop._thinkWithLLM falls back when response has no JSON candidate", async () => {
  const { DeepSearchAgentLoop, DeepSearchState } = await loadModules();
  const bus = makeEventBus();
  const agentLoop = new DeepSearchAgentLoop({ eventBus: bus });

  const state = new DeepSearchState({ runId: "no_json" });
  const observation = {
    sourceCount: 1,
    claimCount: 1,
    evidenceCount: 1,
    openTodoCount: 0,
    completedTodoCount: 0,
    blockedTodoCount: 0,
    totalTodos: 1,
    hasReport: false,
    isLargeDoc: false,
    iteration: 0,
    maxIterations: 5,
  };

  const modelRouter = {
    call: async () => ({ content: "" }),
  };

  const decision = await agentLoop._thinkWithLLM(observation, state, { modelRouter }, { logger: { warn: () => {} } });
  assert.equal(decision.action, "generate_report");
});

test("DeepSearchAgentLoop._emitThoughtStream ignores onThoughtDelta errors", async () => {
  const { DeepSearchAgentLoop, StreamingThinkConfig } = await loadModules();
  const bus = makeEventBus();

  const agentLoop = new DeepSearchAgentLoop({
    eventBus: bus,
    streamingThink: true,
    onThoughtDelta: () => {
      throw new Error("callback_failed");
    },
  });

  await agentLoop._emitThoughtStream({ runId: "delta_fail" }, "Hello World! Hello World! Hello");
  const deltaEvents = bus.events.filter((e) => e.name === StreamingThinkConfig.THOUGHT_DELTA_EVENT);
  assert.ok(deltaEvents.length > 0);
});

test("DeepSearchAgentLoop._executeScanAndIdentifyGaps default runs scan + todos stages", async () => {
  const { DeepSearchAgentLoop, DeepSearchState } = await loadModules();
  const bus = makeEventBus();

  const agentLoop = new DeepSearchAgentLoop({ eventBus: bus });
  agentLoop.capabilities = {}; // ensure default path

  const state = new DeepSearchState({
    runId: "scan_default",
    taskGoal: "Goal",
    L0: { sources: [{ sourceId: "src_1", sourceTextNormalized: "Test content here" }] },
  });
  state.todos = [{ todoId: "todo_1", text: "User todo", source: "user" }];

  const result = await agentLoop._executeScanAndIdentifyGaps(state, {}, { logger: { info: () => {}, warn: () => {} } });
  assert.equal(result.scanned, true);
  assert.equal(result.gapsIdentified, true);
  assert.equal(result.todosIdentified, true);
  assert.ok(Array.isArray(state.todos));
  assert.ok(state.todos.length > 0);
});

test("DeepSearchAgentLoop._review creates ShadowAgent and swallows validation errors", async () => {
  const { DeepSearchAgentLoop, AgentDecision } = await loadModules();
  const { ShadowAgent } = await import("../../../js/agents/stages/deepsearch/shadow-agent.js");

  const agentLoop = new DeepSearchAgentLoop({ eventBus: makeEventBus() });

  const originalValidateBatch = ShadowAgent.prototype.validateBatch;
  ShadowAgent.prototype.validateBatch = async () => {
    throw new Error("shadow_fail");
  };

  try {
    const review = await agentLoop._review(
      { action: "retrieve_and_extract" },
      { claims: [{ claimId: "c1" }] },
      { runId: "shadow_init", iteration: 0, L1: { evidenceLedger: [{ evidenceId: "e1" }] } },
      {}
    );
    assert.equal(review.decision, AgentDecision.CONTINUE);
    assert.ok(agentLoop._shadowAgent);
  } finally {
    ShadowAgent.prototype.validateBatch = originalValidateBatch;
  }
});

test("DeepSearchAgentLoop._transitionTo and _applyTransition no-op when status unchanged", async () => {
  const { DeepSearchAgentLoop, DeepSearchState } = await loadModules();
  const { AgentLoopStatus } = await import("../../../js/agents/stages/deepsearch/constants.js");

  const agentLoop = new DeepSearchAgentLoop({ eventBus: makeEventBus() });
  const state = new DeepSearchState({ runId: "noop" });

  await agentLoop._transitionTo(AgentLoopStatus.RUNNING, { runId: "noop", state, stageApi: {} });
  const id = await agentLoop._transitionTo(AgentLoopStatus.RUNNING, { runId: "noop", state, stageApi: {} });
  assert.equal(id, null);

  agentLoop._applyTransition(AgentLoopStatus.RUNNING, { runId: "noop" });
});

test("DeepSearchAgentLoop._executeRetrieveAndExtract default runs retrieve + understand stages", async () => {
  const { DeepSearchAgentLoop, DeepSearchState } = await loadModules();
  const bus = makeEventBus();

  const agentLoop = new DeepSearchAgentLoop({ eventBus: bus });
  agentLoop.capabilities = {}; // ensure default path

  const state = new DeepSearchState({
    runId: "retrieve_default",
    taskGoal: "Test retrieve",
    userConfig: { retrieval: { enableToolChain: false } },
    L0: { sources: [{ sourceId: "src_1", sourceTextNormalized: "Test content here" }] },
  });
  state.todos = [{ todoId: "todo_1", text: "What is Test?", status: "open", queryHints: ["Test"] }];
  state.L1.gaps = [];

  const result = await agentLoop._executeRetrieveAndExtract(state, {}, { logger: { info: () => {}, warn: () => {} } });
  assert.equal(result.retrieved, true);
  assert.equal(result.extracted, true);
  assert.equal(state.iteration, 1);
});

test("DeepSearchAgentLoop._executeGenerateReport default runs write stage", async () => {
  const { DeepSearchAgentLoop, DeepSearchState } = await loadModules();
  const bus = makeEventBus();

  const agentLoop = new DeepSearchAgentLoop({ eventBus: bus });
  agentLoop.capabilities = {}; // ensure default path

  const state = new DeepSearchState({
    runId: "write_default",
    taskGoal: "Test write",
    userConfig: { write: { writerMode: "legacy", reviewer: { enableReviewer: false } } },
    L0: { sources: [{ sourceId: "src_1", sourceTextNormalized: "Test content here" }] },
  });
  state.L1.gaps = [];
  state.L1.claims = [{ claimId: "c1", text: "Test claim", evidenceIds: ["e1"] }];
  state.L1.evidenceLedger = [
    {
      evidenceId: "e1",
      sourceId: "src_1",
      quote: "Test",
      locator: { charStart: 0, charEnd: 4 },
    },
  ];
  state.L1.report = null;

  const result = await agentLoop._executeGenerateReport(state, {}, { logger: { info: () => {}, warn: () => {} } });
  assert.equal(result.reportGenerated, true);
  assert.ok(state.L1.report);
});

test("DeepSearchAgentLoop observe(): handles missing arrays + maxIterations fallback", async () => {
  const { DeepSearchAgentLoop, DeepSearchState } = await loadModules();
  const bus = makeEventBus();

  const agentLoop = new DeepSearchAgentLoop({ eventBus: bus });
  const state = new DeepSearchState({ runId: "observe_fallback", taskGoal: "Goal" });

  state.L0.sources = null;
  state.L1.gaps = null;
  state.L1.claims = null;
  state.L1.evidenceLedger = null;
  state.maxIterations = 0;
  state.L1.report = { title: "R", markdown: "Report", sections: [], citations: [] };

  const pkg = await agentLoop.run({ state }, { runContext: { runId: "observe_fallback" }, eventBus: bus });
  assert.ok(pkg);
});

test("DeepSearchAgentLoop observe(): counts missing/empty source text as 0 chars", async () => {
  const { DeepSearchAgentLoop, DeepSearchState } = await loadModules();
  const bus = makeEventBus();

  const agentLoop = new DeepSearchAgentLoop({ eventBus: bus });
  const state = new DeepSearchState({
    runId: "observe_empty_text",
    taskGoal: "Goal",
    L0: { sources: [{ sourceId: "src_1", sourceTextNormalized: "" }] },
  });

  state.L1.report = { title: "R", markdown: "Report", sections: [], citations: [] };

  const pkg = await agentLoop.run({ state }, { runContext: { runId: "observe_empty_text" }, eventBus: bus });
  assert.ok(pkg);
});

test("resumeDeepSearchAgentLoop restores state from checkpoint and continues", async () => {
  const { DeepSearchAgentLoop, resumeDeepSearchAgentLoop, DeepSearchState } = await loadModules();
  const { Archive, MapAdapter } = await import("../../../js/agents/shared/archive.js");
  const { StagePausedError } = await import("../../../js/agents/runtime/stage-errors.js");

  const bus = makeEventBus();
  const archive = new Archive(new MapAdapter());

  const agentLoop = new DeepSearchAgentLoop({ eventBus: bus, archive });
  const state = makeMinimalCompleteState(DeepSearchState, { runId: "resume_run" });

  agentLoop.pause("manual_pause");

  let checkpointId;
  await assert.rejects(
    () => agentLoop.run({ state }, { runContext: { runId: "resume_run" }, eventBus: bus }),
    (err) => {
      assert.ok(err instanceof StagePausedError);
      checkpointId = err.checkpointId;
      assert.ok(typeof checkpointId === "string" && checkpointId.includes(":"));
      return true;
    }
  );

  const pkg = await resumeDeepSearchAgentLoop(checkpointId, { eventBus: bus, archive });

  assert.ok(pkg);
  assert.equal(pkg.runId, "resume_run");
  assert.equal(pkg.mode, "deepsearch");
  assert.ok(pkg.report && typeof pkg.report === "object");
});
