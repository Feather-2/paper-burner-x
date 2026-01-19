import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_MODE_CONFIG,
  buildConvergenceSample,
  deepSortForStableJson,
  getModeConfig,
  normalizeBehaviorFingerprintConfig,
  normalizeNewlines,
  normalizeReportConvergenceConfig,
  normalizeToolCallGuard,
  resolveErrorBoundary,
  resolveStageTraceContext,
  sliceTail,
  stableStringify,
  toClamped01Float,
} from '../../../../../js/agents/stages/deepsearch/deepsearch-helpers.js';
import { checkCancelled, generateNodeId, makeStageEmitter } from '../../../../../js/agents/stages/deepsearch/stage-utils.js';
import { SourceManager } from '../../../../../js/agents/stages/deepsearch/source-manager.js';
import { TraceContext } from '../../../../../js/agents/runtime/telemetry/trace-context.js';
import { ErrorBoundary, getErrorBoundary } from '../../../../../js/agents/runtime/core/error-boundary.js';

describe("deepsearch/deepsearch-helpers", () => {
  it("deepSortForStableJson: deep-sorts object keys and handles circular refs", () => {
    const obj = { b: 1, a: { d: 2, c: 3 }, arr: [{ z: 1, y: 2 }] };
    obj.self = obj;

    expect(deepSortForStableJson(obj)).toEqual({
      a: { c: 3, d: 2 },
      arr: [{ y: 2, z: 1 }],
      b: 1,
      self: "[Circular]",
    });
  });

  it("stableStringify: produces stable key ordering and truncates when needed", () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');

    const truncated = stableStringify({ a: "x".repeat(50) }, { maxChars: 10 });
    expect(truncated.endsWith("...")).toBe(true);
    expect(truncated.length).toBe(13);
  });

  it("toClamped01Float: clamps to [0,1] and falls back on invalid input", () => {
    expect(toClamped01Float("0.2", 0.5)).toBeCloseTo(0.2);
    expect(toClamped01Float(2, 0.5)).toBe(1);
    expect(toClamped01Float(-1, 0.5)).toBe(0);
    expect(toClamped01Float("nope", 0.5)).toBe(0.5);
  });

  it("normalizeReportConvergenceConfig: normalizes defaults and clamps thresholds", () => {
    expect(normalizeReportConvergenceConfig(null)).toEqual({
      enabled: false,
      stopOnConvergence: true,
      windowSize: 5,
      minIterations: 4,
      minReportChars: 1200,
      sampleMaxChars: 6000,
      entropyThreshold: undefined,
      similarityThreshold: undefined,
    });

    expect(
      normalizeReportConvergenceConfig({
        enabled: true,
        stopOnConvergence: false,
        window: "3",
        minIters: "2",
        minChars: 100,
        maxChars: 1234,
        entropyThreshold: 2,
        similarityThreshold: -1,
      }),
    ).toEqual({
      enabled: true,
      stopOnConvergence: false,
      windowSize: 3,
      minIterations: 2,
      minReportChars: 100,
      sampleMaxChars: 1234,
      entropyThreshold: 1,
      similarityThreshold: 0,
    });
  });

  it("normalizeNewlines / sliceTail: normalizes CRLF and slices from tail", () => {
    expect(normalizeNewlines("a\r\nb\rc")).toBe("a\nb\nc");
    expect(sliceTail("abcdef", 3)).toBe("def");
    expect(sliceTail("abcdef", 0)).toBe("abcdef");
  });

  it("buildConvergenceSample: builds a report+gaps snapshot and caps gap lines", () => {
    const gaps = Array.from({ length: 40 }, (_, i) => ({
      gapId: `gap_${i}`,
      status: "open",
      question: `Question ${i}`,
    }));

    const sample = buildConvergenceSample({
      reportMarkdown: "0123456789\r\nabcdefghij",
      gaps,
      maxChars: 6,
    });

    expect(sample).toContain("REPORT:\n");
    expect(sample).toContain("GAPS:\n");
    expect(sample).toContain("efghij");

    const gapLines = sample.split("\n").filter((line) => line.startsWith("gap_"));
    expect(gapLines).toHaveLength(30);
  });

  it("resolveErrorBoundary: prefers injected boundary, otherwise falls back to global", () => {
    const direct = new ErrorBoundary();
    expect(resolveErrorBoundary({ errorBoundary: direct })).toBe(direct);

    const fromContainer = new ErrorBoundary();
    const containerTryGet = { tryGet: (name) => (name === "errorBoundary" ? fromContainer : null) };
    expect(resolveErrorBoundary({ container: containerTryGet })).toBe(fromContainer);

    const globalBoundary = getErrorBoundary();
    const containerThrowingGet = { get: () => { throw new Error("not registered"); } };
    const resolved = resolveErrorBoundary({ container: containerThrowingGet });
    expect(resolved).toBe(globalBoundary);
    expect(typeof resolved.wrap).toBe("function");
  });

  it("normalizeToolCallGuard: normalizes thresholds and ignoreTools", () => {
    const cfg = normalizeToolCallGuard({ enabled: true, maxConsecutive: "2", ignoreTools: ["toolA", 42, ""] });
    expect(cfg.enabled).toBe(true);
    expect(cfg.maxConsecutive).toBe(2);
    expect(cfg.warnAt).toBe(2);
    expect(cfg.maxSigChars).toBe(2000);
    expect(cfg.ignoreTools.has("toolA")).toBe(true);
    expect(cfg.ignoreTools.has("42")).toBe(true);
    expect(cfg.ignoreTools.has("")).toBe(false);
  });

  it("normalizeBehaviorFingerprintConfig: supports disabling and default enabled config", () => {
    expect(normalizeBehaviorFingerprintConfig(false)).toEqual({ enabled: false });

    const cfg = normalizeBehaviorFingerprintConfig({ enabled: true, historySize: "10", minPatternLength: 3, maxPatternLength: 8, loopThreshold: 4 });
    expect(cfg).toEqual({ enabled: true, historySize: 10, minPatternLength: 3, maxPatternLength: 8, loopThreshold: 4 });
  });

  it("resolveStageTraceContext: accepts injected traceContext or parses traceparent", () => {
    const injected = { startSpan: () => {}, endSpan: () => {}, withSpan: async (name, fn) => fn() };
    expect(resolveStageTraceContext({ traceContext: injected })).toBe(injected);

    const traceId = "a".repeat(32);
    const parentSpanId = "b".repeat(16);
    const ctx = resolveStageTraceContext({ traceparent: `00-${traceId}-${parentSpanId}-01` });
    expect(ctx).toBeInstanceOf(TraceContext);
    expect(ctx.traceId).toBe(traceId);

    const span = ctx.startSpan("child");
    expect(span.parentSpanId).toBe(parentSpanId);
  });

  it("getModeConfig: merges defaults and preserves default description", () => {
    const cfg = getModeConfig("wider", { agent: { wider: { maxIterations: 99, description: "override", subagentIterations: 7 } } });
    expect(cfg.description).toBe(DEFAULT_MODE_CONFIG.wider.description);
    expect(cfg.maxIterations).toBe(99);
    expect(cfg.subagentIterations).toBe(7);

    const cfg2 = getModeConfig("quick", { agent: { quick: { subagentIterations: 0 } } });
    expect(cfg2.subagentIterations).toBe(DEFAULT_MODE_CONFIG.quick.subagentIterations);
  });
});

