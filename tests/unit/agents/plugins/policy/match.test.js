import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../js/agents/vfs/glob.js", () => ({
  matchGlob: vi.fn(),
}));

import match, {
  matchWildcard,
  matchAnyWildcard,
  matchAnyGlob,
} from "../../../../../js/agents/plugins/policy/match.js";
import { matchGlob } from "../../../../../js/agents/vfs/glob.js";

const matchGlobMock = vi.mocked(matchGlob);

beforeEach(() => {
  matchGlobMock.mockReset();
  matchGlobMock.mockReturnValue(false);
});

describe("matchWildcard", () => {
  it.each([
    ["", "anything"],
    [null, "anything"],
    [undefined, "anything"],
    [0, "anything"],
    [-1, "anything"],
    [Number.MAX_SAFE_INTEGER, "anything"],
    [{}, "anything"],
    [[], "anything"],
  ])("returns false when pattern is %p", (pattern, value) => {
    expect(matchWildcard(pattern, value)).toBe(false);
  });

  it("treats non-string value as empty string", () => {
    expect(matchWildcard("*", 123)).toBe(true);
    expect(matchWildcard("a", 123)).toBe(false);
    expect(matchWildcard("a*", 0)).toBe(false);
    expect(matchWildcard("a*", {})).toBe(false);
  });

  it("matches exactly when pattern has no '*'", () => {
    expect(matchWildcard("abc", "abc")).toBe(true);
    expect(matchWildcard("abc", "ab")).toBe(false);

    expect(matchWildcard("   ", "   ")).toBe(true);
    expect(matchWildcard("   ", "  ")).toBe(false);

    expect(matchWildcard("0", "0")).toBe(true);
    expect(matchWildcard("0", 0)).toBe(false);
  });

  it("supports '*' wildcard including empty matches", () => {
    expect(matchWildcard("*", "")).toBe(true);
    expect(matchWildcard("*", "anything")).toBe(true);

    expect(matchWildcard("a*b", "ab")).toBe(true);
    expect(matchWildcard("a*b", "axxb")).toBe(true);
    expect(matchWildcard("a*b", "ac")).toBe(false);
  });

  it("supports leading and trailing wildcards", () => {
    expect(matchWildcard("*b", "b")).toBe(true);
    expect(matchWildcard("*b", "ab")).toBe(true);
    expect(matchWildcard("*b", "ba")).toBe(false);

    expect(matchWildcard("a*", "a")).toBe(true);
    expect(matchWildcard("a*", "abc")).toBe(true);
    expect(matchWildcard("a*", "")).toBe(false);
  });

  it("handles repeated '*' segments", () => {
    expect(matchWildcard("a**b", "ab")).toBe(true);
    expect(matchWildcard("a**b", "axxb")).toBe(true);

    expect(matchWildcard("**", "whatever")).toBe(true);
    expect(matchWildcard("**", "")).toBe(true);
  });

  it("is deterministic under concurrent / rapid calls", async () => {
    const tasks = Array.from({ length: 50 }, () =>
      Promise.resolve(matchWildcard("a*b", "axxb")),
    );
    const results = await Promise.all(tasks);
    expect(results.every(Boolean)).toBe(true);

    for (let i = 0; i < 200; i++) {
      expect(matchWildcard("x*y*z", "x___y___z")).toBe(true);
    }
  });

  it("handles very long strings without throwing", () => {
    const long = "x".repeat(100_000);
    expect(() => matchWildcard("a*", `a${long}`)).not.toThrow();
    expect(matchWildcard("a*", `a${long}`)).toBe(true);

    const exact = "a".repeat(50_000);
    expect(matchWildcard(exact, exact)).toBe(true);
    expect(matchWildcard(exact, `${exact}b`)).toBe(false);
  });
});

describe("matchAnyWildcard", () => {
  it("returns true when patterns is null or undefined", () => {
    expect(matchAnyWildcard(null, "anything")).toBe(true);
    expect(matchAnyWildcard(undefined, "anything")).toBe(true);
  });

  it("returns true when patterns is an empty array", () => {
    expect(matchAnyWildcard([], "anything")).toBe(true);
  });

  it("matches when any string pattern matches", () => {
    expect(matchAnyWildcard("a*b", "axxb")).toBe(true);
    expect(matchAnyWildcard(["nope", "a*b"], "axxb")).toBe(true);
    expect(matchAnyWildcard(["nope", "still-nope"], "axxb")).toBe(false);
  });

  it("ignores non-string entries (including empty object / nested arrays)", () => {
    expect(matchAnyWildcard([0, -1, Number.MAX_SAFE_INTEGER, {}, []], "x")).toBe(
      false,
    );
    expect(matchAnyWildcard([null, undefined, {}, ["a*"], "a*"], "abc")).toBe(
      true,
    );

    /** @type {any} */
    const deeplyNested = [[[[["a*"]]]]];
    expect(matchAnyWildcard(deeplyNested, "abc")).toBe(false);
  });

  it("does not normalize or trim patterns (whitespace is significant)", () => {
    expect(matchAnyWildcard(["   "], "   ")).toBe(true);
    expect(matchAnyWildcard(["   "], "  ")).toBe(false);
  });

  it("handles type boundaries without throwing", () => {
    expect(() => matchAnyWildcard(0, "0")).not.toThrow();
    expect(matchAnyWildcard(0, "0")).toBe(false);

    expect(matchAnyWildcard("-1", "-1")).toBe(true);
    expect(matchAnyWildcard(Number.MAX_SAFE_INTEGER, "x")).toBe(false);
  });

  it("is deterministic under concurrent / rapid calls", async () => {
    const patterns = ["nope", "a*b", "also-nope"];
    const tasks = Array.from({ length: 25 }, () =>
      Promise.resolve(matchAnyWildcard(patterns, "axxb")),
    );
    const results = await Promise.all(tasks);
    expect(results.every(Boolean)).toBe(true);

    for (let i = 0; i < 200; i++) {
      expect(matchAnyWildcard(["x*y*z"], "x___y___z")).toBe(true);
    }
  });

  it("handles many patterns and very long values", () => {
    const many = Array.from({ length: 1000 }, (_, i) => `nope-${i}`);
    many.push("a*");
    const long = "x".repeat(100_000);
    expect(matchAnyWildcard(many, `a${long}`)).toBe(true);
  });
});

