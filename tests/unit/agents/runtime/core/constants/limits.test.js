import { describe, it, expect, vi, beforeEach } from "vitest";

const mockedFs = vi.hoisted(() => ({
  readFileSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  readFileSync: mockedFs.readFileSync,
}));

import { LIMITS, getLimit } from "../../../../../../js/agents/runtime/core/constants/limits.js";

describe("runtime/core/constants/limits LIMITS", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedFs.readFileSync.mockReset();
  });

  it("is frozen and exposes expected defaults", () => {
    expect(Object.isFrozen(LIMITS)).toBe(true);
    expect(LIMITS).toMatchObject({
      MAX_MESSAGES: 20,
      KEEP_LAST_MESSAGES: 6,
      DEFAULT_MAX_TOKENS: 4096,
      MAX_FILE_SIZE: 100 * 1024 * 1024,
    });
  });

  it("prevents mutation of existing entries", () => {
    expect(() => {
      LIMITS.MAX_MESSAGES = 999;
    }).toThrow();
    expect(LIMITS.MAX_MESSAGES).toBe(20);
  });

  it("contains resource-related constants with expected magnitudes", () => {
    expect(LIMITS.RESOURCE_CACHE_BYTES).toBe(50 * 1024 * 1024);
    expect(LIMITS.L3_MEMORY_LIMIT_BROWSER).toBe(5 * 1024 * 1024 * 1024);
    expect(LIMITS.MAX_FILE_SIZE).toBe(100 * 1024 * 1024);
  });
});

describe("runtime/core/constants/limits getLimit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedFs.readFileSync.mockReset();
  });

  it("returns defaults for known keys without override", () => {
    expect(getLimit("MAX_MESSAGES")).toBe(LIMITS.MAX_MESSAGES);
    expect(getLimit("MAX_FILE_SIZE")).toBe(LIMITS.MAX_FILE_SIZE);
  });

  it("uses override when positive finite number", () => {
    expect(getLimit("MAX_MESSAGES", 1)).toBe(1);
    expect(getLimit("MAX_MESSAGES", Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("ignores invalid overrides and falls back to defaults", () => {
    const invalidOverrides = [
      0,
      -1,
      NaN,
      Infinity,
      -Infinity,
      "12",
      "",
      "   ",
      null,
      undefined,
      [],
      {},
      { value: 10 },
    ];

    for (const override of invalidOverrides) {
      expect(getLimit("MAX_MESSAGES", override)).toBe(LIMITS.MAX_MESSAGES);
    }
  });

  it("falls back to 100 for unknown or malformed keys", () => {
    const keys = ["NOT_A_KEY", "", "   ", null, undefined, [], {}];

    for (const key of keys) {
      expect(getLimit(key)).toBe(100);
    }
  });

  it("handles resource boundary inputs", () => {
    const hugeOverride = Number.MAX_SAFE_INTEGER;
    expect(getLimit("MAX_FILE_SIZE", hugeOverride)).toBe(hugeOverride);

    const longKey = "x".repeat(200000);
    expect(getLimit(longKey)).toBe(100);

    const deep = {};
    let cursor = deep;
    for (let i = 0; i < 50; i += 1) {
      cursor.next = {};
      cursor = cursor.next;
    }
    expect(getLimit(deep)).toBe(100);
  });

  it("supports concurrent and rapid consecutive calls", async () => {
    const concurrent = await Promise.all(
      Array.from({ length: 20 }, () => Promise.resolve(getLimit("MAX_PARALLEL_TOOLS"))),
    );

    expect(concurrent.every((value) => value === LIMITS.MAX_PARALLEL_TOOLS)).toBe(true);

    const rapidResults = [];
    for (let i = 0; i < 20; i += 1) {
      rapidResults.push(getLimit("MAX_PARALLEL_SUBAGENTS"));
    }

    expect(rapidResults).toEqual(
      Array.from({ length: 20 }, () => LIMITS.MAX_PARALLEL_SUBAGENTS),
    );
  });

  it("uses external override sources via mocked dependencies", async () => {
    mockedFs.readFileSync.mockReturnValue("777");
    const { readFileSync } = await import("node:fs");
    const override = Number(readFileSync("/tmp/limits.cfg", "utf8"));

    const result = getLimit("MAX_MESSAGES", override);

    expect(readFileSync).toHaveBeenCalledWith("/tmp/limits.cfg", "utf8");
    expect(result).toBe(777);
  });
});
