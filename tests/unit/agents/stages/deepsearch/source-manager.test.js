import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../js/agents/shared/index.js", async () => {
  const actual = await vi.importActual("../../../../../js/agents/shared/index.js");

  class LRUCache {
    constructor({ maxSize } = {}) {
      this.maxSize = maxSize;
      this.store = new Map();
    }
    get(key) {
      return this.store.get(key);
    }
    set(key, value) {
      this.store.set(key, value);
      return value;
    }
    clear() {
      this.store.clear();
    }
  }

  return {
    ...actual,
    toNonEmptyString: vi.fn(actual.toNonEmptyString),
    toNonNegativeInt: vi.fn(actual.toNonNegativeInt),
    toPositiveInt: vi.fn(actual.toPositiveInt),
    LRUCache,
  };
});

import SourceManager, { SourceManager as NamedSourceManager } from "../../../../../js/agents/stages/deepsearch/source-manager.js";
import { toPositiveInt } from "../../../../../js/agents/shared/index.js";

const docText = [
  "# Intro",
  "alpha line",
  "beta keyword",
  "## Details",
  "gamma keyword extra",
  "tail",
].join("\n");

const hugeText = "x".repeat(6000);

const makeBasicSource = (overrides = {}) => ({
  sourceId: "doc-1",
  name: "Doc One",
  sourceText: "line1\nline2 keyword\nline3",
  ...overrides,
});

const makeDocSource = (overrides = {}) => ({
  sourceId: "doc1",
  name: "Doc One",
  sourceText: docText,
  ...overrides,
});

const makeSearchSources = () => [
  {
    sourceId: "s1",
    name: "Alpha",
    sourceText: ["alpha", "beta keyword", "omega"].join("\n"),
  },
  {
    sourceId: "s2",
    name: "Beta",
    sourceText: ["first", "keyword again", "third"].join("\n"),
  },
];

