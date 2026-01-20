import { describe, it, expect, vi, beforeEach } from "vitest";
import ContextPredictorDefault, {
  ContextPredictor,
} from "../../../../../../js/agents/plugins/compression/impl/context-predictor.js";
import { estimateTokensCached } from "../../../../../../js/agents/shared/index.js";

vi.mock("../../../../../../js/agents/shared/index.js", () => ({
  estimateTokensCached: vi.fn(),
}));

describe("ContextPredictor", () => {
  let predictor;
  let estimateTokensCachedMock;

  beforeEach(() => {
    estimateTokensCachedMock = vi.mocked(estimateTokensCached);
    estimateTokensCachedMock.mockReset();
    estimateTokensCachedMock.mockImplementation((content) => content.length);
    predictor = new ContextPredictor();
  });

  it("clamps constructor options to safe ranges", () => {
    const upper = new ContextPredictor({
      contextWindow: 0,
      windowSize: -1,
      decayFactor: 2,
    });
    expect(upper._contextWindow).toBe(1000);
    expect(upper._windowSize).toBe(5);
    expect(upper._decayFactor).toBe(0.99);

    const lower = new ContextPredictor({
      contextWindow: -1,
      windowSize: 4.9,
      decayFactor: 0,
    });
    expect(lower._contextWindow).toBe(1000);
    expect(lower._windowSize).toBe(5);
    expect(lower._decayFactor).toBe(0.5);
  });

  it("records strings and message objects using content/text", () => {
    const tokens1 = predictor.record("hello");
    const tokens2 = predictor.record({ content: "world" });
    const tokens3 = predictor.record({ text: "!" });

    expect(tokens1).toBe(5);
    expect(tokens2).toBe(5);
    expect(tokens3).toBe(1);
    expect(estimateTokensCachedMock).toHaveBeenNthCalledWith(1, "hello");
    expect(estimateTokensCachedMock).toHaveBeenNthCalledWith(2, "world");
    expect(estimateTokensCachedMock).toHaveBeenNthCalledWith(3, "!");
  });

  it("handles nullish, empty, and whitespace messages", () => {
    const tokensNull = predictor.record(null);
    const tokensUndefined = predictor.record(undefined);
    const tokensEmptyString = predictor.record("");
    const tokensEmptyObject = predictor.record({});
    const tokensWhitespace = predictor.record("   ");
    const tokensZero = predictor.record(0);
    const tokensNegative = predictor.record(-1);

    expect(tokensNull).toBe(0);
    expect(tokensUndefined).toBe(0);
    expect(tokensEmptyString).toBe(0);
    expect(tokensEmptyObject).toBe(0);
    expect(tokensWhitespace).toBe(3);
    expect(tokensZero).toBe(0);
    expect(tokensNegative).toBe(0);
    expect(estimateTokensCachedMock.mock.calls.map(([arg]) => arg)).toEqual([
      "",
      "",
      "",
      "",
      "   ",
      "",
      "",
    ]);
  });

  it("handles long strings and deep nested objects", () => {
    const longMessage = "a".repeat(100000);
    const tokensLong = predictor.record(longMessage);
    const deepMessage = { content: { level1: { level2: { value: "x" } } } };
    const tokensDeep = predictor.record(deepMessage);

    expect(tokensLong).toBe(100000);
    expect(tokensDeep).toBe("[object Object]".length);
    expect(estimateTokensCachedMock).toHaveBeenNthCalledWith(1, longMessage);
    expect(estimateTokensCachedMock).toHaveBeenNthCalledWith(
      2,
      "[object Object]",
    );
  });

  it("recordBatch sums token counts and handles empty arrays", () => {
    estimateTokensCachedMock
      .mockReturnValueOnce(2)
      .mockReturnValueOnce(3)
      .mockReturnValueOnce(5);

    const total = predictor.recordBatch(["a", "b", "c"]);
    expect(total).toBe(10);
    expect(predictor.getStats().messageCount).toBe(3);

    const emptyTotal = predictor.recordBatch([]);
    expect(emptyTotal).toBe(0);
    expect(estimateTokensCachedMock).toHaveBeenCalledTimes(3);
  });

  it("recordBatch throws for non-iterables", () => {
    expect(() => predictor.recordBatch(null)).toThrow(TypeError);
    expect(() => predictor.recordBatch(undefined)).toThrow(TypeError);
    expect(() => predictor.recordBatch({})).toThrow(TypeError);
  });

  it("keeps a sliding window and computes weighted averages", () => {
    const local = new ContextPredictor({ windowSize: 5, decayFactor: 0.5 });
    estimateTokensCachedMock
      .mockReturnValueOnce(1)
      .mockReturnValueOnce(2)
      .mockReturnValueOnce(3)
      .mockReturnValueOnce(4)
      .mockReturnValueOnce(5)
      .mockReturnValueOnce(6);

    local.record("a");
    local.record("b");
    local.record("c");
    local.record("d");
    local.record("e");
    local.record("f");

    const tokens = [2, 3, 4, 5, 6];
    expect(local._recentTokenCounts).toEqual(tokens);
    const weights = tokens.map((_, index) =>
      Math.pow(0.5, tokens.length - 1 - index),
    );
    const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
    const valueSum = tokens.reduce(
      (sum, token, index) => sum + token * weights[index],
      0,
    );
    const expected = valueSum / weightSum;
    expect(local.getWeightedAverageTokens()).toBeCloseTo(expected, 6);
  });

  it("returns the default weighted average when no messages are recorded", () => {
    expect(predictor.getWeightedAverageTokens()).toBe(500);
  });

  it("getFillRatio uses numeric input and ignores string input", () => {
    const local = new ContextPredictor({ contextWindow: 1000 });
    estimateTokensCachedMock.mockReturnValueOnce(3);
    local.record("abc");

    expect(local.getFillRatio(10)).toBeCloseTo(0.01, 6);
    expect(local.getFillRatio("10")).toBeCloseTo(0.003, 6);
    expect(local.getFillRatio(-1)).toBeCloseTo(-0.001, 6);
  });

  it("predictRemainingMessages returns Infinity when average tokens are zero", () => {
    estimateTokensCachedMock.mockReturnValueOnce(0);
    predictor.record("");

    expect(predictor.getWeightedAverageTokens()).toBe(0);
    expect(predictor.predictRemainingMessages()).toBe(Infinity);
  });

  it("predictRemainingMessages floors and caps at zero when overfilled", () => {
    const local = new ContextPredictor({ contextWindow: 1000 });
    estimateTokensCachedMock.mockReturnValueOnce(10);
    local.record("x");

    expect(local.predictRemainingMessages(1500)).toBe(0);
    expect(local.predictRemainingMessages(500)).toBe(50);
  });

  it("getZone returns correct zones at boundary values", () => {
    expect(predictor.getZone(-0.1)).toBe("archive");
    expect(predictor.getZone(0)).toBe("archive");
    expect(predictor.getZone(0.2)).toBe("condensed");
    expect(predictor.getZone(0.5)).toBe("working");
    expect(predictor.getZone(0.8)).toBe("active");
  });

  it("predict returns a full result and honors compressThreshold", () => {
    const local = new ContextPredictor({ contextWindow: 1000 });
    estimateTokensCachedMock.mockReturnValueOnce(900);
    local.record("x");

    const result = local.predict();
    expect(result.currentTokens).toBe(900);
    expect(result.fillRatio).toBeCloseTo(0.9, 6);
    expect(result.avgMessageTokens).toBe(900);
    expect(result.predictedRemainingMessages).toBe(0);
    expect(result.shouldCompress).toBe(true);
    expect(result.zone).toBe("active");
  });

  it("predict uses provided tokens and custom threshold", () => {
    const local = new ContextPredictor({ contextWindow: 1000 });
    estimateTokensCachedMock.mockReturnValueOnce(200);
    local.record("x");

    const result = local.predict(400, { compressThreshold: 0.5 });
    expect(result.currentTokens).toBe(400);
    expect(result.fillRatio).toBeCloseTo(0.4, 6);
    expect(result.shouldCompress).toBe(false);
    expect(result.zone).toBe("condensed");
    expect(result.predictedRemainingMessages).toBe(3);
  });

  it("setContextWindow clamps and supports MAX_SAFE_INTEGER", () => {
    predictor.setContextWindow(0);
    expect(predictor._contextWindow).toBe(1000);

    predictor.setContextWindow(Number.MAX_SAFE_INTEGER);
    expect(predictor._contextWindow).toBe(Number.MAX_SAFE_INTEGER);
    expect(predictor.getFillRatio(Number.MAX_SAFE_INTEGER)).toBe(1);
  });

  it("reset clears state and getStats reports counts", () => {
    estimateTokensCachedMock
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(20);
    predictor.record("a");
    predictor.record("b");

    const stats = predictor.getStats();
    expect(stats.messageCount).toBe(2);
    expect(stats.totalTokens).toBe(30);
    expect(stats.windowSize).toBe(2);
    const expectedAvg = (10 * 0.9 + 20) / (0.9 + 1);
    expect(stats.avgTokens).toBeCloseTo(expectedAvg, 6);

    predictor.reset();
    expect(predictor.getStats()).toEqual({
      messageCount: 0,
      totalTokens: 0,
      avgTokens: 500,
      windowSize: 0,
    });
  });

  it("handles rapid consecutive record calls", () => {
    const local = new ContextPredictor({ contextWindow: 1000 });
    estimateTokensCachedMock.mockImplementation(() => 1);

    for (let i = 0; i < 100; i += 1) {
      local.record("x");
    }

    const stats = local.getStats();
    expect(stats.messageCount).toBe(100);
    expect(stats.totalTokens).toBe(100);
  });

  it("handles microtask-level concurrent record calls", async () => {
    const local = new ContextPredictor({ contextWindow: 1000 });
    estimateTokensCachedMock.mockImplementation(() => 1);

    await Promise.all(
      Array.from({ length: 50 }, () =>
        Promise.resolve().then(() => local.record("x")),
      ),
    );

    const stats = local.getStats();
    expect(stats.messageCount).toBe(50);
    expect(stats.totalTokens).toBe(50);
  });

  it("handles large batch inputs without exceeding window limits", () => {
    const local = new ContextPredictor({ windowSize: 5 });
    estimateTokensCachedMock.mockImplementation((content) => content.length);
    const messages = Array.from({ length: 1000 }, () => "x");

    const total = local.recordBatch(messages);
    const stats = local.getStats();

    expect(total).toBe(1000);
    expect(stats.messageCount).toBe(1000);
    expect(stats.totalTokens).toBe(1000);
    expect(stats.windowSize).toBe(5);
  });
});

describe("default export", () => {
  it("matches ContextPredictor", () => {
    expect(ContextPredictorDefault).toBe(ContextPredictor);
  });
});
