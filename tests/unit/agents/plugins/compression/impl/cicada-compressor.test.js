import { describe, it, expect, vi, beforeEach } from 'vitest';

let createdLoggers = [];

vi.mock('../../../../../../js/agents/shared/index.js', () => {
  return {
    isPlainObject: vi.fn((value) => {
      if (!value || typeof value !== "object") return false;
      if (Array.isArray(value)) return false;
      const proto = Object.getPrototypeOf(value);
      return proto === Object.prototype || proto === null;
    }),
    toNonEmptyString: vi.fn((value) => {
      if (value === null || value === undefined) return "";
      const text = String(value).trim();
      return text ? text : "";
    }),
    estimateTokensCached: vi.fn((text) => (String(text).length ? 1 : 0)),
    robustParseJson: vi.fn((text, fallback) => {
      try {
        return JSON.parse(text);
      } catch {
        return fallback ?? null;
      }
    }),
    createSafeRegex: vi.fn((pattern, flags) => new RegExp(pattern, flags)),
    makeSecureTimestampedId: vi.fn(() => "archive_mock"),
    createLogger: vi.fn((stage) => {
      const logger = {
        log: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };
      createdLoggers.push({ stage, logger });
      return logger;
    }),
  };
});

vi.mock('../../../../../../js/agents/runtime/events/events.js', () => {
  return {
    CicadaEvents: {
      LAYER_COMPLETED: "cicada:layer:completed",
      SHED_COMPLETED: "cicada:shed:completed",
    },
  };
});

const modulePath = '../../../../../../js/agents/plugins/compression/impl/cicada-compressor.js';
const sharedPath = '../../../../../../js/agents/shared/index.js';

beforeEach(() => {
  createdLoggers = [];
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.resetModules();
});

describe("CompressionLayer", () => {
  it("exposes immutable layer names", async () => {
    const { CompressionLayer } = await import(modulePath);

    expect(CompressionLayer).toEqual({
      TOOL_OUTPUT: "tool_output",
      SESSION_HISTORY: "session_history",
      LLM_SUMMARY: "llm_summary",
    });
    expect(Object.isFrozen(CompressionLayer)).toBe(true);

    // Mutation attempts should not change the frozen object
    // (avoid relying on strict-mode throw behavior).
    try {
      CompressionLayer.TOOL_OUTPUT = "mutated";
      // eslint-disable-next-line no-empty
    } catch {}
    expect(CompressionLayer.TOOL_OUTPUT).toBe("tool_output");
  });
});

describe("default export", () => {
  it("exports default as CicadaCompressor", async () => {
    const module = await import(modulePath);
    expect(module.default).toBe(module.CicadaCompressor);
  });
});

