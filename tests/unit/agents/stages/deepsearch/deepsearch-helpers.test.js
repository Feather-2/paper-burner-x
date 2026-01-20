import { describe, it, expect, vi, beforeEach } from "vitest";

const sharedMocks = vi.hoisted(() => {
  const isPlainObject = vi.fn();
  const sanitizeForJson = vi.fn();
  const toPositiveInt = vi.fn();
  return { isPlainObject, sanitizeForJson, toPositiveInt };
});

const telemetryMocks = vi.hoisted(() => {
  class TraceContext {
    constructor(init = {}) {
      this.traceId = init.traceId;
      this.parentSpanId = init.parentSpanId;
    }
  }
  TraceContext.parseTraceparent = vi.fn(() => null);
  return { TraceContext };
});

const runtimeMocks = vi.hoisted(() => ({
  getErrorBoundary: vi.fn(() => ({ wrap: vi.fn((fn) => fn) })),
}));

vi.mock("../../../../../js/agents/shared/index.js", () => ({
  isPlainObject: sharedMocks.isPlainObject,
  sanitizeForJson: sharedMocks.sanitizeForJson,
  toPositiveInt: sharedMocks.toPositiveInt,
}));

vi.mock("../../../../../js/agents/plugins/telemetry/index.js", () => ({
  TraceContext: telemetryMocks.TraceContext,
}));

vi.mock("../../../../../js/agents/runtime/index.js", () => ({
  getErrorBoundary: runtimeMocks.getErrorBoundary,
}));

import {
  DEFAULT_MODE_CONFIG,
  deepSortForStableJson,
  stableStringify,
  toClamped01Float,
  normalizeReportConvergenceConfig,
  normalizeNewlines,
  sliceTail,
  buildConvergenceSample,
} from "../../../../../js/agents/stages/deepsearch/deepsearch-helpers.js";

const toPositiveIntImpl = (value, fallback = 1) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return fallback;
    const n = Math.floor(value);
    return n > 0 ? n : fallback;
  }
  const s = typeof value === "string" ? value.trim() : "";
  if (!s) return fallback;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

