import { describe, it, expect, vi, beforeEach } from "vitest";

const sharedMocks = vi.hoisted(() => ({
  injectSystemHint: vi.fn(),
  extractJsonCandidate: vi.fn(),
}));

const constantsMock = vi.hoisted(() => ({
  ALLOWED_PAGE_TYPES: new Set(["cover", "agenda", "overview", "comparison", "process", "summary", "appendix", "architecture", "conclusion"]),
  PageType: {
    COVER: "cover",
    AGENDA: "agenda",
    OVERVIEW: "overview",
    COMPARISON: "comparison",
    PROCESS: "process",
    SUMMARY: "summary",
    APPENDIX: "appendix",
    ARCHITECTURE: "architecture",
    CONCLUSION: "conclusion",
  },
}));

vi.mock("../../../../../js/agents/stages/textprep/constants.js", () => ({
  ALLOWED_PAGE_TYPES: constantsMock.ALLOWED_PAGE_TYPES,
  PageType: constantsMock.PageType,
}));

vi.mock("../../../../../js/agents/shared/index.js", async () => {
  const actual = await vi.importActual("../../../../../js/agents/shared/index.js");
  return {
    ...actual,
    injectSystemHint: sharedMocks.injectSystemHint,
    extractJsonCandidate: sharedMocks.extractJsonCandidate,
  };
});

import { planSlides, generateSlideIntents } from "../../../../../js/agents/stages/textprep/slideplan.js";

const CORE_PAGE_TYPES = ["cover", "agenda", "overview", "summary"];

function makeChunk(text, chunkId = "c1") {
  return { chunkId, text, locator: { charStart: 0, charEnd: text.length } };
}

function assertCoreSlides(result) {
  const pageTypes = result.map((s) => s.pageType);
  for (const pageType of CORE_PAGE_TYPES) {
    expect(pageTypes).toContain(pageType);
  }
}

function assertUniqueIds(result) {
  const ids = result.map((s) => s.slideIntentId);
  expect(new Set(ids).size).toBe(ids.length);
}

beforeEach(() => {
  vi.clearAllMocks();
  sharedMocks.injectSystemHint.mockImplementation((messages) => messages);
  sharedMocks.extractJsonCandidate.mockImplementation(() => null);
  delete globalThis.aiApiService;
});

