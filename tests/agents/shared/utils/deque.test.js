import { describe, it, expect, vi } from "vitest";

import { Deque } from "../../../../js/agents/shared/utils/deque.js";

describe("Deque", () => {
  it("constructs from an iterable (in order)", () => {
    const iterated = vi.fn();
    const iterable = {
      *[Symbol.iterator]() {
        iterated();
        yield 1;
        yield 2;
        yield 3;
      },
    };

    const deque = new Deque(iterable);
    expect(iterated).toHaveBeenCalledTimes(1);

    expect(deque.size).toBe(3);
    expect(deque.isEmpty()).toBe(false);
    expect(deque.peekFront()).toBe(1);
    expect(deque.peekBack()).toBe(3);
    expect(deque.toArray()).toEqual([1, 2, 3]);
  });

  it("supports push/pop/shift/unshift with O(1)-style semantics", () => {
    const deque = new Deque();

    expect(deque.pop()).toBeUndefined();
    expect(deque.shift()).toBeUndefined();
    expect(deque.isEmpty()).toBe(true);

    deque.push("b");
    deque.unshift("a");
    deque.push("c");

    expect(deque.size).toBe(3);
    expect(deque.peekFront()).toBe("a");
    expect(deque.peekBack()).toBe("c");
    expect(deque.toArray()).toEqual(["a", "b", "c"]);

    expect(deque.shift()).toBe("a");
    expect(deque.pop()).toBe("c");
    expect(deque.pop()).toBe("b");
    expect(deque.pop()).toBeUndefined();
    expect(deque.shift()).toBeUndefined();
    expect(deque.isEmpty()).toBe(true);
  });

  it("iterates from front to back without mutating", () => {
    const deque = new Deque(["x", "y", "z"]);
    const seen = [];

    for (const v of deque) seen.push(v);

    expect(seen).toEqual(["x", "y", "z"]);
    expect(deque.size).toBe(3);
    expect(deque.toArray()).toEqual(["x", "y", "z"]);
  });

  it("clear() resets internal state", () => {
    const deque = new Deque([1, 2]);
    deque.clear();

    expect(deque.size).toBe(0);
    expect(deque.isEmpty()).toBe(true);
    expect(deque.peekFront()).toBeUndefined();
    expect(deque.peekBack()).toBeUndefined();
    expect(deque.toArray()).toEqual([]);
  });
});

