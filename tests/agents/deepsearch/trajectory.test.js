const test = require("node:test");
const assert = require("node:assert/strict");
const { setTimeout: delay } = require("node:timers/promises");

test("mapConcurrent: enforces concurrency and preserves order", async () => {
  const { mapConcurrent } = await import("../../../js/agents/shared/concurrency.js");

  const items = Array.from({ length: 17 }, (_, i) => i);
  let inFlight = 0;
  let maxInFlight = 0;

  const out = await mapConcurrent(
    items,
    async (n) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await delay(10);
      inFlight--;
      return n * 2;
    },
    3
  );

  assert.ok(maxInFlight <= 3, `expected max concurrency <= 3, got ${maxInFlight}`);
  assert.deepEqual(out, items.map((n) => n * 2));
});

test("TrajectoryManager.fork: creates N independent DeepSearchState clones", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");
  const { TrajectoryManager } = await import("../../../js/agents/stages/deepsearch/trajectory.js");
  const { performance } = require("node:perf_hooks");

  const base = new DeepSearchState({
    runId: "run_traj_fork",
    taskGoal: "Define Alpha",
    userConfig: { trajectory: { n: 3, mergeStrategy: "best" } },
    iteration: 0,
    L0: { sources: [{ sourceId: "s1", kind: "user_text", title: "Input", sourceTextNormalized: "Definition: Alpha." }] },
    L1: { gaps: [{ gapId: "gap_1", type: "definition", question: "Define Alpha", status: "open", queryHints: ["Definition"] }] },
    L2: { retrievedChunks: [], scratchpad: { x: 1 }, logs: [] },
  });

  const manager = new TrajectoryManager({ n: 3, mergeStrategy: "best" });
  const trajectories = manager.fork(base);

  assert.equal(trajectories.length, 3);
  assert.equal(trajectories[0] instanceof DeepSearchState, true);
  assert.equal(trajectories[0].trajectoryId, "traj_0");
  assert.equal(trajectories[1].trajectoryId, "traj_1");
  assert.equal(trajectories[2].trajectoryId, "traj_2");
  assert.equal(trajectories.every((t) => t !== base), true);

  trajectories[0].L1.gaps[0].status = "filled";
  trajectories[0].L2.scratchpad.x = 999;
  assert.equal(trajectories[1].L1.gaps[0].status, "open");
  assert.equal(trajectories[2].L2.scratchpad.x, undefined);
  assert.equal(base.L1.gaps[0].status, "open");
  assert.equal(base.L2.scratchpad.x, 1);

  assert.equal(trajectories[0].L0, base.L0);
  assert.equal(trajectories[1].L0, base.L0);
  assert.equal(trajectories[2].L0, base.L0);

  // Performance: avoid deep cloning large L0 sources on fork.
  const bigText = "x".repeat(1_000_000);
  const largeBase = new DeepSearchState({
    runId: "run_traj_fork_perf",
    taskGoal: "t",
    L0: { sources: [{ sourceId: "s1", kind: "user_text", title: "Input", sourceTextNormalized: bigText }] },
    L1: { gaps: [{ gapId: "gap_1", type: "definition", question: "q", status: "open" }] },
    L2: { retrievedChunks: [], scratchpad: {}, logs: [] },
  });

  const perfManager = new TrajectoryManager({ n: 8, mergeStrategy: "best" });
  perfManager.fork(base); // warmup
  const start = performance.now();
  perfManager.fork(largeBase);
  const ms = performance.now() - start;
  assert.ok(ms < 10, `expected fork < 10ms, got ${ms.toFixed(2)}ms`);
});

test("TrajectoryManager.computeQuality: coverage/evidence/conflict/efficiency scoring", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");
  const { TrajectoryManager } = await import("../../../js/agents/stages/deepsearch/trajectory.js");

  const state = new DeepSearchState({
    runId: "run_traj_quality",
    iteration: 2,
    L1: {
      gaps: [
        { gapId: "g1", type: "definition", question: "q1", status: "filled" },
        { gapId: "g2", type: "data", question: "q2", status: "open" },
      ],
      claims: [
        { claimId: "c_1", text: "Alpha is defined.", evidenceIds: ["e_1"] },
        { claimId: "c_2", text: "Alpha adoption is 42%.", evidenceIds: [] },
      ],
      evidenceLedger: [{ evidenceId: "e_1", sourceId: "s1", locator: { charStart: 0, charEnd: 10 }, quote: "Alpha is" }],
      conflicts: [{ claimId1: "c_1", claimId2: "c_2", reason: "x" }],
    },
  });

  const manager = new TrajectoryManager();
  const q = manager.computeQuality(state);

  assert.equal(q.coverage, 0.5);
  assert.equal(q.evidenceQuality, 0.5);
  assert.equal(q.conflictRate, 0.5);
  assert.equal(q.efficiency, 1); // 2 claims / 2 iterations
  assert.ok(typeof q.score === "number" && Number.isFinite(q.score));

  const empty = new DeepSearchState({ runId: "run_traj_quality_empty" });
  const q2 = manager.computeQuality(empty);
  assert.equal(q2.coverage, 0);
  assert.equal(q2.evidenceQuality, 0);
  assert.equal(q2.conflictRate, 0);

  const q3 = manager.computeQuality({ iteration: 0, L1: { gaps: null, claims: null, evidenceLedger: null, conflicts: null } });
  assert.equal(q3.coverage, 0);
  assert.equal(q3.evidenceQuality, 0);
  assert.equal(q3.conflictRate, 0);
});

