const test = require("node:test");
const assert = require("node:assert/strict");

async function makeStageAndState({ runId = "run_iter", taskGoal, sourceText, userConfig = {}, maxIterations, writeBacktrackCount = 3 } = {}) {
  const { DeepSearchStage } = await import("../../../js/agents/stages/deepsearch/index.js");
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");

  const state = new DeepSearchState({
    runId,
    taskGoal,
    userConfig,
    ...(typeof maxIterations === "number" ? { maxIterations } : {}),
    ...(typeof writeBacktrackCount === "number" ? { writeBacktrackCount } : {}),
    L0: {
      sources: [
        {
          sourceId: "s1",
          kind: "user_text",
          title: "Input",
          sourceTextNormalized: sourceText,
        },
      ],
    },
  });

  return { stage: new DeepSearchStage(), state };
}

function gapById(state, gapId) {
  const gaps = Array.isArray(state?.L1?.gaps) ? state.L1.gaps : [];
  return gaps.find((g) => g?.gapId === gapId);
}

test("DeepSearchState: extractJsonCandidate + cancellation + checkpoint errors", async () => {
  const { DeepSearchState, extractJsonCandidate, checkCancelled, makeStageEmitter } = await import("../../../js/agents/stages/deepsearch/state.js");

  assert.equal(extractJsonCandidate("```json\n{\"a\":1}\n```"), "{\"a\":1}");
  assert.equal(extractJsonCandidate("prefix {\"a\":1} suffix"), "{\"a\":1}");
  assert.equal(extractJsonCandidate("[]"), "[]");
  assert.equal(extractJsonCandidate("plain text"), "plain text");
  assert.equal(extractJsonCandidate(""), null);

  {
    const state = new DeepSearchState({ runId: "r_ser", taskGoal: "t" });
    const serialized = state.serialize({ pretty: true });
    const roundtrip = DeepSearchState.deserialize(serialized);
    assert.equal(roundtrip.runId, "r_ser");
    assert.equal(roundtrip.iteration, 0);
    assert.equal(roundtrip.maxIterations >= 1, true);
  }

  assert.throws(() => checkCancelled({ signal: { aborted: true, reason: "stop" } }), /stop/);
  assert.throws(() => checkCancelled({ signal: { aborted: true, reason: new Error("x") } }), /Run cancelled/);
  assert.doesNotThrow(() => checkCancelled({ checkCancelled: () => {} }));

  {
    const events = [];
    const emit = makeStageEmitter({ emit: (name, record) => events.push({ name, record }) }, "deepsearch");
    assert.ok(typeof emit === "function");
    emit("evt", { a: 1 }, { status: "started" });
    assert.equal(events[0].name, "evt");
    assert.equal(events[0].record.actor, "deepsearch");
    assert.equal(events[0].record.status, "started");
    assert.deepEqual(events[0].record.payload, { a: 1 });
  }

  {
    const state = new DeepSearchState({ runId: "r1" });
    assert.throws(() => state.restoreCheckpoint(""), /checkpointId is required/);
    assert.throws(() => state.restoreCheckpoint("missing"), /Checkpoint not found/);

    const cp = state.saveCheckpoint({ metrics: { gapCount: 1, claimCount: 2, evidenceCount: 3, retrievedCount: 4 } });
    assert.equal(cp.metrics.gapCount, 1);

    // Cover restore path where checkpoint.stateSnapshot is a plain object.
    const snap = state.checkpoints[0].stateSnapshot;
    state.checkpoints[0].stateSnapshot = typeof snap?.toJSON === "function" ? snap.toJSON({ includeCheckpoints: false }) : snap;
    state.restoreCheckpoint(cp.checkpointId);
  }
});

test("DeepSearch loop: validate updates gap status + checkpoints saved", async () => {
  const sourceText = ["Definition: Alpha is a thing.", "No figures here.", ""].join("\n");
  const { stage, state } = await makeStageAndState({
    taskGoal: "Define Alpha and provide key metrics",
    sourceText,
    userConfig: { gaps: { blockAfterMisses: 2 } },
    maxIterations: 5,
  });

  const pkg = await stage.execute({ runId: "run_iter", mode: "deepsearch", constraints: {} }, { state }, {});
  assert.equal(pkg.mode, "deepsearch");

  assert.equal(Array.isArray(state.checkpoints), true);
  assert.equal(state.checkpoints.length, 2);
  assert.equal(state.checkpoints[0].iteration, 0);
  assert.equal(state.checkpoints[1].iteration, 1);
  assert.ok(typeof state.checkpoints[0].timestamp === "string");
  assert.ok(state.checkpoints[0].stateSnapshot);
  assert.ok(state.checkpoints[0].metrics && typeof state.checkpoints[0].metrics.gapCount === "number");

  const g1 = gapById(state, "gap_1");
  const g2 = gapById(state, "gap_2");
  assert.ok(g1 && g2);
  assert.equal(g1.status, "filled");
  assert.equal(g2.status, "blocked");
  assert.equal(g2.missCount, 2);

  assert.equal(state.iteration, 2);
});