describe("deepsearch/stage-utils", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2100-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("makeStageEmitter: emits schema-shaped events with throttling and context", () => {
    const calls = [];
    const stageApi = {
      emit: (name, payload) => calls.push({ name, payload }),
    };

    const emitter = makeStageEmitter(stageApi, "actor_x", () => ({ runId: "run_1", stage: "deepsearch" }));
    expect(typeof emitter).toBe("function");

    emitter("evt", { ok: true });
    emitter("evt", { ok: "skipped" });
    emitter("evt", { ok: "forced" }, { throttle: false });

    expect(calls).toHaveLength(2);
    expect(calls[0].name).toBe("evt");
    expect(calls[0].payload).toMatchObject({
      schemaVersion: expect.any(String),
      name: "evt",
      actor: "actor_x",
      status: "completed",
      runId: "run_1",
      stage: "deepsearch",
      payload: { ok: true },
    });
    expect(typeof calls[0].payload.ts).toBe("string");
  });

  it("makeStageEmitter: uses stageApi.emit before eventBus.emit and allows per-name throttle windows", () => {
    const calls = [];
    const stageApi = {
      emit: (name) => calls.push(`stage:${name}`),
      eventBus: { emit: (name) => calls.push(`bus:${name}`) },
    };
    const emitter = makeStageEmitter(stageApi);
    emitter("evt_a", {});
    emitter("evt_b", {});
    emitter("evt_a", {}); // throttled; evt_b should still pass independently

    expect(calls).toEqual(["stage:evt_a", "stage:evt_b"]);
  });

  it("generateNodeId: includes components and increments counter for same timestamp", () => {
    const id1 = generateNodeId("runX", "kindY", { stage: "s", iteration: 2, trajectoryId: "t" });
    const id2 = generateNodeId("runX", "kindY", { stage: "s", iteration: 2, trajectoryId: "t" });

    expect(id1).toContain("runX_kindY_s_i2_t_");
    expect(id2).toContain("runX_kindY_s_i2_t_");
    expect(id1).not.toBe(id2);

    const counter1 = id1.split("_").at(-1);
    const counter2 = id2.split("_").at(-1);
    expect(counter1).toBe("0");
    expect(counter2).toBe("1");

    vi.advanceTimersByTime(1);
    const id3 = generateNodeId("runX", "kindY");
    expect(id3.split("_").at(-1)).toBe("0");
  });

  it("checkCancelled: delegates to stageApi.checkCancelled and throws on aborted signals", () => {
    const stageApi = { checkCancelled: vi.fn() };
    checkCancelled(stageApi);
    expect(stageApi.checkCancelled).toHaveBeenCalledTimes(1);

    const controller = new AbortController();
    controller.abort("Stop");
    expect(() => checkCancelled({ signal: controller.signal })).toThrow(/Stop/);

    const controller2 = new AbortController();
    controller2.abort(new Error("x"));
    expect(() => checkCancelled({ signal: controller2.signal })).toThrow(/Run cancelled/);
  });
});

