import { beforeEach, describe, expect, it, vi } from "vitest";

const toNonEmptyStringMock = vi.hoisted(() => vi.fn());

vi.mock("../../../../../js/agents/shared/index.js", async () => {
  const actual = await vi.importActual("../../../../../js/agents/shared/index.js");
  return {
    ...actual,
    toNonEmptyString: toNonEmptyStringMock,
  };
});

import { deriveSummary } from "../../../../../js/agents/stages/textprep/build-content-package.js";

const DELIMITER = "\uFF1B";

const defaultToNonEmptyString = (value) => {
  if (value === undefined || value === null) return undefined;
  const s = String(value).trim();
  return s.length ? s : undefined;
};

const makeDeepObject = (depth) => {
  let obj = { value: "deep" };
  for (let i = 0; i < depth; i += 1) {
    obj = { nested: obj };
  }
  return obj;
};

beforeEach(() => {
  toNonEmptyStringMock.mockReset();
  toNonEmptyStringMock.mockImplementation(defaultToNonEmptyString);
});

describe("deriveSummary", () => {
  it("prefers top three claim texts and joins with the delimiter", () => {
    const summary = deriveSummary("ignored", [
      { text: "First" },
      { text: "Second" },
      { text: "Third" },
      { text: "Fourth" },
    ]);

    expect(summary).toBe(["First", "Second", "Third"].join(DELIMITER));
  });

  it("filters empty/whitespace claim texts before joining", () => {
    const summary = deriveSummary("fallback", [
      { text: "   " },
      { text: "" },
      { text: " Alpha " },
      { text: null },
      { text: "Beta" },
      { text: "\tGamma\n" },
    ]);

    expect(summary).toBe(["Alpha", "Beta", "Gamma"].join(DELIMITER));
  });

  it("falls back to collapsed source text when claims are missing", () => {
    const summary = deriveSummary("  Hello   world \n  again\t", []);

    expect(summary).toBe("Hello world again");
  });

  it.each([
    { label: "null source", source: null },
    { label: "undefined source", source: undefined },
    { label: "empty string source", source: "" },
    { label: "whitespace source", source: "   \n\t " },
  ])("returns empty string for $label", ({ source }) => {
    expect(deriveSummary(source, [])).toBe("");
  });

  it("handles numeric source text boundary values", () => {
    expect(deriveSummary(0, [])).toBe("");
    expect(deriveSummary(-1, [])).toBe("-1");
    expect(deriveSummary(Number.MAX_SAFE_INTEGER, [])).toBe(String(Number.MAX_SAFE_INTEGER));
  });

  it("handles numeric claim text boundary values", () => {
    const summary = deriveSummary("ignored", [
      { text: 0 },
      { text: -1 },
      { text: Number.MAX_SAFE_INTEGER },
    ]);

    expect(summary).toBe(["0", "-1", String(Number.MAX_SAFE_INTEGER)].join(DELIMITER));
  });

  it.each([
    { label: "empty array claims", claims: [] },
    { label: "empty object claims", claims: {} },
    { label: "string claims", claims: "not-array" },
  ])("treats $label as empty and uses source text", ({ claims }) => {
    expect(deriveSummary("  fallback   text ", claims)).toBe("fallback text");
  });

  it("handles deep nested claim text values", () => {
    const deep = makeDeepObject(20);
    const summary = deriveSummary("ignored", [{ text: deep }, { text: "next" }]);

    expect(summary).toBe(["[object Object]", "next"].join(DELIMITER));
  });

  it("truncates large source text to 280 characters", () => {
    const huge = "a".repeat(10000);
    const summary = deriveSummary(huge, []);

    expect(summary).toBe("a".repeat(280));
    expect(summary.length).toBe(280);
  });

  it("propagates errors from toNonEmptyString", () => {
    toNonEmptyStringMock.mockImplementation(() => {
      throw new Error("boom");
    });

    expect(() => deriveSummary("source", [{ text: "fail" }])).toThrow("boom");
  });

  it("handles concurrent calls independently", async () => {
    const inputs = [
      { source: "  alpha   beta ", claims: [] },
      { source: "ignored", claims: [{ text: "One" }, { text: "Two" }] },
      { source: "  ", claims: [{ text: "Only" }] },
    ];

    const results = await Promise.all(
      inputs.map(({ source, claims }) => Promise.resolve().then(() => deriveSummary(source, claims))),
    );

    expect(results).toEqual([
      "alpha beta",
      ["One", "Two"].join(DELIMITER),
      "Only",
    ]);
  });

  it("handles rapid consecutive calls without shared state", () => {
    const expected = ["A", "B"].join(DELIMITER);
    const outputs = [];

    for (let i = 0; i < 50; i += 1) {
      outputs.push(deriveSummary("ignored", [{ text: "A" }, { text: "B" }]));
    }

    expect(outputs).toHaveLength(50);
    outputs.forEach((value) => {
      expect(value).toBe(expected);
    });
  });
});