test("DeepSearch checkpoints: restoreCheckpoint rewinds gaps + iteration", async () => {
  const sourceText = ["Definition: Alpha is a thing.", "No figures here.", ""].join("\n");
  const { stage, state } = await makeStageAndState({
    runId: "run_restore",
    taskGoal: "Define Alpha and provide key metrics",
    sourceText,
    userConfig: { gaps: { blockAfterMisses: 2 } },
    maxIterations: 5,
  });

  await stage.execute({ runId: "run_restore", mode: "deepsearch", constraints: {} }, { state }, {});
  assert.equal(state.checkpoints.length, 2);

  const cp0 = state.checkpoints[0];
  state.restoreCheckpoint(cp0.checkpointId);

  assert.equal(state.iteration, 0);
  const g1 = gapById(state, "gap_1");
  const g2 = gapById(state, "gap_2");
  assert.ok(g1 && g2);
  assert.equal(g1.status, "filled");
  assert.equal(g2.status, "open");
  assert.equal(g2.missCount, 1);
});

test("DeepSearch gaps: incremental merge keeps existing + adds openQuestions", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchGapsStage, __test: gapsTest } = await import("../../../js/agents/stages/deepsearch/gaps.js");

  const state = new DeepSearchState({
    runId: "run_gaps",
    taskGoal: "Compare Alpha vs Beta; explain mechanism; give example",
    L0: { sources: [] },
    L1: {
      scanSummary: { keyTopics: ["Alpha", "Beta"] },
      gaps: [{ type: "definition", question: "What are the core definitions and scope?" }], // missing gapId
      openQuestions: [],
    },
  });

  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const first = await runDeepSearchGapsStage({ runId: "run_gaps" }, { state }, { emit });
  assert.ok(first.gaps.length >= 5);
  assert.equal(first.todos.length, first.gaps.length);
  assert.ok(first.gaps.every((g) => typeof g.gapId === "string" && g.gapId.length > 0));
  assert.ok(first.gaps.every((g) => ["open", "filled", "blocked"].includes(g.status)));

  await assert.rejects(runDeepSearchGapsStage({ runId: "run_gaps" }, {}, {}), /input\.state is required/);
  assert.equal(gapsTest.gapKey({ type: "t", question: "q" }), "t::q");
  assert.equal(gapsTest.gapKey({}), "unknown::");
  assert.equal(gapsTest.normalizeGap(null, "g1"), null);
  assert.equal(gapsTest.normalizeGap({ gapId: "g1", type: "t", question: "" }, "g2"), null);
  assert.equal(gapsTest.normalizeGap({ gapId: "g1", type: "t", question: "q", status: "weird" }, "g2").status, "open");

  const makeId = gapsTest.nextGapId([{ gapId: "gap_9" }, { gapId: "gap_10" }], 1);
  assert.equal(makeId(), "gap_11");
  assert.equal(gapsTest.gap("g1", "t", "q", { missCount: Number.NaN }).missCount, undefined);

  state.L1.openQuestions = [{ questionId: "q_1", status: "open", question: "What is Gamma?" }];
  const second = await runDeepSearchGapsStage({ runId: "run_gaps" }, { state }, { emit });
  assert.ok(second.gaps.length > first.gaps.length);
  assert.equal(second.todos.length, 1); // only new gap creates a new todo
  assert.ok(second.gaps.some((g) => g.type === "question" && g.question === "What is Gamma?"));
});

