
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  applyStatePatch,
  buildStatePatch,
  cloneJson,
  diffLayers,
  getAtPath,
  getPatchLayers,
  updateAtPath,
} from "../../../js/agents/runtime/memory/state-diff.js";

import { StateEngine } from "../../../js/agents/runtime/memory/state-engine.js";
import { addMessage, addTodo, setTaskGoal } from "../../../js/agents/runtime/memory/action-types.js";

describe("state-diff", () => {
  describe("cloneJson", () => {
    it("should clone JSON-ish values", () => {
      const input = { a: 1, nested: { b: 2 }, arr: [1, 2, 3] };
      const out = cloneJson(input);

      expect(out).toEqual(input);
      expect(out).not.toBe(input);
      expect(out.nested).not.toBe(input.nested);
      expect(out.arr).not.toBe(input.arr);
    });

    it("should fall back when structuredClone fails", () => {
      const input = { a: 1, fn: () => 1 };
      const out = cloneJson(input);
      expect(out).toEqual({ a: 1 });

      const fn = () => 123;
      const fnOut = cloneJson(fn);
      expect(fnOut).toBe(fn);
    });
  });

  describe("applyStatePatch", () => {
    it("should apply add/remove/replace to objects without mutating base", () => {
      const base = { a: 1, b: { c: 2 }, keep: { z: 9 } };
      const patch = [
        { op: "replace", path: ["b", "c"], value: 42 },
        { op: "add", path: ["d"], value: 5 },
        { op: "remove", path: ["a"] },
      ];

      const out = applyStatePatch(base, patch);
      expect(out).toEqual({ b: { c: 42 }, keep: { z: 9 }, d: 5 });

      // Base is unchanged
      expect(base).toEqual({ a: 1, b: { c: 2 }, keep: { z: 9 } });

      // Structural sharing: untouched subtrees reuse references
      expect(out.keep).toBe(base.keep);
      expect(out.b).not.toBe(base.b);
    });

    it("should apply array ops (remove/insert/replace) in order", () => {
      const base = { arr: ["a", "b", "c"] };
      const patch = [
        { op: "remove", path: ["arr", 1] },
        { op: "add", path: ["arr", 1], value: "B" },
        { op: "replace", path: ["arr", 2], value: "C" },
      ];
      const out = applyStatePatch(base, patch);
      expect(out).toEqual({ arr: ["a", "B", "C"] });
      expect(base).toEqual({ arr: ["a", "b", "c"] });
    });

    it("should support root replace/remove", () => {
      expect(applyStatePatch({ a: 1 }, [{ op: "replace", path: [], value: { b: 2 } }])).toEqual({ b: 2 });
      expect(applyStatePatch({ a: 1 }, [{ op: "remove", path: [] }])).toBe(undefined);
    });

    it("should throw on unsafe path segments and invalid ops", () => {
      expect(() => applyStatePatch({ a: 1 }, [{ op: "add", path: ["__proto__", "polluted"], value: true }])).toThrow(/unsafe_path_segment/);

      expect(() => applyStatePatch({ a: 1 }, [{ op: "move", path: ["a"], value: 2 }])).toThrow(/invalid_patch_op/);
    });

    it("should throw on invalid array indices", () => {
      expect(() => applyStatePatch({ arr: [] }, [{ op: "replace", path: ["arr", -1], value: 1 }])).toThrow(/patch_path_invalid_array_index/);
    });
  });

  describe("buildStatePatch/applyStatePatch roundtrip", () => {
    it("should diff object key adds/removes", () => {
      const base = { a: 1, b: 2 };
      const next = { a: 1, c: 3 };
      const patch = buildStatePatch(base, next);
      const out = applyStatePatch(base, patch);
      expect(out).toEqual(next);
      expect(patch).toContainEqual({ op: "remove", path: ["b"] });
      expect(patch).toContainEqual({ op: "add", path: ["c"], value: 3 });
    });

    it("should produce incremental ops for array append", () => {
      const shared = { id: 1 };
      const base = { arr: [shared] };
      const next = { arr: [shared, { id: 2 }] };
      const patch = buildStatePatch(base, next);
      expect(patch).toContainEqual({ op: "add", path: ["arr", 1], value: { id: 2 } });
      expect(applyStatePatch(base, patch)).toEqual(next);
    });

    it("should produce incremental ops for array middle removal", () => {
      const a = { id: "a" };
      const b = { id: "b" };
      const c = { id: "c" };
      const base = { arr: [a, b, c] };
      const next = { arr: [a, c] };

      const patch = buildStatePatch(base, next);
      expect(patch).toEqual([{ op: "remove", path: ["arr", 1] }]);
      expect(applyStatePatch(base, patch)).toEqual(next);
    });

    it("should diff array element updates by path when possible", () => {
      const a = { id: "a" };
      const b = { id: "b", extra: 1 };
      const c = { id: "c" };
      const base = { arr: [a, b, c] };
      const next = { arr: [a, { ...b, id: "b2" }, c] };

      const patch = buildStatePatch(base, next, { maxDepth: 10 });
      expect(patch).toContainEqual({ op: "replace", path: ["arr", 1, "id"], value: "b2" });
      expect(applyStatePatch(base, patch)).toEqual(next);
    });

    it("should fall back to replacing arrays when array diff is too large", () => {
      const base = { arr: [1, 2, 3] };
      const next = { arr: [1, 2, 3, 4, 5] };
      const patch = buildStatePatch(base, next, { maxArrayOps: 1 });
      expect(patch).toEqual([{ op: "replace", path: ["arr"], value: next.arr }]);
      expect(applyStatePatch(base, patch)).toEqual(next);
    });

    it("should fall back to replacing when depth is exceeded", () => {
      const base = { a: { b: { c: 1 } } };
      const next = { a: { b: { c: 2 } } };
      const patch = buildStatePatch(base, next, { maxDepth: 1 });
      expect(patch).toEqual([{ op: "replace", path: ["a"], value: next.a }]);
      expect(applyStatePatch(base, patch)).toEqual(next);
    });

    it("should fall back to root replace when ops limit is exceeded", () => {
      const base = { a: 1, b: 2 };
      const next = { a: 1, c: 3 };
      const patch = buildStatePatch(base, next, { maxOps: 1 });
      expect(patch).toEqual([{ op: "replace", path: [], value: next }]);
      expect(applyStatePatch(base, patch)).toEqual(next);
    });

    it("should fall back to root replace on unsafe keys", () => {
      const base = Object.create(null);
      base.safe = 1;

      const next = Object.create(null);
      Object.defineProperty(next, "__proto__", { value: { polluted: true }, enumerable: true });
      next.safe = 1;

      const patch = buildStatePatch(base, next);
      expect(patch).toEqual([{ op: "replace", path: [], value: next }]);
      expect(applyStatePatch(base, patch)).toEqual(next);
    });
  });

  describe("layer helpers", () => {
    it("diffLayers should report changed layers by reference", () => {
      const L0 = {};
      const prev = { L0, L1: {}, L2: {}, L3: {} };
      const next = { L0, L1: {}, L2: {}, L3: {} };
      const diff = diffLayers(prev, next);
      expect(diff).toEqual({ L0: false, L1: true, L2: true, L3: true });
    });

    it("getPatchLayers should extract L0-L3 from patch paths", () => {
      const patch = [
        { op: "replace", path: ["L0", "taskGoal"], value: "x" },
        { op: "add", path: ["L2", "claims", 0], value: { id: 1 } },
        { op: "replace", path: [], value: { any: true } },
      ];
      const layers = getPatchLayers(patch);
      expect(layers.has("L0")).toBe(true);
      expect(layers.has("L2")).toBe(true);
      expect(layers.has("L1")).toBe(false);
    });
  });

  describe("path helpers", () => {
    it("getAtPath/updateAtPath should work with structural sharing", () => {
      const base = { a: { b: 1 }, keep: { x: 1 } };
      expect(getAtPath(base, ["a", "b"])).toBe(1);

      const out = updateAtPath(base, ["a", "b"], (v) => (typeof v === "number" ? v + 1 : 0));
      expect(out).toEqual({ a: { b: 2 }, keep: { x: 1 } });
      expect(out.keep).toBe(base.keep);
      expect(out.a).not.toBe(base.a);
      expect(base.a.b).toBe(1);
    });
  });
});