describe("deepsearch/source-manager", () => {
  function makeSources() {
    return [
      {
        sourceId: "doc_a",
        name: "Doc A",
        sourceText: "RAW_A",
        sourceTextNormalized: "# Intro\nIntro line\n# Details\nDetail line\n",
      },
      {
        docId: "doc_b",
        title: "Doc B",
        text: "alpha term\nbeta term\n",
      },
      { sourceId: "doc_a", name: "Duplicate", sourceText: "SHOULD_IGNORE" },
    ];
  }

  it("syncSources/setSources: maintains id map and detects ref/length changes", () => {
    const src = makeSources();
    const mgr = new SourceManager(src);

    expect(mgr.listSources().map((s) => s.sourceId)).toEqual(["doc_a", "doc_b"]);

    expect(mgr.syncSources(src)).toBe(false);
    expect(mgr.syncSources([...src])).toBe(true);
  });

  it("getSource/getSourceText: resolves by id or case-insensitive name and respects preferNormalized", () => {
    const mgr = new SourceManager(makeSources());
    expect(mgr.getSource("doc_a")?.name).toBe("Doc A");
    expect(mgr.getSource("doc a")?.sourceId).toBe("doc_a");

    expect(mgr.getSourceText("doc_a")).toContain("# Intro");
    const rawPreferred = new SourceManager(makeSources(), { preferNormalized: false });
    expect(rawPreferred.getSourceText("doc_a")).toBe("RAW_A");
  });

  it("getLineStarts: caches by sourceId+text and invalidates when text changes", () => {
    const sources = makeSources();
    const mgr = new SourceManager(sources);

    const starts1 = mgr.getLineStarts("doc_b");
    const starts2 = mgr.getLineStarts("doc_b");
    expect(starts1).toBe(starts2);

    sources[1].text = "alpha term\nbeta term\nextra\n";
    const starts3 = mgr.getLineStarts("doc_b");
    expect(starts3).not.toBe(starts1);
    expect(starts3?.length).toBe(4);
  });

  it("read: supports not-found, preview, section, lines, chars, and full modes", () => {
    const mgr = new SourceManager(makeSources());

    const missing = mgr.read("missing_doc");
    expect(missing.success).toBe(false);
    expect(missing.available).toContain("doc_a");

    const preview = mgr.read("doc_a", { preview: true, maxLength: 5000 });
    expect(preview).toMatchObject({ success: true, readMode: "preview", sourceId: "doc_a" });
    expect(preview.content).toContain("## 文档结构");
    expect(preview.content).toContain("- Intro");
    expect(preview.content).toContain("- Details");

    const section = mgr.read("doc_a", { section: "Intro", maxLength: 5000 });
    expect(section).toMatchObject({ success: true, readMode: "section", found: true });
    expect(section.content).toContain("# Intro");
    expect(section.content).not.toContain("# Details");

    const sectionMissing = mgr.read("doc_a", { section: "Missing", maxLength: 5000 });
    expect(sectionMissing.success).toBe(false);
    expect(sectionMissing.error).toContain("Section not found");
    expect(sectionMissing.hint).toContain("Intro");

    const lines = mgr.read("doc_a", { startLine: 2, endLine: 2, maxLength: 5000 });
    expect(lines).toMatchObject({ success: true, readMode: "lines", startLine: 2, endLine: 2 });
    expect(lines.content.trim()).toBe("Intro line");

    const chars = mgr.read("doc_a", { start: 2, end: 10, maxLength: 5000 });
    expect(chars).toMatchObject({ success: true, readMode: "chars" });
    expect(chars.lineStart).toBeGreaterThanOrEqual(1);
    expect(chars.lineEnd).toBeGreaterThanOrEqual(chars.lineStart);

    const full = mgr.read("doc_b", { maxLength: 5 });
    expect(full).toMatchObject({ success: true, readMode: "full", truncated: true });
    expect(full.content).toContain("... (truncated)");
  });

  it("search: scans line-level matches with snippets and respects source filtering", () => {
    const mgr = new SourceManager(makeSources());

    const results = mgr.search("term", { limit: 2 });
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results[0]).toMatchObject({ sourceId: "doc_b", line: 1 });
    expect(results[0].snippet.toLowerCase()).toContain("term");

    const filtered = mgr.search("term", { sources: ["doc_a"], limit: 5 });
    expect(filtered).toEqual([]);
  });

  it("semanticSearch: falls back without embeddingService and reranks with embeddings", async () => {
    const mgr = new SourceManager(makeSources());

    const fallback = await mgr.semanticSearch("term", { limit: 2 });
    expect(fallback.map((r) => r.sourceId)).toEqual(["doc_b", "doc_b"]);

    const embedCalls = [];
    const embeddingService = {
      embed: async (texts, opts) => {
        embedCalls.push({ texts, opts });
        return [
          [1, 0], // query
          [0, 1], // candidate 0
          [1, 0], // candidate 1 (best)
        ];
      },
    };

    const ranked = await mgr.semanticSearch("term", { limit: 2, embeddingService, timeoutMs: 123 });
    expect(embedCalls).toHaveLength(1);
    expect(embedCalls[0].opts).toEqual({ timeoutMs: 123 });
    expect(ranked).toHaveLength(2);
    expect(ranked[0].line).toBe(2);
    expect(ranked[0].score).toBeGreaterThanOrEqual(ranked[1].score);

    const badEmbeddingService = { embed: async () => null };
    const noVectors = await mgr.semanticSearch("term", { limit: 2, embeddingService: badEmbeddingService });
    expect(noVectors.map((r) => r.line)).toEqual([1, 2]);
  });
});

