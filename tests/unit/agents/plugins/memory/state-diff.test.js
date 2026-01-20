import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  cloneJson,
  getAtPath,
  updateAtPath,
  applyStatePatch,
} from "../../../../../js/agents/plugins/memory/state-diff.js";
import { readFileSync } from "node:fs";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
}));

const originalStructuredClone = globalThis.structuredClone;

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.structuredClone = originalStructuredClone;
});

describe("cloneJson", () => {
  it("returns primitives and empty values unchanged", () => {
    const values = [
      null,
      undefined,
      "",
      " ",
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
    ];

    for (const value of values) {
      expect(cloneJson(value)).toBe(value);
    }
  });

  it("clones objects and arrays using structuredClone when available", () => {
    const input = { a: { b: 1 }, arr: [1, 2], empty: {} };
    const structuredCloneMock = vi.fn((value) =>
      JSON.parse(JSON.stringify(value)),
    );
    globalThis.structuredClone = structuredCloneMock;

    const result = cloneJson(input);

    expect(structuredCloneMock).toHaveBeenCalledWith(input);
    expect(result).toEqual(input);
    expect(result).not.toBe(input);
    expect(result.a).not.toBe(input.a);

    const emptyArr = [];
    const arrResult = cloneJson(emptyArr);
    expect(arrResult).toEqual([]);
    expect(arrResult).not.toBe(emptyArr);

    const emptyObj = {};
    const objResult = cloneJson(emptyObj);
    expect(objResult).toEqual({});
    expect(objResult).not.toBe(emptyObj);
  });

  it("falls back to JSON clone when structuredClone throws", () => {
    globalThis.structuredClone = vi.fn(() => {
      throw new Error("boom");
    });

    const input = { a: 1, nested: { b: 2 } };
    const result = cloneJson(input);

    expect(result).toEqual(input);
    expect(result).not.toBe(input);
    expect(result.nested).not.toBe(input.nested);
  });

  it("returns original value when JSON clone fails", () => {
    globalThis.structuredClone = vi.fn(() => {
      throw new Error("boom");
    });

    const circular = {};
    circular.self = circular;

    const result = cloneJson(circular);
    expect(result).toBe(circular);
  });

  it("keeps large strings unchanged from mocked file contents", () => {
    readFileSync.mockReturnValue("x".repeat(200000));

    const bigString = readFileSync("big.txt", "utf8");
    const result = cloneJson(bigString);

    expect(result).toBe(bigString);
    expect(readFileSync).toHaveBeenCalledWith("big.txt", "utf8");
  });
});

describe("getAtPath", () => {
  it("returns nested value for mixed path types", () => {
    const base = { a: { b: [{ c: 3 }] } };
    expect(getAtPath(base, ["a", "b", 0, "c"])).toBe(3);
  });

  it("returns undefined when path hits null or undefined", () => {
    expect(getAtPath({ a: null }, ["a", "b"])).toBeUndefined();
    expect(getAtPath(undefined, ["a"])).toBeUndefined();
  });

  it("returns root when path is empty", () => {
    const base = { a: 1 };
    expect(getAtPath(base, [])).toBe(base);
  });

  it("handles numeric and string indices on arrays and objects", () => {
    const base = { arr: ["x"], obj: { 0: "zero" } };
    expect(getAtPath(base, ["arr", "0"])).toBe("x");
    expect(getAtPath(base, ["obj", 0])).toBe("zero");
  });

  it("handles edge keys and boundary indices", () => {
    const base = { "": "empty", " ": "space", arr: ["first"] };
    expect(getAtPath(base, [""])).toBe("empty");
    expect(getAtPath(base, [" "])).toBe("space");
    expect(getAtPath(base, ["arr", 0])).toBe("first");
    expect(getAtPath(base, ["arr", -1])).toBeUndefined();
    expect(
      getAtPath(base, ["arr", Number.MAX_SAFE_INTEGER]),
    ).toBeUndefined();
  });

  it("handles deep nesting and empty containers", () => {
    const root = {};
    let current = root;
    const path = [];

    for (let i = 0; i < 60; i += 1) {
      current.next = {};
      current = current.next;
      path.push("next");
    }

    current.value = "end";
    path.push("value");

    expect(getAtPath(root, path)).toBe("end");
    expect(getAtPath({}, ["missing"])).toBeUndefined();
    expect(getAtPath([], [0])).toBeUndefined();
  });
});

