import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

import {
  ModelUsage,
  MessageRole,
  isValidModelUsage,
  isValidMessageRole,
  ModelHealth,
  RouterStrategy,
  TransportKind,
  isValidModelHealth,
  isValidRouterStrategy,
  normalizeRouterStrategy,
} from "../../../../js/agents/llm/constants.js";

vi.mock("node:fs", () => {
  return {
    readFileSync: vi.fn((path) => {
      if (path === "__huge__") {
        return "H".repeat(1024 * 1024);
      }
      if (path === "__long__") {
        return "L".repeat(10000);
      }
      return "";
    }),
  };
});

const EMPTY_VALUES = [null, undefined, "", [], {}];
const NUMERIC_BOUNDARIES = [0, -1, Number.MAX_SAFE_INTEGER];
const TYPE_BOUNDARIES = ["123", { 0: "analyst", length: 1 }];
const WHITESPACE_STRING = "   ";

const makeDeepNested = (depth) => {
  let node = { value: "leaf" };
  for (let i = 0; i < depth; i += 1) {
    node = { child: node };
  }
  return node;
};

const getHugeFileContent = () => readFileSync("__huge__");
const getLongString = () => readFileSync("__long__");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ModelUsage", () => {
  it("is frozen and exposes expected entries", () => {
    const expected = {
      ANALYST: "analyst",
      PLANNER: "planner",
      WRITER: "writer",
      REVIEWER: "reviewer",
      RERANKER: "reranker",
      SHADOW: "shadow",
      CODESEARCH: "codesearch",
      DESIGNER: "designer",
      VISION: "vision",
      WORKER: "worker",
    };

    expect(Object.isFrozen(ModelUsage)).toBe(true);
    expect(Object.keys(ModelUsage).length).toBe(Object.keys(expected).length);

    for (const [key, value] of Object.entries(expected)) {
      expect(ModelUsage[key]).toBe(value);
    }
  });
});

describe("MessageRole", () => {
  it("is frozen and exposes expected entries", () => {
    const expected = {
      SYSTEM: "system",
      USER: "user",
      ASSISTANT: "assistant",
    };

    expect(Object.isFrozen(MessageRole)).toBe(true);
    expect(Object.keys(MessageRole).length).toBe(Object.keys(expected).length);

    for (const [key, value] of Object.entries(expected)) {
      expect(MessageRole[key]).toBe(value);
    }
  });
});

describe("ModelHealth", () => {
  it("is frozen and exposes expected entries", () => {
    const expected = {
      HEALTHY: "healthy",
      DEGRADED: "degraded",
      UNAVAILABLE: "unavailable",
    };

    expect(Object.isFrozen(ModelHealth)).toBe(true);
    expect(Object.keys(ModelHealth).length).toBe(Object.keys(expected).length);

    for (const [key, value] of Object.entries(expected)) {
      expect(ModelHealth[key]).toBe(value);
    }
  });
});

describe("RouterStrategy", () => {
  it("is frozen and exposes expected entries", () => {
    const expected = {
      ROUND_ROBIN: "round_robin",
      PRIORITY: "priority",
      COST_OPTIMIZED: "cost_optimized",
      LATENCY_OPTIMIZED: "latency_optimized",
    };

    expect(Object.isFrozen(RouterStrategy)).toBe(true);
    expect(Object.keys(RouterStrategy).length).toBe(Object.keys(expected).length);

    for (const [key, value] of Object.entries(expected)) {
      expect(RouterStrategy[key]).toBe(value);
    }
  });
});

describe("TransportKind", () => {
  it("is frozen and exposes expected entries", () => {
    const expected = {
      HTTP: "http",
      WEBSOCKET: "websocket",
      STREAMING: "streaming",
    };

    expect(Object.isFrozen(TransportKind)).toBe(true);
    expect(Object.keys(TransportKind).length).toBe(Object.keys(expected).length);

    for (const [key, value] of Object.entries(expected)) {
      expect(TransportKind[key]).toBe(value);
    }
  });
});

describe("isValidModelUsage", () => {
  it("returns true for known model usage values", () => {
    for (const value of Object.values(ModelUsage)) {
      expect(isValidModelUsage(value)).toBe(true);
    }
  });

  it("returns false for empty, boundary, and resource values", () => {
    const hugeFile = getHugeFileContent();
    const longString = getLongString();
    const deepNested = makeDeepNested(40);
    const cases = [
      ...EMPTY_VALUES,
      WHITESPACE_STRING,
      ...NUMERIC_BOUNDARIES,
      ...TYPE_BOUNDARIES,
      hugeFile,
      longString,
      deepNested,
    ];

    for (const value of cases) {
      expect(isValidModelUsage(value)).toBe(false);
    }

    expect(readFileSync).toHaveBeenCalledWith("__huge__");
    expect(readFileSync).toHaveBeenCalledWith("__long__");
  });

  it("does not throw on symbols or nested objects", () => {
    const nested = makeDeepNested(10);
    const symbolValue = Symbol("model");

    expect(() => isValidModelUsage(symbolValue)).not.toThrow();
    expect(isValidModelUsage(symbolValue)).toBe(false);
    expect(() => isValidModelUsage(nested)).not.toThrow();
    expect(isValidModelUsage(nested)).toBe(false);
  });

  it("handles concurrent calls", async () => {
    const inputs = [ModelUsage.ANALYST, "unknown", null, ModelUsage.WRITER];
    const results = await Promise.all(inputs.map((value) => Promise.resolve(isValidModelUsage(value))));

    expect(results).toEqual([true, false, false, true]);
  });

  it("handles rapid consecutive calls", () => {
    let matches = 0;
    for (let i = 0; i < 500; i += 1) {
      if (isValidModelUsage(ModelUsage.WORKER)) {
        matches += 1;
      }
    }
    expect(matches).toBe(500);
  });
});

