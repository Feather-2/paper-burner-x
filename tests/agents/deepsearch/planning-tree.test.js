const test = require("node:test");
const assert = require("node:assert/strict");

test("PlanningTree: node creation and hierarchy", async () => {
  const { PlanningTree } = await import("../../../js/agents/stages/deepsearch/planning-tree.js");

  const tree = new PlanningTree({ rootGoal: "Root goal", runId: "run_1" });
  const [subgoalId, q1, q2] = tree.expandFromGap({
    gapId: "gap_1",
    question: "What is X?",
    queryHints: ["x definition", "x scope"],
  });

  const root = tree.nodes.get(tree.rootId);
  assert.equal(root.nodeId, "plan_root");
  assert.equal(root.type, "goal");
  assert.equal(root.status, "active");
  assert.deepEqual(root.children, [subgoalId]);

  const subgoal = tree.nodes.get(subgoalId);
  assert.equal(subgoal.parentId, tree.rootId);
  assert.equal(subgoal.type, "subgoal");
  assert.equal(subgoal.content, "What is X?");
  assert.deepEqual(subgoal.children, [q1, q2]);

  const path = tree.getNodePath(q2).map((n) => n.nodeId);
  assert.deepEqual(path, [tree.rootId, subgoalId, q2]);
});

test("PlanningTree: status transitions + active nodes + unknown ids", async () => {
  const { PlanningTree } = await import("../../../js/agents/stages/deepsearch/planning-tree.js");

  const tree = new PlanningTree({ rootGoal: "Goal" });
  const [subgoalId] = tree.expandFromGap({ gapId: "gap_1", question: "Q1?" });

  assert.equal(tree.getActiveNodes().length, 1);
  tree.updateStatus(tree.rootId, "completed");
  assert.equal(tree.getActiveNodes().length, 0);

  tree.updateStatus(subgoalId, "active");
  assert.deepEqual(
    tree.getActiveNodes().map((n) => n.nodeId),
    [subgoalId],
  );

  tree.updateStatus("missing_node", "blocked");
  assert.deepEqual(tree.getNodePath("missing_node"), []);
});

test("PlanningTree: addNode handles missing parent + getNodesForGap", async () => {
  const { PlanningTree } = await import("../../../js/agents/stages/deepsearch/planning-tree.js");

  const tree = new PlanningTree({ rootGoal: "Goal" });
  const detachedId = tree.addNode("missing_parent", "query", "detached");
  assert.equal(tree.nodes.get(tree.rootId).children.length, 0);
  assert.equal(tree.nodes.get(detachedId).parentId, "missing_parent");

  tree.expandFromGap({ gapId: "gap_9", question: "Q9?", queryHints: ["a"] });
  const nodes = tree.getNodesForGap("gap_9");
  assert.equal(nodes.length, 2);
  assert(nodes.every((n) => n.metadata.sourceGapId === "gap_9"));
});

test("PlanningTree: serialize/deserialize roundtrip", async () => {
  const { PlanningTree } = await import("../../../js/agents/stages/deepsearch/planning-tree.js");

  const tree = new PlanningTree({ rootGoal: "Goal", runId: "run_2" });
  tree.expandFromGap({ gapId: "gap_1", question: "Q1?", queryHints: ["a", "b"] });
  tree.updateStatus(tree.rootId, "completed");

  const json = tree.serialize();
  const restored = PlanningTree.fromJSON(JSON.parse(JSON.stringify(json)));

  assert.equal(restored.rootId, tree.rootId);
  assert.equal(restored.nodes.size, tree.nodes.size);
  assert.equal(restored.nodes.get(tree.rootId).status, "completed");

  const [subgoalId] = restored.expandFromGap({ gapId: "gap_2", question: "Q2?", queryHints: [] });
  assert.equal(restored.nodes.get(subgoalId).metadata.sourceGapId, "gap_2");
});

test("Integration: gaps stage expands planningTree for newly created gaps", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchGapsStage } = await import("../../../js/agents/stages/deepsearch/gaps.js");

  const state = new DeepSearchState({ runId: "run_gaps", taskGoal: "Explain topic" });
  assert.equal(state.planningTree.nodes.size, 1);

  await runDeepSearchGapsStage({ runId: "run_gaps" }, { state }, {});

  const gaps = Array.isArray(state?.L1?.gaps) ? state.L1.gaps : [];
  // buildDefaultGaps now generates 8 default gaps
  assert.equal(gaps.length, 8);
  // Verify that planningTree nodes were created for at least the first gap
  assert(state.planningTree.getNodesForGap("gap_1").length > 0, "Should have nodes for gap_1");
  assert(state.planningTree.nodes.size > 1, "Should have nodes beyond root");

  const sizeBefore = state.planningTree.nodes.size;
  await runDeepSearchGapsStage({ runId: "run_gaps" }, { state }, {});
  assert.equal(state.planningTree.nodes.size, sizeBefore);
});