describe("updateAtPath", () => {
  it("updates nested value with structural sharing", () => {
    const base = { a: { b: 1 }, keep: { c: 2 } };
    const result = updateAtPath(base, ["a", "b"], (value) => value + 1);

    expect(result).not.toBe(base);
    expect(result.a).not.toBe(base.a);
    expect(result.keep).toBe(base.keep);
    expect(result.a.b).toBe(2);
    expect(base.a.b).toBe(1);
  });

  it("updates arrays without mutating the original", () => {
    const base = [1, 2];
    const result = updateAtPath(base, [1], () => 99);

    expect(result).toEqual([1, 99]);
    expect(base).toEqual([1, 2]);
    expect(result).not.toBe(base);
  });

  it("supports empty path for root updates", () => {
    const base = { a: 1 };
    const updater = vi.fn(() => ({ b: 2 }));
    const result = updateAtPath(base, [], updater);

    expect(updater).toHaveBeenCalledWith(base);
    expect(result).toEqual({ b: 2 });
  });

  it("creates missing nested objects", () => {
    const updater = vi.fn(() => "value");
    const result = updateAtPath({}, ["a", "b"], updater);

    expect(result).toEqual({ a: { b: "value" } });
    expect(updater).toHaveBeenCalledWith(undefined);
  });

  it("handles null base and numeric keys on objects", () => {
    const fromNull = updateAtPath(null, ["a"], () => 1);
    const fromNumberKey = updateAtPath({}, [0], () => "zero");

    expect(fromNull).toEqual({ a: 1 });
    expect(fromNumberKey).toEqual({ 0: "zero" });
  });

  it("handles string numeric index on arrays", () => {
    const result = updateAtPath(["a"], ["0"], () => "b");
    expect(result).toEqual(["b"]);
  });

  it("handles rapid consecutive updates without mutating base", () => {
    const base = { count: 0 };
    const results = [];

    for (let i = 0; i < 5; i += 1) {
      results.push(updateAtPath(base, ["count"], () => i));
    }

    expect(results.map((item) => item.count)).toEqual([0, 1, 2, 3, 4]);
    expect(base.count).toBe(0);
  });

  it("handles deep nested paths", () => {
    const root = {};
    let current = root;
    const path = [];

    for (let i = 0; i < 70; i += 1) {
      current.next = {};
      current = current.next;
      path.push("next");
    }

    const result = updateAtPath(root, [...path, "value"], () => "deep");

    expect(getAtPath(result, [...path, "value"])).toBe("deep");
    expect(getAtPath(root, [...path, "value"])).toBeUndefined();
  });
});

