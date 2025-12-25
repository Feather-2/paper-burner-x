const test = require("node:test");
const assert = require("node:assert/strict");

test("PlanningTree: computeGapScore - priority weighting", async () => {
  const { PlanningTree } = await import("../../../js/agents/stages/deepsearch/planning-tree.js");

  const tree = new PlanningTree({ rootGoal: "Root goal", runId: "run_1" });

  const highPriorityGap = {
    gapId: "gap_1",
    question: "High priority gap?",
    priority: "high",
    missCount: 0,
  };

  const mediumPriorityGap = {
    gapId: "gap_2",
    question: "Medium priority gap?",
    priority: "medium",
    missCount: 0,
  };

  const lowPriorityGap = {
    gapId: "gap_3",
    question: "Low priority gap?",
    priority: "low",
    missCount: 0,
  };

  const gaps = [highPriorityGap, mediumPriorityGap, lowPriorityGap];

  const highScore = tree.computeGapScore(highPriorityGap, gaps);
  const mediumScore = tree.computeGapScore(mediumPriorityGap, gaps);
  const lowScore = tree.computeGapScore(lowPriorityGap, gaps);

  // High priority should score higher than medium, medium higher than low
  assert(highScore > mediumScore, `Expected high (${highScore}) > medium (${mediumScore})`);
  assert(mediumScore > lowScore, `Expected medium (${mediumScore}) > low (${lowScore})`);

  // Verify score differences match priority weights (10 per level)
  assert(Math.abs((highScore - mediumScore) - 10) < 0.1, "Expected ~10 point difference between high and medium");
  assert(Math.abs((mediumScore - lowScore) - 10) < 0.1, "Expected ~10 point difference between medium and low");
});

test("PlanningTree: computeGapScore - missCount penalty", async () => {
  const { PlanningTree } = await import("../../../js/agents/stages/deepsearch/planning-tree.js");

  const tree = new PlanningTree({ rootGoal: "Root goal", runId: "run_2" });

  const freshGap = {
    gapId: "gap_1",
    question: "Fresh gap?",
    priority: "medium",
    missCount: 0,
  };

  const missedOnceGap = {
    gapId: "gap_2",
    question: "Missed once gap?",
    priority: "medium",
    missCount: 1,
  };

  const missedTwiceGap = {
    gapId: "gap_3",
    question: "Missed twice gap?",
    priority: "medium",
    missCount: 2,
  };

  const gaps = [freshGap, missedOnceGap, missedTwiceGap];

  const freshScore = tree.computeGapScore(freshGap, gaps);
  const missedOnceScore = tree.computeGapScore(missedOnceGap, gaps);
  const missedTwiceScore = tree.computeGapScore(missedTwiceGap, gaps);

  // Fresh gap should score higher than missed gaps
  assert(freshScore > missedOnceScore, `Expected fresh (${freshScore}) > missedOnce (${missedOnceScore})`);
  assert(missedOnceScore > missedTwiceScore, `Expected missedOnce (${missedOnceScore}) > missedTwice (${missedTwiceScore})`);

  // Score should decrease as missCount increases (with missWeight=5)
  const missWeight = 5;
  const expectedFreshMissScore = missWeight * (1 / (1 + 0)); // 5.0
  const expectedOnceMissScore = missWeight * (1 / (1 + 1)); // 2.5
  const expectedTwiceMissScore = missWeight * (1 / (1 + 2)); // 1.67

  assert(Math.abs((freshScore - missedOnceScore) - (expectedFreshMissScore - expectedOnceMissScore)) < 0.1);
  assert(Math.abs((missedOnceScore - missedTwiceScore) - (expectedOnceMissScore - expectedTwiceMissScore)) < 0.1);
});

