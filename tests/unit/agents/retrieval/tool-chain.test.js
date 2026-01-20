import { describe, it, expect, vi, beforeEach } from "vitest";

const grepMocks = vi.hoisted(() => ({
  grepChunks: vi.fn(),
  grepChunksAsync: vi.fn(),
}));

vi.mock("../../../../js/agents/retrieval/grep.js", () => ({
  grepChunks: (...args) => grepMocks.grepChunks(...args),
  grepChunksAsync: (...args) => grepMocks.grepChunksAsync(...args),
}));

import {
  ToolChainStrategy,
  normalizeToolChainStrategy,
  search,
  clearGlobCache,
  getGlobCacheStats,
  __test,
} from "../../../../js/agents/retrieval/tool-chain.js";

const buildMatches = (chunks, keyword, options = {}) => {
  if (!Array.isArray(chunks) || chunks.length === 0) return [];
  const regex = Boolean(options.regex);
  const caseSensitive = Boolean(options.caseSensitive);
  const raw = keyword instanceof RegExp ? keyword.source : String(keyword ?? "");
  if (!raw) return [];

  const matches = [];
  for (const chunk of chunks) {
    const textRaw = String(chunk?.text ?? "");
    const spans = [];

    if (regex || keyword instanceof RegExp) {
      const flags = caseSensitive ? "g" : "gi";
      const re = keyword instanceof RegExp ? new RegExp(keyword.source, flags) : new RegExp(raw, flags);
      let m;
      while ((m = re.exec(textRaw))) {
        const matchText = m[0] ?? "";
        spans.push({ start: m.index, end: m.index + matchText.length });
        if (matchText === "") re.lastIndex += 1;
      }
    } else {
      const haystack = caseSensitive ? textRaw : textRaw.toLowerCase();
      const needle = caseSensitive ? raw : raw.toLowerCase();
      let idx = 0;
      while (true) {
        const at = haystack.indexOf(needle, idx);
        if (at === -1) break;
        spans.push({ start: at, end: at + needle.length });
        idx = at + Math.max(needle.length, 1);
      }
    }

    if (spans.length) {
      matches.push({ chunkId: chunk.chunkId, matchCount: spans.length, spans });
    }
  }
  return matches;
};

beforeEach(() => {
  clearGlobCache();
  grepMocks.grepChunks.mockReset();
  grepMocks.grepChunksAsync.mockReset();
  grepMocks.grepChunks.mockImplementation(buildMatches);
  grepMocks.grepChunksAsync.mockImplementation(async (...args) => buildMatches(...args));
});

describe("ToolChainStrategy", () => {
  it("exposes frozen strategy values", () => {
    expect(Object.isFrozen(ToolChainStrategy)).toBe(true);
    expect(ToolChainStrategy).toEqual({
      AUTO: "auto",
      GLOB_THEN_GREP: "glob-then-grep",
      GREP_ONLY: "grep-only",
    });
  });
});

describe("normalizeToolChainStrategy", () => {
  it("normalizes known strategies case-insensitively", () => {
    expect(normalizeToolChainStrategy("AUTO")).toBe(ToolChainStrategy.AUTO);
    expect(normalizeToolChainStrategy("  glob-then-grep ")).toBe(ToolChainStrategy.GLOB_THEN_GREP);
    expect(normalizeToolChainStrategy("Grep-Only")).toBe(ToolChainStrategy.GREP_ONLY);
  });

  it("returns null for nullish, whitespace, and invalid values", () => {
    const cases = [
      null,
      undefined,
      "",
      "   ",
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      [],
      {},
      true,
      "unknown",
    ];
    for (const value of cases) {
      expect(normalizeToolChainStrategy(value)).toBe(null);
    }
  });
});