describe("matchAnyGlob", () => {
  it("returns true when patterns is null or undefined (and does not call matchGlob)", () => {
    expect(matchAnyGlob(null, "any/path")).toBe(true);
    expect(matchAnyGlob(undefined, "any/path")).toBe(true);
    expect(matchGlobMock).not.toHaveBeenCalled();
  });

  it("returns true when patterns is an empty array (and does not call matchGlob)", () => {
    expect(matchAnyGlob([], "any/path")).toBe(true);
    expect(matchGlobMock).not.toHaveBeenCalled();
  });

  it("returns false when there are no valid normalized string patterns", () => {
    expect(matchAnyGlob({}, "any/path")).toBe(false);
    expect(matchAnyGlob([0, {}, []], "any/path")).toBe(false);
    expect(matchGlobMock).not.toHaveBeenCalled();

    expect(matchAnyGlob(["", "   ", "\\\\"], "any/path")).toBe(false);
    expect(matchGlobMock).not.toHaveBeenCalled();
  });

  it("normalizes patterns before calling matchGlob", () => {
    matchGlobMock.mockReturnValue(true);

    const ok = matchAnyGlob("  .//\\foo\\\\bar///baz  ", "x/y/z");
    expect(ok).toBe(true);
    expect(matchGlobMock).toHaveBeenCalledTimes(1);
    expect(matchGlobMock).toHaveBeenCalledWith("foo/bar/baz", "x/y/z");
  });

  it("tries patterns in order and short-circuits on the first match", () => {
    matchGlobMock.mockImplementation((pattern) => pattern === "b/**");

    const ok = matchAnyGlob(["a/**", "b/**", "c/**"], "b/file.txt");
    expect(ok).toBe(true);
    expect(matchGlobMock).toHaveBeenCalledTimes(2);
    expect(matchGlobMock.mock.calls[0]).toEqual(["a/**", "b/file.txt"]);
    expect(matchGlobMock.mock.calls[1]).toEqual(["b/**", "b/file.txt"]);
  });

  it("ignores non-string patterns in arrays", () => {
    matchGlobMock.mockImplementation((pattern) => pattern === "a/**");

    const ok = matchAnyGlob([null, 0, {}, "a/**"], "a/file.txt");
    expect(ok).toBe(true);
    expect(matchGlobMock).toHaveBeenCalledTimes(1);
    expect(matchGlobMock).toHaveBeenCalledWith("a/**", "a/file.txt");
  });

  it("is deterministic under concurrent / rapid calls", async () => {
    matchGlobMock.mockImplementation((pattern, path) => {
      return pattern === "src/**" && path.startsWith("src/");
    });

    const patterns = ["src/**"];
    const tasks = [
      Promise.resolve(matchAnyGlob(patterns, "src/a.js")),
      Promise.resolve(matchAnyGlob(patterns, "src/b.js")),
      Promise.resolve(matchAnyGlob(patterns, "test/c.js")),
    ];
    const results = await Promise.all(tasks);
    expect(results).toEqual([true, true, false]);
  });

  it("handles very long paths (resource boundary) by delegating to matchGlob", () => {
    matchGlobMock.mockImplementation((_pattern, path) => path.length > 50_000);

    const longPath = `a/${"x".repeat(100_000)}`;
    expect(matchAnyGlob(["a/**"], longPath)).toBe(true);
    expect(matchGlobMock).toHaveBeenCalledWith("a/**", longPath);
  });
});

describe("default", () => {
  it("exports the named functions on the default object", () => {
    expect(match.matchWildcard).toBe(matchWildcard);
    expect(match.matchAnyWildcard).toBe(matchAnyWildcard);
    expect(match.matchAnyGlob).toBe(matchAnyGlob);
    expect(Object.keys(match).sort()).toEqual(
      ["matchWildcard", "matchAnyWildcard", "matchAnyGlob"].sort(),
    );
  });
});