test("TrajectoryManager.merge: best selects highest score; union dedupes; vote keeps majority claims", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");
  const { TrajectoryManager } = await import("../../../js/agents/stages/deepsearch/trajectory.js");

  const mkState = (trajectoryId, { filled = 0, total = 2, claimText = "Alpha is defined.", includeSecondClaim = false } = {}) => {
    const gaps = [];
    for (let i = 0; i < total; i++) gaps.push({ gapId: `gap_${i + 1}`, type: "t", question: `q${i + 1}`, status: i < filled ? "filled" : "open" });

    const claims = [{ claimId: "c_1", text: claimText, importance: "support", evidenceIds: ["e_1"] }];
    if (includeSecondClaim) claims.push({ claimId: "c_2", text: "Beta exists.", importance: "support", evidenceIds: ["e_2"] });

    return new DeepSearchState({
      runId: "run_merge",
      trajectoryId,
      iteration: 1,
      L0: { sources: [{ sourceId: "s1", kind: "user_text", title: "Input", sourceTextNormalized: "Definition: Alpha. Beta." }] },
      L1: {
        gaps,
        claims,
        evidenceLedger: [
          { evidenceId: "e_1", chunkId: "s1::chunk_1", sourceId: "s1", locator: { charStart: 0, charEnd: 10 }, quote: "Definition:" },
          ...(includeSecondClaim ? [{ evidenceId: "e_2", chunkId: "s1::chunk_1", sourceId: "s1", locator: { charStart: 0, charEnd: 10 }, quote: "Definition:" }] : []),
        ],
        conflicts: [{ claimId1: "c_1", claimId2: "c_2", reason: "dup" }],
        openQuestions: [{ questionId: "q_1", status: "open", question: "What is Alpha?" }],
      },
      L2: { retrievedChunks: [{ chunkId: "s1::chunk_1", gapId: "gap_1", sourceId: "s1", locator: { charStart: 0, charEnd: 10 }, text: "Definition: Alpha." }] },
    });
  };

  {
    const t0 = mkState("traj_0", { filled: 2 });
    const t1 = mkState("traj_1", { filled: 1 });
    const manager = new TrajectoryManager({ n: 2, mergeStrategy: "best" });
    manager.trajectories = [t0, t1];
    const best = manager.merge();
    assert.equal(best.trajectoryId, "traj_0");
  }

  {
    const t0 = mkState("traj_0", { filled: 0, claimText: "Alpha is defined.", includeSecondClaim: false });
    const t1 = mkState("traj_1", { filled: 2, claimText: "Alpha is defined.", includeSecondClaim: true });
    t0.L1.gaps[0].status = "weird_status"; // exercise unknown-status branch
    const manager = new TrajectoryManager({ n: 2, mergeStrategy: "union" });
    manager.trajectories = [t0, t1];
    const merged = manager.merge();

    assert.equal(merged.trajectoryId, "merged");
    assert.ok(Array.isArray(merged.L1.claims));
    assert.equal(merged.L1.claims.length, 2); // Alpha + Beta
    assert.equal(new Set(merged.L1.claims.map((c) => c.claimId)).size, merged.L1.claims.length);
    assert.ok(merged.L1.claims.every((c) => Array.isArray(c.evidenceIds) && c.evidenceIds.length >= 1));

    // Evidence deduped by sourceId+locator.
    assert.equal(merged.L1.evidenceLedger.length, 1);
    assert.equal(merged.L1.evidenceLedger[0].evidenceId, "e_1");

    // Conflicts/openQuestions deduped across trajectories.
    assert.equal(merged.L1.conflicts.length, 1);
    assert.equal(merged.L1.openQuestions.length, 1);

    // mergeGaps prefers higher status (filled overrides weird/open).
    assert.equal(merged.L1.gaps.some((g) => g.status === "filled"), true);
  }

  {
    const t0 = mkState("traj_0", { filled: 2, claimText: "Alpha is defined.", includeSecondClaim: false });
    const t1 = mkState("traj_1", { filled: 2, claimText: "Alpha is defined.", includeSecondClaim: false });
    const t2 = mkState("traj_2", { filled: 2, claimText: "Gamma is different.", includeSecondClaim: false });
    const manager = new TrajectoryManager({ n: 3, mergeStrategy: "vote" });
    manager.trajectories = [t0, t1, t2];
    const merged = manager.merge();

    assert.equal(merged.trajectoryId, "merged");
    assert.equal(merged.L1.claims.length, 1);
    assert.ok(merged.L1.claims[0].text.toLowerCase().includes("alpha"));
  }
});

test("TrajectoryManager.runTrajectory: exits on 2 no-new-hit rounds and covers validateIteration branches", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");
  const { TrajectoryManager } = await import("../../../js/agents/stages/deepsearch/trajectory.js");

  const state = new DeepSearchState({
    runId: "run_traj_loop",
    taskGoal: "t",
    iteration: 0,
    maxIterations: 10,
    userConfig: { gaps: { blockAfterMisses: 10 } },
    L1: { gaps: [{ gapId: "gap_1", type: "definition", question: "q", status: "open" }], claims: [], evidenceLedger: [], conflicts: [], openQuestions: [] },
    L2: { retrievedChunks: [], logs: [] },
  });
  state.trajectoryId = "traj_stub";

  let retrieveCalls = 0;
  const runGapsStage = async (_runContext, { state: s }) => {
    const prev = Array.isArray(s?.L1?.gaps) && s.L1.gaps[0] ? s.L1.gaps[0] : {};
    const priorMissCount = typeof prev?.missCount === "number" && Number.isFinite(prev.missCount) ? prev.missCount : 0;
    s.L1.gaps = [{ gapId: "gap_1", type: "definition", question: "q", status: "open", missCount: priorMissCount }];
  };
  const runRetrieveStage = async (_runContext, { state: s }) => {
    retrieveCalls++;
    if (retrieveCalls === 1) {
      const retrievedChunks = [{ chunkId: "c1", gapId: "gap_1", sourceId: "s1", locator: { charStart: 0, charEnd: 2 }, text: "hi" }];
      s.L2.retrievedChunks = retrievedChunks;
      return { retrievedChunks };
    }
    s.L2.retrievedChunks = [];
    return { retrievedChunks: [] };
  };
  const runUnderstandStage = async (_runContext, { state: s }) => {
    s.L1.claims = [];
    s.L1.evidenceLedger = []; // ensure "hits but no evidence" branch
  };

  const manager = new TrajectoryManager({ n: 1, mergeStrategy: "best" });
  await manager.runTrajectory(state, { runContext: { runId: "run_traj_loop" }, runGapsStage, runRetrieveStage, runUnderstandStage }, {});

  assert.equal(retrieveCalls, 3);
  assert.equal(state.iteration, 3);
  assert.equal(state.L1.gaps[0].status, "open");
  assert.equal(state.L1.gaps[0].missCount, 2);
});

test("TrajectoryManager.merge fallback + mergeBest tie-breaker by coverage", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");
  const { TrajectoryManager } = await import("../../../js/agents/stages/deepsearch/trajectory.js");

  const t0 = new DeepSearchState({ runId: "run_tb", trajectoryId: "traj_0", L1: { gaps: [], claims: [], evidenceLedger: [], conflicts: [] } });
  const t1 = new DeepSearchState({ runId: "run_tb", trajectoryId: "traj_1", L1: { gaps: [], claims: [], evidenceLedger: [], conflicts: [] } });

  const manager = new TrajectoryManager({ n: 2, mergeStrategy: "best" });
  manager.trajectories = [t0, t1];
  manager.computeQuality = (t) => (t.trajectoryId === "traj_0" ? { score: 1, coverage: 0.1 } : { score: 1, coverage: 0.2 });

  const best = manager.mergeBest();
  assert.equal(best.trajectoryId, "traj_1");

  manager.config.mergeStrategy = "unknown_strategy";
  assert.equal(manager.merge().trajectoryId, "traj_1");
});

