import { describe, it, expect, vi, beforeEach } from "vitest";

const { loggerWarn, escapeTemplateDelimitersMock, defaultFormatters } = vi.hoisted(() => {
  const loggerWarn = vi.fn();
  const escapeTemplateDelimitersMock = vi.fn((value) => `<<${String(value ?? "")}>>`);
  const defaultFormatters = {
    upper: (value) => String(value ?? "").toUpperCase(),
    json: (value) => JSON.stringify(value),
    bullets: (value) =>
      Array.isArray(value) ? value.map((item) => `- ${item}`).join("\n") : `- ${value}`,
    wrap: (value, { args } = {}) => {
      const [prefix = "", suffix = ""] = Array.isArray(args) ? args : [];
      return `${prefix}${value ?? ""}${suffix}`;
    },
  };

  return { loggerWarn, escapeTemplateDelimitersMock, defaultFormatters };
});

vi.mock("../../../../js/agents/shared/index.js", () => ({
  createLogger: vi.fn(() => ({
    log: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: loggerWarn,
    error: vi.fn(),
  })),
}));

vi.mock("../../../../js/agents/prompts/formatters/index.js", () => ({
  DEFAULT_FORMATTERS: defaultFormatters,
  escapeTemplateDelimiters: escapeTemplateDelimitersMock,
}));

import { renderPromptTemplate, PromptTemplate } from "../../../../js/agents/prompts/prompt-template.js";

beforeEach(() => {
  loggerWarn.mockClear();
  escapeTemplateDelimitersMock.mockClear();
});

