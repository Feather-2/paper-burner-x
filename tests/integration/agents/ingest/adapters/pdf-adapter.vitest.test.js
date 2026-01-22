import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Adapters dynamically import `node:fs/promises` at runtime.
// Use a module mock so no real filesystem IO happens in these unit tests.
const fsMocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  stat: vi.fn(),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    readFile: fsMocks.readFile,
    stat: fsMocks.stat,
  };
});

describe("PdfAdapter (vitest)", () => {
  let priorOcrManager;

  beforeEach(() => {
    // Reset module state between tests (PdfAdapter has a module-level OCR cache).
    vi.resetModules();

    fsMocks.readFile.mockReset();
    fsMocks.stat.mockReset();

    priorOcrManager = globalThis.OcrManager;
  });

  afterEach(() => {
    globalThis.OcrManager = priorOcrManager;
    vi.clearAllMocks();
  });

  it("parses a path input via injected OCR, forwards onProgress, and mocks fs reads", async () => {
    delete globalThis.OcrManager;

    const { PdfAdapter } = await import("../../../../../js/agents/ingest/adapters/pdf-adapter.vitest.js");

    const pdfPath = "/virtual/Paper.PDF";
    const bytes = Buffer.from("%PDF-1.4\nHello from mocked fs\n", "utf8");

    fsMocks.stat.mockResolvedValue({ size: bytes.length });
    fsMocks.readFile.mockResolvedValue(bytes);

    const stageProgress = vi.fn();
    const processFile = vi.fn(async (file, onProgress) => {
      expect(file.name).toBe("Paper.PDF");
      expect(file.type).toBe("application/pdf");
      expect(file.size).toBe(bytes.length);

      const ab = await file.arrayBuffer();
      expect(ab).toBeInstanceOf(ArrayBuffer);
      expect(ab.byteLength).toBe(bytes.length);

      onProgress?.(1, 2, "start");
      onProgress?.(2, 2, "done");

      return {
        markdown: "# OK\n\n![A](images/img-1.png)\n",
        images: [{ id: "img-1.png", data: "data:image/png;base64,AAAA" }],
        metadata: { engine: "mock_ocr" },
      };
    });

    const adapter = new PdfAdapter({
      // String input exercises normalizeMaxFileSize(string).
      maxFileSize: "1024",
      defaultChunkOptions: { chunkSize: 32, overlap: 0, includeLineNumbers: false },
    });

    const parsed = await adapter.parse(pdfPath, {
      ocr: { processFile },
      onProgress: stageProgress,
    });

    expect(fsMocks.stat).toHaveBeenCalledTimes(1);
    expect(fsMocks.stat).toHaveBeenCalledWith(pdfPath);
    expect(fsMocks.readFile).toHaveBeenCalledTimes(1);
    expect(fsMocks.readFile).toHaveBeenCalledWith(pdfPath);

    expect(processFile).toHaveBeenCalledTimes(1);
    expect(stageProgress).toHaveBeenCalledTimes(2);

    expect(parsed.sourceType).toBe("pdf");
    expect(parsed.origin.filename).toBe("Paper.PDF");
    expect(parsed.origin.mimeType).toBe("application/pdf");
    expect(parsed.origin.size).toBe(bytes.length);
    expect(parsed.metadata.engine).toBe("mock_ocr");
    expect(String(parsed.docId)).toMatch(/^pdf_/);

    expect(parsed.assets).toHaveLength(1);
    expect(parsed.assets[0].docId).toBe(parsed.docId);
    expect(parsed.assets[0].mimeType).toBe("image/png");
  });

  it("falls back to embedded ASCII string extraction when OCR is unavailable", async () => {
    delete globalThis.OcrManager;

    const { PdfAdapter } = await import("../../../../../js/agents/ingest/adapters/pdf-adapter.vitest.js");

    // Include non-printable bytes to force segmentation inside extractAsciiStrings().
    const bytes = Buffer.from([0x00, 0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x00, 0x57, 0x6f, 0x72, 0x6c, 0x64, 0x00]);
    const file = {
      name: "scan.bin",
      size: bytes.length,
      async arrayBuffer() {
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      },
    };

    const adapter = new PdfAdapter({ defaultChunkOptions: { chunkSize: 64, overlap: 0, includeLineNumbers: false } });
    const parsed = await adapter.parse(file, {});

    expect(parsed.sourceType).toBe("pdf");
    expect(parsed.origin.filename).toBe("scan.bin");
    expect(parsed.origin.mimeType).toBe("application/octet-stream");
    expect(parsed.metadata.engine).toBe("fallback");
    expect(String(parsed.metadata.hint)).toMatch(/OCR unavailable/i);

    expect(parsed.markdown).toContain("# scan.bin");
    expect(parsed.markdown).toContain("Hello");
    expect(parsed.markdown).toContain("World");
    expect(parsed.assets).toHaveLength(0);
  });

  it("uses globalThis.OcrManager class and caches the instance across parses", async () => {
    const ctor = vi.fn();
    const processFile = vi.fn(async () => ({
      markdown: "# From global\n",
      images: [],
      metadata: { engine: "global_class" },
    }));

    class OcrManager {
      constructor() {
        ctor();
        this.processFile = processFile;
      }
    }

    globalThis.OcrManager = OcrManager;

    const { PdfAdapter } = await import("../../../../../js/agents/ingest/adapters/pdf.js");

    const adapter = new PdfAdapter({ defaultChunkOptions: { chunkSize: 32, overlap: 0, includeLineNumbers: false } });
    const file = {
      name: "a.pdf",
      type: "application/pdf",
      size: 1,
      async arrayBuffer() {
        return new ArrayBuffer(1);
      },
    };

    const parsed1 = await adapter.parse(file, {});
    const parsed2 = await adapter.parse(file, {});

    expect(ctor).toHaveBeenCalledTimes(1);
    expect(processFile).toHaveBeenCalledTimes(2);
    expect(parsed1.metadata.engine).toBe("global_class");
    expect(parsed2.metadata.engine).toBe("global_class");
  });

  it("uses globalThis.OcrManager object when stageApi.ocr is missing", async () => {
    const processFile = vi.fn(async () => ({
      markdown: "# From global object\n",
      images: [],
      metadata: { engine: "global_object" },
    }));
    globalThis.OcrManager = { processFile };

    const { PdfAdapter } = await import("../../../../../js/agents/ingest/adapters/pdf.js");

    const adapter = new PdfAdapter({ defaultChunkOptions: { chunkSize: 32, overlap: 0, includeLineNumbers: false } });
    const parsed = await adapter.parse(
      {
        name: "x.pdf",
        type: "application/pdf",
        size: 1,
        async arrayBuffer() {
          return new ArrayBuffer(1);
        },
      },
      {}
    );

    expect(processFile).toHaveBeenCalledTimes(1);
    expect(parsed.metadata.engine).toBe("global_object");
  });

  it("fallback hint differs when globalThis.OcrManager exists but has no processFile()", async () => {
    globalThis.OcrManager = {};

    const { PdfAdapter } = await import("../../../../../js/agents/ingest/adapters/pdf.js");

    // Printable, but < minLen (4) => no extracted strings.
    const bytes = Buffer.from("abc", "utf8");
    const file = {
      name: "empty.pdf",
      size: bytes.length,
      async arrayBuffer() {
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      },
    };

    const adapter = new PdfAdapter({ defaultChunkOptions: { chunkSize: 64, overlap: 0, includeLineNumbers: false } });
    const parsed = await adapter.parse(file, {});

    expect(parsed.metadata.engine).toBe("fallback");
    expect(String(parsed.metadata.hint)).toMatch(/processFile\(\) unavailable/i);
    expect(parsed.markdown).toContain("(Empty PDF text; OCR unavailable.)");
  });

  it("validates input shape and maxFileSize before invoking OCR", async () => {
    delete globalThis.OcrManager;
    const { PdfAdapter } = await import("../../../../../js/agents/ingest/adapters/pdf.js");

    const processFile = vi.fn(async () => ({ markdown: "", images: [] }));
    const adapter = new PdfAdapter({ maxFileSize: 5 });

    await expect(adapter.parse({ name: "bad.pdf" }, { ocr: { processFile } })).rejects.toThrow(/unsupported file-like input/i);

    const tooBig = {
      name: "big.pdf",
      type: "application/pdf",
      size: 6,
      async arrayBuffer() {
        return new ArrayBuffer(6);
      },
    };
    await expect(adapter.parse(tooBig, { ocr: { processFile } })).rejects.toThrow(/file too large/i);
    expect(processFile).not.toHaveBeenCalled();

    // Non-object / non-string inputs reject with a TypeError.
    // @ts-expect-error - intentional bad input for runtime validation.
    await expect(adapter.parse(123, { ocr: { processFile } })).rejects.toThrow(/input must be a path string/i);
  });

  it("rejects oversized path inputs before readFile()", async () => {
    delete globalThis.OcrManager;
    const { PdfAdapter } = await import("../../../../../js/agents/ingest/adapters/pdf.js");

    const pdfPath = "/virtual/too-big.pdf";
    fsMocks.stat.mockResolvedValue({ size: 10 });
    fsMocks.readFile.mockResolvedValue(Buffer.alloc(10));

    const processFile = vi.fn(async () => ({ markdown: "", images: [] }));
    const adapter = new PdfAdapter({ maxFileSize: 5 });

    await expect(adapter.parse(pdfPath, { ocr: { processFile } })).rejects.toThrow(/file too large/i);
    expect(fsMocks.readFile).not.toHaveBeenCalled();
    expect(processFile).not.toHaveBeenCalled();
  });

  it("normalizeMaxFileSize handles Infinity and passes through large files", async () => {
    delete globalThis.OcrManager;
    const { PdfAdapter } = await import("../../../../../js/agents/ingest/adapters/pdf.js");

    const processFile = vi.fn(async () => ({
      markdown: "# huge\n",
      images: [],
      metadata: { engine: "mock" },
    }));

    const adapter = new PdfAdapter({ maxFileSize: Infinity });
    const hugeFile = {
      name: "huge.pdf",
      size: 999999999,
      async arrayBuffer() { return new ArrayBuffer(1); },
    };

    const parsed = await adapter.parse(hugeFile, { ocr: { processFile } });
    expect(processFile).toHaveBeenCalled();
    expect(parsed.sourceType).toBe("pdf");
  });

  it("extractAsciiStrings handles strings longer than 512 chars and respects limits", async () => {
    delete globalThis.OcrManager;
    const { PdfAdapter } = await import("../../../../../js/agents/ingest/adapters/pdf.js");

    // Create a buffer with a long printable string (> 512 chars)
    const longString = "A".repeat(600);
    const bytes = Buffer.from(longString, "utf8");
    const file = {
      name: "long.pdf",
      size: bytes.length,
      async arrayBuffer() {
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      },
    };

    const adapter = new PdfAdapter();
    const parsed = await adapter.parse(file, {});

    expect(parsed.metadata.engine).toBe("fallback");
    // The long string should be split by the internal 512-char pushCur
    expect(parsed.markdown).toContain("A");
  });

  it("OcrManager class instantiation fails processFile check returns null for ocr", async () => {
    class OcrManagerBroken {
      constructor() {
        // No processFile method
      }
    }
    globalThis.OcrManager = OcrManagerBroken;

    const { PdfAdapter } = await import("../../../../../js/agents/ingest/adapters/pdf.js");

    const bytes = Buffer.from("test text here", "utf8");
    const file = {
      name: "broken.pdf",
      size: bytes.length,
      async arrayBuffer() {
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      },
    };

    const adapter = new PdfAdapter();
    const parsed = await adapter.parse(file, {});

    // Should fallback since OcrManager instance has no processFile
    expect(parsed.metadata.engine).toBe("fallback");
    expect(parsed.metadata.hint).toMatch(/processFile\(\) unavailable/i);
  });

  it("fileLabel returns default for null/undefined input", async () => {
    delete globalThis.OcrManager;
    const { PdfAdapter } = await import("../../../../../js/agents/ingest/adapters/pdf.js");

    const adapter = new PdfAdapter();

    // Passing an object without name/filename uses default
    const file = {
      size: 5,
      async arrayBuffer() { return new ArrayBuffer(5); },
    };

    const parsed = await adapter.parse(file, {});
    expect(parsed.origin.filename).toBe("document.pdf");
  });

  it("handles file with stream() and text() but no arrayBuffer()", async () => {
    delete globalThis.OcrManager;
    const { PdfAdapter } = await import("../../../../../js/agents/ingest/adapters/pdf.js");

    const bytes = Buffer.from("stream test", "utf8");
    const file = {
      name: "stream.pdf",
      size: bytes.length,
      stream() { return null; },
      text() { return ""; },
    };

    const adapter = new PdfAdapter();
    // Should not throw since stream() and text() are present (passes validation)
    // But fallback path uses arrayBuffer which is missing - will get empty
    const parsed = await adapter.parse(file, {});
    expect(parsed.sourceType).toBe("pdf");
    // With no arrayBuffer, markdown will be empty/default
    expect(parsed.markdown).toContain("# stream.pdf");
  });
});
