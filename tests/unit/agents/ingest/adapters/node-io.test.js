import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const pathMocks = vi.hoisted(() => ({
  basename: vi.fn(),
}));

const fsMocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  stat: vi.fn(),
}));

vi.mock("node:path", () => ({
  basename: pathMocks.basename,
}));

vi.mock("node:fs/promises", () => ({
  readFile: fsMocks.readFile,
  stat: fsMocks.stat,
}));

const MODULE_PATH = "../../../../../js/agents/ingest/adapters/node-io.js";
const ORIGINAL_PROCESS = globalThis.process;

const loadModule = async () => await import(MODULE_PATH);

function formatBasename(value) {
  const kind = Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
  return `base:${kind}:${String(value)}`;
}

beforeEach(() => {
  vi.resetModules();
  pathMocks.basename.mockReset();
  fsMocks.readFile.mockReset();
  fsMocks.stat.mockReset();
  globalThis.process = ORIGINAL_PROCESS;
});

afterEach(() => {
  globalThis.process = ORIGINAL_PROCESS;
});

describe("js/agents/ingest/adapters/node-io.js", () => {
  describe("isNodeEnvironment", () => {
    it("returns true when process.versions.node is available", async () => {
      const { isNodeEnvironment } = await loadModule();
      globalThis.process = { versions: { node: "20.0.0" } };

      expect(isNodeEnvironment()).toBe(true);
    });

    it.each([
      ["undefined process", undefined],
      ["empty object", {}],
      ["null versions", { versions: null }],
      ["missing node version", { versions: {} }],
    ])("returns false when %s", async (_label, proc) => {
      const { isNodeEnvironment } = await loadModule();
      globalThis.process = proc;

      expect(isNodeEnvironment()).toBe(false);
    });
  });

  describe("basenameOfPath", () => {
    it("returns basename for a standard path", async () => {
      pathMocks.basename.mockReturnValue("file.txt");
      const { basenameOfPath } = await loadModule();

      const result = await basenameOfPath("/tmp/file.txt");

      expect(result).toBe("file.txt");
      expect(pathMocks.basename).toHaveBeenCalledWith("/tmp/file.txt");
    });

    it.each([
      ["empty string", ""],
      ["whitespace", "   "],
      ["null", null],
      ["undefined", undefined],
      ["empty array", []],
      ["empty object", {}],
      ["zero", 0],
      ["negative one", -1],
      ["max safe integer", Number.MAX_SAFE_INTEGER],
      ["array-like object", { 0: "x", length: 1 }],
    ])("passes through boundary input: %s", async (_label, input) => {
      pathMocks.basename.mockImplementation((value) => formatBasename(value));
      const { basenameOfPath } = await loadModule();

      const result = await basenameOfPath(input);

      expect(result).toBe(formatBasename(input));
      expect(pathMocks.basename).toHaveBeenCalledWith(input);
    });

    it("throws when not in a Node environment", async () => {
      pathMocks.basename.mockReturnValue("ignored");
      const { basenameOfPath } = await loadModule();
      globalThis.process = {};

      await expect(basenameOfPath("/tmp/file.txt")).rejects.toThrow(
        "basenameOfPath() requires Node.js."
      );
      expect(pathMocks.basename).not.toHaveBeenCalled();
    });

    it("handles rapid consecutive calls", async () => {
      pathMocks.basename.mockImplementation((value) => `base:${value}`);
      const { basenameOfPath } = await loadModule();
      const inputs = ["a.txt", "b.txt", "c.txt", "d.txt"];
      const results = [];

      for (const input of inputs) {
        results.push(await basenameOfPath(input));
      }

      expect(results).toEqual(inputs.map((input) => `base:${input}`));
      expect(pathMocks.basename).toHaveBeenCalledTimes(inputs.length);
    });
  });

  describe("readFileFromPath", () => {
    it("reads file as a Buffer when encoding is omitted", async () => {
      const buf = Buffer.from("data");
      fsMocks.readFile.mockResolvedValue(buf);
      const { readFileFromPath } = await loadModule();

      const result = await readFileFromPath("/tmp/data.bin");

      expect(result).toBe(buf);
      expect(fsMocks.readFile).toHaveBeenCalledWith("/tmp/data.bin");
    });

    it("reads file as text when encoding is provided", async () => {
      fsMocks.readFile.mockResolvedValue("text");
      const { readFileFromPath } = await loadModule();

      const result = await readFileFromPath("/tmp/data.txt", "utf8");

      expect(result).toBe("text");
      expect(fsMocks.readFile).toHaveBeenCalledWith("/tmp/data.txt", "utf8");
    });

    it("treats empty encoding as absent", async () => {
      fsMocks.readFile.mockResolvedValue("raw");
      const { readFileFromPath } = await loadModule();

      const result = await readFileFromPath("   ", "");

      expect(result).toBe("raw");
      expect(fsMocks.readFile).toHaveBeenCalledWith("   ");
    });

    it("propagates readFile errors", async () => {
      fsMocks.readFile.mockRejectedValue(new Error("boom"));
      const { readFileFromPath } = await loadModule();

      await expect(readFileFromPath("/tmp/missing.txt")).rejects.toThrow("boom");
    });

    it("throws when not in a Node environment", async () => {
      fsMocks.readFile.mockResolvedValue("ignored");
      const { readFileFromPath } = await loadModule();
      globalThis.process = {};

      await expect(readFileFromPath("/tmp/data.bin")).rejects.toThrow(
        "readFileFromPath() requires Node.js."
      );
      expect(fsMocks.readFile).not.toHaveBeenCalled();
    });

  });

  describe("statFile", () => {
    it("returns file stats", async () => {
      const stats = { size: 123, mtime: new Date("2024-01-01T00:00:00Z") };
      fsMocks.stat.mockResolvedValue(stats);
      const { statFile } = await loadModule();

      const result = await statFile("/tmp/file.txt");

      expect(result).toBe(stats);
      expect(fsMocks.stat).toHaveBeenCalledWith("/tmp/file.txt");
    });

    it.each([
      ["empty string", ""],
      ["whitespace", "   "],
      ["empty object", {}],
    ])("passes through boundary input: %s", async (_label, input) => {
      const stats = { size: 0, mtime: new Date("2024-01-02T00:00:00Z") };
      fsMocks.stat.mockResolvedValue(stats);
      const { statFile } = await loadModule();

      const result = await statFile(input);

      expect(result).toBe(stats);
      expect(fsMocks.stat).toHaveBeenCalledWith(input);
    });

    it("propagates stat errors", async () => {
      fsMocks.stat.mockRejectedValue(new Error("stat-failed"));
      const { statFile } = await loadModule();

      await expect(statFile("/tmp/file.txt")).rejects.toThrow("stat-failed");
    });

    it("throws when not in a Node environment", async () => {
      fsMocks.stat.mockResolvedValue({ size: 1, mtime: new Date() });
      const { statFile } = await loadModule();
      globalThis.process = {};

      await expect(statFile("/tmp/file.txt")).rejects.toThrow(
        "statFile() requires Node.js."
      );
      expect(fsMocks.stat).not.toHaveBeenCalled();
    });
  });

  describe("bufferToArrayBuffer", () => {
    it("converts a Buffer to an ArrayBuffer with correct bytes", async () => {
      const { bufferToArrayBuffer } = await loadModule();
      const buf = Buffer.from([1, 2, 3]);

      const result = bufferToArrayBuffer(buf);

      expect(Array.from(new Uint8Array(result))).toEqual([1, 2, 3]);
    });

    it("returns an empty ArrayBuffer for null or undefined", async () => {
      const { bufferToArrayBuffer } = await loadModule();

      expect(bufferToArrayBuffer(null).byteLength).toBe(0);
      expect(bufferToArrayBuffer(undefined).byteLength).toBe(0);
    });

    it("handles zero-length buffers", async () => {
      const { bufferToArrayBuffer } = await loadModule();
      const buf = Buffer.alloc(0);

      const result = bufferToArrayBuffer(buf);

      expect(result.byteLength).toBe(0);
    });

    it("respects byte offsets when slicing", async () => {
      const { bufferToArrayBuffer } = await loadModule();
      const base = Buffer.from([10, 20, 30, 40]);
      const view = base.subarray(1, 3);

      const result = bufferToArrayBuffer(view);

      expect(Array.from(new Uint8Array(result))).toEqual([20, 30]);
    });

    it("supports concurrent conversions", async () => {
      const { bufferToArrayBuffer } = await loadModule();
      const bufA = Buffer.from([1, 2, 3]);
      const bufB = Buffer.from([4, 5]);

      const results = await Promise.all([
        Promise.resolve().then(() => bufferToArrayBuffer(bufA)),
        Promise.resolve().then(() => bufferToArrayBuffer(bufA)),
        Promise.resolve().then(() => bufferToArrayBuffer(bufB)),
      ]);

      expect(Array.from(new Uint8Array(results[0]))).toEqual([1, 2, 3]);
      expect(Array.from(new Uint8Array(results[1]))).toEqual([1, 2, 3]);
      expect(Array.from(new Uint8Array(results[2]))).toEqual([4, 5]);
    });

    it.each([
      ["array-like object", { 0: 1, length: 1 }],
      ["empty array", []],
    ])("throws for invalid buffer input: %s", async (_label, input) => {
      const { bufferToArrayBuffer } = await loadModule();

      expect(() => bufferToArrayBuffer(input)).toThrow(TypeError);
    });
  });

  describe("fileLikeFromPath", () => {
    it("creates a file-like object with default mime type", async () => {
      const buf = Buffer.from("hello");
      fsMocks.stat.mockResolvedValue({ size: buf.length, mtime: new Date() });
      fsMocks.readFile.mockResolvedValue(buf);
      pathMocks.basename.mockReturnValue("hello.txt");
      const { fileLikeFromPath } = await loadModule();

      const fileLike = await fileLikeFromPath("/tmp/hello.txt");

      expect(fileLike.name).toBe("hello.txt");
      expect(fileLike.type).toBe("application/octet-stream");
      expect(fileLike.size).toBe(buf.length);

      const arrayBuffer = await fileLike.arrayBuffer();
      expect(Array.from(new Uint8Array(arrayBuffer))).toEqual(Array.from(buf));
    });

    it("respects mimeType and deep nested options", async () => {
      const buf = Buffer.from("text");
      fsMocks.stat.mockResolvedValue({ size: buf.length, mtime: new Date() });
      fsMocks.readFile.mockResolvedValue(buf);
      pathMocks.basename.mockReturnValue("note.txt");
      const { fileLikeFromPath } = await loadModule();

      const fileLike = await fileLikeFromPath("/tmp/note.txt", {
        maxBytes: Number.MAX_SAFE_INTEGER,
        mimeType: "text/plain",
        meta: { nested: { depth: { value: "ok" } } },
      });

      expect(fileLike.type).toBe("text/plain");
    });

    it.each([
      ["maxBytes 0", 0],
      ["maxBytes -1", -1],
      ["maxBytes string", "10"],
      ["options array", []],
    ])("ignores non-positive or non-numeric maxBytes: %s", async (_label, maxBytes) => {
      const buf = Buffer.from("x");
      fsMocks.stat.mockResolvedValue({ size: 50, mtime: new Date() });
      fsMocks.readFile.mockResolvedValue(buf);
      pathMocks.basename.mockReturnValue("x.bin");
      const { fileLikeFromPath } = await loadModule();
      const options = Array.isArray(maxBytes) ? maxBytes : { maxBytes };

      const fileLike = await fileLikeFromPath("/tmp/x.bin", options);

      expect(fileLike.name).toBe("x.bin");
      expect(fileLike.size).toBe(buf.length);
      if (Array.isArray(maxBytes)) {
        expect(fileLike.type).toBe("application/octet-stream");
      }
    });

    it("throws when file exceeds maxBytes", async () => {
      fsMocks.stat.mockResolvedValue({
        size: Number.MAX_SAFE_INTEGER,
        mtime: new Date(),
      });
      const { fileLikeFromPath } = await loadModule();

      await expect(
        fileLikeFromPath("/tmp/huge.bin", {
          maxBytes: Number.MAX_SAFE_INTEGER - 1,
        })
      ).rejects.toThrow(
        `File too large: ${Number.MAX_SAFE_INTEGER} bytes (max ${
          Number.MAX_SAFE_INTEGER - 1
        })`
      );
      expect(fsMocks.readFile).not.toHaveBeenCalled();
      expect(pathMocks.basename).not.toHaveBeenCalled();
    });

    it("throws when not in a Node environment", async () => {
      fsMocks.stat.mockResolvedValue({ size: 1, mtime: new Date() });
      const { fileLikeFromPath } = await loadModule();
      globalThis.process = {};

      await expect(fileLikeFromPath("/tmp/hello.txt")).rejects.toThrow(
        "fileLikeFromPath() requires Node.js."
      );
      expect(fsMocks.stat).not.toHaveBeenCalled();
    });
  });

  describe("readTextFromPath", () => {
    it("reads text content and returns size", async () => {
      fsMocks.stat.mockResolvedValue({ size: 4, mtime: new Date() });
      fsMocks.readFile.mockResolvedValue("data");
      const { readTextFromPath } = await loadModule();

      const result = await readTextFromPath("/tmp/data.txt");

      expect(result).toEqual({ text: "data", size: 4 });
      expect(fsMocks.readFile).toHaveBeenCalledWith("/tmp/data.txt", "utf8");
    });

    it("handles empty files and whitespace paths", async () => {
      fsMocks.stat.mockResolvedValue({ size: 0, mtime: new Date() });
      fsMocks.readFile.mockResolvedValue("");
      const { readTextFromPath } = await loadModule();

      const result = await readTextFromPath("   ", { maxBytes: 0 });

      expect(result).toEqual({ text: "", size: 0 });
    });

    it("ignores string maxBytes and allows large sizes", async () => {
      fsMocks.stat.mockResolvedValue({ size: 20, mtime: new Date() });
      fsMocks.readFile.mockResolvedValue("ok");
      const { readTextFromPath } = await loadModule();

      const result = await readTextFromPath("/tmp/data.txt", {
        maxBytes: "10",
      });

      expect(result.text).toBe("ok");
    });

    it("returns long text with deep nested options", async () => {
      const longText = "x".repeat(50000);
      fsMocks.stat.mockResolvedValue({ size: longText.length, mtime: new Date() });
      fsMocks.readFile.mockResolvedValue(longText);
      const { readTextFromPath } = await loadModule();

      const result = await readTextFromPath("/tmp/long.txt", {
        maxBytes: Number.MAX_SAFE_INTEGER,
        meta: { deep: { nested: { value: "yes" } } },
      });

      expect(result.text.length).toBe(longText.length);
      expect(result.size).toBe(longText.length);
    });

    it("throws when file exceeds maxBytes", async () => {
      fsMocks.stat.mockResolvedValue({ size: 101, mtime: new Date() });
      const { readTextFromPath } = await loadModule();

      await expect(
        readTextFromPath("/tmp/too-large.txt", { maxBytes: 100 })
      ).rejects.toThrow("File too large: 101 bytes (max 100)");
      expect(fsMocks.readFile).not.toHaveBeenCalled();
    });

    it("propagates readFile errors", async () => {
      fsMocks.stat.mockResolvedValue({ size: 2, mtime: new Date() });
      fsMocks.readFile.mockRejectedValue(new Error("read-failed"));
      const { readTextFromPath } = await loadModule();

      await expect(readTextFromPath("/tmp/bad.txt")).rejects.toThrow("read-failed");
    });

    it("throws when not in a Node environment", async () => {
      fsMocks.stat.mockResolvedValue({ size: 1, mtime: new Date() });
      const { readTextFromPath } = await loadModule();
      globalThis.process = {};

      await expect(readTextFromPath("/tmp/data.txt")).rejects.toThrow(
        "readTextFromPath() requires Node.js."
      );
      expect(fsMocks.stat).not.toHaveBeenCalled();
    });
  });
});