test("TrajectoryManager edge cases: config normalization, empty merges, vote skips, evidenceKey fallback", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");
  const { TrajectoryManager } = await import("../../../js/agents/stages/deepsearch/trajectory.js");

  {
    const manager = new TrajectoryManager({ n: 99, mergeStrategy: "nope", qualityMetrics: "bad", divergeAt: 123 });
    assert.equal(manager.config.n, 8);
    assert.equal(manager.config.mergeStrategy, "best");
    assert.equal(Array.isArray(manager.config.qualityMetrics), true);
    assert.equal(manager.config.divergeAt, "gap");
  }

  {
    const manager = new TrajectoryManager({ n: "x", mergeStrategy: "vote" });
    assert.equal(manager.config.n, 1);
    assert.equal(manager.config.mergeStrategy, "vote");
  }

  {
    const manager = new TrajectoryManager({ n: 2, mergeStrategy: "union" });
    manager.trajectories = [];
    assert.equal(manager.mergeBest(), null);
    assert.equal(manager.mergeUnion(), null);
  }

  {
    const manager = new TrajectoryManager({ n: 2, mergeStrategy: "vote" });
    manager.trajectories = [];
    assert.equal(manager.mergeVote(), null);
  }

  {
    // evidenceKey fallback when locator is missing -> key uses quote.
    const t0 = new DeepSearchState({
      runId: "run_edge",
      trajectoryId: "traj_0",
      iteration: 1,
      L1: {
        gaps: [{ gapId: "gap_1", type: "t", question: "q", status: "open" }],
        claims: [{ claimId: "c_1", text: "Alpha", importance: "core", evidenceIds: ["e_1"] }],
        evidenceLedger: [{ evidenceId: "e_1", chunkId: "c1", sourceId: "s1", locator: null, quote: "Alpha quote" }],
        conflicts: [],
        openQuestions: [],
      },
      L2: { retrievedChunks: [{ chunkId: "c1", gapId: "gap_1", sourceId: "s1", locator: {}, text: "Alpha quote", retrievedId: "" }] },
    });

    const t1 = new DeepSearchState({
      runId: "run_edge",
      trajectoryId: "traj_1",
      iteration: 1,
      L1: {
        gaps: [{ gapId: "gap_1", type: "t", question: "q", status: "open", missCount: 2 }],
        claims: [{ claimId: "c_1", text: "", importance: "support", evidenceIds: ["e_1"] }], // skipped by vote
        evidenceLedger: [{ evidenceId: "e_1", chunkId: "c1", sourceId: "s1", locator: null, quote: "Alpha quote" }],
        conflicts: [],
        openQuestions: [],
      },
      L2: { retrievedChunks: [{ chunkId: "c1", gapId: "gap_1", sourceId: "s1", locator: {}, text: "Alpha quote" }] },
    });

    const manager = new TrajectoryManager({ n: 2, mergeStrategy: "union" });
    manager.trajectories = [t0, t1];
    const merged = manager.mergeUnion();
    assert.equal(merged.L1.evidenceLedger.length, 1);
    assert.ok(merged.L2.retrievedChunks.every((r) => typeof r.retrievedId === "string" && r.retrievedId.length > 0));
  }
});

test("TrajectoryManager.runTrajectory: input validation + aborted signal short-circuit", async () => {
  const { TrajectoryManager } = await import("../../../js/agents/stages/deepsearch/trajectory.js");

  const manager = new TrajectoryManager({ n: 1 });
  const state = { iteration: 0, maxIterations: 2, L1: { gaps: [] }, L2: { retrievedChunks: [] }, userConfig: {} };

  await assert.rejects(() => manager.runTrajectory(state, { runGapsStage: async () => {} }, {}), /runContext is required/);
  await assert.rejects(() => manager.runTrajectory(state, { runContext: {}, runRetrieveStage: async () => {}, runUnderstandStage: async () => {} }, {}), /runGapsStage/);

  // Aborted signal means the while-loop body never runs.
  const out = await manager.runTrajectory(
    state,
    {
      runContext: { runId: "r" },
      runGapsStage: async () => {
        throw new Error("should not run");
      },
      runRetrieveStage: async () => {
        throw new Error("should not run");
      },
      runUnderstandStage: async () => {
        throw new Error("should not run");
      },
    },
    { signal: { aborted: true } }
  );
  assert.equal(out, state);
});

test("TrajectoryManager.mergeUnion: drops unreferenced evidence and claims with unmapped evidenceIds", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");
  const { TrajectoryManager } = await import("../../../js/agents/stages/deepsearch/trajectory.js");

  const t0 = new DeepSearchState({
    runId: "run_reindex",
    trajectoryId: "traj_0",
    iteration: 1,
    L1: {
      gaps: [
        { gapId: "gap_1", type: "t", question: "q1", status: "blocked" },
        { gapId: "gap_2", type: "t", question: "q2", status: "filled" },
      ],
      claims: [
        { claimId: "c_1", text: "Keep me", importance: "core", evidenceIds: ["e_1"], gapIds: ["gap_2"] },
        { claimId: "c_2", text: "Drop me", importance: "support", evidenceIds: ["e_missing"] },
      ],
      evidenceLedger: [
        { evidenceId: "e_1", chunkId: "c1", sourceId: "s1", locator: { charStart: 0, charEnd: 4 }, quote: "Keep", gapIds: ["gap_2"] },
        { evidenceId: "e_unused", chunkId: "c2", sourceId: "s1", locator: { charStart: 5, charEnd: 9 }, quote: "Unused" },
      ],
      conflicts: [],
      openQuestions: [],
    },
    L2: { retrievedChunks: [] },
  });

  const manager = new TrajectoryManager({ n: 1, mergeStrategy: "union" });
  manager.trajectories = [t0];
  const merged = manager.mergeUnion();

  assert.equal(merged.L1.claims.length, 1);
  assert.equal(merged.L1.claims[0].text, "Keep me");
  assert.equal(merged.L1.evidenceLedger.length, 1);
  assert.equal(merged.L1.evidenceLedger[0].quote, "Keep");
});

test("TrajectoryManager.runTrajectory: tolerates non-array retrievedChunks result", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");
  const { TrajectoryManager } = await import("../../../js/agents/stages/deepsearch/trajectory.js");

  const state = new DeepSearchState({
    runId: "run_nonarray",
    taskGoal: "t",
    iteration: 0,
    maxIterations: 1,
    userConfig: { gaps: { blockAfterMisses: 10 } },
    L1: { gaps: [{ gapId: "gap_1", type: "t", question: "q", status: "open" }], claims: [], evidenceLedger: [], conflicts: [] },
    L2: { retrievedChunks: [] },
  });
  state.trajectoryId = "traj_0";

  const manager = new TrajectoryManager({ n: 1 });
  await manager.runTrajectory(
    state,
    {
      runContext: { runId: "run_nonarray" },
      runGapsStage: async () => {},
      runRetrieveStage: async () => ({ retrievedChunks: null }),
      runUnderstandStage: async () => {},
    },
    {}
  );

  assert.equal(state.iteration, 1);
});

test("TrajectoryManager.runTrajectory: exits early when no open gaps", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");
  const { TrajectoryManager } = await import("../../../js/agents/stages/deepsearch/trajectory.js");

  const state = new DeepSearchState({
    runId: "run_no_gaps",
    iteration: 0,
    maxIterations: 5,
    L1: { gaps: [], claims: [], evidenceLedger: [], conflicts: [], openQuestions: [] },
    L2: { retrievedChunks: [] },
  });
  state.trajectoryId = "traj_0";

  let retrieveCalls = 0;
  const manager = new TrajectoryManager({ n: 1 });
  await manager.runTrajectory(
    state,
    {
      runContext: { runId: "run_no_gaps" },
      runGapsStage: async () => {},
      runRetrieveStage: async () => {
        retrieveCalls++;
        return { retrievedChunks: [] };
      },
      runUnderstandStage: async () => {},
    },
    {}
  );

  assert.equal(retrieveCalls, 0);
  assert.equal(state.iteration, 0);
});

test("TrajectoryManager.runTrajectory: emit provided but checkpoint absent", async () => {
  const { TrajectoryManager } = await import("../../../js/agents/stages/deepsearch/trajectory.js");

  const trajectory = {
    trajectoryId: "traj_plain",
    iteration: 0,
    maxIterations: 2,
    userConfig: { gaps: { blockAfterMisses: 10 } },
    L1: { gaps: [{ gapId: "g1", type: "t", question: "q", status: "open", missCount: 0 }], claims: [], evidenceLedger: [], conflicts: [] },
    L2: { retrievedChunks: [] },
    todos: [],
  };

  let emitted = 0;
  const manager = new TrajectoryManager({ n: 1 });
  await manager.runTrajectory(
    trajectory,
    {
      runContext: { runId: "run_plain" },
      runGapsStage: async () => {},
      runRetrieveStage: async () => ({ retrievedChunks: [] }),
      runUnderstandStage: async () => {},
      emit: () => {
        emitted++;
      },
    },
    {}
  );

  assert.equal(emitted, 2);
  assert.equal(trajectory.iteration, 2);
});

