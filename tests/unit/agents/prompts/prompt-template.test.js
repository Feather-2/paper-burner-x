import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { PromptTemplate, renderPromptTemplate } from '../../../../js/agents/prompts/prompt-template.js';

describe("agents/prompts/prompt-template.js", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders basic placeholders (case-insensitive)", () => {
    const out = renderPromptTemplate("Hello {{name}}!", { vars: { NAME: "Alice" }, keepUnresolved: false });
    expect(out).toBe("Hello Alice!");
  });

  it("supports non-string templates by stringifying them", () => {
    expect(renderPromptTemplate(123, { vars: {}, keepUnresolved: true })).toBe("123");
  });

  it("supports dotted keys via object flattening", () => {
    const out = renderPromptTemplate("min={{minWords.quick}}", { vars: { minWords: { quick: 123 } }, keepUnresolved: false });
    expect(out).toBe("min=123");
  });

  it("supports Map vars", () => {
    const vars = new Map([["Foo", "bar"]]);
    expect(renderPromptTemplate("{{foo}}", { vars, keepUnresolved: false })).toBe("bar");
  });

  it("handles vars passed as arrays (treated as non-keyed)", () => {
    expect(renderPromptTemplate("{{missing}}", { vars: ["x"], keepUnresolved: true })).toBe("{{missing}}");
  });

  it("keeps unresolved placeholders by default", () => {
    expect(renderPromptTemplate("x {{missing}} y", { vars: {} })).toBe("x {{missing}} y");
  });

  it("can remove unresolved placeholders (keepUnresolved=false)", () => {
    expect(renderPromptTemplate("x {{missing}} y", { vars: {}, keepUnresolved: false })).toBe("x  y");
  });

  it("treats empty placeholder names as unresolved", () => {
    expect(renderPromptTemplate("x {{   }} y", { vars: { a: 1 }, keepUnresolved: false })).toBe("x  y");
  });

  it("warns on unresolved placeholders", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderPromptTemplate("x {{missing}} y", { vars: {}, warnOnUnresolved: true, keepUnresolved: false });
    expect(warn).toHaveBeenCalled();

    const msg = warn.mock.calls.map((c) => String(c[1] ?? "")).join("\n");
    expect(msg).toContain("Unresolved placeholders");
  });

  it("truncates unresolved placeholder lists to 20 items (adds ellipsis)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const template = Array.from({ length: 25 }, (_, i) => `{{v${i}}}`).join(" ");
    renderPromptTemplate(template, { vars: {}, warnOnUnresolved: true, keepUnresolved: false });
    const msg = warn.mock.calls.map((c) => String(c[1] ?? "")).join("\n");
    expect(msg).toContain(", ...");
  });

  it("calls onUnresolved with unresolved placeholder names", () => {
    const onUnresolved = vi.fn();
    renderPromptTemplate("x {{missing}} y", { vars: {}, onUnresolved, keepUnresolved: false });
    expect(onUnresolved).toHaveBeenCalledTimes(1);
    expect(onUnresolved.mock.calls[0][0]).toEqual(["missing"]);
  });

  it("throws when failOnUnresolved is enabled", () => {
    expect(() => renderPromptTemplate("x {{missing}} y", { vars: {}, failOnUnresolved: true, keepUnresolved: false }))
      .toThrow(/Unresolved placeholders/);
  });

  it("includes an ellipsis in the error message when there are many unresolved placeholders", () => {
    const template = Array.from({ length: 25 }, (_, i) => `{{v${i}}}`).join(" ");
    expect(() => renderPromptTemplate(template, { vars: {}, failOnUnresolved: true, keepUnresolved: false }))
      .toThrow(/, \.\.\./);
  });

  it("escapes template delimiters inside values by default", () => {
    const out = renderPromptTemplate("{{x}}", { vars: { x: "Hello {{danger}}" }, keepUnresolved: false });
    expect(out).not.toContain("{{danger}}");
    expect(out).toContain("\u200B");
  });

  it("can disable escaping (escapeVars=false)", () => {
    const out = renderPromptTemplate("{{x}}", { vars: { x: "Hello {{danger}}" }, escapeVars: false, keepUnresolved: false });
    expect(out).toBe("Hello {{danger}}");
  });

  it("supports formatter pipelines", () => {
    const outJson = renderPromptTemplate("{{obj|json}}", { vars: { obj: { a: 1 } }, keepUnresolved: false });
    expect(outJson).toContain('"a": 1');

    const outBullets = renderPromptTemplate("{{items|bullets}}", { vars: { items: ["a", "b"] }, keepUnresolved: false });
    expect(outBullets).toBe("- a\n- b");

    const outCode = renderPromptTemplate("{{snippet|code(js)}}", { vars: { snippet: "x" }, keepUnresolved: false });
    expect(outCode).toBe("```js\nx\n```");
  });

  it("supports default formatting for arrays and objects (without explicit formatters)", () => {
    expect(renderPromptTemplate("{{arr}}", { vars: { arr: [1, 2] }, keepUnresolved: false })).toBe("1\n2");
    expect(renderPromptTemplate("{{obj}}", { vars: { obj: { a: 1 } }, keepUnresolved: false })).toContain('"a": 1');
  });

  it("stops flattening beyond the max depth but still keeps the nested object at its key", () => {
    const vars = { a: { b: { c: { d: { e: 1 } } } } };
    const out = renderPromptTemplate("d={{a.b.c.d}} e={{a.b.c.d.e}}", { vars, keepUnresolved: false });
    expect(out).toContain('"e": 1');
    expect(out).toContain("e=");
    expect(out).not.toContain("e=1");
  });

  it("falls back to String(value) when JSON formatting fails", () => {
    const out = renderPromptTemplate("{{obj}}", { vars: { obj: { big: 1n } }, keepUnresolved: false });
    expect(out).toBe("[object Object]");
  });

  it("formats unsupported values as empty strings", () => {
    const out = renderPromptTemplate("{{fn}}", { vars: { fn: () => "x" }, keepUnresolved: false });
    expect(out).toBe("");
  });

  it("treats unknown formatters as unresolved", () => {
    const onUnresolved = vi.fn();
    const out = renderPromptTemplate("{{x|nope}}", {
      vars: { x: "a" },
      keepUnresolved: true,
      onUnresolved,
    });
    expect(out).toBe("{{x|nope}}");
    expect(onUnresolved).toHaveBeenCalledWith(["x|nope"]);
  });

  it("treats malformed formatter specs as unresolved", () => {
    const onUnresolved = vi.fn();
    const out = renderPromptTemplate("{{x|code(js}}", { vars: { x: "a" }, keepUnresolved: true, onUnresolved });
    expect(out).toBe("{{x|code(js}}");
    expect(onUnresolved).toHaveBeenCalledWith(["x|code(js"]);
  });

  it("swallows errors thrown by onUnresolved callbacks", () => {
    expect(() =>
      renderPromptTemplate("{{missing}}", { vars: {}, keepUnresolved: false, onUnresolved: () => { throw new Error("boom"); } })
    ).not.toThrow();
  });

  it("appends content when appendIfMissing placeholders are not present", () => {
    const out = renderPromptTemplate("Hi", { vars: {}, appendIfMissing: { NAME: "Extra" } });
    expect(out).toBe("Hi\n\nExtra");
  });

  it("does not append when the placeholder exists in the template", () => {
    const out = renderPromptTemplate("Hi {{NAME}}", { vars: { name: "Alice" }, keepUnresolved: false, appendIfMissing: { NAME: "Extra" } });
    expect(out).toBe("Hi Alice");
  });

  it("ignores invalid appendIfMissing entries", () => {
    const out = renderPromptTemplate("Hi", { vars: {}, appendIfMissing: { "": "x", NAME: "   " } });
    expect(out).toBe("Hi");
  });

  it("ignores non-object appendIfMissing inputs", () => {
    const out = renderPromptTemplate("Hi", { vars: {}, appendIfMissing: "nope" });
    expect(out).toBe("Hi");
  });

  it("PromptTemplate.render delegates to renderPromptTemplate", () => {
    const tpl = new PromptTemplate("Hello {{name|upper}}");
    expect(tpl.render({ vars: { name: "alice" }, keepUnresolved: false })).toBe("Hello ALICE");
  });

  it("PromptTemplate accepts non-string templates", () => {
    const tpl = new PromptTemplate(123);
    expect(tpl.render({ vars: {} })).toBe("123");
  });
});
