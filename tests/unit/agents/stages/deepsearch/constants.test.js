import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

import {
  CHUNK_CONFIG,
  GAP_CONFIG,
  CONCURRENCY_CONFIG,
  GAP_TYPES,
  SMALL_DOC_TOKEN_THRESHOLD,
  SMALL_DOC_THRESHOLD,
  RetrievalStrategy,
  isValidRetrievalStrategy,
  normalizeRetrievalStrategy,
  DeepSearchSourceKind,
  normalizeDeepSearchSourceKind,
  isDocSourceKind,
  isCodeSourceKind,
  MergeStrategy,
} from "../../../../../js/agents/stages/deepsearch/constants.js";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(() => ""),
}));

const mockedReadFileSync = vi.mocked(readFileSync);

beforeEach(() => {
  vi.clearAllMocks();
  mockedReadFileSync.mockReturnValue("");
});

describe("CHUNK_CONFIG", () => {
  it("exposes expected defaults", () => {
    expect(CHUNK_CONFIG).toMatchObject({
      DEFAULT_SIZE: 1600,
      DEFAULT_OVERLAP: 180,
      DEFAULT_TOP_K: 6,
      DEFAULT_WINDOW_SIZE: 3,
      MAX_CHUNKS_LRU: 5000,
    });
  });

  it("is frozen and immutable", () => {
    expect(Object.isFrozen(CHUNK_CONFIG)).toBe(true);
    expect(CHUNK_CONFIG.UNKNOWN).toBeUndefined();
  });
});

describe("GAP_CONFIG", () => {
  it("exposes expected defaults", () => {
    expect(GAP_CONFIG).toMatchObject({
      BLOCK_AFTER_MISSES: 3,
      MIN_EVIDENCE_TO_FILL: 2,
      QUALITY_THRESHOLD: 0.5,
      NO_NEW_HITS_ROUNDS: 2,
    });
  });

  it("is frozen and immutable", () => {
    expect(Object.isFrozen(GAP_CONFIG)).toBe(true);
    expect(GAP_CONFIG.UNKNOWN).toBeUndefined();
  });
});

describe("CONCURRENCY_CONFIG", () => {
  it("exposes expected defaults", () => {
    expect(CONCURRENCY_CONFIG).toMatchObject({
      DEFAULT_PARALLEL: 5,
      MAX_TRAJECTORY_PARALLEL: 3,
      GLOBAL_LLM_POOL_SIZE: 10,
    });
  });

  it("is frozen and immutable", () => {
    expect(Object.isFrozen(CONCURRENCY_CONFIG)).toBe(true);
    expect(CONCURRENCY_CONFIG.UNKNOWN).toBeUndefined();
  });
});

describe("GAP_TYPES", () => {
  it("lists the expected gap types", () => {
    const expected = [
      "definition",
      "data",
      "mechanism",
      "application",
      "comparison",
      "trend",
      "solution",
      "benefit",
      "implementation",
      "cost",
      "background",
      "challenge",
      "question",
    ];

    expect(GAP_TYPES).toEqual(expected);
  });

  it("is frozen and contains unique strings", () => {
    expect(Object.isFrozen(GAP_TYPES)).toBe(true);
    expect(GAP_TYPES.includes("unknown")).toBe(false);
    expect(new Set(GAP_TYPES).size).toBe(GAP_TYPES.length);
    GAP_TYPES.forEach((value) => {
      expect(typeof value).toBe("string");
    });
  });
});

describe("SMALL_DOC_TOKEN_THRESHOLD", () => {
  it("sets a stable numeric threshold", () => {
    expect(SMALL_DOC_TOKEN_THRESHOLD).toBe(60000);
    expect(typeof SMALL_DOC_TOKEN_THRESHOLD).toBe("number");
    expect(SMALL_DOC_TOKEN_THRESHOLD).toBeGreaterThan(0);
    expect(SMALL_DOC_TOKEN_THRESHOLD).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });
});

