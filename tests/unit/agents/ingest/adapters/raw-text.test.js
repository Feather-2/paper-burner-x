import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../js/agents/ingest/adapters/base.js", () => {
  class BaseAdapter {
    constructor(options = {}) {
      this.options = options;
      this.buildParsedDocument = vi.fn((payload) => payload);
    }
  }
  return { BaseAdapter };
});

vi.mock("../../../../../js/agents/shared/index.js", async () => {
  const actual = await vi.importActual("../../../../../js/agents/shared/index.js");
  return {
    ...actual,
    toNonEmptyString: vi.fn(actual.toNonEmptyString),
  };
});

import { RawTextAdapter } from "../../../../../js/agents/ingest/adapters/raw-text.js";
import { SourceKind } from "../../../../../js/agents/ingest/constants.js";
import { toNonEmptyString } from "../../../../../js/agents/shared/index.js";

const missingTextError = "RawTextAdapter.parse(input): input.text is required";

const getCallPayload = (adapter) => adapter.buildParsedDocument.mock.calls[0][0];

describe("RawTextAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes adapterName and options to BaseAdapter", () => {
    const adapter = new RawTextAdapter({ foo: "bar" });
    expect(adapter.options).toEqual({ foo: "bar", adapterName: "raw_text" });
  });

  it("parses string input with default title", async () => {
    const adapter = new RawTextAdapter();
    const sentinel = { ok: true };
    adapter.buildParsedDocument.mockReturnValueOnce(sentinel);

    const result = await adapter.parse("Hello world");

    expect(result).toBe(sentinel);
    expect(adapter.buildParsedDocument).toHaveBeenCalledTimes(1);

    const payload = getCallPayload(adapter);
    expect(payload).toMatchObject({
      sourceType: SourceKind.USER_TEXT,
      origin: { title: "User Input" },
      markdown: "Hello world",
      assets: [],
      metadata: { title: "User Input" },
    });
    expect(payload.parseInfo).toMatchObject({ adapter: "raw_text", durationMs: expect.any(Number) });
    expect(payload.parseInfo.durationMs).toBeGreaterThanOrEqual(0);

    expect(toNonEmptyString).toHaveBeenCalledWith(undefined);
  });

  it("uses trimmed title when provided", async () => {
    const adapter = new RawTextAdapter();
    await adapter.parse({ text: "Hi", title: "  My Title  " });

    expect(toNonEmptyString).toHaveBeenCalledWith("  My Title  ");

    const payload = getCallPayload(adapter);
    expect(payload.origin.title).toBe("My Title");
    expect(payload.metadata.title).toBe("My Title");
  });

  it("falls back to default title when title is blank", async () => {
    const adapter = new RawTextAdapter();
    await adapter.parse({ text: "Hi", title: "   " });

    const payload = getCallPayload(adapter);
    expect(payload.origin.title).toBe("User Input");
    expect(payload.metadata.title).toBe("User Input");
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["empty string", ""],
    ["whitespace string", "  \n\t  "],
    ["empty array", []],
    ["empty object", {}],
    ["object with empty text", { text: "" }],
    ["object with whitespace text", { text: "  \n" }],
    ["object with null text", { text: null }],
    ["object with undefined text", { text: undefined }],
    ["object with zero text", { text: 0 }],
  ])("throws on missing or blank text: %s", async (_label, input) => {
    const adapter = new RawTextAdapter();
    await expect(adapter.parse(input)).rejects.toThrow(missingTextError);
  });

  it.each([
    ["negative number", { text: -1 }, "-1"],
    ["max safe integer", { text: Number.MAX_SAFE_INTEGER }, String(Number.MAX_SAFE_INTEGER)],
    ["array text", { text: ["a", "b"] }, "a,b"],
    ["numeric string", "123", "123"],
  ])("coerces text input for %s", async (_label, input, expected) => {
    const adapter = new RawTextAdapter();
    const result = await adapter.parse(input);

    expect(result.markdown).toBe(expected);
  });

  it("handles concurrent parse calls", async () => {
    const adapter = new RawTextAdapter();

    const [first, second] = await Promise.all([
      adapter.parse("alpha"),
      adapter.parse("beta"),
    ]);

    expect([first.markdown, second.markdown].sort()).toEqual(["alpha", "beta"]);
    expect(adapter.buildParsedDocument).toHaveBeenCalledTimes(2);

    const seen = adapter.buildParsedDocument.mock.calls.map((call) => call[0].markdown).sort();
    expect(seen).toEqual(["alpha", "beta"]);
  });

  it("handles rapid successive calls", async () => {
    const adapter = new RawTextAdapter();
    const inputs = ["one", "two", "three"];

    for (const input of inputs) {
      await adapter.parse(input);
    }

    const seen = adapter.buildParsedDocument.mock.calls.map((call) => call[0].markdown);
    expect(seen).toEqual(inputs);
  });

  it("handles large text input", async () => {
    const adapter = new RawTextAdapter();
    const largeText = "x".repeat(1000000);

    const result = await adapter.parse({ text: largeText, title: "Large" });
    expect(result.markdown).toBe(largeText);
  });

  it("accepts deeply nested title values", async () => {
    const adapter = new RawTextAdapter();
    const deepTitle = { a: { b: { c: { d: "e" } } } };

    await adapter.parse({ text: "deep", title: deepTitle });

    expect(toNonEmptyString).toHaveBeenCalledWith(deepTitle);

    const payload = getCallPayload(adapter);
    expect(payload.origin.title).toBe("[object Object]");
  });
});