test("PlanningTree: computeGapScore - dependency bonus", async () => {
  const { PlanningTree } = await import("../../../js/agents/stages/deepsearch/planning-tree.js");

  const tree = new PlanningTree({ rootGoal: "Root goal", runId: "run_3" });

  const independentGap = {
    gapId: "gap_1",
    question: "Independent gap?",
    priority: "medium",
    missCount: 0,
  };

  const dependencyGap = {
    gapId: "gap_2",
    question: "Dependency gap?",
    priority: "medium",
    missCount: 0,
  };

  const dependent1 = {
    gapId: "gap_3",
    question: "Dependent 1?",
    priority: "medium",
    missCount: 0,
    metadata: { dependencies: ["gap_2"] },
  };

  const dependent2 = {
    gapId: "gap_4",
    question: "Dependent 2?",
    priority: "medium",
    missCount: 0,
    metadata: { dependencies: ["gap_2"] },
  };

  const gaps = [independentGap, dependencyGap, dependent1, dependent2];

  const independentScore = tree.computeGapScore(independentGap, gaps);
  const dependencyScore = tree.computeGapScore(dependencyGap, gaps);

  // Gap with 2 dependents should score higher than independent gap
  assert(dependencyScore > independentScore, `Expected dependency (${dependencyScore}) > independent (${independentScore})`);

  // Score difference should reflect dependency bonus (2 dependents * 2 bonus = 4)
  const dependencyBonus = 2;
  const expectedBonus = 2 * dependencyBonus; // 2 dependents
  assert(Math.abs((dependencyScore - independentScore) - expectedBonus) < 0.1);
});

test("PlanningTree: computeGapScore - depth penalty", async () => {
  const { PlanningTree } = await import("../../../js/agents/stages/deepsearch/planning-tree.js");

  const tree = new PlanningTree({ rootGoal: "Root goal", runId: "run_4" });

  // Create shallow gap (depth 1-2)
  const shallowGap = {
    gapId: "gap_1",
    question: "Shallow gap?",
    priority: "medium",
    missCount: 0,
  };
  tree.expandFromGap(shallowGap); // Creates subgoal at depth 1, queries at depth 2

  // Create deep gap structure
  const deepGap = {
    gapId: "gap_2",
    question: "Deep gap?",
    priority: "medium",
    missCount: 0,
  };
  const [subgoalId] = tree.expandFromGap(deepGap);
  // Add extra depth by creating nested queries
  tree.addNode(subgoalId, "query", "nested query 1", { sourceGapId: "gap_2" });
  tree.addNode(subgoalId, "query", "nested query 2", { sourceGapId: "gap_2" });

  const gaps = [shallowGap, deepGap];

  const shallowScore = tree.computeGapScore(shallowGap, gaps);
  const deepScore = tree.computeGapScore(deepGap, gaps);

  // Shallow gap should score equal or higher than deep gap (breadth-first preference)
  assert(shallowScore >= deepScore, `Expected shallow (${shallowScore}) >= deep (${deepScore})`);
});

test("PlanningTree: sortGapsByPriority - comprehensive sorting", async () => {
  const { PlanningTree } = await import("../../../js/agents/stages/deepsearch/planning-tree.js");

  const tree = new PlanningTree({ rootGoal: "Root goal", runId: "run_5" });

  const gap1 = {
    gapId: "gap_1",
    question: "High priority, fresh?",
    priority: "high",
    missCount: 0,
  };

  const gap2 = {
    gapId: "gap_2",
    question: "Medium priority, fresh?",
    priority: "medium",
    missCount: 0,
  };

  const gap3 = {
    gapId: "gap_3",
    question: "High priority, missed twice?",
    priority: "high",
    missCount: 2,
  };

  const gap4 = {
    gapId: "gap_4",
    question: "Low priority, fresh?",
    priority: "low",
    missCount: 0,
  };

  const gap5 = {
    gapId: "gap_5",
    question: "Medium priority, missed once?",
    priority: "medium",
    missCount: 1,
  };

  const gaps = [gap4, gap2, gap5, gap1, gap3]; // Unsorted

  // Expand gaps to create nodes
  gaps.forEach(g => tree.expandFromGap(g));

  const sorted = tree.sortGapsByPriority(gaps);

  assert.equal(sorted.length, 5, "Should return all gaps");
  assert.notStrictEqual(sorted, gaps, "Should return a new array");

  // Expected order (roughly):
  // 1. gap_1: high + missCount=0 -> score ~35
  // 2. gap_3: high + missCount=2 -> score ~31.67
  // 3. gap_2: medium + missCount=0 -> score ~25
  // 4. gap_5: medium + missCount=1 -> score ~22.5
  // 5. gap_4: low + missCount=0 -> score ~15

  assert.equal(sorted[0].gapId, "gap_1", "gap_1 should be first (high priority, fresh)");
  assert.equal(sorted[sorted.length - 1].gapId, "gap_4", "gap_4 should be last (low priority)");

  // Verify high priority gaps come before medium
  const gap1Index = sorted.findIndex(g => g.gapId === "gap_1");
  const gap2Index = sorted.findIndex(g => g.gapId === "gap_2");
  assert(gap1Index < gap2Index, "High priority gap_1 should come before medium priority gap_2");

  // Verify fresh gaps come before missed gaps of same priority
  const gap2FreshIndex = sorted.findIndex(g => g.gapId === "gap_2");
  const gap5MissedIndex = sorted.findIndex(g => g.gapId === "gap_5");
  assert(gap2FreshIndex < gap5MissedIndex, "Fresh gap_2 should come before missed gap_5");
});

