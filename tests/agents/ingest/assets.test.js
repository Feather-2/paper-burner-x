const test = require("node:test");
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

test("extractAssetsFromMarkdown(): maps placeholders to locators + image data", async () => {
  const { extractAssetsFromMarkdown } = await import("../../../js/agents/ingest/extract-assets.js");

  const placeholder = "![Fig](images/img-001.png)";
  const markdown = `# T\n\nIntro.\n\n${placeholder}\n\n![Skip](images/missing.png)\n\n![External](https://example.com/a.png)\n`;
  const images = [{ id: "img-001.png", data: "data:image/png;base64,AAAA" }];

  const assets = extractAssetsFromMarkdown(markdown, images);
  assert.equal(assets.length, 1);

  const a0 = assets[0];
  assert.equal(a0.type, "image");
  assert.equal(a0.source, "ocr");
  assert.equal(a0.mimeType, "image/png");
  assert.equal(a0.data, "data:image/png;base64,AAAA");

  const start = markdown.indexOf(placeholder);
  assert.ok(start >= 0);
  assert.deepEqual(a0.locator, { charStart: start, charEnd: start + placeholder.length });
  assert.ok(String(a0.assetId).startsWith("asset_"));
});

test("PdfAdapter: calls injected OCR + builds ParsedDocument + extracts assets", async () => {
  const { PdfAdapter } = await import("../../../js/agents/ingest/adapters/pdf.js");

  const file = makePdfFile({ name: "paper.pdf" });
  const placeholder = "![P](images/img-001.png)";
  const mockOcr = {
    async processFile(f, onProgress) {
      assert.equal(f.name, "paper.pdf");
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

  assert.equal(parsed.sourceType, "pdf");
  assert.equal(parsed.origin.mimeType, "application/pdf");
  assert.equal(parsed.origin.filename, "paper.pdf");
  assert.equal(parsed.metadata.pageCount, 2);
  assert.equal(parsed.metadata.engine, "mock");
  assert.ok(parsed.docId.startsWith("pdf_"));

  assert.equal(parsed.markdown.includes("Paper"), true);
  assert.equal(parsed.textHash.startsWith("sha256:"), true);
  assert.ok(Array.isArray(parsed.toc) && parsed.toc.length >= 1);
  assert.ok(Array.isArray(parsed.chunks) && parsed.chunks.length >= 1);

  assert.ok(Array.isArray(parsed.assets) && parsed.assets.length === 1);
  assert.equal(parsed.assets[0].docId, parsed.docId);
  assert.equal(parsed.assets[0].locator.charStart, parsed.markdown.indexOf(placeholder));
});

test("IngestStage: dispatches application/pdf to PdfAdapter + AssetManager dedups", async () => {
  const { IngestStage } = await import("../../../js/agents/ingest/ingest-stage.js");

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

  assert.equal(out.metrics.totalDocs, 1);
  assert.equal(out.metrics.successDocs, 1);
  assert.equal(out.metrics.failedDocs, 0);

  assert.equal(out.assets.length, 1);
  assert.equal(out.sources.length, 1);
  assert.equal(out.sources[0].kind, "pdf");
  assert.deepEqual(out.sources[0].assetIds, [out.assets[0].assetId]);
});

test("PdfAdapter: falls back to embedded text extraction when OCR is missing", async () => {
  const { PdfAdapter } = await import("../../../js/agents/ingest/adapters/pdf.js");

  const prior = globalThis.OcrManager;
  try {
    delete globalThis.OcrManager;
    const adapter = new PdfAdapter();
    const parsed = await adapter.parse(makePdfFile({ bytes: Buffer.from("%PDF-1.4\nHello\n") }), {});
    assert.equal(parsed.sourceType, "pdf");
    assert.equal(parsed.metadata.engine, "fallback");
    assert.ok(String(parsed.markdown).includes("%PDF-1.4"));
  } finally {
    globalThis.OcrManager = prior;
  }
});

test("PdfAdapter: validates input type and file-like shape", async () => {
  const { PdfAdapter } = await import("../../../js/agents/ingest/adapters/pdf.js");

  const adapter = new PdfAdapter();
  const mockOcr = { async processFile() {} };

  await assert.rejects(() => adapter.parse(null, { ocr: mockOcr }), /input must be a path string or a file-like object/);
  await assert.rejects(() => adapter.parse(123, { ocr: mockOcr }), /input must be a path string or a file-like object/);

  await assert.rejects(() => adapter.parse({ name: "x.pdf" }, { ocr: mockOcr }), /unsupported file-like input/);
});

test("PdfAdapter: rejects oversized inputs before invoking OCR", async () => {
  const { PdfAdapter } = await import("../../../js/agents/ingest/adapters/pdf.js");

  let called = false;
  const mockOcr = {
    async processFile() {
      called = true;
      return { markdown: "", images: [] };
    },
  };

  const adapter = new PdfAdapter({ maxFileSize: 10 });
  const file = makePdfFile({ name: "big.pdf", bytes: Buffer.alloc(11) });
  await assert.rejects(() => adapter.parse(file, { ocr: mockOcr }), /file too large/);
  assert.equal(called, false);

  await withTempDir(async (dir) => {
    const pdfPath = path.join(dir, "big.pdf");
    await fs.writeFile(pdfPath, Buffer.alloc(11));
    await assert.rejects(() => adapter.parse(pdfPath, { ocr: mockOcr }), /file too large/);
    assert.equal(called, false);
  });
});

test("PdfAdapter: propagates OCR failure", async () => {
  const { PdfAdapter } = await import("../../../js/agents/ingest/adapters/pdf.js");

  const adapter = new PdfAdapter();
  const mockOcr = {
    async processFile() {
      throw new Error("ocr failed");
    },
  };

  await assert.rejects(() => adapter.parse(makePdfFile(), { ocr: mockOcr }), /ocr failed/);
});

test("PdfAdapter: handles empty markdown, missing images, and malformed image paths", async () => {
  const { PdfAdapter } = await import("../../../js/agents/ingest/adapters/pdf.js");

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
  assert.equal(parsed.origin.mimeType, "application/pdf");
  assert.equal(parsed.markdown, "![Broken](images/img-1.png\n\n");
  assert.ok(Array.isArray(parsed.assets) && parsed.assets.length === 0);
});

test("PdfAdapter: supports string path input (reads file) and forwards onProgress", async () => {
  const { PdfAdapter } = await import("../../../js/agents/ingest/adapters/pdf.js");

  await withTempDir(async (dir) => {
    const pdfPath = path.join(dir, "X.PDF");
    const bytes = Buffer.from("%PDF-1.4\n% test\n");
    await fs.writeFile(pdfPath, bytes);

    const progressEvents = [];
    const mockOcr = {
      async processFile(file, onProgress) {
        onProgress?.(1, 2, "starting");
        const ab = await file.arrayBuffer();
        assert.ok(ab instanceof ArrayBuffer);
        assert.equal(ab.byteLength, bytes.length);
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

    assert.equal(parsed.origin.filename, "X.PDF");
    assert.equal(parsed.origin.mimeType, "application/pdf");
    assert.ok(stageProgress.length >= 2);
  });
});

test("PdfAdapter: falls back to globalThis.OcrManager (object and class) when stageApi.ocr missing", async () => {
  const { PdfAdapter } = await import("../../../js/agents/ingest/adapters/pdf.js");

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
    assert.equal(parsed1.metadata.engine, "global_object");
    assert.equal(parsed1.assets.length, 1);
    assert.equal(parsed1.assets[0].mimeType, "image/jpeg");

    globalThis.OcrManager = class {
      async processFile() {
        return { markdown: "", images: [], metadata: { engine: "global_class" } };
      }
    };

    const parsed2 = await adapter.parse(makePdfFile({ name: "b.pdf" }), {});
    assert.equal(parsed2.metadata.engine, "global_class");
    assert.equal(parsed2.assets.length, 0);
  } finally {
    globalThis.OcrManager = prior;
  }
});

test("PdfAdapter: uses application/octet-stream when file-like has no type and non-pdf name", async () => {
  const { PdfAdapter } = await import("../../../js/agents/ingest/adapters/pdf.js");

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

  assert.equal(parsed.origin.mimeType, "application/octet-stream");
});
