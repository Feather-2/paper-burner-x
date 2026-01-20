import { describe, it, expect, vi, beforeEach } from "vitest";

const normalizeMocks = vi.hoisted(() => ({
  normalizeText: vi.fn(),
}));

const chunkMocks = vi.hoisted(() => ({
  chunkText: vi.fn(),
  smartChunk: vi.fn(),
  ChunkStrategy: {
    FIXED: "fixed",
    SMART: "smart",
  },
}));

const tocMocks = vi.hoisted(() => ({
  buildToc: vi.fn(),
}));

const sharedMocks = vi.hoisted(() => ({
  isPlainObject: vi.fn(),
  toNonEmptyString: vi.fn(),
}));

vi.mock("../../../../../js/agents/stages/textprep/normalize.js", () => normalizeMocks);
vi.mock("../../../../../js/agents/stages/textprep/chunk.js", () => chunkMocks);
vi.mock("../../../../../js/agents/retrieval/toc-builder.js", () => tocMocks);
vi.mock("../../../../../js/agents/shared/index.js", async () => {
  const actual = await vi.importActual("../../../../../js/agents/shared/index.js");
  sharedMocks.isPlainObject.mockImplementation(actual.isPlainObject);
  sharedMocks.toNonEmptyString.mockImplementation(actual.toNonEmptyString);
  return {
    ...actual,
    isPlainObject: sharedMocks.isPlainObject,
    toNonEmptyString: sharedMocks.toNonEmptyString,
  };
});

import { BaseAdapter, isPlainObject, toNonEmptyString } from "../../../../../js/agents/ingest/adapters/base.js";

const boundary = {
  nullValue: null,
  undefinedValue: undefined,
  emptyString: "",
  whitespaceString: "   ",
  emptyArray: [],
  emptyObject: {},
  zero: 0,
  negativeOne: -1,
  maxSafe: Number.MAX_SAFE_INTEGER,
  stringNumber: "123",
  objectAsArray: { 0: "a", length: 1 },
  longString: "x".repeat(10000),
  deepObject: { level1: { level2: { level3: { value: "deep" } } } },
};

const makeChunks = (text, size = 3) => {
  const chunks = [];
  const chunkSize = Number.isFinite(size) ? Math.max(1, Math.floor(size)) : 3;
  let start = 0;
  let index = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push({
      chunkId: `mock_${++index}`,
      text: text.slice(start, end),
      locator: { charStart: start, charEnd: end },
    });
    start = end;
  }
  return chunks;
};

const collect = async (iterable) => {
  const out = [];
  for await (const item of iterable) out.push(item);
  return out;
};

const makeWebStream = (parts) => {
  let index = 0;
  const reader = {
    read: vi.fn(async () => {
      if (index >= parts.length) return { done: true, value: undefined };
      const value = parts[index++];
      return { done: false, value };
    }),
    releaseLock: vi.fn(),
  };
  return {
    getReader: vi.fn(() => reader),
    _reader: reader,
  };
};

const makeDeferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

beforeEach(() => {
  vi.clearAllMocks();
  normalizeMocks.normalizeText.mockImplementation((input) => ({
    normalized: String(input || ""),
    textHash: `sha256:${String(input || "").length.toString(16).padStart(4, "0")}`,
  }));
  chunkMocks.chunkText.mockImplementation((text, options = {}) => makeChunks(text, options.chunkSize));
  chunkMocks.smartChunk.mockImplementation((text, options = {}) => ({
    chunks: makeChunks(text, options.maxSize),
    strategy: chunkMocks.ChunkStrategy.SMART,
    meta: { totalLength: text.length, chunkCount: makeChunks(text, options.maxSize).length },
  }));
  tocMocks.buildToc.mockImplementation(() => ({ tocNodes: [], fallbackSections: [] }));
});

describe("isPlainObject", () => {
  it("re-exports the shared implementation", () => {
    expect(isPlainObject).toBe(sharedMocks.isPlainObject);
  });

  it("handles boundary values", () => {
    expect(isPlainObject(boundary.nullValue)).toBe(false);
    expect(isPlainObject(boundary.undefinedValue)).toBe(false);
    expect(isPlainObject(boundary.emptyArray)).toBe(false);
    expect(isPlainObject(boundary.emptyObject)).toBe(true);
    expect(isPlainObject(boundary.objectAsArray)).toBe(true);
    expect(isPlainObject(boundary.deepObject)).toBe(true);
    expect(isPlainObject(Object.create(null))).toBe(true);
    expect(isPlainObject(new Date())).toBe(false);
  });
});

