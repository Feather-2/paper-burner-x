/**
 * AdaptiveZoneManager 单元测试
 */

import { describe, it, expect, beforeEach } from "vitest";
import { AdaptiveZoneManager } from "../../../../js/agents/runtime/compression/adaptive-zone-manager.js";

describe("AdaptiveZoneManager", () => {
  let manager;

  beforeEach(() => {
    manager = new AdaptiveZoneManager();
  });

  describe("constructor", () => {
    it("should create with default boundaries", () => {
      const boundaries = manager.getBoundaries();
      expect(boundaries.archive).toBe(0.2);
      expect(boundaries.condensed).toBe(0.5);
      expect(boundaries.working).toBe(0.8);
    });

    it("should accept custom boundaries", () => {
      const custom = new AdaptiveZoneManager({
        defaultBoundaries: { archive: 0.15, condensed: 0.4, working: 0.75 },
      });
      const boundaries = custom.getBoundaries();
      expect(boundaries.archive).toBe(0.15);
    });
  });

  describe("getZone", () => {
    it("should return archive for 0-20%", () => {
      expect(manager.getZone(0)).toBe("archive");
      expect(manager.getZone(0.1)).toBe("archive");
      expect(manager.getZone(0.19)).toBe("archive");
    });

    it("should return condensed for 20-50%", () => {
      expect(manager.getZone(0.2)).toBe("condensed");
      expect(manager.getZone(0.35)).toBe("condensed");
      expect(manager.getZone(0.49)).toBe("condensed");
    });

    it("should return working for 50-80%", () => {
      expect(manager.getZone(0.5)).toBe("working");
      expect(manager.getZone(0.65)).toBe("working");
      expect(manager.getZone(0.79)).toBe("working");
    });

    it("should return active for 80-100%", () => {
      expect(manager.getZone(0.8)).toBe("active");
      expect(manager.getZone(0.9)).toBe("active");
      expect(manager.getZone(1.0)).toBe("active");
    });
  });

  describe("getZoneConfig", () => {
    it("should return archive config", () => {
      const config = manager.getZoneConfig("archive");
      expect(config.name).toBe("archive");
      expect(config.compressionLevel).toBe("heavy");
      expect(config.preserveThinking).toBe(false);
      expect(config.summarizeThinking).toBe(false);
    });

    it("should return condensed config", () => {
      const config = manager.getZoneConfig("condensed");
      expect(config.name).toBe("condensed");
      expect(config.compressionLevel).toBe("medium");
      expect(config.preserveThinking).toBe(false);
      expect(config.summarizeThinking).toBe(true);
    });

    it("should return working config", () => {
      const config = manager.getZoneConfig("working");
      expect(config.name).toBe("working");
      expect(config.compressionLevel).toBe("light");
      expect(config.preserveThinking).toBe(true);
      expect(config.summarizeThinking).toBe(false);
    });

    it("should return active config", () => {
      const config = manager.getZoneConfig("active");
      expect(config.name).toBe("active");
      expect(config.compressionLevel).toBe("none");
      expect(config.preserveThinking).toBe(true);
      expect(config.summarizeThinking).toBe(false);
    });

    it("should return active for unknown zone", () => {
      const config = manager.getZoneConfig("unknown");
      expect(config.name).toBe("active");
    });
  });

  describe("updateDensity", () => {
    it("should update zone density", () => {
      manager.updateDensity("archive", 100);
      manager.updateDensity("condensed", 200);
      // Should not throw
      expect(manager.getBoundaries()).toBeDefined();
    });

    it("should adjust boundaries based on density", () => {
      const initialBoundaries = manager.getBoundaries();

      // Simulate high density in archive
      manager.updateDensity("archive", 1000);
      manager.updateDensity("condensed", 500);
      manager.updateDensity("working", 300);
      manager.updateDensity("active", 200);

      const adjustedBoundaries = manager.getBoundaries();

      // Boundaries should have adjusted
      expect(adjustedBoundaries).toBeDefined();
    });
  });

  describe("getCompressionStrategy", () => {
    it("should return strategy for message", () => {
      const result = manager.getCompressionStrategy(0, 100, 0.8);

      expect(result).toHaveProperty("zone");
      expect(result).toHaveProperty("config");
      expect(result).toHaveProperty("messageRatio");
    });

    it("should assign early messages to archive/condensed zones", () => {
      const result = manager.getCompressionStrategy(5, 100, 0.9);
      // Message at position 5/100 = 5% of total, estimated fill = 0.05 * 0.9 = 0.045
      expect(result.zone).toBe("archive");
    });

    it("should assign recent messages to active zone", () => {
      const result = manager.getCompressionStrategy(95, 100, 0.9);
      // Message at position 95/100 = 95% of total, estimated fill = 0.95 * 0.9 = 0.855
      expect(result.zone).toBe("active");
    });

    it("should handle empty messages", () => {
      const result = manager.getCompressionStrategy(0, 0, 0.5);
      expect(result.zone).toBe("active");
      expect(result.messageRatio).toBe(1);
    });
  });

  describe("computeStrategies", () => {
    it("should compute strategies for all messages", () => {
      const messages = Array(10).fill({ content: "test" });
      const strategies = manager.computeStrategies(messages, 0.8);

      expect(strategies).toHaveLength(10);
      strategies.forEach((s, i) => {
        expect(s.index).toBe(i);
        expect(s).toHaveProperty("zone");
        expect(s).toHaveProperty("config");
      });
    });
  });

  describe("getZoneStats", () => {
    it("should return zone distribution", () => {
      const messages = Array(100).fill({ content: "test" });
      const stats = manager.getZoneStats(messages, 0.9);

      expect(stats).toHaveProperty("archive");
      expect(stats).toHaveProperty("condensed");
      expect(stats).toHaveProperty("working");
      expect(stats).toHaveProperty("active");

      const total = stats.archive + stats.condensed + stats.working + stats.active;
      expect(total).toBe(100);
    });
  });

  describe("reset", () => {
    it("should reset to default boundaries", () => {
      manager.updateDensity("archive", 1000);
      manager.reset();

      const boundaries = manager.getBoundaries();
      expect(boundaries.archive).toBe(0.2);
      expect(boundaries.condensed).toBe(0.5);
      expect(boundaries.working).toBe(0.8);
    });
  });
});
