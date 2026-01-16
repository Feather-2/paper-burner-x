import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { Deque } from "../../js/agents/shared/utils/deque.js";

describe("shared/utils/deque", () => {
  describe("constructor", () => {
    it("creates empty deque", () => {
      const d = new Deque();
      assert.equal(d.size, 0);
      assert.ok(d.isEmpty());
    });

    it("creates deque from iterable", () => {
      const d = new Deque([1, 2, 3]);
      assert.equal(d.size, 3);
      assert.deepEqual(d.toArray(), [1, 2, 3]);
    });

    it("creates deque from Set", () => {
      const d = new Deque(new Set(["a", "b"]));
      assert.equal(d.size, 2);
    });

    it("creates deque from generator", () => {
      function* gen() {
        yield 1;
        yield 2;
      }
      const d = new Deque(gen());
      assert.equal(d.size, 2);
    });
  });

  describe("push", () => {
    it("adds to back", () => {
      const d = new Deque();
      d.push(1);
      d.push(2);
      assert.deepEqual(d.toArray(), [1, 2]);
    });

    it("increases size", () => {
      const d = new Deque();
      d.push("a");
      assert.equal(d.size, 1);
      d.push("b");
      assert.equal(d.size, 2);
    });
  });

  describe("pop", () => {
    it("removes from back", () => {
      const d = new Deque([1, 2, 3]);
      assert.equal(d.pop(), 3);
      assert.equal(d.pop(), 2);
      assert.deepEqual(d.toArray(), [1]);
    });

    it("returns undefined when empty", () => {
      const d = new Deque();
      assert.equal(d.pop(), undefined);
    });

    it("decreases size", () => {
      const d = new Deque([1, 2]);
      d.pop();
      assert.equal(d.size, 1);
    });
  });

  describe("shift", () => {
    it("removes from front", () => {
      const d = new Deque([1, 2, 3]);
      assert.equal(d.shift(), 1);
      assert.equal(d.shift(), 2);
      assert.deepEqual(d.toArray(), [3]);
    });

    it("returns undefined when empty", () => {
      const d = new Deque();
      assert.equal(d.shift(), undefined);
    });

    it("decreases size", () => {
      const d = new Deque([1, 2]);
      d.shift();
      assert.equal(d.size, 1);
    });
  });

  describe("unshift", () => {
    it("adds to front", () => {
      const d = new Deque([2, 3]);
      d.unshift(1);
      assert.deepEqual(d.toArray(), [1, 2, 3]);
    });

    it("increases size", () => {
      const d = new Deque();
      d.unshift("x");
      assert.equal(d.size, 1);
    });

    it("handles negative indices internally", () => {
      const d = new Deque([1]);
      d.unshift(0);
      d.unshift(-1);
      assert.deepEqual(d.toArray(), [-1, 0, 1]);
    });
  });

  describe("peekFront", () => {
    it("returns front element without removing", () => {
      const d = new Deque([1, 2, 3]);
      assert.equal(d.peekFront(), 1);
      assert.equal(d.size, 3);
    });

    it("returns undefined when empty", () => {
      const d = new Deque();
      assert.equal(d.peekFront(), undefined);
    });
  });

  describe("peekBack", () => {
    it("returns back element without removing", () => {
      const d = new Deque([1, 2, 3]);
      assert.equal(d.peekBack(), 3);
      assert.equal(d.size, 3);
    });

    it("returns undefined when empty", () => {
      const d = new Deque();
      assert.equal(d.peekBack(), undefined);
    });
  });

  describe("isEmpty", () => {
    it("returns true for empty deque", () => {
      assert.ok(new Deque().isEmpty());
    });

    it("returns false for non-empty deque", () => {
      assert.ok(!new Deque([1]).isEmpty());
    });

    it("returns true after all elements removed", () => {
      const d = new Deque([1]);
      d.pop();
      assert.ok(d.isEmpty());
    });
  });

  describe("size", () => {
    it("returns 0 for empty deque", () => {
      assert.equal(new Deque().size, 0);
    });

    it("returns correct count", () => {
      assert.equal(new Deque([1, 2, 3, 4, 5]).size, 5);
    });

    it("updates after operations", () => {
      const d = new Deque([1, 2]);
      d.push(3);
      assert.equal(d.size, 3);
      d.shift();
      assert.equal(d.size, 2);
      d.unshift(0);
      assert.equal(d.size, 3);
      d.pop();
      assert.equal(d.size, 2);
    });
  });

  describe("toArray", () => {
    it("returns empty array for empty deque", () => {
      assert.deepEqual(new Deque().toArray(), []);
    });

    it("returns array copy", () => {
      const d = new Deque([1, 2, 3]);
      const arr = d.toArray();
      arr[0] = 999;
      assert.equal(d.peekFront(), 1);
    });

    it("maintains order after mixed operations", () => {
      const d = new Deque([2, 3]);
      d.unshift(1);
      d.push(4);
      assert.deepEqual(d.toArray(), [1, 2, 3, 4]);
    });
  });

  describe("clear", () => {
    it("empties the deque", () => {
      const d = new Deque([1, 2, 3]);
      d.clear();
      assert.equal(d.size, 0);
      assert.ok(d.isEmpty());
    });

    it("allows reuse after clear", () => {
      const d = new Deque([1, 2]);
      d.clear();
      d.push(3);
      assert.deepEqual(d.toArray(), [3]);
    });
  });

  describe("Symbol.iterator", () => {
    it("iterates in order", () => {
      const d = new Deque([1, 2, 3]);
      const result = [];
      for (const item of d) {
        result.push(item);
      }
      assert.deepEqual(result, [1, 2, 3]);
    });

    it("works with spread operator", () => {
      const d = new Deque(["a", "b", "c"]);
      assert.deepEqual([...d], ["a", "b", "c"]);
    });

    it("works with Array.from", () => {
      const d = new Deque([1, 2]);
      assert.deepEqual(Array.from(d), [1, 2]);
    });

    it("iterates empty deque", () => {
      const d = new Deque();
      const result = [];
      for (const item of d) {
        result.push(item);
      }
      assert.deepEqual(result, []);
    });

    it("multiple iterators are independent", () => {
      const d = new Deque([1, 2, 3]);
      const iter1 = d[Symbol.iterator]();
      const iter2 = d[Symbol.iterator]();

      assert.equal(iter1.next().value, 1);
      assert.equal(iter2.next().value, 1);
      assert.equal(iter1.next().value, 2);
      assert.equal(iter2.next().value, 2);
    });
  });

  describe("mixed operations", () => {
    it("handles alternating push/shift (queue behavior)", () => {
      const d = new Deque();
      d.push(1);
      d.push(2);
      assert.equal(d.shift(), 1);
      d.push(3);
      assert.equal(d.shift(), 2);
      assert.equal(d.shift(), 3);
      assert.ok(d.isEmpty());
    });

    it("handles alternating push/pop (stack behavior)", () => {
      const d = new Deque();
      d.push(1);
      d.push(2);
      assert.equal(d.pop(), 2);
      d.push(3);
      assert.equal(d.pop(), 3);
      assert.equal(d.pop(), 1);
      assert.ok(d.isEmpty());
    });

    it("handles unshift/pop combination", () => {
      const d = new Deque();
      d.unshift(1);
      d.unshift(2);
      assert.equal(d.pop(), 1);
      d.unshift(3);
      assert.equal(d.pop(), 2);
      assert.equal(d.pop(), 3);
    });

    it("handles large number of operations", () => {
      const d = new Deque();
      const n = 1000;

      for (let i = 0; i < n; i++) {
        d.push(i);
      }
      assert.equal(d.size, n);

      for (let i = 0; i < n; i++) {
        assert.equal(d.shift(), i);
      }
      assert.ok(d.isEmpty());
    });
  });
});
