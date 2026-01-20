import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:util", () => ({
  TextDecoder: class {
    decode(chunk) {
      if (typeof chunk === "string") {
        return chunk;
      }
      return Array.from(chunk).map((byte) => String.fromCharCode(byte)).join("");
    }
  },
}));

import { TextDecoder as MockTextDecoder } from "node:util";
import { loadChunksStream, processLargeFile } from "../../../../js/agents/ingest/chunked-loader.js";

const originalTextDecoder = globalThis.TextDecoder;

async function collectChunks(generator) {
  const chunks = [];
  for await (const chunk of generator) {
    chunks.push(chunk);
  }
  return chunks;
}

function makeBinaryBlob(bytes) {
  return new Blob([new Uint8Array(bytes)]);
}

function toBytes(buffer) {
  return Array.from(new Uint8Array(buffer));
}

beforeEach(() => {
  globalThis.TextDecoder = originalTextDecoder;
  vi.clearAllMocks();
});

afterEach(() => {
  globalThis.TextDecoder = originalTextDecoder;
});

describe("loadChunksStream", () => {
  it("streams Blob sources in binary chunks by default", async () => {
    const blob = makeBinaryBlob([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const chunks = await collectChunks(loadChunksStream(blob, 4));

    expect(chunks).toHaveLength(3);
    expect(chunks.map((chunk) => chunk.offset)).toEqual([0, 4, 8]);
    expect(chunks.map((chunk) => chunk.size)).toEqual([4, 4, 2]);
    expect(chunks.map((chunk) => chunk.byteLength)).toEqual([4, 4, 2]);
    expect(toBytes(chunks[0].buffer)).toEqual([1, 2, 3, 4]);
    expect(toBytes(chunks[1].buffer)).toEqual([5, 6, 7, 8]);
    expect(toBytes(chunks[2].buffer)).toEqual([9, 10]);
  });

  it("streams Blob sources in text mode when asText is true", async () => {
    const blob = new Blob(["hello world"]);
    const chunks = await collectChunks(loadChunksStream(blob, 5, { asText: true }));

    expect(chunks).toHaveLength(3);
    expect(chunks.map((chunk) => chunk.text)).toEqual(["hello", " worl", "d"]);
    expect(chunks.map((chunk) => chunk.offset)).toEqual([0, 5, 10]);
    expect(chunks.map((chunk) => chunk.size)).toEqual([5, 5, 1]);
    expect(chunks.map((chunk) => chunk.byteLength)).toEqual([5, 5, 1]);
    expect(chunks.every((chunk) => chunk.buffer === undefined)).toBe(true);
  });

  it("enforces a minimum chunk size of 1 for zero or negative values", async () => {
    const blob = new Blob(["abc"]);

    const zeroChunks = await collectChunks(loadChunksStream(blob, 0, { asText: true }));
    const negativeChunks = await collectChunks(loadChunksStream(blob, -1, { asText: true }));

    expect(zeroChunks.map((chunk) => chunk.text)).toEqual(["a", "b", "c"]);
    expect(negativeChunks.map((chunk) => chunk.text)).toEqual(["a", "b", "c"]);
  });

  it("defaults chunk size for non-finite or non-number inputs", async () => {
    const blob = new Blob(["abcd"]);

    const stringChunks = await collectChunks(loadChunksStream(blob, "2", { asText: true }));
    const whitespaceChunks = await collectChunks(loadChunksStream(blob, "   ", { asText: true }));
    const nanChunks = await collectChunks(loadChunksStream(blob, Number.NaN, { asText: true }));
    const hugeChunks = await collectChunks(loadChunksStream(blob, Number.MAX_SAFE_INTEGER, { asText: true }));

    expect(stringChunks).toHaveLength(1);
    expect(whitespaceChunks).toHaveLength(1);
    expect(nanChunks).toHaveLength(1);
    expect(hugeChunks).toHaveLength(1);
    expect(stringChunks[0].text).toBe("abcd");
    expect(whitespaceChunks[0].text).toBe("abcd");
    expect(nanChunks[0].text).toBe("abcd");
    expect(hugeChunks[0].text).toBe("abcd");
  });

  it("supports ReadableStream-like sources and releases the reader lock", async () => {
    const reader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({ done: false, value: new Uint8Array([1, 2, 3, 4, 5]) })
        .mockResolvedValueOnce({ done: false, value: new Uint8Array([6, 7]) })
        .mockResolvedValueOnce({ done: true, value: undefined }),
      releaseLock: vi.fn(),
    };
    const source = { getReader: vi.fn(() => reader) };

    const chunks = await collectChunks(loadChunksStream(source, 4));

    expect(source.getReader).toHaveBeenCalledTimes(1);
    expect(reader.releaseLock).toHaveBeenCalledTimes(1);
    expect(chunks).toHaveLength(2);
    expect(chunks.map((chunk) => chunk.offset)).toEqual([0, 4]);
    expect(chunks.map((chunk) => chunk.byteLength)).toEqual([4, 3]);
    expect(toBytes(chunks[0].buffer)).toEqual([1, 2, 3, 4]);
    expect(toBytes(chunks[1].buffer)).toEqual([5, 6, 7]);
  });

  it("uses TextDecoder for stream text mode and emits trailing data", async () => {
    globalThis.TextDecoder = MockTextDecoder;
    const decodeSpy = vi.spyOn(MockTextDecoder.prototype, "decode");
    const reader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({ done: false, value: new Uint8Array(Buffer.from("hello")) })
        .mockResolvedValueOnce({ done: true, value: undefined }),
      releaseLock: vi.fn(),
    };
    const source = { getReader: vi.fn(() => reader) };

    const chunks = await collectChunks(loadChunksStream(source, 3, { asText: true }));

    expect(chunks.map((chunk) => chunk.text)).toEqual(["hel", "lo"]);
    expect(chunks.map((chunk) => chunk.offset)).toEqual([0, 3]);
    expect(decodeSpy).toHaveBeenCalledTimes(2);
    expect(reader.releaseLock).toHaveBeenCalledTimes(1);
    decodeSpy.mockRestore();
  });

  it("throws TypeError for invalid sources", async () => {
    const invalidSources = [
      null,
      undefined,
      "",
      "   ",
      [],
      {},
      { length: 0 },
      { getReader: "nope" },
    ];

    for (const source of invalidSources) {
      await expect(collectChunks(loadChunksStream(source))).rejects.toThrow(TypeError);
    }
  });
});

