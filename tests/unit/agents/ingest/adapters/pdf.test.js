import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const DEFAULT_MAX_FILE_SIZE = 25 * 1024 * 1024;

vi.mock("../../../../../js/agents/ingest/adapters/base.js", () => {
  class BaseAdapter {
    constructor({ adapterName } = {}) {
      this.adapterName = adapterName || "base";
      this.buildParsedDocument = vi.fn((params = {}) => ({
        docId: `doc_${params.sourceType || "unknown"}`,
        sourceType: params.sourceType,
        origin: params.origin,
        markdown: params.markdown,
        assets: Array.isArray(params.assets) ? params.assets : [],
        metadata: params.metadata,
        parseInfo: params.parseInfo,
      }));
    }
  }
  return { BaseAdapter };
});

vi.mock("../../../../../js/agents/ingest/extract-assets.js", () => ({
  extractAssetsFromMarkdown: vi.fn(),
}));

vi.mock("../../../../../js/agents/ingest/constants.js", () => ({
  SourceKind: { PDF: "pdf" },
}));

vi.mock("../../../../../js/agents/ingest/adapters/node-io.js", () => ({
  basenameOfPath: vi.fn(),
  fileLikeFromPath: vi.fn(),
}));

vi.mock("../../../../../js/agents/shared/index.js", () => ({
  isPlainObject: (v) => {
    if (v === null || typeof v !== "object") return false;
    if (Array.isArray(v)) return false;
    const proto = Object.getPrototypeOf(v);
    return proto === Object.prototype || proto === null;
  },
  toNonEmptyString: (v) => {
    if (v === undefined || v === null) return undefined;
    const s = String(v).trim();
    return s.length ? s : undefined;
  },
}));

const toArrayBuffer = (value) => {
  if (value instanceof ArrayBuffer) return value;
  if (typeof value === "string") {
    const buf = Buffer.from(value, "ascii");
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }
  const arr = value instanceof Uint8Array ? value : Uint8Array.from(value || []);
  return arr.buffer.slice(arr.byteOffset, arr.byteOffset + arr.byteLength);
};

const makeFileLike = ({ name = "doc.pdf", filename, size = 10, buffer = "Hello" } = {}) => ({
  name,
  filename,
  size,
  arrayBuffer: vi.fn().mockResolvedValue(toArrayBuffer(buffer)),
});

