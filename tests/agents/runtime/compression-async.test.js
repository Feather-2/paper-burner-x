import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
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
      assert.strictEqual(available, false);
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
      assert.ok(result.messages.length < messages.length);
      assert.strictEqual(result.messages[0].role, "system");
      assert.strictEqual(result.messages[0].content, "You are an assistant");
      assert.ok(result.sessionSummary);
      assert.ok(result.stats.summarizedMessages > 0);
    });

    it("should remove thinking messages", () => {
      const messages = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "<think>Analyzing...</think>", thinking: true },
        { role: "assistant", content: "Hi!" },
      ];

      const result = compressSessionHistorySync(messages, { keepLastTurns: 10 });

      assert.strictEqual(result.stats.removedThinking, 1);
      const hasThinking = result.messages.some(m => m.thinking === true);
      assert.strictEqual(hasThinking, false);
    });

    it("should merge consecutive same-role messages", () => {
      const messages = [
        { role: "user", content: "Part 1" },
        { role: "user", content: "Part 2" },
        { role: "assistant", content: "Response" },
      ];

      const result = compressSessionHistorySync(messages, { keepLastTurns: 10 });

      assert.strictEqual(result.stats.mergedMessages, 1);
      const userMsg = result.messages.find(m => m.role === "user");
      assert.ok(userMsg.content.includes("Part 1"));
      assert.ok(userMsg.content.includes("Part 2"));
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

      assert.ok(result.sessionSummary);
      assert.ok(result.sessionSummary.startsWith("Previous summary"));
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

      assert.ok(result.sessionSummary);
      // Title-only summaries should be shorter
      const lines = result.sessionSummary.split("\n");
      for (const line of lines) {
        // Each line should be role: title format, relatively short
        assert.ok(line.length < 100, `Line too long: ${line}`);
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
      assert.strictEqual(systemMsgs.length, 2);
      assert.strictEqual(toolMsgs.length, 2);
    });

    it("should calculate afterTokens", () => {
      const messages = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "World" },
      ];

      const result = compressSessionHistorySync(messages, { keepLastTurns: 10 });

      assert.ok(typeof result.afterTokens === "number");
      assert.ok(result.afterTokens > 0);
    });

    it("should handle CJK characters in token estimation", () => {
      const messages = [
        { role: "user", content: "你好世界" },
      ];

      const result = compressSessionHistorySync(messages, { keepLastTurns: 10 });

      // CJK characters should contribute more to token count
      // 4 CJK chars * 1.6 ≈ 6-7 tokens
      assert.ok(result.afterTokens >= 5);
    });

    it("should handle Context Summary messages as anchors", () => {
      const messages = [
        { role: "system", content: "[Context Summary]\nPrevious context" },
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi" },
      ];

      const result = compressSessionHistorySync(messages, { keepLastTurns: 10 });

      // Context Summary is a system message, treated as anchor (kept at start)
      assert.strictEqual(result.messages.length, 3);
      assert.strictEqual(result.messages[0].role, "system");
    });
  });

  describe("compressSessionHistoryAsync", () => {
    it("should fall back to sync in Node.js", async () => {
      const messages = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi" },
      ];

      const result = await compressSessionHistoryAsync(messages, { keepLastTurns: 10 });

      assert.ok(Array.isArray(result.messages));
      assert.ok(typeof result.stats === "object");
      assert.ok(typeof result.afterTokens === "number");
    });

    it("should respect abort signal", async () => {
      const controller = new AbortController();
      controller.abort();

      await assert.rejects(
        async () => {
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

      assert.ok(result.sessionSummary);
      assert.ok(result.sessionSummary.startsWith("Prior"));
    });
  });

  describe("terminateCompressionWorker", () => {
    it("should not throw when called multiple times", () => {
      // Should be safe to call even when no worker exists
      assert.doesNotThrow(() => {
        terminateCompressionWorker();
        terminateCompressionWorker();
      });
    });
  });
});