describe("StateEngine integration (diff checkpoints + layer subscribe)", () => {
  it("should support L0/L1 layer subscriptions", () => {
    const engine = new StateEngine();

    let l0Calls = 0;
    let l1Calls = 0;

    engine.subscribeLayer("L0", (action, prev, next) => {
      l0Calls += 1;
      expect(action.type).toBe("L0/SET_TASK_GOAL");
      expect(prev.taskGoal).toBe("");
      expect(next.taskGoal).toBe("Goal");
    });

    // Overload form: subscribe("L1", fn)
    engine.subscribe("L1", () => {
      l1Calls += 1;
    });

    engine.dispatchSync(setTaskGoal("Goal"));
    engine.dispatchSync(addMessage({ role: "user", content: "hi" }));

    expect(l0Calls).toBe(1);
    expect(l1Calls).toBe(1);
  });

  it("should save differential checkpoints and restore by id while preserving the checkpoint log", () => {
    const engine = new StateEngine();

    engine.dispatchSync(setTaskGoal("Goal 1"));
    const cp1 = engine.saveCheckpoint({ fullSnapshotEvery: 1000 });
    expect(cp1.encoding).toBe("full");

    engine.dispatchSync(addTodo({ text: "Todo 1" }));
    const cp2 = engine.saveCheckpoint({ fullSnapshotEvery: 1000 });
    expect(cp2.encoding).toBe("diff");
    expect(cp2.baseId).toBe(cp1.checkpointId);

    engine.dispatchSync(setTaskGoal("Goal 2"));
    const cp3 = engine.saveCheckpoint({ fullSnapshotEvery: 1000 });
    expect(cp3.encoding).toBe("diff");
    expect(cp3.baseId).toBe(cp2.checkpointId);

    engine.restoreCheckpoint(cp1.checkpointId);
    const restored1 = engine.getState();
    expect(restored1.L0.taskGoal).toBe("Goal 1");
    expect(restored1.L0.todos.length).toBe(0);
    expect(restored1.L3.checkpoints.length).toBe(3);

    engine.restoreCheckpoint(cp3.checkpointId);
    const restored3 = engine.getState();
    expect(restored3.L0.taskGoal).toBe("Goal 2");
    expect(restored3.L0.todos.length).toBe(1);
    expect(restored3.L3.checkpoints.length).toBe(3);
  });
});
