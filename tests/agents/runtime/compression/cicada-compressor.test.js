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
});