describe("planSlides", () => {
  it("uses aiApiService, normalizes intents, and injects core slides", async () => {
    const aiApiService = {
      chat: vi.fn(async () => ({ content: "raw-content" })),
    };
    const constraints = {
      model: "gpt-test",
      llmTimeout: 12345,
      tone: "formal",
      nested: { a: { b: { c: "deep" } } },
      __services: { aiApiService, runtimeHints: { system: "SYS_HINT" } },
    };
    const longText = `Line 1\n\n\tLine 2 ${"x".repeat(2000)}`;
    const chunks = [
      makeChunk("My Deck Title\nSecond line", "c1"),
      makeChunk(longText, "c2"),
      ...Array.from({ length: 10 }, (_, i) => makeChunk(`Extra ${i}`, `c${i + 3}`)),
    ];

    const rawIntents = [
      {
        slideIntentId: "",
        pageType: "INVALID",
        title: "  ",
        objective: "Objective",
        keyPoints: ["  ", "Key 1", 2],
        claimIds: ["c1", "", null],
      },
      {
        slideIntentId: "dup",
        pageType: "PROCESS",
        title: "Process",
        keyPoints: "not array",
        claimIds: ["c2"],
      },
      {
        slideIntentId: "dup",
        pageType: "SUMMARY",
        title: "Summary",
        keyPoints: ["y"],
      },
    ];

    sharedMocks.extractJsonCandidate.mockReturnValue(JSON.stringify(rawIntents));
    sharedMocks.injectSystemHint.mockImplementation((messages, hint) => [...messages, { role: "system", content: `hint:${hint}` }]);

    const result = await planSlides(chunks, constraints);

    expect(aiApiService.chat).toHaveBeenCalledTimes(1);
    const chatArgs = aiApiService.chat.mock.calls[0][0];
    expect(chatArgs.model).toBe("gpt-test");
    expect(chatArgs.temperature).toBe(0.2);
    expect(chatArgs.maxTokens).toBe(1200);
    expect(chatArgs.timeout).toBe(12345);

    expect(sharedMocks.injectSystemHint).toHaveBeenCalledTimes(1);
    expect(sharedMocks.injectSystemHint.mock.calls[0][1]).toBe("SYS_HINT");
    expect(chatArgs.messages).toEqual(sharedMocks.injectSystemHint.mock.results[0].value);

    const userMessage = chatArgs.messages.find((m) => m.role === "user");
    expect(userMessage).toBeTruthy();
    const payload = JSON.parse(userMessage.content);
    expect(payload.constraints.__services).toBeUndefined();
    expect(payload.constraints.model).toBe("gpt-test");
    expect(payload.constraints.nested).toEqual({ a: { b: { c: "deep" } } });
    expect(payload.chunkSnippets).toHaveLength(10);
    expect(payload.chunkSnippets[0].chunkId).toBe("c1");
    expect(payload.chunkSnippets[1].text.length).toBeLessThanOrEqual(700);
    expect(payload.chunkSnippets[1].text.includes("\n")).toBe(false);
    expect(payload.chunkSnippets[1].text.includes("\t")).toBe(false);

    expect(sharedMocks.extractJsonCandidate).toHaveBeenCalledWith("raw-content", { prefer: "array" });

    expect(result).toHaveLength(5);
    assertCoreSlides(result);
    assertUniqueIds(result);
    expect(result[0].pageType).toBe("cover");
    expect(result[0].title).toBe("My Deck Title");
    expect(result.filter((s) => s.pageType === "summary")).toHaveLength(1);

    const overview = result.find((s) => s.pageType === "overview" && s.title === "Slide 1");
    expect(overview).toBeTruthy();
    expect(overview.objective).toBe("Objective");
    expect(overview.keyPoints).toEqual(["Key 1", "2"]);
    expect(overview.claimIds).toEqual(["c1"]);

    const process = result.find((s) => s.title === "Process");
    expect(process.pageType).toBe("process");
    expect(process.claimIds).toEqual(["c2"]);
    expect(process).not.toHaveProperty("keyPoints");
  });

  it("falls back to heuristic when LLM throws", async () => {
    const aiApiService = {
      chat: vi.fn(async () => {
        throw new Error("boom");
      }),
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await planSlides([makeChunk("Title")], { __services: { aiApiService } });

    expect(aiApiService.chat).toHaveBeenCalledTimes(1);
    expect(sharedMocks.extractJsonCandidate).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0][1] ?? warn.mock.calls[0][0])).toContain("LLM call failed");
    expect(result).toHaveLength(8);
    assertCoreSlides(result);

    warn.mockRestore();
  });

  it("falls back when JSON candidate exceeds max length", async () => {
    const aiApiService = { chat: vi.fn(async () => ({ content: "big" })) };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const hugeCandidate = `[${"a".repeat(64001)}]`;

    sharedMocks.extractJsonCandidate.mockReturnValue(hugeCandidate);

    const result = await planSlides([], { __services: { aiApiService } });

    expect(sharedMocks.extractJsonCandidate).toHaveBeenCalledWith("big", { prefer: "array" });
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0][1] ?? warn.mock.calls[0][0])).toContain("JSON candidate exceeds max length");
    expect(result).toHaveLength(8);
    assertCoreSlides(result);

    warn.mockRestore();
  });

  it("falls back when JSON parsing fails", async () => {
    const aiApiService = { chat: vi.fn(async () => ({ content: "bad" })) };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    sharedMocks.extractJsonCandidate.mockReturnValue("{ not json }");

    const result = await planSlides([], { __services: { aiApiService } });

    expect(sharedMocks.extractJsonCandidate).toHaveBeenCalledWith("bad", { prefer: "array" });
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0][1] ?? warn.mock.calls[0][0])).toContain("JSON parse failed");
    expect(result).toHaveLength(8);
    assertCoreSlides(result);

    warn.mockRestore();
  });

  it("handles boundary values and type edges in heuristic fallback", async () => {
    const cases = [
      { chunks: null, constraints: null, expectedLength: 8 },
      { chunks: undefined, constraints: undefined, expectedLength: 8 },
      { chunks: [], constraints: {}, expectedLength: 8 },
      { chunks: [makeChunk("", "c0")], constraints: {}, expectedLength: 8 },
      { chunks: { text: "not array" }, constraints: { pageCount: "7" }, expectedLength: 8 },
      { chunks: [], constraints: { pageCount: 0 }, expectedLength: 8 },
      { chunks: [], constraints: { pageCount: -1 }, expectedLength: 8 },
      { chunks: [], constraints: { pageCountRange: [-1, -1] }, expectedLength: 4 },
    ];

    for (const testCase of cases) {
      const result = await planSlides(testCase.chunks, testCase.constraints);
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(testCase.expectedLength);
      assertCoreSlides(result);
    }
  });

  it("truncates overlong intent lists from LLM output", async () => {
    const aiApiService = { chat: vi.fn(async () => ({ content: "lots" })) };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rawIntents = Array.from({ length: 101 }, (_, i) => ({
      slideIntentId: `s_${i}`,
      pageType: "overview",
      title: `Slide ${i}`,
    }));

    sharedMocks.extractJsonCandidate.mockReturnValue(JSON.stringify(rawIntents));

    const result = await planSlides([], { __services: { aiApiService } });

    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0][1] ?? warn.mock.calls[0][0])).toContain("truncating to 100");
    expect(result).toHaveLength(103);
    assertCoreSlides(result);
    assertUniqueIds(result);

    warn.mockRestore();
  });

  it("supports concurrent calls without leaking state", async () => {
    const aiApiService = { chat: vi.fn(async () => ({ content: "raw" })) };
    sharedMocks.extractJsonCandidate.mockReturnValue(JSON.stringify([{ pageType: "overview", title: "Only" }]));

    const [resA, resB] = await Promise.all([
      planSlides([makeChunk("Deck A", "c1")], { __services: { aiApiService } }),
      planSlides([makeChunk("Deck B", "c2")], { __services: { aiApiService } }),
    ]);

    expect(aiApiService.chat).toHaveBeenCalledTimes(2);
    expect(sharedMocks.extractJsonCandidate).toHaveBeenCalledTimes(2);
    expect(resA[0].title).toBe("Deck A");
    expect(resB[0].title).toBe("Deck B");
  });

  it("accepts MAX_SAFE_INTEGER in constraints without heavy allocation", async () => {
    const aiApiService = { chat: vi.fn(async () => ({ content: "raw" })) };
    sharedMocks.extractJsonCandidate.mockReturnValue(JSON.stringify([{ pageType: "overview", title: "Only" }]));

    const result = await planSlides([makeChunk("Title")], {
      pageCount: Number.MAX_SAFE_INTEGER,
      __services: { aiApiService },
    });

    const userMessage = aiApiService.chat.mock.calls[0][0].messages.find((m) => m.role === "user");
    const payload = JSON.parse(userMessage.content);
    expect(payload.constraints.pageCount).toBe(Number.MAX_SAFE_INTEGER);
    expect(result).toHaveLength(4);
    assertCoreSlides(result);
  });
});

describe("generateSlideIntents", () => {
  it("aliases planSlides and honors global aiApiService", async () => {
    globalThis.aiApiService = { chat: vi.fn(async () => ({ content: "raw" })) };
    sharedMocks.extractJsonCandidate.mockReturnValue(JSON.stringify([{ pageType: "overview", title: "Only" }]));

    const result = await generateSlideIntents([makeChunk("Global Title", "g1")], {});

    expect(generateSlideIntents).toBe(planSlides);
    expect(globalThis.aiApiService.chat).toHaveBeenCalledTimes(1);
    expect(result[0].pageType).toBe("cover");
    expect(result[0].title).toBe("Global Title");
  });
});
