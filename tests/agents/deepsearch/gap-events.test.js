import { describe, it, expect, beforeEach } from "vitest";
import { PlanningTree } from "../../../js/agents/stages/deepsearch/planning-tree.js";
import { GapStatus, DecisionOutcome, PlanNodeStatus } from "../../../js/agents/stages/deepsearch/states.js";

describe("Gap Events - PlanningTree Integration", () => {
  let tree;

  beforeEach(() => {
    tree = new PlanningTree({ rootGoal: "Test goal", runId: "test_run" });
  });

  describe("recordGapStatusChange", () => {
    it("should record SUCCESS decision when gap is FILLED", () => {
      const gap = { gapId: "gap_1", question: "Test question" };
      tree.expandFromGap(gap);

      tree.recordGapStatusChange("gap_1", {
        from: GapStatus.OPEN,
        to: GapStatus.FILLED,
        reason: "evidence",
        iteration: 1,
      });

      const nodes = tree.getNodesForGap("gap_1");
      expect(nodes.length).toBeGreaterThan(0);

      const decisions = nodes[0].decisions;
      expect(decisions.length).toBe(1);
      expect(decisions[0].outcome).toBe(DecisionOutcome.SUCCESS);
      expect(decisions[0].action).toBe("gap_filled");
      expect(nodes[0].status).toBe(PlanNodeStatus.COMPLETED);
    });

    it("should record FAIL decision when gap is BLOCKED", () => {
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

      expect(decisions[0].outcome).toBe(DecisionOutcome.FAIL);
      expect(decisions[0].action).toBe("gap_blocked");
      expect(nodes[0].status).toBe(PlanNodeStatus.FAILED);
    });

    it("should record UNKNOWN decision for intermediate states", () => {
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

      expect(decisions[0].outcome).toBe(DecisionOutcome.UNKNOWN);
      expect(decisions[0].action).toBe("gap_searching");
    });

    it("should not fail when gap has no associated nodes", () => {
      expect(() => {
        tree.recordGapStatusChange("nonexistent_gap", {
          from: GapStatus.OPEN,
          to: GapStatus.FILLED,
          reason: "evidence",
          iteration: 1,
        });
      }).not.toThrow();
    });

    it("should update PlanNode status synchronously with gap status", () => {
      const gap = { gapId: "gap_4", question: "Test question 4", queryHints: ["hint1"] };
      tree.expandFromGap(gap);

      const nodesBefore = tree.getNodesForGap("gap_4");
      expect(nodesBefore.some(n => n.status === "pending")).toBe(true);

      tree.recordGapStatusChange("gap_4", {
        from: GapStatus.OPEN,
        to: GapStatus.FILLED,
        reason: "evidence_sufficient",
        iteration: 3,
      });

      const nodesAfter = tree.getNodesForGap("gap_4");
      expect(nodesAfter.every(n => n.status === PlanNodeStatus.COMPLETED)).toBe(true);
    });
  });
});
