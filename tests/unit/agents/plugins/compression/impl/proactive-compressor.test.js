import { describe, it, expect, vi, beforeEach } from "vitest";

let predictorInstances = [];
let zoneManagerInstances = [];
let loggerInstances = [];

vi.mock("../../../../../../js/agents/plugins/compression/impl/context-predictor.js", () => {
  class ContextPredictor {
    constructor(options = {}) {
      this.options = options;
      this._contextWindow = options.contextWindow ?? 0;
      this.predict = vi.fn((currentTokens) => ({
        shouldCompress: false,
        fillRatio: 0,
        zone: "working",
        currentTokens,
      }));
      this.record = vi.fn(() => 0);
      this.setContextWindow = vi.fn((value) => {
        this._contextWindow = value;
      });
      this.getStats = vi.fn(() => ({ messageCount: 0 }));
      this.reset = vi.fn();
      predictorInstances.push(this);
    }
  }
  return { ContextPredictor };
});

vi.mock(
  "../../../../../../js/agents/plugins/compression/impl/adaptive-zone-manager.js",
  () => {
    class AdaptiveZoneManager {
      constructor() {
        this.getBoundaries = vi.fn(() => ({ active: 0.8, archive: 0.1 }));
        this.reset = vi.fn();
        zoneManagerInstances.push(this);
      }
    }
    return { AdaptiveZoneManager };
  },
);

vi.mock("../../../../../../js/agents/shared/index.js", () => {
  return {
    estimateTokensCached: vi.fn((content) => String(content).length),
    createLogger: vi.fn((name) => {
      const logger = {
        info: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
        error: vi.fn(),
      };
      loggerInstances.push({ name, logger });
      return logger;
    }),
  };
});

const modulePath =
  "../../../../../../js/agents/plugins/compression/impl/proactive-compressor.js";
const sharedPath = "../../../../../../js/agents/shared/index.js";

beforeEach(() => {
  predictorInstances = [];
  zoneManagerInstances = [];
  loggerInstances = [];
  vi.clearAllMocks();
  vi.resetModules();
});

describe("autoSelectPreset", () => {
  it("selects presets at boundary values", async () => {
    const { autoSelectPreset } = await import(modulePath);

    expect(autoSelectPreset(-1)).toBe("aggressive");
    expect(autoSelectPreset(0)).toBe("aggressive");
    expect(autoSelectPreset(15999)).toBe("aggressive");
    expect(autoSelectPreset(16000)).toBe("balanced");
    expect(autoSelectPreset(63999)).toBe("balanced");
    expect(autoSelectPreset(64000)).toBe("conservative");
    expect(autoSelectPreset(Number.MAX_SAFE_INTEGER)).toBe("conservative");
  });
});

