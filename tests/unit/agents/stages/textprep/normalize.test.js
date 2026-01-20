import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { normalizeText } from "../../../../../js/agents/stages/textprep/normalize.js";

vi.mock("node:buffer", async () => {
  const actual = await vi.importActual("node:buffer");
  return {
    Buffer: {
      from: vi.fn((...args) => actual.Buffer.from(...args)),
    },
  };
});

const ORIGINAL_TEXT_ENCODER = globalThis.TextEncoder;
const ORIGINAL_BUFFER = globalThis.Buffer;

beforeEach(() => {
  globalThis.TextEncoder = ORIGINAL_TEXT_ENCODER;
  globalThis.Buffer = ORIGINAL_BUFFER;
  vi.clearAllMocks();
});

afterEach(() => {
  globalThis.TextEncoder = ORIGINAL_TEXT_ENCODER;
  globalThis.Buffer = ORIGINAL_BUFFER;
});

describe("normalizeText", () => {
  it("normalizes CRLF/CR and NBSP with counts and ops", () => {
    const input = "A\r\nB\rC\u00A0D\r\nE\rF";
    const out = normalizeText(input);

    expect(out.normalized).toBe("A\nB\nC D\nE\nF");
    expect(out.normalization.profile).toBe("v0");
    expect(out.normalization.ops).toEqual(["newline_to_lf", "nbsp_to_space"]);
    expect(out.normalization.counts).toEqual({ crlf: 2, cr: 2, nbsp: 1 });
    expect(out.textHash.startsWith("sha256:")).toBe(true);
    expect(out.textHash).toHaveLength(71);
  });

  it("returns stable hashes for empty string and known vectors", () => {
    const empty = normalizeText("");
    expect(empty.normalized).toBe("");
    expect(empty.normalization.ops).toEqual([]);
    expect(empty.normalization.counts).toEqual({});
    expect(empty.textHash).toBe("sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");

    const abc = normalizeText("abc");
    expect(abc.textHash).toBe("sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("keeps whitespace-only strings unchanged", () => {
    const out = normalizeText(" \t\n");
    expect(out.normalized).toBe(" \t\n");
    expect(out.normalization.ops).toEqual([]);
    expect(out.normalization.counts).toEqual({});
  });

  it("accepts numeric strings and String objects", () => {
    const numeric = normalizeText("123");
    expect(numeric.normalized).toBe("123");

    const wrapped = normalizeText(new String("456"));
    expect(wrapped.normalized).toBe("456");
  });

  it("throws TypeError for non-string inputs", () => {
    const cases = [null, undefined, [], {}, 0, -1, Number.MAX_SAFE_INTEGER, { length: 1, 0: "x" }];
    for (const value of cases) {
      expect(() => normalizeText(value)).toThrow(TypeError);
      expect(() => normalizeText(value)).toThrow(/rawText must be a string/);
    }
  });

  it("falls back to Buffer when TextEncoder is unavailable", async () => {
    const baseline = normalizeText("buffer path");
    const { Buffer: MockBuffer } = await import("node:buffer");

    globalThis.TextEncoder = undefined;
    globalThis.Buffer = MockBuffer;

    const result = normalizeText("buffer path");
    expect(MockBuffer.from).toHaveBeenCalledTimes(1);
    expect(MockBuffer.from).toHaveBeenCalledWith("buffer path", "utf8");
    expect(result.textHash).toBe(baseline.textHash);
  });

  it("falls back to manual UTF-8 when TextEncoder and Buffer are unavailable", () => {
    const raw = "A\uD83D\uDE00B\uD800C";
    const baseline = normalizeText(raw);

    globalThis.TextEncoder = undefined;
    globalThis.Buffer = undefined;

    const manual = normalizeText(raw);
    expect(manual.normalized).toBe(raw);
    expect(manual.textHash).toBe(baseline.textHash);
  });

  it("handles concurrent calls", async () => {
    const inputs = ["A\r", "B\r\n", "C\u00A0D", "E"];
    const results = await Promise.all(inputs.map((text) => Promise.resolve().then(() => normalizeText(text))));

    expect(results.map((r) => r.normalized)).toEqual(["A\n", "B\n", "C D", "E"]);
    expect(new Set(results.map((r) => r.textHash)).size).toBe(inputs.length);
  });

  it("handles rapid consecutive calls without shared state", () => {
    const results = Array.from({ length: 25 }, () => normalizeText("X\r\nY\u00A0Z"));
    const first = results[0];

    for (const result of results) {
      expect(result.textHash).toBe(first.textHash);
      expect(result.normalization.counts).toEqual({ crlf: 1, cr: 0, nbsp: 1 });
    }

    first.normalization.ops.push("tamper");
    expect(results[1].normalization.ops).toEqual(["newline_to_lf", "nbsp_to_space"]);
  });

  it("handles large file-sized inputs", () => {
    const lines = 50000;
    const raw = "line\r\n".repeat(lines);
    const result = normalizeText(raw);

    expect(result.normalization.ops).toEqual(["newline_to_lf"]);
    expect(result.normalization.counts).toEqual({ crlf: lines, cr: 0 });
    expect(result.normalized.includes("\r")).toBe(false);
    expect(result.normalized.length).toBe(raw.length - lines);
  });

  it("handles very long strings with many NBSPs", () => {
    const repeats = 80000;
    const raw = "a\u00A0".repeat(repeats);
    const result = normalizeText(raw);

    expect(result.normalization.ops).toEqual(["nbsp_to_space"]);
    expect(result.normalization.counts).toEqual({ nbsp: repeats });
    expect(result.normalized.includes("\u00A0")).toBe(false);
    expect(result.normalized.length).toBe(raw.length);
  });

  it("throws for deeply nested non-string input", () => {
    const deep = { a: { b: { c: { d: { e: { f: [] } } } } } };
    expect(() => normalizeText(deep)).toThrow(TypeError);
  });
});
