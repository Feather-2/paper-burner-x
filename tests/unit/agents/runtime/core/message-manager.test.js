import { describe, it, expect, vi, beforeEach } from "vitest";

const sharedMocks = vi.hoisted(() => {
  const globalTokenCounter = { count: vi.fn((text) => String(text).length) };
  const estimateTokensCached = vi.fn((text, tokenCounter) => {
    if (tokenCounter && typeof tokenCounter.count === "function") {
      return tokenCounter.count(text);
    }
    return typeof text === "string" ? text.length : String(text).length;
  });
  const createLogger = vi.fn(() => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }));
  const getGlobalTokenCounter = vi.fn(() => globalTokenCounter);
  return { estimateTokensCached, createLogger, getGlobalTokenCounter, globalTokenCounter };
});

const compressionMocks = vi.hoisted(() => {
  const instances = [];
  const shouldCompress = vi.fn(() => false);
  const maybeCompress = vi.fn(async (messages) => ({ messages }));
  class CompressionCoordinator {
    constructor(options) {
      this.options = options;
      instances.push(this);
    }
    shouldCompress() {
      return shouldCompress();
    }
    maybeCompress(messages, options) {
      return maybeCompress(messages, options);
    }
  }
  return { instances, shouldCompress, maybeCompress, CompressionCoordinator };
});

const contextMocks = vi.hoisted(() => ({
  DEFAULT_CONTEXT_CONFIG: {
    contextWindow: 1000,
    compressThreshold: 0.8,
    compressCooldownMs: 0,
  },
}));

const persistedMocks = vi.hoisted(() => {
  const wrapPersistedOutput = vi.fn((content, options) => {
    if (options && typeof options.threshold === "number") {
      return `wrapped:${content}:${options.threshold}`;
    }
    return `wrapped:${content}`;
  });
  const cleanOldPersistedOutputs = vi.fn((messages, keepRecent) => messages.slice(-keepRecent));
  const KEEP_RECENT_OUTPUTS = 3;
  return { wrapPersistedOutput, cleanOldPersistedOutputs, KEEP_RECENT_OUTPUTS };
});

const errorReporterMocks = vi.hoisted(() => {
  const report = vi.fn();
  const createScopedReporter = vi.fn(() => ({ report }));
  const ErrorCategory = { Internal: "internal" };
  return { report, createScopedReporter, ErrorCategory };
});

vi.mock("../../../../../js/agents/shared/index.js", () => ({
  estimateTokensCached: sharedMocks.estimateTokensCached,
  createLogger: sharedMocks.createLogger,
  getGlobalTokenCounter: sharedMocks.getGlobalTokenCounter,
}));

vi.mock("../../../../../js/agents/plugins/compression/index.js", () => ({
  CompressionCoordinator: compressionMocks.CompressionCoordinator,
}));

vi.mock("../../../../../js/agents/runtime/core/context-config.js", () => contextMocks);

vi.mock("../../../../../js/agents/runtime/core/persisted-output.js", () => ({
  wrapPersistedOutput: persistedMocks.wrapPersistedOutput,
  cleanOldPersistedOutputs: persistedMocks.cleanOldPersistedOutputs,
  KEEP_RECENT_OUTPUTS: persistedMocks.KEEP_RECENT_OUTPUTS,
}));

vi.mock("../../../../../js/agents/runtime/core/errors/silent-error-reporter.js", () => ({
  createScopedReporter: errorReporterMocks.createScopedReporter,
  ErrorCategory: errorReporterMocks.ErrorCategory,
}));

let MessageManager;
let MessageManagerDefault;
let fallbackLogger;

const flushMicrotasks = async (times = 2) => {
  for (let i = 0; i < times; i += 1) {
    await new Promise((resolve) => queueMicrotask(resolve));
  }
};

const createDeferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const createDeepNested = (depth) => {
  const root = { depth: 0 };
  let node = root;
  for (let i = 1; i <= depth; i += 1) {
    node.next = { depth: i };
    node = node.next;
  }
  return root;
};

