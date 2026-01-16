
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { Deque } from "../../js/agents/shared/utils/deque.js";

describe("shared/utils/deque", () => {
  describe("constructor", () => {
    it("creates empty deque", () => {
      const d = new Deque();
      expect(d.size).toBe(0);
      expect(d.isEmpty()).toBeTruthy();
    });

    it("creates deque from iterable", () => {
      const d = new Deque([1, 2, 3]);
      expect(d.size).toBe(3);
      expect(d.toArray()).toEqual([1, 2, 3]);
    });

    it("creates deque from Set", () => {
      const d = new Deque(new Set(["a", "b"]));
      expect(d.size).toBe(2);
    });

    it("creates deque from generator", () => {
      function* gen() {
        yield 1;
        yield 2;
      }
      const d = new Deque(gen());
      expect(d.size).toBe(2);
    });
  });

  describe("push", () => {
    it("adds to back", () => {
      const d = new Deque();
      d.push(1);
      d.push(2);
      expect(d.toArray()).toEqual([1, 2]);
    });

    it("increases size", () => {
      const d = new Deque();
      d.push("a");
      expect(d.size).toBe(1);
      d.push("b");
      expect(d.size).toBe(2);
    });
  });

  describe("pop", () => {
    it("removes from back", () => {
      const d = new Deque([1, 2, 3]);
      expect(d.pop()).toBe(3);
      expect(d.pop()).toBe(2);
      expect(d.toArray()).toEqual([1]);
    });

    it("returns undefined when empty", () => {
      const d = new Deque();
      expect(d.pop()).toBe(undefined);
    });

    it("decreases size", () => {
      const d = new Deque([1, 2]);
      d.pop();
      expect(d.size).toBe(1);
    });
  });

  describe("shift", () => {
    it("removes from front", () => {
      const d = new Deque([1, 2, 3]);
      expect(d.shift()).toBe(1);
      expect(d.shift()).toBe(2);
      expect(d.toArray()).toEqual([3]);
    });

    it("returns undefined when empty", () => {
      const d = new Deque();
      expect(d.shift()).toBe(undefined);
    });

    it("decreases size", () => {
      const d = new Deque([1, 2]);
      d.shift();
      expect(d.size).toBe(1);
    });
  });

  describe("unshift", () => {
    it("adds to front", () => {
      const d = new Deque([2, 3]);
      d.unshift(1);
      expect(d.toArray()).toEqual([1, 2, 3]);
    });

    it("increases size", () => {
      const d = new Deque();
      d.unshift("x");
      expect(d.size).toBe(1);
    });

    it("handles negative indices internally", () => {
      const d = new Deque([1]);
      d.unshift(0);
      d.unshift(-1);
      expect(d.toArray()).toEqual([-1, 0, 1]);
    });
  });

  describe("peekFront", () => {
    it("returns front element without removing", () => {
      const d = new Deque([1, 2, 3]);
      expect(d.peekFront()).toBe(1);
      expect(d.size).toBe(3);
    });

    it("returns undefined when empty", () => {
      const d = new Deque();
      expect(d.peekFront()).toBe(undefined);
    });
  });

  describe("peekBack", () => {
    it("returns back element without removing", () => {
      const d = new Deque([1, 2, 3]);
      expect(d.peekBack()).toBe(3);
      expect(d.size).toBe(3);
    });

    it("returns undefined when empty", () => {
      const d = new Deque();
      expect(d.peekBack()).toBe(undefined);
    });
  });

  describe("isEmpty", () => {
    it("returns true for empty deque", () => {
      expect(new Deque().isEmpty()).toBeTruthy();
    });

    it("returns false for non-empty deque", () => {
      expect(new Deque([1]).isEmpty()).toBeFalsy();
    });

    it("returns true after all elements removed", () => {
      const d = new Deque([1]);
      d.pop();
      expect(d.isEmpty()).toBeTruthy();
    });
  });

  describe("size", () => {
    it("returns 0 for empty deque", () => {
      expect(new Deque().size).toBe(0);
    });

    it("returns correct count", () => {
      expect(new Deque([1, 2, 3, 4, 5]).size).toBe(5);
    });

    it("updates after operations", () => {
      const d = new Deque([1, 2]);
      d.push(3);
      expect(d.size).toBe(3);
      d.shift();
      expect(d.size).toBe(2);
      d.unshift(0);
      expect(d.size).toBe(3);
      d.pop();
      expect(d.size).toBe(2);
    });
  });

  describe("toArray", () => {
    it("returns empty array for empty deque", () => {
      expect(new Deque().toArray()).toEqual([]);
    });

    it("returns array copy", () => {
      const d = new Deque([1, 2, 3]);
      const arr = d.toArray();
      arr[0] = 999;
      expect(d.peekFront()).toBe(1);
    });

    it("maintains order after mixed operations", () => {
      const d = new Deque([2, 3]);
      d.unshift(1);
      d.push(4);
      expect(d.toArray()).toEqual([1, 2, 3, 4]);
    });
  });

  describe("clear", () => {
    it("empties the deque", () => {
      const d = new Deque([1, 2, 3]);
      d.clear();
      expect(d.size).toBe(0);
      expect(d.isEmpty()).toBeTruthy();
    });

    it("allows reuse after clear", () => {
      const d = new Deque([1, 2]);
      d.clear();
      d.push(3);
      expect(d.toArray()).toEqual([3]);
    });
  });

  describe("Symbol.iterator", () => {
    it("iterates in order", () => {
      const d = new Deque([1, 2, 3]);
      const result = [];
      for (const item of d) {
        result.push(item);
      }
      expect(result).toEqual([1, 2, 3]);
    });

    it("works with spread operator", () => {
      const d = new Deque(["a", "b", "c"]);
      expect([...d]).toEqual(["a", "b", "c"]);
    });

    it("works with Array.from", () => {
      const d = new Deque([1, 2]);
      expect(Array.from(d)).toEqual([1, 2]);
    });

    it("iterates empty deque", () => {
      const d = new Deque();
      const result = [];
      for (const item of d) {
        result.push(item);
      }
      expect(result).toEqual([]);
    });

    it("multiple iterators are independent", () => {
      const d = new Deque([1, 2, 3]);
      const iter1 = d[Symbol.iterator]();
      const iter2 = d[Symbol.iterator]();

      expect(iter1.next().value).toBe(1);
      expect(iter2.next().value).toBe(1);
      expect(iter1.next().value).toBe(2);
      expect(iter2.next().value).toBe(2);
    });
  });

  describe("mixed operations", () => {
    it("handles alternating push/shift (queue behavior)", () => {
      const d = new Deque();
      d.push(1);
      d.push(2);
      expect(d.shift()).toBe(1);
      d.push(3);
      expect(d.shift()).toBe(2);
      expect(d.shift()).toBe(3);
      expect(d.isEmpty()).toBeTruthy();
    });

    it("handles alternating push/pop (stack behavior)", () => {
      const d = new Deque();
      d.push(1);
      d.push(2);
      expect(d.pop()).toBe(2);
      d.push(3);
      expect(d.pop()).toBe(3);
      expect(d.pop()).toBe(1);
      expect(d.isEmpty()).toBeTruthy();
    });

    it("handles unshift/pop combination", () => {
      const d = new Deque();
      d.unshift(1);
      d.unshift(2);
      expect(d.pop()).toBe(1);
      d.unshift(3);
      expect(d.pop()).toBe(2);
      expect(d.pop()).toBe(3);
    });

    it("handles large number of operations", () => {
      const d = new Deque();
      const n = 1000;

      for (let i = 0; i < n; i++) {
        d.push(i);
      }
      expect(d.size).toBe(n);

      for (let i = 0; i < n; i++) {
        expect(d.shift()).toBe(i);
      }
      expect(d.isEmpty()).toBeTruthy();
    });
  });
});
