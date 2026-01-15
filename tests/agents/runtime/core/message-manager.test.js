import { describe, it, expect, vi } from "vitest";

import MessageManager from "../../../../js/agents/runtime/core/message-manager.js";

describe("runtime/core/message-manager", () => {
  it("ignores message additions after dispose()", () => {
    const tokenCounter = { count: (text) => text.length };
    const manager = new MessageManager({
      tokenCounter,
      contextConfig: { contextWindow: 100, compressThreshold: 0.1, compressCooldownMs: 0 },
    });

    manager.dispose();

    manager.addMessage({ role: "user", content: "hello" });
    manager.addMessages([{ role: "user", content: "world" }]);

    expect(manager.messages).toEqual([]);
    expect(manager.tokenUsage).toEqual({ input: 0, output: 0, total: 0 });
  });

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
    expect(manager.getStatus().compressionCount).toBe(1);

    await manager.reset();
    expect(manager.messages).toEqual([]);
    expect(manager.tokenUsage).toEqual({ input: 0, output: 0, total: 0 });
    expect(manager.getStatus().compressionCount).toBe(0);
  });

  it("_shouldCompress() falls back to config threshold when coordinator is missing", () => {
    const tokenCounter = { count: (text) => text.length };
    const manager = new MessageManager({
      tokenCounter,
      contextConfig: { contextWindow: 10, compressThreshold: 0.5, compressCooldownMs: 0 },
    });

    // Force fallback path (no coordinator / shouldCompress method).
    manager._compressionCoordinator = null;
    manager._tokenUsage.total = 4;
    expect(manager._shouldCompress()).toBe(false);
    manager._tokenUsage.total = 5;
    expect(manager._shouldCompress()).toBe(true);
  });

  it("exposes contextConfig defensively and schedules compression from addMessage()", async () => {
    const tokenCounter = { count: (text) => text.length };
    const manager = new MessageManager({
      tokenCounter,
      contextConfig: { contextWindow: 10, compressThreshold: 0.1, compressCooldownMs: 0 },
    });

    // Getter returns a copy (defensive).
    const cfg = manager.contextConfig;
    cfg.contextWindow = 999;
    expect(manager.contextConfig.contextWindow).toBe(10);

    manager._compressionCoordinator.shouldCompress = vi.fn(() => true);
    const scheduleSpy = vi.spyOn(manager, "_scheduleCompression").mockImplementation(() => {});
    try {
      manager.addMessage({ role: "user", content: "hello" });
      expect(scheduleSpy).toHaveBeenCalledTimes(1);
    } finally {
      scheduleSpy.mockRestore();
    }
  });

  it("_abortActiveCompression() tolerates abort() failures and always clears controller", () => {
    const tokenCounter = { count: (text) => text.length };
    const manager = new MessageManager({
      tokenCounter,
      contextConfig: { contextWindow: 100, compressThreshold: 0.9, compressCooldownMs: 0 },
    });

    const controller = {
      abort: vi.fn(() => {
        throw new Error("abort blocked");
      }),
    };
    // @ts-expect-error: inject a fake controller to cover defensive code
    manager._compressionAbortController = controller;

    expect(() => manager._abortActiveCompression("why")).not.toThrow();
    expect(controller.abort).toHaveBeenCalledTimes(2);
    expect(controller.abort.mock.calls[0][0]).toBe("why");
    expect(manager._compressionAbortController).toBe(null);
  });

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
      // @ts-expect-error: force a non-null timer handle
      manager._compressionCooldownTimer = 123;
      expect(() => manager._clearCooldownTimer()).not.toThrow();
      expect(manager._compressionCooldownTimer).toBe(null);
    } finally {
      globalThis.clearTimeout = original;
    }
  });

  it("_scheduleCompression() logs non-abort errors from _compress()", async () => {
    const logger = { warn: vi.fn() };
    const tokenCounter = { count: (text) => text.length };
    const manager = new MessageManager({
      logger,
      tokenCounter,
      contextConfig: { contextWindow: 100, compressThreshold: 0.1, compressCooldownMs: 0 },
    });

    const compressSpy = vi.spyOn(manager, "_compress").mockImplementation(async () => {
      throw new Error("boom");
    });

    manager._compressionCoordinator.shouldCompress = vi.fn(() => true);
    manager._scheduleCompression({ force: true });

    const pending = manager._compressionPromise;
    expect(pending).not.toBe(null);
    await pending;

    expect(logger.warn).toHaveBeenCalledWith("Message compression error", { error: "boom" });
    compressSpy.mockRestore();
  });

  it("_scheduleCompression() calls timer.unref() when available (cooldown path)", () => {
    const tokenCounter = { count: (text) => text.length };
    const manager = new MessageManager({
      tokenCounter,
      contextConfig: { contextWindow: 100, compressThreshold: 0.9, compressCooldownMs: 10_000 },
    });
    manager._compressionCoordinator.shouldCompress = vi.fn(() => true);

    const originalSetTimeout = globalThis.setTimeout;
    try {
      globalThis.setTimeout = (fn, ms, ...rest) => {
        const t = originalSetTimeout(fn, ms, ...rest);
        if (t && typeof t === "object" && typeof t.unref === "function") {
          const originalUnref = t.unref.bind(t);
          t.unref = vi.fn(() => originalUnref());
        }
        return t;
      };

      manager._lastCompressionAtMs = Date.now();
      manager._scheduleCompression();
      expect(manager._compressionPending).toBe(false);
      expect(manager._compressionCooldownTimer).not.toBe(null);
      expect(manager._compressionCooldownTimer.unref).toHaveBeenCalledTimes(1);
    } finally {
      manager.dispose(); // ensure timer handle is cleared
      globalThis.setTimeout = originalSetTimeout;
    }
  });

  it("flushCompression() runs bounded rounds and records compressions", async () => {
    const emit = vi.fn();
    const tokenCounter = { count: (text) => text.length };
    const manager = new MessageManager({
      emit,
      stageName: "demo",
      actor: "bob",
      tokenCounter,
      contextConfig: { contextWindow: 100, compressThreshold: 0.1, compressCooldownMs: 0 },
    });

    manager._compressionCoordinator.shouldCompress = vi.fn(() => manager._messages.length > 1);
    manager._compressionCoordinator.maybeCompress = vi.fn(async (messages) => ({ messages: messages.slice(1) }));

    manager.addMessages([
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
      { role: "assistant", content: "c" },
    ]);

    await manager.flushCompression({ maxRounds: 2 });
    expect(manager._compressionCoordinator.maybeCompress).toHaveBeenCalledTimes(2);
    expect(manager.messages).toHaveLength(1);
    expect(manager.getStatus().compressionCount).toBe(2);
    expect(emit).toHaveBeenCalledWith("demo.context.compressed", expect.any(Object));
  });

  it("flushCompression() logs non-abort errors and suppresses abort-like errors", async () => {
    const logger = { warn: vi.fn() };
    const tokenCounter = { count: (text) => text.length };
    const manager = new MessageManager({
      logger,
      tokenCounter,
      contextConfig: { contextWindow: 10, compressThreshold: 0.1, compressCooldownMs: 0 },
    });

    manager._compressionCoordinator.shouldCompress = vi.fn(() => true);
    manager._compressionCoordinator.maybeCompress = vi.fn(async () => {
      throw new Error("boom");
    });

    await manager.flushCompression({ maxRounds: 1 });
    expect(logger.warn).toHaveBeenCalledWith("Message compression error", { error: "boom" });

    logger.warn.mockClear();
    manager._compressionCoordinator.maybeCompress = vi.fn(async () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    });
    await manager.flushCompression({ maxRounds: 1 });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("_compress() no-ops when maybeCompress is missing, and flushCompression() tolerates previous failures", async () => {
    const logger = { warn: vi.fn() };
    const tokenCounter = { count: (text) => text.length };
    const manager = new MessageManager({
      logger,
      tokenCounter,
      contextConfig: { contextWindow: 100, compressThreshold: 0.1, compressCooldownMs: 0 },
    });

    // Previous async compression failure should not break flushCompression.
    manager._compressionPromise = Promise.reject(new Error("previous"));
    await expect(manager.flushCompression({ maxRounds: 0 })).resolves.toBeUndefined();

    // No maybeCompress => _compress returns early.
    // @ts-expect-error: intentionally remove coordinator method
    manager._compressionCoordinator.maybeCompress = null;
    manager.addMessages([{ role: "user", content: "hello" }]);
    await expect(manager._compress()).resolves.toBeUndefined();
    expect(manager._compressionAbortController).toBe(null);
  });

  it("setContextConfig(tokenCounter: null) disables custom token counting", () => {
    const tokenCounter = { count: () => 999 };
    const manager = new MessageManager({ tokenCounter });

    manager.setContextConfig({ tokenCounter: null });
    expect(manager._tokenCounter).toBe(null);

    // Unrelated updates should not re-enable tokenCounter implicitly.
    manager.setContextConfig({ contextWindow: 42 });
    expect(manager._tokenCounter).toBe(null);

    expect(manager._isAbortError({ name: "CanceledError" })).toBe(true);
    expect(manager._isAbortError(new Error("canceled by user"))).toBe(true);
  });

  it("wrapToolOutput() and cleanOldOutputs() integrate persisted-output helpers", () => {
    const tokenCounter = { count: (text) => text.length };
    const manager = new MessageManager({
      tokenCounter,
      contextConfig: { contextWindow: 10_000, compressThreshold: 1, compressCooldownMs: 0 },
    });

    const small = manager.wrapToolOutput("small", { threshold: 1000 });
    expect(small).toBe("small");

    const large = manager.wrapToolOutput("x".repeat(50), { threshold: 10, previewSize: 5 });
    expect(large).toContain("<persisted-output>");
    expect(large).toContain("</persisted-output>");
    expect(large).toContain("xxxxx");

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
    expect(manager.messages[0].content).toBe("[Old large output cleared to save context space]");
    expect(manager.messages[1].content).toBe("[Old large output cleared to save context space]");
    expect(manager.messages[2].content).toBe(p3);
    expect(manager.messages[3].content).toBe("hi");

    const clearedLen = "[Old large output cleared to save context space]".length;
    const expected = clearedLen + clearedLen + p3.length + "hi".length;
    expect(manager.tokenUsage.total).toBe(expected);
    expect(manager.tokenUsage.total).not.toBe(before);
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
      expect(msg._summary).toBeUndefined();
      expect(manager._pendingSummaryPromises.size).toBe(1);

      // 启动压缩（会等待摘要）
      const compressPromise = manager._compress();

      // 摘要仍未完成
      expect(msg._summary).toBeUndefined();

      // 完成摘要生成
      summaryResolve();

      // 等待压缩完成
      await compressPromise;

      // 摘要应该已生成
      expect(msg._summary).toBe("Summary of: " + "x".repeat(300));
    });

    it("dispose() cancels pending summaries via AbortController", async () => {
      const tokenCounter = { count: (text) => text.length };
      let summaryStarted = false;
      let summaryAborted = false;

      const manager = new MessageManager({
        tokenCounter,
        asyncSummaryEnabled: true,
        summaryGenerator: async () => {
          summaryStarted = true;
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

      expect(manager._summaryAbortController).toBe(null);
      expect(manager._pendingSummaryPromises.size).toBe(0);
    });

    it("_abortPendingSummaries() tolerates abort() failures", () => {
      const tokenCounter = { count: (text) => text.length };
      const manager = new MessageManager({
        tokenCounter,
        contextConfig: { contextWindow: 100, compressThreshold: 0.9, compressCooldownMs: 0 },
      });

      const controller = {
        abort: vi.fn(() => {
          throw new Error("abort blocked");
        }),
      };
      // @ts-expect-error: inject a fake controller
      manager._summaryAbortController = controller;
      manager._pendingSummaryPromises.set("test", Promise.resolve());

      expect(() => manager._abortPendingSummaries("test")).not.toThrow();
      expect(controller.abort).toHaveBeenCalledTimes(2);
      expect(manager._summaryAbortController).toBe(null);
      expect(manager._pendingSummaryPromises.size).toBe(0);
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

      expect(manager._pendingSummaryPromises.size).toBeGreaterThan(0);

      await manager.reset();

      expect(manager._pendingSummaryPromises.size).toBe(0);
      expect(manager._summaryAbortController).toBe(null);
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
      expect(generatorCalled).toBe(false);
      expect(msg._summary).toBeUndefined();
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

      expect(elapsed).toBeLessThan(50);
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

      expect(resolved1).toBe(true);
      expect(resolved2).toBe(true);
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
      await expect(manager._waitForPendingSummaries()).resolves.toBeUndefined();
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

      expect(manager._pendingSummaryPromises.size).toBe(1);

      summaryResolve();
      // 等待摘要完成
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(manager._pendingSummaryPromises.size).toBe(0);
    });
  });
});
