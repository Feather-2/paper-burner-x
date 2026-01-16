import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

import MessageManager from "../../../../js/agents/runtime/core/message-manager.js";

describe("runtime/core/message-manager", () => {
  describe("constructor", () => {
    it("initializes with default values", () => {
      const m = new MessageManager();
      assert.deepEqual(m.messages, []);
      assert.deepEqual(m.tokenUsage, { input: 0, output: 0, total: 0 });
      assert.ok(m.contextConfig.contextWindow > 0);
    });

    it("accepts custom contextConfig", () => {
      const m = new MessageManager({
        contextConfig: { contextWindow: 50000 },
      });
      assert.equal(m.contextConfig.contextWindow, 50000);
    });

    it("accepts null tokenCounter", () => {
      const m = new MessageManager({ tokenCounter: null });
      assert.deepEqual(m.messages, []);
    });

    it("sets asyncSummaryEnabled based on option", () => {
      const m1 = new MessageManager({ asyncSummaryEnabled: false });
      assert.equal(m1._asyncSummaryEnabled, false);

      const m2 = new MessageManager({ asyncSummaryEnabled: true });
      assert.equal(m2._asyncSummaryEnabled, true);

      // default is true when not explicitly set to false
      const m3 = new MessageManager({});
      assert.equal(m3._asyncSummaryEnabled, true);
    });
  });

  describe("addMessage", () => {
    it("adds message to messages array", () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({
        tokenCounter,
        contextConfig: { contextWindow: 100, compressThreshold: 0.9, compressCooldownMs: 0 },
        asyncSummaryEnabled: false,
      });

      const msg = { role: "user", content: "Hello" };
      const returned = manager.addMessage(msg);

      assert.equal(manager.messages.length, 1);
      assert.equal(manager.messages[0], msg);
      assert.equal(returned, msg);
    });

    it("updates token usage", () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({
        tokenCounter,
        contextConfig: { contextWindow: 1000, compressThreshold: 0.9, compressCooldownMs: 0 },
        asyncSummaryEnabled: false,
      });

      manager.addMessage({ role: "user", content: "Hello world" });

      const usage = manager.tokenUsage;
      assert.ok(usage.input > 0);
      assert.ok(usage.total > 0);
      assert.equal(usage.input, 11); // "Hello world".length
    });

    it("caches token count on message", () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({
        tokenCounter,
        contextConfig: { contextWindow: 1000, compressThreshold: 0.9, compressCooldownMs: 0 },
        asyncSummaryEnabled: false,
      });

      const msg = { role: "user", content: "Test message" };
      manager.addMessage(msg);

      assert.ok(typeof msg._tokens === "number");
      assert.ok(msg._tokens > 0);
      assert.ok(typeof msg._contentHash === "number");
    });

    it("handles null content gracefully", () => {
      const tokenCounter = { count: (text) => (text ? text.length : 0) };
      const manager = new MessageManager({
        tokenCounter,
        contextConfig: { contextWindow: 1000, compressThreshold: 0.9, compressCooldownMs: 0 },
        asyncSummaryEnabled: false,
      });

      const msg = { role: "user", content: null };
      manager.addMessage(msg);

      assert.equal(manager.messages.length, 1);
      assert.equal(msg._tokens, 0);
    });

    it("handles object content", () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({
        tokenCounter,
        contextConfig: { contextWindow: 1000, compressThreshold: 0.9, compressCooldownMs: 0 },
        asyncSummaryEnabled: false,
      });

      const msg = { role: "user", content: { key: "value", nested: { a: 1 } } };
      manager.addMessage(msg);

      assert.ok(msg._tokens > 0);
    });
  });

  describe("addMessages", () => {
    it("adds multiple messages", () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({
        tokenCounter,
        contextConfig: { contextWindow: 1000, compressThreshold: 0.9, compressCooldownMs: 0 },
        asyncSummaryEnabled: false,
      });

      const msgs = [
        { role: "user", content: "First" },
        { role: "assistant", content: "Second" },
      ];
      manager.addMessages(msgs);

      assert.equal(manager.messages.length, 2);
    });

    it("updates token usage for all messages", () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({
        tokenCounter,
        contextConfig: { contextWindow: 1000, compressThreshold: 0.9, compressCooldownMs: 0 },
        asyncSummaryEnabled: false,
      });

      manager.addMessages([
        { role: "user", content: "Hello" },
        { role: "assistant", content: "World" },
      ]);

      const usage = manager.tokenUsage;
      assert.equal(usage.input, 10); // "Hello".length + "World".length
    });

    it("does nothing when disposed", () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({
        tokenCounter,
        contextConfig: { contextWindow: 100, compressThreshold: 0.1, compressCooldownMs: 0 },
      });

      manager.dispose();
      manager.addMessages([{ role: "user", content: "Test" }]);

      assert.equal(manager.messages.length, 0);
    });
  });

  describe("dispose", () => {
    it("ignores message additions after dispose()", () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({
        tokenCounter,
        contextConfig: { contextWindow: 100, compressThreshold: 0.1, compressCooldownMs: 0 },
      });

      manager.dispose();

      manager.addMessage({ role: "user", content: "hello" });
      manager.addMessages([{ role: "user", content: "world" }]);

      assert.deepEqual(manager.messages, []);
      assert.deepEqual(manager.tokenUsage, { input: 0, output: 0, total: 0 });
    });

    it("is idempotent", () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({ tokenCounter });

      manager.dispose();
      manager.dispose();

      assert.equal(manager._disposed, true);
    });
  });

  describe("reset", () => {
    it("reset() clears compression history by default", async () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({
        tokenCounter,
        contextConfig: { contextWindow: 100, compressThreshold: 0.9, compressCooldownMs: 0 },
      });

      // Seed internal history to validate default clear semantics.
      manager._compressionHistory.push({
        timestamp: 1,
        beforeCount: 1,
        afterCount: 1,
        beforeTokens: 10,
        afterTokens: 10,
      });
      manager.addMessage({ role: "user", content: "hello" });
      assert.equal(manager.getStatus().compressionCount, 1);

      await manager.reset();
      assert.deepEqual(manager.messages, []);
      assert.deepEqual(manager.tokenUsage, { input: 0, output: 0, total: 0 });
      assert.equal(manager.getStatus().compressionCount, 0);
    });

    it("preserves compression history when requested", async () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({
        tokenCounter,
        contextConfig: { contextWindow: 100, compressThreshold: 0.9, compressCooldownMs: 0 },
      });

      manager._compressionHistory.push({ timestamp: Date.now() });
      await manager.reset({ clearCompressionHistory: false });

      assert.equal(manager.getStatus().compressionCount, 1);
    });

    it("reset() clears pending summary tracking", async () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({
        tokenCounter,
        asyncSummaryEnabled: true,
        contextConfig: { contextWindow: 10000, compressThreshold: 0.9, compressCooldownMs: 0 },
      });

      // 添加长消息触发摘要
      const msg = { role: "assistant", content: "x".repeat(300), _tokens: 300 };
      manager.addMessage(msg);

      assert.ok(manager._pendingSummaryPromises.size > 0);

      await manager.reset();

      assert.equal(manager._pendingSummaryPromises.size, 0);
      assert.equal(manager._summaryAbortController, null);
    });
  });

  describe("_shouldCompress", () => {
    it("_shouldCompress() falls back to config threshold when coordinator is missing", () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({
        tokenCounter,
        contextConfig: { contextWindow: 10, compressThreshold: 0.5, compressCooldownMs: 0 },
      });

      // Force fallback path (no coordinator / shouldCompress method).
      manager._compressionCoordinator = null;
      manager._tokenUsage.total = 4;
      assert.equal(manager._shouldCompress(), false);
      manager._tokenUsage.total = 5;
      assert.equal(manager._shouldCompress(), true);
    });

    it("returns true when threshold exceeded", () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({
        tokenCounter,
        contextConfig: { contextWindow: 100, compressThreshold: 0.5, compressCooldownMs: 0 },
        asyncSummaryEnabled: false,
      });

      manager._compressionCoordinator = null;
      manager.addMessage({ role: "user", content: "x".repeat(60) });

      assert.equal(manager._shouldCompress(), true);
    });

    it("returns false below threshold", () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({
        tokenCounter,
        contextConfig: { contextWindow: 10000, compressThreshold: 0.9, compressCooldownMs: 0 },
        asyncSummaryEnabled: false,
      });

      manager._compressionCoordinator = null;
      manager.addMessage({ role: "user", content: "short" });

      assert.equal(manager._shouldCompress(), false);
    });
  });

  describe("contextConfig", () => {
    it("exposes contextConfig defensively (getter returns copy)", () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({
        tokenCounter,
        contextConfig: { contextWindow: 10, compressThreshold: 0.1, compressCooldownMs: 0 },
      });

      // Getter returns a copy (defensive).
      const cfg = manager.contextConfig;
      cfg.contextWindow = 999;
      assert.equal(manager.contextConfig.contextWindow, 10);
    });

    it("setContextConfig merges with existing config", () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({
        tokenCounter,
        contextConfig: { contextWindow: 1000, compressThreshold: 0.8 },
      });

      const original = manager.contextConfig.compressThreshold;
      manager.setContextConfig({ contextWindow: 200000 });

      assert.equal(manager.contextConfig.contextWindow, 200000);
      assert.equal(manager.contextConfig.compressThreshold, original);
    });

    it("setContextConfig(tokenCounter: null) disables custom token counting", () => {
      const tokenCounter = { count: () => 999 };
      const manager = new MessageManager({ tokenCounter });

      manager.setContextConfig({ tokenCounter: null });
      assert.equal(manager._tokenCounter, null);

      // Unrelated updates should not re-enable tokenCounter implicitly.
      manager.setContextConfig({ contextWindow: 42 });
      assert.equal(manager._tokenCounter, null);
    });
  });

  describe("getStatus", () => {
    it("returns comprehensive status object", () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({
        tokenCounter,
        contextConfig: { contextWindow: 1000, compressThreshold: 0.9 },
        asyncSummaryEnabled: false,
      });

      manager.addMessage({ role: "user", content: "Hello" });
      const status = manager.getStatus();

      assert.ok("messageCount" in status);
      assert.ok("tokenUsage" in status);
      assert.ok("contextWindow" in status);
      assert.ok("fillRatio" in status);
      assert.ok("compressThreshold" in status);
      assert.ok("needsCompression" in status);
      assert.ok("compressionPending" in status);
      assert.ok("compressionCount" in status);
    });

    it("calculates fillRatio correctly", () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({
        tokenCounter,
        contextConfig: { contextWindow: 1000, compressThreshold: 0.9 },
        asyncSummaryEnabled: false,
      });

      manager.addMessage({ role: "user", content: "x".repeat(100) });
      const status = manager.getStatus();

      assert.equal(status.fillRatio, 0.1); // 100/1000
    });
  });

  describe("abort handling", () => {
    it("_abortActiveCompression() tolerates abort() failures and always clears controller", () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({
        tokenCounter,
        contextConfig: { contextWindow: 100, compressThreshold: 0.9, compressCooldownMs: 0 },
      });

      let callCount = 0;
      const controller = {
        abort: () => {
          callCount++;
          throw new Error("abort blocked");
        },
      };
      manager._compressionAbortController = controller;

      assert.doesNotThrow(() => manager._abortActiveCompression("why"));
      assert.equal(callCount, 2);
      assert.equal(manager._compressionAbortController, null);
    });

    it("_isAbortError detects various abort patterns", () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({ tokenCounter });

      assert.equal(manager._isAbortError({ name: "AbortError" }), true);
      assert.equal(manager._isAbortError({ name: "CanceledError" }), true);
      assert.equal(manager._isAbortError({ name: "CancelledError" }), true);
      assert.equal(manager._isAbortError(new Error("operation was aborted")), true);
      assert.equal(manager._isAbortError(new Error("request canceled")), true);
      assert.equal(manager._isAbortError(new Error("was cancelled")), true);
      assert.equal(manager._isAbortError(new Error("network error")), false);
      assert.equal(manager._isAbortError(null), false);
      assert.equal(manager._isAbortError(undefined), false);
    });
  });

  describe("cooldown timer", () => {
    it("_clearCooldownTimer() tolerates clearTimeout errors", () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({
        tokenCounter,
        contextConfig: { contextWindow: 100, compressThreshold: 0.9, compressCooldownMs: 0 },
      });

      const original = globalThis.clearTimeout;
      globalThis.clearTimeout = () => {
        throw new Error("clearTimeout failed");
      };

      try {
        manager._compressionCooldownTimer = 123;
        assert.doesNotThrow(() => manager._clearCooldownTimer());
        assert.equal(manager._compressionCooldownTimer, null);
      } finally {
        globalThis.clearTimeout = original;
      }
    });

    it("_clearCooldownTimer handles null timer", () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({ tokenCounter });

      manager._compressionCooldownTimer = null;
      assert.doesNotThrow(() => manager._clearCooldownTimer());
    });
  });

  describe("compression scheduling", () => {
    it("_scheduleCompression() logs non-abort errors from _compress()", async () => {
      const warnCalls = [];
      const logger = { warn: (...args) => warnCalls.push(args) };
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({
        logger,
        tokenCounter,
        contextConfig: { contextWindow: 100, compressThreshold: 0.1, compressCooldownMs: 0 },
      });

      const originalCompress = manager._compress;
      manager._compress = async () => {
        throw new Error("boom");
      };

      manager._compressionCoordinator.shouldCompress = () => true;
      manager._scheduleCompression({ force: true });

      const pending = manager._compressionPromise;
      assert.notEqual(pending, null);
      await pending;

      assert.equal(warnCalls.length, 1);
      assert.equal(warnCalls[0][0], "Message compression error");
      assert.equal(warnCalls[0][1].error, "boom");

      manager._compress = originalCompress;
    });

    it("_scheduleCompression returns early when disposed", () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({
        tokenCounter,
        contextConfig: { contextWindow: 100, compressThreshold: 0.1, compressCooldownMs: 0 },
      });

      manager.dispose();
      manager._scheduleCompression({ force: true });

      assert.equal(manager._compressionPending, false);
    });

    it("_scheduleCompression returns early when already pending", () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({
        tokenCounter,
        contextConfig: { contextWindow: 100, compressThreshold: 0.1, compressCooldownMs: 0 },
      });

      manager._compressionPending = true;
      manager._scheduleCompression({ force: true });

      // Should not create new promise
      assert.equal(manager._compressionPromise, null);
    });

    it("_scheduleCompression honors compressCooldownMs and defers compression", async () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({
        tokenCounter,
        contextConfig: { contextWindow: 100, compressThreshold: 0.1, compressCooldownMs: 25 },
      });

      let compressCalls = 0;
      manager._compress = async () => {
        compressCalls += 1;
      };
      manager._compressionCoordinator.shouldCompress = () => true;

      manager._lastCompressionAtMs = Date.now();
      manager._scheduleCompression();

      assert.equal(manager._compressionPending, false);
      assert.ok(manager._compressionCooldownTimer);

      await new Promise((resolve) => setTimeout(resolve, 40));
      if (manager._compressionPromise) {
        await manager._compressionPromise;
      }

      assert.equal(compressCalls, 1);
      assert.equal(manager._compressionCooldownTimer, null);
    });
  });

  describe("_compress flow", () => {
    it("_compress() replaces messages, recalculates tokens, and records compression", async () => {
      const emitCalls = [];
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({
        emit: (name, payload) => emitCalls.push({ name, payload }),
        stageName: "demo",
        actor: "tester",
        tokenCounter,
        contextConfig: { contextWindow: 1000, compressThreshold: 0.9, compressCooldownMs: 0 },
        asyncSummaryEnabled: false,
      });

      manager.addMessages([
        { role: "user", content: "hello" },
        { role: "assistant", content: "world" },
        { role: "assistant", content: "!!!" },
      ]);

      const beforeTokens = manager.tokenUsage.total;
      const beforeCount = manager.messages.length;

      let capturedSignal = null;
      manager._compressionCoordinator.maybeCompress = async (messages, { signal }) => {
        capturedSignal = signal;
        return {
          messages: [messages[0], { role: "assistant", content: "summary" }],
        };
      };

      await manager._compress();

      assert.equal(manager.messages.length, 2);
      assert.equal(manager.messages[1].content, "summary");
      assert.ok(manager.tokenUsage.total < beforeTokens);
      assert.equal(manager._compressionHistory.length, 1);
      const record = manager._compressionHistory[0];
      assert.equal(record.beforeCount, beforeCount);
      assert.equal(record.afterCount, 2);
      assert.equal(record.beforeTokens, beforeTokens);
      assert.equal(record.afterTokens, manager.tokenUsage.total);
      assert.ok(capturedSignal && typeof capturedSignal.aborted === "boolean");
      assert.equal(manager._compressionAbortController, null);
      assert.equal(emitCalls.length, 1);
      assert.equal(emitCalls[0].name, "demo.context.compressed");
    });

    it("_compress() keeps messages when maybeCompress returns null", async () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({
        tokenCounter,
        contextConfig: { contextWindow: 1000, compressThreshold: 0.9, compressCooldownMs: 0 },
        asyncSummaryEnabled: false,
      });

      manager.addMessages([
        { role: "user", content: "hello" },
        { role: "assistant", content: "world" },
      ]);

      const beforeMessages = manager.messages.slice();
      const beforeTokens = manager.tokenUsage.total;

      manager._compressionCoordinator.maybeCompress = async () => null;

      await manager._compress();

      assert.deepEqual(manager.messages, beforeMessages);
      assert.equal(manager.tokenUsage.total, beforeTokens);
      assert.equal(manager._compressionHistory.length, 1);
      const record = manager._compressionHistory[0];
      assert.equal(record.beforeCount, beforeMessages.length);
      assert.equal(record.afterCount, beforeMessages.length);
    });

    it("_compress() aborts without recording when compression is canceled", async () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({
        tokenCounter,
        contextConfig: { contextWindow: 1000, compressThreshold: 0.9, compressCooldownMs: 0 },
        asyncSummaryEnabled: false,
      });

      manager.addMessages([
        { role: "user", content: "hello" },
        { role: "assistant", content: "world" },
        { role: "assistant", content: "again" },
      ]);

      const beforeMessages = manager.messages.slice();
      const beforeTokens = manager.tokenUsage.total;
      let sawAbort = false;

      manager._compressionCoordinator.maybeCompress = async (messages, { signal }) => {
        manager._abortActiveCompression("manual");
        sawAbort = signal.aborted;
        return { messages: messages.slice(1) };
      };

      await manager._compress();

      assert.equal(sawAbort, true);
      assert.deepEqual(manager.messages, beforeMessages);
      assert.equal(manager.tokenUsage.total, beforeTokens);
      assert.equal(manager._compressionHistory.length, 0);
      assert.equal(manager._compressionAbortController, null);
    });
  });

  describe("_recordCompression", () => {
    it("records compression metrics and emits an event", () => {
      const emitCalls = [];
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({
        emit: (name, payload) => emitCalls.push({ name, payload }),
        stageName: "demo",
        actor: "tester",
        tokenCounter,
        contextConfig: { contextWindow: 1000, compressThreshold: 0.9, compressCooldownMs: 0 },
      });

      manager.addMessages([
        { role: "user", content: "hi" },
        { role: "assistant", content: "yo" },
      ]);

      manager._recordCompression(3, 9);

      assert.equal(manager._compressionHistory.length, 1);
      const record = manager._compressionHistory[0];
      assert.equal(record.beforeCount, 3);
      assert.equal(record.afterCount, 2);
      assert.equal(record.beforeTokens, 9);
      assert.equal(record.afterTokens, manager.tokenUsage.total);
      assert.ok(typeof record.timestamp === "number");
      assert.equal(emitCalls.length, 1);
      assert.equal(emitCalls[0].name, "demo.context.compressed");
      assert.equal(emitCalls[0].payload.actor, "tester");
      assert.equal(emitCalls[0].payload.status, "info");
      assert.equal(emitCalls[0].payload.payload, record);
    });
  });

  describe("flushCompression", () => {
    it("flushCompression() runs bounded rounds and records compressions", async () => {
      const emitCalls = [];
      const emit = (name, payload) => emitCalls.push({ name, payload });
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({
        emit,
        stageName: "demo",
        actor: "bob",
        tokenCounter,
        contextConfig: { contextWindow: 100, compressThreshold: 0.1, compressCooldownMs: 0 },
      });

      manager._compressionCoordinator.shouldCompress = () => manager._messages.length > 1;
      manager._compressionCoordinator.maybeCompress = async (messages) => ({ messages: messages.slice(1) });

      manager.addMessages([
        { role: "user", content: "a" },
        { role: "assistant", content: "b" },
        { role: "assistant", content: "c" },
      ]);

      await manager.flushCompression({ maxRounds: 2 });
      assert.equal(manager.messages.length, 1);
      assert.equal(manager.getStatus().compressionCount, 2);
      assert.ok(emitCalls.some(e => e.name === "demo.context.compressed"));
    });

    it("flushCompression() logs non-abort errors and suppresses abort-like errors", async () => {
      const warnCalls = [];
      const logger = { warn: (...args) => warnCalls.push(args) };
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({
        logger,
        tokenCounter,
        contextConfig: { contextWindow: 10, compressThreshold: 0.1, compressCooldownMs: 0 },
      });

      manager._compressionCoordinator.shouldCompress = () => true;
      manager._compressionCoordinator.maybeCompress = async () => {
        throw new Error("boom");
      };

      await manager.flushCompression({ maxRounds: 1 });
      assert.equal(warnCalls.length, 1);
      assert.equal(warnCalls[0][1].error, "boom");

      warnCalls.length = 0;
      manager._compressionCoordinator.maybeCompress = async () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        throw err;
      };
      await manager.flushCompression({ maxRounds: 1 });
      assert.equal(warnCalls.length, 0);
    });

    it("_compress() no-ops when maybeCompress is missing, and flushCompression() tolerates previous failures", async () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({
        tokenCounter,
        contextConfig: { contextWindow: 100, compressThreshold: 0.1, compressCooldownMs: 0 },
      });

      // Previous async compression failure should not break flushCompression.
      manager._compressionPromise = Promise.reject(new Error("previous"));
      await manager.flushCompression({ maxRounds: 0 });

      // No maybeCompress => _compress returns early.
      manager._compressionCoordinator.maybeCompress = null;
      manager.addMessages([{ role: "user", content: "hello" }]);
      await manager._compress();
      assert.equal(manager._compressionAbortController, null);
    });

    it("flushCompression does nothing when disposed", async () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({ tokenCounter });

      manager.dispose();
      await manager.flushCompression();
      // No exception means pass
    });

    it("flushCompression respects maxRounds even when still compressible", async () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({
        tokenCounter,
        contextConfig: { contextWindow: 100, compressThreshold: 0.1, compressCooldownMs: 0 },
      });

      manager._compressionCoordinator.shouldCompress = () => false;
      manager.addMessages([
        { role: "user", content: "one" },
        { role: "assistant", content: "two" },
        { role: "assistant", content: "three" },
        { role: "assistant", content: "four" },
      ]);

      manager._compressionCoordinator.shouldCompress = () => manager.messages.length > 1;
      let compressCalls = 0;
      manager._compressionCoordinator.maybeCompress = async (messages) => {
        compressCalls += 1;
        return { messages: messages.slice(1) };
      };

      await manager.flushCompression({ maxRounds: 2 });

      assert.equal(compressCalls, 2);
      assert.equal(manager.messages.length, 2);
      assert.equal(manager.getStatus().compressionCount, 2);
    });
  });

  describe("wrapToolOutput and cleanOldOutputs", () => {
    it("wrapToolOutput() and cleanOldOutputs() integrate persisted-output helpers", () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({
        tokenCounter,
        contextConfig: { contextWindow: 10_000, compressThreshold: 1, compressCooldownMs: 0 },
      });

      const small = manager.wrapToolOutput("small", { threshold: 1000 });
      assert.equal(small, "small");

      const large = manager.wrapToolOutput("x".repeat(50), { threshold: 10, previewSize: 5 });
      assert.ok(large.includes("<persisted-output>"));
      assert.ok(large.includes("</persisted-output>"));
      assert.ok(large.includes("xxxxx"));

      const p1 = "<persisted-output>one</persisted-output>";
      const p2 = "<persisted-output>two</persisted-output>";
      const p3 = "<persisted-output>three</persisted-output>";
      manager.addMessages([
        { role: "assistant", content: p1 },
        { role: "assistant", content: p2 },
        { role: "assistant", content: p3 },
        { role: "assistant", content: "hi" },
      ]);

      const before = manager.tokenUsage.total;
      manager.cleanOldOutputs(1);
      assert.equal(manager.messages[0].content, "[Old large output cleared to save context space]");
      assert.equal(manager.messages[1].content, "[Old large output cleared to save context space]");
      assert.equal(manager.messages[2].content, p3);
      assert.equal(manager.messages[3].content, "hi");

      const clearedLen = "[Old large output cleared to save context space]".length;
      const expected = clearedLen + clearedLen + p3.length + "hi".length;
      assert.equal(manager.tokenUsage.total, expected);
      assert.notEqual(manager.tokenUsage.total, before);
    });
  });

  // ==========================================================================
  // 异步摘要竞态条件修复测试
  // ==========================================================================

  describe("async summary race condition fixes", () => {
    it("_compress() waits for pending summaries before compression", async () => {
      const tokenCounter = { count: (text) => text.length };
      let summaryResolve;
      const summaryPromise = new Promise((resolve) => {
        summaryResolve = resolve;
      });

      const manager = new MessageManager({
        tokenCounter,
        asyncSummaryEnabled: true,
        summaryGenerator: async (msg) => {
          await summaryPromise;
          return `Summary of: ${msg.content}`;
        },
        contextConfig: { contextWindow: 10000, compressThreshold: 0.9, compressCooldownMs: 0 },
      });

      // 添加一条长消息触发异步摘要
      const msg = { role: "assistant", content: "x".repeat(300), _tokens: 300 };
      manager.addMessage(msg);

      // 此时摘要尚未完成
      assert.equal(msg._summary, undefined);
      assert.equal(manager._pendingSummaryPromises.size, 1);

      // 启动压缩（会等待摘要）
      const compressPromise = manager._compress();

      // 摘要仍未完成
      assert.equal(msg._summary, undefined);

      // 完成摘要生成
      summaryResolve();

      // 等待压缩完成
      await compressPromise;

      // 摘要应该已生成
      assert.equal(msg._summary, "Summary of: " + "x".repeat(300));
    });

    it("dispose() cancels pending summaries via AbortController", async () => {
      const tokenCounter = { count: (text) => text.length };

      const manager = new MessageManager({
        tokenCounter,
        asyncSummaryEnabled: true,
        summaryGenerator: async () => {
          // 模拟长时间操作
          await new Promise((resolve) => setTimeout(resolve, 1000));
          return "summary";
        },
        contextConfig: { contextWindow: 10000, compressThreshold: 0.9, compressCooldownMs: 0 },
      });

      // 添加长消息触发摘要
      const msg = { role: "assistant", content: "x".repeat(300), _tokens: 300 };
      manager.addMessage(msg);

      // 等待摘要开始
      await new Promise((resolve) => setTimeout(resolve, 10));

      // dispose 应该取消摘要
      manager.dispose();

      assert.equal(manager._summaryAbortController, null);
      assert.equal(manager._pendingSummaryPromises.size, 0);
    });

    it("_abortPendingSummaries() tolerates abort() failures", () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({
        tokenCounter,
        contextConfig: { contextWindow: 100, compressThreshold: 0.9, compressCooldownMs: 0 },
      });

      let callCount = 0;
      const controller = {
        abort: () => {
          callCount++;
          throw new Error("abort blocked");
        },
      };
      manager._summaryAbortController = controller;
      manager._pendingSummaryPromises.set("test", Promise.resolve());

      assert.doesNotThrow(() => manager._abortPendingSummaries("test"));
      assert.equal(callCount, 2);
      assert.equal(manager._summaryAbortController, null);
      assert.equal(manager._pendingSummaryPromises.size, 0);
    });

    it("_generateSummaryAsync respects abort signal", async () => {
      const tokenCounter = { count: (text) => text.length };
      let generatorCalled = false;

      const manager = new MessageManager({
        tokenCounter,
        asyncSummaryEnabled: true,
        summaryGenerator: async () => {
          generatorCalled = true;
          return "summary";
        },
        contextConfig: { contextWindow: 10000, compressThreshold: 0.9, compressCooldownMs: 0 },
      });

      const msg = { role: "assistant", content: "x".repeat(300), _tokens: 300 };
      const abortController = new AbortController();
      abortController.abort();

      await manager._generateSummaryAsync(msg, abortController.signal);

      // 因为 signal 已经 aborted，不应该调用生成器
      assert.equal(generatorCalled, false);
      assert.equal(msg._summary, undefined);
    });

    it("_waitForPendingSummaries resolves immediately when no pending summaries", async () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({
        tokenCounter,
        contextConfig: { contextWindow: 100, compressThreshold: 0.9, compressCooldownMs: 0 },
      });

      const start = Date.now();
      await manager._waitForPendingSummaries();
      const elapsed = Date.now() - start;

      assert.ok(elapsed < 50);
    });

    it("_waitForPendingSummaries waits for all pending summaries", async () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({
        tokenCounter,
        contextConfig: { contextWindow: 100, compressThreshold: 0.9, compressCooldownMs: 0 },
      });

      let resolved1 = false;
      let resolved2 = false;

      manager._pendingSummaryPromises.set("1", new Promise((resolve) => {
        setTimeout(() => {
          resolved1 = true;
          resolve();
        }, 20);
      }));
      manager._pendingSummaryPromises.set("2", new Promise((resolve) => {
        setTimeout(() => {
          resolved2 = true;
          resolve();
        }, 30);
      }));

      await manager._waitForPendingSummaries();

      assert.equal(resolved1, true);
      assert.equal(resolved2, true);
    });

    it("_waitForPendingSummaries tolerates errors in pending summaries", async () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({
        tokenCounter,
        contextConfig: { contextWindow: 100, compressThreshold: 0.9, compressCooldownMs: 0 },
      });

      manager._pendingSummaryPromises.set("1", Promise.reject(new Error("boom")));
      manager._pendingSummaryPromises.set("2", Promise.resolve());

      // Should not throw
      await manager._waitForPendingSummaries();
    });

    it("summary promise is removed from map after completion", async () => {
      const tokenCounter = { count: (text) => text.length };
      let summaryResolve;
      const summaryPromise = new Promise((resolve) => {
        summaryResolve = resolve;
      });

      const manager = new MessageManager({
        tokenCounter,
        asyncSummaryEnabled: true,
        summaryGenerator: async () => {
          await summaryPromise;
          return "summary";
        },
        contextConfig: { contextWindow: 10000, compressThreshold: 0.9, compressCooldownMs: 0 },
      });

      const msg = { role: "assistant", content: "x".repeat(300), _tokens: 300 };
      manager.addMessage(msg);

      assert.equal(manager._pendingSummaryPromises.size, 1);

      summaryResolve();
      // 等待摘要完成
      await new Promise((resolve) => setTimeout(resolve, 10));

      assert.equal(manager._pendingSummaryPromises.size, 0);
    });
  });

  // ==========================================================================
  // Token 缓存失效机制测试
  // ==========================================================================

  describe("token cache invalidation", () => {
    it("_computeContentHash() returns consistent hash for same content", () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({ tokenCounter });

      const content = "hello world";
      const hash1 = manager._computeContentHash(content);
      const hash2 = manager._computeContentHash(content);

      assert.equal(hash1, hash2);
      assert.equal(typeof hash1, "number");
    });

    it("_computeContentHash() returns different hash for different content", () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({ tokenCounter });

      const hash1 = manager._computeContentHash("hello");
      const hash2 = manager._computeContentHash("world");

      assert.notEqual(hash1, hash2);
    });

    it("_computeContentHash() handles null, undefined, and objects", () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({ tokenCounter });

      assert.equal(manager._computeContentHash(null), 0);
      assert.equal(manager._computeContentHash(undefined), 0);

      const objHash = manager._computeContentHash({ key: "value" });
      assert.equal(typeof objHash, "number");
      assert.notEqual(objHash, 0);
    });

    it("_cacheTokenCount() stores token count with content hash", () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({ tokenCounter });

      const msg = { role: "user", content: "hello" };
      manager._cacheTokenCount(msg, 5);

      assert.equal(msg._tokens, 5);
      assert.equal(msg._contentHash, manager._computeContentHash("hello"));
    });

    it("_getCachedTokenCount() returns cached value when content unchanged", () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({ tokenCounter });

      const msg = { role: "user", content: "hello" };
      manager._cacheTokenCount(msg, 5);

      const cached = manager._getCachedTokenCount(msg);
      assert.equal(cached, 5);
    });

    it("_getCachedTokenCount() returns undefined when content changed", () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({ tokenCounter });

      const msg = { role: "user", content: "hello" };
      manager._cacheTokenCount(msg, 5);

      // 修改消息内容
      msg.content = "hello world";

      const cached = manager._getCachedTokenCount(msg);
      assert.equal(cached, undefined);
    });

    it("_getCachedTokenCount() returns undefined when hash is missing", () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({ tokenCounter });

      const msg = { role: "user", content: "hello", _tokens: 5 };
      // 没有 _contentHash

      const cached = manager._getCachedTokenCount(msg);
      assert.equal(cached, undefined);
    });

    it("addMessage() caches token count with hash", () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({
        tokenCounter,
        contextConfig: { contextWindow: 1000, compressThreshold: 0.9, compressCooldownMs: 0 },
        asyncSummaryEnabled: false,
      });

      const msg = { role: "user", content: "hello" };
      manager.addMessage(msg);

      assert.equal(msg._tokens, 5);
      assert.equal(msg._contentHash, manager._computeContentHash("hello"));
    });

    it("_recalculateTokenUsage() uses cached tokens when content unchanged", () => {
      let callCount = 0;
      const tokenCounter = { count: (text) => { callCount++; return text.length; } };
      const manager = new MessageManager({
        tokenCounter,
        contextConfig: { contextWindow: 1000, compressThreshold: 0.9, compressCooldownMs: 0 },
        asyncSummaryEnabled: false,
      });

      const msg = { role: "user", content: "hello" };
      manager.addMessage(msg);

      const callsAfterAdd = callCount;

      // 重算应使用缓存，不再调用 count
      manager._recalculateTokenUsage();

      assert.equal(callCount, callsAfterAdd);
      assert.equal(manager.tokenUsage.total, 5);
    });

    it("_recalculateTokenUsage() recounts tokens when content changed", () => {
      let callCount = 0;
      const tokenCounter = { count: (text) => { callCount++; return text.length; } };
      const manager = new MessageManager({
        tokenCounter,
        contextConfig: { contextWindow: 1000, compressThreshold: 0.9, compressCooldownMs: 0 },
        asyncSummaryEnabled: false,
      });

      const msg = { role: "user", content: "hello" };
      manager.addMessage(msg);

      assert.equal(manager.tokenUsage.total, 5);

      const callsAfterAdd = callCount;

      // 修改消息内容
      msg.content = "hello world";

      // 重算应检测到 hash 不匹配，重新计数
      manager._recalculateTokenUsage();

      assert.ok(callCount > callsAfterAdd);
      assert.equal(manager.tokenUsage.total, 11); // "hello world".length
      assert.equal(msg._tokens, 11);
      assert.equal(msg._contentHash, manager._computeContentHash("hello world"));
    });

    it("token cache correctly handles object content modification", () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({
        tokenCounter,
        contextConfig: { contextWindow: 1000, compressThreshold: 0.9, compressCooldownMs: 0 },
        asyncSummaryEnabled: false,
      });

      const originalContent = { text: "hello" };
      const msg = { role: "user", content: originalContent };
      manager.addMessage(msg);

      const originalTokens = msg._tokens;
      const originalHash = msg._contentHash;

      // 修改对象内容
      msg.content.text = "hello world updated";

      // 缓存应失效
      const cached = manager._getCachedTokenCount(msg);
      assert.equal(cached, undefined);

      // 重算应更新
      manager._recalculateTokenUsage();
      assert.notEqual(msg._tokens, originalTokens);
      assert.notEqual(msg._contentHash, originalHash);
    });
  });

  // ==========================================================================
  // 异步摘要功能测试
  // ==========================================================================

  describe("async summary features", () => {
    it("_isThinkingMessage detects thinking messages", () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({ tokenCounter });

      assert.equal(manager._isThinkingMessage({ thinking: true }), true);
      assert.equal(manager._isThinkingMessage({ internal: true }), true);
      assert.equal(manager._isThinkingMessage({ type: "thinking" }), true);
      assert.equal(manager._isThinkingMessage({ content: "<think>foo</think>" }), true);
      assert.equal(manager._isThinkingMessage({ content: "<analysis>bar</analysis>" }), true);
      assert.equal(manager._isThinkingMessage({ content: "thoughts: something" }), true);
      assert.equal(manager._isThinkingMessage({ content: "internal: note" }), true);
      assert.equal(manager._isThinkingMessage({ content: "normal message" }), false);
      assert.equal(manager._isThinkingMessage(null), false);
      assert.equal(manager._isThinkingMessage({}), false);
    });

    it("_shouldGenerateSummary returns false for short messages", () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({ tokenCounter });

      const msg = { role: "assistant", content: "short", _tokens: 10 };
      assert.equal(manager._shouldGenerateSummary(msg), false);
    });

    it("_shouldGenerateSummary returns true for long messages", () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({ tokenCounter });

      const msg = { role: "assistant", content: "x".repeat(500), _tokens: 250 };
      assert.equal(manager._shouldGenerateSummary(msg), true);
    });

    it("_shouldGenerateSummary returns false for messages with existing summary", () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({ tokenCounter });

      const msg = { role: "assistant", content: "x".repeat(500), _tokens: 250, _summary: "existing" };
      assert.equal(manager._shouldGenerateSummary(msg), false);
    });

    it("_shouldGenerateSummary returns false for null/invalid messages", () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({ tokenCounter });

      assert.equal(manager._shouldGenerateSummary(null), false);
      assert.equal(manager._shouldGenerateSummary(undefined), false);
      assert.equal(manager._shouldGenerateSummary("string"), false);
    });

    it("_shouldGenerateSummary returns false for messages without content", () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({ tokenCounter });

      const msg = { role: "assistant", _tokens: 250 };
      assert.equal(manager._shouldGenerateSummary(msg), false);
    });

    it("_generateBuiltinSummary generates summary for thinking messages with decisions", () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({ tokenCounter });

      const msg = {
        thinking: true,
        content: "决定使用方案A\n分析完成\n确定采用这个方法",
      };
      const summary = manager._generateBuiltinSummary(msg);
      assert.ok(summary.includes("[决策]"));
    });

    it("_generateBuiltinSummary generates summary for thinking messages without decisions", () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({ tokenCounter });

      const msg = {
        thinking: true,
        content: "This is a thinking message without clear decisions",
      };
      const summary = manager._generateBuiltinSummary(msg);
      assert.ok(summary.includes("[Thinking]"));
    });

    it("_generateBuiltinSummary generates summary for long content", () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({ tokenCounter });

      const msg = { content: "x".repeat(300) };
      const summary = manager._generateBuiltinSummary(msg);
      assert.ok(summary.includes("..."));
      assert.ok(summary.length < 200);
    });

    it("_generateBuiltinSummary returns null for short content", () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({ tokenCounter });

      const msg = { content: "short" };
      const summary = manager._generateBuiltinSummary(msg);
      assert.equal(summary, null);
    });

    it("_generateBuiltinSummary returns null for empty content", () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({ tokenCounter });

      const msg = { content: "" };
      const summary = manager._generateBuiltinSummary(msg);
      assert.equal(summary, null);
    });

    it("setSummaryGenerator updates custom generator", () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({ tokenCounter });

      const generator = async (msg) => "custom summary";
      manager.setSummaryGenerator(generator);
      assert.equal(manager._summaryGenerator, generator);
    });

    it("setAsyncSummaryEnabled toggles async summary", () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({ tokenCounter });

      manager.setAsyncSummaryEnabled(true);
      assert.equal(manager._asyncSummaryEnabled, true);

      manager.setAsyncSummaryEnabled(false);
      assert.equal(manager._asyncSummaryEnabled, false);
    });

    it("_generateSummaryAsync swallows summaryGenerator errors", async () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({
        tokenCounter,
        asyncSummaryEnabled: true,
        summaryGenerator: async () => {
          throw new Error("summary failed");
        },
        contextConfig: { contextWindow: 10000, compressThreshold: 0.9, compressCooldownMs: 0 },
      });

      const msg = { role: "assistant", content: "x".repeat(300), _tokens: 300 };
      await manager._generateSummaryAsync(msg);

      assert.equal(msg._summary, undefined);
      assert.equal(msg._summaryTokens, undefined);
    });

    it("_scheduleAsyncSummary cleans up after summaryGenerator rejection", async () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({
        tokenCounter,
        asyncSummaryEnabled: true,
        summaryGenerator: async () => {
          throw new Error("boom");
        },
        contextConfig: { contextWindow: 10000, compressThreshold: 0.9, compressCooldownMs: 0 },
      });

      const msg = { role: "assistant", content: "x".repeat(300), _tokens: 300 };
      manager.addMessage(msg);
      assert.equal(manager._pendingSummaryPromises.size, 1);

      await new Promise((resolve) => setTimeout(resolve, 10));

      assert.equal(manager._pendingSummaryPromises.size, 0);
      assert.equal(msg._summary, undefined);
    });
  });

  // ==========================================================================
  // 边缘情况测试
  // ==========================================================================

  describe("edge cases", () => {
    it("handles empty messages array in addMessages", () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({ tokenCounter, asyncSummaryEnabled: false });

      manager.addMessages([]);
      assert.equal(manager.messages.length, 0);
    });

    it("handles message without content property", () => {
      const tokenCounter = { count: (text) => (text ? text.length : 0) };
      const manager = new MessageManager({ tokenCounter, asyncSummaryEnabled: false });

      const msg = { role: "user" };
      manager.addMessage(msg);
      assert.equal(manager.messages.length, 1);
    });

    it("handles message with undefined content", () => {
      const tokenCounter = { count: (text) => (text ? text.length : 0) };
      const manager = new MessageManager({ tokenCounter, asyncSummaryEnabled: false });

      const msg = { role: "user", content: undefined };
      manager.addMessage(msg);
      assert.equal(manager.messages.length, 1);
      assert.equal(msg._tokens, 0);
    });

    it("tokenUsage getter returns a copy", () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({ tokenCounter, asyncSummaryEnabled: false });

      manager.addMessage({ role: "user", content: "hello" });
      const usage = manager.tokenUsage;
      usage.total = 9999;

      assert.notEqual(manager.tokenUsage.total, 9999);
    });
  });
});