test("PlanningTree: sortGapsByPriority - edge cases", async () => {
  const { PlanningTree } = await import("../../../js/agents/stages/deepsearch/planning-tree.js");

  const tree = new PlanningTree({ rootGoal: "Root goal", runId: "run_6" });

  // Empty array
  assert.deepEqual(tree.sortGapsByPriority([]), []);

  // Single gap
  const singleGap = {
    gapId: "gap_1",
    question: "Single gap?",
    priority: "medium",
    missCount: 0,
  };
  const sortedSingle = tree.sortGapsByPriority([singleGap]);
  assert.equal(sortedSingle.length, 1);
  assert.equal(sortedSingle[0].gapId, "gap_1");

  // Gaps with identical scores should be sorted by gapId (stable sort)
  const gapA = {
    gapId: "gap_a",
    question: "Gap A?",
    priority: "medium",
    missCount: 0,
  };

  const gapB = {
    gapId: "gap_b",
    question: "Gap B?",
    priority: "medium",
    missCount: 0,
  };

  const gapC = {
    gapId: "gap_c",
    question: "Gap C?",
    priority: "medium",
    missCount: 0,
  };

  const sortedIdentical = tree.sortGapsByPriority([gapC, gapA, gapB]);
  assert.equal(sortedIdentical[0].gapId, "gap_a", "Should be sorted by gapId when scores are identical");
  assert.equal(sortedIdentical[1].gapId, "gap_b");
  assert.equal(sortedIdentical[2].gapId, "gap_c");
});

test("PlanningTree: getNodeDepth - depth calculation", async () => {
  const { PlanningTree } = await import("../../../js/agents/stages/deepsearch/planning-tree.js");

  const tree = new PlanningTree({ rootGoal: "Root goal", runId: "run_7" });

  // Root should be at depth 0
  assert.equal(tree.getNodeDepth(tree.rootId), 0);

  const gap = {
    gapId: "gap_1",
    question: "Test gap?",
    queryHints: ["hint1", "hint2"],
  };

  const [subgoalId, query1Id, query2Id] = tree.expandFromGap(gap);

  // Subgoal should be at depth 1 (child of root)
  assert.equal(tree.getNodeDepth(subgoalId), 1);

  // Queries should be at depth 2 (children of subgoal)
  assert.equal(tree.getNodeDepth(query1Id), 2);
  assert.equal(tree.getNodeDepth(query2Id), 2);

  // Unknown node should return 0
  assert.equal(tree.getNodeDepth("unknown_node"), 0);
});