test("TrajectoryManager.runTrajectory: breaks when gaps are filled and covers duplicate-hit branch", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");
  const { TrajectoryManager } = await import("../../../js/agents/stages/deepsearch/trajectory.js");

  // Case 1: fill gap -> break via openGaps==0
  {
    const state = new DeepSearchState({
      runId: "run_fill_break",
      iteration: 0,
      maxIterations: 5,
      userConfig: { gaps: { blockAfterMisses: 10 } },
      L1: { gaps: [{ gapId: "g1", type: "t", question: "q", status: "open" }], claims: [], evidenceLedger: [], conflicts: [] },
      L2: { retrievedChunks: [] },
    });
    state.trajectoryId = "traj_0";

    const manager = new TrajectoryManager({ n: 1 });
    await manager.runTrajectory(
      state,
      {
        runContext: { runId: "run_fill_break" },
        runGapsStage: async () => {},
        runRetrieveStage: async (_ctx, { state: s }) => {
          s.L2.retrievedChunks = [{ chunkId: "c1", gapId: "g1", sourceId: "s1", locator: { charStart: 0, charEnd: 2 }, text: "hi" }];
          return { retrievedChunks: s.L2.retrievedChunks };
        },
        runUnderstandStage: async (_ctx, { state: s }) => {
          s.L1.evidenceLedger = [{ evidenceId: "e1", chunkId: "c1" }];
        },
      },
      {}
    );
    assert.equal(state.iteration, 1);
    assert.equal(state.L1.gaps[0].status, "filled");
  }

  // Case 2: duplicate hit signatures -> "already seen" branch + noNewHitsRounds break
  {
    const state = new DeepSearchState({
      runId: "run_dup_break",
      iteration: 0,
      maxIterations: 10,
      userConfig: { gaps: { blockAfterMisses: 10 } },
      L1: { gaps: [{ gapId: "g1", type: "t", question: "q", status: "open" }], claims: [], evidenceLedger: [], conflicts: [] },
      L2: { retrievedChunks: [] },
    });
    state.trajectoryId = "traj_0";

    const manager = new TrajectoryManager({ n: 1 });
    await manager.runTrajectory(
      state,
      {
        runContext: { runId: "run_dup_break" },
        runGapsStage: async () => {},
        runRetrieveStage: async (_ctx, { state: s }) => {
          s.L2.retrievedChunks = [{ chunkId: "c1", gapId: "g1", sourceId: "s1", locator: { charStart: 0, charEnd: 2 }, text: "hi" }];
          return { retrievedChunks: s.L2.retrievedChunks };
        },
        runUnderstandStage: async (_ctx, { state: s }) => {
          s.L1.evidenceLedger = []; // keep gap open
        },
      },
      {}
    );
    assert.equal(state.iteration, 3);
    assert.equal(state.L1.gaps[0].status, "open");
  }
});

test("TrajectoryManager.runTrajectory: reflect-driven external search trigger (success/skip/error)", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");
  const { TrajectoryManager } = await import("../../../js/agents/stages/deepsearch/trajectory.js");

  const mkState = ({ question = "q", runId = "run_extsearch", maxIterations = 2 } = {}) => {
    const state = new DeepSearchState({
      runId,
      iteration: 0,
      maxIterations,
      userConfig: { externalSearch: { enabled: true, autoTrigger: true } },
      L1: { gaps: [{ gapId: "gap_1", type: "t", question, status: "open" }], claims: [], evidenceLedger: [], conflicts: [], openQuestions: [] },
      L2: { retrievedChunks: [], logs: [] },
    });
    state.trajectoryId = "traj_ext";
    return state;
  };

  // Success path (suggestedQueries -> runExternalSearch + second understand call)
  {
    const state = mkState({ runId: "run_extsearch_ok", maxIterations: 1 });
    const events = [];
    const manager = new TrajectoryManager({ n: 1 });

    let understandCalls = 0;
    let externalCalls = 0;
    await manager.runTrajectory(
      state,
      {
        runContext: { runId: "run_extsearch_ok" },
        emit: (name, payload) => events.push({ name, payload }),
        runGapsStage: async () => {},
        runRetrieveStage: async () => ({ retrievedChunks: [] }),
        runUnderstandStage: async () => {
          understandCalls++;
          return {
            reflectResult: {
              sufficient: false,
              reason: "need more",
              confidence: 0.2,
              suggestedQueries: ["Alpha", "Beta"],
            },
          };
        },
        runExternalSearch: async (searchGaps) => {
          externalCalls++;
          assert.equal(searchGaps.length, 2);
          assert.ok(searchGaps.every((g) => g.gapId === "gap_1" && g.type === "external"));
        },
      },
      {}
    );

    assert.equal(externalCalls, 1);
    assert.equal(understandCalls, 2);
    assert.ok(events.some((e) => e.name === "deepsearch.external.reflecttriggered"));
  }

  // Skipped path (open gaps exist, but gap question/text empty -> no_valid_search_queries)
  {
    const state = mkState({ runId: "run_extsearch_skip", question: "", maxIterations: 1 });
    const events = [];
    const manager = new TrajectoryManager({ n: 1 });

    await manager.runTrajectory(
      state,
      {
        runContext: { runId: "run_extsearch_skip" },
        emit: (name, payload) => events.push({ name, payload }),
        runGapsStage: async () => {},
        runRetrieveStage: async () => ({ retrievedChunks: [] }),
        runUnderstandStage: async () => ({ reflectResult: { sufficient: false, reason: "need more", confidence: 0.2, suggestedQueries: [] } }),
        runExternalSearch: async () => {
          throw new Error("should not run");
        },
      },
      {}
    );

    assert.ok(events.some((e) => e.name === "deepsearch.external.skipped" && e.payload?.reason === "no_valid_search_queries"));
  }

  // Error path (runExternalSearch throws; handled via deepsearch.external.error)
  {
    const state = mkState({ runId: "run_extsearch_err", maxIterations: 1 });
    const events = [];
    const manager = new TrajectoryManager({ n: 1 });

    await manager.runTrajectory(
      state,
      {
        runContext: { runId: "run_extsearch_err" },
        emit: (name, payload) => events.push({ name, payload }),
        runGapsStage: async () => {},
        runRetrieveStage: async () => ({ retrievedChunks: [] }),
        runUnderstandStage: async () => ({ reflectResult: { sufficient: false, reason: "need more", confidence: 0.2, suggestedQueries: ["Alpha"] } }),
        runExternalSearch: async () => {
          throw new Error("boom");
        },
      },
      {}
    );

    assert.ok(events.some((e) => e.name === "deepsearch.external.error" && String(e.payload?.message || "").includes("boom")));
  }
});