describe("renderPromptTemplate", () => {
  it("replaces placeholders case-insensitively and trims keys", () => {
    const out = renderPromptTemplate("Hello {{ Name }}!", {
      vars: { "  NAME  ": "Alice" },
      keepUnresolved: false,
      escapeVars: false,
    });
    expect(out).toBe("Hello Alice!");
  });

  it("stringifies non-string templates and handles null templates", () => {
    expect(renderPromptTemplate(123, { vars: {}, keepUnresolved: false })).toBe("123");
    expect(renderPromptTemplate(null, { vars: {}, keepUnresolved: false })).toBe("");
  });

  it("supports Map vars", () => {
    const vars = new Map([["Foo", "bar"]]);
    const out = renderPromptTemplate("{{foo}}", { vars, keepUnresolved: false, escapeVars: false });
    expect(out).toBe("bar");
  });

  it("supports dotted keys and stops flattening beyond the max depth", () => {
    const vars = { a: { b: { c: { d: { e: 1 } } } } };
    const out = renderPromptTemplate("d={{a.b.c.d}} e={{a.b.c.d.e}}", {
      vars,
      keepUnresolved: false,
      escapeVars: false,
    });
    expect(out).toContain('"e": 1');
    expect(out).toContain("e=");
    expect(out).not.toContain("e=1");
  });

  it("ignores array vars as a non-keyed container", () => {
    const out = renderPromptTemplate("{{missing}}", { vars: ["x"], keepUnresolved: true });
    expect(out).toBe("{{missing}}");
  });

  it("formats primitive boundaries and empty containers by default", () => {
    const vars = {
      n: null,
      u: undefined,
      empty: "",
      zero: 0,
      neg: -1,
      max: Number.MAX_SAFE_INTEGER,
      space: "  ",
      emptyArr: [],
      emptyObj: {},
      big: 1n,
    };

    const out = renderPromptTemplate(
      "n={{n}} u={{u}} empty='{{empty}}' zero={{zero}} neg={{neg}} max={{max}} space='{{space}}' emptyArr={{emptyArr}} emptyObj={{emptyObj}} big={{big}}",
      { vars, keepUnresolved: false, escapeVars: false }
    );

    expect(out).toBe(
      `n= u= empty='' zero=0 neg=-1 max=${Number.MAX_SAFE_INTEGER} space='  ' emptyArr= emptyObj={} big=1`
    );
  });

  it("joins arrays and falls back when JSON serialization fails", () => {
    const out = renderPromptTemplate("arr={{arr}} obj={{obj}}", {
      vars: { arr: [0, null, "x"], obj: { big: 1n } },
      keepUnresolved: false,
      escapeVars: false,
    });
    expect(out).toBe("arr=0\n\nx obj=[object Object]");
  });

  it("formats unsupported types as empty strings", () => {
    const out = renderPromptTemplate("fn={{fn}} sym={{sym}}", {
      vars: { fn: () => "x", sym: Symbol("s") },
      keepUnresolved: false,
      escapeVars: false,
    });
    expect(out).toBe("fn= sym=");
  });

  it("keeps unresolved placeholders by default and can drop them", () => {
    expect(renderPromptTemplate("x {{missing}} y", { vars: {} })).toBe("x {{missing}} y");
    expect(renderPromptTemplate("x {{missing}} y", { vars: {}, keepUnresolved: false })).toBe("x  y");
  });

  it("treats empty placeholder names as unresolved", () => {
    const out = renderPromptTemplate("x {{   }} y", { vars: { a: 1 }, keepUnresolved: false });
    expect(out).toBe("x  y");
  });

  it("applies formatter pipelines and parses args", () => {
    const out = renderPromptTemplate("{{name|wrap( << , >> )|upper}}", {
      vars: { name: "ai" },
      keepUnresolved: false,
      escapeVars: false,
    });
    expect(out).toBe("<<AI>>");
  });

  it("merges custom formatters and allows overrides", () => {
    const out = renderPromptTemplate("{{name|upper|wrap(<, >)}}", {
      vars: { name: "alice" },
      formatters: {
        upper: (value) => `custom:${value}`,
      },
      keepUnresolved: false,
      escapeVars: false,
    });
    expect(out).toBe("<custom:alice>");
  });

  it("passes raw values to custom formatters without coercion", () => {
    const out = renderPromptTemplate("num={{num|type}} obj={{obj|type}} arr={{arr|type}}", {
      vars: { num: "42", obj: { a: 1 }, arr: [1, 2] },
      formatters: {
        type: (value) => (Array.isArray(value) ? "array" : typeof value),
      },
      keepUnresolved: false,
      escapeVars: false,
    });
    expect(out).toBe("num=string obj=object arr=array");
  });

  it("treats unknown or malformed formatters as unresolved", () => {
    const onUnresolved = vi.fn();
    const out = renderPromptTemplate("{{x|missing}} {{y|wrap(}}", {
      vars: { x: "a", y: "b" },
      keepUnresolved: true,
      onUnresolved,
    });

    expect(out).toBe("{{x|missing}} {{y|wrap(}}");
    expect(onUnresolved).toHaveBeenCalledWith(["x|missing", "y|wrap("]);
  });

  it("escapes template delimiters by default", () => {
    const out = renderPromptTemplate("{{x}}", { vars: { x: "Hello {{danger}}" }, keepUnresolved: false });
    expect(escapeTemplateDelimitersMock).toHaveBeenCalledWith("Hello {{danger}}");
    expect(out).toBe("<<Hello {{danger}}>>");
  });

  it("can disable escaping with escapeVars=false", () => {
    const out = renderPromptTemplate("{{x}}", {
      vars: { x: "Hello {{danger}}" },
      keepUnresolved: false,
      escapeVars: false,
    });
    expect(escapeTemplateDelimitersMock).not.toHaveBeenCalled();
    expect(out).toBe("Hello {{danger}}");
  });

  it("reports unresolved placeholders via logger with truncation", () => {
    const template = Array.from({ length: 25 }, (_, i) => `{{v${i}}}`).join(" ");
    renderPromptTemplate(template, { vars: {}, warnOnUnresolved: true, keepUnresolved: false });

    expect(loggerWarn).toHaveBeenCalledTimes(1);
    const msg = String(loggerWarn.mock.calls[0][0] ?? "");
    expect(msg).toContain("Unresolved placeholders");
    expect(msg).toContain("v0");
    expect(msg).toContain("v19");
    expect(msg).toContain(", ...");
  });

  it("calls onUnresolved and suppresses warnings", () => {
    const onUnresolved = vi.fn();
    renderPromptTemplate("{{A}} {{B}}", {
      vars: {},
      keepUnresolved: false,
      warnOnUnresolved: true,
      onUnresolved,
    });

    expect(onUnresolved).toHaveBeenCalledWith(["a", "b"]);
    expect(loggerWarn).not.toHaveBeenCalled();
  });

  it("swallows errors from onUnresolved callbacks", () => {
    const out = renderPromptTemplate("x {{missing}} y", {
      vars: {},
      keepUnresolved: false,
      onUnresolved: () => {
        throw new Error("boom");
      },
    });

    expect(out).toBe("x  y");
  });

  it("throws when failOnUnresolved is enabled and includes ellipsis", () => {
    const template = Array.from({ length: 25 }, (_, i) => `{{v${i}}}`).join(" ");
    expect(() =>
      renderPromptTemplate(template, { vars: {}, failOnUnresolved: true, keepUnresolved: true })
    ).toThrow(/, \.\.\./);
  });

  it("appends missing content with trimming and non-string values", () => {
    const out = renderPromptTemplate("Hi", {
      vars: {},
      appendIfMissing: { " extra ": "  content  ", note: 0 },
    });
    expect(out).toBe("Hi\n\ncontent\n\n0");
  });

  it("does not append when the placeholder exists (case-insensitive, regex chars)", () => {
    const out = renderPromptTemplate("Hi {{A+B}}", {
      vars: { "a+b": "value" },
      appendIfMissing: { "a+b": "Extra" },
      keepUnresolved: false,
      escapeVars: false,
    });
    expect(out).toBe("Hi value");
  });

  it("ignores invalid appendIfMissing inputs", () => {
    const out = renderPromptTemplate("Hi", {
      vars: {},
      appendIfMissing: { "": "x", name: "   " },
    });
    expect(out).toBe("Hi");

    const outNonObject = renderPromptTemplate("Hi", { vars: {}, appendIfMissing: "nope" });
    expect(outNonObject).toBe("Hi");
  });

  it("renders consistently under concurrent calls", async () => {
    const results = await Promise.all([
      Promise.resolve(renderPromptTemplate("{{A}}", { vars: { a: "one" }, keepUnresolved: false, escapeVars: false })),
      Promise.resolve(renderPromptTemplate("{{B}}", { vars: { b: "two" }, keepUnresolved: false, escapeVars: false })),
      Promise.resolve(renderPromptTemplate("x {{missing}} y", { vars: {}, keepUnresolved: false, escapeVars: false })),
    ]);

    expect(results).toEqual(["one", "two", "x  y"]);
  });

  it("handles rapid successive calls", () => {
    const outputs = [];
    for (let i = 0; i < 50; i += 1) {
      outputs.push(renderPromptTemplate("{{v}}", { vars: { v: i }, keepUnresolved: false, escapeVars: false }));
    }

    expect(outputs[0]).toBe("0");
    expect(outputs[49]).toBe("49");
  });

  it("handles very long templates", () => {
    const chunk = "x".repeat(10000);
    const out = renderPromptTemplate(`${chunk}{{v}}${chunk}`, {
      vars: { v: "y" },
      keepUnresolved: false,
      escapeVars: false,
    });

    expect(out.startsWith(chunk)).toBe(true);
    expect(out.endsWith(chunk)).toBe(true);
    expect(out.length).toBe(chunk.length * 2 + 1);
  });
});

describe("PromptTemplate", () => {
  it("stringifies template input", () => {
    const tpl = new PromptTemplate(123);
    expect(tpl.render({ vars: {} })).toBe("123");
  });

  it("renders using provided options", () => {
    const tpl = new PromptTemplate("Hello {{NAME|upper}}");
    const out = tpl.render({ vars: { name: "alice" }, keepUnresolved: false, escapeVars: false });
    expect(out).toBe("Hello ALICE");
  });
});
