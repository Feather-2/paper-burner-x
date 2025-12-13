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
  assert.equal(gaps.length, 2);
  assert.equal(state.planningTree.getNodesForGap("gap_1").length, 3);
  assert.equal(state.planningTree.getNodesForGap("gap_2").length, 4);
  assert.equal(state.planningTree.nodes.size, 8);

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

  state.L2.retrievedChunks = [
    { chunkId: "c1", gapId: "gap_1", sourceId: "s1", locator: { charStart: 0, charEnd: 10 } },
  ];
  state.L1.evidenceLedger = [{ chunkId: "c1" }];

  __test.validateIteration(state, { blockAfterMisses: 1 });

  const gaps = Array.isArray(state?.L1?.gaps) ? state.L1.gaps : [];
  const g1 = gaps.find((g) => g.gapId === "gap_1");
  const g2 = gaps.find((g) => g.gapId === "gap_2");

  assert.equal(g1.status, "filled");
  assert.equal(g2.status, "blocked");

  for (const n of state.planningTree.getNodesForGap("gap_1")) assert.equal(n.status, "completed");
  for (const n of state.planningTree.getNodesForGap("gap_2")) assert.equal(n.status, "blocked");
});

