import { afterEach, describe, expect, it, vi } from "vitest";

// Mock only what's needed for coordinator tests, but keep real implementations
// for direct compression-async tests that use vi.importActual().
const mockCompressAgentLoopMessagesAsync = vi.fn();
vi.mock("../../../../js/agents/plugins/compression/impl/compression-async.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    // Only override when accessed through the mock (coordinator tests)
    // vi.importActual() will bypass this and get the real function
  };
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("plugins/compression/impl/coordinator.js", () => {
  it("computeFillRatio handles empty contextWindow", async () => {
    const { computeFillRatio } = await import("../../../../js/agents/plugins/compression/impl/coordinator.js");
    expect(computeFillRatio(10, 0)).toBe(0);
    expect(computeFillRatio(10, undefined)).toBe(0);
    expect(computeFillRatio(10, 20)).toBeCloseTo(0.5);
  });

  it("normalizes token usage totals and shouldCompress threshold", async () => {
    const { CompressionCoordinator } = await import("../../../../js/agents/plugins/compression/impl/coordinator.js");

    const cObj = new CompressionCoordinator({ getTokenUsage: () => ({ total: "42" }) });
    expect(cObj._resolveTokenUsageTotal()).toBe(42);

    const cNegObj = new CompressionCoordinator({ getTokenUsage: () => ({ total: -1 }) });
    expect(cNegObj._resolveTokenUsageTotal()).toBe(0);

    const cPrimitive = new CompressionCoordinator({ getTokenUsage: () => "12" });
    expect(cPrimitive._resolveTokenUsageTotal()).toBe(12);

    const cBad = new CompressionCoordinator({ getTokenUsage: () => ({ total: "nope" }) });
    expect(cBad._resolveTokenUsageTotal()).toBe(0);

    const should = new CompressionCoordinator({
      getContextConfig: () => ({ contextWindow: 1000, compressThreshold: 0.75 }),
      getTokenUsage: () => ({ total: 800 }),
    });
    expect(should.shouldCompress()).toBe(true);

    const shouldNot = new CompressionCoordinator({
      getContextConfig: () => ({ contextWindow: 1000, compressThreshold: 0.75 }),
      getTokenUsage: () => ({ total: 700 }),
    });
    expect(shouldNot.shouldCompress()).toBe(false);

    const nanThreshold = new CompressionCoordinator({
      getContextConfig: () => ({ contextWindow: 1000 }),
      getTokenUsage: () => ({ total: 9999 }),
    });
    expect(nanThreshold.shouldCompress()).toBe(false);
  });

  it("maybeCompress forwards derived options to compression", async () => {
    const compressionAsync = await import("../../../../js/agents/plugins/compression/impl/compression-async.js");
    compressionAsync.compressAgentLoopMessagesAsync = mockCompressAgentLoopMessagesAsync;
    const { CompressionCoordinator } = await import("../../../../js/agents/plugins/compression/impl/coordinator.js");

    const expected = { messages: [{ role: "assistant", content: "ok" }], sessionSummary: "s", stats: { ok: true }, afterTokens: 123 };
    compressionAsync.compressAgentLoopMessagesAsync.mockResolvedValue(expected);

    const coordinator = new CompressionCoordinator({
      getContextConfig: () => ({
        contextWindow: 100,
        compressThreshold: 0.5,
        keepLastTurns: 3,
        titleOnlySummaryThreshold: 0.8,
        titleOnlySummaryMaxWords: 7,
        titleOnlySummaryMaxChars: 42,
        maxKeptMessageChars: 1000,
        useCompressionWorker: false,
        workerThresholdMessages: 25,
      }),
      getTokenUsage: () => ({ total: 90 }),
    });

    const messages = [{ role: "user", content: "hello" }];
    const result = await coordinator.maybeCompress(messages);

    expect(result).toBe(expected);
    expect(compressionAsync.compressAgentLoopMessagesAsync).toHaveBeenCalledTimes(1);
    expect(compressionAsync.compressAgentLoopMessagesAsync).toHaveBeenCalledWith(
      messages,
      {
        keepLastTurns: 3,
        titleOnly: true,
        titleMaxWords: 7,
        titleMaxChars: 42,
        maxKeptMessageChars: 1000,
      },
      { useWorker: false, workerThresholdMessages: 25 }
    );
  });

  it("maybeCompress logs and falls back when compression throws", async () => {
    const compressionAsync = await import("../../../../js/agents/plugins/compression/impl/compression-async.js");
    compressionAsync.compressAgentLoopMessagesAsync = mockCompressAgentLoopMessagesAsync;
    const { CompressionCoordinator } = await import("../../../../js/agents/plugins/compression/impl/coordinator.js");

    compressionAsync.compressAgentLoopMessagesAsync.mockRejectedValue(new Error("boom"));
    const logger = { warn: vi.fn() };

    const coordinator = new CompressionCoordinator({
      getContextConfig: () => ({
        contextWindow: 100,
        titleOnlySummaryThreshold: "bad",
      }),
      getTokenUsage: () => ({ total: 79 }),
      logger,
    });

    const result = await coordinator.maybeCompress("not an array");

    expect(compressionAsync.compressAgentLoopMessagesAsync).toHaveBeenCalledTimes(1);
    expect(compressionAsync.compressAgentLoopMessagesAsync.mock.calls[0][1].titleOnly).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith("[CompressionCoordinator] Compression failed:", "boom");
    expect(result).toEqual({ messages: [], sessionSummary: null, stats: null, afterTokens: undefined });
  });
});

