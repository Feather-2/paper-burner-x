import { describe, it, expect } from "vitest";

import { PlanningTree } from "../../../../../../js/agents/stages/deepsearch/state/planning-tree.js";

describe("PlanningTree", () => {
  it("initializes with empty node map", () => {
    const tree = new PlanningTree();
    expect(tree.rootGoal).toBe("");
    expect(tree.runId).toBe("");
    expect(tree.nodes).toBeInstanceOf(Map);
    expect(tree.nodes.size).toBe(0);
  });

  it("expands from gaps and todos with retrievable nodes", () => {
    const tree = new PlanningTree({ runId: "run-1", rootGoal: "goal" });
    const gapNode = tree.expandFromGap({ gapId: "g1", summary: "missing evidence", status: "open" });
    const todoNode = tree.expandFromTodo({ todoId: "t1", text: "search more", relatedGapId: "g1" });

    expect(gapNode.kind).toBe("gap");
    expect(todoNode.kind).toBe("todo");
    expect(tree.getNodesForGap("g1")).toHaveLength(2);
    expect(tree.getNodesForTodo("t1")).toHaveLength(1);
  });

  it("updates node status and records decisions", () => {
    const tree = new PlanningTree();
    const node = tree.expandFromGap({ gapId: "g2", summary: "gap" });

    expect(tree.updateStatus(node.nodeId, "completed")).toBe(true);
    expect(tree.recordDecision(node.nodeId, { stage: "gaps", action: "resolve", reason: "enough evidence" })).toBe(true);

    const reloaded = tree.getNodesForGap("g2")[0];
    expect(reloaded.status).toBe("completed");
    expect(reloaded.decisions).toHaveLength(1);
    expect(reloaded.decisions[0].stage).toBe("gaps");
  });

  it("serializes and restores nodes", () => {
    const tree = new PlanningTree({ runId: "run-2", rootGoal: "root" });
    const n1 = tree.expandFromGap({ gapId: "g3", summary: "gap3" });
    tree.expandFromTodo({ todoId: "t3", text: "todo3", relatedGapId: "g3" }, { parentId: n1.nodeId });

    const json = tree.serialize();
    expect(Array.isArray(json.nodes)).toBe(true);
    expect(json.nodes.length).toBe(2);

    const restored = PlanningTree.fromJSON(json);
    expect(restored.runId).toBe("run-2");
    expect(restored.rootGoal).toBe("root");
    expect(restored.getNodesForGap("g3")).toHaveLength(2);
    expect(restored.getNodesForTodo("t3")).toHaveLength(1);
  });

  it("handles legacy json without nodes", () => {
    const restored = PlanningTree.fromJSON({ runId: "legacy", rootGoal: "goal" });
    expect(restored.runId).toBe("legacy");
    expect(restored.rootGoal).toBe("goal");
    expect(restored.nodes.size).toBe(0);
  });
});