describe("processLargeFile", () => {
  it("processes text chunks by default and reports progress", async () => {
    const file = new Blob(["abcdef"]);
    const progress = [];
    const processor = vi.fn((chunk) => chunk.text);

    const results = await processLargeFile(file, processor, {
      chunkSize: 2,
      onProgress: (data) => progress.push(data),
    });

    expect(results).toEqual(["ab", "cd", "ef"]);
    expect(processor).toHaveBeenCalledTimes(3);
    expect(progress.map((entry) => entry.processed)).toEqual([2, 4, 6]);
    expect(progress.map((entry) => entry.total)).toEqual([6, 6, 6]);
    expect(progress[0].percent).toBeCloseTo(2 / 6);
    expect(progress[1].percent).toBeCloseTo(4 / 6);
    expect(progress[2].percent).toBeCloseTo(1);
  });

  it("processes binary chunks when asText is false", async () => {
    const file = makeBinaryBlob([10, 11, 12, 13]);
    const processor = vi.fn((chunk) => {
      expect(chunk.buffer).toBeInstanceOf(ArrayBuffer);
      expect(chunk.text).toBeUndefined();
      return chunk.byteLength;
    });

    const results = await processLargeFile(file, processor, { chunkSize: 2, asText: false });

    expect(results).toEqual([2, 2]);
    expect(processor).toHaveBeenCalledTimes(2);
  });

  it("sanitizes chunkSize boundaries and type variants", async () => {
    const file = new Blob(["abc"]);

    const zeroResults = await processLargeFile(file, (chunk) => chunk.text, { chunkSize: 0 });
    const negativeResults = await processLargeFile(file, (chunk) => chunk.text, { chunkSize: -1 });
    const maxResults = await processLargeFile(file, (chunk) => chunk.text, {
      chunkSize: Number.MAX_SAFE_INTEGER,
    });
    const stringResults = await processLargeFile(file, (chunk) => chunk.text, { chunkSize: "2" });
    const whitespaceResults = await processLargeFile(file, (chunk) => chunk.text, {
      chunkSize: "   ",
    });

    expect(zeroResults).toEqual(["a", "b", "c"]);
    expect(negativeResults).toEqual(["a", "b", "c"]);
    expect(maxResults).toEqual(["abc"]);
    expect(stringResults).toEqual(["abc"]);
    expect(whitespaceResults).toEqual(["abc"]);
  });

  it("returns empty results for empty files with empty options", async () => {
    const file = new Blob([]);
    const processor = vi.fn();
    const results = await processLargeFile(file, processor, {});

    expect(results).toEqual([]);
    expect(processor).not.toHaveBeenCalled();
  });

  it("propagates processor errors", async () => {
    const file = new Blob(["abc"]);
    const processor = vi.fn(() => {
      throw new Error("boom");
    });

    await expect(processLargeFile(file, processor, { chunkSize: 1 })).rejects.toThrow("boom");
    expect(processor).toHaveBeenCalledTimes(1);
  });

  it("handles concurrent calls without leaking state", async () => {
    const file = new Blob(["abcd"]);

    const [first, second] = await Promise.all([
      processLargeFile(file, (chunk) => `A:${chunk.text}`, { chunkSize: 2 }),
      processLargeFile(file, (chunk) => `B:${chunk.text}`, { chunkSize: 2 }),
    ]);

    expect(first).toEqual(["A:ab", "A:cd"]);
    expect(second).toEqual(["B:ab", "B:cd"]);
  });

  it("supports rapid successive calls with independent results", async () => {
    const file = new Blob(["wxyz"]);

    const first = await processLargeFile(file, (chunk) => chunk.text.toUpperCase(), { chunkSize: 2 });
    const second = await processLargeFile(file, (chunk) => chunk.text.repeat(2), { chunkSize: 2 });

    expect(first).toEqual(["WX", "YZ"]);
    expect(second).toEqual(["wxwx", "yzyz"]);
  });

  it("handles large text inputs and preserves deep nested results", async () => {
    const chunkSize = 1024;
    const longText = "x".repeat(chunkSize * 3 + 10);
    const file = new Blob([longText]);

    const results = await processLargeFile(
      file,
      (chunk) => ({
        level1: {
          level2: {
            level3: [chunk.text, { size: chunk.byteLength }],
          },
        },
      }),
      { chunkSize },
    );

    expect(results).toHaveLength(Math.ceil(longText.length / chunkSize));
    expect(results[0].level1.level2.level3[0]).toHaveLength(chunkSize);
    expect(results[results.length - 1].level1.level2.level3[0]).toHaveLength(10);
  });
});