describe("applyStatePatch", () => {
  it("throws for invalid ops", () => {
    expect(() =>
      applyStatePatch({}, [{ op: "move", path: [] }]),
    ).toThrow("invalid_patch_op: move");
  });

  it("throws for unsafe path segments", () => {
    expect(() =>
      applyStatePatch({}, [{ op: "add", path: ["__proto__"], value: 1 }]),
    ).toThrow("unsafe_path_segment: __proto__");
  });

  it("applies root operations", () => {
    const replaceResult = applyStatePatch(
      { a: 1 },
      [{ op: "replace", path: [], value: { b: 2 } }],
    );
    const removeResult = applyStatePatch(
      { a: 1 },
      [{ op: "remove", path: [] }],
    );
    const addResult = applyStatePatch(
      { a: 1 },
      [{ op: "add", path: [], value: "root" }],
    );

    expect(replaceResult).toEqual({ b: 2 });
    expect(removeResult).toBeUndefined();
    expect(addResult).toBe("root");
  });

  it("applies object ops with structural sharing", () => {
    const base = { a: 1, nested: { x: 1 }, keep: { y: 2 } };
    const patch = [
      { op: "replace", path: ["nested", "x"], value: 9 },
      { op: "remove", path: ["a"] },
      { op: "add", path: ["added"], value: "yes" },
    ];

    const result = applyStatePatch(base, patch);

    expect(result).toEqual({
      nested: { x: 9 },
      keep: { y: 2 },
      added: "yes",
    });
    expect(result.keep).toBe(base.keep);
    expect(base).toEqual({ a: 1, nested: { x: 1 }, keep: { y: 2 } });
  });

  it("applies array ops with numeric indices", () => {
    const base = { arr: ["a", "b", "c"] };
    const patch = [
      { op: "replace", path: ["arr", 0], value: "z" },
      { op: "remove", path: ["arr", 1] },
      { op: "add", path: ["arr", 1], value: "y" },
    ];

    const result = applyStatePatch(base, patch);

    expect(result.arr).toEqual(["z", "y", "c"]);
    expect(base.arr).toEqual(["a", "b", "c"]);
  });

  it("throws on negative array index", () => {
    expect(() =>
      applyStatePatch(
        { arr: ["a"] },
        [{ op: "remove", path: ["arr", -1] }],
      ),
    ).toThrow("patch_path_invalid_array_index: -1");
  });

  it("creates missing parents for null or undefined bases", () => {
    const fromNull = applyStatePatch(null, [
      { op: "add", path: ["a", 0], value: "x" },
    ]);
    const fromUndefined = applyStatePatch(undefined, [
      { op: "add", path: [0], value: "y" },
    ]);

    expect(fromNull).toEqual({ a: ["x"] });
    expect(fromUndefined).toEqual(["y"]);
  });

  it("handles string index on arrays and numeric keys on objects", () => {
    const arrayBase = { arr: ["a", "b"] };
    const arrayResult = applyStatePatch(arrayBase, [
      { op: "add", path: ["arr", "0"], value: "x" },
    ]);

    const objectBase = { obj: { 1: "one", 2: "two" } };
    const objectResult = applyStatePatch(objectBase, [
      { op: "remove", path: ["obj", 1] },
    ]);

    expect(arrayResult.arr).toEqual(["x", "b"]);
    expect(arrayResult.arr.length).toBe(2);
    expect(objectResult.obj).toEqual({ 2: "two" });
  });

  it("handles large string values and large indices", () => {
    readFileSync.mockReturnValue("y".repeat(150000));
    const largeText = readFileSync("large.txt", "utf8");

    const base = { text: "" };
    const textResult = applyStatePatch(base, [
      { op: "replace", path: ["text"], value: largeText },
    ]);
    const indexResult = applyStatePatch({ arr: ["a"] }, [
      {
        op: "add",
        path: ["arr", Number.MAX_SAFE_INTEGER],
        value: "z",
      },
    ]);

    expect(textResult.text).toBe(largeText);
    expect(indexResult.arr).toEqual(["a", "z"]);
  });

  it("supports concurrent calls without shared state", async () => {
    const base = { a: 1, b: 2 };
    const patches = [
      [{ op: "replace", path: ["a"], value: 10 }],
      [{ op: "replace", path: ["b"], value: 20 }],
      [{ op: "add", path: ["c"], value: 30 }],
    ];

    const results = await Promise.all(
      patches.map((patch) =>
        Promise.resolve().then(() => applyStatePatch(base, patch)),
      ),
    );

    expect(results[0]).toEqual({ a: 10, b: 2 });
    expect(results[1]).toEqual({ a: 1, b: 20 });
    expect(results[2]).toEqual({ a: 1, b: 2, c: 30 });
    expect(base).toEqual({ a: 1, b: 2 });
  });
});