const markdownBody = (markdown) => markdown.replace(/^# .*?\n\n/, "").trim();

const originalOcrManager = globalThis.OcrManager;

describe("PdfAdapter", () => {
  let PdfAdapter;
  let extractAssetsFromMarkdown;
  let basenameOfPath;
  let fileLikeFromPath;

  beforeEach(async () => {
    vi.resetModules();
    ({ PdfAdapter } = await import("../../../../../js/agents/ingest/adapters/pdf.js"));
    ({ extractAssetsFromMarkdown } = await import("../../../../../js/agents/ingest/extract-assets.js"));
    ({ basenameOfPath, fileLikeFromPath } = await import("../../../../../js/agents/ingest/adapters/node-io.js"));
    vi.clearAllMocks();

    extractAssetsFromMarkdown.mockReturnValue([]);
    basenameOfPath.mockResolvedValue("file.pdf");
    fileLikeFromPath.mockResolvedValue(makeFileLike());
    globalThis.OcrManager = undefined;
  });

  afterEach(() => {
    if (originalOcrManager === undefined) {
      delete globalThis.OcrManager;
    } else {
      globalThis.OcrManager = originalOcrManager;
    }
    delete globalThis.__ocrInstance;
  });

  it("normalizes maxFileSize options and handles boundary values", () => {
    expect(new PdfAdapter({ maxFileSize: Infinity }).maxFileSize).toBe(Infinity);
    expect(new PdfAdapter({ maxFileSize: "1024" }).maxFileSize).toBe(1024);
    expect(new PdfAdapter({ maxFileSize: "   " }).maxFileSize).toBe(DEFAULT_MAX_FILE_SIZE);
    expect(new PdfAdapter({ maxFileSize: 0 }).maxFileSize).toBe(DEFAULT_MAX_FILE_SIZE);
    expect(new PdfAdapter({ maxFileSize: -1 }).maxFileSize).toBe(DEFAULT_MAX_FILE_SIZE);
    expect(new PdfAdapter({ maxFileSize: Number.MAX_SAFE_INTEGER }).maxFileSize).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("parses path input with OCR, progress, and nested metadata", async () => {
    basenameOfPath.mockResolvedValue("Report.PDF");
    const file = makeFileLike({ size: 123, buffer: "ignored" });
    fileLikeFromPath.mockResolvedValue(file);

    const nestedMeta = { author: "A", nested: { level: { deep: true } } };
    const ocr = {
      processFile: vi.fn(async (_file, progress) => {
        progress(1, 2, "step");
        return { markdown: "# OCR", images: [{ id: "img1", data: "img" }], metadata: nestedMeta };
      }),
    };
    const onProgress = vi.fn();

    extractAssetsFromMarkdown.mockReturnValue([{ id: "asset1", type: "image", data: "blob" }]);

    const adapter = new PdfAdapter({ maxFileSize: "1024" });
    const parsed = await adapter.parse("", { ocr, onProgress });

    expect(basenameOfPath).toHaveBeenCalledWith("");
    expect(fileLikeFromPath).toHaveBeenCalledWith("", { maxBytes: 1024, mimeType: "application/pdf" });
    expect(ocr.processFile).toHaveBeenCalledWith(file, expect.any(Function));
    expect(onProgress).toHaveBeenCalledWith(1, 2, "step");
    expect(extractAssetsFromMarkdown).toHaveBeenCalledWith("# OCR", [{ id: "img1", data: "img" }]);
    expect(parsed.origin).toEqual({ filename: "Report.PDF", mimeType: "application/pdf", size: 123 });
    expect(parsed.metadata).toMatchObject({ title: "Report.PDF", author: "A", nested: { level: { deep: true } } });
    expect(parsed.parseInfo.adapter).toBe("pdf");
    expect(parsed.parseInfo.durationMs).toEqual(expect.any(Number));
    expect(parsed.assets[0].docId).toBe(parsed.docId);
    expect(parsed.sourceType).toBe("pdf");
  });

  it("accepts empty string path input", async () => {
    basenameOfPath.mockResolvedValue("empty.pdf");
    const file = makeFileLike({ size: 1, buffer: "ignored" });
    fileLikeFromPath.mockResolvedValue(file);

    const ocr = {
      processFile: vi.fn(async () => ({ markdown: "# Empty", images: [], metadata: { author: "x" } })),
    };

    const adapter = new PdfAdapter();
    const parsed = await adapter.parse("", { ocr });

    expect(parsed.origin.filename).toBe("empty.pdf");
    expect(parsed.origin.mimeType).toBe("application/pdf");
  });

  it("rejects null/undefined/non-object inputs", async () => {
    const adapter = new PdfAdapter();
    for (const value of [null, undefined, 0, true]) {
      await expect(adapter.parse(value)).rejects.toThrow(TypeError);
    }
  });

  it("rejects unsupported file-like inputs including empty object/array", async () => {
    const adapter = new PdfAdapter();
    for (const value of [{}, [], { name: "x", size: 1 }]) {
      await expect(adapter.parse(value)).rejects.toThrow("unsupported file-like input");
    }
  });

  it("enforces max file size limits", async () => {
    const adapter = new PdfAdapter({ maxFileSize: 1 });
    const file = makeFileLike({ name: "big.pdf", size: 2, buffer: "x" });
    await expect(adapter.parse(file)).rejects.toThrow("file too large");
  });

  it("falls back when OCR throws and extracts embedded text", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const file = makeFileLike({ name: "fail.pdf", buffer: Uint8Array.from([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x00, 0x57, 0x6f, 0x72, 0x6c, 0x64]) });

    const ocr = {
      processFile: vi.fn(async () => {
        throw new Error("boom");
      }),
    };

    const adapter = new PdfAdapter();
    const parsed = await adapter.parse(file, { ocr });

    expect(warnSpy).toHaveBeenCalled();
    expect(parsed.markdown.startsWith("# fail.pdf")).toBe(true);
    expect(parsed.markdown).toContain("Hello\nWorld");
    expect(parsed.metadata.engine).toBe("fallback");
    expect(parsed.metadata.hint).toContain("OCR error: boom");

    warnSpy.mockRestore();
  });

  it("falls back without OCR and reports OcrManager hint with whitespace labels", async () => {
    globalThis.OcrManager = {};

    const file = makeFileLike({ name: "   ", filename: "\n\t", buffer: new ArrayBuffer(0) });
    const adapter = new PdfAdapter();
    const parsed = await adapter.parse(file);

    expect(parsed.markdown.startsWith("# document.pdf")).toBe(true);
    expect(parsed.markdown).toContain("Empty PDF text; OCR unavailable");
    expect(parsed.metadata.engine).toBe("fallback");
    expect(parsed.metadata.hint).toBe("OcrManager found but processFile() unavailable; extracted embedded text strings instead.");
  });

  it("limits extracted text length for large embedded strings", async () => {
    const longText = "A".repeat(21_000);
    const file = makeFileLike({ name: "long.pdf", buffer: longText });
    const adapter = new PdfAdapter();
    const parsed = await adapter.parse(file);

    const body = markdownBody(parsed.markdown);
    expect(body.length).toBeGreaterThan(0);
    expect(body.length).toBeLessThanOrEqual(20_000);
    expect(body.startsWith("A")).toBe(true);
  });

  it("uses cached global OcrManager instance for concurrent and rapid calls", async () => {
    let instanceCount = 0;
    const processCalls = [];

    class MockOcrManager {
      constructor() {
        instanceCount += 1;
        globalThis.__ocrInstance = this;
      }
      async processFile(file, progress) {
        processCalls.push({ file, progress });
        return { markdown: `# ${file.name}`, images: [], metadata: { source: file.name } };
      }
    }

    globalThis.OcrManager = MockOcrManager;

    const adapter = new PdfAdapter();
    const fileA = makeFileLike({ name: "a.pdf", buffer: "A" });
    const fileB = makeFileLike({ name: "b.pdf", buffer: "B" });
    const fileC = makeFileLike({ name: "c.pdf", buffer: "C" });

    const [docA, docB] = await Promise.all([adapter.parse(fileA), adapter.parse(fileB)]);
    const docC = await adapter.parse(fileC);

    expect(instanceCount).toBe(1);
    expect(processCalls.map((call) => call.file.name)).toEqual(["a.pdf", "b.pdf", "c.pdf"]);
    expect(docA.metadata.title).toBe("a.pdf");
    expect(docB.metadata.title).toBe("b.pdf");
    expect(docC.metadata.title).toBe("c.pdf");
  });

  it("uses injected pdfParser when OCR is unavailable", async () => {
    const parser = vi.fn(async () => "中文内容 A");
    const file = makeFileLike({ name: "cn.pdf", buffer: Uint8Array.from([0x00]) });

    const adapter = new PdfAdapter({ pdfParser: parser });
    const parsed = await adapter.parse(file);

    expect(parser).toHaveBeenCalledTimes(1);
    expect(parsed.markdown).toContain("中文内容 A");
    expect(parsed.metadata.engine).toBe("pdf-parser");
  });

  it("stageApi.pdfParser overrides constructor parser", async () => {
    const ctorParser = vi.fn(async () => "ctor");
    const stageParser = vi.fn(async () => "stage");
    const file = makeFileLike({ name: "override.pdf", buffer: "x" });

    const adapter = new PdfAdapter({ pdfParser: ctorParser });
    const parsed = await adapter.parse(file, { pdfParser: stageParser });

    expect(stageParser).toHaveBeenCalledTimes(1);
    expect(ctorParser).not.toHaveBeenCalled();
    expect(parsed.markdown).toContain("stage");
    expect(parsed.metadata.engine).toBe("pdf-parser");
  });

  it("falls back to embedded strings when injected pdfParser throws", async () => {
    const parser = vi.fn(async () => {
      throw new Error("parser failed");
    });
    const file = makeFileLike({ name: "fallback.pdf", buffer: "Hello Parser Fallback" });

    const adapter = new PdfAdapter({ pdfParser: parser });
    const parsed = await adapter.parse(file);

    expect(parser).toHaveBeenCalledTimes(1);
    expect(parsed.markdown).toContain("Hello Parser Fallback");
    expect(parsed.metadata.engine).toBe("fallback");
  });
});
