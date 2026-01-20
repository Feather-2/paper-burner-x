import { describe, it, expect, vi, beforeEach } from 'vitest';

const readFileSyncMock = vi.hoisted(() =>
  vi.fn(() => '<div class="mocked" data-id="42"></div>')
);

vi.mock("node:fs", () => ({
  readFileSync: readFileSyncMock,
}));

import { readFileSync } from "node:fs";
import { parseTagAttributes } from "../../../../../../js/agents/stages/design/shared/html-parser.js";

function expectEmptyAttrs(attrs) {
  expect(Object.keys(attrs)).toEqual([]);
  expect(Object.getPrototypeOf(attrs)).toBe(null);
}

describe("parseTagAttributes", () => {
  beforeEach(() => {
    readFileSyncMock.mockReset();
    readFileSyncMock.mockReturnValue('<div class="mocked" data-id="42"></div>');
  });

  it("parses quoted and unquoted values with lowercased names", () => {
    const attrs = parseTagAttributes(
      '<div CLASS="Hero" data-id=123 data-name="Alpha">'
    );

    expect(attrs.class).toBe("Hero");
    expect(attrs["data-id"]).toBe("123");
    expect(attrs["data-name"]).toBe("Alpha");
    expect(Object.getPrototypeOf(attrs)).toBe(null);
  });

  it("handles boolean attributes and empty values", () => {
    const attrs = parseTagAttributes("<input disabled required value=>");

    expect(attrs.disabled).toBe("");
    expect(attrs.required).toBe("");
    expect(attrs.value).toBe("");
  });

  it("keeps special characters inside quoted values", () => {
    const attrs = parseTagAttributes('<div title="a > b / c">');

    expect(attrs.title).toBe("a > b / c");
  });

  it("stops unquoted values at tag terminators", () => {
    const attrs = parseTagAttributes("<img src=foo/>");

    expect(attrs.src).toBe("foo");
  });

  it("skips forbidden keys and prevents prototype pollution", () => {
    const attrs = parseTagAttributes(
      '<div __proto__="x" constructor="y" PROTOTYPE="z" ok="1">'
    );

    expect(Object.prototype.hasOwnProperty.call(attrs, "__proto__")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(attrs, "constructor")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(attrs, "prototype")).toBe(false);
    expect(attrs.ok).toBe("1");
    expect(({}).polluted).toBeUndefined();
  });

  it("returns empty attrs for nullish and empty inputs", () => {
    const inputs = [null, undefined, "", [], {}, "   "];

    for (const input of inputs) {
      const attrs = parseTagAttributes(input);
      expectEmptyAttrs(attrs);
    }
  });

  it("returns empty attrs for numeric boundary and type edge inputs", () => {
    const arrayLike = { 0: "<div a=1>", length: 1 };
    const inputs = [0, -1, Number.MAX_SAFE_INTEGER, "123", arrayLike];

    for (const input of inputs) {
      const attrs = parseTagAttributes(input);
      expectEmptyAttrs(attrs);
    }
  });

  it("does not throw on malformed tags and still parses valid attrs", () => {
    const tag = '<div ="x" good="y" title="missing>';
    expect(() => parseTagAttributes(tag)).not.toThrow();

    const attrs = parseTagAttributes(tag);
    expect(attrs.good).toBe("y");
    expect(attrs.title).toBe("missing>");
  });

  it("returns empty when tag has no attributes section", () => {
    const attrs = parseTagAttributes("<div>");

    expectEmptyAttrs(attrs);
  });

  it("last attribute value wins on duplicates", () => {
    const attrs = parseTagAttributes('<div data-id="1" data-id="2">');

    expect(attrs["data-id"]).toBe("2");
  });

  it("handles concurrent calls without shared state", async () => {
    const tag = '<div class="x" data-id="1">';
    const results = await Promise.all(
      Array.from({ length: 25 }, () => Promise.resolve(parseTagAttributes(tag)))
    );

    for (const attrs of results) {
      expect(attrs.class).toBe("x");
      expect(attrs["data-id"]).toBe("1");
      expect(Object.getPrototypeOf(attrs)).toBe(null);
    }
  });

  it("handles rapid successive calls with different inputs", () => {
    const tags = ['<div a="1">', "<span b=2>", '<section c="3" d>'];

    const results = tags.map((tag) => parseTagAttributes(tag));

    expect(results[0].a).toBe("1");
    expect(results[1].b).toBe("2");
    expect(results[2].c).toBe("3");
    expect(results[2].d).toBe("");
  });

  it("handles large and deeply nested attribute values", () => {
    const longValue = "a".repeat(100000);
    const deepValue = '{"a":{"b":{"c":{"d":{"e":"f"}}}}}';
    const manyAttrs = Array.from(
      { length: 2000 },
      (_, i) => `data-${i}="${i}"`
    ).join(" ");
    const tag = `<div ${manyAttrs} data-long="${longValue}" data-deep='${deepValue}'>`;

    const attrs = parseTagAttributes(tag);

    expect(attrs["data-0"]).toBe("0");
    expect(attrs["data-1999"]).toBe("1999");
    expect(attrs["data-long"]).toBe(longValue);
    expect(attrs["data-deep"]).toBe(deepValue);
    expect(Object.keys(attrs).length).toBe(2002);
  });

  it("parses input provided by a mocked external dependency", () => {
    const tag = readFileSync("ignored-path", "utf8");

    const attrs = parseTagAttributes(tag);

    expect(readFileSyncMock).toHaveBeenCalledWith("ignored-path", "utf8");
    expect(attrs.class).toBe("mocked");
    expect(attrs["data-id"]).toBe("42");
  });
});
