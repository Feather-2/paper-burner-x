/**
 * Tests PlanningTree construction, serialization, and fromJSON boundaries.
 * Targets js/agents/stages/deepsearch/state/planning-tree.js to guard edge-case behavior.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const randomUUIDMock = vi.hoisted(() => vi.fn(() => "mock-uuid"));

vi.mock("node:crypto", () => ({
  randomUUID: randomUUIDMock,
}));

import { randomUUID } from "node:crypto";
import { PlanningTree } from "../../../../../../js/agents/stages/deepsearch/state/planning-tree.js";

beforeEach(() => {
  randomUUIDMock.mockClear();
});

describe("PlanningTree", () => {
  it("initializes defaults with empty strings and empty nodes map", () => {
    const tree = new PlanningTree();

    expect(tree.rootGoal).toBe("");
    expect(tree.runId).toBe("");
    expect(tree.nodes).toBeInstanceOf(Map);
    expect(tree.nodes.size).toBe(0);
  });

  it("accepts provided options and uses mocked randomUUID for runId", () => {
    const runId = randomUUID();
    const tree = new PlanningTree({ rootGoal: "goal", runId });

    expect(randomUUIDMock).toHaveBeenCalledTimes(1);
    expect(runId).toBe("mock-uuid");
    expect(tree.rootGoal).toBe("goal");
    expect(tree.runId).toBe("mock-uuid");
  });

  it("normalizes falsy option values to empty strings", () => {
    const treeEmpty = new PlanningTree({ rootGoal: "", runId: "" });
    const treeZero = new PlanningTree({ rootGoal: 0, runId: 0 });
    const treeNil = new PlanningTree({ rootGoal: undefined, runId: null });

    expect(treeEmpty.rootGoal).toBe("");
    expect(treeEmpty.runId).toBe("");

    expect(treeZero.rootGoal).toBe("");
    expect(treeZero.runId).toBe("");

    expect(treeNil.rootGoal).toBe("");
    expect(treeNil.runId).toBe("");
  });

  it("preserves truthy boundary values and types", () => {
    const whitespaceTree = new PlanningTree({ rootGoal: "   ", runId: "\t" });
    const numericStringTree = new PlanningTree({ rootGoal: "0", runId: "123" });
    const numericBoundaryTree = new PlanningTree({
      rootGoal: -1,
      runId: Number.MAX_SAFE_INTEGER,
    });
    const arrayValue = [];
    const objectValue = {};
    const typeBoundaryTree = new PlanningTree({ rootGoal: arrayValue, runId: objectValue });

    expect(whitespaceTree.rootGoal).toBe("   ");
    expect(whitespaceTree.runId).toBe("\t");

    expect(numericStringTree.rootGoal).toBe("0");
    expect(numericStringTree.runId).toBe("123");

    expect(numericBoundaryTree.rootGoal).toBe(-1);
    expect(numericBoundaryTree.runId).toBe(Number.MAX_SAFE_INTEGER);

    expect(typeBoundaryTree.rootGoal).toBe(arrayValue);
    expect(typeBoundaryTree.runId).toBe(objectValue);
  });

  it("serialize and toJSON return snapshots and ignore nodes", () => {
    const tree = new PlanningTree({ rootGoal: "goal", runId: "run" });
    tree.nodes.set("node-1", { id: "node-1" });

    const serialized = tree.serialize();
    const json = tree.toJSON();
    const serializedAgain = tree.serialize();

    expect(serialized).toEqual({ rootGoal: "goal", runId: "run" });
    expect(json).toEqual(serialized);
    expect(serializedAgain).toEqual(serialized);
    expect(json).not.toBe(serialized);
    expect(tree.nodes.size).toBe(1);
  });

  it("expand methods are safe for rapid and concurrent calls", async () => {
    const tree = new PlanningTree({ rootGoal: "goal", runId: "run" });
    const baseline = tree.serialize();

    const concurrentGapCalls = Array.from({ length: 20 }, () =>
      Promise.resolve().then(() => tree.expandFromGap())
    );
    const concurrentTodoCalls = Array.from({ length: 20 }, () =>
      Promise.resolve().then(() => tree.expandFromTodo())
    );

    await Promise.all([...concurrentGapCalls, ...concurrentTodoCalls]);

    for (let i = 0; i < 50; i += 1) {
      tree.expandFromGap();
      tree.expandFromTodo();
    }

    const snapshots = await Promise.all(
      Array.from({ length: 10 }, () => Promise.resolve().then(() => tree.serialize()))
    );

    snapshots.forEach((snapshot) => {
      expect(snapshot).toEqual(baseline);
    });
    expect(tree.nodes.size).toBe(0);
  });

  describe("fromJSON", () => {
    it("creates a new PlanningTree from valid json", () => {
      const tree = PlanningTree.fromJSON({ rootGoal: "goal", runId: "run" });

      expect(tree).toBeInstanceOf(PlanningTree);
      expect(tree.rootGoal).toBe("goal");
      expect(tree.runId).toBe("run");
      expect(tree.nodes).toBeInstanceOf(Map);
      expect(tree.nodes.size).toBe(0);
    });

    it("handles null, undefined, empty string, and primitive inputs", () => {
      const inputs = [null, undefined, "", 0, -1];

      inputs.forEach((value) => {
        expect(() => PlanningTree.fromJSON(value)).not.toThrow();
        const tree = PlanningTree.fromJSON(value);
        expect(tree.rootGoal).toBe("");
        expect(tree.runId).toBe("");
      });
    });

    it("handles empty object, empty array, and array-shaped json", () => {
      const emptyObjectTree = PlanningTree.fromJSON({});
      const emptyArrayTree = PlanningTree.fromJSON([]);

      expect(emptyObjectTree.rootGoal).toBe("");
      expect(emptyObjectTree.runId).toBe("");

      expect(emptyArrayTree.rootGoal).toBe("");
      expect(emptyArrayTree.runId).toBe("");

      const arrayJson = [];
      arrayJson.rootGoal = "array-goal";
      arrayJson.runId = "array-run";

      const arrayTree = PlanningTree.fromJSON(arrayJson);
      expect(arrayTree.rootGoal).toBe("array-goal");
      expect(arrayTree.runId).toBe("array-run");
    });

    it("supports large payloads and deep nesting without crashing", () => {
      const hugeString = "x".repeat(200000);
      const deepNested = { level: 0 };
      let cursor = deepNested;
      for (let i = 1; i <= 40; i += 1) {
        cursor.child = { level: i };
        cursor = cursor.child;
      }

      const tree = PlanningTree.fromJSON({
        rootGoal: hugeString,
        runId: "run-large",
        metadata: deepNested,
      });

      expect(tree.rootGoal).toBe(hugeString);
      expect(tree.rootGoal.length).toBe(hugeString.length);
      expect(tree.runId).toBe("run-large");
    });
  });
});