describe("CicadaCompressor", () => {
  it("normalizes constructor defaults and boundary values", async () => {
    const { CicadaCompressor, CompressionLayer } = await import(modulePath);

    const compressor = new CicadaCompressor({
      maxTokens: 0,
      layers: [CompressionLayer.SESSION_HISTORY, "invalid", null],
      maxArchives: "-1",
      archiveRetentionDays: "-1",
    });

    expect(compressor.maxTokens).toBe(0);
    expect(compressor.layers).toEqual([CompressionLayer.SESSION_HISTORY]);
    expect(compressor._maxArchives).toBe(0);
    expect(compressor._archiveRetentionDays).toBe(0);

    const huge = new CicadaCompressor({ maxTokens: Number.MAX_SAFE_INTEGER, maxArchives: "2" });
    expect(huge.maxTokens).toBe(Number.MAX_SAFE_INTEGER);
    expect(huge._maxArchives).toBe(2);

    const negative = new CicadaCompressor({ maxTokens: -1 });
    expect(negative.maxTokens).toBe(-1);

    const stringTokens = new CicadaCompressor({ maxTokens: "42" });
    const defaultTokens = new CicadaCompressor();
    expect(stringTokens.maxTokens).toBe(defaultTokens.maxTokens);
  });

  it("compresses tool outputs with long strings, deep nesting, trimming, and dangerous keys", async () => {
    const shared = await import(sharedPath);
    shared.estimateTokensCached.mockReturnValue(0);

    const { CicadaCompressor } = await import(modulePath);
    const compressor = new CicadaCompressor({ maxTokens: 50 });

    const hugeText = "x".repeat(50000);

    const input = {
      toolOutputs: [
        {
          tool: "search",
          id: "call_1",
          output: hugeText,
          extra: "y".repeat(200),
          errors: ["e1", "e2", "e3", "e4"],
          meta: { nested: { deep: { value: "z".repeat(500) } } },
          constructor: "bad",
        },
        hugeText,
      ],
      messages: [
        { role: "tool", content: { output: "a".repeat(50), bigField: "b".repeat(50) } },
        { role: "assistant", content: "ok" },
      ],
    };

    const { compressed, stats } = compressor._compressToolOutput(input, {
      maxToolOutputChars: 20,
      maxToolOutputItems: 2,
      maxToolOutputDepth: 1,
    });

    expect(compressed.toolOutputs).toHaveLength(2);
    expect(compressed.toolOutputs[0].output).toContain("...");
    expect(compressed.toolOutputs[0].output.length).toBe(20);
    expect(compressed.toolOutputs[0].extra).toBeUndefined();
    expect(compressed.toolOutputs[0].constructor).toBeUndefined();
    expect(compressed.toolOutputs[0].errors).toEqual(["e1", "e2"]);
    expect(typeof compressed.toolOutputs[0].meta).toBe("string");
    expect(compressed.toolOutputs[0].meta).toContain("...");
    expect(compressed.toolOutputs[1].length).toBe(20);

    const toolMsg = compressed.messages[0];
    expect(toolMsg.content.output).toContain("...");
    expect(toolMsg.content.bigField).toBeUndefined();

    expect(stats.originalSize).toBeGreaterThan(0);
    expect(stats.compressedSize).toBeGreaterThan(0);
    expect(stats.truncatedFields).toBeGreaterThan(0);
    expect(stats.removedFields).toBeGreaterThan(0);
    expect(stats.trimmedArrays).toBeGreaterThan(0);
    expect(stats.trimmedObjects).toBeGreaterThan(0);
  });

  it("compressToolOutput removes __proto__/prototype and prevents prototype pollution", async () => {
    const { CicadaCompressor } = await import(modulePath);
    const compressor = new CicadaCompressor();

    const payload = Object.create(null);
    payload.tool = "t";
    payload.output = "ok";
    payload.__proto__ = { polluted: true };
    payload.prototype = { polluted: true };

    const { compressed } = compressor._compressToolOutput(
      { toolOutputs: [payload] },
      { maxToolOutputChars: 50, maxToolOutputDepth: 5, maxToolOutputItems: 5 }
    );

    expect(compressed.toolOutputs).toHaveLength(1);
    expect(Object.prototype.polluted).toBeUndefined();
    expect("__proto__" in compressed.toolOutputs[0]).toBe(false);
    expect("prototype" in compressed.toolOutputs[0]).toBe(false);
  });

  it("compressToolOutput prefers the first available tool key variant", async () => {
    const { CicadaCompressor } = await import(modulePath);
    const compressor = new CicadaCompressor();

    const { compressed } = compressor._compressToolOutput(
      {
        toolOutputs: {},
        tool_outputs: [{ output: "abcdef" }],
        toolOutput: [{ output: "should not be used" }],
      },
      { maxToolOutputChars: 3 }
    );

    expect(compressed.toolOutputs).toEqual({});
    expect(compressed.tool_outputs).toEqual([{ output: "abc" }]);
    expect(compressed.toolOutput).toEqual([{ output: "should not be used" }]);
  });

  it("compressToolOutput handles null/undefined/empty inputs and non-array shapes", async () => {
    const { CicadaCompressor } = await import(modulePath);
    const compressor = new CicadaCompressor();

    const { compressed, stats } = compressor._compressToolOutput(
      {
        tool_outputs: [null, "", "abc"],
        toolOutputs: {},
        messages: {},
      },
      { maxToolOutputChars: 0 }
    );

    expect(compressed.tool_outputs[0]).toBeNull();
    expect(compressed.tool_outputs[1]).toBe("");
    expect(compressed.tool_outputs[2]).toBe("");
    expect(compressed.toolOutputs).toEqual({});
    expect(compressed.messages).toEqual({});
    expect(stats.truncatedFields).toBeGreaterThanOrEqual(1);

    const emptyArray = compressor._compressToolOutput({ toolOutput: [] }, { maxToolOutputChars: 0 });
    expect(emptyArray.compressed.toolOutput).toEqual([]);

    const emptyObject = compressor._compressToolOutput({}, { maxToolOutputChars: 0 });
    expect(emptyObject.compressed).toEqual({});
  });

  it("compressToolOutput counts tool message content via output/result fallbacks", async () => {
    const { CicadaCompressor } = await import(modulePath);
    const compressor = new CicadaCompressor();

    const { stats } = compressor._compressToolOutput(
      {
        messages: [
          { role: "tool", content: null, output: "OUT" },
          { role: "tool", content: null, result: { ok: true } },
          { role: "tool", content: null },
          { role: "assistant", content: "ok" },
        ],
      },
      { maxToolOutputChars: 5 }
    );

    expect(stats.originalSize).toBeGreaterThan(0);
  });

  it("compresses session history: merges, removes thinking, anchors, keeps tool pairs, and appends summary", async () => {
    const { CicadaCompressor } = await import(modulePath);

    const compressor = new CicadaCompressor({ layers: ["session_history"] });
    const input = {
      messages: [
        { role: "system", content: "Anchor A" },
        { role: "system", content: "[Context Summary]\nOld summary" },
        { role: "assistant", content: "Hello" },
        { role: "assistant", content: "World" },
        { role: "assistant", content: "<analysis>hidden</analysis>" },
        { role: "assistant", content: "tool call", tool_calls: [{ id: "call_1" }] },
        { role: "tool", tool_call_id: "call_1", content: { output: "R".repeat(50) } },
        { role: "tool", tool_call_id: "orphan", content: "Orphan result" },
        { role: "assistant", content: "Tail" },
      ],
      sessionSummary: "Prior summary",
    };

    const { compressed, stats } = compressor._compressSessionHistory(input, {
      keepLastTurns: 3,
      summaryLineChars: 80,
    });

    expect(stats.removedThinking).toBe(1);
    expect(stats.mergedMessages).toBe(1);

    expect(compressed.messages[0]).toMatchObject({ role: "system", content: "Anchor A" });

    const keptToolOutputs = compressed.messages.filter((m) => m?.role === "tool");
    expect(keptToolOutputs).toHaveLength(1);
    expect(keptToolOutputs[0].tool_call_id).toBe("call_1");

    expect(compressed.messages.some((m) => m?.role === "assistant" && Array.isArray(m.tool_calls))).toBe(true);

    expect(compressed.sessionSummary).toContain("Prior summary");
    expect(compressed.sessionSummary).toContain("assistant: Hello World");
    expect(compressed.sessionSummary).toContain("system: [Context Summary]");
  });

  it("does not merge messages carrying extra fields (to avoid metadata loss)", async () => {
    const { CicadaCompressor } = await import(modulePath);
    const compressor = new CicadaCompressor({ layers: ["session_history"] });

    const { compressed, stats } = compressor._compressSessionHistory(
      {
        messages: [
          { role: "assistant", content: "a1" },
          { role: "assistant", content: "a2", meta: { keep: true } },
          { role: "assistant", content: "a3" },
        ],
      },
      { keepLastTurns: 10 }
    );

    expect(stats.mergedMessages).toBe(0);
    expect(compressed.messages).toHaveLength(3);
    expect(compressed.messages[1]).toMatchObject({ meta: { keep: true } });
  });

  it("summarizes thinking messages with decisions and enforces max chars", async () => {
    const { CicadaCompressor } = await import(modulePath);

    const compressor = new CicadaCompressor({ layers: ["session_history"] });
    const input = {
      messages: [
        { role: "system", content: "Anchor A" },
        {
          role: "assistant",
          content: "<analysis>\nDecide to use a very long approach for testing summary truncation.\nDecide to keep it deterministic.\n</analysis>",
        },
        { role: "assistant", thinking: true, content: "" },
        { role: "assistant", content: "Tail" },
      ],
    };

    const { compressed, stats } = compressor._compressSessionHistory(input, {
      keepLastTurns: 10,
      summarizeThinking: true,
      thinkingSummaryMaxChars: 25,
    });

    expect(stats.removedThinking).toBe(0);
    expect(stats.summarizedThinking).toBe(2);

    const summarizedThinking = compressed.messages.find((m) => m?._thinkingSummarized === true);
    expect(summarizedThinking?.content).toContain("[思考摘要]");
    expect(summarizedThinking?.content).toContain("Decide");
    expect(summarizedThinking?.content.length).toBeLessThanOrEqual(30);
    expect(summarizedThinking?.content.endsWith("...")).toBe(true);
    expect(summarizedThinking?._originalLength).toBeGreaterThan(0);

    const emptyThinking = compressed.messages.find((m) => m?.thinking === true && m?.content === "");
    expect(emptyThinking).toBeDefined();
  });

  it("supports titleOnly summaries with CJK + English and summaryLineChars <= 3 truncation", async () => {
    const { CicadaCompressor } = await import(modulePath);

    const compressor = new CicadaCompressor({ layers: ["session_history"] });
    const baseMessages = [
      { role: "user", content: "   " },
      { role: "user", content: "这是一个非常非常长的中文句子，用于测试标题摘要是否截断" },
      { role: "assistant", content: "This is an English message with many words that should be shortened" },
      { role: "assistant", content: "tail" },
    ];

    const titleOnlyResult = compressor._compressSessionHistory(
      { messages: baseMessages },
      { keepLastTurns: 1, titleOnly: true, titleMaxWords: 3, titleMaxChars: 12 }
    );

    expect(titleOnlyResult.compressed.sessionSummary).toBeTypeOf("string");
    expect(titleOnlyResult.compressed.sessionSummary.split("\n").some((line) => line.includes("..."))).toBe(true);

    const truncResult = compressor._compressSessionHistory(
      { messages: [{ role: "user", content: "abcdef" }, { role: "assistant", content: "ghijkl" }] },
      { keepLastTurns: 1, summaryLineChars: 2 }
    );

    expect(truncResult.compressed.sessionSummary).toContain("user: ab");
    expect(truncResult.compressed.sessionSummary).not.toContain("...");
  });

  it("normalizes history entries including null/undefined/empty objects and missing roles", async () => {
    const { CicadaCompressor } = await import(modulePath);
    const compressor = new CicadaCompressor({ layers: ["session_history"] });

    const { compressed } = compressor._compressSessionHistory(
      {
        history: [
          "raw assistant string",
          null,
          undefined,
          { role: "user", text: "from text field" },
          {},
          { content: "role missing should be summarized" },
          { role: "user" },
          { role: "assistant", content: "tail", meta: { keep: true } },
        ],
      },
      { keepLastTurns: 1, summaryLineChars: 50 }
    );

    expect(Array.isArray(compressed.history)).toBe(true);
    expect(compressed.sessionSummary).toContain("assistant: raw assistant string");
    expect(compressed.sessionSummary).toContain("user: from text field");
    expect(compressed.sessionSummary).toContain("unknown: role missing should be summarized");
  });

  it("handles non-array history shapes and toolCall variants for function outputs", async () => {
    const { CicadaCompressor } = await import(modulePath);
    const compressor = new CicadaCompressor({ layers: ["session_history"] });

    const noHistory = compressor._compressSessionHistory({ messages: {} }, {});
    expect(noHistory.compressed).toEqual({ messages: {} });
    expect(noHistory.stats.totalMessages).toBe(0);

    const { compressed } = compressor._compressSessionHistory(
      {
        sessionHistory: [
          { role: "assistant", content: "call", toolCalls: [{ id: "call_1" }] },
          { role: "function", toolCallId: "call_1", content: "kept result" },
          { role: "function", toolCallId: "orphan", content: "drop me" },
          { role: "assistant", content: "tail" },
        ],
      },
      { keepLastTurns: 10 }
    );

    expect(compressed.sessionHistory.some((m) => m?.role === "function" && m?.toolCallId === "orphan")).toBe(false);
    expect(compressed.sessionHistory.some((m) => m?.role === "function" && m?.toolCallId === "call_1")).toBe(true);
    expect(compressed.sessionHistory.some((m) => m?.role === "assistant" && Array.isArray(m.toolCalls))).toBe(true);
  });

  it("keeps tool-call pairs and drops dangling tool outputs when start lands on tool messages", async () => {
    const { CicadaCompressor } = await import(modulePath);
    const compressor = new CicadaCompressor({ layers: ["session_history"] });

    const { compressed } = compressor._compressSessionHistory(
      {
        messages: [
          { role: "user", content: "u1" },
          { role: "assistant", content: "a1" },
          { role: "tool", tool_call_id: "t1", content: "T1" },
          { role: "tool", tool_call_id: "t2", content: "T2" },
          { role: "assistant", content: "a2" },
        ],
      },
      { keepLastTurns: 3 }
    );

    expect(compressed.messages[0].role).not.toBe("tool");
    expect(compressed.messages.some((m) => m.role === "tool")).toBe(false);
  });

  it("LLM summary parses JSON, records token stats, and uses call() fallback signature", async () => {
    const shared = await import(sharedPath);
    shared.estimateTokensCached.mockImplementation((text) => (String(text).includes("Max tokens") ? 123 : 7));

    const modelRouter = {
      call: vi.fn(async (payload, opts) => {
        if (Array.isArray(payload)) {
          expect(opts).toEqual({ usage: "cicada_summary" });
          return {
            content: JSON.stringify({
              summary: "S",
              keyPoints: ["k1"],
              decisions: ["d1"],
              errors: ["e1"],
            }),
          };
        }
        throw new Error("first signature not supported");
      }),
    };

    const { CicadaCompressor } = await import(modulePath);
    const compressor = new CicadaCompressor({ modelRouter, maxTokens: 99 });

    const llm = await compressor._compressWithLLM({ foo: "bar" }, { maxInputChars: 500 });

    expect(llm.summary).toBe("S");
    expect(llm.keyPoints).toEqual(["k1"]);
    expect(llm.decisions).toEqual(["d1"]);
    expect(llm.errors).toEqual(["e1"]);
    expect(llm.stats).toEqual({ promptTokens: 123, summaryTokens: 7 });

    expect(modelRouter.call).toHaveBeenCalledTimes(2);
  });

  it("LLM summary falls back when model returns non-JSON, and uses chat when call() is absent", async () => {
    const shared = await import(sharedPath);
    shared.estimateTokensCached.mockReturnValue(5);

    const modelRouter = {
      chat: vi.fn(async () => "not json"),
    };

    const { CicadaCompressor } = await import(modulePath);
    const compressor = new CicadaCompressor({ modelRouter });

    const llm = await compressor._compressWithLLM(
      { notes: "Decision: use A. Error: failed hard." },
      { maxInputChars: 500 }
    );

    expect(llm.summary).toBeTypeOf("string");
    expect(llm.keyPoints.length).toBeGreaterThan(0);
    expect(llm.decisions.some((line) => /decision/i.test(line))).toBe(true);
    expect(llm.errors.some((line) => /error|failed/i.test(line))).toBe(true);
    expect(llm.stats.promptTokens).toBe(5);
    expect(llm.stats.summaryTokens).toBe(5);
  });

  it("_callModel returns null without router and throws when call() lacks fallback", async () => {
    const shared = await import(sharedPath);
    shared.estimateTokensCached.mockImplementation((text) => (String(text).length ? 1 : 0));

    const { CicadaCompressor } = await import(modulePath);
    const noRouter = new CicadaCompressor({ modelRouter: {} });

    await expect(noRouter._callModel([{ role: "user", content: "x" }])).resolves.toBe(null);

    const modelRouter = {
      call: vi.fn(async () => {
        throw new Error("boom");
      }),
    };

    const compressor = new CicadaCompressor({ modelRouter });

    await expect(compressor._callModel([{ role: "user", content: "x" }])).rejects.toThrow(/boom/);

    const llm = await compressor._compressWithLLM("", { maxInputChars: 10 });
    expect(llm).toMatchObject({ summary: "", keyPoints: [], decisions: [], errors: [] });

    const cicadaLogger = createdLoggers.find((row) => row.stage === "runtime/compression/cicada-compressor")?.logger;
    expect(cicadaLogger?.warn).toHaveBeenCalledTimes(1);
  });

  it("compress() applies layers, archives base context, emits events, and integrates sharedContext", async () => {
    const shared = await import(sharedPath);
    shared.estimateTokensCached.mockReturnValue(1);

    const modelRouter = {
      call: vi.fn(async () => ({
        content: JSON.stringify({
          summary: "S",
          keyPoints: ["k"],
          decisions: [],
          errors: [],
        }),
      })),
    };

    const archiveAdapter = {
      store: vi.fn(async (key) => `stored:${key}`),
    };

    const eventBus = { emit: vi.fn() };
    const sharedContext = {
      setSummary: vi.fn(),
      setIndex: vi.fn(),
      signal: vi.fn(),
    };

    const { CicadaCompressor, CompressionLayer } = await import(modulePath);

    const compressor = new CicadaCompressor({
      modelRouter,
      archive: archiveAdapter,
      eventBus,
      maxTokens: 10,
    });

    const original = {
      toolOutputs: [{ tool: "t", output: "y".repeat(300), bigField: "x".repeat(300) }],
      messages: [{ role: "user", content: "hi" }],
    };

    const result = await compressor.compress(original, { stageKey: "stage-1", sharedContext });

    expect(result.metadata.layersApplied).toEqual([
      CompressionLayer.TOOL_OUTPUT,
      CompressionLayer.SESSION_HISTORY,
      CompressionLayer.LLM_SUMMARY,
    ]);

    expect(result.metadata.archiveId).toBe("stored:stage-1");
    expect(archiveAdapter.store).toHaveBeenCalledTimes(1);

    const storedEntry = archiveAdapter.store.mock.calls[0][1];
    expect(storedEntry.context.toolOutputs[0].bigField).toBeDefined();
    expect(result.context.toolOutputs[0].bigField).toBeUndefined();

    expect(sharedContext.setSummary).toHaveBeenCalledWith("stage-1", "S");
    expect(sharedContext.setIndex).toHaveBeenCalledWith("stage-1", { keywords: ["k"] });
    expect(sharedContext.signal).toHaveBeenCalledWith(
      "stage-1",
      expect.objectContaining({ type: "CICADA_SHED", archiveId: "stored:stage-1" })
    );

    const emittedNames = eventBus.emit.mock.calls.map((row) => row[0]);
    expect(emittedNames).toContain("cicada:layer:completed");
    expect(emittedNames).toContain("cicada:shed:completed");
    expect(eventBus.emit).toHaveBeenCalledTimes(4);
  });

  it("compress() does not archive when stageKey/archiveKey is empty or whitespace", async () => {
    const { CicadaCompressor, CompressionLayer } = await import(modulePath);
    const compressor = new CicadaCompressor({ modelRouter: null });

    const result = await compressor.compress({ messages: [] }, { stageKey: "   " });

    expect(result.metadata.layersApplied).toEqual([CompressionLayer.TOOL_OUTPUT, CompressionLayer.SESSION_HISTORY]);
    expect(result.metadata.archiveId).toBe(null);
  });

  it("compress() skips llm_summary without router, wraps primitive context, and archives with empty summary", async () => {
    const shared = await import(sharedPath);
    shared.estimateTokensCached.mockReturnValue(0);

    const { CicadaCompressor, CompressionLayer } = await import(modulePath);

    const sharedContext = { setSummary: vi.fn(), setIndex: vi.fn(), signal: vi.fn() };
    const compressor = new CicadaCompressor({ modelRouter: null });

    const result = await compressor.compress("hello", { stageKey: "stage-primitive", sharedContext });

    expect(result.context.value).toBe("hello");
    expect(result.metadata.layersApplied).toEqual([CompressionLayer.TOOL_OUTPUT, CompressionLayer.SESSION_HISTORY]);
    expect(result.metadata.archiveId).toBe("stage-primitive");

    expect(sharedContext.setSummary).not.toHaveBeenCalled();
    expect(sharedContext.setIndex).not.toHaveBeenCalled();
    expect(sharedContext.signal).toHaveBeenCalledWith(
      "stage-primitive",
      expect.objectContaining({ type: "CICADA_SHED", archiveId: "stage-primitive" })
    );
  });

  it("supports concurrent compress calls and rapid archive sequence", async () => {
    const shared = await import(sharedPath);
    shared.estimateTokensCached.mockReturnValue(1);

    const modelRouter = {
      call: vi.fn(async () => ({
        content: JSON.stringify({ summary: "S", keyPoints: [], decisions: [], errors: [] }),
      })),
    };

    const { CicadaCompressor } = await import(modulePath);
    const compressor = new CicadaCompressor({ modelRouter, maxArchives: Infinity });

    const [r1, r2] = await Promise.all([
      compressor.compress({ messages: [] }, { stageKey: "c1" }),
      compressor.compress({ messages: [] }, { stageKey: "c2" }),
    ]);

    expect(r1.metadata.archiveId).toBe("c1");
    expect(r2.metadata.archiveId).toBe("c2");
    expect(modelRouter.call).toHaveBeenCalledTimes(2);

    for (const key of ["a", "b", "c"]) {
      await compressor.archive(key, { summary: "s", metadata: {} });
    }

    const list = await compressor.listArchives({ limit: Number.MAX_SAFE_INTEGER });
    expect(list).toHaveLength(5);
    expect(list.map((e) => e.id)).toEqual(expect.arrayContaining(["a", "b", "c", "c1", "c2"]));
  });

  it("archive uses adapter store/set/archive, handles fallbacks, and matches ids via patterns", async () => {
    const shared = await import(sharedPath);

    const { CicadaCompressor } = await import(modulePath);

    const adapterStore = { store: vi.fn(async (key) => `stored:${key}`) };
    const compressorStore = new CicadaCompressor({ archive: adapterStore });
    const storedKey = await compressorStore.archive("k1", { summary: "x", metadata: {} });
    expect(storedKey).toBe("stored:k1");
    expect(adapterStore.store).toHaveBeenCalledWith("k1", expect.objectContaining({ stageKey: "k1" }));

    const adapterSet = { set: vi.fn() };
    const compressorSet = new CicadaCompressor({ archive: adapterSet });
    const setKey = await compressorSet.archive("   ", { summary: "x", metadata: {} });
    expect(setKey).toBe("archive_mock");
    expect(shared.makeSecureTimestampedId).toHaveBeenCalled();
    expect(adapterSet.set).toHaveBeenCalledWith("archive_mock", expect.objectContaining({ stageKey: "archive_mock" }));

    const adapterArchive = { archive: vi.fn(async () => "") };
    const compressorArchive = new CicadaCompressor({ archive: adapterArchive });
    const archivedKey = await compressorArchive.archive("k2", { summary: "y", metadata: {} });
    expect(archivedKey).toBe("k2");

    const numericKey = await compressorArchive.archive(0, { summary: "zero", metadata: {} });
    expect(numericKey).toBe("0");

    await compressorArchive.archive("idmatch", { summary: "nope", metadata: {} });
    const byId = await compressorArchive.listArchives({ limit: 10, pattern: "^idmatch$" });
    expect(byId.some((e) => e.id === "idmatch")).toBe(true);
  });

  it("listArchives handles invalid patterns, retention pruning, schema warnings, adapter restore, and limits", async () => {
    const { CicadaCompressor } = await import(modulePath);

    vi.useFakeTimers();
    vi.setSystemTime(new Date("1970-01-03T00:00:00Z"));

    const compressor = new CicadaCompressor({ maxArchives: 2, archiveRetentionDays: 1 });

    await compressor.archive("old", { timestamp: "1970-01-01T00:00:00Z", summary: "old", metadata: {} });
    await compressor.archive("new", { timestamp: Date.now(), summary: "new", metadata: {} });

    expect(await compressor.restore("old")).toBe(null);
    expect((await compressor.restore("new"))?.stageKey).toBe("new");

    await compressor.archive("newer", { timestamp: Date.now() + 1000, summary: "newer", metadata: {} });
    const list = await compressor.listArchives({ limit: 10 });
    expect(list).toHaveLength(2);

    await compressor.archive("id[1]", { timestamp: Date.now() + 2000, summary: "literal", metadata: {} });
    const patternMatches = await compressor.listArchives({ limit: 10, pattern: "[" });
    expect(patternMatches.some((e) => String(e.id).includes("["))).toBe(true);

    compressor._archiveStore.set("bad", { schemaVersion: "9.9", timestamp: 1, summary: "bad", stageKey: "bad" });
    const restored = await compressor.restore("bad");
    expect(restored?._schemaWarning).toMatch(/unsupported schema version/i);

    const cicadaLogger = createdLoggers.find((row) => row.stage === "runtime/compression/cicada-compressor")?.logger;
    expect(cicadaLogger?.warn).toHaveBeenCalled();

    const adapterLoad = { load: vi.fn(async () => ({ schemaVersion: "0.1", stageKey: "k", timestamp: 1, summary: "" })) };
    const adapterGet = { get: vi.fn(() => ({ schemaVersion: "0.1", stageKey: "k", timestamp: 1, summary: "" })) };
    const adapterRestore = { restore: vi.fn(async () => ({ schemaVersion: "0.1", stageKey: "k", timestamp: 1, summary: "" })) };

    expect((await new CicadaCompressor({ archive: adapterLoad }).restore("k"))?.schemaVersion).toBe("0.1");
    expect((await new CicadaCompressor({ archive: adapterGet }).restore("k"))?.schemaVersion).toBe("0.1");
    expect((await new CicadaCompressor({ archive: adapterRestore }).restore("k"))?.schemaVersion).toBe("0.1");

    expect(compressor._toTimestampMs("not a date")).toBe(null);

    const zeroLimit = new CicadaCompressor({ maxArchives: 0 });
    await zeroLimit.archive("k0", { timestamp: 1, summary: "x", metadata: {} });
    expect(await zeroLimit.restore("k0")).toMatchObject({ stageKey: "k0", summary: "x", timestamp: 1 });
  });

  it("listArchives respects limit=0 and preserves deterministic sorting by timestamp", async () => {
    const { CicadaCompressor } = await import(modulePath);
    const compressor = new CicadaCompressor({ maxArchives: Infinity });

    await compressor.archive("t1", { timestamp: 2, summary: "two", metadata: {} });
    await compressor.archive("t0", { timestamp: 1, summary: "one", metadata: {} });

    const none = await compressor.listArchives({ limit: 0 });
    expect(none).toEqual([]);

    const list = await compressor.listArchives({ limit: 10 });
    expect(list.map((e) => e.id)).toEqual(["t1", "t0"]);
  });

  it("_toTimestampMs handles null/undefined/whitespace and boundary numbers", async () => {
    const { CicadaCompressor } = await import(modulePath);
    const compressor = new CicadaCompressor();

    expect(compressor._toTimestampMs(null)).toBe(null);
    expect(compressor._toTimestampMs(undefined)).toBe(null);
    expect(compressor._toTimestampMs("   ")).toBe(null);
    expect(compressor._toTimestampMs(0)).toBe(0);
    expect(compressor._toTimestampMs(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("buildHandoff summarizes state todos and sharedContext data", async () => {
    const { CicadaCompressor } = await import(modulePath);

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    const compressor = new CicadaCompressor();

    const state = {
      runId: "run_1",
      taskGoal: "Ship it",
      iteration: 3,
      todos: [
        { content: "done item", status: "done", priority: "high" },
        { content: "open item", status: "open", priority: "low" },
      ],
      L1: {
        condensedMemory: {
          summary: "fallback summary",
          decisionTrace: ["d1", "d2"],
        },
        claims: [{}, {}],
      },
      L2: { warnings: ["w1"] },
    };

    const sharedContext = {
      buildSummaryText: vi.fn(() => "shared summary"),
      getDecisions: vi.fn(() => ["d0", "d1", "d2", "d3", "d4", "d5"]),
      getAllSummaries: vi.fn(() => ({ stage: "ctx" })),
    };

    const handoff = compressor.buildHandoff(state, sharedContext);

    expect(handoff.runId).toBe("run_1");
    expect(handoff.timestamp).toBe("2026-01-01T00:00:00.000Z");
    expect(handoff.accomplished.summary).toBe("shared summary");
    expect(handoff.accomplished.completedTodos).toEqual(["done item"]);
    expect(handoff.accomplished.claimCount).toBe(2);
    expect(handoff.pending.todos).toEqual([{ content: "open item", priority: "low" }]);
    expect(handoff.pending.taskGoal).toBe("Ship it");
    expect(handoff.decisions).toEqual(["d1", "d2", "d3", "d4", "d5"]);
    expect(handoff.resumeGuide.nextAction).toBe("open item");
    expect(handoff.resumeGuide.context).toEqual({ stage: "ctx" });
    expect(handoff.resumeGuide.warnings).toEqual(["w1"]);
    expect(handoff.resumeGuide.iteration).toBe(3);
  });

  it("buildHandoff covers fallbacks when sharedContext is missing and todos are non-arrays", async () => {
    const { CicadaCompressor } = await import(modulePath);
    const compressor = new CicadaCompressor();

    const handoff = compressor.buildHandoff(
      {
        runId: "run_fallbacks",
        todos: "not an array",
        L1: { condensedMemory: { summary: "state summary", decisionTrace: ["d1"] }, claims: [] },
        L2: {},
      },
      null
    );

    expect(handoff.accomplished.summary).toBe("state summary");
    expect(handoff.accomplished.completedTodos).toEqual([]);
    expect(handoff.accomplished.claimCount).toBe(0);
    expect(handoff.pending.todos).toEqual([]);
    expect(handoff.pending.taskGoal).toBe("");
    expect(handoff.decisions).toEqual(["d1"]);
    expect(handoff.resumeGuide.nextAction).toBe(null);
    expect(handoff.resumeGuide.context).toEqual({});
    expect(handoff.resumeGuide.warnings).toEqual([]);
    expect(handoff.resumeGuide.iteration).toBe(0);
  });
});