test("PlanningTree: countDependents - dependency counting", async () => {
  const { PlanningTree } = await import("../../../js/agents/stages/deepsearch/planning-tree.js");

  const tree = new PlanningTree({ rootGoal: "Root goal", runId: "run_8" });

  const gap1 = { gapId: "gap_1", question: "Gap 1?" };
  const gap2 = { gapId: "gap_2", question: "Gap 2?", metadata: { dependencies: ["gap_1"] } };
  const gap3 = { gapId: "gap_3", question: "Gap 3?", metadata: { dependencies: ["gap_1"] } };
  const gap4 = { gapId: "gap_4", question: "Gap 4?", metadata: { dependencies: ["gap_2"] } };

  const gaps = [gap1, gap2, gap3, gap4];

  // gap_1 has 2 dependents (gap_2, gap_3)
  assert.equal(tree.countDependents("gap_1", gaps), 2);

  // gap_2 has 1 dependent (gap_4)
  assert.equal(tree.countDependents("gap_2", gaps), 1);

  // gap_3 has 0 dependents
  assert.equal(tree.countDependents("gap_3", gaps), 0);

  // gap_4 has 0 dependents
  assert.equal(tree.countDependents("gap_4", gaps), 0);

  // Unknown gap has 0 dependents
  assert.equal(tree.countDependents("gap_unknown", gaps), 0);
});

test("Integration: gaps stage uses PlanningTree sorting", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchGapsStage } = await import("../../../js/agents/stages/deepsearch/gaps.js");

  const state = new DeepSearchState({ runId: "run_gaps_sort", taskGoal: "Research topic" });

  // Run gaps stage
  await runDeepSearchGapsStage({ runId: "run_gaps_sort" }, { state }, {});

  const gaps = state.L1.gaps;
  assert(gaps.length > 0, "Should generate gaps");

  // Verify open gaps come first
  const firstClosedIndex = gaps.findIndex(g => g.status !== "open");
  if (firstClosedIndex !== -1) {
    const hasOpenAfterClosed = gaps.slice(firstClosedIndex).some(g => g.status === "open");
    assert(!hasOpenAfterClosed, "All open gaps should come before closed gaps");
  }

  // Verify high priority gaps come before lower priority ones (among open gaps)
  const openGaps = gaps.filter(g => g.status === "open");
  if (openGaps.length > 1) {
    const highPriorityIndices = openGaps.map((g, i) => (g.priority === "high" ? i : -1)).filter(i => i !== -1);
    const lowPriorityIndices = openGaps.map((g, i) => (g.priority === "low" ? i : -1)).filter(i => i !== -1);

    if (highPriorityIndices.length > 0 && lowPriorityIndices.length > 0) {
      const maxHighIndex = Math.max(...highPriorityIndices);
      const minLowIndex = Math.min(...lowPriorityIndices);
      assert(maxHighIndex < minLowIndex, "High priority gaps should generally come before low priority gaps");
    }
  }
});

test("Integration: iteration re-sorts gaps after missCount changes", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchGapsStage } = await import("../../../js/agents/stages/deepsearch/gaps.js");

  const state = new DeepSearchState({ runId: "run_resort", taskGoal: "Research topic" });

  // Generate initial gaps
  await runDeepSearchGapsStage({ runId: "run_resort" }, { state }, {});

  const initialGaps = [...state.L1.gaps];
  assert(initialGaps.length >= 2, "Need at least 2 gaps for this test");

  // Simulate a miss on the first gap by incrementing its missCount
  if (state.L1.gaps[0].status === "open") {
    state.L1.gaps[0].missCount = (state.L1.gaps[0].missCount || 0) + 2;
  }

  // Re-sort using PlanningTree (simulating iteration start)
  const openGaps = state.L1.gaps.filter(g => g.status === "open");
  const closedGaps = state.L1.gaps.filter(g => g.status !== "open");

  if (openGaps.length > 1) {
    const sortedOpenGaps = state.planningTree.sortGapsByPriority(openGaps);
    state.L1.gaps = [...sortedOpenGaps, ...closedGaps];

    // The gap with higher missCount should now be ranked lower
    const originalFirstGapId = initialGaps[0].gapId;
    const newPosition = state.L1.gaps.findIndex(g => g.gapId === originalFirstGapId);

    // After adding missCount=2, it should not be first anymore (unless all other gaps also have high missCounts)
    const gapsWithLowerMissCount = openGaps.filter(g => g.gapId !== originalFirstGapId && (g.missCount || 0) < 2);
    if (gapsWithLowerMissCount.length > 0) {
      assert(newPosition > 0, "Gap with increased missCount should move down in priority");
    }
  }
});