test("TrajectoryManager.runTrajectory: emits failed completion and rethrows errors", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");
  const { TrajectoryManager } = await import("../../../js/agents/stages/deepsearch/trajectory.js");

  const state = new DeepSearchState({
    runId: "run_traj_fail",
    iteration: 0,
    maxIterations: 2,
    L1: { gaps: [{ gapId: "gap_1", type: "t", question: "q", status: "open" }], claims: [], evidenceLedger: [], conflicts: [], openQuestions: [] },
    L2: { retrievedChunks: [] },
  });
  state.trajectoryId = "traj_fail";

  const events = [];
  const manager = new TrajectoryManager({ n: 1 });

  await assert.rejects(
    () =>
      manager.runTrajectory(
        state,
        {
          runContext: { runId: "run_traj_fail" },
          emit: (name, payload) => events.push({ name, payload }),
          runGapsStage: async () => {},
          runRetrieveStage: async () => ({ retrievedChunks: [] }),
          runUnderstandStage: async () => {
            throw new Error("understand exploded");
          },
        },
        {}
      ),
    /understand exploded/
  );

  const failed = events.filter((e) => e.name === "deepsearch.trajectory.completed");
  assert.equal(failed.length >= 1, true);
  assert.equal(failed.at(-1).payload?.outcome, "failed");
  assert.ok(String(failed.at(-1).payload?.error?.message || "").includes("understand exploded"));
});

test("trajectory.__test helpers: validateIteration, mergeGaps, signatures, ids", async () => {
  const { __test } = await import("../../../js/agents/stages/deepsearch/trajectory.js");

  assert.ok(__test.signatureForRetrievedChunk({ gapId: "g1", sourceId: "s1" }).endsWith("-1--1"));

  {
    const updates = [];
    const state = {
      iteration: 0,
      planningTree: {
        getNodesForGap: (gapId) => {
          if (gapId === "g2") return [{ planNodeId: "plan_g2" }];
          if (gapId === "g3") return null;
          return [];
        },
        updateStatus: (nodeId, status) => updates.push({ nodeId, status }),
      },
      addTimeline: () => {},
      L1: {
        gaps: [
          { gapId: "g1", type: "t", question: "q1", status: "open", missCount: 1 },
          { gapId: "g2", type: "t", question: "q2", status: "filled" },
          { gapId: "g3", type: "t", question: "q3", status: "blocked" },
        ],
        evidenceLedger: [],
      },
      L2: {
        retrievedChunks: [
          { chunkId: "c1", gapId: "g1", sourceId: "s1", locator: { charStart: 0, charEnd: 2 }, text: "hi", score: 0.9 },
          { chunkId: "", gapId: "g1", sourceId: "s1", locator: { charStart: 0, charEnd: 2 }, text: "skip_chunkid" },
          { chunkId: "c2", gapId: "", sourceId: "s1", locator: { charStart: 0, charEnd: 2 }, text: "skip_gapid" },
        ],
      },
      todos: [
        { todoId: "t1", relatedGapId: "g1", status: "open", text: "x" },
        { todoId: "t2", relatedGapId: "g2", status: "open", text: "y" },
      ],
    };

    const out = __test.validateIteration(state, { blockAfterMisses: 2 });
    assert.equal(out.openCount, 1);
    assert.equal(state.L1.gaps[0].status, "open");
    assert.equal(state.L1.gaps[0].missCount, 0);
    assert.equal(state.todos.find((t) => t.relatedGapId === "g2").status, "completed");
    assert.equal(updates.length, 1);
    assert.equal(updates[0].status, "completed");
  }

  {
    const state = {
      iteration: 0,
      addTimeline: () => {},
      L1: { gaps: [{ gapId: "g1", type: "t", question: "q", status: "open", missCount: 1 }], evidenceLedger: [] },
      L2: { retrievedChunks: [] },
      todos: null,
    };
    __test.validateIteration(state, { blockAfterMisses: 2 });
    assert.equal(state.L1.gaps[0].status, "blocked");
  }

  {
    const state = {
      iteration: 3,
      addTimeline: () => {},
      L1: {
        gaps: [{ gapId: "g1", type: "t", question: "q", status: "open", missCount: 0 }],
        evidenceLedger: [
          { evidenceId: "e_missing", chunkId: "c_missing" },
          { evidenceId: "e1", chunkId: "c1" },
        ],
      },
      L2: { retrievedChunks: [{ chunkId: "c1", gapId: "g1", sourceId: "s1", locator: { charStart: 0, charEnd: 2 }, text: "hi" }] },
      todos: [{ todoId: "t1", relatedGapId: "g1", status: "open", text: "x" }],
    };
    __test.validateIteration(state, { blockAfterMisses: 2 });
    assert.equal(state.L1.gaps[0].status, "filled");
    assert.equal(state.todos[0].status, "completed");
  }

  {
    const a = { L1: { gaps: [{ gapId: "g1", type: "t", question: "q", status: "open", missCount: 5 }] } };
    const b = { L1: { gaps: [{ gapId: "g1", type: "t", question: "q", status: "open", missCount: 1 }] } };
    const { gaps, gapIdMapping } = __test.mergeGaps([a, b]);
    assert.equal(gaps.length, 1);
    assert.equal(gaps[0].missCount, 1);
    assert.equal(gapIdMapping.get("g1"), "gap_1");
  }

  {
    // gapKey default branches (missing type/question)
    const { gaps, gapIdMapping } = __test.mergeGaps([{ L1: { gaps: [{ gapId: "g1", status: "filled" }] } }]);
    assert.equal(gaps.length, 1);
    assert.equal(gapIdMapping.get("g1"), "gap_1");
  }

  {
    const a = { L2: { retrievedChunks: [{ chunkId: "c1", gapId: "g1", sourceId: "s1", locator: { charStart: 0, charEnd: 2 }, text: "hi" }] } };
    const b = { L2: { retrievedChunks: [{ chunkId: "c1", gapId: "g1", sourceId: "s1", locator: { charStart: 0, charEnd: 2 }, text: "hi", retrievedId: "keep" }] } };
    const merged = __test.mergeRetrievedChunks([a, b]);
    assert.equal(merged.length, 1);
    assert.ok(typeof merged[0].retrievedId === "string" && merged[0].retrievedId.length > 0);
  }

  {
    const { claims, evidenceLedger } = __test.withUniqueIds({
      L1: { claims: [{ text: "x", evidenceIds: null, gapIds: ["g1"] }], evidenceLedger: [{ sourceId: "s1", quote: "q", gapIds: ["g1"] }] },
    });
    assert.equal(claims[0].claimId.startsWith("traj::"), true);
    assert.deepEqual(claims[0].evidenceIds, []);
    assert.deepEqual(claims[0].gapIds, ["g1"]);
    assert.equal(evidenceLedger[0].evidenceId.startsWith("traj::"), true);
    assert.deepEqual(evidenceLedger[0].gapIds, ["g1"]);
  }

  {
    const { claims, evidenceLedger } = __test.withUniqueIds({ L1: { claims: null, evidenceLedger: null } });
    assert.deepEqual(claims, []);
    assert.deepEqual(evidenceLedger, []);
  }
});

