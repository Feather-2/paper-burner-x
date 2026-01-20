import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  const traceContextInstances = [];
  class TraceContext {
    constructor(init = {}) {
      this.init = init;
      this.startSpan = vi.fn();
      this.endSpan = vi.fn();
      this.withSpan = vi.fn(async (_name, fn) => {
        const span = { setAttributes: vi.fn(), setAttribute: vi.fn() };
        return await fn(span);
      });
      traceContextInstances.push(this);
    }
  }
  TraceContext.parseTraceparent = vi.fn(() => ({ traceId: "trace", spanId: "span" }));

  return {
    normalizeText: vi.fn(),
    chunkText: vi.fn(),
    planSlides: vi.fn(),
    extractClaims: vi.fn(),
    buildContentPackage: vi.fn(),
    createStageApi: vi.fn(),
    injectSystemHint: vi.fn(),
    extractJsonCandidate: vi.fn(),
    TraceContext,
    traceContextInstances,
  };
});

const {
  normalizeText,
  chunkText,
  planSlides,
  extractClaims,
  buildContentPackage,
  createStageApi,
  injectSystemHint,
  extractJsonCandidate,
  TraceContext,
  traceContextInstances,
} = mocks;

vi.mock("../../../../../js/agents/stages/textprep/normalize.js", () => ({ normalizeText: mocks.normalizeText }));
vi.mock("../../../../../js/agents/stages/textprep/chunk.js", () => ({ chunkText: mocks.chunkText }));
vi.mock("../../../../../js/agents/stages/textprep/slideplan.js", () => ({ planSlides: mocks.planSlides }));
vi.mock("../../../../../js/agents/stages/textprep/claims.js", () => ({ extractClaims: mocks.extractClaims }));
vi.mock("../../../../../js/agents/stages/textprep/build-content-package.js", () => ({
  buildContentPackage: mocks.buildContentPackage,
}));
vi.mock("../../../../../js/agents/shared/index.js", async () => {
  const actual = await vi.importActual("../../../../../js/agents/shared/index.js");
  return {
    ...actual,
    createStageApi: mocks.createStageApi,
    injectSystemHint: mocks.injectSystemHint,
    extractJsonCandidate: mocks.extractJsonCandidate,
  };
});
vi.mock("../../../../../js/agents/plugins/telemetry/index.js", async () => {
  const actual = await vi.importActual("../../../../../js/agents/plugins/telemetry/index.js");
  return {
    ...actual,
    TraceContext: mocks.TraceContext,
  };
});

import { TextPrepStage, runTextPrepStage } from "../../../../../js/agents/stages/textprep/index.js";

const makeTraceContext = () => ({
  startSpan: vi.fn(),
  endSpan: vi.fn(),
  withSpan: vi.fn(async (_name, fn) => {
    const span = { setAttributes: vi.fn(), setAttribute: vi.fn() };
    return await fn(span);
  }),
});

beforeEach(() => {
  vi.clearAllMocks();
  traceContextInstances.length = 0;

  normalizeText.mockReturnValue({ normalized: "normalized", textHash: "hash", normalization: "v1" });
  chunkText.mockReturnValue(["chunk-1", "chunk-2"]);
  planSlides.mockResolvedValue([{ slideIntentId: "s1", pageType: "cover" }]);
  extractClaims.mockReturnValue({ claims: [], evidenceLedger: [] });
  buildContentPackage.mockImplementation(() => ({ metrics: { textprep: {} } }));
  injectSystemHint.mockImplementation((messages) => messages);
  extractJsonCandidate.mockReturnValue(null);
  createStageApi.mockImplementation((ctx = {}) => ({
    ...ctx,
    runContext: ctx.runContext || { runId: "run_default", constraints: {} },
    checkCancelled: ctx.checkCancelled || vi.fn(),
    emit: ctx.emit || vi.fn(),
    errorBoundary: ctx.errorBoundary || { wrap: async (fn) => fn() },
    runtimeHints: ctx.runtimeHints || {},
    aiApiService: ctx.aiApiService,
    traceContext: ctx.traceContext || makeTraceContext(),
  }));
  TraceContext.parseTraceparent.mockImplementation(() => ({ traceId: "trace", spanId: "span" }));
});

