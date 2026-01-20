import { describe, it, expect, vi, beforeEach } from "vitest";

const sharedMocks = vi.hoisted(() => ({
  isPlainObject: vi.fn(),
  toNonEmptyString: vi.fn(),
}));

vi.mock("../../../../../../js/agents/shared/index.js", () => ({
  isPlainObject: sharedMocks.isPlainObject,
  toNonEmptyString: sharedMocks.toNonEmptyString,
}));

import { ReportState } from "../../../../../../js/agents/stages/deepsearch/state/report-state.js";

beforeEach(() => {
  sharedMocks.isPlainObject.mockReset();
  sharedMocks.toNonEmptyString.mockReset();

  sharedMocks.isPlainObject.mockImplementation((value) => {
    if (value === null || typeof value !== "object") return false;
    if (Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  });

  sharedMocks.toNonEmptyString.mockImplementation((value) => {
    if (value === null || value === undefined) return undefined;
    const str = String(value).trim();
    return str.length ? str : undefined;
  });
});

describe("ReportState", () => {
  it("returns null report when root or report is missing", () => {
    const missingRoot = new ReportState(null);
    expect(missingRoot.report).toBeNull();

    missingRoot.report = { markdown: "m" };
    expect(sharedMocks.isPlainObject).not.toHaveBeenCalled();

    const emptyRoot = new ReportState({});
    expect(emptyRoot.report).toBeNull();
  });

  it("sets report and normalizes L1 container", () => {
    const root = { L1: "nope" };
    const state = new ReportState(root);
    const report = { markdown: "m" };
    state.report = report;
    expect(root.L1).toEqual({ report });
    expect(sharedMocks.isPlainObject).toHaveBeenCalledWith("nope");

    const root2 = { L1: { keep: true } };
    const l1Ref = root2.L1;
    const report2 = { markdown: "x" };
    const state2 = new ReportState(root2);
    state2.report = report2;
    expect(root2.L1).toBe(l1Ref);
    expect(root2.L1.keep).toBe(true);
    expect(root2.L1.report).toBe(report2);
  });

  it("returns reportDraft string or empty string for invalid values", () => {
    const root = { L1: { report: { draftMarkdown: "draft" } } };
    const state = new ReportState(root);
    expect(state.reportDraft).toBe("draft");

    root.L1.report.draftMarkdown = "";
    expect(state.reportDraft).toBe("");

    root.L1.report.draftMarkdown = 0;
    expect(state.reportDraft).toBe("");

    root.L1.report.draftMarkdown = { a: 1 };
    expect(state.reportDraft).toBe("");
  });

  it("creates a report container and stores normalized draft", () => {
    const root = {};
    const state = new ReportState(root);
    state.reportDraft = "  draft  ";

    expect(root.L1.report).toMatchObject({
      markdown: "",
      draftMarkdown: "draft",
      sections: [],
      citations: [],
      history: [],
      version: 0,
    });
    expect(sharedMocks.isPlainObject).toHaveBeenCalledTimes(2);
    expect(sharedMocks.toNonEmptyString).toHaveBeenCalledWith("  draft  ");
  });

  it("falls back to empty string for empty or whitespace drafts", () => {
    const inputs = ["", "   ", null, undefined];

    for (const value of inputs) {
      const root = {};
      const state = new ReportState(root);
      state.reportDraft = value;
      expect(root.L1.report.draftMarkdown).toBe("");
    }

    expect(sharedMocks.toNonEmptyString).toHaveBeenCalledTimes(inputs.length);
  });

  it("handles numeric boundaries and large drafts", () => {
    const values = [0, -1, Number.MAX_SAFE_INTEGER, "42"];

    for (const value of values) {
      const root = {};
      const state = new ReportState(root);
      state.reportDraft = value;
      expect(root.L1.report.draftMarkdown).toBe(String(value).trim());
    }

    const big = "x".repeat(1024 * 1024);
    const bigRoot = {};
    const bigState = new ReportState(bigRoot);
    bigState.reportDraft = big;
    expect(bigRoot.L1.report.draftMarkdown).toBe(big);
    expect(bigRoot.L1.report.draftMarkdown.length).toBe(big.length);
  });

  it("returns outline arrays or empty arrays for invalid values", () => {
    const missingRoot = new ReportState(null);
    expect(missingRoot.outline).toEqual([]);

    const root = { L1: { report: { sections: { a: 1 } } } };
    const state = new ReportState(root);
    expect(state.outline).toEqual([]);

    root.L1.report.sections = [];
    expect(state.outline).toEqual([]);

    root.L1.report.sections = ["a"];
    expect(state.outline).toEqual(["a"]);
  });

  it("creates outline arrays, resets non-arrays, and supports deep nesting", () => {
    const root = {};
    const state = new ReportState(root);

    let deep = { level: 0 };
    let cursor = deep;
    for (let i = 1; i < 200; i++) {
      cursor.next = { level: i };
      cursor = cursor.next;
    }

    const sections = [deep];
    state.outline = sections;
    expect(root.L1.report.sections).toBe(sections);

    state.outline = { not: "array" };
    expect(root.L1.report.sections).toEqual([]);

    const emptySections = [];
    state.outline = emptySections;
    expect(root.L1.report.sections).toBe(emptySections);
  });

  it("no-ops draft and outline setters when root is missing", () => {
    const state = new ReportState(undefined);
    state.reportDraft = "x";
    state.outline = ["a"];

    expect(sharedMocks.isPlainObject).not.toHaveBeenCalled();
    expect(sharedMocks.toNonEmptyString).not.toHaveBeenCalled();
  });

  it("handles rapid successive updates to draft and outline", async () => {
    const root = {};
    const state = new ReportState(root);
    const draftValues = ["first", "second", "third"];
    const outlineValues = [["a"], ["b", "c"], []];

    const tasks = [];
    for (const value of draftValues) {
      tasks.push(Promise.resolve().then(() => {
        state.reportDraft = value;
      }));
    }
    for (const value of outlineValues) {
      tasks.push(Promise.resolve().then(() => {
        state.outline = value;
      }));
    }

    await Promise.all(tasks);

    expect(state.reportDraft).toBe("third");
    expect(state.outline).toEqual([]);
  });
});
