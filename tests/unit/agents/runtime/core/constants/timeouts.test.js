/**
 * @file timeouts.test.js - Timeout constant unit tests.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(() => "x".repeat(2 * 1024 * 1024)),
}));

import { TIMEOUTS, getTimeout } from "../../../../../../js/agents/runtime/core/constants/timeouts.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TIMEOUTS", () => {
  it("is frozen and rejects mutation attempts", () => {
    expect(Object.isFrozen(TIMEOUTS)).toBe(true);
    expect(() => {
      TIMEOUTS.TOOL_EXECUTION = 999;
    }).toThrow(TypeError);
  });

  it("contains expected constants", () => {
    expect(TIMEOUTS.TOOL_EXECUTION).toBe(30_000);
    expect(TIMEOUTS.TOOL_EXECUTION_MAX).toBe(300_000);
    expect(TIMEOUTS.WORKER_RPC).toBe(30_000);
    expect(TIMEOUTS.WORKER_INIT).toBe(10_000);
    expect(TIMEOUTS.WORKER_TERMINATE).toBe(5_000);
    expect(TIMEOUTS.LLM_CALL).toBe(120_000);
    expect(TIMEOUTS.LLM_FIRST_TOKEN).toBe(30_000);
    expect(TIMEOUTS.LLM_TOKEN_INTERVAL).toBe(10_000);
    expect(TIMEOUTS.HTTP_REQUEST).toBe(30_000);
    expect(TIMEOUTS.HTTP_CONNECT).toBe(10_000);
    expect(TIMEOUTS.WEBSOCKET_HEARTBEAT).toBe(30_000);
    expect(TIMEOUTS.GRACEFUL_SHUTDOWN).toBe(5_000);
    expect(TIMEOUTS.FORCE_KILL).toBe(10_000);
    expect(TIMEOUTS.CLEANUP_INTERVAL).toBe(60_000);
    expect(TIMEOUTS.CHECKPOINT_INTERVAL).toBe(300_000);
    expect(TIMEOUTS.HEARTBEAT_INTERVAL).toBe(10_000);
    expect(TIMEOUTS.WATCHDOG_INTERVAL).toBe(5_000);
    expect(TIMEOUTS.STUCK_THRESHOLD).toBe(60_000);
    expect(TIMEOUTS.MAX_RUNTIME).toBe(600_000);
    expect(TIMEOUTS.RETRY_BASE).toBe(1_000);
    expect(TIMEOUTS.RETRY_MAX).toBe(30_000);
  });

  it("exposes only finite positive numbers", () => {
    for (const value of Object.values(TIMEOUTS)) {
      expect(typeof value).toBe("number");
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThan(0);
    }
  });
});

describe("getTimeout", () => {
  it("returns configured timeouts for known keys", () => {
    expect(getTimeout("TOOL_EXECUTION")).toBe(TIMEOUTS.TOOL_EXECUTION);
    expect(getTimeout("WORKER_INIT")).toBe(TIMEOUTS.WORKER_INIT);
    expect(getTimeout("LLM_CALL")).toBe(TIMEOUTS.LLM_CALL);
    expect(getTimeout("RETRY_MAX")).toBe(TIMEOUTS.RETRY_MAX);
  });

  it("uses override for positive finite numbers even with unknown keys", () => {
    const overrides = [1, 15_000, Number.MAX_SAFE_INTEGER];
    for (const override of overrides) {
      expect(getTimeout("HTTP_REQUEST", override)).toBe(override);
      expect(getTimeout("UNKNOWN_KEY", override)).toBe(override);
    }
  });

  it("ignores non-positive or non-finite overrides", () => {
    const invalidOverrides = [0, -1, NaN, Infinity, -Infinity];
    for (const override of invalidOverrides) {
      expect(getTimeout("HTTP_REQUEST", override)).toBe(TIMEOUTS.HTTP_REQUEST);
    }
  });

  it("ignores non-number overrides like strings, arrays, and objects", () => {
    const invalidOverrides = ["15000", "", "   ", [], {}, null, undefined];
    for (const override of invalidOverrides) {
      expect(getTimeout("WORKER_RPC", override)).toBe(TIMEOUTS.WORKER_RPC);
    }
  });

  it("returns default 30000 for unknown or empty keys", () => {
    const invalidKeys = ["UNKNOWN_KEY", "", "   ", null, undefined, [], {}];
    for (const key of invalidKeys) {
      expect(getTimeout(key)).toBe(30_000);
    }
  });

  it("handles invalid inputs without throwing or deviating from fallback", () => {
    expect(getTimeout(null, "1")).toBe(30_000);
    expect(getTimeout(undefined, {})).toBe(30_000);
    expect(getTimeout([], {})).toBe(30_000);
    expect(getTimeout({}, [])).toBe(30_000);
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
    expect(getTimeout("TOOL_EXECUTION", hugeFileContents)).toBe(TIMEOUTS.TOOL_EXECUTION);
    expect(getTimeout(longKey)).toBe(30_000);
    expect(getTimeout(deep)).toBe(30_000);
    expect(readFileSync).toHaveBeenCalledWith("/tmp/huge.txt", "utf8");
  });

  it("handles concurrent calls consistently", async () => {
    const keys = ["HTTP_REQUEST", "WORKER_TERMINATE", "UNKNOWN_KEY", "LLM_FIRST_TOKEN"];
    const results = await Promise.all(keys.map((key) => Promise.resolve(getTimeout(key))));

    expect(results).toEqual([
      TIMEOUTS.HTTP_REQUEST,
      TIMEOUTS.WORKER_TERMINATE,
      30_000,
      TIMEOUTS.LLM_FIRST_TOKEN,
    ]);
  });

  it("handles rapid consecutive calls without shared state", () => {
    const overrides = [5_000, 0, 10_000, -1, 20_000];
    const results = overrides.map((value) => getTimeout("WORKER_RPC", value));

    expect(results).toEqual([
      5_000,
      TIMEOUTS.WORKER_RPC,
      10_000,
      TIMEOUTS.WORKER_RPC,
      20_000,
    ]);
  });
});
