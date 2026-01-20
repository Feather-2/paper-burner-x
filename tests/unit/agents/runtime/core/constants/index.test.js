/**
 * @file tests/unit/agents/runtime/core/constants/index.test.js
 * @description runtime/constants index re-export unit tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const INDEX_PATH = "../../../../../../js/agents/runtime/core/constants/index.js";

vi.mock("../../../../../../js/agents/runtime/core/constants/timeouts.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getTimeout: vi.fn(actual.getTimeout),
  };
});

vi.mock("../../../../../../js/agents/runtime/core/constants/limits.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getLimit: vi.fn(actual.getLimit),
  };
});

vi.mock("../../../../../../js/agents/runtime/core/constants/thresholds.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getThreshold: vi.fn(actual.getThreshold),
  };
});

async function loadIndex() {
  return await import(INDEX_PATH);
}

function createDeepObject(depth = 50) {
  const root = {};
  let node = root;
  for (let i = 0; i < depth; i += 1) {
    node.child = {};
    node = node.child;
  }
  return root;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("TIMEOUTS", () => {
  it("re-exports frozen timeout constants", async () => {
    const { TIMEOUTS } = await loadIndex();

    expect(Object.isFrozen(TIMEOUTS)).toBe(true);
    expect(TIMEOUTS).toHaveProperty("TOOL_EXECUTION");
    expect(typeof TIMEOUTS.TOOL_EXECUTION).toBe("number");
  });
});

describe("LIMITS", () => {
  it("re-exports frozen limit constants", async () => {
    const { LIMITS } = await loadIndex();

    expect(Object.isFrozen(LIMITS)).toBe(true);
    expect(LIMITS).toHaveProperty("MAX_MESSAGES");
    expect(typeof LIMITS.MAX_MESSAGES).toBe("number");
  });
});

describe("THRESHOLDS", () => {
  it("re-exports frozen threshold constants", async () => {
    const { THRESHOLDS } = await loadIndex();

    expect(Object.isFrozen(THRESHOLDS)).toBe(true);
    expect(THRESHOLDS).toHaveProperty("COMPRESS_TOKEN_RATIO");
    expect(typeof THRESHOLDS.COMPRESS_TOKEN_RATIO).toBe("number");
  });
});

describe("getTimeout", () => {
  it("returns mapped values for known keys", async () => {
    const { getTimeout, TIMEOUTS } = await loadIndex();

    expect(getTimeout("WORKER_INIT")).toBe(TIMEOUTS.WORKER_INIT);
    expect(getTimeout("LLM_CALL")).toBe(TIMEOUTS.LLM_CALL);
  });

  it("prefers positive finite overrides including MAX_SAFE_INTEGER", async () => {
    const { getTimeout } = await loadIndex();

    expect(getTimeout("WORKER_INIT", 12_345)).toBe(12_345);
    expect(getTimeout("WORKER_INIT", Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("ignores non-positive or non-finite overrides", async () => {
    const { getTimeout, TIMEOUTS } = await loadIndex();

    expect(getTimeout("WORKER_INIT", 0)).toBe(TIMEOUTS.WORKER_INIT);
    expect(getTimeout("WORKER_INIT", -1)).toBe(TIMEOUTS.WORKER_INIT);
    expect(getTimeout("WORKER_INIT", "1000")).toBe(TIMEOUTS.WORKER_INIT);
    expect(getTimeout("WORKER_INIT", Number.NaN)).toBe(TIMEOUTS.WORKER_INIT);
    expect(getTimeout("WORKER_INIT", Number.POSITIVE_INFINITY)).toBe(TIMEOUTS.WORKER_INIT);
  });

  it("falls back for empty or invalid keys without throwing", async () => {
    const { getTimeout } = await loadIndex();
    const fallback = 30_000;
    const invalidKeys = [undefined, null, "", "   ", [], {}, ["nested"], { a: 1 }];

    invalidKeys.forEach((key) => {
      let result;
      expect(() => {
        result = getTimeout(key);
      }).not.toThrow();
      expect(result).toBe(fallback);
    });
  });

  it("handles resource-heavy keys like long strings, deep objects, and file-like payloads", async () => {
    const { getTimeout } = await loadIndex();
    const fallback = 30_000;
    const longString = "x".repeat(100_000);
    const deepObject = createDeepObject(100);
    const hugeFile = { name: "huge.txt", content: "x".repeat(1024 * 1024) };

    expect(getTimeout(longString)).toBe(fallback);
    expect(getTimeout(deepObject)).toBe(fallback);
    expect(getTimeout(hugeFile)).toBe(fallback);
  });

  it("returns consistent values under concurrent calls", async () => {
    const { getTimeout, TIMEOUTS } = await loadIndex();

    const results = await Promise.all(
      Array.from({ length: 25 }, () => Promise.resolve(getTimeout("HTTP_REQUEST")))
    );

    results.forEach((value) => {
      expect(value).toBe(TIMEOUTS.HTTP_REQUEST);
    });
  });
});

describe("getLimit", () => {
  it("returns mapped values for known keys", async () => {
    const { getLimit, LIMITS } = await loadIndex();

    expect(getLimit("MAX_MESSAGES")).toBe(LIMITS.MAX_MESSAGES);
    expect(getLimit("WORKER_POOL_SIZE")).toBe(LIMITS.WORKER_POOL_SIZE);
  });

  it("prefers positive overrides and ignores invalid values", async () => {
    const { getLimit, LIMITS } = await loadIndex();

    expect(getLimit("MAX_MESSAGES", 42)).toBe(42);
    expect(getLimit("MAX_MESSAGES", 0)).toBe(LIMITS.MAX_MESSAGES);
    expect(getLimit("MAX_MESSAGES", -1)).toBe(LIMITS.MAX_MESSAGES);
    expect(getLimit("MAX_MESSAGES", "10")).toBe(LIMITS.MAX_MESSAGES);
    expect(getLimit("MAX_MESSAGES", Number.NaN)).toBe(LIMITS.MAX_MESSAGES);
  });

  it("falls back for empty or invalid keys and type mixups", async () => {
    const { getLimit } = await loadIndex();
    const fallback = 100;
    const arrayLikeObject = { 0: "a", length: 1 };

    const invalidKeys = [undefined, null, "", "   ", [], {}, arrayLikeObject];
    invalidKeys.forEach((key) => {
      let result;
      expect(() => {
        result = getLimit(key, []);
      }).not.toThrow();
      expect(result).toBe(fallback);
    });
  });

  it("handles resource-heavy inputs without throwing", async () => {
    const { getLimit } = await loadIndex();
    const fallback = 100;
    const longString = "l".repeat(200_000);
    const deepObject = createDeepObject(120);
    const hugeFile = { name: "video.bin", content: "y".repeat(1024 * 1024) };

    expect(getLimit(longString)).toBe(fallback);
    expect(getLimit(deepObject)).toBe(fallback);
    expect(getLimit(hugeFile)).toBe(fallback);
  });
});

describe("getThreshold", () => {
  it("returns mapped values for known keys", async () => {
    const { getThreshold, THRESHOLDS } = await loadIndex();

    expect(getThreshold("COMPRESS_MESSAGE_COUNT")).toBe(THRESHOLDS.COMPRESS_MESSAGE_COUNT);
    expect(getThreshold("RATE_LIMIT_TPM")).toBe(THRESHOLDS.RATE_LIMIT_TPM);
  });

  it("accepts finite overrides including zero and negatives", async () => {
    const { getThreshold } = await loadIndex();

    expect(getThreshold("LATENCY_CRITICAL", 0)).toBe(0);
    expect(getThreshold("LATENCY_CRITICAL", -1)).toBe(-1);
  });

  it("ignores non-finite or non-number overrides", async () => {
    const { getThreshold, THRESHOLDS } = await loadIndex();

    expect(getThreshold("LATENCY_DEGRADED", Number.NaN)).toBe(THRESHOLDS.LATENCY_DEGRADED);
    expect(getThreshold("LATENCY_DEGRADED", Number.POSITIVE_INFINITY))
      .toBe(THRESHOLDS.LATENCY_DEGRADED);
    expect(getThreshold("LATENCY_DEGRADED", "0.2")).toBe(THRESHOLDS.LATENCY_DEGRADED);
  });

  it("falls back to default for unknown or invalid keys without throwing", async () => {
    const { getThreshold } = await loadIndex();
    const fallback = 0.5;
    const invalidKeys = ["UNKNOWN", "", "   ", null, undefined, [], {}, Symbol("x")];

    invalidKeys.forEach((key) => {
      let result;
      expect(() => {
        result = getThreshold(key);
      }).not.toThrow();
      expect(result).toBe(fallback);
    });
  });

  it("returns consistent values under rapid consecutive calls", async () => {
    const { getThreshold, THRESHOLDS } = await loadIndex();

    const results = [];
    for (let i = 0; i < 50; i += 1) {
      results.push(getThreshold("ERROR_RATE_DEGRADED"));
    }

    expect(new Set(results).size).toBe(1);
    expect(results[0]).toBe(THRESHOLDS.ERROR_RATE_DEGRADED);
  });
});