test("TrajectoryManager.mergeVote: chooses best claim by score and keeps gapIds", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");
  const { TrajectoryManager } = await import("../../../js/agents/stages/deepsearch/trajectory.js");

  const mk = (trajectoryId, { importance, evidenceIds, gapIds } = {}) =>
    new DeepSearchState({
      runId: "run_vote_winner",
      trajectoryId,
      iteration: 1,
      L1: {
        gaps: [{ gapId: "gap_1", type: "t", question: "q", status: "filled" }],
        claims: [{ claimId: "c_1", text: "Alpha is defined.", importance, evidenceIds, ...(gapIds ? { gapIds } : {}) }],
        evidenceLedger: (evidenceIds || []).map((evidenceId, idx) => ({
          evidenceId,
          chunkId: `c${idx + 1}`,
          sourceId: "s1",
          locator: { charStart: idx, charEnd: idx + 1 },
          quote: `q${idx + 1}`,
          ...(gapIds ? { gapIds } : {}),
        })),
        conflicts: [],
        openQuestions: [],
      },
      L2: { retrievedChunks: [] },
    });

  const t0 = mk("traj_0", { importance: "support", evidenceIds: ["e_1"], gapIds: [] });
  const t1 = mk("traj_1", { importance: "core", evidenceIds: ["e_1", "e_2"], gapIds: ["gap_1"] }); // should win
  const t2 = mk("traj_2", { importance: "weird", evidenceIds: ["e_1"], gapIds: ["gap_1"] });

  const manager = new TrajectoryManager({ n: 3, mergeStrategy: "vote" });
  manager.trajectories = [t0, t1, t2];
  const merged = manager.mergeVote();

  assert.equal(merged.L1.claims.length, 1);
  assert.equal(merged.L1.claims[0].importance, "core");
  assert.ok(Array.isArray(merged.L1.claims[0].gapIds) && merged.L1.claims[0].gapIds.includes("gap_1"));
  assert.ok(merged.L1.claims[0].evidenceIds.length >= 2);
  assert.ok(merged.L1.evidenceLedger.length >= 2);
});

test("TrajectoryManager.mergeUnion: rewrites gapId references after mergeGaps reindex", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");
  const { TrajectoryManager } = await import("../../../js/agents/stages/deepsearch/trajectory.js");

  const mk = (trajectoryId, { q1GapId, q2GapId } = {}) =>
    new DeepSearchState({
      runId: "run_gap_remap",
      trajectoryId,
      iteration: 1,
      L0: { sources: [{ sourceId: "s1", kind: "user_text", title: "Input", sourceTextNormalized: "x" }] },
      L1: {
        gaps: [
          { gapId: q1GapId, type: "t", question: "A", status: "open" },
          { gapId: q2GapId, type: "t", question: "B", status: "open" },
        ],
        claims: [
          { claimId: "c_1", text: `Claim A (${trajectoryId})`, evidenceIds: ["e_1"], gapIds: [q1GapId] },
          { claimId: "c_2", text: `Claim B (${trajectoryId})`, evidenceIds: ["e_2"], gapIds: [q2GapId] },
        ],
        evidenceLedger: [
          { evidenceId: "e_1", chunkId: "c1", sourceId: "s1", locator: { charStart: 0, charEnd: 1 }, quote: "x", gapIds: [q1GapId] },
          { evidenceId: "e_2", chunkId: "c2", sourceId: "s1", locator: { charStart: 1, charEnd: 2 }, quote: "y", gapIds: [q2GapId] },
        ],
        conflicts: [],
        openQuestions: [],
      },
      L2: {
        retrievedChunks: [
          {
            chunkId: `${trajectoryId}::cA`,
            gapId: q1GapId,
            matchedGapIds: [q1GapId],
            sourceId: "s1",
            locator: { charStart: 0, charEnd: 1 },
            text: "x",
          },
          {
            chunkId: `${trajectoryId}::cB`,
            gapId: q2GapId,
            matchedGapIds: [q2GapId],
            sourceId: "s1",
            locator: { charStart: 1, charEnd: 2 },
            text: "y",
          },
        ],
      },
    });

  // Same gap keys across trajectories, but different old ids -> mapping must cover all old ids.
  const t0 = mk("traj_0", { q1GapId: "gap_old_A0", q2GapId: "gap_old_B0" });
  const t1 = mk("traj_1", { q1GapId: "gap_old_A1", q2GapId: "gap_old_B1" });

  const manager = new TrajectoryManager({ n: 2, mergeStrategy: "union" });
  manager.trajectories = [t0, t1];
  const merged = manager.mergeUnion();

  const mergedGapIds = new Set(merged.L1.gaps.map((g) => g.gapId));
  assert.deepEqual([...mergedGapIds].sort(), ["gap_1", "gap_2"]);

  // All references point at valid merged gaps.
  for (const c of merged.L1.claims) for (const gid of c.gapIds || []) assert.ok(mergedGapIds.has(gid));
  for (const e of merged.L1.evidenceLedger) for (const gid of e.gapIds || []) assert.ok(mergedGapIds.has(gid));
  for (const r of merged.L2.retrievedChunks) {
    assert.ok(mergedGapIds.has(r.gapId));
    for (const gid of r.matchedGapIds || []) assert.ok(mergedGapIds.has(gid));
  }

  // Old ids are rewritten to the canonical ids derived from gap keys.
  const claimA1 = merged.L1.claims.find((c) => c.text === "Claim A (traj_1)");
  const claimB1 = merged.L1.claims.find((c) => c.text === "Claim B (traj_1)");
  assert.deepEqual(claimA1.gapIds, ["gap_1"]);
  assert.deepEqual(claimB1.gapIds, ["gap_2"]);
});

test("trajectory.__test extra coverage: statusRank, evidenceKey, mergeConflicts, reindex, claimScore", async () => {
  const { __test } = await import("../../../js/agents/stages/deepsearch/trajectory.js");

  assert.equal(__test.statusRank("filled"), 2);
  assert.equal(__test.statusRank("open"), 1);
  assert.equal(__test.statusRank("blocked"), 0);
  assert.equal(__test.statusRank("weird"), 1);

  assert.equal(__test.evidenceKey({ sourceId: "s1", locator: { charStart: 0, charEnd: 1 }, quote: "x" }), "s1::0-1");
  assert.equal(__test.evidenceKey({ sourceId: "s1", locator: null, quote: "x" }), "s1::x");
  assert.equal(__test.evidenceKey({ sourceId: "s1", locator: { charStart: 0 }, quote: "x" }), "s1::x");

  {
    const merged = __test.mergeConflicts([{ L1: { conflicts: [{ a: 1 }, { a: 1 }] } }, { L1: { conflicts: null } }]);
    assert.equal(merged.length, 1);
  }

  {
    const merged = __test.mergeOpenQuestions([{ L1: { openQuestions: [{ q: 1 }, { q: 1 }] } }, { L1: { openQuestions: [] } }]);
    assert.equal(merged.length, 1);
  }

  {
    const claims = [
      { claimId: "c0", text: "x", importance: "core", evidenceIds: ["eA", "eB"] },
      { claimId: "c1", text: "y", importance: "support", evidenceIds: ["eMissing"] },
    ];
    const evidenceLedger = [
      { evidenceId: "eA", sourceId: "s1", locator: { charStart: 0, charEnd: 1 }, quote: "x" },
      { evidenceId: "eB", sourceId: "s1", locator: { charStart: 0, charEnd: 1 }, quote: "x_dup" }, // duplicate key -> existingId path
      { evidenceId: "eUnused", sourceId: "s1", locator: { charStart: 2, charEnd: 3 }, quote: "u" },
    ];
    const out = __test.reindexEvidenceAndClaims(claims, evidenceLedger);
    assert.equal(out.claims.length, 1);
    assert.equal(out.evidenceLedger.length, 1);
    assert.equal(out.claims[0].evidenceIds.length, 1);
  }

  assert.ok(__test.claimScoreForVote({ importance: "core", evidenceIds: ["e1", "e2"] }) > __test.claimScoreForVote({ importance: "support", evidenceIds: ["e1"] }));
  assert.ok(__test.claimScoreForVote({ importance: "unknown", evidenceIds: [] }) <= __test.claimScoreForVote({ importance: "support", evidenceIds: [] }));

  {
    const state = {
      iteration: 0,
      addTimeline: () => {},
      L1: { gaps: [{ type: "t", question: "missing gapId", status: "open" }], evidenceLedger: [] },
      L2: { retrievedChunks: [] },
      todos: [],
    };
    const out = __test.validateIteration(state, { blockAfterMisses: 1 });
    assert.equal(out.openCount, 1);
  }

  {
    const state = {
      iteration: 0,
      addTimeline: () => {},
      L1: { gaps: [{ gapId: "g1", type: "t", question: "q", status: "open", missCount: 1, blockedReason: "custom" }], evidenceLedger: [] },
      L2: { retrievedChunks: [] },
      todos: [{ todoId: "t1", relatedGapId: "g1", status: "open", text: "x" }],
    };
    __test.validateIteration(state, { blockAfterMisses: 2 });
    assert.equal(state.L1.gaps[0].status, "blocked");
    assert.equal(state.L1.gaps[0].blockedReason, "custom");
    assert.equal(state.todos[0].status, "cancelled");
  }

  {
    const updates = [];
    const state = {
      iteration: 0,
      planningTree: {
        getNodesForGap: () => [{}], // no nodeId/planNodeId -> should skip updateStatus
        updateStatus: () => updates.push("called"),
      },
      addTimeline: () => {},
      L1: { gaps: [{ gapId: "g1", type: "t", question: "q", status: "filled" }], evidenceLedger: [] },
      L2: { retrievedChunks: [] },
      todos: [],
    };
    __test.validateIteration(state, { blockAfterMisses: 1 });
    assert.equal(updates.length, 0);
  }
});

