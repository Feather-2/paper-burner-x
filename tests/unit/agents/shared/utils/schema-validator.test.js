import { describe, it, expect, vi, beforeEach } from "vitest";

const { isPlainObject, toNonEmptyString } = vi.hoisted(() => ({
  isPlainObject: vi.fn(),
  toNonEmptyString: vi.fn(),
}));

vi.mock("../../../../../js/agents/shared/utils/value-utils.js", () => ({
  isPlainObject,
  toNonEmptyString,
}));

import {
  validateChunk,
  validateChunks,
  validateGlobResult,
  validateGrepMatch,
} from "../../../../../js/agents/shared/utils/schema-validator.js";

const defaultIsPlainObject = (v) => {
  if (v === null || typeof v !== "object") return false;
  if (Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

const defaultToNonEmptyString = (v) => {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
};

beforeEach(() => {
  vi.clearAllMocks();
  isPlainObject.mockImplementation(defaultIsPlainObject);
  toNonEmptyString.mockImplementation(defaultToNonEmptyString);
});

describe("validateChunk", () => {
  it("rejects null/undefined and non-plain objects", () => {
    const nullResult = validateChunk(null);
    expect(nullResult.ok).toBe(false);
    expect(nullResult.errors[0]).toContain("chunk: expected object");

    const undefResult = validateChunk(undefined, 1);
    expect(undefResult.ok).toBe(false);
    expect(undefResult.errors[0]).toContain("chunk[1]: expected object");

    const arrayResult = validateChunk([], 2);
    expect(arrayResult.ok).toBe(false);
    expect(arrayResult.errors[0]).toContain("chunk[2]: expected object");
  });

  it("collects errors for empty/whitespace chunkId and non-string text", () => {
    const result = validateChunk({ chunkId: "   ", text: 123 }, 0);
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([
      "chunk[0].chunkId: required non-empty string",
      "chunk[0].text: required string, got number",
    ]);
  });

  it("coerces chunkId, preserves fields, and supports long text and deep nesting", () => {
    const longText = "x".repeat(100000);
    const nested = { level1: { level2: { level3: { value: "ok" } } } };
    const result = validateChunk({ chunkId: 0, text: longText, meta: nested });

    expect(result.ok).toBe(true);
    expect(result.value.chunkId).toBe("0");
    expect(result.value.text.length).toBe(100000);
    expect(result.value.meta).toBe(nested);
    expect(result.value.meta.level1.level2.level3.value).toBe("ok");
  });

  it("handles concurrent calls without shared state", async () => {
    const [valid, invalid] = await Promise.all([
      Promise.resolve(validateChunk({ chunkId: "a", text: "t" })),
      Promise.resolve(validateChunk({ chunkId: "", text: "t" }, 5)),
    ]);

    expect(valid.ok).toBe(true);
    expect(valid.value).toEqual({ chunkId: "a", text: "t" });
    expect(invalid.ok).toBe(false);
    expect(invalid.errors[0]).toBe("chunk[5].chunkId: required non-empty string");
  });
});

describe("validateChunks", () => {
  it("rejects non-arrays and object-as-array inputs", () => {
    const nullResult = validateChunks(null);
    expect(nullResult.ok).toBe(false);
    expect(nullResult.errors[0]).toBe("chunks: expected array, got object");

    const objResult = validateChunks({});
    expect(objResult.ok).toBe(false);
    expect(objResult.errors[0]).toBe("chunks: expected array, got object");

    const strResult = validateChunks("nope");
    expect(strResult.ok).toBe(false);
    expect(strResult.errors[0]).toBe("chunks: expected array, got string");
  });

  it("handles empty arrays based on allowEmpty", () => {
    const disallow = validateChunks([]);
    expect(disallow.ok).toBe(false);
    expect(disallow.value).toEqual([]);
    expect(disallow.errors).toEqual(["chunks: array is empty"]);

    const allow = validateChunks([], { allowEmpty: true });
    expect(allow).toEqual({ ok: true, value: [], errors: [] });
  });

  it("collects up to maxErrors and adds a summary for many invalid chunks", () => {
    const chunks = [
      { chunkId: "a" },
      { chunkId: "b" },
      { chunkId: "c" },
      { chunkId: "d" },
    ];
    const result = validateChunks(chunks, { maxErrors: 2 });

    expect(result.ok).toBe(false);
    expect(result.value).toEqual([]);
    expect(result.errors).toEqual([
      "chunk[0].text: required string, got undefined",
      "chunk[1].text: required string, got undefined",
      "... and 2 more invalid chunks",
    ]);
  });

  it("returns the validated subset when some chunks are invalid", () => {
    const result = validateChunks([
      { chunkId: "ok-1", text: "a" },
      { chunkId: "", text: "bad" },
      { chunkId: "ok-2", text: "b" },
    ]);

    expect(result.ok).toBe(false);
    expect(result.value).toEqual([
      { chunkId: "ok-1", text: "a" },
      { chunkId: "ok-2", text: "b" },
    ]);
    expect(result.errors.some((e) => e.includes("chunk[1].chunkId"))).toBe(true);
  });

  it("supports rapid consecutive calls with large inputs", () => {
    const largeChunks = Array.from({ length: 1000 }, (_, i) => ({
      chunkId: `id-${i}`,
      text: "t",
    }));

    for (let i = 0; i < 25; i++) {
      const result = validateChunks(largeChunks);
      expect(result.ok).toBe(true);
      expect(result.value).toHaveLength(1000);
    }
  });

  it("handles parallel calls without leaking state", async () => {
    const inputs = [
      [{ chunkId: "a", text: "t" }],
      [{ chunkId: "b" }],
      [{ chunkId: "c", text: "t" }],
    ];
    const results = await Promise.all(
      inputs.map((chunks) => Promise.resolve(validateChunks(chunks)))
    );

    expect(results[0].ok).toBe(true);
    expect(results[1].ok).toBe(false);
    expect(results[2].ok).toBe(true);
  });
});

describe("validateGlobResult", () => {
  it("rejects null/array inputs and empty objects missing files", () => {
    const nullResult = validateGlobResult(null);
    expect(nullResult.ok).toBe(false);
    expect(nullResult.errors).toEqual(["globResult: expected object"]);

    const arrayResult = validateGlobResult([]);
    expect(arrayResult.ok).toBe(false);
    expect(arrayResult.errors).toEqual(["globResult: expected object"]);

    const emptyResult = validateGlobResult({});
    expect(emptyResult.ok).toBe(false);
    expect(emptyResult.errors).toEqual(["globResult.files: expected array"]);
  });

  it("returns errors for invalid files/error types", () => {
    const filesBad = validateGlobResult({ files: {} });
    expect(filesBad.ok).toBe(false);
    expect(filesBad.errors).toEqual(["globResult.files: expected array"]);

    const errorBad = validateGlobResult({ files: [], error: 123 });
    expect(errorBad.ok).toBe(false);
    expect(errorBad.errors).toEqual(["globResult.error: expected string or undefined"]);
  });

  it("filters files, coerces fromCache, and handles large lists", () => {
    const longName = "a".repeat(10000);
    const files = [longName, 1, "b.txt", null, "c.txt"];
    const largeList = Array.from({ length: 500 }, (_, i) => `file-${i}.txt`);
    const result = validateGlobResult({
      files: files.concat(largeList),
      fromCache: "yes",
      error: undefined,
    });

    expect(result.ok).toBe(true);
    expect(result.value.fromCache).toBe(true);
    expect(result.value.files[0]).toBe(longName);
    expect(result.value.files).toContain("b.txt");
    expect(result.value.files).toContain("c.txt");
    expect(result.value.files).toHaveLength(1 + 2 + 500);
  });
});

describe("validateGrepMatch", () => {
  it("rejects non-plain objects and empty chunkId", () => {
    const nullResult = validateGrepMatch(null);
    expect(nullResult.ok).toBe(false);
    expect(nullResult.errors[0]).toBe("match: expected object");

    const strResult = validateGrepMatch("nope", 0);
    expect(strResult.ok).toBe(false);
    expect(strResult.errors[0]).toBe("match[0]: expected object");

    const emptyId = validateGrepMatch({ chunkId: "   " }, 1);
    expect(emptyId.ok).toBe(false);
    expect(emptyId.errors[0]).toBe("match[1].chunkId: required non-empty string");
  });

  it("normalizes chunkId and defaults matchCount/spans", () => {
    const result = validateGrepMatch({ chunkId: "  c1  ", matchCount: "2", spans: "nope" });
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({ chunkId: "c1", matchCount: 1, spans: [] });
  });

  it("accepts numeric matchCount boundaries and preserves spans", () => {
    const spans = [1, 2, 3];
    const values = [0, -1, Number.MAX_SAFE_INTEGER];

    values.forEach((count) => {
      const result = validateGrepMatch({ chunkId: "id", matchCount: count, spans });
      expect(result.ok).toBe(true);
      expect(result.value.matchCount).toBe(count);
      expect(result.value.spans).toBe(spans);
    });
  });

  it("supports deep nested spans and concurrent calls", async () => {
    const deepSpans = [[[1, 2], [3, 4]]];
    const [a, b] = await Promise.all([
      Promise.resolve(validateGrepMatch({ chunkId: "a", spans: deepSpans })),
      Promise.resolve(validateGrepMatch({ chunkId: "b", matchCount: 2 })),
    ]);

    expect(a.ok).toBe(true);
    expect(a.value.spans).toBe(deepSpans);
    expect(b.ok).toBe(true);
    expect(b.value.matchCount).toBe(2);
  });
});
