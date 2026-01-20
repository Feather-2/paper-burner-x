import { describe, it, expect, beforeEach, afterEach } from "vitest";

const assert = require("node:assert/strict");

it("validateIteration: skips FILLED gaps when evidence insufficient", async () => {
  const { validateIteration } = await import("../../../../js/agents/stages/deepsearch/state.js");

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

  expect(state.L1.gaps[0].status).toBe("filled");
  expect(state.L1.gaps[0].missCount).toBe(1);
  expect(result).toEqual({ filledCount: 0, blockedCount: 0, openCount: 0, stillOpenCount: 0 });
});

it("validateIteration: skips BLOCKED gaps when evidence insufficient", async () => {
  const { validateIteration } = await import("../../../../js/agents/stages/deepsearch/state.js");

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

  expect(state.L1.gaps[0].status).toBe("blocked");
  expect(state.L1.gaps[0].missCount).toBe(5);
  expect(result).toEqual({ filledCount: 0, blockedCount: 0, openCount: 0, stillOpenCount: 0 });
});

