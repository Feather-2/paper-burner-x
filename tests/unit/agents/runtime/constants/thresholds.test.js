/**
 * @file thresholds.test.js - 阈值常量单元测试
 */

import { describe, it, expect } from "vitest";
import { THRESHOLDS, getThreshold } from '../../../../../js/agents/runtime/core/constants/thresholds.js';

describe("THRESHOLDS", () => {
  it("should be frozen", () => {
    expect(Object.isFrozen(THRESHOLDS)).toBe(true);
  });

  describe("L2 -> L3 migration thresholds", () => {
    it("L2_ARCHIVE_AGE_MS should be 30 minutes", () => {
      expect(THRESHOLDS.L2_ARCHIVE_AGE_MS).toBe(30 * 60 * 1000);
    });

    it("L2_ARCHIVE_COUNT should be 50", () => {
      expect(THRESHOLDS.L2_ARCHIVE_COUNT).toBe(50);
    });

    it("L2_ARCHIVE_SIZE_BYTES should be 1MB", () => {
      expect(THRESHOLDS.L2_ARCHIVE_SIZE_BYTES).toBe(1024 * 1024);
    });
  });

  describe("existing thresholds", () => {
    it("COMPRESS_TOKEN_RATIO should be 0.8", () => {
      expect(THRESHOLDS.COMPRESS_TOKEN_RATIO).toBe(0.8);
    });

    it("COMPRESS_MESSAGE_COUNT should be 20", () => {
      expect(THRESHOLDS.COMPRESS_MESSAGE_COUNT).toBe(20);
    });
  });
});

describe("getThreshold", () => {
  it("should return threshold value for valid key", () => {
    expect(getThreshold("L2_ARCHIVE_AGE_MS")).toBe(30 * 60 * 1000);
    expect(getThreshold("L2_ARCHIVE_COUNT")).toBe(50);
    expect(getThreshold("L2_ARCHIVE_SIZE_BYTES")).toBe(1024 * 1024);
  });

  it("should return override when provided", () => {
    expect(getThreshold("L2_ARCHIVE_AGE_MS", 60_000)).toBe(60_000);
    expect(getThreshold("L2_ARCHIVE_COUNT", 100)).toBe(100);
  });

  it("should ignore non-finite override", () => {
    expect(getThreshold("L2_ARCHIVE_AGE_MS", NaN)).toBe(30 * 60 * 1000);
    expect(getThreshold("L2_ARCHIVE_COUNT", Infinity)).toBe(50);
  });

  it("should return 0.5 for unknown key", () => {
    expect(getThreshold("UNKNOWN_KEY")).toBe(0.5);
  });
});
