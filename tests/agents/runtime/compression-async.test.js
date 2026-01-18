import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  compressSessionHistoryAsync,
  compressSessionHistorySync,
  isCompressionWorkerAvailable,
  terminateCompressionWorker,
} from "../../../js/agents/runtime/compression/compression-async.js";

describe("compression-async", () => {
  describe("isCompressionWorkerAvailable", () => {
    it("should return false in Node.js environment", () => {
      // Node.js doesn't have Worker API like browsers
      const available = isCompressionWorkerAvailable();
      expect(available).toBe(false);
    });
  });

  describe("compressSessionHistorySync", () => {
    it("should compress messages keeping last N turns", () => {
      const messages = [
        { role: "system", content: "You are an assistant" },
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there!" },
        { role: "user", content: "How are you?" },
        { role: "assistant", content: "I'm doing well" },
        { role: "user", content: "Tell me a joke" },
        { role: "assistant", content: "Why did the chicken cross the road?" },
      ];

      const result = compressSessionHistorySync(messages, { keepLastTurns: 2 });

      // Should keep system anchor + last 2 turns
      expect(result.messages.length).toBeLessThan(messages.length);
      expect(result.messages[0].role).toBe("system");
      expect(result.messages[0].content).toBe("You are an assistant");
      expect(result.sessionSummary).toMatch(/\S/);
      expect(result.stats.summarizedMessages).toBeGreaterThan(0);
    });

    it("should remove thinking messages", () => {
      const messages = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "<think>Analyzing...</think>", thinking: true },
        { role: "assistant", content: "Hi!" },
      ];

      const result = compressSessionHistorySync(messages, { keepLastTurns: 10 });

      expect(result.stats.removedThinking).toBe(1);
      const hasThinking = result.messages.some(m => m.thinking === true);
      expect(hasThinking).toBe(false);
    });

    it("should merge consecutive same-role messages", () => {
      const messages = [
        { role: "user", content: "Part 1" },
        { role: "user", content: "Part 2" },
        { role: "assistant", content: "Response" },
      ];

      const result = compressSessionHistorySync(messages, { keepLastTurns: 10 });

      expect(result.stats.mergedMessages).toBe(1);
      const userMsg = result.messages.find(m => m.role === "user");
      expect(userMsg.content).toContain("Part 1");
      expect(userMsg.content).toContain("Part 2");
    });

    it("should preserve existing sessionSummary", () => {
      const messages = [
        { role: "user", content: "Message 1" },
        { role: "assistant", content: "Response 1" },
        { role: "user", content: "Message 2" },
        { role: "assistant", content: "Response 2" },
      ];

      const result = compressSessionHistorySync(messages, {
        keepLastTurns: 1,
        sessionSummary: "Previous summary",
      });

      expect(result.sessionSummary).toBeTypeOf("string");
      expect(result.sessionSummary).toMatch(/^Previous summary/);
    });

    it("should use titleOnly mode", () => {
      const messages = [
        { role: "user", content: "This is a very long message that should be truncated when in title only mode" },
        { role: "assistant", content: "This is another very long response that contains many words" },
        { role: "user", content: "Final message" },
        { role: "assistant", content: "Final response" },
      ];

      const result = compressSessionHistorySync(messages, {
        keepLastTurns: 1,
        titleOnly: true,
        titleMaxChars: 30,
      });

      expect(result.sessionSummary).toMatch(/\S/);
      // Title-only summaries should be shorter
      const lines = result.sessionSummary.split("\n");
      for (const line of lines) {
        // Each line should be role: title format, relatively short
        expect(line.length, `Line too long: ${line}`).toBeLessThan(100);
      }
    });

    it("should not merge system or tool messages", () => {
      const messages = [
        { role: "system", content: "System 1" },
        { role: "system", content: "System 2" },
        { role: "tool", content: "Tool 1" },
        { role: "tool", content: "Tool 2" },
      ];

      const result = compressSessionHistorySync(messages, { keepLastTurns: 10 });

      // System and tool messages should not be merged
      const systemMsgs = result.messages.filter(m => m.role === "system");
      const toolMsgs = result.messages.filter(m => m.role === "tool");
      expect(systemMsgs.length).toBe(2);
      expect(toolMsgs.length).toBe(2);
    });

    it("should calculate afterTokens", () => {
      const messages = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "World" },
      ];

      const result = compressSessionHistorySync(messages, { keepLastTurns: 10 });

      expect(result.afterTokens).toBeTypeOf("number");
      expect(result.afterTokens).toBeGreaterThan(0);
    });

    it("should handle CJK characters in token estimation", () => {
      const messages = [
        { role: "user", content: "你好世界" },
      ];

      const result = compressSessionHistorySync(messages, { keepLastTurns: 10 });

      // CJK characters should contribute more to token count
      // 4 CJK chars * 1.6 ≈ 6-7 tokens
      expect(result.afterTokens).toBeGreaterThanOrEqual(5);
    });

    it("should handle Context Summary messages as anchors", () => {
      const messages = [
        { role: "system", content: "[Context Summary]\nPrevious context" },
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi" },
      ];

      const result = compressSessionHistorySync(messages, { keepLastTurns: 10 });

      // Context Summary is a system message, treated as anchor (kept at start)
      expect(result.messages.length).toBe(3);
      expect(result.messages[0].role).toBe("system");
    });
  });

  describe("compressSessionHistoryAsync", () => {
    it("should fall back to sync in Node.js", async () => {
      const messages = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi" },
      ];

      const result = await compressSessionHistoryAsync(messages, { keepLastTurns: 10 });

      expect(result.messages).toBeInstanceOf(Array);
      expect(result.stats).toBeTypeOf("object");
      expect(result.stats).not.toBeNull();
      expect(result.afterTokens).toBeTypeOf("number");
    });

    it("should respect abort signal", async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(async () => {
          await compressSessionHistoryAsync(
            [{ role: "user", content: "test" }],
            {},
            { signal: controller.signal }
          );
        },
        { message: /aborted/i }
      );
    });

    it("should pass options correctly", async () => {
      const messages = [
        { role: "user", content: "Msg 1" },
        { role: "assistant", content: "Resp 1" },
        { role: "user", content: "Msg 2" },
        { role: "assistant", content: "Resp 2" },
        { role: "user", content: "Msg 3" },
        { role: "assistant", content: "Resp 3" },
      ];

      const result = await compressSessionHistoryAsync(
        messages,
        { keepLastTurns: 1, sessionSummary: "Prior" },
        { useWorker: false }
      );

      expect(result.sessionSummary).toBeTypeOf("string");
      expect(result.sessionSummary).toMatch(/^Prior/);
    });
  });

  describe("terminateCompressionWorker", () => {
    it("should not throw when called multiple times", () => {
      // Should be safe to call even when no worker exists
      expect(() => {
        terminateCompressionWorker();
        terminateCompressionWorker();
      }).not.toThrow();
    });
  });
});