describe("SMALL_DOC_THRESHOLD", () => {
  it("aliases SMALL_DOC_TOKEN_THRESHOLD", () => {
    expect(SMALL_DOC_THRESHOLD).toBe(SMALL_DOC_TOKEN_THRESHOLD);
  });
});

describe("RetrievalStrategy", () => {
  it("exposes expected keys and values", () => {
    const expectedKeys = ["GREP", "BM25", "TOOL_CHAIN", "EXTERNAL"];
    const expectedValues = ["grep", "bm25", "tool-chain", "external"];

    expect(Object.keys(RetrievalStrategy).sort()).toEqual([...expectedKeys].sort());
    expect(Object.values(RetrievalStrategy).sort()).toEqual([...expectedValues].sort());
  });

  it("is frozen and does not expose unknown strategies", () => {
    expect(Object.isFrozen(RetrievalStrategy)).toBe(true);
    expect(RetrievalStrategy.UNKNOWN).toBeUndefined();
  });
});

describe("isValidRetrievalStrategy", () => {
  it("returns true for supported strategies", () => {
    Object.values(RetrievalStrategy).forEach((value) => {
      expect(isValidRetrievalStrategy(value)).toBe(true);
    });
  });

  it("returns false for invalid and boundary values without throwing", () => {
    const invalidValues = [
      null,
      undefined,
      "",
      "   ",
      [],
      {},
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      "123",
      "unknown",
      "GREP",
      { 0: "grep", length: 1 },
      Symbol("grep"),
    ];

    invalidValues.forEach((value) => {
      let result;
      expect(() => {
        result = isValidRetrievalStrategy(value);
      }).not.toThrow();
      expect(result).toBe(false);
    });
  });

  it("handles concurrent calls without shared state", async () => {
    const inputs = ["grep", "unknown", null, "bm25", "GREP"];
    const results = await Promise.all(
      inputs.map((input) => Promise.resolve().then(() => isValidRetrievalStrategy(input)))
    );

    expect(results).toEqual([true, false, false, true, false]);
  });

  it("handles rapid consecutive calls consistently", () => {
    const inputs = ["grep", "bm25", "unknown", "GREP", null];
    const results = inputs.map((input) => isValidRetrievalStrategy(input));

    expect(results).toEqual([true, true, false, false, false]);
  });
});

describe("normalizeRetrievalStrategy", () => {
  it("normalizes case and whitespace", () => {
    expect(normalizeRetrievalStrategy(" GREP ")).toBe("grep");
    expect(normalizeRetrievalStrategy("BM25")).toBe("bm25");
    expect(normalizeRetrievalStrategy("  tool-chain ")).toBe("tool-chain");
  });

  it("returns undefined for invalid and boundary values without throwing", () => {
    const invalidValues = [
      null,
      undefined,
      "",
      "   ",
      [],
      {},
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      "123",
      "not-a-strategy",
      { 0: "grep", length: 1 },
      Symbol("bm25"),
    ];

    invalidValues.forEach((value) => {
      let result;
      expect(() => {
        result = normalizeRetrievalStrategy(value);
      }).not.toThrow();
      expect(result).toBeUndefined();
    });
  });

  it("handles resource boundary inputs", () => {
    const largeContent = "x".repeat(120000);
    mockedReadFileSync.mockReturnValueOnce(largeContent);
    const fileContent = readFileSync("/fake/large.txt", "utf-8");

    expect(fileContent.length).toBe(120000);
    expect(normalizeRetrievalStrategy(fileContent)).toBeUndefined();
    expect(mockedReadFileSync).toHaveBeenCalledWith("/fake/large.txt", "utf-8");

    const longString = `${" ".repeat(3000)}BM25${" ".repeat(3000)}`;
    expect(normalizeRetrievalStrategy(longString)).toBe("bm25");

    let deep = {};
    for (let i = 0; i < 200; i += 1) {
      deep = { child: deep };
    }

    let deepResult;
    expect(() => {
      deepResult = normalizeRetrievalStrategy(deep);
    }).not.toThrow();
    expect(deepResult).toBeUndefined();
  });

  it("handles concurrent calls without shared state", async () => {
    const inputs = [" grep ", "unknown", null, "BM25", " tool-chain "];
    const results = await Promise.all(
      inputs.map((input) => Promise.resolve().then(() => normalizeRetrievalStrategy(input)))
    );

    expect(results).toEqual(["grep", undefined, undefined, "bm25", "tool-chain"]);
  });

  it("handles rapid consecutive calls consistently", () => {
    const inputs = ["grep", "GREP", "unknown", "", " tool-chain "];
    const results = inputs.map((input) => normalizeRetrievalStrategy(input));

    expect(results).toEqual(["grep", "grep", undefined, undefined, "tool-chain"]);
  });
});