describe("plugins/compression/impl/compression-async.js", () => {
  it("isCompressionWorkerAvailable is false in Node-like runtimes", async () => {
    const { isCompressionWorkerAvailable } = await vi.importActual(
      "../../../../js/agents/plugins/compression/impl/compression-async.js"
    );
    expect(isCompressionWorkerAvailable()).toBe(false);
  });

  it("compressSessionHistoryAsync throws when aborted", async () => {
    const { compressSessionHistoryAsync } = await vi.importActual(
      "../../../../js/agents/plugins/compression/impl/compression-async.js"
    );

    const controller = new AbortController();
    controller.abort();

    await expect(
      compressSessionHistoryAsync([{ role: "user", content: "test" }], {}, { signal: controller.signal })
    ).rejects.toThrow(/aborted/i);
  });

  it("compressSessionHistorySync merges, filters thinking, anchors system, and summarizes older", async () => {
    const { compressSessionHistorySync } = await vi.importActual(
      "../../../../js/agents/plugins/compression/impl/compression-async.js"
    );

    const messages = [
      { role: "system", content: "You are an assistant" },
      { role: "user", content: "A" },
      { role: "assistant", content: "B" },
      { role: "assistant", content: "C" },
      { role: "assistant", content: "D", name: "x" }, // not merge-safe
      { role: "user", text: 123 },
      "E", // normalize string message
      { role: "assistant", content: "<think>hidden</think>", thinking: true },
      { role: "tool", content: "T1" },
      null, // normalize invalid message
      { role: "tool", content: "T2" },
      { role: "tool", content: "T3" },
      { role: "assistant", content: "F" },
    ];

    const result = compressSessionHistorySync(messages, { keepLastTurns: 4, summaryLineChars: 10 });

    expect(result.stats.totalMessages).toBe(messages.length);
    expect(result.stats.removedThinking).toBe(1);
    expect(result.stats.mergedMessages).toBe(1);
    expect(result.stats.summarizedMessages).toBeGreaterThan(0);
    expect(result.stats.keptMessages).toBe(result.messages.length);

    expect(result.messages[0]).toMatchObject({ role: "system", content: "You are an assistant" });
    expect(result.messages.filter((m) => m?.role === "tool")).toHaveLength(2);
    expect(result.sessionSummary).toContain("user:");
    expect(result.sessionSummary).toContain("user: 123");
    expect(typeof result.afterTokens).toBe("number");
  });

  it("compressSessionHistorySync truncates without ellipsis when summaryLineChars <= 3", async () => {
    const { compressSessionHistorySync } = await vi.importActual(
      "../../../../js/agents/plugins/compression/impl/compression-async.js"
    );

    const result = compressSessionHistorySync(
      [
        { role: "user", content: "abcdef" },
        { role: "assistant", content: "ghijkl" },
      ],
      { keepLastTurns: 1, summaryLineChars: 2 }
    );

    expect(result.sessionSummary).toContain("user: ab");
    expect(result.sessionSummary).not.toContain("...");
  });

  it("compressSessionHistorySync supports titleOnly mode with CJK + English", async () => {
    const { compressSessionHistorySync } = await vi.importActual(
      "../../../../js/agents/plugins/compression/impl/compression-async.js"
    );

    const result = compressSessionHistorySync(
      [
        { role: "user", content: "这是一个非常非常长的中文句子，用于测试标题摘要是否截断" },
        { role: "assistant", content: "This is an English message with many words that should be shortened" },
        { role: "user", content: "tail" },
      ],
      { keepLastTurns: 1, titleOnly: true, titleMaxWords: 3, titleMaxChars: 12 }
    );

    expect(result.sessionSummary).toBeTypeOf("string");
    expect(result.sessionSummary.split("\n").some((line) => line.includes("..."))).toBe(true);
  });

  it("compressAgentLoopMessagesAsync moves prior summary to the end and sanitizes kept messages", async () => {
    const compressionModule = await vi.importActual(
      "../../../../js/agents/plugins/compression/impl/compression-async.js"
    );
    const { compressAgentLoopMessagesAsync } = compressionModule;

    const priorSummaryMsg = { role: "system", content: "[Context Summary]\nPrior summary text" };
    const longSystemAnchor = `System anchor ${"z".repeat(200)}`;
    const prettyJson = JSON.stringify(
      { persistedOutput: { preview: "x".repeat(120), other: { ok: true } } },
      null,
      2
    );

    const messages = [
      priorSummaryMsg,
      { role: "system", content: longSystemAnchor },
      { role: "user", content: `${prettyJson}\n${"y".repeat(200)}` },
      { role: "assistant", content: "ok" },
    ];

    const result = await compressAgentLoopMessagesAsync(
      messages,
      { keepLastTurns: 10, maxKeptMessageChars: 80 },
      { useWorker: false }
    );

    // The original summary should be excluded from compression input and re-appended at the end.
    expect(result.messages[0]).toMatchObject({ role: "system", content: longSystemAnchor });
    expect(result.messages[result.messages.length - 1]).toMatchObject(priorSummaryMsg);
    expect(result.sessionSummary).toBe("Prior summary text");

    // System messages should not be sanitized even if long.
    expect(result.messages[0].content).toBe(longSystemAnchor);

    // User content should be sanitized (preview omitted + truncated).
    const userMsg = result.messages.find((m) => m?.role === "user");
    expect(userMsg.content).toContain("(omitted)");
    expect(userMsg.content).toContain("...(truncated)");
  });

  it("compressAgentLoopMessagesAsync does not sanitize when maxKeptMessageChars is 0", async () => {
    const { compressAgentLoopMessagesAsync } = await vi.importActual(
      "../../../../js/agents/plugins/compression/impl/compression-async.js"
    );

    const prettyJson = JSON.stringify({ persistedOutput: { preview: "x".repeat(20) } }, null, 2);
    const messages = [{ role: "user", content: prettyJson }];

    const result = await compressAgentLoopMessagesAsync(messages, { keepLastTurns: 10, maxKeptMessageChars: 0 }, { useWorker: false });

    const userMsg = result.messages.find((m) => m?.role === "user");
    expect(userMsg.content).toContain("\"persistedOutput\"");
    expect(userMsg.content).not.toContain("(omitted)");
    expect(userMsg.content).not.toContain("...(truncated)");
  });

  it("compressAgentLoopMessagesAsync treats non-array input as empty list", async () => {
    const { compressAgentLoopMessagesAsync } = await vi.importActual(
      "../../../../js/agents/plugins/compression/impl/compression-async.js"
    );

    const result = await compressAgentLoopMessagesAsync(null, { keepLastTurns: 10 }, { useWorker: false });
    expect(result.messages).toEqual([]);
    expect(result.sessionSummary).toBe(null);
  });
});