describe("ProactiveCompressor", () => {
  it("clamps constructor values, applies presets, and exports default", async () => {
    const module = await import(modulePath);
    const { ProactiveCompressor, PRESETS, default: DefaultExport } = module;

    const compressor = new ProactiveCompressor({
      contextWindow: 5000,
      compressThreshold: -1,
      targetFillRatio: 1,
      keepLastTurns: -5,
    });

    expect(compressor._contextWindow).toBe(5000);
    expect(compressor._compressThreshold).toBe(0.5);
    expect(compressor._targetFillRatio).toBe(0.7);
    expect(compressor._keepLastTurns).toBe(2);
    expect(predictorInstances[0].options).toEqual({ contextWindow: 5000 });

    const preset = new ProactiveCompressor({
      preset: "aggressive",
      compressThreshold: 0.99,
      targetFillRatio: 0.99,
      keepLastTurns: 99,
    });

    expect(preset._compressThreshold).toBe(PRESETS.aggressive.compressThreshold);
    expect(preset._targetFillRatio).toBe(PRESETS.aggressive.targetFillRatio);
    expect(preset._keepLastTurns).toBe(PRESETS.aggressive.keepLastTurns);
    expect(DefaultExport).toBe(ProactiveCompressor);
  });

  it("delegates shouldCompress to predictor and forwards prediction", async () => {
    const { ProactiveCompressor } = await import(modulePath);
    const compressor = new ProactiveCompressor();
    const prediction = {
      shouldCompress: true,
      fillRatio: 0.91,
      zone: "active",
    };

    compressor._predictor.predict.mockReturnValue(prediction);

    const result = compressor.shouldCompress(0);
    expect(compressor._predictor.predict).toHaveBeenCalledWith(0, {
      compressThreshold: compressor._compressThreshold,
    });
    expect(result).toEqual({
      shouldCompress: true,
      fillRatio: 0.91,
      zone: "active",
      prediction,
    });

    compressor.shouldCompress(-1);
    compressor.shouldCompress(Number.MAX_SAFE_INTEGER);
    compressor.shouldCompress();

    expect(compressor._predictor.predict).toHaveBeenNthCalledWith(2, -1, {
      compressThreshold: compressor._compressThreshold,
    });
    expect(compressor._predictor.predict).toHaveBeenNthCalledWith(
      3,
      Number.MAX_SAFE_INTEGER,
      { compressThreshold: compressor._compressThreshold },
    );
    expect(compressor._predictor.predict).toHaveBeenNthCalledWith(4, undefined, {
      compressThreshold: compressor._compressThreshold,
    });
  });

  it("records messages via predictor.record", async () => {
    const { ProactiveCompressor } = await import(modulePath);
    const compressor = new ProactiveCompressor();

    compressor._predictor.record
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(1)
      .mockReturnValueOnce(2);

    expect(compressor.recordMessage(null)).toBe(0);
    expect(compressor.recordMessage("")).toBe(1);
    expect(compressor.recordMessage({ content: "ok" })).toBe(2);
    expect(compressor._predictor.record).toHaveBeenNthCalledWith(1, null);
    expect(compressor._predictor.record).toHaveBeenNthCalledWith(2, "");
    expect(compressor._predictor.record).toHaveBeenNthCalledWith(3, {
      content: "ok",
    });
  });

  it("configures presets, auto presets, clamps values, and ignores invalid types", async () => {
    const { ProactiveCompressor, PRESETS } = await import(modulePath);
    const compressor = new ProactiveCompressor({
      contextWindow: 1000,
      compressThreshold: 0.6,
      targetFillRatio: 0.4,
      keepLastTurns: 5,
    });

    compressor.configure({ preset: "conservative" });
    expect(compressor._compressThreshold).toBe(
      PRESETS.conservative.compressThreshold,
    );
    expect(compressor._targetFillRatio).toBe(
      PRESETS.conservative.targetFillRatio,
    );
    expect(compressor._keepLastTurns).toBe(PRESETS.conservative.keepLastTurns);

    compressor.configure({ preset: "auto", contextWindow: 8000 });
    expect(compressor._contextWindow).toBe(8000);
    expect(compressor._compressThreshold).toBe(
      PRESETS.aggressive.compressThreshold,
    );

    compressor.configure({ contextWindow: Number.MAX_SAFE_INTEGER });
    expect(compressor._contextWindow).toBe(Number.MAX_SAFE_INTEGER);
    expect(compressor._predictor.setContextWindow).toHaveBeenCalledWith(
      Number.MAX_SAFE_INTEGER,
    );

    compressor.configure({
      compressThreshold: 0,
      targetFillRatio: 0,
      keepLastTurns: -1,
      memoryStore: null,
    });
    expect(compressor._compressThreshold).toBe(0.5);
    expect(compressor._targetFillRatio).toBe(0.15);
    expect(compressor._keepLastTurns).toBe(2);
    expect(compressor._memoryStore).toBeNull();

    const before = {
      compressThreshold: compressor._compressThreshold,
      targetFillRatio: compressor._targetFillRatio,
      keepLastTurns: compressor._keepLastTurns,
    };
    compressor.configure({
      compressThreshold: "0.9",
      targetFillRatio: "0.2",
      keepLastTurns: "3",
    });
    expect(compressor._compressThreshold).toBe(before.compressThreshold);
    expect(compressor._targetFillRatio).toBe(before.targetFillRatio);
    expect(compressor._keepLastTurns).toBe(before.keepLastTurns);
  });

  it("returns stats, exposes session summary, and resets state", async () => {
    const { ProactiveCompressor } = await import(modulePath);
    const compressor = new ProactiveCompressor();

    compressor._sessionSummary = "summary";
    compressor._archives = [
      { summary: "a", timestamp: 1, messageRange: [0, 0] },
    ];

    const stats = compressor.getStats();
    expect(stats.predictor).toEqual({ messageCount: 0 });
    expect(stats.boundaries).toEqual({ active: 0.8, archive: 0.1 });
    expect(stats.archiveCount).toBe(1);
    expect(stats.hasSessionSummary).toBe(true);
    expect(stats.config.keepLastTurns).toBe(compressor._keepLastTurns);
    expect(compressor.getSessionSummary()).toBe("summary");

    compressor.reset();
    expect(compressor._sessionSummary).toBeNull();
    expect(compressor._archives).toEqual([]);
    expect(compressor._lastCompressTs).toBe(0);
    expect(compressor._predictor.reset).toHaveBeenCalled();
    expect(compressor._zoneManager.reset).toHaveBeenCalled();
  });

  it("returns empty results for nullish or non-array messages", async () => {
    const { ProactiveCompressor } = await import(modulePath);
    const compressor = new ProactiveCompressor();

    const results = await Promise.all([
      compressor.compress(null),
      compressor.compress(undefined),
      compressor.compress([]),
      compressor.compress({}),
    ]);

    for (const result of results) {
      expect(result.messages).toEqual([]);
      expect(result.compressed).toBe(false);
      expect(result.stats.skipped).toBe(true);
    }
    expect(compressor._predictor.predict).not.toHaveBeenCalled();
  });

  it("skips compression when not needed and not forced", async () => {
    const { ProactiveCompressor } = await import(modulePath);
    const shared = await import(sharedPath);
    const compressor = new ProactiveCompressor();

    compressor._predictor.predict.mockReturnValue({
      shouldCompress: false,
      fillRatio: 0.2,
      zone: "working",
    });

    const messages = ["", "   ", { content: "hi" }];
    const result = await compressor.compress(messages);

    expect(result.compressed).toBe(false);
    expect(result.messages).toBe(messages);
    expect(result.stats.skipped).toBe(true);
    expect(result.stats.fillRatio).toBe(0.2);
    expect(result.stats.zone).toBe("working");
    expect(shared.estimateTokensCached).toHaveBeenCalledWith("");
    expect(shared.estimateTokensCached).toHaveBeenCalledWith("   ");
    expect(shared.estimateTokensCached).toHaveBeenCalledWith("hi");
  });

  it("compresses with summaries, archives, and event emission", async () => {
    const { ProactiveCompressor } = await import(modulePath);
    const memoryStore = { archive: vi.fn().mockResolvedValue("l3-1") };
    const eventBus = { emit: vi.fn() };
    const compressor = new ProactiveCompressor({
      contextWindow: 200,
      targetFillRatio: 0.5,
      keepLastTurns: 2,
      memoryStore,
      eventBus,
    });

    compressor._predictor.predict.mockReturnValue({
      shouldCompress: true,
      fillRatio: 0.95,
      zone: "active",
    });

    const messages = [
      { id: "m1", content: "a", _tokens: 10 },
      { id: "m2", content: "b", _tokens: 20 },
      { id: "m3", content: "c", _tokens: 40 },
      {
        id: "m4",
        content: "d",
        _tokens: 80,
        _summary: "m4 summary",
        _summaryTokens: 10,
      },
      { id: "m5", content: "e", _tokens: 80 },
      { id: "m6", content: "f", _tokens: 5 },
      { id: "m7", content: "g", _tokens: 5 },
    ];

    const result = await compressor.compress(messages);

    expect(result.compressed).toBe(true);
    expect(result.stats.kept).toBe(3);
    expect(result.stats.summarized).toBe(1);
    expect(result.stats.archived).toBe(1);
    expect(result.archivedIds).toEqual(["l3-1"]);
    expect(result.messages).toHaveLength(6);
    expect(result.messages.slice(-2)).toEqual([messages[5], messages[6]]);
    expect(result.messages[3].content).toBe("m4 summary");
    expect(result.messages[3]._compressed).toBe(true);
    expect(result.messages[3]._originalTokens).toBe(80);
    expect(compressor.getSessionSummary()).toContain("Archived 1 messages");
    expect(compressor._lastCompressTs).toBeGreaterThan(0);
    expect(memoryStore.archive).toHaveBeenCalledTimes(1);
    expect(memoryStore.archive).toHaveBeenCalledWith(
      expect.stringMatching(/^proactive-/),
      expect.any(Object),
      expect.any(Array),
    );
    expect(eventBus.emit).toHaveBeenCalledWith(
      "compression:complete",
      expect.objectContaining({
        actor: "proactive-compressor",
        payload: expect.any(Object),
      }),
    );
  });

  it("allocates budget across keep, summarize, and archive strategies", async () => {
    const { ProactiveCompressor } = await import(modulePath);
    const compressor = new ProactiveCompressor({
      contextWindow: 200,
      targetFillRatio: 0.5,
      keepLastTurns: 2,
    });

    const messages = [
      { id: "m1" },
      { id: "m2" },
      { id: "m3" },
      { id: "m4" },
      { id: "m5" },
      { id: "m6" },
      { id: "m7" },
    ];
    const tokens = [10, 20, 40, 80, 80, 5, 5];
    const totalTokens = tokens.reduce((sum, value) => sum + value, 0);

    const { decisions, activeMessages, activeTokens } =
      compressor._allocateBudget(messages, tokens, totalTokens);

    expect(activeMessages).toEqual(messages.slice(-2));
    expect(activeTokens).toBe(10);
    expect(decisions.map((decision) => decision.strategy)).toEqual([
      "keep",
      "keep",
      "keep",
      "summarize",
      "archive",
    ]);
    expect(decisions[3].tokens).toBe(20);
  });

  it("computes tokens for large strings, empty values, and deep nesting", async () => {
    const { ProactiveCompressor } = await import(modulePath);
    const shared = await import(sharedPath);
    const compressor = new ProactiveCompressor();

    const hugeText = "a".repeat(100000);
    const deepObject = { content: { level1: { level2: { value: "x" } } } };
    const messages = [
      { content: "short", _tokens: 42 },
      hugeText,
      deepObject,
      "",
      {},
    ];

    const tokens = compressor._computeMessageTokens(messages);

    expect(tokens).toEqual([
      42,
      100000,
      "[object Object]".length,
      0,
      0,
    ]);
    expect(shared.estimateTokensCached).toHaveBeenCalledWith(hugeText);
    expect(shared.estimateTokensCached).toHaveBeenCalledWith("[object Object]");
    expect(shared.estimateTokensCached).toHaveBeenCalledWith("");
  });

  it("estimates summary tokens with overrides and boundary values", async () => {
    const { ProactiveCompressor } = await import(modulePath);
    const compressor = new ProactiveCompressor();

    expect(compressor._estimateSummaryTokens({ _summaryTokens: 7 }, 100)).toBe(
      7,
    );
    expect(compressor._estimateSummaryTokens({}, 0)).toBe(20);
    expect(compressor._estimateSummaryTokens({}, -1)).toBe(20);
  });

  it("summarizes messages with precomputed summaries, thinking, and truncation", async () => {
    const { ProactiveCompressor } = await import(modulePath);
    const compressor = new ProactiveCompressor();

    const precomputed = {
      content: "original",
      _summary: "summary",
      _tokens: 50,
    };
    const summarized = compressor._toSummaryMessage(precomputed);
    expect(summarized.content).toBe("summary");
    expect(summarized._compressed).toBe(true);
    expect(summarized._originalTokens).toBe(50);

    const thinking = { content: "<analysis>\nDecide to ship" };
    const thinkingSummary = compressor._toSummaryMessage(thinking);
    expect(thinkingSummary._thinkingSummarized).toBe(true);
    expect(thinkingSummary.content).toContain("Decide");

    const longMessage = { content: "x".repeat(500) };
    const truncated = compressor._toSummaryMessage(longMessage);
    expect(truncated._truncated).toBe(true);
    expect(truncated.content.length).toBeLessThanOrEqual(200);
  });

  it("detects thinking messages and ignores whitespace content", async () => {
    const { ProactiveCompressor } = await import(modulePath);
    const compressor = new ProactiveCompressor();

    const cases = [
      [null, false],
      ["text", false],
      [{}, false],
      [{ content: "   " }, false],
      [{ thinking: true }, true],
      [{ internal: true }, true],
      [{ type: "thinking" }, true],
      [{ meta: { type: "thinking" } }, true],
      [{ content: "<analysis> hi" }, true],
      [{ content: "internal: note" }, true],
    ];

    for (const [input, expected] of cases) {
      expect(compressor._isThinkingMessage(input)).toBe(expected);
    }
  });

  it("generates archive summaries and extracts keywords", async () => {
    const { ProactiveCompressor } = await import(modulePath);
    const compressor = new ProactiveCompressor();

    const longContent = "a".repeat(80);
    const messages = Array.from({ length: 12 }, (_, index) => ({
      role: index === 0 ? "empty-role" : "user",
      content:
        index === 0
          ? "   "
          : index === 1
            ? longContent
            : `Alpha beta gamma delta message ${index}`,
    }));

    const summary = compressor._generateArchiveSummary(messages);
    expect(summary).toContain("[Archived 12 messages]");
    expect(summary).toContain("... and 2 more");
    expect(summary).not.toContain("[empty-role]");
    expect(summary).not.toContain(longContent);

    const keywords = compressor._extractKeywords(messages);
    expect(keywords).toContain("alpha");
    expect(keywords).toContain("beta");
    expect(keywords).toContain("gamma");
    expect(keywords).toContain("delta");
    expect(keywords.length).toBeLessThanOrEqual(20);
    expect(keywords).not.toContain("ALPHA");
  });

  it("archives locally when memoryStore fails", async () => {
    const { ProactiveCompressor } = await import(modulePath);
    const memoryStore = {
      archive: vi.fn().mockRejectedValue(new Error("boom")),
    };
    const compressor = new ProactiveCompressor({ memoryStore });

    const result = await compressor._archiveMessages([
      { role: "user", content: "hello" },
    ]);

    expect(result.id).toMatch(/^local-/);
    expect(result.summary).toContain("Archived 1 messages");
    expect(loggerInstances[0].logger.warn).toHaveBeenCalled();
  });

  it("handles concurrent compress calls", async () => {
    const { ProactiveCompressor } = await import(modulePath);
    let callIndex = 0;
    const memoryStore = {
      archive: vi.fn().mockImplementation(async () => `id-${++callIndex}`),
    };
    const compressor = new ProactiveCompressor({
      contextWindow: 10,
      targetFillRatio: 0.2,
      keepLastTurns: 2,
      memoryStore,
    });

    compressor._predictor.predict.mockReturnValue({
      shouldCompress: true,
      fillRatio: 0.9,
      zone: "active",
    });

    const messagesA = [
      { content: "A1", _tokens: 50 },
      { content: "A2", _tokens: 1 },
      { content: "A3", _tokens: 1 },
    ];
    const messagesB = [
      { content: "B1", _tokens: 60 },
      { content: "B2", _tokens: 1 },
      { content: "B3", _tokens: 1 },
    ];

    const [resultA, resultB] = await Promise.all([
      compressor.compress(messagesA, { force: true }),
      compressor.compress(messagesB, { force: true }),
    ]);

    expect(resultA.compressed).toBe(true);
    expect(resultB.compressed).toBe(true);
    expect(resultA.archivedIds).toHaveLength(1);
    expect(resultB.archivedIds).toHaveLength(1);
    expect(compressor._archives.length).toBe(2);
    expect(memoryStore.archive).toHaveBeenCalledTimes(2);
  });

  it("handles rapid successive compress calls", async () => {
    const { ProactiveCompressor } = await import(modulePath);
    const compressor = new ProactiveCompressor({
      contextWindow: 100,
      targetFillRatio: 0.3,
      keepLastTurns: 2,
    });

    compressor._predictor.predict.mockReturnValue({
      shouldCompress: true,
      fillRatio: 0.95,
      zone: "active",
    });

    const messages1 = [
      { content: "m1", _tokens: 30 },
      { content: "m2", _tokens: 30 },
      { content: "m3", _tokens: 5 },
      { content: "m4", _tokens: 5 },
    ];
    const result1 = await compressor.compress(messages1, { force: true });
    const firstTs = compressor._lastCompressTs;

    const messages2 = [
      { content: "n1", _tokens: 40 },
      { content: "n2", _tokens: 10 },
      { content: "n3", _tokens: 5 },
      { content: "n4", _tokens: 5 },
    ];
    const result2 = await compressor.compress(messages2, { force: true });
    const secondTs = compressor._lastCompressTs;

    expect(result1.compressed).toBe(true);
    expect(result2.compressed).toBe(true);
    expect(secondTs).toBeGreaterThanOrEqual(firstTs);
    expect(result2.messages).not.toEqual(result1.messages);
  });
});