describe("DeepSearchSourceKind", () => {
  it("exposes expected keys and values", () => {
    const expectedKeys = [
      "CODE",
      "FILE",
      "URL",
      "PDF",
      "DOC",
      "DOCX",
      "EPUB",
      "PPTX",
      "VIDEO",
      "AUDIO",
      "HTML",
      "MARKDOWN",
      "USER_TEXT",
      "DIRECT_MERGED",
      "EXTERNAL_URL",
      "UNKNOWN",
    ];
    const expectedValues = [
      "code",
      "file",
      "url",
      "pdf",
      "doc",
      "docx",
      "epub",
      "pptx",
      "video",
      "audio",
      "html",
      "markdown",
      "user_text",
      "direct_merged",
      "external_url",
      "unknown",
    ];

    expect(Object.keys(DeepSearchSourceKind).sort()).toEqual([...expectedKeys].sort());
    expect(Object.values(DeepSearchSourceKind).sort()).toEqual([...expectedValues].sort());
  });

  it("is frozen and includes UNKNOWN", () => {
    expect(Object.isFrozen(DeepSearchSourceKind)).toBe(true);
    expect(DeepSearchSourceKind.UNKNOWN).toBe("unknown");
  });
});

describe("normalizeDeepSearchSourceKind", () => {
  it("normalizes case and whitespace for known kinds", () => {
    expect(normalizeDeepSearchSourceKind(" PDF ")).toBe("pdf");
    expect(normalizeDeepSearchSourceKind("Direct_Merged")).toBe("direct_merged");
    expect(normalizeDeepSearchSourceKind("markdown")).toBe("markdown");
  });

  it("returns UNKNOWN for invalid and boundary values without throwing", () => {
    const invalidValues = [
      null,
      undefined,
      "",
      "   ",
      [],
      {},
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      "123",
      "not-a-kind",
      { 0: "pdf", length: 1 },
      Symbol("pdf"),
    ];

    invalidValues.forEach((value) => {
      let result;
      expect(() => {
        result = normalizeDeepSearchSourceKind(value);
      }).not.toThrow();
      expect(result).toBe(DeepSearchSourceKind.UNKNOWN);
    });
  });

  it("handles resource boundary inputs", () => {
    const largeContent = "x".repeat(150000);
    mockedReadFileSync.mockReturnValueOnce(largeContent);
    const fileContent = readFileSync("/fake/huge.txt", "utf-8");

    expect(fileContent.length).toBe(150000);
    expect(normalizeDeepSearchSourceKind(fileContent)).toBe(DeepSearchSourceKind.UNKNOWN);
    expect(mockedReadFileSync).toHaveBeenCalledWith("/fake/huge.txt", "utf-8");

    const longString = `${" ".repeat(4000)}PDF${" ".repeat(4000)}`;
    expect(normalizeDeepSearchSourceKind(longString)).toBe("pdf");

    let deep = {};
    for (let i = 0; i < 200; i += 1) {
      deep = { child: deep };
    }

    let deepResult;
    expect(() => {
      deepResult = normalizeDeepSearchSourceKind(deep);
    }).not.toThrow();
    expect(deepResult).toBe(DeepSearchSourceKind.UNKNOWN);
  });

  it("handles concurrent calls without shared state", async () => {
    const inputs = [" pdf ", "unknown", null, "DOCX", " markdown "];
    const results = await Promise.all(
      inputs.map((input) => Promise.resolve().then(() => normalizeDeepSearchSourceKind(input)))
    );

    expect(results).toEqual(["pdf", "unknown", "unknown", "docx", "markdown"]);
  });

  it("handles rapid consecutive calls consistently", () => {
    const inputs = ["code", "CODE", "", "  html  ", null];
    const results = inputs.map((input) => normalizeDeepSearchSourceKind(input));

    expect(results).toEqual(["code", "code", "unknown", "html", "unknown"]);
  });
});

