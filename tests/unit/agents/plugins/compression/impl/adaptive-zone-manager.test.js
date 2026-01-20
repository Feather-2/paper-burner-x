import { describe, it, expect, vi, beforeEach } from "vitest";
import AdaptiveZoneManager, {
  AdaptiveZoneManager as AdaptiveZoneManagerNamed,
} from "../../../../../../js/agents/plugins/compression/impl/adaptive-zone-manager.js";

const mockedFs = vi.hoisted(() => ({
  readFileSync: vi.fn(() => ""),
}));

vi.mock("node:fs", () => ({
  readFileSync: mockedFs.readFileSync,
}));

describe("AdaptiveZoneManager", () => {
  let manager;

  beforeEach(() => {
    manager = new AdaptiveZoneManagerNamed();
    mockedFs.readFileSync.mockReset();
    mockedFs.readFileSync.mockReturnValue("");
  });

  describe("constructor", () => {
    it("merges custom boundaries and clamps densityWeight", () => {
      const custom = new AdaptiveZoneManagerNamed({
        defaultBoundaries: { archive: 0.15 },
        densityWeight: 2,
      });

      expect(custom.getBoundaries()).toEqual({
        archive: 0.15,
        condensed: 0.5,
        working: 0.8,
      });
      expect(custom._densityWeight).toBe(1);

      const negative = new AdaptiveZoneManagerNamed({ densityWeight: -1 });
      expect(negative._densityWeight).toBe(0);
    });

    it("accepts empty options object", () => {
      const empty = new AdaptiveZoneManagerNamed({});
      expect(empty.getBoundaries()).toEqual({
        archive: 0.2,
        condensed: 0.5,
        working: 0.8,
      });
    });

    it("throws on null options", () => {
      expect(() => new AdaptiveZoneManagerNamed(null)).toThrow();
    });
  });

  describe("getBoundaries", () => {
    it("returns a defensive copy", () => {
      const boundaries = manager.getBoundaries();
      boundaries.archive = 0.99;
      expect(manager.getBoundaries().archive).toBe(0.2);
    });
  });

  describe("getZone", () => {
    it("classifies boundary and extreme values", () => {
      const cases = [
        { value: -1, expected: "archive" },
        { value: 0, expected: "archive" },
        { value: 0.2, expected: "condensed" },
        { value: 0.5, expected: "working" },
        { value: 0.8, expected: "active" },
        { value: 1, expected: "active" },
        { value: Number.MAX_SAFE_INTEGER, expected: "active" },
      ];

      for (const { value, expected } of cases) {
        expect(manager.getZone(value)).toBe(expected);
      }
    });

    it("handles empty, blank, and string inputs", () => {
      const cases = [
        { value: null, expected: "archive" },
        { value: undefined, expected: "active" },
        { value: "", expected: "archive" },
        { value: "   ", expected: "archive" },
        { value: "0.51", expected: "working" },
        { value: "not-a-number", expected: "active" },
      ];

      for (const { value, expected } of cases) {
        expect(manager.getZone(value)).toBe(expected);
      }
    });
  });

  describe("getZoneConfig", () => {
    it("returns configs for known zones", () => {
      const cases = [
        {
          zone: "archive",
          compressionLevel: "heavy",
          preserveThinking: false,
          summarizeThinking: false,
        },
        {
          zone: "condensed",
          compressionLevel: "medium",
          preserveThinking: false,
          summarizeThinking: true,
        },
        {
          zone: "working",
          compressionLevel: "light",
          preserveThinking: true,
          summarizeThinking: false,
        },
        {
          zone: "active",
          compressionLevel: "none",
          preserveThinking: true,
          summarizeThinking: false,
        },
      ];

      for (const expected of cases) {
        const config = manager.getZoneConfig(expected.zone);
        expect(config.name).toBe(expected.zone);
        expect(config.compressionLevel).toBe(expected.compressionLevel);
        expect(config.preserveThinking).toBe(expected.preserveThinking);
        expect(config.summarizeThinking).toBe(expected.summarizeThinking);
      }
    });

    it("falls back to active for unknown or empty zones", () => {
      const unknown = manager.getZoneConfig("unknown");
      const empty = manager.getZoneConfig(undefined);
      expect(unknown.name).toBe("active");
      expect(empty.name).toBe("active");
    });

    it("uses current boundaries in config ranges", () => {
      manager.updateDensity("archive", 1000);
      manager.updateDensity("condensed", 10);
      manager.updateDensity("working", 10);
      manager.updateDensity("active", 10);

      const boundaries = manager.getBoundaries();
      const archiveConfig = manager.getZoneConfig("archive");
      const condensedConfig = manager.getZoneConfig("condensed");

      expect(archiveConfig.end).toBe(boundaries.archive);
      expect(condensedConfig.start).toBe(boundaries.archive);
      expect(condensedConfig.end).toBe(boundaries.condensed);
    });
  });

  describe("updateDensity", () => {
    it("ignores unknown or empty zones without changing boundaries", () => {
      const initial = manager.getBoundaries();
      manager.updateDensity("unknown", 100);
      manager.updateDensity("", 200);
      expect(manager.getBoundaries()).toEqual(initial);
    });

    it("ignores null or undefined zones without throwing", () => {
      const initial = manager.getBoundaries();
      expect(() => manager.updateDensity(null, 10)).not.toThrow();
      expect(() => manager.updateDensity(undefined, 10)).not.toThrow();
      expect(manager.getBoundaries()).toEqual(initial);
    });

    it("keeps boundaries unchanged for negative density values", () => {
      const initial = manager.getBoundaries();
      manager.updateDensity("archive", -1);
      expect(manager.getBoundaries()).toEqual(initial);
    });

    it("updates boundaries within limits for numeric strings and max values", () => {
      manager.updateDensity("archive", "1000");
      manager.updateDensity("condensed", Number.MAX_SAFE_INTEGER);
      manager.updateDensity("working", 1);
      manager.updateDensity("active", 1);

      const boundaries = manager.getBoundaries();
      expect(Number.isFinite(boundaries.archive)).toBe(true);
      expect(boundaries.archive).toBeGreaterThanOrEqual(0.1);
      expect(boundaries.archive).toBeLessThanOrEqual(0.3);
      expect(boundaries.condensed).toBeGreaterThanOrEqual(0.3);
      expect(boundaries.condensed).toBeLessThanOrEqual(0.6);
      expect(boundaries.working).toBeGreaterThanOrEqual(0.6);
      expect(boundaries.working).toBeLessThanOrEqual(0.85);
      expect(boundaries.condensed).toBeGreaterThan(boundaries.archive);
      expect(boundaries.working).toBeGreaterThan(boundaries.condensed);
    });

    it("handles rapid consecutive updates", () => {
      for (let i = 0; i < 25; i += 1) {
        manager.updateDensity("archive", 200 + i);
        manager.updateDensity("condensed", 150 + i);
      }

      const boundaries = manager.getBoundaries();
      expect(boundaries.archive).toBeGreaterThanOrEqual(0.1);
      expect(boundaries.condensed).toBeGreaterThan(boundaries.archive);
      expect(boundaries.working).toBeGreaterThan(boundaries.condensed);
    });

    it("supports concurrent-like updates", async () => {
      const zones = ["archive", "condensed", "working", "active"];
      await Promise.all(
        zones.map((zone, index) =>
          Promise.resolve().then(() => manager.updateDensity(zone, 100 + index))
        )
      );

      const boundaries = manager.getBoundaries();
      expect(boundaries.archive).toBeGreaterThan(0);
      expect(boundaries.condensed).toBeGreaterThan(boundaries.archive);
      expect(boundaries.working).toBeGreaterThan(boundaries.condensed);
    });
  });

  describe("getCompressionStrategy", () => {
    it("returns active when totalMessages is zero or negative", () => {
      const zero = manager.getCompressionStrategy(0, 0, 0.5);
      const negative = manager.getCompressionStrategy(0, -1, 0.5);
      expect(zero.zone).toBe("active");
      expect(zero.messageRatio).toBe(1);
      expect(negative.zone).toBe("active");
      expect(negative.messageRatio).toBe(1);
    });

    it("computes zones for early and late messages", () => {
      const early = manager.getCompressionStrategy(0, 10, 0.9);
      const late = manager.getCompressionStrategy(9, 10, 0.9);
      expect(early.zone).toBe("archive");
      expect(early.messageRatio).toBe(0);
      expect(late.zone).toBe("active");
      expect(late.messageRatio).toBe(0.9);
    });

    it("handles string inputs and non-numeric values", () => {
      const numeric = manager.getCompressionStrategy("1", "4", "0.8");
      expect(numeric.zone).toBe("condensed");
      expect(numeric.messageRatio).toBeCloseTo(0.25);

      const nonNumeric = manager.getCompressionStrategy("nope", 10, 0.8);
      expect(Number.isNaN(nonNumeric.messageRatio)).toBe(true);
      expect(nonNumeric.zone).toBe("active");
    });

    it("handles max safe indices", () => {
      const result = manager.getCompressionStrategy(
        Number.MAX_SAFE_INTEGER,
        Number.MAX_SAFE_INTEGER,
        1
      );
      expect(result.messageRatio).toBe(1);
      expect(result.zone).toBe("active");
    });
  });

  describe("computeStrategies", () => {
    it("returns empty list for empty messages array", () => {
      const strategies = manager.computeStrategies([], 0.5);
      expect(strategies).toEqual([]);
    });

    it("throws for non-array message inputs", () => {
      const cases = [null, undefined, "", {}];
      for (const value of cases) {
        expect(() => manager.computeStrategies(value, 0.5)).toThrow();
      }
    });

    it("handles large arrays with long strings and deep nesting", async () => {
      mockedFs.readFileSync.mockReturnValueOnce("x".repeat(200000));
      const { readFileSync } = await import("node:fs");
      const longText = readFileSync("large.txt", "utf8");

      const deepNested = {
        level1: {
          level2: {
            level3: {
              level4: {
                level5: { value: "deep" },
              },
            },
          },
        },
      };

      const messages = Array.from({ length: 5000 }, (_, index) => ({
        content: index === 0 ? longText : deepNested,
      }));

      const strategies = manager.computeStrategies(messages, 0.95);
      expect(strategies).toHaveLength(5000);
      expect(strategies[0].zone).toBe("archive");
      expect(strategies[strategies.length - 1].zone).toBe("active");
      expect(mockedFs.readFileSync).toHaveBeenCalledWith("large.txt", "utf8");
    });
  });

  describe("getZoneStats", () => {
    it("returns zeros for empty arrays", () => {
      const stats = manager.getZoneStats([], 0.9);
      expect(stats).toEqual({
        archive: 0,
        condensed: 0,
        working: 0,
        active: 0,
      });
    });

    it("counts zones and matches total message count", () => {
      const messages = Array.from({ length: 12 }, () => ({ content: "x" }));
      const stats = manager.getZoneStats(messages, 0.85);
      const total = stats.archive + stats.condensed + stats.working + stats.active;
      expect(total).toBe(12);
    });

    it("throws for non-array inputs", () => {
      expect(() => manager.getZoneStats({}, 0.5)).toThrow();
    });
  });

  describe("reset", () => {
    it("restores default boundaries after adjustments", () => {
      manager.updateDensity("archive", 1000);
      manager.updateDensity("condensed", 10);
      manager.updateDensity("working", 10);
      manager.updateDensity("active", 10);
      const adjusted = manager.getBoundaries();
      expect(adjusted.archive).not.toBe(0.2);

      manager.reset();
      expect(manager.getBoundaries()).toEqual({
        archive: 0.2,
        condensed: 0.5,
        working: 0.8,
      });
    });
  });
});

describe("default export", () => {
  it("re-exports AdaptiveZoneManager as default", () => {
    expect(AdaptiveZoneManager).toBe(AdaptiveZoneManagerNamed);
  });

  it("creates a working instance from default export", () => {
    const instance = new AdaptiveZoneManager();
    expect(instance.getZone(0.79)).toBe("working");
  });
});