test("DeepSearch validateIteration helper: hit/no-evidence keeps open, blockAfterMisses blocks, evidence fills", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");
  const { __test } = await import("../../../js/agents/stages/deepsearch/index.js");

  {
    const state = new DeepSearchState({
      runId: "run_validate_hit",
      userConfig: { gaps: { blockAfterMisses: 2 } },
      iteration: 0,
    });
    state.L1.gaps = [
      { gapId: "g1", type: "x", question: "q", status: "open", missCount: 1 },
      { gapId: "g2", type: "x", question: "q2", status: "filled" },
      { gapId: "g3", type: "x", question: "q3", status: "blocked" },
    ];
    state.L2.retrievedChunks = [{ chunkId: "c1", gapId: "g1", sourceId: "s1", locator: { charStart: 0, charEnd: 2 }, text: "hi" }];
    state.L1.evidenceLedger = []; // simulate no evidence linked
    state.todos = [
      { todoId: "t1", relatedGapId: "g1", status: "open", text: "x" },
      { todoId: "t2", relatedGapId: "g2", status: "open", text: "y" },
      { todoId: "t3", relatedGapId: "g3", status: "open", text: "z" },
    ];

    const out = __test.validateIteration(state, { blockAfterMisses: 2, roundHits: { g1: 1 } });
    assert.equal(out.openCount, 1);
    assert.equal(state.L1.gaps[0].status, "open");
    assert.equal(state.L1.gaps[0].missCount, 0);
    assert.equal(state.todos.find((t) => t.relatedGapId === "g2").status, "done");
    assert.equal(state.todos.find((t) => t.relatedGapId === "g3").status, "blocked");
  }

  {
    const state = new DeepSearchState({ runId: "run_validate_block", iteration: 0 });
    state.L1.gaps = [{ gapId: "g1", type: "x", question: "q", status: "open", missCount: 1 }];
    state.L2.retrievedChunks = [];
    state.L1.evidenceLedger = [];
    state.todos = [{ todoId: "t1", relatedGapId: "g1", status: "open", text: "x" }];

    const out = __test.validateIteration(state, { blockAfterMisses: 2, roundHits: {} });
    assert.equal(out.openCount, 0);
    assert.equal(state.L1.gaps[0].status, "blocked");
    assert.equal(state.todos[0].status, "blocked");
  }

  {
    const state = new DeepSearchState({ runId: "run_validate_fill", iteration: 3 });
    state.L1.gaps = [{ gapId: "g1", type: "x", question: "q", status: "open", missCount: 0 }];
    state.L2.retrievedChunks = [{ chunkId: "c1", gapId: "g1", sourceId: "s1", locator: { charStart: 0, charEnd: 2 }, text: "hi" }];
    state.L1.evidenceLedger = [{ evidenceId: "e1", chunkId: "c1", sourceId: "s1", locator: { charStart: 0, charEnd: 2 }, quote: "hi" }];

    const out = __test.validateIteration(state, { blockAfterMisses: 2, roundHits: {} });
    assert.equal(out.openCount, 0);
    assert.equal(state.L1.gaps[0].status, "filled");
    assert.equal(state.L1.gaps[0].filledIteration, 3);
  }

  assert.equal(__test.signatureForRetrievedChunk({ gapId: "g1", sourceId: "s1" }), "g1::s1::-1--1");
});

test("DeepSearch validateIteration helper: miss/hit is per-round (not cumulative)", async () => {
  const { DeepSearchState, validateIteration } = await import("../../../js/agents/stages/deepsearch/state.js");

  const state = new DeepSearchState({ runId: "run_round_hits", iteration: 0, userConfig: { gaps: { blockAfterMisses: 99 } } });
  state.L1.gaps = [{ gapId: "g1", type: "x", question: "q", status: "open", missCount: 0 }];

  // Simulate history: prior round had a retrieval for g1, but this round has none.
  state.L2.retrievedChunks = [{ chunkId: "c_prev", gapId: "g1", sourceId: "s1", locator: { charStart: 0, charEnd: 2 }, text: "hi" }];
  state.L1.evidenceLedger = [];

  validateIteration(state, { blockAfterMisses: 99, roundHits: {} });
  assert.equal(state.L1.gaps[0].status, "open");
  assert.equal(state.L1.gaps[0].missCount, 1);
});

test("DeepSearch ensureState helper: constructs state and applies userConfig.maxIterations", async () => {
  const { __test } = await import("../../../js/agents/stages/deepsearch/index.js");

  const s1 = __test.ensureState({ runId: "run_es" }, { sources: [], taskGoal: "x", userConfig: { maxIterations: 2 } });
  assert.equal(s1.maxIterations, 2);

  const s2 = __test.ensureState({ runId: "run_es" }, { state: s1.toJSON() });
  assert.equal(s2.maxIterations, 2);
});