test("state.normalizeBudgetConfig: defaults, validation, and prices merge", async () => {
  const { normalizeBudgetConfig } = await import("../../../js/agents/stages/deepsearch/state.js");

  {
    const cfg = normalizeBudgetConfig();
    assert.equal(cfg.maxTokens, 50_000);
    assert.equal(cfg.maxCostUSD, 0.5);
    assert.equal(cfg.warnAt, 0.8);
    assert.equal(cfg.action, "warn");
    assert.ok(cfg.prices && typeof cfg.prices === "object");
    assert.ok(cfg.prices["gpt-4o-mini"] && typeof cfg.prices["gpt-4o-mini"].input === "number");
  }

  {
    const cfg = normalizeBudgetConfig({ maxTokens: 10.9, maxCostUSD: 1.23, warnAt: 1.5, action: "stop" });
    assert.equal(cfg.maxTokens, 10);
    assert.equal(cfg.maxCostUSD, 1.23);
    assert.equal(cfg.warnAt, 1);
    assert.equal(cfg.action, "stop");
  }

  {
    const cfg = normalizeBudgetConfig({
      prices: {
        "gpt-4o-mini": { input: 9, output: 8 },
        "custom-model": { input: 0.1, output: 0.2 },
      },
    });
    assert.deepEqual(cfg.prices["gpt-4o-mini"], { input: 9, output: 8 });
    assert.deepEqual(cfg.prices["custom-model"], { input: 0.1, output: 0.2 });
    assert.ok(cfg.prices["gpt-4o"] && typeof cfg.prices["gpt-4o"].input === "number");
  }

  {
    const cfg = normalizeBudgetConfig({
      maxTokens: "nope",
      maxCostUSD: -1,
      warnAt: "bad",
      action: "bad",
      prices: { "": { input: 1 }, x: "nope", y: { input: "bad" } },
    });
    assert.equal(cfg.maxTokens, 50_000);
    assert.equal(cfg.maxCostUSD, 0.5);
    assert.equal(cfg.warnAt, 0.8);
    assert.equal(cfg.action, "warn");
    assert.equal("y" in cfg.prices, false);
  }
});

test("state.computeRoundHitsByGapId: precedence, fallback, and accumulation", async () => {
  const { computeRoundHitsByGapId } = await import("../../../js/agents/stages/deepsearch/state.js");

  {
    const { allHits, qualityHits } = computeRoundHitsByGapId([]);
    assert.equal(allHits instanceof Map, true);
    assert.equal(qualityHits instanceof Map, true);
    assert.equal(allHits.size, 0);
    assert.equal(qualityHits.size, 0);
  }

  {
    const { allHits, qualityHits } = computeRoundHitsByGapId([{ gapId: "gap_1", score: 0.6 }]);
    assert.equal(allHits.get("gap_1"), 1);
    assert.equal(qualityHits.get("gap_1"), 1);
  }

  {
    const { allHits, qualityHits } = computeRoundHitsByGapId([{ gapId: "gap_a", matchedGapIds: ["gap_b"], score: 1 }]);
    assert.equal(allHits.get("gap_b"), 1);
    assert.equal(allHits.has("gap_a"), false);
    assert.equal(qualityHits.get("gap_b"), 1);
    assert.equal(qualityHits.has("gap_a"), false);
  }

  {
    const { allHits, qualityHits } = computeRoundHitsByGapId([
      { gapId: "g", score: 0.4 },
      { gapId: "g", score: 0.6 },
      { matchedGapIds: ["g", "h"], score: 0.9 },
    ]);
    assert.equal(allHits.get("g"), 3);
    assert.equal(allHits.get("h"), 1);
    assert.equal(qualityHits.get("g"), 2);
    assert.equal(qualityHits.get("h"), 1);
  }
});

