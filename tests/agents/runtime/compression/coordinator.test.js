import { afterEach, describe, expect, it, vi } from "vitest";

// Coordinator depends on compressAgentLoopMessagesAsync. Mock it so we can test
// trigger logic and option wiring without running the actual compression.
vi.mock("../../../../js/agents/runtime/compression/compression-async.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    compressAgentLoopMessagesAsync: vi.fn(),
  };
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("runtime/compression/coordinator.js (plugins suite)", () => {
  it("falls back to default getters when options are omitted", async () => {
    const { CompressionCoordinator } = await import("../../../../js/agents/runtime/compression/coordinator.js");

    const coordinator = new CompressionCoordinator();

    // With empty/default config, threshold becomes NaN and shouldCompress should be false.
    expect(coordinator.shouldCompress()).toBe(false);
    expect(coordinator._resolveTokenUsageTotal()).toBe(0);
  });

  it("defaults useWorker=true when cfg.useCompressionWorker is not false and forwards cfg workerThresholdMessages", async () => {
    const compressionAsync = await import("../../../../js/agents/runtime/compression/compression-async.js");
    const { CompressionCoordinator } = await import("../../../../js/agents/runtime/compression/coordinator.js");

    compressionAsync.compressAgentLoopMessagesAsync.mockResolvedValue({
      messages: [],
      sessionSummary: null,
      stats: null,
      afterTokens: 0,
    });

    const coordinator = new CompressionCoordinator({
      getContextConfig: () => ({ contextWindow: 100, workerThresholdMessages: 7 }),
      getTokenUsage: () => ({ total: 50 }),
    });

    await coordinator.maybeCompress([{ role: "user", content: "hi" }], null);

    expect(compressionAsync.compressAgentLoopMessagesAsync).toHaveBeenCalledTimes(1);
    expect(compressionAsync.compressAgentLoopMessagesAsync).toHaveBeenCalledWith(
      [{ role: "user", content: "hi" }],
      expect.objectContaining({ titleOnly: false }),
      { useWorker: true, workerThresholdMessages: 7 }
    );
  });

  it("runtime options override worker settings and forwards AbortSignal", async () => {
    const compressionAsync = await import("../../../../js/agents/runtime/compression/compression-async.js");
    const { CompressionCoordinator } = await import("../../../../js/agents/runtime/compression/coordinator.js");

    compressionAsync.compressAgentLoopMessagesAsync.mockResolvedValue({
      messages: [],
      sessionSummary: null,
      stats: null,
      afterTokens: 0,
    });

    const controller = new AbortController();
    const coordinator = new CompressionCoordinator({
      getContextConfig: () => ({
        contextWindow: 100,
        useCompressionWorker: false,
        workerThresholdMessages: 7,
        titleOnlySummaryThreshold: 0.95,
      }),
      getTokenUsage: () => ({ total: 90 }),
    });

    await coordinator.maybeCompress([{ role: "user", content: "hi" }], {
      useWorker: true,
      workerThresholdMessages: 99,
      signal: controller.signal,
    });

    expect(compressionAsync.compressAgentLoopMessagesAsync).toHaveBeenCalledTimes(1);
    expect(compressionAsync.compressAgentLoopMessagesAsync).toHaveBeenCalledWith(
      [{ role: "user", content: "hi" }],
      expect.objectContaining({ titleOnly: false }),
      expect.objectContaining({
        useWorker: true,
        workerThresholdMessages: 99,
        signal: controller.signal,
      })
    );
  });

  it("falls back to the original array when compression throws and logger.warn is not a function", async () => {
    const compressionAsync = await import("../../../../js/agents/runtime/compression/compression-async.js");
    const { CompressionCoordinator } = await import("../../../../js/agents/runtime/compression/coordinator.js");

    compressionAsync.compressAgentLoopMessagesAsync.mockRejectedValue(new Error("boom"));

    const messages = [{ role: "user", content: "hi" }];
    const coordinator = new CompressionCoordinator({
      getContextConfig: () => ({ contextWindow: 100 }),
      getTokenUsage: () => ({ total: 1 }),
      logger: { warn: "nope" },
    });

    const result = await coordinator.maybeCompress(messages);

    expect(compressionAsync.compressAgentLoopMessagesAsync).toHaveBeenCalledTimes(1);
    expect(result.messages).toBe(messages);
    expect(result.sessionSummary).toBeNull();
    expect(result.stats).toBeNull();
    expect(result.afterTokens).toBeUndefined();
  });
});
