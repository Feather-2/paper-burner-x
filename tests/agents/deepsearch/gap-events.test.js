const test = require("node:test");
const assert = require("node:assert/strict");

test("recordGapStatusChange: records SUCCESS decision when gap is FILLED", async () => {
  const { PlanningTree } = await import("../../../js/agents/stages/deepsearch/planning-tree.js");
  const { GapStatus, DecisionOutcome, PlanNodeStatus } = await import("../../../js/agents/stages/deepsearch/states.js");

  const tree = new PlanningTree({ rootGoal: "Test goal", runId: "test_run" });
  const gap = { gapId: "gap_1", question: "Test question" };
  tree.expandFromGap(gap);

  tree.recordGapStatusChange("gap_1", {
    from: GapStatus.OPEN,
    to: GapStatus.FILLED,
    reason: "evidence",
    iteration: 1,
  });

  const nodes = tree.getNodesForGap("gap_1");
  assert.ok(nodes.length > 0);

  const decisions = nodes[0].decisions;
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].outcome, DecisionOutcome.SUCCESS);
  assert.equal(decisions[0].action, "gap_filled");
  assert.equal(nodes[0].status, PlanNodeStatus.COMPLETED);
});

test("recordGapStatusChange: records FAIL decision when gap is BLOCKED", async () => {
  const { PlanningTree } = await import("../../../js/agents/stages/deepsearch/planning-tree.js");
  const { GapStatus, DecisionOutcome, PlanNodeStatus } = await import("../../../js/agents/stages/deepsearch/states.js");

  const tree = new PlanningTree({ rootGoal: "Test goal", runId: "test_run" });
  const gap = { gapId: "gap_2", question: "Test question 2" };
  tree.expandFromGap(gap);

  tree.recordGapStatusChange("gap_2", {
    from: GapStatus.SEARCHING,
    to: GapStatus.BLOCKED,
    reason: "no_hits",
    iteration: 2,
  });

  const nodes = tree.getNodesForGap("gap_2");
  const decisions = nodes[0].decisions;

  assert.equal(decisions[0].outcome, DecisionOutcome.FAIL);
  assert.equal(decisions[0].action, "gap_blocked");
  assert.equal(nodes[0].status, PlanNodeStatus.FAILED);
});

test("recordGapStatusChange: records UNKNOWN decision for intermediate states", async () => {
  const { PlanningTree } = await import("../../../js/agents/stages/deepsearch/planning-tree.js");
  const { GapStatus, DecisionOutcome } = await import("../../../js/agents/stages/deepsearch/states.js");

  const tree = new PlanningTree({ rootGoal: "Test goal", runId: "test_run" });
  const gap = { gapId: "gap_3", question: "Test question 3" };
  tree.expandFromGap(gap);

  tree.recordGapStatusChange("gap_3", {
    from: GapStatus.OPEN,
    to: GapStatus.SEARCHING,
    reason: "searching",
    iteration: 1,
  });

  const nodes = tree.getNodesForGap("gap_3");
  const decisions = nodes[0].decisions;

  assert.equal(decisions[0].outcome, DecisionOutcome.UNKNOWN);
  assert.equal(decisions[0].action, "gap_searching");
});

test("recordGapStatusChange: does not fail when gap has no associated nodes", async () => {
  const { PlanningTree } = await import("../../../js/agents/stages/deepsearch/planning-tree.js");
  const { GapStatus } = await import("../../../js/agents/stages/deepsearch/states.js");

  const tree = new PlanningTree({ rootGoal: "Test goal", runId: "test_run" });

  assert.doesNotThrow(() => {
    tree.recordGapStatusChange("nonexistent_gap", {
      from: GapStatus.OPEN,
      to: GapStatus.FILLED,
      reason: "evidence",
      iteration: 1,
    });
  });
});

test("recordGapStatusChange: updates PlanNode status synchronously with gap status", async () => {
  const { PlanningTree } = await import("../../../js/agents/stages/deepsearch/planning-tree.js");
  const { GapStatus, PlanNodeStatus } = await import("../../../js/agents/stages/deepsearch/states.js");

  const tree = new PlanningTree({ rootGoal: "Test goal", runId: "test_run" });
  const gap = { gapId: "gap_4", question: "Test question 4", queryHints: ["hint1"] };
  tree.expandFromGap(gap);

  const nodesBefore = tree.getNodesForGap("gap_4");
  assert.ok(nodesBefore.some(n => n.status === "pending"));

  tree.recordGapStatusChange("gap_4", {
    from: GapStatus.OPEN,
    to: GapStatus.FILLED,
    reason: "evidence_sufficient",
    iteration: 3,
  });

  const nodesAfter = tree.getNodesForGap("gap_4");
  assert.ok(nodesAfter.every(n => n.status === PlanNodeStatus.COMPLETED));
});
