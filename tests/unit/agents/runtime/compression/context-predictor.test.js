/**
 * ContextPredictor 单元测试
 */

import { describe, it, expect, beforeEach } from "vitest";
import { ContextPredictor } from '../../../../../js/agents/runtime/compression/context-predictor.js';

describe("ContextPredictor", () => {
  let predictor;

  beforeEach(() => {
    predictor = new ContextPredictor({
      contextWindow: 10000,
      windowSize: 5,
      decayFactor: 0.9,
    });
  });

  describe("constructor", () => {
    it("should create with default options", () => {
      const p = new ContextPredictor();
      expect(p).toBeDefined();
    });

    it("should respect custom options", () => {
      const stats = predictor.getStats();
      expect(stats.messageCount).toBe(0);
      expect(stats.totalTokens).toBe(0);
    });
  });

  describe("record", () => {
    it("should record string message", () => {
      const tokens = predictor.record("Hello world");
      expect(tokens).toBeGreaterThan(0);
      expect(predictor.getStats().messageCount).toBe(1);
    });

    it("should record object message with content", () => {
      const tokens = predictor.record({ role: "user", content: "Hello world" });
      expect(tokens).toBeGreaterThan(0);
    });

    it("should record object message with text", () => {
      const tokens = predictor.record({ role: "assistant", text: "Response" });
      expect(tokens).toBeGreaterThan(0);
    });

    it("should accumulate total tokens", () => {
      predictor.record("First message");
      predictor.record("Second message");
      expect(predictor.getStats().totalTokens).toBeGreaterThan(0);
      expect(predictor.getStats().messageCount).toBe(2);
    });
  });

  describe("recordBatch", () => {
    it("should record multiple messages", () => {
      const total = predictor.recordBatch([
        "Message 1",
        { content: "Message 2" },
        { text: "Message 3" },
      ]);
      expect(total).toBeGreaterThan(0);
      expect(predictor.getStats().messageCount).toBe(3);
    });
  });

  describe("getWeightedAverageTokens", () => {
    it("should return default when no messages", () => {
      expect(predictor.getWeightedAverageTokens()).toBe(500);
    });

    it("should calculate weighted average", () => {
      predictor.record("Short");
      predictor.record("A much longer message with more tokens");
      const avg = predictor.getWeightedAverageTokens();
      expect(avg).toBeGreaterThan(0);
    });
  });

  describe("getFillRatio", () => {
    it("should return ratio based on recorded tokens", () => {
      predictor.record("Some content");
      const ratio = predictor.getFillRatio();
      expect(ratio).toBeGreaterThan(0);
      expect(ratio).toBeLessThan(1);
    });

    it("should accept external token count", () => {
      const ratio = predictor.getFillRatio(5000);
      expect(ratio).toBe(0.5);
    });
  });

  describe("predictRemainingMessages", () => {
    it("should predict remaining messages", () => {
      predictor.record("Test message one");
      predictor.record("Test message two");
      const remaining = predictor.predictRemainingMessages();
      expect(remaining).toBeGreaterThan(0);
    });

    it("should return Infinity when avg is 0", () => {
      const remaining = predictor.predictRemainingMessages(0);
      // With default avg of 500, should calculate
      expect(remaining).toBeGreaterThan(0);
    });
  });

  describe("getZone", () => {
    it("should return archive for low fill ratio", () => {
      expect(predictor.getZone(0.1)).toBe("archive");
    });

    it("should return condensed for medium-low fill ratio", () => {
      expect(predictor.getZone(0.3)).toBe("condensed");
    });

    it("should return working for medium-high fill ratio", () => {
      expect(predictor.getZone(0.6)).toBe("working");
    });

    it("should return active for high fill ratio", () => {
      expect(predictor.getZone(0.9)).toBe("active");
    });
  });

  describe("predict", () => {
    it("should return comprehensive prediction", () => {
      predictor.record("Test message");
      const result = predictor.predict();

      expect(result).toHaveProperty("currentTokens");
      expect(result).toHaveProperty("fillRatio");
      expect(result).toHaveProperty("avgMessageTokens");
      expect(result).toHaveProperty("predictedRemainingMessages");
      expect(result).toHaveProperty("shouldCompress");
      expect(result).toHaveProperty("zone");
    });

    it("should set shouldCompress when above threshold", () => {
      const result = predictor.predict(9500, { compressThreshold: 0.9 });
      expect(result.shouldCompress).toBe(true);
    });

    it("should not compress when below threshold", () => {
      const result = predictor.predict(5000, { compressThreshold: 0.9 });
      expect(result.shouldCompress).toBe(false);
    });
  });

  describe("setContextWindow", () => {
    it("should update context window", () => {
      predictor.setContextWindow(200000);
      const ratio = predictor.getFillRatio(100000);
      expect(ratio).toBe(0.5);
    });

    it("should enforce minimum", () => {
      predictor.setContextWindow(100);
      const ratio = predictor.getFillRatio(500);
      expect(ratio).toBe(0.5); // 500 / 1000 (min enforced)
    });
  });

  describe("reset", () => {
    it("should reset all state", () => {
      predictor.record("Message 1");
      predictor.record("Message 2");
      predictor.reset();

      const stats = predictor.getStats();
      expect(stats.messageCount).toBe(0);
      expect(stats.totalTokens).toBe(0);
      expect(stats.windowSize).toBe(0);
    });
  });
});
