import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

import { validateSlide } from "../../../../../../js/agents/stages/design/refiner/qa-validator.js";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(() => "mocked"),
}));

describe("validateSlide", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns pass and empty issues for a valid slide", () => {
    const html = [
      '<section data-bg="#ffffff">',
      '<div data-el="text" id="t1" data-x="0%" data-y="0%" data-w="100%" data-h="100%" data-font="16" data-color="#000000">Hello</div>',
      "</section>",
    ].join("");

    const result = validateSlide(html);

    expect(result.pass).toBe(true);
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.violations).toEqual([]);
  });

  it("detects overflow on x and y bounds", () => {
    const html = [
      '<section data-bg="#ffffff">',
      '<div data-el="box" id="el1" data-x="-1%" data-y="90%" data-w="20%" data-h="20%"></div>',
      "</section>",
    ].join("");

    const result = validateSlide(html);

    expect(result.pass).toBe(false);
    const codes = result.issues.map((issue) => issue.code);
    expect(codes).toEqual(expect.arrayContaining(["overflow_x", "overflow_y"]));
    expect(result.issues.every((issue) => issue.severity === "error")).toBe(true);
    expect(result.issues.map((issue) => issue.elementId)).toEqual(["el1", "el1"]);
    const violationTypes = result.violations.map((violation) => violation.type);
    expect(violationTypes).toEqual(expect.arrayContaining(["overflow_x", "overflow_y"]));
  });

  it("detects min font size from data-font and style", () => {
    const html = [
      '<section data-bg="#ffffff">',
      '<div data-el="text" id="t1" data-font="-1" data-color="#000000" data-x="0%" data-y="0%" data-w="50%" data-h="10%"></div>',
      '<div data-el="text" id="t2" style="font-size: 10px; color: #000000;" data-x="0%" data-y="10%" data-w="50%" data-h="10%"></div>',
      "</section>",
    ].join("");

    const result = validateSlide(html);

    expect(result.pass).toBe(false);
    const minFontIssues = result.issues.filter((issue) => issue.code === "min_font");
    expect(minFontIssues).toHaveLength(2);
    expect(minFontIssues.map((issue) => issue.elementId).sort()).toEqual(["t1", "t2"]);
  });

  it("warns on low contrast and still passes", () => {
    const html = [
      '<section data-bg="#ffffff">',
      '<div data-el="text" id="lowc" data-font="14" data-color="#fefefe"></div>',
      "</section>",
    ].join("");

    const result = validateSlide(html);

    expect(result.pass).toBe(true);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].code).toBe("contrast");
    expect(result.issues[0].severity).toBe("warn");
    expect(result.issues[0].elementId).toBe("lowc");
  });

  it("ignores invalid colors without emitting contrast issues", () => {
    const html = [
      '<section data-bg="not-a-color">',
      '<div data-el="text" id="t1" data-font="14" data-color="rgb(0,0,0)"></div>',
      "</section>",
    ].join("");

    const result = validateSlide(html);

    expect(result.pass).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("handles non-string and empty inputs safely", () => {
    const inputs = [null, undefined, "", "   ", [], {}, 0];

    for (const input of inputs) {
      const result = validateSlide(input);
      expect(result.pass).toBe(true);
      expect(result.valid).toBe(true);
      expect(result.issues).toEqual([]);
      expect(result.violations).toEqual([]);
    }
  });

  it("handles non-percent numeric strings and MAX_SAFE_INTEGER bounds", () => {
    const html = [
      "<section>",
      '<div data-el="box" id="safe" data-x="10" data-y="0%" data-w="90%" data-h="100%"></div>',
      `<div data-el="box" id="big" data-x="${Number.MAX_SAFE_INTEGER}%" data-y="0%" data-w="1%" data-h="1%"></div>`,
      '<div data-el="text" id="zero-font" data-font="0" data-color="#000000"></div>',
      "</section>",
    ].join("");

    const result = validateSlide(html);

    expect(result.pass).toBe(false);
    expect(result.issues.some((issue) => issue.elementId === "safe")).toBe(false);
    expect(result.issues.some((issue) => issue.elementId === "big" && issue.code === "overflow_x")).toBe(true);
    expect(result.issues.some((issue) => issue.code === "min_font" && issue.elementId === "zero-font")).toBe(false);
  });

  it("supports concurrent and rapid calls with consistent output", async () => {
    const html = '<section><div data-el="text" id="t1" data-font="11"></div></section>';

    const concurrent = await Promise.all(
      Array.from({ length: 5 }, () => Promise.resolve(validateSlide(html)))
    );
    const sequential = Array.from({ length: 5 }, () => validateSlide(html));

    for (const result of concurrent) {
      expect(result).toEqual(concurrent[0]);
    }
    for (const result of sequential) {
      expect(result).toEqual(concurrent[0]);
    }
  });

  it("handles large and deeply nested input", () => {
    const depth = 200;
    const nestedOpen = "<div>".repeat(depth);
    const nestedClose = "</div>".repeat(depth);
    const longText = "x".repeat(200000);

    const html = [
      '<section data-bg="#ffffff">',
      nestedOpen,
      '<span data-el="text" id="deep" data-font="12" data-color="#000000">OK</span>',
      nestedClose,
      longText,
      '<div data-el="box" id="b1" data-x="0%" data-y="0%" data-w="100%" data-h="100%"></div>',
      "</section>",
    ].join("");

    const result = validateSlide(html);

    expect(result.pass).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("does not access filesystem dependencies", () => {
    const html = '<section><div data-el="text" id="t1" data-font="16"></div></section>';

    validateSlide(html);

    expect(readFileSync).not.toHaveBeenCalled();
  });
});
