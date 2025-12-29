const test = require("node:test");
const assert = require("node:assert/strict");

test("validateIteration: skips FILLED gaps when evidence insufficient", async () => {
  const { validateIteration } = await import("../../../js/agents/stages/deepsearch/state.js");

  const state = {
    runId: "run_validate_iteration_skip_filled",
    iteration: 0,
    L1: {
      gaps: [{ gapId: "g_filled", status: "filled", missCount: 1 }],
      evidenceLedger: [],
    },
    L2: { retrievedChunks: [] },
    todos: [],
  };

  const result = validateIteration(state, {
    roundHits: new Map([["g_filled", 0]]),
  });

  assert.equal(state.L1.gaps[0].status, "filled");
  assert.equal(state.L1.gaps[0].missCount, 1);
  assert.deepEqual(result, { filledCount: 0, blockedCount: 0, openCount: 0, stillOpenCount: 0 });
});

test("validateIteration: skips BLOCKED gaps when evidence insufficient", async () => {
  const { validateIteration } = await import("../../../js/agents/stages/deepsearch/state.js");

  const state = {
    runId: "run_validate_iteration_skip_blocked",
    iteration: 0,
    L1: {
      gaps: [{ gapId: "g_blocked", status: "blocked", missCount: 5 }],
      evidenceLedger: [],
    },
    L2: { retrievedChunks: [] },
    todos: [],
  };

  const result = validateIteration(state, {
    roundHits: new Map([["g_blocked", 0]]),
  });

  assert.equal(state.L1.gaps[0].status, "blocked");
  assert.equal(state.L1.gaps[0].missCount, 5);
  assert.deepEqual(result, { filledCount: 0, blockedCount: 0, openCount: 0, stillOpenCount: 0 });
});

