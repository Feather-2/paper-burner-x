import { describe, expect, it, beforeEach } from "vitest";

import { CompressionQualityMonitor } from '../../../../../js/agents/plugins/compression/index.js';

describe("runtime/compression/quality-monitor", () => {
  let monitor;

  beforeEach(() => {
    monitor = new CompressionQualityMonitor();
  });

  describe("constructor", () => {
    it("uses default options", () => {
      const config = monitor.getConfig();
      expect(config.minRetentionRatio).toBe(0.7);
      expect(config.maxSamples).toBe(100);
      expect(config.trendWindowSize).toBe(10);
    });

    it("accepts custom options", () => {
      const custom = new CompressionQualityMonitor({
        minRetentionRatio: 0.8,
        maxSamples: 50,
        trendWindowSize: 5,
        warningThreshold: 0.15,
        criticalThreshold: 0.35,
      });
      const config = custom.getConfig();
      expect(config.minRetentionRatio).toBe(0.8);
      expect(config.maxSamples).toBe(50);
      expect(config.trendWindowSize).toBe(5);
      expect(config.warningThreshold).toBe(0.15);
      expect(config.criticalThreshold).toBe(0.35);
    });

    it("clamps invalid options", () => {
      const clamped = new CompressionQualityMonitor({
        minRetentionRatio: 1.5,
        maxSamples: 5,
        trendWindowSize: 1,
      });
      const config = clamped.getConfig();
      expect(config.minRetentionRatio).toBe(1);
      expect(config.maxSamples).toBe(10);
      expect(config.trendWindowSize).toBe(3);
    });
  });

  describe("record", () => {
    it("records compression stats and calculates retention", () => {
      const result = monitor.record({
        beforeTokens: 1000,
        afterTokens: 800,
        keptMessages: 5,
        summarizedMessages: 2,
        archivedMessages: 3,
      });

      expect(result.retention).toBe(0.8);
      expect(result.belowThreshold).toBe(false);
    });

    it("flags samples below threshold", () => {
      const result = monitor.record({
        beforeTokens: 1000,
        afterTokens: 500,
      });

      expect(result.retention).toBe(0.5);
      expect(result.belowThreshold).toBe(true);
    });

    it("handles zero beforeTokens gracefully", () => {
      const result = monitor.record({
        beforeTokens: 0,
        afterTokens: 100,
      });

      expect(result.retention).toBe(1);
      expect(result.belowThreshold).toBe(false);
    });

    it("handles invalid inputs gracefully", () => {
      const result = monitor.record({
        beforeTokens: "invalid",
        afterTokens: -100,
      });

      expect(result.retention).toBe(1);
      expect(result.belowThreshold).toBe(false);
    });

    it("respects maxSamples limit", () => {
      const small = new CompressionQualityMonitor({ maxSamples: 10 });

      for (let i = 0; i < 15; i++) {
        small.record({ beforeTokens: 1000, afterTokens: 900 });
      }

      expect(small.getSamples().length).toBe(10);
    });
  });

  describe("getAssessment", () => {
    it("returns default values for empty monitor", () => {
      const assessment = monitor.getAssessment();

      expect(assessment.avgRetention).toBe(1);
      expect(assessment.belowThresholdCount).toBe(0);
      expect(assessment.trend).toBe("stable");
      expect(assessment.sampleCount).toBe(0);
    });

    it("calculates average retention correctly", () => {
      monitor.record({ beforeTokens: 1000, afterTokens: 800 });
      monitor.record({ beforeTokens: 1000, afterTokens: 900 });
      monitor.record({ beforeTokens: 1000, afterTokens: 700 });

      const assessment = monitor.getAssessment();

      expect(assessment.avgRetention).toBeCloseTo(0.8, 5);
      expect(assessment.sampleCount).toBe(3);
    });

    it("counts samples below threshold", () => {
      monitor.record({ beforeTokens: 1000, afterTokens: 800 });
      monitor.record({ beforeTokens: 1000, afterTokens: 500 });
      monitor.record({ beforeTokens: 1000, afterTokens: 600 });

      const assessment = monitor.getAssessment();

      expect(assessment.belowThresholdCount).toBe(2);
    });

    it("detects improving trend", () => {
      const trendMonitor = new CompressionQualityMonitor({ trendWindowSize: 6 });

      // First half: low retention
      trendMonitor.record({ beforeTokens: 1000, afterTokens: 600 });
      trendMonitor.record({ beforeTokens: 1000, afterTokens: 650 });
      trendMonitor.record({ beforeTokens: 1000, afterTokens: 620 });

      // Second half: high retention
      trendMonitor.record({ beforeTokens: 1000, afterTokens: 850 });
      trendMonitor.record({ beforeTokens: 1000, afterTokens: 900 });
      trendMonitor.record({ beforeTokens: 1000, afterTokens: 880 });

      const assessment = trendMonitor.getAssessment();
      expect(assessment.trend).toBe("improving");
    });

    it("detects degrading trend", () => {
      const trendMonitor = new CompressionQualityMonitor({ trendWindowSize: 6 });

      // First half: high retention
      trendMonitor.record({ beforeTokens: 1000, afterTokens: 900 });
      trendMonitor.record({ beforeTokens: 1000, afterTokens: 880 });
      trendMonitor.record({ beforeTokens: 1000, afterTokens: 870 });

      // Second half: low retention
      trendMonitor.record({ beforeTokens: 1000, afterTokens: 600 });
      trendMonitor.record({ beforeTokens: 1000, afterTokens: 550 });
      trendMonitor.record({ beforeTokens: 1000, afterTokens: 580 });

      const assessment = trendMonitor.getAssessment();
      expect(assessment.trend).toBe("degrading");
    });

    it("detects stable trend", () => {
      const trendMonitor = new CompressionQualityMonitor({ trendWindowSize: 6 });

      // Consistent retention
      for (let i = 0; i < 6; i++) {
        trendMonitor.record({ beforeTokens: 1000, afterTokens: 800 });
      }

      const assessment = trendMonitor.getAssessment();
      expect(assessment.trend).toBe("stable");
    });
  });

  describe("checkHealth", () => {
    it("returns healthy for empty monitor", () => {
      const health = monitor.checkHealth();

      expect(health.needsAdjustment).toBe(false);
      expect(health.status).toBe("healthy");
    });

    it("returns healthy when all samples are above threshold", () => {
      for (let i = 0; i < 10; i++) {
        monitor.record({ beforeTokens: 1000, afterTokens: 850 });
      }

      const health = monitor.checkHealth();

      expect(health.needsAdjustment).toBe(false);
      expect(health.status).toBe("healthy");
      expect(health.recommendation).toContain("Healthy");
    });

    it("returns warning when below threshold ratio exceeds warning threshold", () => {
      // 25% below threshold (warning threshold is 20%)
      for (let i = 0; i < 8; i++) {
        monitor.record({ beforeTokens: 1000, afterTokens: 850 });
      }
      for (let i = 0; i < 2; i++) {
        monitor.record({ beforeTokens: 1000, afterTokens: 500 });
      }

      const health = monitor.checkHealth();

      expect(health.status).toBe("warning");
      expect(health.needsAdjustment).toBe(true);
      expect(health.recommendation).toContain("Warning");
    });

    it("returns critical when below threshold ratio exceeds critical threshold", () => {
      // 50% below threshold (critical threshold is 40%)
      for (let i = 0; i < 5; i++) {
        monitor.record({ beforeTokens: 1000, afterTokens: 850 });
      }
      for (let i = 0; i < 5; i++) {
        monitor.record({ beforeTokens: 1000, afterTokens: 500 });
      }

      const health = monitor.checkHealth();

      expect(health.status).toBe("critical");
      expect(health.needsAdjustment).toBe(true);
      expect(health.recommendation).toContain("Critical");
    });

    it("returns warning when trend is degrading", () => {
      const trendMonitor = new CompressionQualityMonitor({
        trendWindowSize: 6,
        warningThreshold: 0.5,
      });

      // First half: high retention
      trendMonitor.record({ beforeTokens: 1000, afterTokens: 900 });
      trendMonitor.record({ beforeTokens: 1000, afterTokens: 880 });
      trendMonitor.record({ beforeTokens: 1000, afterTokens: 870 });

      // Second half: low retention (but still above 70% threshold)
      trendMonitor.record({ beforeTokens: 1000, afterTokens: 720 });
      trendMonitor.record({ beforeTokens: 1000, afterTokens: 710 });
      trendMonitor.record({ beforeTokens: 1000, afterTokens: 700 });

      const health = trendMonitor.checkHealth();

      expect(health.status).toBe("warning");
      expect(health.recommendation).toContain("degrading");
    });
  });

  describe("getSamples", () => {
    it("returns all samples when count not specified", () => {
      monitor.record({ beforeTokens: 1000, afterTokens: 800 });
      monitor.record({ beforeTokens: 1000, afterTokens: 900 });

      const samples = monitor.getSamples();

      expect(samples.length).toBe(2);
      expect(samples[0].retention).toBe(0.8);
      expect(samples[1].retention).toBe(0.9);
    });

    it("returns last N samples when count specified", () => {
      for (let i = 0; i < 5; i++) {
        monitor.record({ beforeTokens: 1000, afterTokens: 700 + i * 50 });
      }

      const samples = monitor.getSamples(2);

      expect(samples.length).toBe(2);
      expect(samples[0].retention).toBe(0.85);
      expect(samples[1].retention).toBe(0.9);
    });

    it("returns copy of samples array", () => {
      monitor.record({ beforeTokens: 1000, afterTokens: 800 });

      const samples1 = monitor.getSamples();
      const samples2 = monitor.getSamples();

      expect(samples1).not.toBe(samples2);
      expect(samples1).toEqual(samples2);
    });
  });

  describe("reset", () => {
    it("clears all samples", () => {
      monitor.record({ beforeTokens: 1000, afterTokens: 800 });
      monitor.record({ beforeTokens: 1000, afterTokens: 900 });

      monitor.reset();

      expect(monitor.getSamples().length).toBe(0);
      expect(monitor.getAssessment().sampleCount).toBe(0);
    });
  });

  describe("integration", () => {
    it("monitors compression quality over session", () => {
      // Simulate a session with varying compression quality
      const sessionMonitor = new CompressionQualityMonitor({
        minRetentionRatio: 0.6,
        warningThreshold: 0.3,
        criticalThreshold: 0.5,
      });

      // Good compressions
      sessionMonitor.record({ beforeTokens: 10000, afterTokens: 8000 });
      sessionMonitor.record({ beforeTokens: 12000, afterTokens: 9000 });

      let health = sessionMonitor.checkHealth();
      expect(health.status).toBe("healthy");

      // One bad compression
      sessionMonitor.record({ beforeTokens: 15000, afterTokens: 5000 });

      health = sessionMonitor.checkHealth();
      expect(health.status).toBe("warning");

      // More bad compressions
      sessionMonitor.record({ beforeTokens: 8000, afterTokens: 3000 });
      sessionMonitor.record({ beforeTokens: 10000, afterTokens: 4000 });

      health = sessionMonitor.checkHealth();
      expect(health.status).toBe("critical");
      expect(health.recommendation).toContain("keepLastTurns");
    });
  });
});
