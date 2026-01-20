import { describe, it, expect } from "vitest";

import { parseTagAttributes } from "../../../../../../js/agents/stages/design/shared/html-parser.js";

describe("design/shared/html-parser", () => {
  it("returns empty attrs for null or empty input", () => {
    const attrsNull = parseTagAttributes(null);
    const attrsEmpty = parseTagAttributes("");

    expect(Object.keys(attrsNull)).toEqual([]);
    expect(Object.keys(attrsEmpty)).toEqual([]);
    expect(Object.getPrototypeOf(attrsNull)).toBe(null);
    expect(Object.getPrototypeOf(attrsEmpty)).toBe(null);
  });

  it("skips forbidden keys and keeps safe attributes", () => {
    const attrs = parseTagAttributes('<div __proto__="x" constructor="y" ok="1">');

    expect(Object.prototype.hasOwnProperty.call(attrs, "__proto__")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(attrs, "constructor")).toBe(false);
    expect(attrs.ok).toBe("1");
    expect(({}).polluted).toBeUndefined();
  });

  it("parses unquoted and boolean attributes", () => {
    const attrs = parseTagAttributes("<div data-id=123 disabled data-name=alpha>");

    expect(attrs["data-id"]).toBe("123");
    expect(attrs.disabled).toBe("");
    expect(attrs["data-name"]).toBe("alpha");
  });

  it("handles long attribute values", () => {
    const longValue = "a".repeat(1000);
    const attrs = parseTagAttributes(`<div data-long="${longValue}">`);

    expect(attrs["data-long"]).toBe(longValue);
  });
});
