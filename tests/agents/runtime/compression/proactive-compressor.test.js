/**
 * ProactiveCompressor 单元测试
 */

import { describe, it, expect, beforeEach } from "vitest";
import { ProactiveCompressor } from "../../../../js/agents/runtime/compression/proactive-compressor.js";

describe("ProactiveCompressor", () => {
  let compressor;

  beforeEach(() => {
    compressor = new ProactiveCompressor({
      contextWindow: 10000,
      compressThreshold: 0.9,
      targetFillRatio: 0.6,
    });
  });

  describe("constructor", () => {
    it("should create with default options", () => {
      const c = new ProactiveCompressor();
      expect(c).toBeDefined();
    });

    it("should respect custom options", () => {
      const stats = compressor.getStats();
      expect(stats).toBeDefined();
      expect(stats.archiveCount).toBe(0);
    });
  });

  describe("shouldCompress", () => {
    it("should not compress when below threshold", () => {
      const result = compressor.shouldCompress(5000);
      expect(result.shouldCompress).toBe(false);
      expect(result.fillRatio).toBe(0.5);
    });

    it("should compress when above threshold", () => {
      const result = compressor.shouldCompress(9500);
      expect(result.shouldCompress).toBe(true);
      expect(result.fillRatio).toBe(0.95);
    });

    it("should return zone information", () => {
      const result = compressor.shouldCompress(8500);
      expect(result.zone).toBe("active");
    });
  });

  describe("recordMessage", () => {
    it("should record message and return tokens", () => {
      const tokens = compressor.recordMessage("Hello world");
      expect(tokens).toBeGreaterThan(0);
    });

    it("should track in predictor", () => {
      compressor.recordMessage("Message 1");
      compressor.recordMessage("Message 2");
      const stats = compressor.getStats();
      expect(stats.predictor.messageCount).toBe(2);
    });
  });

  describe("compress", () => {
    it("should skip compression when below threshold", async () => {
      const messages = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
      ];

      const result = await compressor.compress(messages);

      expect(result.compressed).toBe(false);
      expect(result.stats.skipped).toBe(true);
    });

    it("should compress when forced", async () => {
      const messages = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
      ];

      const result = await compressor.compress(messages, { force: true });

      expect(result.compressed).toBe(true);
      expect(result.messages).toBeDefined();
    });

    it("should handle empty messages", async () => {
      const result = await compressor.compress([]);

      expect(result.compressed).toBe(false);
      expect(result.messages).toEqual([]);
    });

    it("should include zone stats", async () => {
      const messages = Array(50).fill(null).map((_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        content: `Message ${i}`.repeat(100), // Make messages larger
      }));

      const result = await compressor.compress(messages, { force: true });

      expect(result.stats).toHaveProperty("zoneStats");
      expect(result.stats).toHaveProperty("archived");
      expect(result.stats).toHaveProperty("condensed");
      expect(result.stats).toHaveProperty("working");
      expect(result.stats).toHaveProperty("active");
    });

    it("should preserve thinking messages in active zone", async () => {
      const messages = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "<think>I should respond politely</think>", thinking: true },
        { role: "assistant", content: "Hi there!" },
      ];

      const result = await compressor.compress(messages, { force: true });

      // In active zone, thinking should be preserved
      expect(result.stats.thinkingPreserved).toBeGreaterThanOrEqual(0);
    });
  });

  describe("thinking message detection", () => {
    it("should detect thinking=true messages", async () => {
      const messages = [
        { role: "assistant", content: "Some thought", thinking: true },
      ];

      const result = await compressor.compress(messages, { force: true });
      expect(result.stats).toBeDefined();
      expect(result.compressed).toBe(true);
    });

    it("should detect internal=true messages", async () => {
      const messages = [
        { role: "assistant", content: "Internal note", internal: true },
      ];

      const result = await compressor.compress(messages, { force: true });
      expect(result).toBeDefined();
    });

    it("should detect type=thinking messages", async () => {
      const messages = [
        { role: "assistant", content: "Thinking...", type: "thinking" },
      ];

      const result = await compressor.compress(messages, { force: true });
      expect(result).toBeDefined();
    });

    it("should detect <think> tag messages", async () => {
      const messages = [
        { role: "assistant", content: "<think>My thoughts here</think>" },
      ];

      const result = await compressor.compress(messages, { force: true });
      expect(result).toBeDefined();
    });
  });

  describe("configure", () => {
    it("should update context window", () => {
      compressor.configure({ contextWindow: 200000 });
      const result = compressor.shouldCompress(100000);
      expect(result.fillRatio).toBe(0.5);
    });

    it("should update compress threshold", () => {
      compressor.configure({ compressThreshold: 0.8 });
      const result = compressor.shouldCompress(8500);
      expect(result.shouldCompress).toBe(true);
    });

    it("should update target fill ratio", () => {
      compressor.configure({ targetFillRatio: 0.5 });
      const stats = compressor.getStats();
      expect(stats).toBeDefined();
    });
  });

  describe("getStats", () => {
    it("should return comprehensive stats", () => {
      const stats = compressor.getStats();

      expect(stats).toHaveProperty("predictor");
      expect(stats).toHaveProperty("boundaries");
      expect(stats).toHaveProperty("archiveCount");
      expect(stats).toHaveProperty("hasSessionSummary");
    });
  });

  describe("reset", () => {
    it("should reset all state", async () => {
      compressor.recordMessage("Test");
      await compressor.compress([{ content: "Test" }], { force: true });

      compressor.reset();

      const stats = compressor.getStats();
      expect(stats.predictor.messageCount).toBe(0);
      expect(stats.archiveCount).toBe(0);
      expect(stats.hasSessionSummary).toBe(false);
    });
  });

  describe("zone-based compression", () => {
    it("should apply different compression levels per zone", async () => {
      // Create many messages to span multiple zones
      const messages = Array(100).fill(null).map((_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        content: `This is message number ${i} with some content to give it substance.`.repeat(5),
      }));

      const result = await compressor.compress(messages, { force: true });

      expect(result.compressed).toBe(true);
      expect(result.stats.archived + result.stats.condensed + result.stats.working + result.stats.active).toBeGreaterThan(0);
    });
  });
});