describe("TextPrepStage", () => {
  it("runs full pipeline with LLM alignment and chunk option overrides", async () => {
    const stage = new TextPrepStage();
    const traceContext = makeTraceContext();
    const aiApiService = { chat: vi.fn().mockResolvedValue({ content: "llm-output" }) };

    planSlides.mockResolvedValue([
      { slideIntentId: "s1", pageType: "cover" },
      { slideIntentId: "s2", pageType: "overview" },
    ]);
    extractClaims.mockReturnValue({
      claims: [
        { claimId: "c1", text: "Claim 1" },
        { claimId: "c2", text: "Claim 2" },
      ],
      evidenceLedger: [],
    });
    extractJsonCandidate.mockReturnValue(
      JSON.stringify([
        { slideIntentId: "s2", claimIds: ["c2", "c404"] },
        { slideIntentId: "missing", claimIds: ["c1"] },
      ])
    );

    const result = await stage.run(
      { text: "hello", chunkOptions: { chunkSize: "1024", overlap: -1 } },
      {
        runContext: { runId: "run_llm", constraints: {} },
        aiApiService,
        runtimeHints: { system: "SYS" },
        traceContext,
      }
    );

    expect(normalizeText).toHaveBeenCalledWith("hello");
    expect(chunkText).toHaveBeenCalledWith(
      "normalized",
      expect.objectContaining({ chunkSize: "1024", overlap: -1, includeLineNumbers: true })
    );
    expect(injectSystemHint).toHaveBeenCalled();
    expect(injectSystemHint.mock.calls[0][1]).toBe("SYS");
    expect(aiApiService.chat).toHaveBeenCalledTimes(1);
    expect(extractJsonCandidate).toHaveBeenCalledTimes(1);

    const alignedSlides = buildContentPackage.mock.calls[0][2];
    expect(alignedSlides).toEqual([
      { slideIntentId: "s1", pageType: "cover", claimIds: [] },
      { slideIntentId: "s2", pageType: "overview", claimIds: ["c2"] },
    ]);

    expect(result.metrics.textprep.chunkCount).toBe(2);
    const spanNames = traceContext.withSpan.mock.calls.map((call) => call[0]);
    expect(spanNames).toContain("textprep.llm.chat");
  });

  it("uses heuristic alignment when aiApiService is missing", async () => {
    const stage = new TextPrepStage();
    const previousAiApiService = globalThis.aiApiService;
    globalThis.aiApiService = undefined;

    planSlides.mockResolvedValue([
      { slideIntentId: "s_cover", pageType: "cover" },
      { slideIntentId: "s_agenda", pageType: "agenda" },
      { slideIntentId: "s_overview", pageType: "overview" },
      { slideIntentId: "s_process", pageType: "process" },
      { slideIntentId: "s_comparison", pageType: "comparison" },
      { slideIntentId: "s_detail", pageType: "detail" },
      { slideIntentId: "s_summary", pageType: "summary" },
      { slideIntentId: "s_extra", pageType: "detail" },
    ]);
    extractClaims.mockReturnValue({
      claims: [
        { claimId: "c1" },
        { claimId: "c2" },
        { claimId: "c3" },
        { claimId: "c4" },
      ],
      evidenceLedger: [],
    });

    let result;
    try {
      result = await stage.run("text", {
        runContext: { runId: "run_heuristic", constraints: {} },
      });
    } finally {
      globalThis.aiApiService = previousAiApiService;
    }

    const alignedSlides = buildContentPackage.mock.calls[0][2];
    expect(alignedSlides).toEqual([
      { slideIntentId: "s_cover", pageType: "cover", claimIds: [] },
      { slideIntentId: "s_agenda", pageType: "agenda", claimIds: [] },
      { slideIntentId: "s_overview", pageType: "overview", claimIds: ["c1", "c2", "c3", "c4"] },
      { slideIntentId: "s_process", pageType: "process", claimIds: ["c1", "c2"] },
      { slideIntentId: "s_comparison", pageType: "comparison", claimIds: ["c3", "c4"] },
      { slideIntentId: "s_detail", pageType: "detail", claimIds: [] },
      { slideIntentId: "s_summary", pageType: "summary", claimIds: ["c1", "c2", "c3", "c4"] },
      { slideIntentId: "s_extra", pageType: "detail", claimIds: [] },
    ]);
    expect(injectSystemHint).not.toHaveBeenCalled();
    expect(extractJsonCandidate).not.toHaveBeenCalled();
    expect(result.metrics.textprep.chunkCount).toBe(2);
  });

  it.each([
    { name: "null", input: null, expected: "" },
    { name: "undefined", input: undefined, expected: "" },
    { name: "empty string", input: "", expected: "" },
    { name: "whitespace string", input: "   ", expected: "   " },
    { name: "empty array", input: [], expected: "" },
    { name: "empty object", input: {}, expected: "" },
    { name: "sources empty array", input: { sources: [] }, expected: "" },
    { name: "sources non-array", input: { sources: { a: 1 } }, expected: "" },
    { name: "text property", input: { text: "hello" }, expected: "hello" },
    { name: "rawText property", input: { rawText: "raw" }, expected: "raw" },
    { name: "sources array string", input: { sources: ["a", "b"] }, expected: "a\n\n---\n\nb" },
    {
      name: "sources array object",
      input: { sources: [{ textNormalized: "n1" }, { text: "t2" }] },
      expected: "n1\n\n---\n\nt2",
    },
    { name: "deep nested object", input: { deep: { nested: { value: "x" } } }, expected: "" },
  ])("normalizes raw text for $name input", async ({ input, expected }) => {
    const stage = new TextPrepStage();

    await stage.run(input, { runContext: { runId: "run_case", constraints: {} } });

    expect(normalizeText).toHaveBeenCalledTimes(1);
    expect(normalizeText).toHaveBeenCalledWith(expected);
  });

  it("truncates overlong raw text", async () => {
    const stage = new TextPrepStage();
    const maxLen = 2 * 1024 * 1024;
    const longText = "a".repeat(maxLen + 10);

    await stage.run(longText, { runContext: { runId: "run_long", constraints: {} } });

    const passed = normalizeText.mock.calls[0][0];
    expect(passed.length).toBe(maxLen);
    expect(passed).toBe(longText.slice(0, maxLen));
  });

  it("limits sources to max count", async () => {
    const stage = new TextPrepStage();
    const sources = Array.from({ length: 101 }, (_, i) => `S${i}`);

    await stage.run({ sources }, { runContext: { runId: "run_sources", constraints: {} } });

    const passed = normalizeText.mock.calls[0][0];
    expect(passed.includes("S99")).toBe(true);
    expect(passed.includes("S100")).toBe(false);
  });

  it("returns fallback package when error boundary recovers", async () => {
    const stage = new TextPrepStage();
    const errorBoundary = {
      wrap: async (fn, opts = {}) => {
        try {
          return await fn();
        } catch (err) {
          return opts?.context?.fallbackFactory?.(err);
        }
      },
    };

    normalizeText
      .mockImplementationOnce(() => {
        throw new Error("boom");
      })
      .mockReturnValue({ normalized: "fallback", textHash: "hash2", normalization: "v2" });

    const result = await stage.run("text", {
      runContext: { runId: "run_fallback", constraints: { pageCount: -1 } },
      errorBoundary,
    });

    expect(planSlides).not.toHaveBeenCalled();
    expect(normalizeText).toHaveBeenCalledTimes(2);
    expect(buildContentPackage).toHaveBeenCalledTimes(1);
    const runContextArg = buildContentPackage.mock.calls[0][0];
    expect(runContextArg.mode).toBe("textprep");
    const alignedSlides = buildContentPackage.mock.calls[0][2];
    expect(alignedSlides.length).toBe(8);
    expect(result.metrics.textprep.chunkCount).toBe(2);
  });

  it("rethrows when error boundary does not recover", async () => {
    const stage = new TextPrepStage();
    normalizeText.mockImplementation(() => {
      throw new Error("boom");
    });

    await expect(stage.run("text", { runContext: { runId: "run_error", constraints: {} } })).rejects.toThrow("boom");
  });

  it("falls back to heuristic when LLM JSON is invalid", async () => {
    const stage = new TextPrepStage();
    const aiApiService = { chat: vi.fn().mockResolvedValue({ content: "bad-json" }) };

    planSlides.mockResolvedValue([{ slideIntentId: "s_overview", pageType: "overview" }]);
    extractClaims.mockReturnValue({
      claims: [{ claimId: "c1" }, { claimId: "c2" }],
      evidenceLedger: [],
    });
    extractJsonCandidate.mockReturnValue("{");

    await stage.run("text", {
      runContext: { runId: "run_bad_json", constraints: {} },
      aiApiService,
    });

    expect(aiApiService.chat).toHaveBeenCalledTimes(1);
    expect(extractJsonCandidate).toHaveBeenCalledTimes(1);
    const alignedSlides = buildContentPackage.mock.calls[0][2];
    expect(alignedSlides).toEqual([
      { slideIntentId: "s_overview", pageType: "overview", claimIds: ["c1", "c2"] },
    ]);
  });

  it("handles concurrent runs independently", async () => {
    const stage = new TextPrepStage();

    normalizeText.mockImplementation((raw) => ({ normalized: `${raw}-norm`, textHash: raw, normalization: "v1" }));
    chunkText.mockImplementation((norm) => [`chunk:${norm}`]);
    planSlides.mockResolvedValue([{ slideIntentId: "s1", pageType: "cover" }]);
    extractClaims.mockReturnValue({ claims: [], evidenceLedger: [] });
    buildContentPackage.mockImplementation((runContext) => ({ metrics: { textprep: {} }, runId: runContext.runId }));

    const [resultA, resultB] = await Promise.all([
      stage.run("A", { runContext: { runId: "runA", constraints: {} } }),
      stage.run("B", { runContext: { runId: "runB", constraints: {} } }),
    ]);

    expect(resultA.runId).toBe("runA");
    expect(resultB.runId).toBe("runB");
    expect(resultA.metrics.textprep.chunkCount).toBe(1);
    expect(resultB.metrics.textprep.chunkCount).toBe(1);
  });

  it("handles rapid sequential runs with boundary chunk sizes", async () => {
    const stage = new TextPrepStage();

    await stage.run(
      { text: "first", chunkOptions: { chunkSize: 0 } },
      { runContext: { runId: "run1", constraints: {} } }
    );
    await stage.run(
      { text: "second", chunkOptions: { chunkSize: Number.MAX_SAFE_INTEGER } },
      { runContext: { runId: "run2", constraints: {} } }
    );

    expect(chunkText.mock.calls[0][1].chunkSize).toBe(0);
    expect(chunkText.mock.calls[1][1].chunkSize).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("runTextPrepStage", () => {
  it("delegates to TextPrepStage.execute", async () => {
    const executeSpy = vi.spyOn(TextPrepStage.prototype, "execute").mockResolvedValue({ ok: true });
    const runContext = { runId: "run_exec" };
    const input = "input";
    const stageApi = { hint: "value" };

    const result = await runTextPrepStage(runContext, input, stageApi);

    expect(executeSpy).toHaveBeenCalledWith(runContext, input, stageApi);
    expect(result).toEqual({ ok: true });
    executeSpy.mockRestore();
  });
});