const createManager = (options = {}) => new MessageManager(options);

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  compressionMocks.instances.length = 0;
  compressionMocks.shouldCompress.mockReturnValue(false);
  compressionMocks.maybeCompress.mockImplementation(async (messages) => ({ messages }));
  sharedMocks.globalTokenCounter.count.mockImplementation((text) => String(text).length);
  sharedMocks.estimateTokensCached.mockImplementation((text, tokenCounter) => {
    if (tokenCounter && typeof tokenCounter.count === "function") {
      return tokenCounter.count(text);
    }
    return typeof text === "string" ? text.length : String(text).length;
  });
  persistedMocks.wrapPersistedOutput.mockImplementation((content, options) => {
    if (options && typeof options.threshold === "number") {
      return `wrapped:${content}:${options.threshold}`;
    }
    return `wrapped:${content}`;
  });
  persistedMocks.cleanOldPersistedOutputs.mockImplementation((messages, keepRecent) => messages.slice(-keepRecent));
  const module = await import("../../../../../js/agents/runtime/core/message-manager.js");
  MessageManager = module.MessageManager;
  MessageManagerDefault = module.default;
  fallbackLogger = sharedMocks.createLogger.mock.results[0]?.value;
  if (fallbackLogger?.warn?.mockClear) {
    fallbackLogger.warn.mockClear();
  }
});

