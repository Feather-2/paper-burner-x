/**
 * @file thresholds.test.js - Threshold constant unit tests.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(() => "x".repeat(2 * 1024 * 1024)),
}));

import { THRESHOLDS, getThreshold } from "../../../../../../js/agents/runtime/core/constants/thresholds.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("THRESHOLDS", () => {
  it("is frozen and rejects mutation attempts", () => {
    expect(Object.isFrozen(THRESHOLDS)).toBe(true);
    expect(() => {
      THRESHOLDS.RATE_LIMIT_RPM = 999;
    }).toThrow(TypeError);
  });

  it("contains expected constants", () => {
    expect(THRESHOLDS.COMPRESS_TOKEN_RATIO).toBe(0.8);
    expect(THRESHOLDS.LATENCY_CRITICAL).toBe(5_000);
    expect(THRESHOLDS.ERROR_RATE_CRITICAL).toBe(0.3);
    expect(THRESHOLDS.CIRCUIT_FAILURE_COUNT).toBe(5);
    expect(THRESHOLDS.RATE_LIMIT_RPM).toBe(60);
    expect(THRESHOLDS.CONVERGENCE_SIMILARITY).toBe(0.9);
    expect(THRESHOLDS.MEMORY_CRITICAL_RATIO).toBe(0.9);
    expect(THRESHOLDS.SEMANTIC_SIMILARITY).toBe(0.7);
    expect(THRESHOLDS.L2_ARCHIVE_AGE_MS).toBe(30 * 60 * 1000);
  });

  it("exposes only finite numeric values", () => {
    for (const value of Object.values(THRESHOLDS)) {
      expect(typeof value).toBe("number");
      expect(Number.isFinite(value)).toBe(true);
    }
  });
});

describe("getThreshold", () => {
  it("returns configured thresholds for known keys", () => {
    expect(getThreshold("COMPRESS_MESSAGE_COUNT")).toBe(20);
    expect(getThreshold("RATE_LIMIT_TPM")).toBe(100_000);
    expect(getThreshold("L2_ARCHIVE_SIZE_BYTES")).toBe(1024 * 1024);
  });

  it("returns override for finite numbers including boundary values", () => {
    const overrides = [0, -1, Number.MAX_SAFE_INTEGER, 42.5];
    for (const override of overrides) {
      expect(getThreshold("UNKNOWN_KEY", override)).toBe(override);
      expect(getThreshold("COMPRESS_TOKEN_RATIO", override)).toBe(override);
    }
  });

  it("ignores non-finite overrides and falls back to defaults", () => {
    expect(getThreshold("LATENCY_DEGRADED", NaN)).toBe(THRESHOLDS.LATENCY_DEGRADED);
    expect(getThreshold("LATENCY_DEGRADED", Infinity)).toBe(THRESHOLDS.LATENCY_DEGRADED);
    expect(getThreshold("LATENCY_DEGRADED", -Infinity)).toBe(THRESHOLDS.LATENCY_DEGRADED);
  });

  it("ignores non-number overrides like strings, arrays, and objects", () => {
    const invalidOverrides = ["1", "", " ", [], {}, null, undefined];
    for (const override of invalidOverrides) {
      expect(getThreshold("ERROR_RATE_DEGRADED", override)).toBe(THRESHOLDS.ERROR_RATE_DEGRADED);
    }
  });

  it("returns default 0.5 for unknown or empty keys", () => {
    const invalidKeys = ["UNKNOWN_KEY", "", "   ", null, undefined, [], {}];
    for (const key of invalidKeys) {
      expect(getThreshold(key)).toBe(0.5);
    }
  });

  it("handles invalid inputs without throwing", () => {
    expect(() => getThreshold(null)).not.toThrow();
    expect(() => getThreshold(undefined)).not.toThrow();
    expect(() => getThreshold({})).not.toThrow();
    expect(() => getThreshold([], "1")).not.toThrow();
  });

  it("handles resource boundary inputs (large file, long string, deep nesting)", () => {
    const hugeFileContents = readFileSync("/tmp/huge.txt", "utf8");
    const longKey = "k".repeat(100_000);
    const deep = { level: 0 };
    let node = deep;
    for (let i = 1; i <= 100; i += 1) {
      node.child = { level: i };
      node = node.child;
    }

    expect(hugeFileContents.length).toBeGreaterThan(1024 * 1024);
    expect(getThreshold("COMPRESS_TOKEN_RATIO", hugeFileContents)).toBe(THRESHOLDS.COMPRESS_TOKEN_RATIO);
    expect(getThreshold(longKey)).toBe(0.5);
    expect(getThreshold(deep)).toBe(0.5);
    expect(readFileSync).toHaveBeenCalledWith("/tmp/huge.txt", "utf8");
  });

  it("handles concurrent calls consistently", async () => {
    const keys = ["COMPRESS_TOKEN_RATIO", "RATE_LIMIT_RPM", "UNKNOWN_KEY", "L2_ARCHIVE_COUNT"];
    const results = await Promise.all(keys.map((key) => Promise.resolve(getThreshold(key))));

    expect(results).toEqual([
      THRESHOLDS.COMPRESS_TOKEN_RATIO,
      THRESHOLDS.RATE_LIMIT_RPM,
      0.5,
      THRESHOLDS.L2_ARCHIVE_COUNT,
    ]);
  });

  it("handles rapid consecutive calls without shared state", () => {
    const overrides = [5, 4, 3, 2, 1, 0];
    const results = overrides.map((value) => getThreshold("LATENCY_CRITICAL", value));

    expect(results).toEqual(overrides);
  });
});