describe("SourceManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("initializes defaults and handles non-array sources", () => {
    const manager = new SourceManager({ not: "array" }, { maxCachedLineIndexes: "3" });

    expect(manager.preferNormalized).toBe(true);
    expect(manager.maxCachedLineIndexes).toBe(3);
    expect(toPositiveInt).toHaveBeenCalledWith("3", 20);
    expect(manager.listSources()).toEqual([]);
  });

  it("respects preferNormalized false and clamps invalid cache size", () => {
    const manager = new SourceManager([], { preferNormalized: false, maxCachedLineIndexes: -1 });

    expect(manager.preferNormalized).toBe(false);
    expect(manager.maxCachedLineIndexes).toBe(20);
    expect(toPositiveInt).toHaveBeenCalledWith(-1, 20);
  });

  it("setSources de-duplicates ids and clears cache", () => {
    const first = makeBasicSource({ sourceId: "dup", sourceText: "a\nb" });
    const second = makeBasicSource({ sourceId: "dup", sourceText: "c\nd" });
    const manager = new SourceManager([first, second]);

    const starts = manager.getLineStarts("dup");
    expect(starts).toEqual([0, 2]);
    expect(manager._lineStartsCache.store.size).toBe(1);

    manager.setSources([first]);

    expect(manager._lineStartsCache.store.size).toBe(0);
    expect(manager.listSources()).toHaveLength(1);
    expect(manager.getSource("dup")).toBe(first);
  });

  it("syncSources detects same reference and length changes", () => {
    const source = makeBasicSource({ sourceId: "sync1" });
    const sources = [source];
    const manager = new SourceManager(sources);

    expect(manager.syncSources(sources)).toBe(false);

    sources[0] = makeBasicSource({ sourceId: "sync1", sourceText: "updated text" });
    expect(manager.syncSources(sources)).toBe(true);
    expect(manager.getSource("sync1").sourceText).toBe("updated text");

    sources.push(makeBasicSource({ sourceId: "sync2" }));
    expect(manager.syncSources(sources)).toBe(true);

    const next = [makeBasicSource({ sourceId: "sync3" })];
    expect(manager.syncSources(next)).toBe(true);
  });

  it("listSources resolves name from metadata and respects preferNormalized", () => {
    const deepSource = makeBasicSource({
      sourceId: "deep",
      name: "  ",
      sourceText: "raw",
      sourceTextNormalized: "norm",
      metadata: { origin: { filename: "deep.txt", nested: { a: { b: { c: { d: "x" } } } } } },
    });

    const manager = new SourceManager([deepSource], { preferNormalized: true });
    expect(manager.listSources()).toEqual([
      { sourceId: "deep", name: "deep.txt", size: "norm".length },
    ]);

    const managerRaw = new SourceManager([deepSource], { preferNormalized: false });
    expect(managerRaw.listSources()[0].size).toBe("raw".length);
  });

  it("getSource finds by id or name and handles blanks", () => {
    const sourceById = makeBasicSource({ sourceId: "id1", name: "My Doc" });
    const sourceByDocId = makeBasicSource({ sourceId: undefined, docId: "doc2", name: "Other" });
    const manager = new SourceManager([sourceById, sourceByDocId]);

    expect(manager.getSource("id1")).toBe(sourceById);
    expect(manager.getSource("my doc")).toBe(sourceById);
    expect(manager.getSource("doc2")).toBe(sourceByDocId);
    expect(manager.getSource("")).toBe(null);
    expect(manager.getSource("   ")).toBe(null);
    expect(manager.getSource(null)).toBe(null);
    expect(manager.getSource(undefined)).toBe(null);
  });

  it("getSourceInfo returns null when missing and resolves text", () => {
    const source = makeBasicSource({ sourceId: "info1", sourceText: "raw", sourceTextNormalized: "norm" });
    const manager = new SourceManager([source], { preferNormalized: false });

    const info = manager.getSourceInfo("info1");
    expect(info).toMatchObject({
      sourceId: "info1",
      name: "Doc One",
      text: "raw",
      totalLength: "raw".length,
    });
    expect(manager.getSourceInfo("missing")).toBe(null);
  });

  it("getSourceText returns empty string when missing", () => {
    const manager = new SourceManager([]);
    expect(manager.getSourceText("missing")).toBe("");
  });

  it("getLineStarts caches results and refreshes when text changes", () => {
    const source = makeBasicSource({ sourceId: "lines", sourceText: "a\nb\nc" });
    const manager = new SourceManager([source], { preferNormalized: false });

    const starts1 = manager.getLineStarts("lines");
    const starts2 = manager.getLineStarts("lines");

    expect(starts1).toEqual([0, 2, 4]);
    expect(starts1).toBe(starts2);

    source.sourceText = "a\nb\nc\nd";
    const starts3 = manager.getLineStarts("lines");

    expect(starts3).toEqual([0, 2, 4, 6]);
    expect(starts3).not.toBe(starts1);
  });

  it("getLineStarts handles empty text", () => {
    const source = makeBasicSource({ sourceId: "empty", sourceText: "" });
    const manager = new SourceManager([source], { preferNormalized: false });

    expect(manager.getLineStarts("empty")).toEqual([0]);
  });

  it("read returns error when source missing", () => {
    const manager = new SourceManager([makeDocSource()], { preferNormalized: false });

    const result = manager.read("missing");

    expect(result.success).toBe(false);
    expect(result.error).toContain("Document not found");
    expect(result.available).toEqual(["doc1"]);
  });

  it("read preview mode returns headings and truncation", () => {
    const manager = new SourceManager([makeDocSource()], { preferNormalized: false });

    const result = manager.read("doc1", { preview: 12, maxLength: 50 });

    expect(result.success).toBe(true);
    expect(result.readMode).toBe("preview");
    expect(result.previewLength).toBe(12);
    expect(result.headingCount).toBe(2);
    expect(result.headings.map((h) => h.text)).toEqual(["Intro", "Details"]);
    expect(result.truncated).toBe(true);
    expect(result.content.endsWith("... (truncated)")).toBe(true);
  });

  it("read section mode supports fuzzy match and missing section errors", () => {
    const manager = new SourceManager([makeDocSource()], { preferNormalized: false });

    const fuzzy = manager.read("doc1", { section: "## intro", maxLength: 200 });

    expect(fuzzy.success).toBe(true);
    expect(fuzzy.readMode).toBe("section");
    expect(fuzzy.isFuzzy).toBe(false);
    expect(fuzzy.foundHeader).toContain("Intro");
    expect(fuzzy.lineStart).toBe(1);
    expect(fuzzy.lineEnd).toBe(3);
    expect(fuzzy.content).toContain("beta keyword");
    expect(fuzzy.content).not.toContain("## Details");

    const missing = manager.read("doc1", { section: "Missing Section" });

    expect(missing.success).toBe(false);
    expect(missing.error).toContain("Section not found");
    expect(missing.hint).toContain("Intro");
  });

  it("read section mode prefers exact heading matches over substring candidates", () => {
    const text = [
      "# 方法补充",
      "extra",
      "## 方法",
      "exact",
      "## 结论",
      "done",
    ].join("\n");
    const manager = new SourceManager([
      makeBasicSource({ sourceId: "sec", sourceText: text }),
    ], { preferNormalized: false });

    const result = manager.read("sec", { section: "方法", maxLength: 200 });
    expect(result.success).toBe(true);
    expect(result.foundHeader.trim()).toBe("## 方法");
    expect(result.content).toContain("exact");
    expect(result.content).not.toContain("extra");
  });

  it("read lines mode clamps line numbers and handles boundaries", () => {
    const manager = new SourceManager([makeDocSource()], { preferNormalized: false });

    const result = manager.read("doc1", { startLine: 0, endLine: "2", maxLength: 200 });

    expect(result.readMode).toBe("lines");
    expect(result.lineStart).toBe(1);
    expect(result.lineEnd).toBe(2);
    expect(result.totalLines).toBe(6);
    expect(result.content).toContain("# Intro");
    expect(result.content).toContain("alpha line");
    expect(result.content).not.toContain("beta keyword");

    const swapped = manager.read("doc1", { startLine: 5, endLine: 2 });

    expect(swapped.lineStart).toBe(5);
    expect(swapped.lineEnd).toBe(5);
  });

  it("read chars mode handles string numbers and clamps negatives and large values", () => {
    const manager = new SourceManager([makeDocSource()], { preferNormalized: false });

    const fromStrings = manager.read("doc1", { start: "2", end: "8" });

    expect(fromStrings.readMode).toBe("chars");
    expect(fromStrings.start).toBe(2);
    expect(fromStrings.end).toBe(8);
    expect(fromStrings.lineStart).toBe(1);
    expect(fromStrings.lineEnd).toBe(2);

    const fromBounds = manager.read("doc1", { start: -1, end: Number.MAX_SAFE_INTEGER });

    expect(fromBounds.start).toBe(0);
    expect(fromBounds.end).toBe(docText.length);
    expect(fromBounds.lineStart).toBe(1);
    expect(fromBounds.lineEnd).toBe(6);
    expect(fromBounds.contentLength).toBe(docText.length);
  });

  it("read full mode truncates large content", () => {
    const manager = new SourceManager(
      [makeBasicSource({ sourceId: "huge", sourceText: hugeText })],
      { preferNormalized: false },
    );

    const result = manager.read("huge");

    expect(result.readMode).toBe("full");
    expect(result.truncated).toBe(true);
    expect(result.contentLength).toBe(hugeText.length);
    expect(result.content.endsWith("... (truncated)")).toBe(true);
    expect(result.totalLines).toBe(1);
  });

  it("search returns empty for blank query and handles type boundaries", () => {
    const manager = new SourceManager(makeSearchSources(), { preferNormalized: false });

    expect(manager.search("")).toEqual([]);
    expect(manager.search("   ")).toEqual([]);
    expect(manager.search(null)).toEqual([]);
    expect(manager.search(undefined)).toEqual([]);
    expect(manager.search("k")).toEqual([]);

    const resultsFromObject = manager.search("keyword", { sources: {} });
    const resultsFromEmpty = manager.search("keyword", { sources: [] });

    expect(resultsFromObject.length).toBeGreaterThan(0);
    expect(resultsFromEmpty.length).toBeGreaterThan(0);
  });

  it("search respects limit and sources filter", () => {
    const manager = new SourceManager(makeSearchSources(), { preferNormalized: false });

    const limited = manager.search("keyword", { limit: "1" });
    expect(limited).toHaveLength(1);
    expect(toPositiveInt).toHaveBeenCalledWith("1", 10);

    const onlySecond = manager.search("keyword", { sources: [{ sourceId: "s2" }] });
    expect(onlySecond).toHaveLength(1);
    expect(onlySecond.every((row) => row.sourceId === "s2")).toBe(true);

    const onlyFirst = manager.search("keyword", { sources: ["s1"] });
    expect(onlyFirst).toHaveLength(1);
    expect(onlyFirst.every((row) => row.sourceId === "s1")).toBe(true);
  });

  it("search interleaves results across sources when limit is tight", () => {
    const manager = new SourceManager([
      {
        sourceId: "a",
        name: "A",
        sourceText: ["keyword a1", "keyword a2", "keyword a3"].join("\n"),
      },
      {
        sourceId: "b",
        name: "B",
        sourceText: ["keyword b1", "keyword b2", "keyword b3"].join("\n"),
      },
    ], { preferNormalized: false });

    const hits = manager.search("keyword", { limit: 4 });
    expect(hits).toHaveLength(4);
    expect(hits[0].sourceId).toBe("a");
    expect(hits[1].sourceId).toBe("b");
    expect(new Set(hits.map((row) => row.sourceId))).toEqual(new Set(["a", "b"]));
  });

  it("search handles concurrent calls", async () => {
    const manager = new SourceManager(makeSearchSources(), { preferNormalized: false });

    const [first, second] = await Promise.all([
      Promise.resolve().then(() => manager.search("keyword")),
      Promise.resolve().then(() => manager.search("keyword")),
    ]);

    expect(first).toEqual(second);
  });

  it("semanticSearch returns empty for blank query", async () => {
    const manager = new SourceManager(makeSearchSources(), { preferNormalized: false });

    await expect(manager.semanticSearch("   ")).resolves.toEqual([]);
  });

  it("semanticSearch falls back to keyword search without embedding service", async () => {
    const manager = new SourceManager(makeSearchSources(), { preferNormalized: false });
    const expected = manager.search("keyword", { limit: 2 });

    const result = await manager.semanticSearch("keyword", { embeddingService: {}, limit: 2 });

    expect(result).toEqual(expected);
  });

  it("semanticSearch reranks with embeddings and falls back on failures", async () => {
    const manager = new SourceManager(makeSearchSources(), { preferNormalized: false });

    const embeddingService = {
      embed: vi.fn(async () => [
        [1, 0],
        [0, 1],
        [1, 0],
      ]),
    };

    const reranked = await manager.semanticSearch("keyword", { embeddingService, limit: 2 });

    expect(embeddingService.embed).toHaveBeenCalledTimes(1);
    expect(reranked).toHaveLength(2);
    expect(reranked[0].sourceId).toBe("s2");
    expect(reranked[0].score).toBeGreaterThanOrEqual(reranked[1].score);

    const expected = manager.search("keyword", { limit: 2 });

    const throwingService = {
      embed: vi.fn(async () => {
        throw new Error("fail");
      }),
    };
    const fallback = await manager.semanticSearch("keyword", { embeddingService: throwingService, limit: 2 });
    expect(fallback).toEqual(expected);

    const badService = { embed: vi.fn(async () => [[1, 0]]) };
    const fallbackBad = await manager.semanticSearch("keyword", { embeddingService: badService, limit: 2 });
    expect(fallbackBad).toEqual(expected);
  });

  it("semanticSearch handles concurrent calls", async () => {
    const manager = new SourceManager(makeSearchSources(), { preferNormalized: false });
    const embeddingService = {
      embed: vi.fn(async (texts) => texts.map(() => [1, 0])),
    };

    const [first, second] = await Promise.all([
      manager.semanticSearch("keyword", { embeddingService, limit: 2 }),
      manager.semanticSearch("keyword", { embeddingService, limit: 2 }),
    ]);

    expect(first).toEqual(second);
  });
});

describe("default export", () => {
  it("exports the SourceManager class", () => {
    expect(SourceManager).toBe(NamedSourceManager);
  });
});
