import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../../../js/agents/plugins/compression/impl/compression-async.js", () => ({
  compressAgentLoopMessagesAsync: vi.fn(),
}));

import { compressAgentLoopMessagesAsync } from "../../../../../../js/agents/plugins/compression/impl/compression-async.js";
import {
  CompressionCoordinator,
  computeFillRatio,
} from "../../../../../../js/agents/plugins/compression/impl/coordinator.js";

const compressionAsyncMock = vi.mocked(compressAgentLoopMessagesAsync);

beforeEach(() => {
  compressionAsyncMock.mockReset();
});

describe("computeFillRatio", () => {
  it("returns ratio for numeric inputs", () => {
    expect(computeFillRatio(50, 100)).toBeCloseTo(0.5, 6);
    expect(computeFillRatio(0, 100)).toBe(0);
  });

  it("returns 0 when contextWindow is falsy", () => {
    const cases = [0, null, undefined, ""];
    for (const contextWindow of cases) {
      expect(computeFillRatio(10, contextWindow)).toBe(0);
    }
  });

  it("coerces numeric strings and handles MAX_SAFE_INTEGER", () => {
    expect(computeFillRatio("100", "200")).toBeCloseTo(0.5, 6);
    expect(computeFillRatio(Number.MAX_SAFE_INTEGER, 1)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("handles negative context windows", () => {
    expect(computeFillRatio(10, -1)).toBe(-10);
  });

  it("handles whitespace strings and object inputs", () => {
    expect(computeFillRatio(10, "   ")).toBe(Infinity);
    expect(Number.isNaN(computeFillRatio({}, 10))).toBe(true);
  });
});

describe("CompressionCoordinator", () => {
  it("defaults to empty config and zero usage when options are missing or non-functions", () => {
    const coordinator = new CompressionCoordinator({
      getContextConfig: null,
      getTokenUsage: undefined,
      logger: null,
    });

    expect(coordinator._resolveTokenUsageTotal()).toBe(0);
    expect(coordinator.shouldCompress()).toBe(false);
  });

  it("_resolveTokenUsageTotal normalizes nullish and boundary values", () => {
    const cases = [
      { usage: { total: 0 }, expected: 0 },
      { usage: { total: -1 }, expected: 0 },
      { usage: { total: Number.MAX_SAFE_INTEGER }, expected: Number.MAX_SAFE_INTEGER },
      { usage: { total: "42" }, expected: 42 },
      { usage: { total: " " }, expected: 0 },
      { usage: "", expected: 0 },
      { usage: null, expected: 0 },
      { usage: undefined, expected: 0 },
      { usage: {}, expected: 0 },
      { usage: [], expected: 0 },
    ];

    for (const { usage, expected } of cases) {
      const coordinator = new CompressionCoordinator({
        getTokenUsage: () => usage,
      });
      expect(coordinator._resolveTokenUsageTotal()).toBe(expected);
    }
  });

  it("shouldCompress compares total against computed threshold", () => {
    let total = 50;
    const coordinator = new CompressionCoordinator({
      getContextConfig: () => ({ contextWindow: 100, compressThreshold: 0.5 }),
      getTokenUsage: () => ({ total }),
    });

    expect(coordinator.shouldCompress()).toBe(true);

    total = 49;
    expect(coordinator.shouldCompress()).toBe(false);
  });

  it("maybeCompress forwards options and returns compression result", async () => {
    const messages = [{ role: "user", content: "hi" }];
    const expectedResult = {
      messages: [{ role: "assistant", content: "done" }],
      sessionSummary: "summary",
      stats: { compressed: true },
      afterTokens: 12,
    };
    compressionAsyncMock.mockResolvedValue(expectedResult);

    const coordinator = new CompressionCoordinator({
      getContextConfig: () => ({
        contextWindow: 100,
        keepLastTurns: 2,
        titleOnlySummaryThreshold: 0.5,
        titleOnlySummaryMaxWords: 3,
        titleOnlySummaryMaxChars: 30,
        maxKeptMessageChars: 200,
        useCompressionWorker: true,
        workerThresholdMessages: 7,
      }),
      getTokenUsage: () => ({ total: 80 }),
    });

    const result = await coordinator.maybeCompress(messages);

    expect(result).toEqual(expectedResult);
    expect(compressionAsyncMock).toHaveBeenCalledTimes(1);
    expect(compressionAsyncMock).toHaveBeenCalledWith(
      messages,
      {
        keepLastTurns: 2,
        titleOnly: true,
        titleMaxWords: 3,
        titleMaxChars: 30,
        maxKeptMessageChars: 200,
      },
      { useWorker: true, workerThresholdMessages: 7 }
    );
  });

  it("maybeCompress uses default title threshold and runtime overrides", async () => {
    const controller = new AbortController();
    compressionAsyncMock.mockResolvedValue({
      messages: [],
      sessionSummary: null,
      stats: null,
      afterTokens: 0,
    });

    const coordinator = new CompressionCoordinator({
      getContextConfig: () => ({
        contextWindow: 100,
        titleOnlySummaryThreshold: "bad",
        useCompressionWorker: false,
        workerThresholdMessages: 11,
      }),
      getTokenUsage: () => ({ total: 70 }),
    });

    await coordinator.maybeCompress([{ role: "user", content: "hi" }], {
      useWorker: true,
      workerThresholdMessages: 99,
      signal: controller.signal,
    });

    expect(compressionAsyncMock).toHaveBeenCalledTimes(1);
    expect(compressionAsyncMock).toHaveBeenCalledWith(
      [{ role: "user", content: "hi" }],
      expect.objectContaining({ titleOnly: false }),
      expect.objectContaining({
        useWorker: true,
        workerThresholdMessages: 99,
        signal: controller.signal,
      })
    );
  });

  it("maybeCompress falls back on errors, logs, and handles non-array messages", async () => {
    const logger = { warn: vi.fn() };
    compressionAsyncMock.mockRejectedValue(new Error("boom"));

    const coordinator = new CompressionCoordinator({
      getContextConfig: () => ({ contextWindow: 100 }),
      getTokenUsage: () => ({ total: 1 }),
      logger,
    });

    const result = await coordinator.maybeCompress({});

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith("[CompressionCoordinator] Compression failed:", "boom");
    expect(result).toEqual({
      messages: [],
      sessionSummary: null,
      stats: null,
      afterTokens: undefined,
    });
  });

  it("handles concurrent compress calls with independent runtime options", async () => {
    compressionAsyncMock
      .mockResolvedValueOnce({ messages: ["a"], sessionSummary: null, stats: null, afterTokens: 1 })
      .mockResolvedValueOnce({ messages: ["b"], sessionSummary: null, stats: null, afterTokens: 2 });

    const coordinator = new CompressionCoordinator({
      getContextConfig: () => ({ contextWindow: 100, workerThresholdMessages: 5 }),
      getTokenUsage: () => ({ total: 20 }),
    });

    const messages1 = [{ role: "user", content: "first" }];
    const messages2 = [{ role: "assistant", content: "second" }];

    const [result1, result2] = await Promise.all([
      coordinator.maybeCompress(messages1, { useWorker: true, workerThresholdMessages: 1 }),
      coordinator.maybeCompress(messages2, { useWorker: false, workerThresholdMessages: 2 }),
    ]);

    expect(result1.messages).toEqual(["a"]);
    expect(result2.messages).toEqual(["b"]);
    expect(compressionAsyncMock).toHaveBeenCalledTimes(2);

    const calls = compressionAsyncMock.mock.calls;
    expect(calls).toEqual(
      expect.arrayContaining([
        [
          messages1,
          expect.any(Object),
          expect.objectContaining({ useWorker: true, workerThresholdMessages: 1 }),
        ],
        [
          messages2,
          expect.any(Object),
          expect.objectContaining({ useWorker: false, workerThresholdMessages: 2 }),
        ],
      ])
    );
  });

  it("handles rapid consecutive calls without leaking state", async () => {
    compressionAsyncMock.mockResolvedValue({
      messages: [],
      sessionSummary: null,
      stats: null,
      afterTokens: 0,
    });

    let total = 10;
    const coordinator = new CompressionCoordinator({
      getContextConfig: () => ({ contextWindow: 100 }),
      getTokenUsage: () => ({ total }),
    });

    const messages = [{ role: "user", content: "ping" }];

    await coordinator.maybeCompress(messages);
    total = 90;
    await coordinator.maybeCompress(messages);
    total = 100;
    await coordinator.maybeCompress(messages);

    expect(compressionAsyncMock).toHaveBeenCalledTimes(3);
    const titleOnlyValues = compressionAsyncMock.mock.calls.map((call) => call[1].titleOnly);
    expect(titleOnlyValues).toEqual([false, true, true]);
  });

  it("passes through large, deeply nested message payloads", async () => {
    const longText = "x".repeat(100000);
    const deepMessage = {
      role: "user",
      content: longText,
      meta: {
        level1: {
          level2: {
            level3: {
              items: [{ id: 1 }, { id: 2, inner: { value: "deep" } }],
            },
          },
        },
      },
    };
    const messages = [deepMessage, { role: "assistant", content: "ok" }];

    compressionAsyncMock.mockResolvedValue({
      messages: [],
      sessionSummary: null,
      stats: null,
      afterTokens: 0,
    });

    const coordinator = new CompressionCoordinator({
      getContextConfig: () => ({ contextWindow: 100 }),
      getTokenUsage: () => ({ total: 10 }),
    });

    await coordinator.maybeCompress(messages);

    expect(compressionAsyncMock).toHaveBeenCalledTimes(1);
    expect(compressionAsyncMock).toHaveBeenCalledWith(
      messages,
      expect.any(Object),
      expect.any(Object)
    );
  });
});