describe("search", () => {
  it("returns INVALID_CHUNKS for invalid chunk inputs", async () => {
    const badChunks = [
      null,
      undefined,
      "",
      "   ",
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      {},
      [],
    ];

    for (const chunks of badChunks) {
      const result = await search(chunks, { strategy: "grep-only", keywords: ["alpha"] }, {});
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("INVALID_CHUNKS");
    }
  });

  it("returns INVALID_QUERY for non-object or wrong-typed query fields", async () => {
    const chunks = [{ chunkId: "c1", text: "alpha", sourceId: "a.txt" }];
    const cases = [
      "nope",
      [],
      { keywords: "alpha" },
      { patterns: {} },
      { keywords: {}, patterns: [] },
    ];

    for (const query of cases) {
      const result = await search(chunks, query, {});
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("INVALID_QUERY");
    }
  });

  it("returns NO_KEYWORDS for empty keyword list or empty query object", async () => {
    const chunks = [{ chunkId: "c1", text: "alpha", sourceId: "a.txt" }];
    const cases = [{}, { keywords: [] }];

    for (const query of cases) {
      const result = await search(chunks, query, {});
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("NO_KEYWORDS");
      expect(result.results).toEqual([]);
    }
  });

  it("defaults to grep-only for auto strategy without patterns", async () => {
    const chunks = [{ chunkId: "c1", text: "alpha", sourceId: "a.txt" }];
    const result = await search(chunks, { strategy: "auto", keywords: ["alpha"] }, {});

    expect(result.ok).toBe(true);
    expect(result.strategy).toBe(ToolChainStrategy.GREP_ONLY);
    expect(grepMocks.grepChunks).toHaveBeenCalled();
    expect(grepMocks.grepChunksAsync).not.toHaveBeenCalled();
  });

  it("uses glob-then-grep with normalized file filtering and deep paths", async () => {
    const deepPath = "deep/level1/level2/level3/level4/target.txt";
    const chunks = [
      { chunkId: "c1", text: "alpha", sourceId: "file:///workspace/src/App.js" },
      { chunkId: "c2", text: "alpha", sourceId: "src/App.js.bak" },
      { chunkId: "c3", text: "alpha", sourceId: `workspace/${deepPath}` },
      { chunkId: "c4", text: "alpha", sourceId: "other/skip.txt" },
    ];

    const globTool = vi.fn(async ({ pattern }) => {
      if (pattern === "**/*.js") return ["./src/../src/App.js"];
      if (pattern === "**/*.txt") return [deepPath];
      return [];
    });

    const result = await search(
      chunks,
      { strategy: "glob-then-grep", patterns: ["**/*.js", "**/*.txt"], keywords: ["alpha"] },
      { globTool }
    );

    expect(result.ok).toBe(true);
    expect(result.strategy).toBe(ToolChainStrategy.GLOB_THEN_GREP);
    expect(result.stats.globCalls).toBe(2);
    expect(globTool).toHaveBeenCalledTimes(2);

    const chunkIds = result.results.map((r) => r.chunkId).sort();
    expect(chunkIds).toEqual(["c1", "c3"]);
  });

  it("falls back to grep-only when glob tool is missing or returns invalid data", async () => {
    const chunks = [{ chunkId: "c1", text: "alpha", sourceId: "a.txt" }];
    const query = { strategy: "glob-then-grep", patterns: ["**/*.txt"], keywords: ["alpha"] };
    const cases = [
      { tools: {}, reason: "glob_failed:no_glob_tool" },
      { tools: { globTool: vi.fn(async () => "oops") }, reason: "glob_failed:invalid_glob_result" },
    ];

    for (const { tools, reason } of cases) {
      clearGlobCache();
      const result = await search(chunks, query, tools);
      expect(result.ok).toBe(true);
      expect(result.strategy).toBe(ToolChainStrategy.GREP_ONLY);
      expect(result.originalStrategy).toBe(ToolChainStrategy.GLOB_THEN_GREP);
      expect(result.fallbackReason).toBe(reason);
    }
  });

  it("falls back when glob returns no matches", async () => {
    const chunks = [{ chunkId: "c1", text: "alpha", sourceId: "a.txt" }];
    const globTool = vi.fn(async () => []);

    const result = await search(
      chunks,
      { strategy: "glob-then-grep", patterns: ["**/*.txt"], keywords: ["alpha"] },
      { globTool }
    );

    expect(result.ok).toBe(true);
    expect(result.strategy).toBe(ToolChainStrategy.GREP_ONLY);
    expect(result.fallbackReason).toBe("glob_no_matches");
  });

  it("falls back when glob returns only unsafe paths", async () => {
    const chunks = [{ chunkId: "c1", text: "alpha", sourceId: "a.txt" }];
    const globTool = vi.fn(async () => ["../secret.txt", "file://host/hidden.txt"]);

    const result = await search(
      chunks,
      { strategy: "glob-then-grep", patterns: ["**/*.txt"], keywords: ["alpha"] },
      { globTool }
    );

    expect(result.ok).toBe(true);
    expect(result.strategy).toBe(ToolChainStrategy.GREP_ONLY);
    expect(result.fallbackReason).toBe("glob_invalid_paths:2");
  });

  it("falls back when file filter removes all chunks", async () => {
    const chunks = [{ chunkId: "c1", text: "alpha", sourceId: "src/other.js" }];
    const globTool = vi.fn(async () => ["src/only.js"]);

    const result = await search(
      chunks,
      { strategy: "glob-then-grep", patterns: ["**/*.js"], keywords: ["alpha"] },
      { globTool }
    );

    expect(result.ok).toBe(true);
    expect(result.strategy).toBe(ToolChainStrategy.GREP_ONLY);
    expect(result.fallbackReason).toBe("no_chunks_after_glob");
  });

  it("falls back when glob times out", async () => {
    vi.useFakeTimers();
    try {
      const chunks = [{ chunkId: "c1", text: "alpha", sourceId: "a.txt" }];
      const globTool = vi.fn(() => new Promise(() => {}));
      const pending = search(
        chunks,
        { strategy: "glob-then-grep", patterns: ["**/*.txt"], keywords: ["alpha"] },
        { globTool, timeoutMs: 5 }
      );

      await vi.advanceTimersByTimeAsync(10);
      const result = await pending;

      expect(result.ok).toBe(true);
      expect(result.strategy).toBe(ToolChainStrategy.GREP_ONLY);
      expect(result.fallbackReason).toBe("glob_failed:timeout");
    } finally {
      vi.useRealTimers();
    }
  });

  it("propagates grep errors into fallbackReason", async () => {
    const chunks = [{ chunkId: "c1", text: "alpha", sourceId: "a.txt" }];
    grepMocks.grepChunksAsync.mockRejectedValueOnce(new Error("boom"));

    const result = await search(
      chunks,
      { strategy: "grep-only", keywords: ["alpha"] },
      { async: true }
    );

    expect(result.ok).toBe(true);
    expect(result.strategy).toBe(ToolChainStrategy.GREP_ONLY);
    expect(result.fallbackReason).toBe("grep_failed:boom");
    expect(result.results).toEqual([]);
  });

  it("uses async grep when thresholds are zero or negative", async () => {
    const chunks = [{ chunkId: "c1", text: "alpha", sourceId: "a.txt" }];

    await search(chunks, { strategy: "grep-only", keywords: ["alpha"] }, { grepAsyncThreshold: 0 });
    expect(grepMocks.grepChunksAsync).toHaveBeenCalled();
    expect(grepMocks.grepChunks).not.toHaveBeenCalled();

    grepMocks.grepChunksAsync.mockClear();
    grepMocks.grepChunks.mockClear();

    await search(chunks, { strategy: "grep-only", keywords: ["alpha"] }, { grepAsyncThreshold: -1 });
    expect(grepMocks.grepChunksAsync).toHaveBeenCalled();
    expect(grepMocks.grepChunks).not.toHaveBeenCalled();
  });

  it("uses sync grep when threshold is huge or non-numeric", async () => {
    const chunks = [{ chunkId: "c1", text: "alpha", sourceId: "a.txt" }];

    await search(
      chunks,
      { strategy: "grep-only", keywords: ["alpha"] },
      { grepAsyncThreshold: Number.MAX_SAFE_INTEGER }
    );
    expect(grepMocks.grepChunks).toHaveBeenCalled();
    expect(grepMocks.grepChunksAsync).not.toHaveBeenCalled();

    grepMocks.grepChunksAsync.mockClear();
    grepMocks.grepChunks.mockClear();

    await search(chunks, { strategy: "grep-only", keywords: ["alpha"] }, { grepAsyncThreshold: "10" });
    expect(grepMocks.grepChunks).toHaveBeenCalled();
    expect(grepMocks.grepChunksAsync).not.toHaveBeenCalled();
  });

  it("handles concurrent searches without leaking state", async () => {
    const chunks = [
      { chunkId: "c1", text: "alpha", sourceId: "src/a.js" },
      { chunkId: "c2", text: "beta", sourceId: "src/b.js" },
    ];
    const globTool = vi.fn(async () => ["src/a.js", "src/b.js"]);

    const [alphaResult, betaResult] = await Promise.all([
      search(
        chunks,
        { strategy: "glob-then-grep", patterns: ["**/*.js"], keywords: ["alpha"] },
        { globTool, async: true }
      ),
      search(chunks, { strategy: "grep-only", keywords: ["beta"] }, { async: true }),
    ]);

    expect(alphaResult.ok).toBe(true);
    expect(alphaResult.strategy).toBe(ToolChainStrategy.GLOB_THEN_GREP);
    expect(alphaResult.results.every((r) => r.keyword === "alpha")).toBe(true);

    expect(betaResult.ok).toBe(true);
    expect(betaResult.strategy).toBe(ToolChainStrategy.GREP_ONLY);
    expect(betaResult.results.every((r) => r.keyword === "beta")).toBe(true);
  });

  it("reuses cached glob results on rapid consecutive calls", async () => {
    const chunks = [{ chunkId: "c1", text: "alpha", sourceId: "src/app.js" }];
    const globTool = vi.fn(async () => ["src/app.js"]);

    const first = await search(
      chunks,
      { strategy: "glob-then-grep", patterns: ["**/*.js"], keywords: ["alpha"] },
      { globTool }
    );
    const second = await search(
      chunks,
      { strategy: "glob-then-grep", patterns: ["**/*.js"], keywords: ["alpha"] },
      { globTool }
    );

    expect(first.stats.cached).toBe(0);
    expect(second.stats.cached).toBe(1);
    expect(globTool).toHaveBeenCalledTimes(1);
  });

  it("handles large text and long keywords", async () => {
    const longKeyword = "x".repeat(5000);
    const padding = "y".repeat(120000);
    const chunks = [
      {
        chunkId: "c1",
        text: `${padding}${longKeyword}${padding}`,
        sourceId: "deep/path/level1/level2/level3/level4/level5/file.txt",
      },
    ];

    const result = await search(chunks, { strategy: "grep-only", keywords: [longKeyword] }, {});

    expect(result.ok).toBe(true);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].matchCount).toBe(1);
  });
});

describe("clearGlobCache", () => {
  it("clears cached glob entries", () => {
    __test.setCachedGlob("**/*.md", "base", ["a.md"]);
    expect(getGlobCacheStats().size).toBe(1);

    clearGlobCache();

    expect(getGlobCacheStats().size).toBe(0);
  });
});

describe("getGlobCacheStats", () => {
  it("returns size/keys and prunes expired entries", () => {
    vi.useFakeTimers();
    try {
      const start = new Date("2024-01-01T00:00:00.000Z");
      vi.setSystemTime(start);
      __test.setCachedGlob("**/*.txt", "base", ["a.txt"]);

      let stats = getGlobCacheStats();
      expect(stats.size).toBe(1);
      expect(stats.keys).toEqual(["**/*.txt::base"]);

      vi.setSystemTime(new Date(start.getTime() + 61000));
      stats = getGlobCacheStats();
      expect(stats.size).toBe(0);
      expect(stats.keys).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