beforeEach(() => {
  vi.clearAllMocks();
  sharedMocks.isPlainObject.mockImplementation((value) => {
    if (value === null || typeof value !== "object") return false;
    if (Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  });
  sharedMocks.sanitizeForJson.mockImplementation((value) => value);
  sharedMocks.toPositiveInt.mockImplementation((value, fallback = 1) => toPositiveIntImpl(value, fallback));
});

describe("DEFAULT_MODE_CONFIG", () => {
  it("exposes expected defaults for quick/wider/deeper modes", () => {
    expect(DEFAULT_MODE_CONFIG.quick).toEqual({
      maxIterations: 15,
      writeIterations: 5,
      maxToolCalls: 50,
      subagentIterations: 5,
      description: "快速概览",
    });
    expect(DEFAULT_MODE_CONFIG.wider).toEqual({
      maxIterations: 30,
      writeIterations: 10,
      maxToolCalls: 100,
      subagentIterations: 10,
      description: "广度优先，覆盖所有文档",
    });
    expect(DEFAULT_MODE_CONFIG.deeper).toEqual({
      maxIterations: 50,
      writeIterations: 15,
      maxToolCalls: 200,
      subagentIterations: 15,
      description: "深度优先，逐个分析",
    });
  });
});

describe("deepSortForStableJson", () => {
  it("returns primitives and nullish values unchanged", () => {
    expect(deepSortForStableJson(null)).toBeNull();
    expect(deepSortForStableJson(undefined)).toBeUndefined();
    expect(deepSortForStableJson("")).toBe("");
    expect(deepSortForStableJson("   ")).toBe("   ");
    expect(deepSortForStableJson(0)).toBe(0);
    expect(deepSortForStableJson(false)).toBe(false);
  });

  it("sorts keys recursively and preserves array order", () => {
    const input = {
      b: 1,
      a: { d: 4, c: 3 },
      arr: [{ z: 2, y: 1 }, null, ["x", { b: 2, a: 1 }]],
    };

    const result = deepSortForStableJson(input);

    expect(result).toEqual({
      a: { c: 3, d: 4 },
      arr: [{ y: 1, z: 2 }, null, ["x", { a: 1, b: 2 }]],
      b: 1,
    });
  });

  it("replaces circular references with a placeholder string", () => {
    const obj = { name: "root" };
    obj.self = obj;

    const result = deepSortForStableJson(obj);

    expect(result).toEqual({ name: "root", self: "[Circular]" });
  });

  it("handles deep nesting and concurrent calls", async () => {
    const deep = {};
    let cursor = deep;
    for (let i = 0; i < 120; i += 1) {
      cursor[`level${i}`] = {};
      cursor = cursor[`level${i}`];
    }
    cursor.value = "end";

    const cyc = { id: "cycle" };
    cyc.next = cyc;

    const [sortedDeep, sortedCyc] = await Promise.all([
      Promise.resolve(deepSortForStableJson(deep)),
      Promise.resolve(deepSortForStableJson(cyc)),
    ]);

    let deepCursor = sortedDeep;
    for (let i = 0; i < 120; i += 1) {
      deepCursor = deepCursor[`level${i}`];
    }

    expect(deepCursor.value).toBe("end");
    expect(sortedCyc).toEqual({ id: "cycle", next: "[Circular]" });
  });
});

describe("stableStringify", () => {
  it("stringifies with stable ordering and sanitization", () => {
    const input = { b: 1, a: 2 };

    const result = stableStringify(input);

    expect(sharedMocks.sanitizeForJson).toHaveBeenCalledTimes(1);
    expect(sharedMocks.sanitizeForJson).toHaveBeenCalledWith(input);
    expect(result).toBe('{"a":2,"b":1}');
  });

  it("truncates long output when maxChars is exceeded", () => {
    const value = { text: "x".repeat(5000) };
    const full = JSON.stringify(deepSortForStableJson(value));
    const limit = 120;

    const result = stableStringify(value, { maxChars: limit });

    expect(result).toBe(full.slice(0, limit) + "...");
  });

  it("does not truncate for non-positive or non-finite limits", () => {
    const value = { ok: true };
    const full = JSON.stringify(deepSortForStableJson(value));
    const limits = [0, -1, Number.NaN, Number.POSITIVE_INFINITY, "not-number"];

    for (const maxChars of limits) {
      expect(stableStringify(value, { maxChars })).toBe(full);
    }
  });

  it("falls back to String when JSON.stringify throws", () => {
    sharedMocks.sanitizeForJson.mockImplementation(() => 123n);

    const result = stableStringify(123n);

    expect(result).toBe("123");
  });

  it("handles rapid consecutive calls without shared state", () => {
    const first = stableStringify({ z: 1, y: 2 });
    const second = stableStringify({ b: 2, a: 1 });
    const third = stableStringify({ k: "v" });

    expect(first).toBe('{"y":2,"z":1}');
    expect(second).toBe('{"a":1,"b":2}');
    expect(third).toBe('{"k":"v"}');
  });
});

describe("toClamped01Float", () => {
  it("clamps numeric inputs and numeric strings into [0, 1]", () => {
    expect(toClamped01Float(0, 0.2)).toBe(0);
    expect(toClamped01Float(-1, 0.2)).toBe(0);
    expect(toClamped01Float(0.5, 0.2)).toBe(0.5);
    expect(toClamped01Float(1.5, 0.2)).toBe(1);
    expect(toClamped01Float(Number.MAX_SAFE_INTEGER, 0.2)).toBe(1);
    expect(toClamped01Float("0.25", 0.2)).toBe(0.25);
    expect(toClamped01Float("   ", 0.2)).toBe(0);
  });

  it("returns fallback for invalid or non-finite values", () => {
    const fallback = 0.33;
    expect(toClamped01Float("not-a-number", fallback)).toBe(fallback);
    expect(toClamped01Float(undefined, fallback)).toBe(fallback);
    expect(toClamped01Float(null, fallback)).toBe(0);
    expect(toClamped01Float(Number.NaN, fallback)).toBe(fallback);
    expect(toClamped01Float(Number.POSITIVE_INFINITY, fallback)).toBe(fallback);
    expect(toClamped01Float({}, fallback)).toBe(fallback);
  });
});

describe("normalizeReportConvergenceConfig", () => {
  it("uses defaults for nullish or non-object inputs", () => {
    const result = normalizeReportConvergenceConfig(null);

    expect(result).toEqual({
      enabled: false,
      stopOnConvergence: true,
      windowSize: 5,
      minIterations: 4,
      minReportChars: 1200,
      sampleMaxChars: 6000,
      entropyThreshold: undefined,
      similarityThreshold: undefined,
    });

    const arrayResult = normalizeReportConvergenceConfig([]);
    expect(arrayResult).toEqual(result);
  });

  it("honors overrides, alias keys, and clamps thresholds", () => {
    const result = normalizeReportConvergenceConfig({
      enabled: true,
      stopOnConvergence: false,
      window: "7",
      minIters: "9",
      minChars: "1500",
      maxChars: 8000,
      entropyThreshold: 1.5,
      similarityThreshold: "-0.2",
    });

    expect(result).toEqual({
      enabled: true,
      stopOnConvergence: false,
      windowSize: 7,
      minIterations: 9,
      minReportChars: 1500,
      sampleMaxChars: 8000,
      entropyThreshold: 1,
      similarityThreshold: 0,
    });
    expect(sharedMocks.toPositiveInt).toHaveBeenCalledWith("7", 5);
    expect(sharedMocks.toPositiveInt).toHaveBeenCalledWith("9", 4);
    expect(sharedMocks.toPositiveInt).toHaveBeenCalledWith("1500", 1200);
    expect(sharedMocks.toPositiveInt).toHaveBeenCalledWith(8000, 6000);
  });

  it("handles whitespace strings, boundary values, and concurrent calls", async () => {
    const [first, second] = await Promise.all([
      Promise.resolve(
        normalizeReportConvergenceConfig({
          windowSize: "   ",
          minIterations: -1,
          minReportChars: 0,
          sampleMaxChars: Number.MAX_SAFE_INTEGER,
        })
      ),
      Promise.resolve(
        normalizeReportConvergenceConfig({
          enabled: true,
          entropyThreshold: 0,
          similarityThreshold: 1,
        })
      ),
    ]);

    expect(first).toEqual({
      enabled: false,
      stopOnConvergence: true,
      windowSize: 5,
      minIterations: 4,
      minReportChars: 1200,
      sampleMaxChars: Number.MAX_SAFE_INTEGER,
      entropyThreshold: undefined,
      similarityThreshold: undefined,
    });
    expect(second).toEqual({
      enabled: true,
      stopOnConvergence: true,
      windowSize: 5,
      minIterations: 4,
      minReportChars: 1200,
      sampleMaxChars: 6000,
      entropyThreshold: 0,
      similarityThreshold: 1,
    });
  });
});

describe("normalizeNewlines", () => {
  it("normalizes CRLF and CR to LF and handles empty inputs", () => {
    expect(normalizeNewlines("a\r\nb\rc")).toBe("a\nb\nc");
    expect(normalizeNewlines("")).toBe("");
    expect(normalizeNewlines(null)).toBe("");
    expect(normalizeNewlines(undefined)).toBe("");
  });

  it("handles very long strings and is idempotent", () => {
    const long = "line\r\n".repeat(10000) + "end\rmiddle";
    const normalized = normalizeNewlines(long);
    const secondPass = normalizeNewlines(normalized);

    expect(normalized).not.toContain("\r");
    expect(secondPass).toBe(normalized);
  });
});

describe("sliceTail", () => {
  it("returns the original string for empty or oversized limits", () => {
    const text = "abcdef";
    const limits = [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 10];

    for (const maxChars of limits) {
      expect(sliceTail(text, maxChars)).toBe(text);
    }
  });

  it("slices from the tail for smaller limits", () => {
    expect(sliceTail("abcdef", 3)).toBe("def");
    const longText = `${"x".repeat(10000)}tail`;
    expect(sliceTail(longText, 4)).toBe("tail");
  });

  it("handles nullish inputs and rapid consecutive calls", () => {
    expect(sliceTail(null, 5)).toBe("");
    expect(sliceTail(undefined, 0)).toBe("");

    const a = sliceTail("123456", 2);
    const b = sliceTail("abcdef", 4);
    const c = sliceTail("zz", 1);

    expect(a).toBe("56");
    expect(b).toBe("cdef");
    expect(c).toBe("z");
  });
});

describe("buildConvergenceSample", () => {
  it("builds report and gap sections with normalization", () => {
    const output = buildConvergenceSample({
      reportMarkdown: "line1\r\nline2",
      gaps: [
        { gapId: "gap_1", status: "closed", title: "Title" },
        { id: "gap_2", question: "Why?" },
        { text: "fromText" },
      ],
      maxChars: 100,
    });

    const lines = output.split("\n");
    const gapIndex = lines.indexOf("GAPS:");

    expect(lines[0]).toBe("REPORT:");
    expect(lines[1]).toBe("line1");
    expect(lines[2]).toBe("line2");
    expect(lines[gapIndex + 1]).toBe("gap_1|closed|Title");
    expect(lines[gapIndex + 2]).toBe("gap_2|open|Why?");
    expect(lines[gapIndex + 3]).toBe("|open|fromText");
  });

  it("handles empty inputs and non-array gaps", () => {
    const emptyOutput = buildConvergenceSample();
    const objectGapsOutput = buildConvergenceSample({ reportMarkdown: "", gaps: { gapId: "x" }, maxChars: 10 });

    expect(emptyOutput).toBe("REPORT:\n\n\nGAPS:\n");
    expect(objectGapsOutput).toBe("REPORT:\n\n\nGAPS:\n");
  });

  it("limits gap lines to 30 and truncates fields", () => {
    const gaps = Array.from({ length: 35 }, (_, index) => ({
      gapId: `id_${index}_${"i".repeat(80)}`,
      status: `status_${"s".repeat(50)}`,
      title: `title_${"t".repeat(300)}`,
    }));

    const output = buildConvergenceSample({ reportMarkdown: "ok", gaps });
    const lines = output.split("\n");
    const gapIndex = lines.indexOf("GAPS:");
    const gapLines = lines.slice(gapIndex + 1);

    expect(gapLines).toHaveLength(30);
    const [id, status, title] = gapLines[0].split("|");
    expect(id.length).toBe(64);
    expect(status.length).toBe(32);
    expect(title.length).toBe(240);
  });

  it("slices report tail for long markdown and supports concurrent calls", async () => {
    const reportMarkdown = `start\r\n${"x".repeat(200)}\rend`;
    const maxChars = 20;
    const normalized = reportMarkdown.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const expectedTail = normalized.slice(Math.max(0, normalized.length - maxChars));

    const [first, second] = await Promise.all([
      Promise.resolve(buildConvergenceSample({ reportMarkdown, gaps: [], maxChars })),
      Promise.resolve(buildConvergenceSample({ reportMarkdown: "short", gaps: [] })),
    ]);

    expect(first).toBe(`REPORT:\n${expectedTail}\n\nGAPS:\n`);
    expect(second).toBe("REPORT:\nshort\n\nGAPS:\n");
  });
});