describe("isDocSourceKind", () => {
  it("returns true for document source kinds", () => {
    const valid = [
      DeepSearchSourceKind.URL,
      DeepSearchSourceKind.PDF,
      DeepSearchSourceKind.DOCX,
      DeepSearchSourceKind.HTML,
      DeepSearchSourceKind.MARKDOWN,
      DeepSearchSourceKind.USER_TEXT,
      DeepSearchSourceKind.DIRECT_MERGED,
      DeepSearchSourceKind.EXTERNAL_URL,
      DeepSearchSourceKind.AUDIO,
      DeepSearchSourceKind.VIDEO,
    ];

    valid.forEach((value) => {
      expect(isDocSourceKind(value)).toBe(true);
    });
  });

  it("returns false for code kinds and invalid values", () => {
    const invalidValues = [
      DeepSearchSourceKind.CODE,
      DeepSearchSourceKind.FILE,
      DeepSearchSourceKind.UNKNOWN,
      null,
      undefined,
      "",
      "   ",
      [],
      {},
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      "123",
      { 0: "pdf", length: 1 },
    ];

    invalidValues.forEach((value) => {
      let result;
      expect(() => {
        result = isDocSourceKind(value);
      }).not.toThrow();
      expect(result).toBe(false);
    });
  });

  it("handles concurrent calls without shared state", async () => {
    const inputs = ["pdf", "code", null, "video", "unknown"];
    const results = await Promise.all(
      inputs.map((input) => Promise.resolve().then(() => isDocSourceKind(input)))
    );

    expect(results).toEqual([true, false, false, true, false]);
  });
});

describe("isCodeSourceKind", () => {
  it("returns true for code source kinds", () => {
    expect(isCodeSourceKind(DeepSearchSourceKind.CODE)).toBe(true);
    expect(isCodeSourceKind(DeepSearchSourceKind.FILE)).toBe(true);
  });

  it("returns false for document kinds and invalid values", () => {
    const invalidValues = [
      DeepSearchSourceKind.URL,
      DeepSearchSourceKind.PDF,
      DeepSearchSourceKind.HTML,
      DeepSearchSourceKind.UNKNOWN,
      null,
      undefined,
      "",
      "   ",
      [],
      {},
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      "123",
      { 0: "code", length: 1 },
    ];

    invalidValues.forEach((value) => {
      let result;
      expect(() => {
        result = isCodeSourceKind(value);
      }).not.toThrow();
      expect(result).toBe(false);
    });
  });

  it("handles concurrent calls without shared state", async () => {
    const inputs = ["file", "pdf", null, "code", "unknown"];
    const results = await Promise.all(
      inputs.map((input) => Promise.resolve().then(() => isCodeSourceKind(input)))
    );

    expect(results).toEqual([true, false, false, true, false]);
  });
});

describe("MergeStrategy", () => {
  it("exposes expected keys and values", () => {
    const expectedKeys = ["CONCAT", "DEDUPE", "PRIORITY"];
    const expectedValues = ["concat", "dedupe", "priority"];

    expect(Object.keys(MergeStrategy).sort()).toEqual([...expectedKeys].sort());
    expect(Object.values(MergeStrategy).sort()).toEqual([...expectedValues].sort());
  });

  it("is frozen and does not expose unknown strategies", () => {
    expect(Object.isFrozen(MergeStrategy)).toBe(true);
    expect(MergeStrategy.UNKNOWN).toBeUndefined();
  });
});