describe("toNonEmptyString", () => {
  it("re-exports the shared implementation", () => {
    expect(toNonEmptyString).toBe(sharedMocks.toNonEmptyString);
  });

  it("handles empty and whitespace values", () => {
    expect(toNonEmptyString(boundary.nullValue)).toBeUndefined();
    expect(toNonEmptyString(boundary.undefinedValue)).toBeUndefined();
    expect(toNonEmptyString(boundary.emptyString)).toBeUndefined();
    expect(toNonEmptyString(boundary.whitespaceString)).toBeUndefined();
    expect(toNonEmptyString(boundary.emptyArray)).toBeUndefined();
  });

  it("converts non-empty values to strings", () => {
    expect(toNonEmptyString(boundary.zero)).toBe("0");
    expect(toNonEmptyString(boundary.negativeOne)).toBe("-1");
    expect(toNonEmptyString(boundary.maxSafe)).toBe(String(boundary.maxSafe));
    expect(toNonEmptyString(boundary.stringNumber)).toBe("123");
    expect(toNonEmptyString(boundary.objectAsArray)).toBe("[object Object]");
  });
});

describe("BaseAdapter", () => {
  describe("constructor", () => {
    it("uses defaults for empty or invalid inputs", () => {
      const adapter = new BaseAdapter({
        adapterName: boundary.whitespaceString,
        defaultChunkOptions: boundary.emptyArray,
      });

      expect(adapter.adapterName).toBe("base");
      expect(adapter.defaultChunkOptions).toEqual({
        chunkSize: 2000,
        overlap: 200,
        includeLineNumbers: true,
      });
    });
  });

  describe("parseStream", () => {
    it("throws for non-object options", async () => {
      const adapter = new BaseAdapter();
      await expect(collect(adapter.parseStream(["x"], boundary.emptyArray))).rejects.toThrow(
        "BaseAdapter.parseStream(readable, options): options must be an object",
      );
    });

    it("throws for invalid readable inputs", async () => {
      const adapter = new BaseAdapter();
      await expect(collect(adapter.parseStream(boundary.stringNumber))).rejects.toThrow(
        "BaseAdapter.parseStream(readable): readable must be an async iterable/iterable/ReadableStream",
      );
    });

    it("chunks iterables with overlap and locators", async () => {
      const adapter = new BaseAdapter({
        defaultChunkOptions: { chunkSize: 4, overlap: 1, includeLineNumbers: false },
      });

      const chunks = await collect(
        adapter.parseStream(["abcdefg"], {
          chunkOptions: { chunkSize: 4, overlap: 1, includeLineNumbers: false },
        }),
      );

      expect(chunks.map((c) => c.text)).toEqual(["abcd", "defg", "g"]);
      expect(chunks.map((c) => c.locator)).toEqual([
        { charStart: 0, charEnd: 4 },
        { charStart: 3, charEnd: 7 },
        { charStart: 6, charEnd: 7 },
      ]);
      expect(chunks[0].locator.lineStart).toBeUndefined();
    });

    it("adds line numbers when enabled", async () => {
      const adapter = new BaseAdapter({
        defaultChunkOptions: { chunkSize: 2, overlap: 0, includeLineNumbers: true },
      });

      const chunks = await collect(
        adapter.parseStream(["a\nb\nc"], {
          chunkOptions: { chunkSize: 2, overlap: 0, includeLineNumbers: true },
        }),
      );

      expect(chunks.map((c) => c.text)).toEqual(["a\n", "b\n", "c"]);
      expect(chunks.map((c) => c.locator)).toEqual([
        { charStart: 0, charEnd: 2, lineStart: 1, lineEnd: 1 },
        { charStart: 2, charEnd: 4, lineStart: 2, lineEnd: 2 },
        { charStart: 4, charEnd: 5, lineStart: 3, lineEnd: 3 },
      ]);
    });

    it("normalizes CRLF boundaries and NBSP", async () => {
      const adapter = new BaseAdapter({
        defaultChunkOptions: { chunkSize: 50, overlap: 0, includeLineNumbers: false },
      });

      const chunks = await collect(
        adapter.parseStream([Buffer.from("a\r"), Buffer.from("\nb\u00A0c")], {
          chunkOptions: { chunkSize: 50, overlap: 0, includeLineNumbers: false },
        }),
      );

      expect(chunks).toHaveLength(1);
      expect(chunks[0].text).toBe("a\nb c");
    });

    it("flushes a trailing carriage return at the end", async () => {
      const adapter = new BaseAdapter({
        defaultChunkOptions: { chunkSize: 10, overlap: 0, includeLineNumbers: false },
      });

      const chunks = await collect(
        adapter.parseStream(["x\r"], {
          chunkOptions: { chunkSize: 10, overlap: 0, includeLineNumbers: false },
        }),
      );

      expect(chunks).toHaveLength(1);
      expect(chunks[0].text).toBe("x\n");
    });

    it("accepts web ReadableStream inputs", async () => {
      const adapter = new BaseAdapter({
        defaultChunkOptions: { chunkSize: 20, overlap: 0, includeLineNumbers: false },
      });
      const stream = makeWebStream(["hello", " world"]);

      const chunks = await collect(
        adapter.parseStream(stream, {
          chunkOptions: { chunkSize: 20, overlap: 0, includeLineNumbers: false },
        }),
      );

      expect(chunks).toHaveLength(1);
      expect(chunks[0].text).toBe("hello world");
      expect(stream.getReader).toHaveBeenCalledTimes(1);
      expect(stream._reader.releaseLock).toHaveBeenCalledTimes(1);
    });

    it("falls back to default chunk options when inputs are invalid types", async () => {
      const adapter = new BaseAdapter({
        defaultChunkOptions: { chunkSize: 4, overlap: 1, includeLineNumbers: false },
      });

      const chunks = await collect(
        adapter.parseStream(["abcdefg"], {
          chunkOptions: { chunkSize: boundary.stringNumber, overlap: boundary.stringNumber, includeLineNumbers: false },
        }),
      );

      expect(chunks[0].text.length).toBe(4);
    });

    it("throws when overlap is not less than chunkSize", async () => {
      const adapter = new BaseAdapter();
      await expect(
        collect(
          adapter.parseStream(["abc"], {
            chunkOptions: { chunkSize: 2, overlap: 2, includeLineNumbers: false },
          }),
        ),
      ).rejects.toThrow("BaseAdapter.parseStream(): overlap must be < chunkSize");
    });

    it("returns no chunks for empty iterables", async () => {
      const adapter = new BaseAdapter({
        defaultChunkOptions: { chunkSize: 5, overlap: 0, includeLineNumbers: false },
      });
      const chunks = await collect(adapter.parseStream([], { chunkOptions: { chunkSize: 5, overlap: 0 } }));
      expect(chunks).toEqual([]);
    });

    it("handles concurrent calls safely", async () => {
      const adapter = new BaseAdapter({
        defaultChunkOptions: { chunkSize: 3, overlap: 0, includeLineNumbers: false },
      });

      const [alpha, beta] = await Promise.all([
        collect(adapter.parseStream(["abc"], { chunkOptions: { chunkSize: 3, overlap: 0, includeLineNumbers: false } })),
        collect(adapter.parseStream(["xyz"], { chunkOptions: { chunkSize: 3, overlap: 0, includeLineNumbers: false } })),
      ]);

      expect(alpha[0].chunkId).toBe("chunk_1");
      expect(beta[0].chunkId).toBe("chunk_1");
    });

    it("handles rapid consecutive calls", async () => {
      const adapter = new BaseAdapter({
        defaultChunkOptions: { chunkSize: 2, overlap: 0, includeLineNumbers: false },
      });

      for (const input of ["ab", "cd", "ef"]) {
        const chunks = await collect(
          adapter.parseStream([input], { chunkOptions: { chunkSize: 2, overlap: 0, includeLineNumbers: false } }),
        );
        expect(chunks[0].chunkId).toBe("chunk_1");
      }
    });

    it("rejects when the signal is already aborted", async () => {
      const adapter = new BaseAdapter();
      const controller = new AbortController();
      controller.abort();

      await expect(
        collect(adapter.parseStream(["abc"], { signal: controller.signal })),
      ).rejects.toMatchObject({ name: "AbortError" });
    });

    it("aborts mid-stream and destroys the readable", async () => {
      const adapter = new BaseAdapter({
        defaultChunkOptions: { chunkSize: 2, overlap: 0, includeLineNumbers: false },
      });
      const controller = new AbortController();
      const deferred = makeDeferred();
      const readable = {
        destroy: vi.fn(),
        [Symbol.asyncIterator]() {
          return {
            next() {
              return deferred.promise;
            },
          };
        },
      };

      const parsePromise = collect(
        adapter.parseStream(readable, { signal: controller.signal, chunkOptions: { chunkSize: 2, overlap: 0 } }),
      );

      controller.abort();
      deferred.resolve({ done: true, value: undefined });

      await expect(parsePromise).rejects.toMatchObject({ name: "AbortError" });
      expect(readable.destroy).toHaveBeenCalledTimes(1);
    });

    it("handles large inputs by producing multiple chunks", async () => {
      const adapter = new BaseAdapter({
        defaultChunkOptions: { chunkSize: 1024, overlap: 0, includeLineNumbers: false },
      });
      const chunks = await collect(
        adapter.parseStream([boundary.longString], { chunkOptions: { chunkSize: 1024, overlap: 0 } }),
      );
      expect(chunks.length).toBe(Math.ceil(boundary.longString.length / 1024));
    });
  });

  describe("parse", () => {
    it("collects parseStream output into an array", async () => {
      const adapter = new BaseAdapter({
        defaultChunkOptions: { chunkSize: 3, overlap: 0, includeLineNumbers: false },
      });
      const result = await adapter.parse(["abc"], { chunkOptions: { chunkSize: 3, overlap: 0, includeLineNumbers: false } });
      expect(result).toHaveLength(1);
      expect(result[0].text).toBe("abc");
    });
  });

  describe("_validateChunks", () => {
    it("returns ok for empty or non-array inputs", () => {
      const adapter = new BaseAdapter();
      expect(adapter._validateChunks(boundary.nullValue)).toEqual({ ok: true, reason: "empty" });
      expect(adapter._validateChunks(boundary.undefinedValue)).toEqual({ ok: true, reason: "empty" });
      expect(adapter._validateChunks(boundary.emptyArray)).toEqual({ ok: true, reason: "empty" });
      expect(adapter._validateChunks(boundary.objectAsArray)).toEqual({ ok: true, reason: "empty" });
    });

    it("rejects chunks that are not objects", () => {
      const adapter = new BaseAdapter();
      expect(adapter._validateChunks([null])).toEqual({ ok: false, reason: "chunk_not_object" });
    });

    it("rejects chunks missing text", () => {
      const adapter = new BaseAdapter();
      expect(
        adapter._validateChunks([{ text: "", locator: { charStart: 0, charEnd: 0 } }]),
      ).toEqual({ ok: false, reason: "chunk_missing_text" });
    });

    it("rejects chunks missing locators", () => {
      const adapter = new BaseAdapter();
      expect(adapter._validateChunks([{ text: "a", locator: null }])).toEqual({
        ok: false,
        reason: "chunk_missing_locator",
      });
    });

    it("rejects chunks with invalid locators", () => {
      const adapter = new BaseAdapter();
      expect(
        adapter._validateChunks([{ text: "a", locator: { charStart: 2, charEnd: 1 } }]),
      ).toEqual({ ok: false, reason: "chunk_bad_locator" });
    });

    it("rejects chunks with locators outside total length", () => {
      const adapter = new BaseAdapter();
      expect(
        adapter._validateChunks(
          [{ text: "a", locator: { charStart: -1, charEnd: 1 } }],
          { totalLength: 1 },
        ),
      ).toEqual({ ok: false, reason: "chunk_locator_oob" });
    });

    it("rejects oversized chunks", () => {
      const adapter = new BaseAdapter();
      const text = "x".repeat(600);
      expect(
        adapter._validateChunks([{ text, locator: { charStart: 0, charEnd: text.length } }], { maxSize: 20 }),
      ).toEqual({ ok: false, reason: `chunk_too_large:${text.length}` });
    });

    it("accepts valid chunks", () => {
      const adapter = new BaseAdapter();
      expect(
        adapter._validateChunks([{ text: "abc", locator: { charStart: 0, charEnd: 3 } }], { totalLength: 3 }),
      ).toEqual({ ok: true });
    });
  });

  describe("buildParsedDocument", () => {
    it("builds a document with fixed chunking and toc nodes", () => {
      const adapter = new BaseAdapter({
        adapterName: "unit",
        defaultChunkOptions: { chunkSize: 5, overlap: 1, includeLineNumbers: false },
      });
      normalizeMocks.normalizeText.mockReturnValueOnce({
        normalized: "norm",
        textHash: "sha256:abcdef1234567890",
      });
      tocMocks.buildToc.mockReturnValueOnce({
        tocNodes: [{ title: "A" }],
        fallbackSections: [{ title: "B" }],
      });
      const fixedChunks = [{ text: "norm", locator: { charStart: 0, charEnd: 4 } }];
      chunkMocks.chunkText.mockReturnValueOnce(fixedChunks);

      const doc = adapter.buildParsedDocument({
        sourceType: "pdf",
        markdown: "markdown",
        metadata: boundary.emptyArray,
        origin: boundary.emptyArray,
        assets: boundary.emptyObject,
        parseInfo: boundary.stringNumber,
      });

      expect(chunkMocks.chunkText).toHaveBeenCalledWith("norm", expect.objectContaining({ chunkSize: 5 }));
      expect(doc.docId).toBe("pdf_abcdef123456");
      expect(doc.sourceType).toBe("pdf");
      expect(doc.origin).toEqual({});
      expect(doc.assets).toEqual([]);
      expect(doc.metadata).toEqual({});
      expect(doc.textNormalized).toBe("norm");
      expect(doc.textHash).toBe("sha256:abcdef1234567890");
      expect(doc.toc).toEqual([{ title: "A" }]);
      expect(doc.chunks).toEqual(fixedChunks);
      expect(doc.chunkStrategy).toBe(chunkMocks.ChunkStrategy.FIXED);
      expect(doc.chunkMeta).toEqual({ totalLength: 4, chunkCount: fixedChunks.length });
      expect(doc.parseInfo).toEqual({ adapter: "unit", durationMs: 0 });
    });

    it("uses provided metadata, assets, and explicit docId", () => {
      const adapter = new BaseAdapter({ adapterName: "unit" });
      normalizeMocks.normalizeText.mockReturnValueOnce({
        normalized: "body",
        textHash: "sha256:000000000000",
      });
      tocMocks.buildToc.mockReturnValueOnce({
        tocNodes: [],
        fallbackSections: [{ title: "Fallback" }],
      });
      const meta = boundary.deepObject;
      const assets = [{ id: "a1", type: "image", data: "x" }];
      const parseInfo = { adapter: "custom", durationMs: 12 };

      const doc = adapter.buildParsedDocument({
        markdown: "body",
        docId: "custom-id",
        origin: { url: "http://example.com" },
        metadata: meta,
        assets,
        parseInfo,
      });

      expect(doc.docId).toBe("custom-id");
      expect(doc.sourceType).toBe("markdown");
      expect(doc.origin).toEqual({ url: "http://example.com" });
      expect(doc.metadata).toBe(meta);
      expect(doc.assets).toBe(assets);
      expect(doc.parseInfo).toBe(parseInfo);
      expect(doc.toc).toEqual([{ title: "Fallback" }]);
    });

    it("uses smart chunking when enabled and valid", () => {
      const adapter = new BaseAdapter();
      normalizeMocks.normalizeText.mockReturnValueOnce({
        normalized: "ok",
        textHash: "sha256:111111111111",
      });
      const smartChunks = [{ text: "ok", locator: { charStart: 0, charEnd: 2 } }];
      chunkMocks.smartChunk.mockReturnValueOnce({
        chunks: smartChunks,
        strategy: "smart-strategy",
        meta: { totalLength: 2, chunkCount: 1 },
      });

      const doc = adapter.buildParsedDocument({
        markdown: "ok",
        useSmartChunk: true,
        chunkOptions: { chunkSize: 2, forceStrategy: "para" },
      });

      expect(chunkMocks.smartChunk).toHaveBeenCalledWith("ok", { maxSize: 2, forceStrategy: "para" });
      expect(chunkMocks.chunkText).not.toHaveBeenCalled();
      expect(doc.chunkStrategy).toBe("smart-strategy");
      expect(doc.chunkMeta).toEqual({ totalLength: 2, chunkCount: 1 });
      expect(doc.chunks).toEqual(smartChunks);
    });

    it("falls back when smart chunks are invalid", () => {
      const adapter = new BaseAdapter();
      normalizeMocks.normalizeText.mockReturnValueOnce({
        normalized: "hi",
        textHash: "sha256:222222222222",
      });
      chunkMocks.smartChunk.mockReturnValueOnce({
        chunks: [{ text: "", locator: { charStart: 0, charEnd: 0 } }],
        strategy: "smart-bad",
        meta: { totalLength: 0 },
      });
      const fallbackChunks = [{ text: "hi", locator: { charStart: 0, charEnd: 2 } }];
      chunkMocks.chunkText.mockReturnValueOnce(fallbackChunks);

      const doc = adapter.buildParsedDocument({
        markdown: "hi",
        useSmartChunk: true,
        chunkOptions: { chunkSize: 2 },
      });

      expect(chunkMocks.chunkText).toHaveBeenCalled();
      expect(doc.chunkStrategy).toBe(chunkMocks.ChunkStrategy.FIXED);
      expect(doc.chunks).toEqual(fallbackChunks);
      expect(doc.chunkMeta.fallbackFrom).toBe("smart-bad");
      expect(doc.chunkMeta.fallbackReason).toBe("chunk_missing_text");
      expect(doc.chunkMeta.totalLength).toBe(2);
      expect(doc.chunkMeta.avgChunkSize).toBe(2);
    });
  });
});
