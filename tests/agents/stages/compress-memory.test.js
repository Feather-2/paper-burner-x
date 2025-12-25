const test = require("node:test");
const assert = require("node:assert/strict");

async function loadModules() {
  const { DeepSearchAgentLoop } = await import(
    "../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js"
  );
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");
  return { DeepSearchAgentLoop, DeepSearchState };
}

function makeState(DeepSearchState, runId) {
  return new DeepSearchState({ runId });
}

test("compressMemory captures last 3 decisions", async () => {
  const { DeepSearchAgentLoop, DeepSearchState } = await loadModules();
  const agentLoop = new DeepSearchAgentLoop();
  agentLoop.archive = null;
  const state = makeState(DeepSearchState, "decision_trace_last_three");

  state.L2.thoughtHistory = [
    { action: "a1", reason: "r1", outcome: "o1", iteration: 1, ts: "2024-01-01T00:00:00.000Z" },
    { action: "a2", reason: "r2", outcome: "o2", iteration: 2, ts: "2024-01-02T00:00:00.000Z" },
    { action: "a3", reason: "r3", outcome: "o3", iteration: 3, ts: "2024-01-03T00:00:00.000Z" },
    { action: "a4", reason: "r4", outcome: "o4", iteration: 4, ts: "2024-01-04T00:00:00.000Z" },
  ];

  await agentLoop._compressMemory(state, {});

  assert.deepEqual(
    state.L1.condensedMemory.decisionTrace.map((entry) => entry.action),
    ["a2", "a3", "a4"]
  );
});

test("compressMemory writes empty decisionTrace when thoughtHistory is empty", async () => {
  const { DeepSearchAgentLoop, DeepSearchState } = await loadModules();
  const agentLoop = new DeepSearchAgentLoop();
  agentLoop.archive = null;
  const state = makeState(DeepSearchState, "decision_trace_empty");

  state.L2.thoughtHistory = [];

  await agentLoop._compressMemory(state, {});

  assert.deepEqual(state.L1.condensedMemory.decisionTrace, []);
});

test("compressMemory maps decision fields with defaults", async () => {
  const { DeepSearchAgentLoop, DeepSearchState } = await loadModules();
  const agentLoop = new DeepSearchAgentLoop();
  agentLoop.archive = null;
  const state = makeState(DeepSearchState, "decision_trace_mapping");
  state.iteration = 9;

  state.L2.thoughtHistory = [
    { action: "replan", reason: "missing data", outcome: "retry", iteration: 5, ts: "2024-02-01T00:00:00.000Z" },
    { action: "complete" },
    { action: "abort", outcome: "stopped" },
  ];

  await agentLoop._compressMemory(state, {});

  const [first, second, third] = state.L1.condensedMemory.decisionTrace;
  assert.deepEqual(first, {
    action: "replan",
    reason: "missing data",
    outcome: "retry",
    iteration: 5,
    ts: "2024-02-01T00:00:00.000Z"
  });
  assert.equal(second.action, "complete");
  assert.equal(second.reason, "");
  assert.equal(second.outcome, "unknown");
  assert.equal(second.iteration, 9);
  assert.ok(typeof second.ts === "string");
  assert.equal(third.action, "abort");
  assert.equal(third.reason, "");
  assert.equal(third.outcome, "stopped");
  assert.equal(third.iteration, 9);
  assert.ok(typeof third.ts === "string");
});