test("Integration: validateIteration updates planningTree for filled/blocked gaps", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchGapsStage } = await import("../../../js/agents/stages/deepsearch/gaps.js");
  const { __test } = await import("../../../js/agents/stages/deepsearch/index.js");

  const state = new DeepSearchState({ runId: "run_validate", taskGoal: "Explain topic" });
  await runDeepSearchGapsStage({ runId: "run_validate" }, { state }, {});

  // Provide enough evidence to mark gap_1 as filled (minEvidenceToFill = 3 by default)
  state.L2.retrievedChunks = [
    { chunkId: "c1", gapId: "gap_1", sourceId: "s1", locator: { charStart: 0, charEnd: 10 } },
    { chunkId: "c2", gapId: "gap_1", sourceId: "s1", locator: { charStart: 10, charEnd: 20 } },
    { chunkId: "c3", gapId: "gap_1", sourceId: "s1", locator: { charStart: 20, charEnd: 30 } },
  ];
  state.L1.evidenceLedger = [{ chunkId: "c1" }, { chunkId: "c2" }, { chunkId: "c3" }];

  __test.validateIteration(state, { blockAfterMisses: 1, roundHits: { gap_1: 1 } });

  const gaps = Array.isArray(state?.L1?.gaps) ? state.L1.gaps : [];
  const g1 = gaps.find((g) => g.gapId === "gap_1");
  const g2 = gaps.find((g) => g.gapId === "gap_2");

  assert.equal(g1.status, "filled");
  assert.equal(g2.status, "blocked");

  for (const n of state.planningTree.getNodesForGap("gap_1")) assert.equal(n.status, "completed");
  for (const n of state.planningTree.getNodesForGap("gap_2")) assert.equal(n.status, "blocked");
});

test("Integration: retrieve stage records retrieval decisions per gap", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchRetrieveStage } = await import("../../../js/agents/stages/deepsearch/retrieve.js");

  const state = new DeepSearchState({ runId: "run_retrieve_decisions", taskGoal: "Explain topic" });
  state.L0.sources = [{ sourceId: "s1", kind: "url", sourceTextNormalized: "X is a concept. X has properties." }];
  state.userConfig = { retrieval: { enableToolChain: false, iterative: { enabled: false }, topK: 3 } };

  state.L1.gaps = [
    { gapId: "gap_1", status: "open", type: "definition", priority: "high", question: "What is X?", queryHints: ["X"] },
  ];
  state.planningTree.expandFromGap(state.L1.gaps[0]);

  await runDeepSearchRetrieveStage(
    { runId: state.runId },
    { state },
    {
      localRetriever: (sourceIndex, gaps, config) => {
        assert.equal(config.useBm25, true);
        assert.equal(config.useGrep, false);
        const gapId = gaps[0]?.gapId;
        return [
          {
            chunkId: `${sourceIndex.sourceId}::c1`,
            sourceId: sourceIndex.sourceId,
            locator: { charStart: 0, charEnd: 10 },
            text: "X is a concept.",
            matchedGapIds: [gapId],
            score: 1.0,
          },
        ];
      },
    },
  );

  const nodes = state.planningTree.getNodesForGap("gap_1");
  assert(nodes.length > 0);
  const history = state.planningTree.getDecisionHistory(nodes[0].nodeId);
  assert(history.some((d) => d.stage === "retrieve" && d.outcome === "success"), "Should record a successful retrieve decision");
});

