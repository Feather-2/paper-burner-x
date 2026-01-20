/**
 * Unit tests for CompressionQualityMonitor covering core behavior and boundaries.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { setTimeout as mockedSetTimeout } from "node:timers";
import { CompressionQualityMonitor } from "../../../../../../js/agents/plugins/compression/impl/quality-monitor.js";

const mockedTimers = vi.hoisted(() => ({
  setTimeout: vi.fn((callback) => {
    callback();
    return 0;
  }),
  clearTimeout: vi.fn(),
}));

vi.mock("node:timers", () => ({
  setTimeout: mockedTimers.setTimeout,
  clearTimeout: mockedTimers.clearTimeout,
}));

describe("CompressionQualityMonitor", () => {
  let monitor;

  beforeEach(() => {
    monitor = new CompressionQualityMonitor();
    mockedTimers.setTimeout.mockClear();
    mockedTimers.clearTimeout.mockClear();
  });

  describe("constructor", () => {
    it("clamps options and exposes config", () => {
      const custom = new CompressionQualityMonitor({
        minRetentionRatio: -1,
        maxSamples: 5,
        trendWindowSize: 2,
        warningThreshold: -0.2,
        criticalThreshold: 2,
      });

      expect(custom.getConfig()).toEqual({
        minRetentionRatio: 0,
        maxSamples: 10,
        trendWindowSize: 3,
        warningThreshold: 0,
        criticalThreshold: 1,
      });
    });

    it("accepts empty options object", () => {
      const empty = new CompressionQualityMonitor({});
      expect(empty.getConfig().minRetentionRatio).toBe(0.7);
    });
  });

  describe("record", () => {
    it("records stats with explicit timestamp and sanitizes counts", () => {
      const result = monitor.record({
        beforeTokens: 100,
        afterTokens: 70,
        keptMessages: 2,
        summarizedMessages: -1,
        archivedMessages: "3",
        timestamp: 42,
      });

      expect(result).toEqual({ retention: 0.7, belowThreshold: false });

      const [sample] = monitor.getSamples(1);
      expect(sample.timestamp).toBe(42);
      expect(sample.stats).toEqual({
        beforeTokens: 100,
        afterTokens: 70,
        keptMessages: 2,
        summarizedMessages: 0,
        archivedMessages: 3,
      });
    });

    it("uses Date.now when timestamp is missing", () => {
      const nowSpy = vi.spyOn(Date, "now").mockReturnValue(12345);
      const result = monitor.record({ beforeTokens: 10, afterTokens: 0 });

      expect(result.retention).toBe(0);
      expect(result.belowThreshold).toBe(true);
      expect(monitor.getSamples(1)[0].timestamp).toBe(12345);

      nowSpy.mockRestore();
    });

    it("handles empty, blank, array, and object inputs", () => {
      const cases = [
        { stats: {}, retention: 1 },
        { stats: [], retention: 1 },
        { stats: "", retention: 1 },
        { stats: { beforeTokens: "   ", afterTokens: "" }, retention: 1 },
        { stats: { beforeTokens: "20", afterTokens: "10" }, retention: 0.5 },
        { stats: { beforeTokens: { value: 1 }, afterTokens: { value: 2 } }, retention: 1 },
      ];

      for (const { stats, retention } of cases) {
        const instance = new CompressionQualityMonitor({ minRetentionRatio: 0.6 });
        const result = instance.record(stats);
        expect(result.retention).toBe(retention);
      }
    });

    it("treats zero and negative token counts as zero", () => {
      const result = monitor.record({ beforeTokens: -1, afterTokens: -1 });
      expect(result.retention).toBe(1);
      expect(result.belowThreshold).toBe(false);
    });

    it("throws on null or undefined stats", () => {
      expect(() => monitor.record(null)).toThrow(TypeError);
      expect(() => monitor.record(undefined)).toThrow(TypeError);
    });

    it("caps samples after rapid consecutive calls", () => {
      const limited = new CompressionQualityMonitor({ maxSamples: 10 });
      for (let i = 0; i < 25; i += 1) {
        limited.record({ beforeTokens: 100, afterTokens: 100 - i });
      }

      const samples = limited.getSamples();
      expect(samples).toHaveLength(10);
      expect(samples[0].stats.afterTokens).toBe(85);
    });

    it("handles large values, long strings, and deep nesting", () => {
      const longZero = "0".repeat(10000);
      const deepNested = {
        level1: { level2: { level3: { level4: { level5: "x" } } } },
      };

      const result = monitor.record({
        beforeTokens: Number.MAX_SAFE_INTEGER,
        afterTokens: Number.MAX_SAFE_INTEGER - 1,
        keptMessages: longZero,
        summarizedMessages: "   ",
        archivedMessages: { value: deepNested },
      });

      expect(result.retention).toBeGreaterThan(0.99);

      const [sample] = monitor.getSamples(1);
      expect(sample.stats.keptMessages).toBe(0);
      expect(sample.stats.summarizedMessages).toBe(0);
      expect(sample.stats.archivedMessages).toBe(0);
    });

    it("supports concurrent-like record calls", async () => {
      const concurrent = new CompressionQualityMonitor({ maxSamples: 50 });
      const tasks = Array.from({ length: 6 }, (_, index) => {
        return new Promise((resolve) => {
          mockedSetTimeout(() => {
            concurrent.record({ beforeTokens: 100, afterTokens: 100 - index });
            resolve();
          }, 0);
        });
      });

      await Promise.all(tasks);

      expect(concurrent.getSamples()).toHaveLength(6);
      expect(mockedTimers.setTimeout).toHaveBeenCalledTimes(6);
    });
  });

  describe("getAssessment", () => {
    it("returns defaults when no samples exist", () => {
      expect(monitor.getAssessment()).toEqual({
        avgRetention: 1,
        belowThresholdCount: 0,
        trend: "stable",
        sampleCount: 0,
      });
    });

    it("computes average retention and below-threshold counts", () => {
      const custom = new CompressionQualityMonitor({ minRetentionRatio: 0.8 });
      custom.record({ beforeTokens: 100, afterTokens: 90 });
      custom.record({ beforeTokens: 100, afterTokens: 60 });

      const assessment = custom.getAssessment();
      expect(assessment.avgRetention).toBeCloseTo(0.75);
      expect(assessment.belowThresholdCount).toBe(1);
      expect(assessment.trend).toBe("stable");
      expect(assessment.sampleCount).toBe(2);
    });
  });

  describe("checkHealth", () => {
    it("returns healthy when no samples are present", () => {
      const result = monitor.checkHealth();
      expect(result.status).toBe("healthy");
      expect(result.needsAdjustment).toBe(false);
      expect(result.recommendation).toContain("No compression data available yet");
    });

    it("flags critical when below-threshold ratio exceeds critical threshold", () => {
      const critical = new CompressionQualityMonitor({
        minRetentionRatio: 0.8,
        criticalThreshold: 0.4,
      });

      const afterTokens = [70, 75, 85, 60, 90];
      afterTokens.forEach((value) => {
        critical.record({ beforeTokens: 100, afterTokens: value });
      });

      const result = critical.checkHealth();
      expect(result.status).toBe("critical");
      expect(result.needsAdjustment).toBe(true);
      expect(result.recommendation).toContain("Critical:");
    });

    it("flags warning when trend is degrading", () => {
      const warning = new CompressionQualityMonitor({ minRetentionRatio: 0.5 });
      const afterTokens = [95, 90, 85, 80];
      afterTokens.forEach((value) => {
        warning.record({ beforeTokens: 100, afterTokens: value });
      });

      const result = warning.checkHealth();
      expect(result.status).toBe("warning");
      expect(result.needsAdjustment).toBe(true);
      expect(result.recommendation).toContain("Trend is degrading.");
    });

    it("reports healthy with improving trend", () => {
      const improving = new CompressionQualityMonitor({ minRetentionRatio: 0.7 });
      const afterTokens = [70, 75, 80, 85];
      afterTokens.forEach((value) => {
        improving.record({ beforeTokens: 100, afterTokens: value });
      });

      const result = improving.checkHealth();
      expect(result.status).toBe("healthy");
      expect(result.needsAdjustment).toBe(false);
      expect(result.recommendation).toContain("Trend is improving.");
    });
  });

  describe("getSamples", () => {
    it("returns defensive copies and supports count boundaries", () => {
      monitor.record({ beforeTokens: 100, afterTokens: 10 });
      monitor.record({ beforeTokens: 100, afterTokens: 20 });
      monitor.record({ beforeTokens: 100, afterTokens: 30 });

      const samples = monitor.getSamples();
      samples.push({
        retention: 1,
        timestamp: 0,
        stats: { beforeTokens: 1, afterTokens: 1 },
      });

      expect(monitor.getSamples()).toHaveLength(3);
      expect(monitor.getSamples(10)).toHaveLength(3);

      const tail = monitor.getSamples(2);
      expect(tail).toHaveLength(2);
      expect(tail[0].stats.afterTokens).toBe(20);

      const negative = monitor.getSamples(-1);
      expect(negative).toHaveLength(2);
    });

    it("handles object or array count inputs", () => {
      monitor.record({ beforeTokens: 10, afterTokens: 5 });
      monitor.record({ beforeTokens: 10, afterTokens: 6 });

      const fromObject = monitor.getSamples({});
      const fromArray = monitor.getSamples([]);

      expect(fromObject).toHaveLength(2);
      expect(fromArray).toHaveLength(2);
    });
  });

  describe("reset", () => {
    it("clears all samples", () => {
      monitor.record({ beforeTokens: 10, afterTokens: 5 });
      monitor.record({ beforeTokens: 10, afterTokens: 6 });

      monitor.reset();
      expect(monitor.getSamples()).toHaveLength(0);
    });
  });
});