test("DeepSearchStage: run adapter + runDeepSearchStage + registerDeepSearchStages", async () => {
  const { DeepSearchStage, runDeepSearchStage, registerDeepSearchStages } = await import("../../../js/agents/stages/deepsearch/index.js");

  const sources = [{ sourceId: "s1", kind: "user_text", title: "Input", sourceTextNormalized: "Definition: Alpha." }];

  const pkg1 = await new DeepSearchStage().run({ sources, taskGoal: "Define Alpha", userConfig: { maxIterations: 1 } }, { runContext: { runId: "run_adapter", mode: "deepsearch", constraints: {} } });
  assert.equal(pkg1.mode, "deepsearch");

  const pkg2 = await runDeepSearchStage({ runId: "run_fn", mode: "deepsearch", constraints: {} }, { sources, taskGoal: "Define Alpha", userConfig: { maxIterations: 1 } }, {});
  assert.equal(pkg2.mode, "deepsearch");

  const calls = [];
  registerDeepSearchStages(
    {
      registerStage: (...args) => calls.push(args),
    },
    { timeoutMs: 123 }
  );
  assert.equal(calls.length, 7);
});

test("DeepSearch shouldContinue: stops on maxIterations/openGaps/noNewHitsRounds", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");
  const { shouldContinue } = await import("../../../js/agents/stages/deepsearch/index.js");

  {
    const state = new DeepSearchState({ runId: "run_sc_1", iteration: 0, maxIterations: 2, L1: { gaps: [] } });
    assert.equal(shouldContinue(state, { hitCount: 1, noNewHitsRounds: 0 }), false);
  }

  {
    const state = new DeepSearchState({
      runId: "run_sc_2",
      iteration: 0,
      maxIterations: 2,
      L1: { gaps: [{ gapId: "g1", type: "t", question: "q", status: "open", missCount: 0 }] },
    });
    assert.equal(shouldContinue(state, { hitCount: 0, noNewHitsRounds: 2 }), false);
    assert.equal(shouldContinue(state, { hitCount: 0, noNewHitsRounds: 1 }), true);
  }

  {
    const state = new DeepSearchState({
      runId: "run_sc_3",
      iteration: 2,
      maxIterations: 2,
      L1: { gaps: [{ gapId: "g1", type: "t", question: "q", status: "open", missCount: 0 }] },
    });
    assert.equal(shouldContinue(state, { hitCount: 1, noNewHitsRounds: 0 }), false);
  }
});

test("DeepSearch exit condition: iteration >= maxIterations", async () => {
  const { stage, state } = await makeStageAndState({
    runId: "run_max",
    taskGoal: "Define Alpha and provide key metrics",
    sourceText: "",
    userConfig: { gaps: { blockAfterMisses: 99 } },
    maxIterations: 1,
  });

  await stage.execute({ runId: "run_max", mode: "deepsearch", constraints: {} }, { state }, {});
  assert.equal(state.checkpoints.length, 1);
  assert.equal(state.iteration, 1);

  const g2 = gapById(state, "gap_2");
  assert.ok(g2);
  assert.equal(g2.status, "open");
});

test("DeepSearch exit condition: no new hits 2 rounds", async () => {
  const { stage, state } = await makeStageAndState({
    runId: "run_nohits",
    taskGoal: "Define Alpha and provide key metrics",
    sourceText: "",
    userConfig: { gaps: { blockAfterMisses: 99 } },
    maxIterations: 10,
  });

  await stage.execute({ runId: "run_nohits", mode: "deepsearch", constraints: {} }, { state }, {});
  assert.equal(state.checkpoints.length, 2);
  assert.equal(state.iteration, 2);
  assert.ok(state.checkpoints[1].metrics.retrievedCount === 0);
});

test("DeepSearch exit condition: signal.aborted stops loop after checkpoint", async () => {
  const { stage, state } = await makeStageAndState({
    runId: "run_abort",
    taskGoal: "Define Alpha and provide key metrics",
    sourceText: "",
    userConfig: { gaps: { blockAfterMisses: 99 } },
    maxIterations: 10,
  });

  const controller = new AbortController();
  const events = [];
  const emit = (name, record) => {
    events.push({ name, record });
    if (name === "deepsearch.checkpoint.saved") controller.abort("stop");
  };

  await stage.execute({ runId: "run_abort", mode: "deepsearch", constraints: {} }, { state }, { emit, signal: controller.signal, checkCancelled: () => {} });
  assert.equal(state.checkpoints.length, 1);
  assert.equal(state.iteration, 1);
  assert.ok(events.some((e) => e.name === "deepsearch.checkpoint.saved"));
  assert.ok(events.some((e) => e.name === "deepsearch.aborted"));
});