describe("MessageManager", () => {
  it("exposes default export as the named class", () => {
    expect(MessageManagerDefault).toBe(MessageManager);
  });

  it("initializes defaults and uses the global token counter", () => {
    const manager = createManager();

    expect(manager.messages).toEqual([]);
    expect(manager.tokenUsage).toEqual({ input: 0, output: 0, total: 0 });
    expect(manager.contextConfig.contextWindow).toBe(1000);
    expect(sharedMocks.getGlobalTokenCounter).toHaveBeenCalledTimes(1);
    expect(compressionMocks.instances).toHaveLength(1);
    expect(typeof compressionMocks.instances[0].options.getContextConfig).toBe("function");
  });

  it("merges contextConfig and applies stage/actor and async summary flags", () => {
    const manager = createManager({
      contextConfig: { contextWindow: 5000, compressThreshold: 0.9 },
      stageName: "stage",
      actor: "tester",
      asyncSummaryEnabled: false,
    });

    expect(manager.contextConfig.contextWindow).toBe(5000);
    expect(manager.contextConfig.compressThreshold).toBe(0.9);
    expect(manager._stageName).toBe("stage");
    expect(manager._actor).toBe("tester");
    expect(manager._asyncSummaryEnabled).toBe(false);
  });

  it("returns copies for tokenUsage and contextConfig getters", () => {
    const manager = createManager();

    const usage = manager.tokenUsage;
    usage.input = 99;
    expect(manager.tokenUsage.input).toBe(0);

    const config = manager.contextConfig;
    config.contextWindow = 42;
    expect(manager.contextConfig.contextWindow).toBe(1000);
  });

  it("setContextConfig merges values and handles tokenCounter updates", () => {
    const tokenCounter = { count: vi.fn((text) => String(text).length) };
    const nextCounter = { count: vi.fn(() => 1) };
    const manager = createManager({ tokenCounter });

    manager.setContextConfig({ contextWindow: 2000, tokenCounter: nextCounter });
    expect(manager.contextConfig.contextWindow).toBe(2000);
    expect(manager._tokenCounter).toBe(nextCounter);

    manager.setContextConfig({ tokenCounter: null });
    expect(manager._tokenCounter).toBeNull();

    manager.setContextConfig({ tokenCounter: undefined, compressThreshold: 0.1 });
    expect(manager._tokenCounter).toBeNull();

    expect(() => manager.setContextConfig(null)).not.toThrow();
    expect(() => manager.setContextConfig(undefined)).not.toThrow();
  });

  it("adds messages, caches tokens, and updates usage and superseded count", () => {
    const tokenCounter = { count: vi.fn((text) => String(text).length) };
    const manager = createManager({ tokenCounter, asyncSummaryEnabled: false });

    const message = { role: "user", content: "Hello" };
    manager.addMessage(message);

    expect(manager.messages).toHaveLength(1);
    expect(message._tokens).toBe(5);
    expect(typeof message._contentHash).toBe("number");
    expect(manager.tokenUsage).toEqual({ input: 5, output: 0, total: 5 });

    const superseded = { role: "assistant", content: "Old", _superseded: true };
    manager.addMessage(superseded);
    expect(manager.supersededCount).toBe(1);
  });

  it("handles nullish, empty, and object content when adding messages", () => {
    const tokenCounter = { count: vi.fn((text) => String(text).length) };
    const manager = createManager({ tokenCounter, asyncSummaryEnabled: false });

    manager.addMessage({ role: "user", content: null });
    manager.addMessage({ role: "user", content: undefined });
    manager.addMessage({ role: "user", content: "" });
    manager.addMessage({ role: "user" });
    manager.addMessage({});

    expect(manager.messages).toHaveLength(5);
    expect(manager.messages[0]._tokens).toBe(0);
    expect(manager.messages[1]._tokens).toBe(0);
    expect(manager.messages[2]._tokens).toBe(0);
    expect(manager.messages[3]._tokens).toBe(0);
    expect(manager.messages[4]._tokens).toBe(0);
  });

  it("supports large strings and deep/circular objects", () => {
    const tokenCounter = { count: vi.fn((text) => String(text).length) };
    const manager = createManager({ tokenCounter, asyncSummaryEnabled: false });

    const large = "x".repeat(100000);
    manager.addMessage({ role: "user", content: large });
    expect(manager.tokenUsage.total).toBe(100000);

    const deep = createDeepNested(50);
    manager.addMessage({ role: "user", content: deep });
    expect(manager.tokenUsage.total).toBeGreaterThan(100000);

    const circular = {};
    circular.self = circular;
    sharedMocks.estimateTokensCached.mockClear();
    manager.addMessage({ role: "user", content: circular });
    expect(sharedMocks.estimateTokensCached).toHaveBeenCalledWith("[object Object]", tokenCounter);
  });

  it("schedules async summaries when enabled and conditions are met", async () => {
    const summaryGenerator = vi.fn().mockResolvedValue("summary");
    const manager = createManager({ summaryGenerator });

    const message = { role: "user", content: "x".repeat(210) };
    manager.addMessage(message);
    await manager._waitForPendingSummaries();

    expect(summaryGenerator).toHaveBeenCalledTimes(1);
    expect(message._summary).toBe("summary");
    expect(message._summaryTokens).toBe("summary".length);
  });

  it("does not add messages after dispose", () => {
    const manager = createManager({ asyncSummaryEnabled: false });
    manager.dispose();

    const message = { role: "user", content: "Hello" };
    manager.addMessage(message);

    expect(manager.messages).toHaveLength(0);
  });

  it("adds multiple messages, updates usage, and leaves tokens uncached", () => {
    const tokenCounter = { count: vi.fn((text) => String(text).length) };
    const manager = createManager({ tokenCounter, asyncSummaryEnabled: false });

    const messages = [
      { role: "user", content: "One" },
      { role: "assistant", content: "Two", _superseded: true },
    ];

    manager.addMessages(messages);

    expect(manager.messages).toHaveLength(2);
    expect(manager.tokenUsage.total).toBe(6);
    expect(manager.supersededCount).toBe(1);
    expect(messages[0]._tokens).toBeUndefined();
    expect(messages[1]._tokens).toBeUndefined();
  });

  it("handles empty arrays and schedules compression on addMessages", async () => {
    compressionMocks.shouldCompress.mockReturnValue(true);
    const manager = createManager({ asyncSummaryEnabled: false });

    manager.addMessages([]);
    expect(manager.messages).toHaveLength(0);

    const compressSpy = vi.spyOn(manager, "_compress").mockResolvedValue();
    manager.addMessages([{ content: "payload" }]);
    await flushMicrotasks();
    expect(compressSpy).toHaveBeenCalledTimes(1);
  });

  it("throws when addMessages receives a non-iterable object", () => {
    const manager = createManager({ asyncSummaryEnabled: false });
    expect(() => manager.addMessages({})).toThrow();
  });

  it("marks superseded messages with clamped inclusive ranges", () => {
    const manager = createManager({ asyncSummaryEnabled: false });
    manager.addMessages([{ content: "a" }, { content: "b" }, { content: "c" }]);

    const count = manager.markAsSuperseded(-1, Number.MAX_SAFE_INTEGER, "fix");
    expect(count).toBe(3);
    expect(manager.supersededCount).toBe(3);
    expect(manager.messages[0]._supersededBy).toBe("fix");
  });

  it("warns and returns 0 when correction is empty or whitespace", () => {
    const logger = { warn: vi.fn() };
    const manager = createManager({ logger, asyncSummaryEnabled: false });
    manager.addMessages([{ content: "a" }]);

    const count = manager.markAsSuperseded(0, 0, "   ");
    expect(count).toBe(0);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("ignores invalid indices and empty history when marking superseded", () => {
    const manager = createManager({ asyncSummaryEnabled: false });
    manager.addMessages([{ content: "a" }]);
    expect(manager.markAsSuperseded("1", "2", "fix")).toBe(0);
    expect(manager.markAsSuperseded(5, 6, "fix")).toBe(0);

    const emptyManager = createManager({ asyncSummaryEnabled: false });
    expect(emptyManager.markAsSuperseded(0, 0, "fix")).toBe(0);
  });

  it("preserves existing superseded markers without double counting", () => {
    const manager = createManager({ asyncSummaryEnabled: false });
    const message = { content: "a", _superseded: true };
    manager.addMessages([message]);

    const count = manager.markAsSuperseded(0, 0, "fix");
    expect(count).toBe(0);
    expect(message._supersededBy).toBe("fix");
  });

  it("inserts correction messages with system role", () => {
    const manager = createManager({ asyncSummaryEnabled: false });
    const signal = { correction: 123, severity: "minor", supersedeRange: null, timestamp: 1 };

    const message = manager.insertCorrectionMessage(signal);
    expect(message.role).toBe("system");
    expect(message.type).toBe("dmail_correction");
    expect(message.content).toBe("123");
    expect(message._dmail).toBe(signal);
    expect(manager.messages[0]).toBe(message);
  });

  it("returns active messages with optional superseded inclusion", () => {
    const manager = createManager({ asyncSummaryEnabled: false });
    manager.addMessages([
      { content: "a", _superseded: true },
      { content: "b" },
    ]);

    expect(manager.getActiveMessages()).toEqual([manager.messages[1]]);

    const all = manager.getActiveMessages({ includeSuperseded: true });
    expect(all).toHaveLength(2);
    all.pop();
    expect(manager.messages).toHaveLength(2);

    const filtered = manager.getActiveMessages({ includeSuperseded: "true" });
    expect(filtered).toHaveLength(1);
  });

  it("resets state and preserves history when requested", async () => {
    const manager = createManager({ asyncSummaryEnabled: false });
    manager.addMessages([{ content: "a" }, { content: "b", _superseded: true }]);
    manager._compressionHistory.push({ timestamp: 1, beforeCount: 2, afterCount: 1, beforeTokens: 2, afterTokens: 1 });
    manager._pendingSummaryPromises.set("1", Promise.resolve());
    manager._summaryAbortController = new AbortController();

    await manager.reset({ clearCompressionHistory: false });

    expect(manager.messages).toEqual([]);
    expect(manager.tokenUsage).toEqual({ input: 0, output: 0, total: 0 });
    expect(manager.supersededCount).toBe(0);
    expect(manager._compressionHistory).toHaveLength(1);
    expect(manager._pendingSummaryPromises.size).toBe(0);
    expect(manager._summaryAbortController).toBeNull();
  });

  it("reports errors thrown during reset compression flush", async () => {
    const manager = createManager({ asyncSummaryEnabled: false });
    manager.flushCompression = vi.fn(async () => {
      throw new Error("flush failed");
    });

    await manager.reset();
    expect(errorReporterMocks.report).toHaveBeenCalled();
  });

  it("recalculates token usage using cached and updated content", () => {
    const tokenCounter = { count: vi.fn((text) => String(text).length) };
    const manager = createManager({ tokenCounter, asyncSummaryEnabled: false });
    const message = { content: "hello" };
    manager.addMessage(message);

    manager._tokenUsage = { input: 0, output: 0, total: 0 };
    sharedMocks.estimateTokensCached.mockClear();
    manager._recalculateTokenUsage();
    expect(manager.tokenUsage.total).toBe(5);
    expect(sharedMocks.estimateTokensCached).not.toHaveBeenCalled();

    message.content = "changed";
    manager._recalculateTokenUsage();
    expect(message._tokens).toBe("changed".length);
  });

  it("recalculates superseded count", () => {
    const manager = createManager({ asyncSummaryEnabled: false });
    manager.addMessages([
      { content: "a", _superseded: true },
      { content: "b" },
      { content: "c", _superseded: true },
    ]);

    manager._supersededCount = 0;
    manager._recalculateSupersededCount();
    expect(manager.supersededCount).toBe(2);
  });

  it("computes content hashes for null, empty, deep, and circular values", () => {
    const manager = createManager({ asyncSummaryEnabled: false });
    expect(manager._computeContentHash(null)).toBe(0);
    expect(manager._computeContentHash("")).toBe(0);

    const deep = createDeepNested(20);
    expect(typeof manager._computeContentHash(deep)).toBe("number");

    const circular = {};
    circular.self = circular;
    expect(typeof manager._computeContentHash(circular)).toBe("number");
  });

  it("caches token counts and validates cache by content hash", () => {
    const manager = createManager({ asyncSummaryEnabled: false });
    const message = { content: "abc" };

    manager._cacheTokenCount(message, 3);
    expect(manager._getCachedTokenCount(message)).toBe(3);

    message.content = "abcd";
    expect(manager._getCachedTokenCount(message)).toBeUndefined();
  });

  it("uses compression coordinator when available and falls back to thresholds", () => {
    const manager = createManager({ asyncSummaryEnabled: false });
    compressionMocks.shouldCompress.mockReturnValue(true);
    expect(manager._shouldCompress()).toBe(true);

    manager._compressionCoordinator = null;
    manager._contextConfig = { contextWindow: 10, compressThreshold: 0.5 };
    manager._tokenUsage.total = 5;
    expect(manager._shouldCompress()).toBe(true);
    manager._tokenUsage.total = 4;
    expect(manager._shouldCompress()).toBe(false);
  });

  it("clears cooldown timers safely", async () => {
    vi.useFakeTimers();
    const manager = createManager({ asyncSummaryEnabled: false });
    const fn = vi.fn();
    manager._compressionCooldownTimer = setTimeout(fn, 50);

    manager._clearCooldownTimer();
    vi.advanceTimersByTime(50);
    expect(fn).not.toHaveBeenCalled();
    expect(manager._compressionCooldownTimer).toBeNull();
    vi.useRealTimers();
  });

  it("aborts active compression controllers", () => {
    const manager = createManager({ asyncSummaryEnabled: false });
    const controller = new AbortController();
    manager._compressionAbortController = controller;

    manager._abortActiveCompression("stop");
    expect(controller.signal.aborted).toBe(true);
    expect(manager._compressionAbortController).toBeNull();
  });

  it("handles abort detection for common error shapes", () => {
    const manager = createManager({ asyncSummaryEnabled: false });

    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    expect(manager._isAbortError(abortError)).toBe(true);

    const cancelError = { code: "CanceledError", message: "canceled" };
    expect(manager._isAbortError(cancelError)).toBe(true);

    expect(manager._isAbortError(new Error("Operation aborted"))).toBe(true);
    expect(manager._isAbortError(new Error("boom"))).toBe(false);
    expect(manager._isAbortError(null)).toBe(false);
  });

  it("schedules compression once for rapid consecutive calls", async () => {
    compressionMocks.shouldCompress.mockReturnValue(true);
    const manager = createManager({ asyncSummaryEnabled: false });
    const compressSpy = vi.spyOn(manager, "_compress").mockResolvedValue();

    manager._scheduleCompression();
    manager._scheduleCompression();
    await flushMicrotasks();

    expect(compressSpy).toHaveBeenCalledTimes(1);
  });

  it("respects compression cooldown delays", async () => {
    vi.useFakeTimers();
    compressionMocks.shouldCompress.mockReturnValue(true);
    const manager = createManager({
      asyncSummaryEnabled: false,
      contextConfig: { compressCooldownMs: 20 },
    });
    const compressSpy = vi.spyOn(manager, "_compress").mockResolvedValue();

    vi.setSystemTime(1000);
    manager._lastCompressionAtMs = 990;
    manager._scheduleCompression();

    expect(manager._compressionPending).toBe(false);
    expect(manager._compressionCooldownTimer).not.toBeNull();

    vi.advanceTimersByTime(20);
    await flushMicrotasks();

    expect(compressSpy).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("flushes compression rounds up to maxRounds and logs errors", async () => {
    const logger = { warn: vi.fn() };
    const manager = createManager({ logger, asyncSummaryEnabled: false });

    let calls = 0;
    compressionMocks.shouldCompress.mockImplementation(() => {
      calls += 1;
      return calls <= 2;
    });

    const compressSpy = vi.spyOn(manager, "_compress").mockResolvedValue();
    await manager.flushCompression({ maxRounds: 5 });
    expect(compressSpy).toHaveBeenCalledTimes(2);

    compressionMocks.shouldCompress.mockReturnValue(true);
    compressSpy.mockRejectedValue(new Error("boom"));
    await manager.flushCompression({ maxRounds: 1 });
    expect(logger.warn).toHaveBeenCalled();
  });

  it("waits for pending summaries and records compression updates", async () => {
    const emit = vi.fn();
    const manager = createManager({ asyncSummaryEnabled: false, emit });
    manager.addMessages([{ content: "hello" }, { content: "bye", _superseded: true }]);

    const deferred = createDeferred();
    manager._pendingSummaryPromises.set("1", deferred.promise);

    const compressPromise = manager._compress();
    expect(compressionMocks.maybeCompress).not.toHaveBeenCalled();

    deferred.resolve();
    await compressPromise;

    expect(compressionMocks.maybeCompress).toHaveBeenCalledTimes(1);
    expect(manager._compressionHistory).toHaveLength(1);
    expect(emit).toHaveBeenCalled();
  });

  it("skips compression updates when aborted", async () => {
    const manager = createManager({ asyncSummaryEnabled: false });
    manager.addMessages([{ content: "hello" }]);

    compressionMocks.maybeCompress.mockImplementation(async () => {
      manager._compressionAbortController.abort("stop");
      return { messages: [{ content: "new" }] };
    });

    await manager._compress();
    expect(manager.messages[0].content).toBe("hello");
    expect(manager._compressionHistory).toHaveLength(0);
  });

  it("reports errors when waiting for pending summaries", async () => {
    const manager = createManager({ asyncSummaryEnabled: false });
    const err = new Error("fail");
    manager._pendingSummaryPromises.set("1", Promise.reject(err));

    await manager._waitForPendingSummaries();
    expect(errorReporterMocks.report).toHaveBeenCalledWith(err, "_waitForPendingSummaries");
  });

  it("records compression metadata and emits events", () => {
    const emit = vi.fn();
    const manager = createManager({ emit, asyncSummaryEnabled: false });
    manager._tokenUsage.total = 7;
    manager._recordCompression(2, 5);

    expect(manager._compressionHistory).toHaveLength(1);
    const record = manager._compressionHistory[0];
    expect(record.beforeCount).toBe(2);
    expect(record.afterTokens).toBe(7);
    expect(typeof record.timestamp).toBe("number");
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it("returns status snapshots", () => {
    const manager = createManager({ asyncSummaryEnabled: false });
    manager.addMessage({ content: "hello" });
    const status = manager.getStatus();

    expect(status.messageCount).toBe(1);
    expect(status.tokenUsage.total).toBe(5);
    expect(status.contextWindow).toBe(1000);
    expect(status.fillRatio).toBeCloseTo(0.005);
  });

  it("wraps tool output using persisted output helpers", () => {
    const manager = createManager({ asyncSummaryEnabled: false });
    const output = manager.wrapToolOutput("data", { threshold: 5 });

    expect(output).toBe("wrapped:data:5");
    expect(persistedMocks.wrapPersistedOutput).toHaveBeenCalledWith("data", { threshold: 5 });
  });

  it("cleans old outputs and recomputes counts", () => {
    const manager = createManager({ asyncSummaryEnabled: false });
    manager.addMessages([
      { content: "first", _superseded: true },
      { content: "second" },
      { content: "third" },
    ]);

    persistedMocks.cleanOldPersistedOutputs.mockImplementation((messages) => messages.slice(-1));
    manager.cleanOldOutputs();

    expect(manager.messages).toHaveLength(1);
    expect(manager.supersededCount).toBe(0);
    expect(persistedMocks.cleanOldPersistedOutputs).toHaveBeenCalledWith(
      expect.any(Array),
      persistedMocks.KEEP_RECENT_OUTPUTS,
    );
  });

  it("decides whether to generate summaries based on content and tokens", () => {
    const manager = createManager({ asyncSummaryEnabled: false });

    const msg = { content: "short", _tokens: 99 };
    expect(manager._shouldGenerateSummary(msg)).toBe(false);

    const thinking = { content: "think", _tokens: 100, thinking: true };
    expect(manager._shouldGenerateSummary(thinking)).toBe(true);

    const long = { content: "long", _tokens: 201 };
    expect(manager._shouldGenerateSummary(long)).toBe(true);

    manager._pendingSummaries.add(long);
    expect(manager._shouldGenerateSummary(long)).toBe(false);
  });

  it("detects thinking messages from flags and content patterns", () => {
    const manager = createManager({ asyncSummaryEnabled: false });

    expect(manager._isThinkingMessage({ thinking: true, content: "x" })).toBe(true);
    expect(manager._isThinkingMessage({ internal: true, content: "x" })).toBe(true);
    expect(manager._isThinkingMessage({ type: "thinking", content: "x" })).toBe(true);
    expect(manager._isThinkingMessage({ content: "<think>plan" })).toBe(true);
    expect(manager._isThinkingMessage({ content: "analysis: plan" })).toBe(true);
    expect(manager._isThinkingMessage({ content: "   " })).toBe(false);
    expect(manager._isThinkingMessage(null)).toBe(false);
  });

  it("tracks concurrent async summaries and sets tokens", async () => {
    const deferred1 = createDeferred();
    const deferred2 = createDeferred();
    const summaryGenerator = vi.fn()
      .mockReturnValueOnce(deferred1.promise)
      .mockReturnValueOnce(deferred2.promise);

    const manager = createManager({ summaryGenerator });
    const msg1 = { content: "one", _tokens: 200 };
    const msg2 = { content: "two", _tokens: 200 };

    manager._scheduleAsyncSummary(msg1);
    manager._scheduleAsyncSummary(msg2);
    expect(manager._pendingSummaryPromises.size).toBe(2);

    deferred1.resolve("sum1");
    deferred2.resolve("sum2");
    await manager._waitForPendingSummaries();

    expect(msg1._summary).toBe("sum1");
    expect(msg2._summary).toBe("sum2");
    expect(msg1._summaryTokens).toBe(4);
    expect(manager._pendingSummaryPromises.size).toBe(0);
  });

  it("generates summaries asynchronously and handles aborts/errors", async () => {
    const summaryGenerator = vi.fn().mockResolvedValue("generated");
    const manager = createManager({ summaryGenerator });
    const message = { content: "content" };

    await manager._generateSummaryAsync(message);
    expect(message._summary).toBe("generated");

    const controller = new AbortController();
    controller.abort();
    const blockedMessage = { content: "blocked" };
    await manager._generateSummaryAsync(blockedMessage, controller.signal);
    expect(blockedMessage._summary).toBeUndefined();

    summaryGenerator.mockRejectedValue(new Error("bad"));
    await manager._generateSummaryAsync({ content: "error" });
    expect(errorReporterMocks.report).toHaveBeenCalled();
  });

  it("uses builtin summary generation when no custom generator is set", async () => {
    const manager = createManager({ summaryGenerator: null });
    const message = { content: "x".repeat(250) };

    await manager._generateSummaryAsync(message);
    expect(typeof message._summary).toBe("string");
  });

  it("creates builtin summaries for thinking and long messages", () => {
    const manager = createManager({ asyncSummaryEnabled: false });

    const thinkingMessage = {
      thinking: true,
      content: "Decide to ship\nConclusion: done",
    };
    const decisionSummary = manager._generateBuiltinSummary(thinkingMessage);
    expect(decisionSummary.startsWith("[决策]"))
      .toBe(true);

    const thinkingFallback = manager._generateBuiltinSummary({
      type: "thinking",
      content: "random thoughts",
    });
    expect(thinkingFallback.startsWith("[Thinking]"))
      .toBe(true);

    const longContent = "a".repeat(250);
    const longSummary = manager._generateBuiltinSummary({ content: longContent });
    expect(longSummary).toContain(" ... ");

    const shortSummary = manager._generateBuiltinSummary({ content: "short" });
    expect(shortSummary).toBeNull();
  });

  it("updates summary generator and async summary enabled flags", () => {
    const manager = createManager({ asyncSummaryEnabled: false });
    const generator = vi.fn();

    manager.setSummaryGenerator(generator);
    manager.setAsyncSummaryEnabled(true);

    expect(manager._summaryGenerator).toBe(generator);
    expect(manager._asyncSummaryEnabled).toBe(true);
  });

  it("disposes timers, compression, and summaries", () => {
    vi.useFakeTimers();
    const manager = createManager({ asyncSummaryEnabled: false });
    const timerSpy = vi.fn();
    manager._compressionCooldownTimer = setTimeout(timerSpy, 50);
    const compressionController = new AbortController();
    manager._compressionAbortController = compressionController;
    manager._summaryAbortController = new AbortController();
    manager._pendingSummaryPromises.set("1", Promise.resolve());
    manager._compressionPending = true;

    manager.dispose();

    expect(manager._disposed).toBe(true);
    expect(manager._compressionAbortController).toBeNull();
    expect(compressionController.signal.aborted).toBe(true);
    expect(manager._summaryAbortController).toBeNull();
    expect(manager._pendingSummaryPromises.size).toBe(0);
    expect(manager._compressionPending).toBe(false);

    vi.advanceTimersByTime(50);
    expect(timerSpy).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("aborts pending summaries and clears tracking", () => {
    const manager = createManager({ asyncSummaryEnabled: false });
    const controller = new AbortController();
    manager._summaryAbortController = controller;
    manager._pendingSummaryPromises.set("1", Promise.resolve());

    manager._abortPendingSummaries("reset");
    expect(controller.signal.aborted).toBe(true);
    expect(manager._summaryAbortController).toBeNull();
    expect(manager._pendingSummaryPromises.size).toBe(0);
  });

  it("falls back to fallback logger for empty correction when no logger provided", () => {
    const manager = createManager({ asyncSummaryEnabled: false });
    manager.addMessages([{ content: "a" }]);

    const count = manager.markAsSuperseded(0, 0, "");
    expect(count).toBe(0);
    expect(fallbackLogger.warn).toHaveBeenCalled();
  });

  it("runs compression immediately when cooldown is negative", async () => {
    compressionMocks.shouldCompress.mockReturnValue(true);
    const manager = createManager({ asyncSummaryEnabled: false, contextConfig: { compressCooldownMs: -1 } });
    const compressSpy = vi.spyOn(manager, "_compress").mockResolvedValue();

    manager._scheduleCompression();
    await flushMicrotasks();

    expect(compressSpy).toHaveBeenCalledTimes(1);
  });
});