describe("isValidMessageRole", () => {
  it("returns true for known message roles", () => {
    for (const value of Object.values(MessageRole)) {
      expect(isValidMessageRole(value)).toBe(true);
    }
  });

  it("returns false for empty, boundary, and type values", () => {
    const cases = [
      ...EMPTY_VALUES,
      WHITESPACE_STRING,
      ...NUMERIC_BOUNDARIES,
      ...TYPE_BOUNDARIES,
      "SYSTEM",
      "assistant ",
      { role: "assistant" },
      ["system"],
    ];

    for (const value of cases) {
      expect(isValidMessageRole(value)).toBe(false);
    }
  });

  it("does not throw for deeply nested inputs", () => {
    const nested = makeDeepNested(15);
    expect(() => isValidMessageRole(nested)).not.toThrow();
    expect(isValidMessageRole(nested)).toBe(false);
  });
});

describe("isValidModelHealth", () => {
  it("returns true for known model health values", () => {
    for (const value of Object.values(ModelHealth)) {
      expect(isValidModelHealth(value)).toBe(true);
    }
  });

  it("returns false for empty, boundary, and type values", () => {
    const cases = [
      ...EMPTY_VALUES,
      WHITESPACE_STRING,
      ...NUMERIC_BOUNDARIES,
      ...TYPE_BOUNDARIES,
      "healthy ",
      "UNAVAILABLE",
    ];

    for (const value of cases) {
      expect(isValidModelHealth(value)).toBe(false);
    }
  });

  it("does not throw for symbols", () => {
    const symbolValue = Symbol("health");
    expect(() => isValidModelHealth(symbolValue)).not.toThrow();
    expect(isValidModelHealth(symbolValue)).toBe(false);
  });
});

describe("isValidRouterStrategy", () => {
  it("returns true for known router strategies", () => {
    for (const value of Object.values(RouterStrategy)) {
      expect(isValidRouterStrategy(value)).toBe(true);
    }
  });

  it("returns false for empty, boundary, and malformed inputs", () => {
    const cases = [
      ...EMPTY_VALUES,
      WHITESPACE_STRING,
      ...NUMERIC_BOUNDARIES,
      ...TYPE_BOUNDARIES,
      "ROUND_ROBIN",
      " round_robin ",
      new String(RouterStrategy.ROUND_ROBIN),
    ];

    for (const value of cases) {
      expect(isValidRouterStrategy(value)).toBe(false);
    }
  });
});

describe("normalizeRouterStrategy", () => {
  it("normalizes known strategy strings by trimming and lowercasing", () => {
    expect(normalizeRouterStrategy("  ROUND_ROBIN ")).toBe(RouterStrategy.ROUND_ROBIN);
    expect(normalizeRouterStrategy("Priority")).toBe(RouterStrategy.PRIORITY);
    expect(normalizeRouterStrategy("COST_OPTIMIZED")).toBe(RouterStrategy.COST_OPTIMIZED);
  });

  it("returns the default fallback for invalid or empty inputs", () => {
    const cases = [
      ...EMPTY_VALUES,
      WHITESPACE_STRING,
      ...NUMERIC_BOUNDARIES,
      "unknown",
      "latency optimized",
    ];

    for (const value of cases) {
      expect(normalizeRouterStrategy(value)).toBe(RouterStrategy.ROUND_ROBIN);
    }
  });

  it("uses the provided fallback when input is invalid", () => {
    const fallback = RouterStrategy.PRIORITY;
    expect(normalizeRouterStrategy("invalid", fallback)).toBe(fallback);
    expect(normalizeRouterStrategy(null, fallback)).toBe(fallback);
  });

  it("handles resource boundary inputs without throwing", () => {
    const hugeFile = getHugeFileContent();
    const longString = getLongString();
    const deepNested = makeDeepNested(30);

    expect(normalizeRouterStrategy(hugeFile)).toBe(RouterStrategy.ROUND_ROBIN);
    expect(normalizeRouterStrategy(longString)).toBe(RouterStrategy.ROUND_ROBIN);
    expect(normalizeRouterStrategy(deepNested)).toBe(RouterStrategy.ROUND_ROBIN);
    expect(readFileSync).toHaveBeenCalledWith("__huge__");
    expect(readFileSync).toHaveBeenCalledWith("__long__");
  });

  it("handles concurrent calls", async () => {
    const inputs = ["priority", " invalid ", null, RouterStrategy.COST_OPTIMIZED];
    const results = await Promise.all(inputs.map((value) => Promise.resolve(normalizeRouterStrategy(value))));

    expect(results).toEqual([
      RouterStrategy.PRIORITY,
      RouterStrategy.ROUND_ROBIN,
      RouterStrategy.ROUND_ROBIN,
      RouterStrategy.COST_OPTIMIZED,
    ]);
  });

  it("handles rapid consecutive calls", () => {
    let normalized = 0;
    for (let i = 0; i < 500; i += 1) {
      if (normalizeRouterStrategy("LATENCY_OPTIMIZED") === RouterStrategy.LATENCY_OPTIMIZED) {
        normalized += 1;
      }
    }
    expect(normalized).toBe(500);
  });
});