test("DeepSearchState methods: reopenGaps, addNewGaps, saveWriteSnapshot", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");

  {
    const state = new DeepSearchState({
      runId: "run_state_reopen",
      iteration: 3,
      L1: {
        gaps: [
          { gapId: "gap_1", type: "t", question: "q1", status: "filled", missCount: 5, filledAt: "t0", filledIteration: 1 },
          { gapId: "gap_2", type: "t", question: "q2", status: "blocked", missCount: 2, blockedAt: "t1", blockedReason: "custom" },
          { gapId: "gap_3", type: "t", question: "q3", status: "open", missCount: 9 },
        ],
      },
      todos: [
        { todoId: "todo_1", relatedGapId: "gap_1", status: "completed", text: "x" },
        { todoId: "todo_2", relatedGapId: "gap_2", status: "cancelled", text: "y" },
        { todoId: "todo_3", relatedGapId: "gap_3", status: "open", text: "z" },
      ],
    });

    const updates = [];
    state.planningTree = {
      getNodesForGap: (gid) => [{ nodeId: `n_${gid}` }],
      updateStatus: (nodeId, status) => updates.push({ nodeId, status }),
    };

    const out = state.reopenGaps(["gap_1", "gap_2", "gap_missing"], { reason: "retry", timestamp: "2025-01-01T00:00:00.000Z" });
    assert.deepEqual(out.reopened.sort(), ["gap_1", "gap_2"]);
    assert.deepEqual(out.missing, ["gap_missing"]);

    const g1 = state.L1.gaps.find((g) => g.gapId === "gap_1");
    const g2 = state.L1.gaps.find((g) => g.gapId === "gap_2");
    const g3 = state.L1.gaps.find((g) => g.gapId === "gap_3");

    assert.equal(g1.status, "open");
    assert.equal(g1.missCount, 0);
    assert.equal(g1.reopenedAt, "2025-01-01T00:00:00.000Z");
    assert.equal(g1.reopenedReason, "retry");
    assert.equal("filledAt" in g1, false);
    assert.equal("filledIteration" in g1, false);

    assert.equal(g2.status, "open");
    assert.equal(g2.missCount, 0);
    assert.equal("blockedAt" in g2, false);
    assert.equal("blockedReason" in g2, false);

    assert.equal(g3.status, "open");
    assert.equal(g3.missCount, 9);

    assert.equal(state.todos.find((t) => t.todoId === "todo_1").status, "open");
    assert.equal(state.todos.find((t) => t.todoId === "todo_2").status, "open");
    assert.equal(state.todos.find((t) => t.todoId === "todo_3").status, "open");
    assert.deepEqual(
      updates
        .map((u) => `${u.nodeId}:${u.status}`)
        .sort(),
      ["n_gap_1:pending", "n_gap_2:pending"]
    );
  }

  {
    const expanded = [];
    const state = new DeepSearchState({
      runId: "run_state_add",
      L1: { gaps: [{ gapId: "gap_9", type: "t", question: "q", status: "open" }, { gapId: "custom", type: "t", question: "q", status: "open" }] },
    });
    state.planningTree = { expandFromGap: (gap) => expanded.push(gap.gapId) };

    const added = state.addNewGaps(
      [{ question: "New A" }, { question: "New B", priority: "high" }, { question: "   " }],
      { timestamp: "2025-01-02T00:00:00.000Z" }
    );

    assert.equal(added.length, 2);
    assert.deepEqual(
      added.map((g) => g.gapId),
      ["gap_10", "gap_11"]
    );
    assert.equal(new Set(added.map((g) => g.gapId)).size, 2);
    assert.equal(added[0].priority, "medium");
    assert.equal(added[1].priority, "high");
    assert.equal(added[0].createdAt, "2025-01-02T00:00:00.000Z");
    assert.equal(state.todos.length, 2);
    assert.equal(state.todos.every((t) => t.status === "open"), true);
    assert.deepEqual(expanded.sort(), ["gap_10", "gap_11"]);
  }

  {
    const state = new DeepSearchState({
      runId: "run_state_write_snapshot",
      iteration: 7,
      L1: { slideIntents: [{ slideId: "s1", title: "A" }], report: { markdown: "Hello", sections: [{ title: "T" }] } },
    });

    const snap = state.saveWriteSnapshot({ timestamp: "2025-01-03T00:00:00.000Z" });
    assert.equal(snap.snapshotId, "wcp_1");
    assert.equal(snap.iteration, 7);
    assert.equal(snap.timestamp, "2025-01-03T00:00:00.000Z");
    assert.equal(state.writeSnapshots.length, 1);

    state.L1.slideIntents[0].title = "CHANGED";
    state.L1.report.sections[0].title = "CHANGED";

    assert.equal(snap.slideIntents[0].title, "A");
    assert.equal(snap.report.sections[0].title, "T");
  }
});

test("model.getModelCaller: resolves pricing exact/prefix/wildcard and estimates cost delta", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");
  const { getModelCaller } = await import("../../../js/agents/stages/deepsearch/model.js");

  const mkStageApi = (result) => {
    const events = [];
    return {
      events,
      eventBus: {
        emit: (name, record) => events.push({ name, record }),
      },
      modelRouter: {
        call: async () => result,
      },
    };
  };

  const closeTo = (actual, expected, eps = 1e-12) => assert.ok(Math.abs(actual - expected) <= eps, `expected ${actual} ~= ${expected}`);

  {
    const stageApi = mkStageApi({ model: "m_exact", usage: { prompt_tokens: 1000, completion_tokens: 2000, total_tokens: 3000 }, content: "ok" });
    const state = new DeepSearchState({
      runId: "run_pricing_exact",
      userConfig: { budget: { maxTokens: 1e9, maxCostUSD: 1e9, prices: { m_exact: { input: 1, output: 2 }, "*": { input: 100, output: 100 } } } },
    });
    const callModel = getModelCaller(stageApi, { state });
    await callModel([{ role: "user", content: "hi" }], {});
    closeTo(state.L2.tokenUsage.estimatedCostUSD, 5);
  }

  {
    const stageApi = mkStageApi({
      model: "gpt-4o-mini-2024-07-18",
      usage: { prompt_tokens: 1000, completion_tokens: 2000, total_tokens: 3000 },
      content: "ok",
    });
    const state = new DeepSearchState({
      runId: "run_pricing_prefix",
      userConfig: { budget: { maxTokens: 1e9, maxCostUSD: 1e9, prices: { "gpt-4o": { input: 9, output: 9 }, "gpt-4o-mini": { input: 0.1, output: 0.2 } } } },
    });
    const callModel = getModelCaller(stageApi, { state });
    await callModel([{ role: "user", content: "hi" }], {});
    closeTo(state.L2.tokenUsage.estimatedCostUSD, 0.5);
  }

  {
    const stageApi = mkStageApi({ model: "unknown-model", usage: { prompt_tokens: 1000, completion_tokens: 2000, total_tokens: 3000 }, content: "ok" });
    const state = new DeepSearchState({
      runId: "run_pricing_wildcard",
      userConfig: { budget: { maxTokens: 1e9, maxCostUSD: 1e9, prices: { "*": { input: 0.01, output: 0.02 } } } },
    });
    const callModel = getModelCaller(stageApi, { state });
    await callModel([{ role: "user", content: "hi" }], {});
    closeTo(state.L2.tokenUsage.estimatedCostUSD, 0.05);
    assert.ok(stageApi.events.some((e) => e.name === "deepsearch.token.usage"));
  }
});

test("DeepSearchStage integration: userConfig.trajectory.n > 1 runs parallel and merges before write", async () => {
  const { DeepSearchStage } = await import("../../../js/agents/stages/deepsearch/index.js");
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");

  const sourceText = [
    "Definition: Alpha is a thing with clear scope.",
    "Statistics: Alpha adoption reached 42% in 2024.",
    "More: Evidence suggests continued growth.",
    "",
  ].join("\n");

  const state = new DeepSearchState({
    runId: "run_traj_integration",
    taskGoal: "Define Alpha and provide key metrics",
    maxIterations: 3,
    userConfig: {
      trajectory: { n: 2, mergeStrategy: "union" },
      gaps: { blockAfterMisses: 1 },
      retrieval: { topK: 3, windowSize: 0, useBm25: true, useGrep: true },
    },
    L0: { sources: [{ sourceId: "s1", kind: "user_text", title: "Input", sourceTextNormalized: sourceText }] },
  });

  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const stage = new DeepSearchStage();
  const pkg = await stage.execute({ runId: "run_traj_integration", mode: "deepsearch", constraints: {} }, { state }, { emit });

  assert.equal(pkg.mode, "deepsearch");
  assert.ok(Array.isArray(pkg.slideIntents) && pkg.slideIntents.length >= 4);
  assert.ok(Array.isArray(pkg.claims) && pkg.claims.length >= 1);
  assert.ok(Array.isArray(pkg.evidenceLedger) && pkg.evidenceLedger.length >= 1);
  assert.ok(state.trajectoryConfig && state.trajectoryConfig.n === 2);
  assert.ok(events.some((e) => e.name === "deepsearch.trajectory.forked"));
  assert.ok(events.some((e) => e.name === "deepsearch.trajectory.merged"));
});