test("Integration: validateIteration records gap transition decisions", async () => {
  const { DeepSearchState, validateIteration } = await import("../../../js/agents/stages/deepsearch/state.js");

  const state = new DeepSearchState({ runId: "run_gap_transition_decisions", taskGoal: "Explain topic" });
  state.L1.gaps = [
    { gapId: "gap_1", status: "open", type: "definition", priority: "high", question: "What is X?", queryHints: ["X"] },
    { gapId: "gap_2", status: "open", type: "data", priority: "medium", question: "Stats?", queryHints: ["stats"] },
  ];
  for (const g of state.L1.gaps) state.planningTree.expandFromGap(g);

  // Fill gap_1 via evidence threshold, block gap_2 via miss threshold.
  state.L1.evidenceLedger = [{ gapIds: ["gap_1"] }, { gapIds: ["gap_1"] }];
  state.L2.retrievedChunks = [{ chunkId: "c1", gapId: "gap_1" }];

  validateIteration(state, { blockAfterMisses: 1, roundHits: { allHits: new Map(), qualityHits: new Map() } });

  const nodes1 = state.planningTree.getNodesForGap("gap_1");
  const nodes2 = state.planningTree.getNodesForGap("gap_2");
  assert(nodes1.length > 0 && nodes2.length > 0);

  const h1 = state.planningTree.getDecisionHistory(nodes1[0].nodeId);
  const h2 = state.planningTree.getDecisionHistory(nodes2[0].nodeId);

  assert(h1.some((d) => d.stage === "gaps" && d.action.includes("transition to filled") && d.outcome === "success"));
  assert(h2.some((d) => d.stage === "gaps" && d.action.includes("transition to blocked") && d.outcome === "fail"));
});

test("Integration: PlanningTree strategy selection influences retrieve router config", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchRetrieveStage } = await import("../../../js/agents/stages/deepsearch/retrieve.js");

  // Doc-only sources -> bm25.
  {
    const state = new DeepSearchState({ runId: "run_strategy_bm25", taskGoal: "Explain topic" });
    state.L0.sources = [{ sourceId: "s1", kind: "url", sourceTextNormalized: "Some documentation about X." }];
    state.userConfig = { retrieval: { enableToolChain: false, iterative: { enabled: false }, topK: 1 } };
    state.L1.gaps = [{ gapId: "gap_1", status: "open", question: "What is X?", queryHints: ["X"] }];
    state.planningTree.expandFromGap(state.L1.gaps[0]);

    const seen = [];
    await runDeepSearchRetrieveStage(
      { runId: state.runId },
      { state },
      {
        localRetriever: (_sourceIndex, _gaps, config) => {
          seen.push({ useGrep: config.useGrep, useBm25: config.useBm25 });
          return [];
        },
      },
    );
    assert(seen.length > 0);
    assert(seen.every((c) => c.useBm25 === true && c.useGrep === false));
  }

  // Code-only sources + stats that favor grep -> grep.
  {
    const state = new DeepSearchState({ runId: "run_strategy_grep", taskGoal: "Explain topic" });
    state.L0.sources = [{ sourceId: "s1", kind: "file", sourceTextNormalized: "function foo() { return 1; }" }];
    state.userConfig = { retrieval: { enableToolChain: false, iterative: { enabled: false }, topK: 1 } };
    state.L1.gaps = [{ gapId: "gap_1", status: "open", question: "Where is foo?", queryHints: ["foo"] }];
    state.planningTree.expandFromGap(state.L1.gaps[0]);

    // Make grep clearly better than tool-chain so getBestStrategy picks grep for code-only.
    for (let i = 0; i < 3; i++) state.planningTree.recordStrategyResult("grep", { hits: 5, latency: 1 });
    for (let i = 0; i < 3; i++) state.planningTree.recordStrategyResult("tool-chain", { hits: 0, latency: 1 });

    const seen = [];
    await runDeepSearchRetrieveStage(
      { runId: state.runId },
      { state },
      {
        localRetriever: (_sourceIndex, _gaps, config) => {
          seen.push({ useGrep: config.useGrep, useBm25: config.useBm25 });
          return [];
        },
      },
    );
    assert(seen.length > 0);
    assert(seen.every((c) => c.useBm25 === false && c.useGrep === true));
  }
});

test("PlanningTree: analyzeGapFailure produces suggestions from repeated failures", async () => {
  const { PlanningTree } = await import("../../../js/agents/stages/deepsearch/planning-tree.js");

  const tree = new PlanningTree({ rootGoal: "Goal", runId: "run_failure_analysis" });
  tree.expandFromGap({ gapId: "gap_1", question: "What is X?", queryHints: ["x"] });

  const nodes = tree.getNodesForGap("gap_1");
  assert(nodes.length > 0);
  const nodeId = nodes[0].nodeId;

  for (let i = 0; i < 3; i++) {
    tree.recordDecision(nodeId, { stage: "retrieve", action: "bm25 search", reason: "no hits", outcome: "fail", metrics: { hits: 0 } });
  }
  tree.recordDecision(nodeId, { stage: "gaps", action: "transition to blocked", reason: "no hits", outcome: "fail", metrics: { missCount: 2 } });

  const analysis = tree.analyzeGapFailure("gap_1");
  assert(analysis.failureCount >= 3);
  assert(Array.isArray(analysis.suggestedActions) && analysis.suggestedActions.length > 0, "Should suggest actions for repeated failures");
});

