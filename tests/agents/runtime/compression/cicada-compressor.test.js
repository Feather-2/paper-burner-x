import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let createdLoggers = [];

// Avoid console noise in tests and allow assertions on warnings.
vi.mock("../../../../js/agents/shared/utils/logger.js", () => {
  return {
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

vi.mock("../../../../js/agents/shared/utils/token-cache.js", () => {
  return {
    estimateTokensCached: vi.fn(),
  };
});

vi.mock("../../../../js/agents/shared/utils/secure-id.js", () => {
  return {
    makeSecureTimestampedId: vi.fn(() => "archive_mock"),
  };
});

beforeEach(() => {
  createdLoggers = [];
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("runtime/compression/cicada-compressor.js", () => {
  it("compresses tool outputs and tool role messages (truncate/remove/trim depth + arrays)", async () => {
    const tokenCache = await import("../../../../js/agents/shared/utils/token-cache.js");
    tokenCache.estimateTokensCached.mockReturnValue(0);

    const { CicadaCompressor } = await import("../../../../js/agents/runtime/compression/cicada-compressor.js");

    const compressor = new CicadaCompressor({ maxTokens: 50 });
    const input = {
      toolOutputs: [
        {
          tool: "search",
          id: "call_1",
          output: "x".repeat(50),
          bigField: "y".repeat(50), // should be removed (not important/verbose and not small)
          errors: ["e1", "e2", "e3", "e4"], // should be trimmed
          metadata: { nested: { deep: "z".repeat(50) } }, // should be trimmed to string due to depth limit
        },
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

    expect(compressed.toolOutputs).toHaveLength(1);
    expect(compressed.toolOutputs[0].tool).toBe("search");
    expect(compressed.toolOutputs[0].id).toBe("call_1");
    expect(compressed.toolOutputs[0].output).toContain("...");
    expect(compressed.toolOutputs[0].bigField).toBeUndefined();
    expect(compressed.toolOutputs[0].errors).toEqual(["e1", "e2"]);
    expect(typeof compressed.toolOutputs[0].metadata).toBe("string");
    expect(compressed.toolOutputs[0].metadata).toContain("...");

    const toolMsg = compressed.messages[0];
    expect(toolMsg.role).toBe("tool");
    expect(toolMsg.content.output).toContain("...");
    expect(toolMsg.content.bigField).toBeUndefined();

    expect(stats.originalSize).toBeGreaterThan(0);
    expect(stats.compressedSize).toBeGreaterThan(0);
    expect(stats.truncatedFields).toBeGreaterThan(0);
    expect(stats.removedFields).toBeGreaterThan(0);
    expect(stats.trimmedArrays).toBeGreaterThan(0);
    expect(stats.trimmedObjects).toBeGreaterThan(0);
  });

  it("compresses session history: merges merge-safe, removes thinking, anchors system, keeps tool-call pairs, drops orphan tool outputs", async () => {
    const tokenCache = await import("../../../../js/agents/shared/utils/token-cache.js");
    tokenCache.estimateTokensCached.mockReturnValue(0);

    const { CicadaCompressor } = await import("../../../../js/agents/runtime/compression/cicada-compressor.js");

    const compressor = new CicadaCompressor({ layers: ["session_history"] });
    const input = {
      messages: [
        { role: "system", content: "Anchor A" },
        { role: "system", content: "[Context Summary]\nOld summary" }, // not an anchor
        { role: "assistant", content: "Hello" },
        { role: "assistant", content: "World" }, // merge-safe with previous assistant
        { role: "assistant", content: "<analysis>hidden</analysis>" }, // thinking -> removed
        { role: "assistant", content: "tool call", tool_calls: [{ id: "call_1" }] },
        { role: "tool", tool_call_id: "call_1", content: { output: "R".repeat(50) } },
        { role: "tool", tool_call_id: "orphan", content: "Orphan result" },
        { role: "assistant", content: "Tail" },
      ],
      sessionSummary: "Prior summary",
    };

    // keepLastTurns=3 would start on the tool output, so the compressor should expand the
    // kept window to include the preceding assistant tool-call message.
    const { compressed, stats } = compressor._compressSessionHistory(input, {
      keepLastTurns: 3,
      summaryLineChars: 80,
    });

    expect(stats.removedThinking).toBe(1);
    expect(stats.mergedMessages).toBe(1);

    // Anchor system prompt remains verbatim.
    expect(compressed.messages[0]).toMatchObject({ role: "system", content: "Anchor A" });

    // Orphaned tool output is removed; referenced tool output is kept.
    const keptToolOutputs = compressed.messages.filter((m) => m?.role === "tool");
    expect(keptToolOutputs).toHaveLength(1);
    expect(keptToolOutputs[0].tool_call_id).toBe("call_1");

    // Kept window includes the assistant tool-call message paired with the kept tool output.
    expect(compressed.messages.some((m) => m?.role === "assistant" && Array.isArray(m.tool_calls))).toBe(true);

    // Older messages summarized and appended to prior sessionSummary.
    expect(compressed.sessionSummary).toContain("Prior summary");
    expect(compressed.sessionSummary).toContain("assistant: Hello World");
    expect(compressed.sessionSummary).toContain("system: [Context Summary]");
  });

  it("session history supports summarizeThinking strategy (including empty thinking messages) and enforces thinkingSummaryMaxChars", async () => {
    const tokenCache = await import("../../../../js/agents/shared/utils/token-cache.js");
    tokenCache.estimateTokensCached.mockReturnValue(0);

    const { CicadaCompressor } = await import("../../../../js/agents/runtime/compression/cicada-compressor.js");

    const compressor = new CicadaCompressor({ layers: ["session_history"] });
    const input = {
      messages: [
        { role: "system", content: "Anchor A" },
        {
          role: "assistant",
          content: "<analysis>\nDecide to use a very long approach for testing summary truncation.\nDecide to keep it deterministic.\n</analysis>",
        },
        // Empty thinking message should not throw; summary helper returns the original message.
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
    expect(summarizedThinking?.content.length).toBeLessThanOrEqual(25);
    expect(summarizedThinking?.content.endsWith("...")).toBe(true);
    expect(summarizedThinking?._originalLength).toBeGreaterThan(0);

    const emptyThinking = compressed.messages.find((m) => m?.thinking === true && m?.content === "");
    expect(emptyThinking).toBeDefined();
  });

  it("session history threshold avoids dangling leading tool messages (no tool-call ids present)", async () => {
    const tokenCache = await import("../../../../js/agents/shared/utils/token-cache.js");
    tokenCache.estimateTokensCached.mockReturnValue(0);

    const { CicadaCompressor } = await import("../../../../js/agents/runtime/compression/cicada-compressor.js");

    const compressor = new CicadaCompressor({ layers: ["session_history"] });
    const input = {
      messages: [
        { role: "tool", tool_call_id: "orphan_1", content: "T1" },
        { role: "tool", tool_call_id: "orphan_2", content: "T2" },
        { role: "assistant", content: "A" },
      ],
    };

    const { compressed, stats } = compressor._compressSessionHistory(input, { keepLastTurns: 10 });

    // Leading tool messages are dropped to avoid keeping dangling tool output.
    expect(compressed.messages).toHaveLength(1);
    expect(compressed.messages[0]).toMatchObject({ role: "assistant", content: "A" });
    expect(stats.keptMessages).toBe(1);
  });

  it("session history supports titleOnly summaries (CJK + English) and summaryLineChars <= 3 truncation", async () => {
    const tokenCache = await import("../../../../js/agents/shared/utils/token-cache.js");
    tokenCache.estimateTokensCached.mockReturnValue(0);

    const { CicadaCompressor } = await import("../../../../js/agents/runtime/compression/cicada-compressor.js");

    const compressor = new CicadaCompressor({ layers: ["session_history"] });
    const baseMessages = [
      { role: "user", content: "   " }, // empty after trim -> skipped by summarizer
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

  it("session history start adjustment skips tool outputs when no preceding assistant tool-call exists", async () => {
    const tokenCache = await import("../../../../js/agents/shared/utils/token-cache.js");
    tokenCache.estimateTokensCached.mockReturnValue(0);

    const { CicadaCompressor } = await import("../../../../js/agents/runtime/compression/cicada-compressor.js");

    const compressor = new CicadaCompressor({ layers: ["session_history"] });

    // keepLastTurns=3 -> start lands on the first tool output (t1), but prev is a normal assistant message.
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

    // Window should not start with tool output.
    expect(compressed.messages[0].role).not.toBe("tool");
    expect(compressed.messages.some((m) => m.role === "tool")).toBe(false);
  });

  it("compressToolOutput handles string entries + non-JSON-safe values, and keeps small arrays without trimming", async () => {
    const tokenCache = await import("../../../../js/agents/shared/utils/token-cache.js");
    tokenCache.estimateTokensCached.mockReturnValue(0);

    const { CicadaCompressor } = await import("../../../../js/agents/runtime/compression/cicada-compressor.js");

    const compressor = new CicadaCompressor();
    const input = {
      tool_outputs: [
        "raw tool output string",
        {
          id: 1n, // IMPORTANT_KEYS + non-JSON-serializable -> safeStringify should fall back without throwing
          ok: true,
          count: 3,
          tags: ["a", "b"], // <= maxArrayItems so map branch runs
          extra: "x".repeat(50), // removed (not important/verbose/small)
        },
      ],
    };

    const { compressed, stats } = compressor._compressToolOutput(input, { maxToolOutputChars: 10 });

    expect(compressed.tool_outputs).toHaveLength(2);
    expect(compressed.tool_outputs[0]).toContain("...");
    expect(compressed.tool_outputs[0].length).toBe(10);
    expect(compressed.tool_outputs[1].ok).toBe(true);
    expect(compressed.tool_outputs[1].count).toBe(3);
    expect(compressed.tool_outputs[1].tags).toEqual(["a", "b"]);
    expect(compressed.tool_outputs[1].extra).toBeUndefined();

    // Ensure we exercised both truncation and safeStringify fallbacks without crashing.
    expect(stats.originalSize).toBeGreaterThan(0);
  });

  it("LLM summary parses JSON, records token stats, and supports modelRouter.call fallback signature", async () => {
    const tokenCache = await import("../../../../js/agents/shared/utils/token-cache.js");
    tokenCache.estimateTokensCached.mockImplementation((text) => (String(text).includes("Max tokens") ? 123 : 7));

    const modelRouter = {
      // Two-arg signature (length=2) enables the fallback branch in _callModel.
      call: vi.fn(async (messages, opts) => {
        if (Array.isArray(messages)) {
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

    const { CicadaCompressor } = await import("../../../../js/agents/runtime/compression/cicada-compressor.js");
    const compressor = new CicadaCompressor({ modelRouter, maxTokens: 99 });

    const llm = await compressor._compressWithLLM({ foo: "bar" }, { maxInputChars: 500 });

    expect(llm.summary).toBe("S");
    expect(llm.keyPoints).toEqual(["k1"]);
    expect(llm.decisions).toEqual(["d1"]);
    expect(llm.errors).toEqual(["e1"]);
    expect(llm.stats).toEqual({ promptTokens: 123, summaryTokens: 7 });

    expect(tokenCache.estimateTokensCached).toHaveBeenCalledTimes(2);
    expect(tokenCache.estimateTokensCached.mock.calls[0][0]).toContain("Summarize the agent context");
  });

  it("LLM summary falls back when model returns non-JSON, and uses modelRouter.chat when call() is absent", async () => {
    const tokenCache = await import("../../../../js/agents/shared/utils/token-cache.js");
    tokenCache.estimateTokensCached.mockReturnValue(5);

    const modelRouter = {
      chat: vi.fn(async () => "not json"),
    };

    const { CicadaCompressor } = await import("../../../../js/agents/runtime/compression/cicada-compressor.js");
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

  it("callModel returns null when modelRouter lacks call/chat, and token stats handle empty summary boundary", async () => {
    const tokenCache = await import("../../../../js/agents/shared/utils/token-cache.js");
    tokenCache.estimateTokensCached.mockImplementation((text) => (String(text).length ? 1 : 0));

    const { CicadaCompressor } = await import("../../../../js/agents/runtime/compression/cicada-compressor.js");
    const compressor = new CicadaCompressor({ modelRouter: {} });

    await expect(compressor._callModel([{ role: "user", content: "x" }])).resolves.toBe(null);

    const llm = await compressor._compressWithLLM("", { maxInputChars: 10 });
    expect(llm).toMatchObject({ summary: "", keyPoints: [], decisions: [], errors: [] });
    expect(llm.stats.promptTokens).toBe(1);
    expect(llm.stats.summaryTokens).toBe(0);
  });

  it("LLM summary returns empty payload when context is empty string, and _callModel throws when call() has no fallback signature", async () => {
    const tokenCache = await import("../../../../js/agents/shared/utils/token-cache.js");
    tokenCache.estimateTokensCached.mockReturnValue(0);

    const modelRouter = {
      call: vi.fn(async () => {
        throw new Error("boom");
      }),
    };

    const { CicadaCompressor } = await import("../../../../js/agents/runtime/compression/cicada-compressor.js");
    const compressor = new CicadaCompressor({ modelRouter });

    await expect(compressor._callModel([{ role: "user", content: "x" }])).rejects.toThrow(/boom/);

    const llm = await compressor._compressWithLLM("", { maxInputChars: 10 });
    expect(llm).toMatchObject({ summary: "", keyPoints: [], decisions: [], errors: [] });
  });

  it("compress() applies layers in default order, archives the original context, and emits events + sharedContext signals", async () => {
    const tokenCache = await import("../../../../js/agents/shared/utils/token-cache.js");
    tokenCache.estimateTokensCached.mockReturnValue(1);

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

    const { CicadaCompressor, CompressionLayer } = await import(
      "../../../../js/agents/runtime/compression/cicada-compressor.js"
    );

    const compressor = new CicadaCompressor({
      modelRouter,
      archive: archiveAdapter,
      eventBus,
      // maxTokens influences default tool output char limit: Math.max(200, maxTokens * 4)
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

    // Archive should store base (original), not the compressed context.
    expect(storedEntry.context.toolOutputs[0].bigField).toBeDefined();
    expect(result.context.toolOutputs[0].bigField).toBeUndefined();

    expect(sharedContext.setSummary).toHaveBeenCalledWith("stage-1", "S");
    expect(sharedContext.setIndex).toHaveBeenCalledWith("stage-1", { keywords: ["k"] });
    expect(sharedContext.signal).toHaveBeenCalledWith(
      "stage-1",
      expect.objectContaining({
        type: "CICADA_SHED",
        archiveId: "stored:stage-1",
      })
    );

    // Each layer emits a completion event + a final shed event.
    const emittedNames = eventBus.emit.mock.calls.map((row) => row[0]);
    expect(emittedNames).toContain("cicada.layer.completed");
    expect(emittedNames).toContain("cicada.shed.completed");
    expect(eventBus.emit).toHaveBeenCalledTimes(4);

    expect(eventBus.emit).toHaveBeenCalledWith(
      "cicada.shed.completed",
      expect.objectContaining({
        actor: "cicada",
        status: "completed",
      })
    );
  });

  it("compress() skips llm_summary when modelRouter is missing, and handles non-history contexts", async () => {
    const tokenCache = await import("../../../../js/agents/shared/utils/token-cache.js");
    tokenCache.estimateTokensCached.mockReturnValue(0);

    const { CicadaCompressor, CompressionLayer } = await import("../../../../js/agents/runtime/compression/cicada-compressor.js");

    const compressor = new CicadaCompressor({ layers: ["llm_summary", "session_history"] });
    const result = await compressor.compress({ value: 1 }, { layers: ["llm_summary", "session_history"] });

    expect(result.metadata.layersApplied).toEqual([CompressionLayer.SESSION_HISTORY]);
    expect(result.metadata.llmSummary).toBe(null);

    const noHistory = compressor._compressSessionHistory({ foo: "bar" }, {});
    expect(noHistory.compressed).toEqual({ foo: "bar" });
    expect(noHistory.stats.totalMessages).toBe(0);
  });

  it("archive thresholds: prunes by maxArchives, listArchives supports pattern, restore warns on unsupported schema versions", async () => {
    const tokenCache = await import("../../../../js/agents/shared/utils/token-cache.js");
    tokenCache.estimateTokensCached.mockReturnValue(0);

    const { CicadaCompressor } = await import("../../../../js/agents/runtime/compression/cicada-compressor.js");

    const compressor = new CicadaCompressor({ maxArchives: 2 });

    await compressor.archive("a", { timestamp: 1000, summary: "alpha", metadata: {} });
    await compressor.archive("b", { timestamp: 2000, summary: "bravo", metadata: {} });
    await compressor.archive("c", { timestamp: 3000, summary: "charlie", metadata: {} });

    // Oldest ("a") should be pruned.
    expect(await compressor.restore("a")).toBe(null);
    expect((await compressor.restore("b"))?.stageKey).toBe("b");

    const sorted = await compressor.listArchives({ limit: 10 });
    expect(sorted).toHaveLength(2);
    expect(sorted[0].timestamp).toBeGreaterThanOrEqual(sorted[1].timestamp);

    const filtered = await compressor.listArchives({ limit: 10, pattern: "a" });
    expect(filtered.length).toBeGreaterThan(0);

    // Force an unsupported schema version and ensure restore warns + annotates.
    compressor._archiveStore.set("bad", { schemaVersion: "9.9", timestamp: 123, summary: "bad", stageKey: "bad" });
    const restored = await compressor.restore("bad");
    expect(restored?._schemaWarning).toMatch(/unsupported schema version/i);

    const cicadaLogger = createdLoggers.find((row) => row.stage === "runtime/compression/cicada-compressor")?.logger;
    expect(cicadaLogger?.warn).toHaveBeenCalledTimes(1);
  });

  it("archive adapter modes: set/archive and restore uses adapter.load/get/restore when provided", async () => {
    const tokenCache = await import("../../../../js/agents/shared/utils/token-cache.js");
    tokenCache.estimateTokensCached.mockReturnValue(0);

    const { CicadaCompressor } = await import("../../../../js/agents/runtime/compression/cicada-compressor.js");

    const adapterSet = { set: vi.fn() };
    const compressorSet = new CicadaCompressor({ archive: adapterSet });
    const setKey = await compressorSet.archive("", { summary: "x", metadata: {} });
    expect(setKey).toBe("archive_mock");
    expect(adapterSet.set).toHaveBeenCalledWith("archive_mock", expect.objectContaining({ stageKey: "archive_mock" }));

    const adapterArchive = {
      archive: vi.fn(async (key) => `archived:${key}`),
    };
    const compressorArchive = new CicadaCompressor({ archive: adapterArchive });
    const archivedKey = await compressorArchive.archive("k1", { summary: "y", metadata: {} });
    expect(archivedKey).toBe("archived:k1");

    const adapterLoad = { load: vi.fn(async () => ({ schemaVersion: "0.1", stageKey: "k", timestamp: 1, summary: "" })) };
    const adapterGet = { get: vi.fn(() => ({ schemaVersion: "0.1", stageKey: "k", timestamp: 1, summary: "" })) };
    const adapterRestore = { restore: vi.fn(async () => ({ schemaVersion: "0.1", stageKey: "k", timestamp: 1, summary: "" })) };

    expect((await new CicadaCompressor({ archive: adapterLoad }).restore("k"))?.schemaVersion).toBe("0.1");
    expect((await new CicadaCompressor({ archive: adapterGet }).restore("k"))?.schemaVersion).toBe("0.1");
    expect((await new CicadaCompressor({ archive: adapterRestore }).restore("k"))?.schemaVersion).toBe("0.1");

    expect(await new CicadaCompressor().restore("")).toBe(null);
  });

  it("archive retention pruning and timestamp parsing handle edge cases", async () => {
    const tokenCache = await import("../../../../js/agents/shared/utils/token-cache.js");
    tokenCache.estimateTokensCached.mockReturnValue(0);

    const { CicadaCompressor } = await import("../../../../js/agents/runtime/compression/cicada-compressor.js");

    // Covers the early-return in _pruneArchiveStore when both constraints are disabled.
    const noPrune = new CicadaCompressor({ maxArchives: Infinity, archiveRetentionDays: null });
    noPrune._pruneArchiveStore();

    const compressor = new CicadaCompressor({ maxArchives: Infinity, archiveRetentionDays: 1 });
    vi.spyOn(Date, "now").mockReturnValue(2 * 24 * 60 * 60 * 1000);

    await compressor.archive("old", { timestamp: "1970-01-01T00:00:00Z", summary: "old", metadata: {} });
    await compressor.archive("new", { timestamp: Date.now(), summary: "new", metadata: {} });

    const list = await compressor.listArchives({ limit: 10 });
    expect(list.some((e) => e.id === "old")).toBe(false);
    expect(list.some((e) => e.id === "new")).toBe(true);

    // _toTimestampMs should reject invalid date strings.
    expect(compressor._toTimestampMs("not a date")).toBe(null);

    // maxArchives=0 -> limit=0 -> prune returns early via `if (!limit) return`.
    const zeroLimit = new CicadaCompressor({ maxArchives: 0 });
    await zeroLimit.archive("k", { timestamp: 1, summary: "x", metadata: {} });
    expect(await zeroLimit.restore("k")).toMatchObject({ stageKey: "k", summary: "x", timestamp: 1 });
  });

  it("buildHandoff summarizes state todos and sharedContext data", async () => {
    const tokenCache = await import("../../../../js/agents/shared/utils/token-cache.js");
    tokenCache.estimateTokensCached.mockReturnValue(0);

    const { CicadaCompressor } = await import("../../../../js/agents/runtime/compression/cicada-compressor.js");

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

  it("session history summary uses non-titleOnly truncation (preserves tail) for older messages", async () => {
    const tokenCache = await import("../../../../js/agents/shared/utils/token-cache.js");
    tokenCache.estimateTokensCached.mockReturnValue(0);

    const { CicadaCompressor } = await import("../../../../js/agents/runtime/compression/cicada-compressor.js");

    const compressor = new CicadaCompressor({ layers: ["session_history"] });

    const long = "abcd" + "x".repeat(20) + "Z";
    const { compressed } = compressor._compressSessionHistory(
      {
        messages: [
          { role: "user", content: long },
          { role: "assistant", content: "tail" },
        ],
      },
      { keepLastTurns: 1, summaryLineChars: 8, titleOnly: false }
    );

    // truncateText(…, 8) => head(4) + "..." + tail(1)
    expect(compressed.sessionSummary).toContain("user: abcd...Z");
  });

  it("tool output compression keeps small plain objects, drops non-plain objects, and defaults maxToolOutputChars from maxTokens", async () => {
    const tokenCache = await import("../../../../js/agents/shared/utils/token-cache.js");
    tokenCache.estimateTokensCached.mockReturnValue(0);

    const { CicadaCompressor } = await import("../../../../js/agents/runtime/compression/cicada-compressor.js");

    // maxTokens=100 => default maxToolOutputChars = max(200, 100*4)=400
    const compressor = new CicadaCompressor({ maxTokens: 100 });
    const { compressed, stats } = compressor._compressToolOutput({
      toolOutput: [
        {
          id: "call_1",
          output: "o".repeat(450), // verbose => kept + truncated to 400 chars
          bigField: "b".repeat(450), // non-important + non-small => removed
          smallObj: { a: 1, b: 2, c: 3, d: 4, e: 5 }, // plain object <= 5 keys => kept via isSmallValue
          weirdObj: new Date("2020-01-01T00:00:00Z"), // non-plain object => removed via isSmallValue=false
        },
      ],
    });

    expect(compressed.toolOutput).toHaveLength(1);
    expect(compressed.toolOutput[0].id).toBe("call_1");
    expect(compressed.toolOutput[0].output).toContain("...");
    expect(compressed.toolOutput[0].output.length).toBe(400);

    expect(compressed.toolOutput[0].smallObj).toEqual({ a: 1, b: 2, c: 3, d: 4, e: 5 });
    expect(compressed.toolOutput[0].bigField).toBeUndefined();
    expect(compressed.toolOutput[0].weirdObj).toBeUndefined();

    expect(stats.removedFields).toBeGreaterThanOrEqual(2);
    expect(stats.truncatedFields).toBeGreaterThanOrEqual(1);
  });

  it("LLM summary returns empty payload when value-utils.isPlainObject is forced false (normalizeSummaryPayload fallback)", async () => {
    const tokenCache = await import("../../../../js/agents/shared/utils/token-cache.js");
    tokenCache.estimateTokensCached.mockImplementation((text) => (String(text).length ? 1 : 0));

    // Force normalizeSummaryPayload() to hit the `!isPlainObject(src)` early return.
    vi.doMock("../../../../js/agents/shared/utils/value-utils.js", async () => {
      const actual = await vi.importActual("../../../../js/agents/shared/utils/value-utils.js");
      return {
        ...actual,
        isPlainObject: vi.fn(() => false),
      };
    });

    const { CicadaCompressor } = await import("../../../../js/agents/runtime/compression/cicada-compressor.js");
    const compressor = new CicadaCompressor({ modelRouter: null });

    const llm = await compressor._compressWithLLM("Decision: use A\nError: failed hard", { maxInputChars: 500 });

    expect(llm).toMatchObject({ summary: "", keyPoints: [], decisions: [], errors: [] });
    expect(llm.stats).toEqual({ promptTokens: 1, summaryTokens: 0 });

    vi.doUnmock("../../../../js/agents/shared/utils/value-utils.js");
  });

  it("session history filtering supports toolCalls + role=function tool messages (toolCallId), and drops orphan function outputs", async () => {
    const tokenCache = await import("../../../../js/agents/shared/utils/token-cache.js");
    tokenCache.estimateTokensCached.mockReturnValue(0);

    const { CicadaCompressor } = await import("../../../../js/agents/runtime/compression/cicada-compressor.js");

    const compressor = new CicadaCompressor({ layers: ["session_history"] });
    const { compressed } = compressor._compressSessionHistory(
      {
        // Use alternate history key to cover historyKey selection.
        sessionHistory: [
          { role: "assistant", content: "call", toolCalls: [{ id: "call_1" }] }, // toolCalls variant
          { role: "function", toolCallId: "call_1", content: "kept result" }, // role=function treated as tool
          { role: "function", toolCallId: "orphan", content: "drop me" },
          { role: "assistant", content: "tail" },
        ],
      },
      { keepLastTurns: 10 }
    );

    expect(Array.isArray(compressed.sessionHistory)).toBe(true);
    expect(compressed.sessionHistory.some((m) => m?.role === "function" && m?.toolCallId === "orphan")).toBe(false);
    expect(compressed.sessionHistory.some((m) => m?.role === "function" && m?.toolCallId === "call_1")).toBe(true);
    expect(compressed.sessionHistory.some((m) => m?.role === "assistant" && Array.isArray(m.toolCalls))).toBe(true);
  });

  it("session history summarizeThinking falls back to head/tail when no explicit decisions are present", async () => {
    const tokenCache = await import("../../../../js/agents/shared/utils/token-cache.js");
    tokenCache.estimateTokensCached.mockReturnValue(0);

    const { CicadaCompressor } = await import("../../../../js/agents/runtime/compression/cicada-compressor.js");

    const compressor = new CicadaCompressor({ layers: ["session_history"] });
    const text = "This is just exploration.\n" + "x".repeat(140) + "\nStill exploring.";
    const { compressed, stats } = compressor._compressSessionHistory(
      {
        messages: [
          { role: "system", content: "Anchor A" },
          { role: "assistant", content: `<analysis>\n${text}\n</analysis>` },
          { role: "assistant", content: "tail" },
        ],
      },
      { keepLastTurns: 10, summarizeThinking: true, thinkingSummaryMaxChars: 120 }
    );

    expect(stats.removedThinking).toBe(0);
    expect(stats.summarizedThinking).toBe(1);

    const summarized = compressed.messages.find((m) => m?._thinkingSummarized === true);
    expect(summarized?.content).toContain("[思考摘要]");
    // Head/tail path includes the separator when tail exists.
    expect(summarized?.content).toContain(" ... ");
  });

  it("session history titleOnly uses word-based and char-based truncation for non-CJK messages (prevents merge)", async () => {
    const tokenCache = await import("../../../../js/agents/shared/utils/token-cache.js");
    tokenCache.estimateTokensCached.mockReturnValue(0);

    const { CicadaCompressor } = await import("../../../../js/agents/runtime/compression/cicada-compressor.js");
    const compressor = new CicadaCompressor({ layers: ["session_history"] });

    // Prevent merge of the older assistant message into the kept tail by adding metadata on the tail.
    const byWords = compressor._compressSessionHistory(
      {
        messages: [
          { role: "assistant", content: "one two three four five six seven" },
          { role: "assistant", content: "tail", meta: { keep: true } },
        ],
      },
      { keepLastTurns: 1, titleOnly: true, titleMaxWords: 3, titleMaxChars: 80 }
    );

    expect(byWords.compressed.sessionSummary).toContain("assistant: one two three...");

    const byChars = compressor._compressSessionHistory(
      {
        messages: [
          { role: "assistant", content: "ABCDEFGHIJKLmnopqrstuvwxyz" },
          { role: "assistant", content: "tail", meta: { keep: true } },
        ],
      },
      // maxWords large so truncation is driven by maxChars (normalized.length > clipped.length)
      { keepLastTurns: 1, titleOnly: true, titleMaxWords: 50, titleMaxChars: 10 }
    );

    expect(byChars.compressed.sessionSummary).toContain("assistant: ABCDEFGHIJ...");
  });

  it("session history normalizes string/null entries + message.text, supports history key, and summarizes unknown roles", async () => {
    const tokenCache = await import("../../../../js/agents/shared/utils/token-cache.js");
    tokenCache.estimateTokensCached.mockReturnValue(0);

    const { CicadaCompressor } = await import("../../../../js/agents/runtime/compression/cicada-compressor.js");
    const compressor = new CicadaCompressor({ layers: ["session_history"] });

    const { compressed } = compressor._compressSessionHistory(
      {
        history: [
          "raw assistant string",
          null,
          { role: "user", text: "from text field" }, // normalizeMessage should prefer text when content is nullish
          { content: "role missing should be summarized" }, // no role => "unknown:"
          { role: "user" }, // no content/text => skipped by summarizer
          { role: "assistant", content: "tail", meta: { keep: true } }, // prevent merges
        ],
      },
      { keepLastTurns: 1, summaryLineChars: 50 }
    );

    expect(Array.isArray(compressed.history)).toBe(true);
    expect(compressed.sessionSummary).toContain("assistant: raw assistant string");
    expect(compressed.sessionSummary).toContain("user: from text field");
    expect(compressed.sessionSummary).toContain("unknown: role missing should be summarized");
  });

  it("session history thinking detection supports meta.type + text fallback and summarizes short no-decision thinking without tail", async () => {
    const tokenCache = await import("../../../../js/agents/shared/utils/token-cache.js");
    tokenCache.estimateTokensCached.mockReturnValue(0);

    const { CicadaCompressor } = await import("../../../../js/agents/runtime/compression/cicada-compressor.js");
    const compressor = new CicadaCompressor({ layers: ["session_history"] });

    const { compressed, stats } = compressor._compressSessionHistory(
      {
        messages: [
          { role: "system", content: "Anchor A" },
          // meta.type path in isThinkingMessage()
          { role: "assistant", meta: { type: "thinking" }, content: "Just exploring." },
          // Force message.text branch in isThinkingMessage() by keeping content="".
          { role: "assistant", content: "", text: "<analysis>\njust exploration\n</analysis>" },
          { role: "assistant", content: "tail" },
        ],
      },
      { keepLastTurns: 10, summarizeThinking: true, thinkingSummaryMaxChars: 150 }
    );

    expect(stats.summarizedThinking).toBe(2);

    const summaries = compressed.messages.filter((m) => m?._thinkingSummarized === true);
    expect(summaries).toHaveLength(2);
    // Short/no-tail path should omit the head/tail separator.
    expect(summaries.every((m) => !String(m.content).includes(" ... "))).toBe(true);
  });

  it("session history kept-window adjustment treats assistant function_call/functionCall as tool-call and avoids dangling tool outputs", async () => {
    const tokenCache = await import("../../../../js/agents/shared/utils/token-cache.js");
    tokenCache.estimateTokensCached.mockReturnValue(0);

    const { CicadaCompressor } = await import("../../../../js/agents/runtime/compression/cicada-compressor.js");
    const compressor = new CicadaCompressor({ layers: ["session_history"] });

    const fnCall = compressor._compressSessionHistory(
      {
        messages: [
          { role: "user", content: "u1" },
          { role: "assistant", content: "call", function_call: { name: "search" } },
          { role: "tool", content: "result" },
          { role: "assistant", content: "tail" },
        ],
      },
      // keepLastTurns=2 starts on the tool message; should expand to include the assistant tool-call message.
      { keepLastTurns: 2 }
    );

    expect(fnCall.compressed.messages.some((m) => m?.role === "assistant" && m?.function_call)).toBe(true);
    expect(fnCall.compressed.messages.some((m) => m?.role === "tool")).toBe(true);

    const fnCallCamel = compressor._compressSessionHistory(
      {
        messages: [
          { role: "user", content: "u1" },
          { role: "assistant", content: "call", functionCall: { name: "search" } },
          { role: "tool", content: "result" },
          { role: "assistant", content: "tail" },
        ],
      },
      { keepLastTurns: 2 }
    );

    expect(fnCallCamel.compressed.messages.some((m) => m?.role === "assistant" && m?.functionCall)).toBe(true);
    expect(fnCallCamel.compressed.messages.some((m) => m?.role === "tool")).toBe(true);
  });

  it("compress() wraps primitive contexts, archives with empty summary when llm_summary is absent, and only signals sharedContext", async () => {
    const tokenCache = await import("../../../../js/agents/shared/utils/token-cache.js");
    tokenCache.estimateTokensCached.mockReturnValue(0);

    const { CicadaCompressor, CompressionLayer } = await import("../../../../js/agents/runtime/compression/cicada-compressor.js");

    const sharedContext = { setSummary: vi.fn(), setIndex: vi.fn(), signal: vi.fn() };
    const compressor = new CicadaCompressor({ modelRouter: null });

    const result = await compressor.compress("hello", { stageKey: "stage-primitive", sharedContext });

    expect(result.metadata.layersApplied).toEqual([CompressionLayer.TOOL_OUTPUT, CompressionLayer.SESSION_HISTORY]);
    expect(result.metadata.llmSummary).toBe(null);
    expect(result.metadata.archiveId).toBe("stage-primitive");

    // No llmSummary => summaryText is empty, so setSummary/setIndex should be skipped.
    expect(sharedContext.setSummary).not.toHaveBeenCalled();
    expect(sharedContext.setIndex).not.toHaveBeenCalled();
    expect(sharedContext.signal).toHaveBeenCalledWith(
      "stage-primitive",
      expect.objectContaining({ type: "CICADA_SHED", archiveId: "stage-primitive" })
    );
  });

  it("compressToolOutput counts tool message content via content/output/result/empty fallbacks", async () => {
    const tokenCache = await import("../../../../js/agents/shared/utils/token-cache.js");
    tokenCache.estimateTokensCached.mockReturnValue(0);

    const { CicadaCompressor } = await import("../../../../js/agents/runtime/compression/cicada-compressor.js");
    const compressor = new CicadaCompressor();

    const { compressed, stats } = compressor._compressToolOutput(
      {
        messages: [
          { role: "tool", content: null, output: "OUT" },
          { role: "tool", content: null, result: { ok: true } },
          { role: "tool", content: null }, // content/output/result all missing -> empty string
          { role: "assistant", content: "ok" },
        ],
      },
      { maxToolOutputChars: 5 }
    );

    expect(compressed.messages).toHaveLength(4);
    expect(stats.originalSize).toBeGreaterThan(0);
  });

  it("_compressWithLLM accepts resp.text + raw objects, and normalizes wrong-type keyPoints/decisions/errors to empty arrays", async () => {
    const tokenCache = await import("../../../../js/agents/shared/utils/token-cache.js");
    tokenCache.estimateTokensCached.mockReturnValue(1);

    const modelRouterText = {
      call: vi.fn(async () => ({
        text: JSON.stringify({ summary: "S", keyPoints: "k", decisions: "d", errors: 5 }),
      })),
    };

    const { CicadaCompressor } = await import("../../../../js/agents/runtime/compression/cicada-compressor.js");
    const compressorText = new CicadaCompressor({ modelRouter: modelRouterText });

    const fromText = await compressorText._compressWithLLM({ any: "ctx" }, { maxInputChars: 500 });
    expect(fromText.summary).toBe("S");
    expect(fromText.keyPoints).toEqual([]);
    expect(fromText.decisions).toEqual([]);
    expect(fromText.errors).toEqual([]);

    const modelRouterObj = {
      call: vi.fn(async () => ({ summary: "S2", keyPoints: ["k2"], decisions: [], errors: [] })),
    };
    const compressorObj = new CicadaCompressor({ modelRouter: modelRouterObj });

    const fromObj = await compressorObj._compressWithLLM({ any: "ctx" }, { maxInputChars: 500 });
    expect(fromObj.summary).toBe("S2");
    expect(fromObj.keyPoints).toEqual(["k2"]);
  });

  it("archive adapter fallbacks: store()/archive() returning empty use key; listArchives pattern can match id when summary doesn't", async () => {
    const tokenCache = await import("../../../../js/agents/shared/utils/token-cache.js");
    tokenCache.estimateTokensCached.mockReturnValue(0);

    const { CicadaCompressor } = await import("../../../../js/agents/runtime/compression/cicada-compressor.js");

    const adapterStore = { store: vi.fn(async () => "") };
    const compressorStore = new CicadaCompressor({ archive: adapterStore });
    const storedKey = await compressorStore.archive("k1", { summary: "x", metadata: {} });
    expect(storedKey).toBe("k1");

    const adapterArchive = { archive: vi.fn(async () => "") };
    const compressorArchive = new CicadaCompressor({ archive: adapterArchive });
    const archivedKey = await compressorArchive.archive("k2", { summary: "y", metadata: {} });
    expect(archivedKey).toBe("k2");

    await compressorArchive.archive("idmatch", { summary: "nope", metadata: {} });
    const byId = await compressorArchive.listArchives({ limit: 10, pattern: "^idmatch$" });
    expect(byId.some((e) => e.id === "idmatch")).toBe(true);
  });

  it("buildHandoff covers fallback fields when sharedContext is missing and todos use title/text fields", async () => {
    const tokenCache = await import("../../../../js/agents/shared/utils/token-cache.js");
    tokenCache.estimateTokensCached.mockReturnValue(0);

    const { CicadaCompressor } = await import("../../../../js/agents/runtime/compression/cicada-compressor.js");
    const compressor = new CicadaCompressor();

    const handoff = compressor.buildHandoff(
      {
        runId: "run_fallbacks",
        // todos is not an array => fallback to []
        todos: "not an array",
        L1: { condensedMemory: { summary: "state summary", decisionTrace: ["d1"] } },
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

    // Also cover title/text todo fallbacks.
    const handoffTodos = compressor.buildHandoff(
      {
        runId: "run_titles",
        taskGoal: "goal",
        todos: [
          { title: "done via title", status: "done" },
          { text: "done via text", status: "completed" },
          { title: "pending via title", status: "open", priority: "high" },
        ],
        L1: { condensedMemory: { decisionTrace: [] }, claims: [] },
        L2: { warnings: ["w"] },
        iteration: 0,
      },
      {}
    );

    expect(handoffTodos.accomplished.completedTodos).toEqual(["done via title", "done via text"]);
    expect(handoffTodos.pending.todos).toEqual([{ content: "pending via title", priority: "high" }]);
    expect(handoffTodos.resumeGuide.nextAction).toBe("pending via title");
  });

  async function loadCicadaInternals() {
    const [{ readFile }, { fileURLToPath }] = await Promise.all([
      import("node:fs/promises"),
      import("node:url"),
    ]);
    const cicadaUrl = new URL("../../../../js/agents/runtime/compression/cicada-compressor.js", import.meta.url);
    const cicadaPath = fileURLToPath(cicadaUrl);
    const source = await readFile(cicadaUrl, "utf8");
    const importRe = /^import\s+\{\s*([^}]+)\}\s+from\s+["'][^"']+["'];/gm;
    let prepared = source.replace(importRe, "const { $1 } = __deps;");
    if (prepared === source) throw new Error("cicada test hook could not rewrite imports");
    prepared = prepared.replace(/^export\s+default\s+.*$/gm, "");
    prepared = prepared.replace(/^export\s+/gm, "");

    const factory = new Function(
      "__deps",
      `${prepared}\nreturn { safeStringify, truncateText, containsCjk, toTitle, isMergeSafeMessage };` +
        `\n//# sourceURL=${cicadaPath}`
    );

    return factory({
      isPlainObject: () => false,
      toNonEmptyString: (value) => (typeof value === "string" && value.trim() ? value : ""),
      estimateTokensCached: () => 0,
      robustParseJson: () => null,
      CicadaEvents: {},
      makeSecureTimestampedId: () => "archive_test",
      createLogger: () => ({
        log: () => {},
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      }),
    });
  }

  it("truncateText handles maxChars <= 3 without ellipsis", async () => {
    const { truncateText } = await loadCicadaInternals();
    expect(truncateText("abcdef", 3)).toBe("abc");
    expect(truncateText("abcdef", 2)).toBe("ab");
  });

  it("containsCjk returns false for empty and null inputs", async () => {
    const { containsCjk } = await loadCicadaInternals();
    expect(containsCjk("")).toBe(false);
    expect(containsCjk(null)).toBe(false);
  });

  it("toTitle falls back to defaults when maxWords/maxChars are non-numeric", async () => {
    const { toTitle } = await loadCicadaInternals();
    const byWords = toTitle(
      "one two three four five six seven eight nine ten eleven twelve",
      { maxWords: "nope", maxChars: "bad" }
    );
    expect(byWords).toBe("one two three four five six seven eight nine ten...");

    const byChars = toTitle("a".repeat(100), { maxWords: "nope", maxChars: "bad" });
    expect(byChars.length).toBe(83);
    expect(byChars.endsWith("...")).toBe(true);
  });

  it("isMergeSafeMessage rejects null/non-object inputs and extra attributes", async () => {
    const { isMergeSafeMessage } = await loadCicadaInternals();
    expect(isMergeSafeMessage(null)).toBe(false);
    expect(isMergeSafeMessage("nope")).toBe(false);
    expect(isMergeSafeMessage({ role: "assistant", content: "hi", extra: true })).toBe(false);
    expect(isMergeSafeMessage({ role: "assistant", content: "hi" })).toBe(true);
  });

  it("safeStringify falls back for circular references", async () => {
    const { safeStringify } = await loadCicadaInternals();
    const obj = {};
    obj.self = obj;
    expect(safeStringify(obj)).toBe("[object Object]");
  });
});
