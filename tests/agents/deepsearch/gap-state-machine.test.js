const test = require("node:test");
const assert = require("node:assert/strict");

test("transitionGap: covers all status transitions and cleans fields", async () => {
  const { GapStatus, transitionGap } = await import("../../../js/agents/stages/deepsearch/state.js");

  {
    const events = [];
    const emit = (name, payload) => events.push({ name, payload });

    const g = { gapId: "g_open", status: "open", blockedAt: "t0", blockedReason: "stale" };
    assert.equal(transitionGap(g, GapStatus.FILLED, { runId: "r", iteration: 1, ts: "t1", evidenceCount: 2 }, emit), true);
    assert.equal(g.status, "filled");
    assert.equal(g.filledAt, "t1");
    assert.equal(g.filledIteration, 1);
    assert.equal(g.evidenceCount, 2);
    assert.equal("blockedAt" in g, false);
    assert.equal("blockedReason" in g, false);
    assert.deepEqual(events.at(-1), {
      name: "deepsearch.gap.status.changed",
      payload: { runId: "r", gapId: "g_open", from: "open", to: "filled", reason: "evidence", iteration: 1 },
    });
  }

  {
    const events = [];
    const emit = (name, payload) => events.push({ name, payload });

    const g = { gapId: "g_open", status: "open", filledAt: "t0", filledIteration: 0, evidenceCount: 9, missCount: 1 };
    assert.equal(transitionGap(g, GapStatus.BLOCKED, { runId: "r", iteration: 2, ts: "t2", reason: "no_retrieval_hits" }, emit), true);
    assert.equal(g.status, "blocked");
    assert.equal(g.blockedAt, "t2");
    assert.equal(g.blockedReason, "no_retrieval_hits");
    assert.equal("filledAt" in g, false);
    assert.equal("filledIteration" in g, false);
    assert.equal("evidenceCount" in g, false);
    assert.deepEqual(events.at(-1), {
      name: "deepsearch.gap.status.changed",
      payload: { runId: "r", gapId: "g_open", from: "open", to: "blocked", reason: "no_retrieval_hits", iteration: 2 },
    });
  }

  {
    const g = { gapId: "g_filled", status: "filled", filledAt: "t0", filledIteration: 0, evidenceCount: 1, missCount: 9 };
    assert.equal(transitionGap(g, GapStatus.OPEN, { runId: "r", iteration: 3, ts: "t3" }, null), true);
    assert.equal(g.status, "open");
    assert.equal(g.missCount, 0);
    assert.equal("filledAt" in g, false);
    assert.equal("filledIteration" in g, false);
    assert.equal("evidenceCount" in g, false);
    assert.equal("blockedAt" in g, false);
    assert.equal("blockedReason" in g, false);
  }

  {
    const g = { gapId: "g_blocked", status: "blocked", blockedAt: "t0", blockedReason: "custom", missCount: 9 };
    assert.equal(transitionGap(g, GapStatus.OPEN, { runId: "r", iteration: 4, ts: "t4" }, null), true);
    assert.equal(g.status, "open");
    assert.equal(g.missCount, 0);
    assert.equal("blockedAt" in g, false);
    assert.equal("blockedReason" in g, false);
    assert.equal("filledAt" in g, false);
    assert.equal("filledIteration" in g, false);
    assert.equal("evidenceCount" in g, false);
  }

  {
    const g = { gapId: "g_blocked", status: "blocked", blockedAt: "t0", blockedReason: "custom" };
    assert.equal(transitionGap(g, GapStatus.FILLED, { runId: "r", iteration: 5, ts: "t5", evidenceCount: 3 }, null), true);
    assert.equal(g.status, "filled");
    assert.equal(g.filledAt, "t5");
    assert.equal(g.filledIteration, 5);
    assert.equal(g.evidenceCount, 3);
    assert.equal("blockedAt" in g, false);
    assert.equal("blockedReason" in g, false);
  }

  {
    const g = { gapId: "g_filled", status: "filled", filledAt: "t0", filledIteration: 0, evidenceCount: 1 };
    assert.equal(transitionGap(g, GapStatus.BLOCKED, { runId: "r", iteration: 6, ts: "t6" }, null), true);
    assert.equal(g.status, "blocked");
    assert.equal(g.blockedAt, "t6");
    assert.equal(g.blockedReason, "no_retrieval_hits");
    assert.equal("filledAt" in g, false);
    assert.equal("filledIteration" in g, false);
    assert.equal("evidenceCount" in g, false);
  }
});

test("transitionGap: no-op when from === to (no mutation, no emit)", async () => {
  const { GapStatus, transitionGap } = await import("../../../js/agents/stages/deepsearch/state.js");

  const g = { gapId: "g1", status: "open", missCount: 7, filledAt: "stale" };
  const events = [];
  const emit = (name, payload) => events.push({ name, payload });

  assert.equal(transitionGap(g, GapStatus.OPEN, { runId: "r", iteration: 1, ts: "t" }, emit), false);
  assert.equal(g.status, "open");
  assert.equal(g.missCount, 7);
  assert.equal(g.filledAt, "stale");
  assert.equal(events.length, 0);
});

test("validateIteration/reopenGaps: uses transitionGap for cleanup", async () => {
  const { DeepSearchState, validateIteration } = await import("../../../js/agents/stages/deepsearch/state.js");

  const events = [];
  const emit = (name, payload) => events.push({ name, payload });

  const state = new DeepSearchState({ runId: "run_gap_cleanup", iteration: 2 });
  state.L1.gaps = [
    { gapId: "g_fill", type: "x", question: "q", status: "open", missCount: 0, blockedAt: "stale", blockedReason: "stale" },
    { gapId: "g_block", type: "x", question: "q", status: "open", missCount: 1, filledAt: "stale", filledIteration: 0, evidenceCount: 9 },
  ];
  state.L2.retrievedChunks = [{ chunkId: "c1", gapId: "g_fill", sourceId: "s1", locator: { charStart: 0, charEnd: 1 }, text: "hit" }];
  state.L1.evidenceLedger = [{ evidenceId: "e1", chunkId: "c1" }];

  validateIteration(state, { minEvidenceToFill: 1, blockAfterMisses: 2, roundHits: {}, emit });

  const gFill = state.L1.gaps.find((g) => g.gapId === "g_fill");
  assert.equal(gFill.status, "filled");
  assert.equal("blockedAt" in gFill, false);
  assert.equal("blockedReason" in gFill, false);

  const gBlock = state.L1.gaps.find((g) => g.gapId === "g_block");
  assert.equal(gBlock.status, "blocked");
  assert.equal("filledAt" in gBlock, false);
  assert.equal("filledIteration" in gBlock, false);
  assert.equal("evidenceCount" in gBlock, false);

  state.reopenGaps(["g_fill"], { reason: "retry", timestamp: "2025-01-01T00:00:00.000Z" }, emit);
  assert.equal(gFill.status, "open");
  assert.equal(gFill.reopenedReason, "retry");
  assert.equal("evidenceCount" in gFill, false);
  assert.ok(events.some((e) => e.name === "deepsearch.gap.status.changed" && e.payload?.gapId === "g_fill" && e.payload?.to === "open"));
});

