/**
 * Unit tests for js/agents/prompts/formatters/index.js.
 * Covers re-exports plus DEFAULT_FORMATTERS wrapper behavior.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock(
  "../../../../../js/agents/prompts/formatters/escape-template-delimiters.js",
  () => ({
    escapeTemplateDelimiters: vi.fn((value) => ({ tag: "escape", value })),
  }),
);

vi.mock(
  "../../../../../js/agents/prompts/formatters/format-bullets.js",
  () => ({
    formatBullets: vi.fn((value, options) => ({
      tag: "bullets",
      value,
      options,
    })),
  }),
);

vi.mock(
  "../../../../../js/agents/prompts/formatters/format-code-block.js",
  () => ({
    formatCodeBlock: vi.fn((value, options) => ({
      tag: "code",
      value,
      options,
    })),
  }),
);

vi.mock("../../../../../js/agents/prompts/formatters/format-json.js", () => ({
  formatJson: vi.fn((value, options) => ({ tag: "json", value, options })),
}));

vi.mock("../../../../../js/agents/prompts/formatters/format-lines.js", () => ({
  formatLines: vi.fn((value) => ({ tag: "lines", value })),
}));

vi.mock("../../../../../js/agents/prompts/formatters/format-trim.js", () => ({
  formatTrim: vi.fn((value) => ({ tag: "trim", value })),
}));

vi.mock("../../../../../js/agents/prompts/formatters/format-upper.js", () => ({
  formatUpper: vi.fn((value) => ({ tag: "upper", value })),
}));

import { escapeTemplateDelimiters as escapeTemplateDelimitersMock } from "../../../../../js/agents/prompts/formatters/escape-template-delimiters.js";
import { formatBullets as formatBulletsMock } from "../../../../../js/agents/prompts/formatters/format-bullets.js";
import { formatCodeBlock as formatCodeBlockMock } from "../../../../../js/agents/prompts/formatters/format-code-block.js";
import { formatJson as formatJsonMock } from "../../../../../js/agents/prompts/formatters/format-json.js";
import { formatLines as formatLinesMock } from "../../../../../js/agents/prompts/formatters/format-lines.js";
import { formatTrim as formatTrimMock } from "../../../../../js/agents/prompts/formatters/format-trim.js";
import { formatUpper as formatUpperMock } from "../../../../../js/agents/prompts/formatters/format-upper.js";

import {
  DEFAULT_FORMATTERS,
  escapeTemplateDelimiters,
  formatBullets,
  formatCodeBlock,
  formatJson,
  formatLines,
  formatTrim,
  formatUpper,
} from "../../../../../js/agents/prompts/formatters/index.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("escapeTemplateDelimiters", () => {
  it("re-exports and forwards normal input", () => {
    expect(escapeTemplateDelimiters).toBe(escapeTemplateDelimitersMock);

    const result = escapeTemplateDelimiters("{{value}}");
    expect(result).toEqual({ tag: "escape", value: "{{value}}" });
    expect(escapeTemplateDelimitersMock).toHaveBeenCalledWith("{{value}}");
  });

  it("forwards null boundary values", () => {
    const result = escapeTemplateDelimiters(null);
    expect(result).toEqual({ tag: "escape", value: null });
    expect(escapeTemplateDelimitersMock).toHaveBeenCalledWith(null);
  });

  it("propagates errors from underlying formatter", () => {
    escapeTemplateDelimitersMock.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    expect(() => escapeTemplateDelimiters("bad")).toThrow("boom");
  });
});

describe("formatBullets", () => {
  it("re-exports and forwards normal input", () => {
    expect(formatBullets).toBe(formatBulletsMock);

    const options = { indent: "  ", bullet: "* " };
    const result = formatBullets(["a", "b"], options);
    expect(result).toEqual({ tag: "bullets", value: ["a", "b"], options });
    expect(formatBulletsMock).toHaveBeenCalledWith(["a", "b"], options);
  });

  it("forwards boundary values like empty arrays, -1, and objects", () => {
    const objectAsArray = { items: ["x"] };

    formatBullets([]);
    formatBullets(-1);
    formatBullets(objectAsArray);

    expect(formatBulletsMock).toHaveBeenCalledWith([]);
    expect(formatBulletsMock).toHaveBeenCalledWith(-1);
    expect(formatBulletsMock).toHaveBeenCalledWith(objectAsArray);
  });

  it("propagates errors from underlying formatter", () => {
    formatBulletsMock.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    expect(() => formatBullets(["bad"])).toThrow("boom");
  });
});

describe("formatCodeBlock", () => {
  it("re-exports and forwards normal input", () => {
    expect(formatCodeBlock).toBe(formatCodeBlockMock);

    const options = { lang: "js" };
    const result = formatCodeBlock("const a = 1;", options);
    expect(result).toEqual({ tag: "code", value: "const a = 1;", options });
    expect(formatCodeBlockMock).toHaveBeenCalledWith("const a = 1;", options);
  });

  it("forwards boundary values like 0", () => {
    const options = { lang: "" };
    const result = formatCodeBlock(0, options);
    expect(result).toEqual({ tag: "code", value: 0, options });
    expect(formatCodeBlockMock).toHaveBeenCalledWith(0, options);
  });

  it("propagates errors from underlying formatter", () => {
    formatCodeBlockMock.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    expect(() => formatCodeBlock("bad")).toThrow("boom");
  });
});

describe("formatJson", () => {
  it("re-exports and forwards normal input", () => {
    expect(formatJson).toBe(formatJsonMock);

    const value = { a: 1 };
    const options = { space: 4 };
    const result = formatJson(value, options);
    expect(result).toEqual({ tag: "json", value, options });
    expect(formatJsonMock).toHaveBeenCalledWith(value, options);
  });

  it("forwards boundary values like empty objects", () => {
    const value = {};
    const result = formatJson(value);
    expect(result).toEqual({ tag: "json", value, options: undefined });
    expect(formatJsonMock).toHaveBeenCalledWith(value);
  });

  it("propagates errors from underlying formatter", () => {
    formatJsonMock.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    expect(() => formatJson({ bad: true })).toThrow("boom");
  });
});

describe("formatLines", () => {
  it("re-exports and forwards normal input", () => {
    expect(formatLines).toBe(formatLinesMock);

    const value = "a\nb";
    const result = formatLines(value);
    expect(result).toEqual({ tag: "lines", value });
    expect(formatLinesMock).toHaveBeenCalledWith(value);
  });

  it("forwards undefined boundary values", () => {
    const result = formatLines(undefined);
    expect(result).toEqual({ tag: "lines", value: undefined });
    expect(formatLinesMock).toHaveBeenCalledWith(undefined);
  });

  it("propagates errors from underlying formatter", () => {
    formatLinesMock.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    expect(() => formatLines("bad")).toThrow("boom");
  });
});

describe("formatTrim", () => {
  it("re-exports and forwards normal input", () => {
    expect(formatTrim).toBe(formatTrimMock);

    const value = "  value  ";
    const result = formatTrim(value);
    expect(result).toEqual({ tag: "trim", value });
    expect(formatTrimMock).toHaveBeenCalledWith(value);
  });

  it("forwards boundary values like whitespace-only strings", () => {
    const value = "   \t";
    const result = formatTrim(value);
    expect(result).toEqual({ tag: "trim", value });
    expect(formatTrimMock).toHaveBeenCalledWith(value);
  });

  it("propagates errors from underlying formatter", () => {
    formatTrimMock.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    expect(() => formatTrim("bad")).toThrow("boom");
  });
});

describe("formatUpper", () => {
  it("re-exports and forwards normal input", () => {
    expect(formatUpper).toBe(formatUpperMock);

    const value = "hello";
    const result = formatUpper(value);
    expect(result).toEqual({ tag: "upper", value });
    expect(formatUpperMock).toHaveBeenCalledWith(value);
  });

  it("forwards boundary values like empty strings and MAX_SAFE_INTEGER", () => {
    const maxValue = Number.MAX_SAFE_INTEGER;

    const emptyResult = formatUpper("");
    const maxResult = formatUpper(maxValue);

    expect(emptyResult).toEqual({ tag: "upper", value: "" });
    expect(maxResult).toEqual({ tag: "upper", value: maxValue });
    expect(formatUpperMock).toHaveBeenCalledWith("");
    expect(formatUpperMock).toHaveBeenCalledWith(maxValue);
  });

  it("propagates errors from underlying formatter", () => {
    formatUpperMock.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    expect(() => formatUpper("bad")).toThrow("boom");
  });
});

describe("DEFAULT_FORMATTERS", () => {
  it("formats bullets with default options regardless of ctx args", () => {
    const resultDefault = DEFAULT_FORMATTERS.bullets(["a"]);
    const resultWithArgs = DEFAULT_FORMATTERS.bullets(["b"], {
      args: ["ignored"],
    });

    expect(resultDefault).toEqual({
      tag: "bullets",
      value: ["a"],
      options: { indent: "", bullet: "- " },
    });
    expect(resultWithArgs).toEqual({
      tag: "bullets",
      value: ["b"],
      options: { indent: "", bullet: "- " },
    });
    expect(formatBulletsMock).toHaveBeenNthCalledWith(1, ["a"], {
      indent: "",
      bullet: "- ",
    });
    expect(formatBulletsMock).toHaveBeenNthCalledWith(2, ["b"], {
      indent: "",
      bullet: "- ",
    });
  });

  it("formats code with optional language arguments", () => {
    const noLang = DEFAULT_FORMATTERS.code("const x = 1;");
    const withLang = DEFAULT_FORMATTERS.code("print()", { args: ["py"] });

    expect(noLang).toEqual({
      tag: "code",
      value: "const x = 1;",
      options: { lang: "" },
    });
    expect(withLang).toEqual({
      tag: "code",
      value: "print()",
      options: { lang: "py" },
    });
    expect(formatCodeBlockMock).toHaveBeenCalledWith("const x = 1;", {
      lang: "",
    });
    expect(formatCodeBlockMock).toHaveBeenCalledWith("print()", {
      lang: "py",
    });
  });

  it("formats json with numeric spacing derived from string args", () => {
    const valueWithArg = { a: 1 };
    const valueDefault = { b: 2 };

    const withArg = DEFAULT_FORMATTERS.json(valueWithArg, { args: ["4"] });
    const defaultSpace = DEFAULT_FORMATTERS.json(valueDefault);

    expect(withArg).toEqual({
      tag: "json",
      value: valueWithArg,
      options: { space: 4 },
    });
    expect(defaultSpace).toEqual({
      tag: "json",
      value: valueDefault,
      options: { space: 2 },
    });
    expect(formatJsonMock).toHaveBeenCalledWith(valueWithArg, { space: 4 });
    expect(formatJsonMock).toHaveBeenCalledWith(valueDefault, { space: 2 });
  });

  it("passes through lines/trim/upper values including nullish and whitespace", () => {
    const whitespace = "   ";

    const linesResult = DEFAULT_FORMATTERS.lines(null);
    const trimResult = DEFAULT_FORMATTERS.trim(undefined);
    const upperResult = DEFAULT_FORMATTERS.upper(whitespace);

    expect(linesResult).toEqual({ tag: "lines", value: null });
    expect(trimResult).toEqual({ tag: "trim", value: undefined });
    expect(upperResult).toEqual({ tag: "upper", value: whitespace });
    expect(formatLinesMock).toHaveBeenCalledWith(null);
    expect(formatTrimMock).toHaveBeenCalledWith(undefined);
    expect(formatUpperMock).toHaveBeenCalledWith(whitespace);
  });

  it("propagates errors from underlying formatters", () => {
    formatTrimMock.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    expect(() => DEFAULT_FORMATTERS.trim("bad")).toThrow("boom");
  });

  it("handles concurrent calls without shared state", async () => {
    const values = ["a", "b", 0, -1, null];
    const results = await Promise.all(
      values.map((value) =>
        Promise.resolve().then(() => DEFAULT_FORMATTERS.lines(value)),
      ),
    );

    expect(results).toEqual(
      values.map((value) => ({ tag: "lines", value })),
    );
    expect(formatLinesMock).toHaveBeenCalledTimes(values.length);
  });

  it("handles rapid consecutive calls", () => {
    let last = null;
    for (let i = 0; i < 1000; i += 1) {
      last = DEFAULT_FORMATTERS.upper(`v${i}`);
    }

    expect(last).toEqual({ tag: "upper", value: "v999" });
    expect(formatUpperMock).toHaveBeenCalledTimes(1000);
  });

  it("handles large and deep inputs", () => {
    const hugeContent = "x".repeat(200000);
    const deepObject = { level: 0 };
    let cursor = deepObject;
    for (let i = 1; i < 120; i += 1) {
      cursor.child = { level: i };
      cursor = cursor.child;
    }

    const codeResult = DEFAULT_FORMATTERS.code(hugeContent);
    const jsonResult = DEFAULT_FORMATTERS.json(deepObject);

    expect(codeResult).toEqual({
      tag: "code",
      value: hugeContent,
      options: { lang: "" },
    });
    expect(jsonResult).toEqual({
      tag: "json",
      value: deepObject,
      options: { space: 2 },
    });
    expect(formatCodeBlockMock).toHaveBeenCalledWith(hugeContent, {
      lang: "",
    });
    expect(formatJsonMock).toHaveBeenCalledWith(deepObject, { space: 2 });
  });
});
