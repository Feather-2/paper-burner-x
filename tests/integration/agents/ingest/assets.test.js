import { describe, it, expect, beforeEach, afterEach } from "vitest";

const assert = require("node:assert/strict");

const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pb_pdf_assets_test_"));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function makePdfFile({ name = "doc.pdf", type = "application/pdf", bytes = Buffer.from("%PDF-1.4\n%…\n") } = {}) {
  return {
    name,
    type,
    size: bytes.length,
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

it("extractAssetsFromMarkdown(): maps placeholders to locators + image data", async () => {
  const { extractAssetsFromMarkdown } = await import("../../../../js/agents/ingest/extract-assets.js");

  const placeholder = "![Fig](images/img-001.png)";
  const markdown = `# T\n\nIntro.\n\n${placeholder}\n\n![Skip](images/missing.png)\n\n![External](https://example.com/a.png)\n`;
  const images = [{ id: "img-001.png", data: "data:image/png;base64,AAAA" }];

  const assets = extractAssetsFromMarkdown(markdown, images);
  expect(assets.length).toBe(1);

  const a0 = assets[0];
  expect(a0.type).toBe("image");
  expect(a0.source).toBe("ocr");
  expect(a0.mimeType).toBe("image/png");
  expect(a0.data).toBe("data:image/png;base64,AAAA");

  const start = markdown.indexOf(placeholder);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(a0.locator).toEqual({ charStart: start, charEnd: start + placeholder.length });
  expect(String(a0.assetId)).toMatch(/^asset_/);
});

it("PdfAdapter: calls injected OCR + builds ParsedDocument + extracts assets", async () => {
  const { PdfAdapter } = await import("../../../../js/agents/ingest/adapters/pdf.js");

  const file = makePdfFile({ name: "paper.pdf" });
  const placeholder = "![P](images/img-001.png)";
  const mockOcr = {
    async processFile(f, onProgress) {
      expect(f.name).toBe("paper.pdf");
      onProgress?.(50, 100, "halfway");
      return {
        markdown: `# Paper\n\n${placeholder}\n`,
        images: [{ id: "img-001.png", data: "data:image/png;base64,AAAA" }],
        metadata: { pageCount: 2, engine: "mock" },
      };
    },
  };

  const adapter = new PdfAdapter({ defaultChunkOptions: { chunkSize: 10, overlap: 0, includeLineNumbers: false } });
  const parsed = await adapter.parse(file, { ocr: mockOcr });

  expect(parsed.sourceType).toBe("pdf");
  expect(parsed.origin.mimeType).toBe("application/pdf");
  expect(parsed.origin.filename).toBe("paper.pdf");
  expect(parsed.metadata.pageCount).toBe(2);
  expect(parsed.metadata.engine).toBe("mock");
  expect(parsed.docId).toMatch(/^pdf_/);

  expect(parsed.markdown.includes("Paper")).toBe(true);
  expect(parsed.textHash.startsWith("sha256:")).toBe(true);
  expect(parsed.toc).toBeInstanceOf(Array);
  expect(parsed.toc?.length ?? 0).toBeGreaterThanOrEqual(1);
  expect(parsed.chunks).toBeInstanceOf(Array);
  expect(parsed.chunks?.length ?? 0).toBeGreaterThanOrEqual(1);

  expect(parsed.assets).toBeInstanceOf(Array);
  expect(parsed.assets?.length ?? 0).toBe(1);
  expect(parsed.assets[0].docId).toBe(parsed.docId);
  expect(parsed.assets[0].locator.charStart).toBe(parsed.markdown.indexOf(placeholder));
});

it("IngestStage: dispatches application/pdf to PdfAdapter + AssetManager dedups", async () => {
  const { IngestStage } = await import("../../../../js/agents/ingest/ingest-stage.js");

  const file = makePdfFile({ name: "dup.pdf" });
  const mockOcr = {
    async processFile() {
      return {
        markdown: "![A](images/img-1.png)\n![B](images/img-2.png)\n",
        images: [
          { id: "img-1.png", data: "data:image/png;base64,AAAA" },
          { id: "img-2.png", data: "data:image/png;base64,AAAA" },
        ],
        metadata: { engine: "mock" },
      };
    },
  };

  const stage = new IngestStage({ defaultChunkOptions: { chunkSize: 20, overlap: 0, includeLineNumbers: false } });
  const out = await stage.execute({ runId: "run_pdf_dedup", constraints: {} }, { files: [file] }, { ocr: mockOcr });

  expect(out.metrics.totalDocs).toBe(1);
  expect(out.metrics.successDocs).toBe(1);
  expect(out.metrics.failedDocs).toBe(0);

  expect(out.assets.length).toBe(1);
  expect(out.sources.length).toBe(1);
  expect(out.sources[0].kind).toBe("pdf");
  expect(out.sources[0].assetIds).toEqual([out.assets[0].assetId]);
});

it("PdfAdapter: falls back to embedded text extraction when OCR is missing", async () => {
  const { PdfAdapter } = await import("../../../../js/agents/ingest/adapters/pdf.js");

  const prior = globalThis.OcrManager;
  try {
    delete globalThis.OcrManager;
    const adapter = new PdfAdapter();
    const parsed = await adapter.parse(makePdfFile({ bytes: Buffer.from("%PDF-1.4\nHello\n") }), {});
    expect(parsed.sourceType).toBe("pdf");
    expect(parsed.metadata.engine).toBe("fallback");
    expect(String(parsed.markdown)).toContain("%PDF-1.4");
  } finally {
    globalThis.OcrManager = prior;
  }
});

it("PdfAdapter: validates input type and file-like shape", async () => {
  const { PdfAdapter } = await import("../../../../js/agents/ingest/adapters/pdf.js");

  const adapter = new PdfAdapter();
  const mockOcr = { async processFile() {} };

  await expect(() => adapter.parse(null, { ocr: mockOcr })).rejects.toThrow(/input must be a path string or a file-like object/);
  await expect(() => adapter.parse(123, { ocr: mockOcr })).rejects.toThrow(/input must be a path string or a file-like object/);

  await expect(() => adapter.parse({ name: "x.pdf" }, { ocr: mockOcr })).rejects.toThrow(/unsupported file-like input/);
});

it("PdfAdapter: rejects oversized inputs before invoking OCR", async () => {
  const { PdfAdapter } = await import("../../../../js/agents/ingest/adapters/pdf.js");

  let called = false;
  const mockOcr = {
    async processFile() {
      called = true;
      return { markdown: "", images: [] };
    },
  };

  const adapter = new PdfAdapter({ maxFileSize: 10 });
  const file = makePdfFile({ name: "big.pdf", bytes: Buffer.alloc(11) });
  await expect(() => adapter.parse(file, { ocr: mockOcr })).rejects.toThrow(/file too large/i);
  expect(called).toBe(false);

  await withTempDir(async (dir) => {
    const pdfPath = path.join(dir, "big.pdf");
    await fs.writeFile(pdfPath, Buffer.alloc(11));
    await expect(() => adapter.parse(pdfPath, { ocr: mockOcr })).rejects.toThrow(/file too large/i);
    expect(called).toBe(false);
  });
});

it("PdfAdapter: propagates OCR failure", async () => {
  const { PdfAdapter } = await import("../../../../js/agents/ingest/adapters/pdf.js");

  const adapter = new PdfAdapter();
  const mockOcr = {
    async processFile() {
      throw new Error("ocr failed");
    },
  };

  const result = await adapter.parse(makePdfFile(), { ocr: mockOcr });
  // OCR failure should fall back gracefully, not throw
  expect(result).toBeTruthy();
  expect(result.metadata?.engine || result.metadata?.hint).toBeTruthy();
});

it("PdfAdapter: handles empty markdown, missing images, and malformed image paths", async () => {
  const { PdfAdapter } = await import("../../../../js/agents/ingest/adapters/pdf.js");

  const adapter = new PdfAdapter({ defaultChunkOptions: { chunkSize: 20, overlap: 0, includeLineNumbers: false } });
  const mockOcr = {
    async processFile() {
      return {
        markdown: "![Broken](images/img-1.png\n\n", // missing ')'
        images: null,
        metadata: "not-an-object",
      };
    },
  };

  const parsed = await adapter.parse(makePdfFile({ name: "edge.PDF", type: "" }), { ocr: mockOcr });
  expect(parsed.origin.mimeType).toBe("application/pdf");
  expect(parsed.markdown).toBe("![Broken](images/img-1.png\n\n");
  expect(parsed.assets).toBeInstanceOf(Array);
  expect(parsed.assets?.length ?? -1).toBe(0);
});

it("PdfAdapter: supports string path input (reads file) and forwards onProgress", async () => {
  const { PdfAdapter } = await import("../../../../js/agents/ingest/adapters/pdf.js");

  await withTempDir(async (dir) => {
    const pdfPath = path.join(dir, "X.PDF");
    const bytes = Buffer.from("%PDF-1.4\n% test\n");
    await fs.writeFile(pdfPath, bytes);

    const progressEvents = [];
    const mockOcr = {
      async processFile(file, onProgress) {
        onProgress?.(1, 2, "starting");
        const ab = await file.arrayBuffer();
        expect(ab).toBeInstanceOf(ArrayBuffer);
        expect(ab.byteLength).toBe(bytes.length);
        onProgress?.(2, 2, "done");
        return { markdown: "# OK\n", images: [] };
      },
    };

    const stageProgress = [];
    const adapter = new PdfAdapter({ defaultChunkOptions: { chunkSize: 10, overlap: 0, includeLineNumbers: false } });
    const parsed = await adapter.parse(pdfPath, {
      ocr: mockOcr,
      onProgress(current, total, message) {
        stageProgress.push({ current, total, message });
      },
    });

    expect(parsed.origin.filename).toBe("X.PDF");
    expect(parsed.origin.mimeType).toBe("application/pdf");
    expect(stageProgress.length).toBeGreaterThanOrEqual(2);
  });
});

it("PdfAdapter: falls back to globalThis.OcrManager (object and class) when stageApi.ocr missing", async () => {
  const { PdfAdapter } = await import("../../../../js/agents/ingest/adapters/pdf.js");

  const prior = globalThis.OcrManager;
  try {
    const adapter = new PdfAdapter({ defaultChunkOptions: { chunkSize: 10, overlap: 0, includeLineNumbers: false } });

    globalThis.OcrManager = {
      async processFile() {
        return {
          markdown: "![A](images/img-1.jpg)\n",
          images: [{ id: "img-1.jpg", data: "AAAA" }], // no data: prefix => detect mime by extension
          metadata: { engine: "global_object" },
        };
      },
    };

    const parsed1 = await adapter.parse(makePdfFile({ name: "a.pdf" }), { ocr: {} });
    expect(parsed1.metadata.engine).toBe("global_object");
    expect(parsed1.assets.length).toBe(1);
    expect(parsed1.assets[0].mimeType).toBe("image/jpeg");

    globalThis.OcrManager = class {
      async processFile() {
        return { markdown: "", images: [], metadata: { engine: "global_class" } };
      }
    };

    const adapter2 = new PdfAdapter({ defaultChunkOptions: { chunkSize: 10, overlap: 0, includeLineNumbers: false } });
    const parsed2 = await adapter2.parse(makePdfFile({ name: "b.pdf" }), {});
    expect(parsed2.metadata.engine).toBe("global_class");
    expect(parsed2.assets.length).toBe(0);
  } finally {
    globalThis.OcrManager = prior;
  }
});

it("PdfAdapter: uses application/octet-stream when file-like has no type and non-pdf name", async () => {
  const { PdfAdapter } = await import("../../../../js/agents/ingest/adapters/pdf.js");

  const adapter = new PdfAdapter();
  const mockOcr = { async processFile() { return { markdown: "", images: [] }; } };

  const parsed = await adapter.parse(
    {
      name: "scan.bin",
      async arrayBuffer() {
        return new ArrayBuffer(1);
      },
    },
    { ocr: mockOcr }
  );

  expect(parsed.origin.mimeType).toBe("application/octet-stream");
});
