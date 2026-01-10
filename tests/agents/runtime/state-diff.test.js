import { describe, it } from "node:test";
import assert from "node:assert/strict";

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

      assert.deepEqual(out, input);
      assert.notEqual(out, input);
      assert.notEqual(out.nested, input.nested);
      assert.notEqual(out.arr, input.arr);
    });

    it("should fall back when structuredClone fails", () => {
      const input = { a: 1, fn: () => 1 };
      const out = cloneJson(input);
      assert.deepEqual(out, { a: 1 });

      const fn = () => 123;
      const fnOut = cloneJson(fn);
      assert.equal(fnOut, fn);
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
      assert.deepEqual(out, { b: { c: 42 }, keep: { z: 9 }, d: 5 });

      // Base is unchanged
      assert.deepEqual(base, { a: 1, b: { c: 2 }, keep: { z: 9 } });

      // Structural sharing: untouched subtrees reuse references
      assert.equal(out.keep, base.keep);
      assert.notEqual(out.b, base.b);
    });

    it("should apply array ops (remove/insert/replace) in order", () => {
      const base = { arr: ["a", "b", "c"] };
      const patch = [
        { op: "remove", path: ["arr", 1] },
        { op: "add", path: ["arr", 1], value: "B" },
        { op: "replace", path: ["arr", 2], value: "C" },
      ];
      const out = applyStatePatch(base, patch);
      assert.deepEqual(out, { arr: ["a", "B", "C"] });
      assert.deepEqual(base, { arr: ["a", "b", "c"] });
    });

    it("should support root replace/remove", () => {
      assert.deepEqual(applyStatePatch({ a: 1 }, [{ op: "replace", path: [], value: { b: 2 } }]), { b: 2 });
      assert.equal(applyStatePatch({ a: 1 }, [{ op: "remove", path: [] }]), undefined);
    });

    it("should throw on unsafe path segments and invalid ops", () => {
      assert.throws(
        () => applyStatePatch({ a: 1 }, [{ op: "add", path: ["__proto__", "polluted"], value: true }]),
        /unsafe_path_segment/
      );

      assert.throws(
        () => applyStatePatch({ a: 1 }, [{ op: "move", path: ["a"], value: 2 }]),
        /invalid_patch_op/
      );
    });

    it("should throw on invalid array indices", () => {
      assert.throws(
        () => applyStatePatch({ arr: [] }, [{ op: "replace", path: ["arr", -1], value: 1 }]),
        /patch_path_invalid_array_index/
      );
    });
  });

  describe("buildStatePatch/applyStatePatch roundtrip", () => {
    it("should diff object key adds/removes", () => {
      const base = { a: 1, b: 2 };
      const next = { a: 1, c: 3 };
      const patch = buildStatePatch(base, next);
      const out = applyStatePatch(base, patch);
      assert.deepEqual(out, next);
      assert.ok(patch.some((op) => op.op === "remove" && op.path[0] === "b"));
      assert.ok(patch.some((op) => op.op === "add" && op.path[0] === "c"));
    });

    it("should produce incremental ops for array append", () => {
      const shared = { id: 1 };
      const base = { arr: [shared] };
      const next = { arr: [shared, { id: 2 }] };
      const patch = buildStatePatch(base, next);
      assert.ok(patch.some((op) => op.op === "add" && op.path[0] === "arr"));
      assert.deepEqual(applyStatePatch(base, patch), next);
    });

    it("should produce incremental ops for array middle removal", () => {
      const a = { id: "a" };
      const b = { id: "b" };
      const c = { id: "c" };
      const base = { arr: [a, b, c] };
      const next = { arr: [a, c] };

      const patch = buildStatePatch(base, next);
      assert.deepEqual(patch, [{ op: "remove", path: ["arr", 1] }]);
      assert.deepEqual(applyStatePatch(base, patch), next);
    });

    it("should diff array element updates by path when possible", () => {
      const a = { id: "a" };
      const b = { id: "b", extra: 1 };
      const c = { id: "c" };
      const base = { arr: [a, b, c] };
      const next = { arr: [a, { ...b, id: "b2" }, c] };

      const patch = buildStatePatch(base, next, { maxDepth: 10 });
      assert.ok(
        patch.some((op) => op.op === "replace" && op.path[0] === "arr" && op.path[1] === 1),
        "expected replace inside arr[1] subtree"
      );
      assert.deepEqual(applyStatePatch(base, patch), next);
    });

    it("should fall back to replacing arrays when array diff is too large", () => {
      const base = { arr: [1, 2, 3] };
      const next = { arr: [1, 2, 3, 4, 5] };
      const patch = buildStatePatch(base, next, { maxArrayOps: 1 });
      assert.deepEqual(patch, [{ op: "replace", path: ["arr"], value: next.arr }]);
      assert.deepEqual(applyStatePatch(base, patch), next);
    });

    it("should fall back to replacing when depth is exceeded", () => {
      const base = { a: { b: { c: 1 } } };
      const next = { a: { b: { c: 2 } } };
      const patch = buildStatePatch(base, next, { maxDepth: 1 });
      assert.deepEqual(patch, [{ op: "replace", path: ["a"], value: next.a }]);
      assert.deepEqual(applyStatePatch(base, patch), next);
    });

    it("should fall back to root replace when ops limit is exceeded", () => {
      const base = { a: 1, b: 2 };
      const next = { a: 1, c: 3 };
      const patch = buildStatePatch(base, next, { maxOps: 1 });
      assert.deepEqual(patch, [{ op: "replace", path: [], value: next }]);
      assert.deepEqual(applyStatePatch(base, patch), next);
    });

    it("should fall back to root replace on unsafe keys", () => {
      const base = Object.create(null);
      base.safe = 1;

      const next = Object.create(null);
      Object.defineProperty(next, "__proto__", { value: { polluted: true }, enumerable: true });
      next.safe = 1;

      const patch = buildStatePatch(base, next);
      assert.deepEqual(patch, [{ op: "replace", path: [], value: next }]);
      assert.deepEqual(applyStatePatch(base, patch), next);
    });
  });

  describe("layer helpers", () => {
    it("diffLayers should report changed layers by reference", () => {
      const L0 = {};
      const prev = { L0, L1: {}, L2: {}, L3: {} };
      const next = { L0, L1: {}, L2: {}, L3: {} };
      const diff = diffLayers(prev, next);
      assert.deepEqual(diff, { L0: false, L1: true, L2: true, L3: true });
    });

    it("getPatchLayers should extract L0-L3 from patch paths", () => {
      const patch = [
        { op: "replace", path: ["L0", "taskGoal"], value: "x" },
        { op: "add", path: ["L2", "claims", 0], value: { id: 1 } },
        { op: "replace", path: [], value: { any: true } },
      ];
      const layers = getPatchLayers(patch);
      assert.equal(layers.has("L0"), true);
      assert.equal(layers.has("L2"), true);
      assert.equal(layers.has("L1"), false);
    });
  });

  describe("path helpers", () => {
    it("getAtPath/updateAtPath should work with structural sharing", () => {
      const base = { a: { b: 1 }, keep: { x: 1 } };
      assert.equal(getAtPath(base, ["a", "b"]), 1);

      const out = updateAtPath(base, ["a", "b"], (v) => (typeof v === "number" ? v + 1 : 0));
      assert.deepEqual(out, { a: { b: 2 }, keep: { x: 1 } });
      assert.equal(out.keep, base.keep);
      assert.notEqual(out.a, base.a);
      assert.equal(base.a.b, 1);
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
      assert.equal(action.type, "L0/SET_TASK_GOAL");
      assert.equal(prev.taskGoal, "");
      assert.equal(next.taskGoal, "Goal");
    });

    // Overload form: subscribe("L1", fn)
    engine.subscribe("L1", () => {
      l1Calls += 1;
    });

    engine.dispatchSync(setTaskGoal("Goal"));
    engine.dispatchSync(addMessage({ role: "user", content: "hi" }));

    assert.equal(l0Calls, 1);
    assert.equal(l1Calls, 1);
  });

  it("should save differential checkpoints and restore by id while preserving the checkpoint log", () => {
    const engine = new StateEngine();

    engine.dispatchSync(setTaskGoal("Goal 1"));
    const cp1 = engine.saveCheckpoint({ fullSnapshotEvery: 1000 });
    assert.equal(cp1.encoding, "full");

    engine.dispatchSync(addTodo({ text: "Todo 1" }));
    const cp2 = engine.saveCheckpoint({ fullSnapshotEvery: 1000 });
    assert.equal(cp2.encoding, "diff");
    assert.equal(cp2.baseId, cp1.checkpointId);

    engine.dispatchSync(setTaskGoal("Goal 2"));
    const cp3 = engine.saveCheckpoint({ fullSnapshotEvery: 1000 });
    assert.equal(cp3.encoding, "diff");
    assert.equal(cp3.baseId, cp2.checkpointId);

    engine.restoreCheckpoint(cp1.checkpointId);
    const restored1 = engine.getState();
    assert.equal(restored1.L0.taskGoal, "Goal 1");
    assert.equal(restored1.L0.todos.length, 0);
    assert.equal(restored1.L3.checkpoints.length, 3);

    engine.restoreCheckpoint(cp3.checkpointId);
    const restored3 = engine.getState();
    assert.equal(restored3.L0.taskGoal, "Goal 2");
    assert.equal(restored3.L0.todos.length, 1);
    assert.equal(restored3.L3.checkpoints.length, 3);
  });
});

