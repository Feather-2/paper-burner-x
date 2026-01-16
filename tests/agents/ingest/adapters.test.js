import test from "node:test";
import assert from "node:assert/strict";

// ─────────────────────────────────────────────────────────────────────────────
// BaseAdapter Tests
// ─────────────────────────────────────────────────────────────────────────────

test("BaseAdapter: constructor sets defaults", async () => {
  const { BaseAdapter } = await import("../../../js/agents/ingest/adapters/base.js");
  const a = new BaseAdapter();
  assert.equal(a.adapterName, "base");
  assert.deepEqual(a.defaultChunkOptions, { chunkSize: 2000, overlap: 200, includeLineNumbers: true });

  const b = new BaseAdapter({ adapterName: "custom", defaultChunkOptions: { chunkSize: 500, overlap: 50 } });
  assert.equal(b.adapterName, "custom");
  assert.equal(b.defaultChunkOptions.chunkSize, 500);
});

test("BaseAdapter: parseStream yields chunks with locators", async () => {
  const { BaseAdapter } = await import("../../../js/agents/ingest/adapters/base.js");
  const adapter = new BaseAdapter({ defaultChunkOptions: { chunkSize: 10, overlap: 2, includeLineNumbers: true } });

  async function* textSource() {
    yield "Hello ";
    yield "World! ";
    yield "Test.";
  }

  const chunks = [];
  for await (const c of adapter.parseStream(textSource(), { chunkOptions: { chunkSize: 10, overlap: 2, includeLineNumbers: true } })) {
    chunks.push(c);
  }

  assert.ok(chunks.length >= 2, "should produce multiple chunks");
  assert.ok(chunks[0].chunkId.startsWith("chunk_"));
  assert.equal(typeof chunks[0].locator.charStart, "number");
  assert.equal(typeof chunks[0].locator.charEnd, "number");
  assert.equal(chunks[0].locator.charStart, 0);
});

test("BaseAdapter: parseStream handles Uint8Array input", async () => {
  const { BaseAdapter } = await import("../../../js/agents/ingest/adapters/base.js");
  const adapter = new BaseAdapter({ defaultChunkOptions: { chunkSize: 100, overlap: 0 } });

  const encoder = new TextEncoder();
  async function* bytesSource() {
    yield encoder.encode("Line 1\n");
    yield encoder.encode("Line 2\n");
  }

  const chunks = await adapter.parse(bytesSource());
  assert.ok(Array.isArray(chunks) && chunks.length >= 1);
  assert.ok(chunks[0].text.includes("Line 1"));
});

test("BaseAdapter: parseStream respects AbortSignal", async () => {
  const { BaseAdapter } = await import("../../../js/agents/ingest/adapters/base.js");
  const adapter = new BaseAdapter({ defaultChunkOptions: { chunkSize: 5, overlap: 0 } });

  const ac = new AbortController();
  async function* slowSource() {
    yield "abc";
    ac.abort();
    yield "def";
  }

  await assert.rejects(
    async () => {
      // eslint-disable-next-line no-unused-vars
      for await (const _ of adapter.parseStream(slowSource(), { signal: ac.signal })) {
        // consume
      }
    },
    /aborted/i
  );
});

test("BaseAdapter: parseStream rejects invalid options", async () => {
  const { BaseAdapter } = await import("../../../js/agents/ingest/adapters/base.js");
  const adapter = new BaseAdapter();

  await assert.rejects(
    async () => {
      // eslint-disable-next-line no-unused-vars
      for await (const _ of adapter.parseStream(["test"], { chunkOptions: { chunkSize: 10, overlap: 20 } })) {
        // consume
      }
    },
    /overlap must be < chunkSize/
  );
});

test("BaseAdapter: parseStream rejects non-iterable input", async () => {
  const { BaseAdapter } = await import("../../../js/agents/ingest/adapters/base.js");
  const adapter = new BaseAdapter();

  await assert.rejects(
    async () => {
      // eslint-disable-next-line no-unused-vars
      for await (const _ of adapter.parseStream(42)) {
        // consume
      }
    },
    /must be an async iterable/
  );
});

test("BaseAdapter: parse collects parseStream into array", async () => {
  const { BaseAdapter } = await import("../../../js/agents/ingest/adapters/base.js");
  const adapter = new BaseAdapter({ defaultChunkOptions: { chunkSize: 10, overlap: 0 } });

  const result = await adapter.parse(["0123456789", "abcdefghij"]);
  assert.ok(Array.isArray(result) && result.length >= 2);
});

test("BaseAdapter: buildParsedDocument produces valid structure", async () => {
  const { BaseAdapter } = await import("../../../js/agents/ingest/adapters/base.js");
  const adapter = new BaseAdapter({ adapterName: "test" });

  const doc = adapter.buildParsedDocument({
    sourceType: "markdown",
    origin: { filename: "test.md" },
    markdown: "# Title\n\nContent here.",
    assets: [],
    metadata: { title: "Test" },
  });

  assert.ok(doc.docId.startsWith("markdown_"));
  assert.equal(doc.sourceType, "markdown");
  assert.ok(doc.textHash.startsWith("sha256:"));
  assert.ok(Array.isArray(doc.chunks) && doc.chunks.length >= 1);
  assert.ok(Array.isArray(doc.toc));
  assert.equal(doc.parseInfo.adapter, "test");
});

test("BaseAdapter: _validateChunks detects invalid chunks", async () => {
  const { BaseAdapter } = await import("../../../js/agents/ingest/adapters/base.js");
  const adapter = new BaseAdapter();

  assert.deepEqual(adapter._validateChunks([], {}), { ok: true, reason: "empty" });
  assert.deepEqual(adapter._validateChunks([{ text: "" }], {}), { ok: false, reason: "chunk_missing_text" });
  assert.deepEqual(adapter._validateChunks([{ text: "ok" }], {}), { ok: false, reason: "chunk_missing_locator" });
  assert.deepEqual(adapter._validateChunks([{ text: "ok", locator: { charStart: 10, charEnd: 5 } }], {}), { ok: false, reason: "chunk_bad_locator" });

  const validChunk = { text: "hello", locator: { charStart: 0, charEnd: 5 } };
  assert.deepEqual(adapter._validateChunks([validChunk], { maxSize: 100 }), { ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// PdfAdapter Tests
// ─────────────────────────────────────────────────────────────────────────────

test("PdfAdapter: uses OCR when available", async () => {
  const { PdfAdapter } = await import("../../../js/agents/ingest/adapters/pdf.js");

  const ocr = {
    async processFile(file, progress) {
      progress(0, 1, "start");
      return {
        markdown: "# OCR Title\n\nExtracted text.",
        images: [{ id: "ocr_img.png", data: "AAAA" }],
        metadata: { engine: "test-ocr" },
      };
    },
  };

  const adapter = new PdfAdapter({ defaultChunkOptions: { chunkSize: 50, overlap: 0 } });
  const parsed = await adapter.parse(
    {
      name: "test.pdf",
      type: "application/pdf",
      size: 100,
      async arrayBuffer() {
        return new ArrayBuffer(100);
      },
    },
    { ocr }
  );

  assert.equal(parsed.sourceType, "pdf");
  assert.ok(parsed.markdown.includes("OCR Title"));
  assert.equal(parsed.metadata.engine, "test-ocr");
});

test("PdfAdapter: fallback extracts ASCII when OCR unavailable", async () => {
  const { PdfAdapter } = await import("../../../js/agents/ingest/adapters/pdf.js");
  const adapter = new PdfAdapter({ defaultChunkOptions: { chunkSize: 50, overlap: 0 } });

  const encoder = new TextEncoder();
  const pdfLikeContent = encoder.encode("PDF-1.4 %PDF Test content here.");

  const parsed = await adapter.parse({
    name: "doc.pdf",
    type: "application/pdf",
    size: pdfLikeContent.byteLength,
    async arrayBuffer() {
      return pdfLikeContent.buffer.slice(pdfLikeContent.byteOffset, pdfLikeContent.byteOffset + pdfLikeContent.byteLength);
    },
  });

  assert.equal(parsed.sourceType, "pdf");
  assert.ok(parsed.markdown.includes("doc.pdf"));
  assert.equal(parsed.metadata.engine, "fallback");
});

test("PdfAdapter: rejects oversized files", async () => {
  const { PdfAdapter } = await import("../../../js/agents/ingest/adapters/pdf.js");
  const adapter = new PdfAdapter({ maxFileSize: 50 });

  await assert.rejects(
    () =>
      adapter.parse({
        name: "big.pdf",
        size: 100,
        async arrayBuffer() {
          return new ArrayBuffer(100);
        },
      }),
    /file too large/
  );
});

test("PdfAdapter: rejects invalid input types", async () => {
  const { PdfAdapter } = await import("../../../js/agents/ingest/adapters/pdf.js");
  const adapter = new PdfAdapter();

  await assert.rejects(() => adapter.parse(12345), /must be a path string or a file-like object/);

  await assert.rejects(
    () => adapter.parse({ name: "test.pdf" }),
    /unsupported file-like input/
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// MarkdownAdapter Tests
// ─────────────────────────────────────────────────────────────────────────────

test("MarkdownAdapter: parses file-like with text() method", async () => {
  const { MarkdownAdapter } = await import("../../../js/agents/ingest/adapters/markdown.js");
  const adapter = new MarkdownAdapter({ defaultChunkOptions: { chunkSize: 50, overlap: 0 } });

  const parsed = await adapter.parse({
    name: "readme.md",
    type: "text/markdown",
    async text() {
      return "# Readme\n\nThis is content.";
    },
  });

  assert.equal(parsed.sourceType, "markdown");
  assert.equal(parsed.origin.filename, "readme.md");
  assert.ok(parsed.markdown.includes("Readme"));
});

test("MarkdownAdapter: parses file-like with arrayBuffer() method", async () => {
  const { MarkdownAdapter } = await import("../../../js/agents/ingest/adapters/markdown.js");
  const adapter = new MarkdownAdapter({ defaultChunkOptions: { chunkSize: 50, overlap: 0 } });

  const encoder = new TextEncoder();
  const content = encoder.encode("# From Buffer\n\nBuffer content.");

  const parsed = await adapter.parse({
    name: "buffer.md",
    async arrayBuffer() {
      return content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength);
    },
  });

  assert.equal(parsed.sourceType, "markdown");
  assert.ok(parsed.markdown.includes("From Buffer"));
});

test("MarkdownAdapter: parses object with content property", async () => {
  const { MarkdownAdapter } = await import("../../../js/agents/ingest/adapters/markdown.js");
  const adapter = new MarkdownAdapter();

  const parsed = await adapter.parse({
    content: "# Direct Content\n\nInline text.",
    filename: "inline.md",
  });

  assert.equal(parsed.origin.filename, "inline.md");
  assert.ok(parsed.markdown.includes("Direct Content"));
});

test("MarkdownAdapter: rejects unsupported input", async () => {
  const { MarkdownAdapter } = await import("../../../js/agents/ingest/adapters/markdown.js");
  const adapter = new MarkdownAdapter();

  await assert.rejects(() => adapter.parse(42), /must be a path string or a file-like object/);

  await assert.rejects(() => adapter.parse({ name: "test.md" }), /unsupported file-like input/);
});

test("MarkdownAdapter: uses default filename when not provided", async () => {
  const { MarkdownAdapter } = await import("../../../js/agents/ingest/adapters/markdown.js");
  const adapter = new MarkdownAdapter();

  const parsed = await adapter.parse({
    content: "No name given.",
  });

  assert.equal(parsed.origin.filename, "untitled.md");
});

// ─────────────────────────────────────────────────────────────────────────────
// HtmlAdapter Additional Tests
// ─────────────────────────────────────────────────────────────────────────────

test("HtmlAdapter: parses with arrayBuffer input", async () => {
  const { HtmlAdapter } = await import("../../../js/agents/ingest/adapters/html.js");
  const adapter = new HtmlAdapter({ defaultChunkOptions: { chunkSize: 50, overlap: 0 } });

  const encoder = new TextEncoder();
  const html = encoder.encode("<h1>Buffer HTML</h1><p>Content</p>");

  const parsed = await adapter.parse({
    name: "buffer.html",
    async arrayBuffer() {
      return html.buffer.slice(html.byteOffset, html.byteOffset + html.byteLength);
    },
  });

  assert.equal(parsed.sourceType, "html");
  assert.ok(parsed.markdown.includes("Buffer HTML"));
});

test("HtmlAdapter: parses with content property", async () => {
  const { HtmlAdapter } = await import("../../../js/agents/ingest/adapters/html.js");
  const adapter = new HtmlAdapter();

  const parsed = await adapter.parse({
    name: "inline.html",
    content: "<h2>Inline</h2><p>Text</p>",
  });

  assert.ok(parsed.markdown.includes("Inline"));
});

test("HtmlAdapter: rejects unsupported input", async () => {
  const { HtmlAdapter } = await import("../../../js/agents/ingest/adapters/html.js");
  const adapter = new HtmlAdapter();

  await assert.rejects(() => adapter.parse(123), /must be a path string or a file-like object/);
  await assert.rejects(() => adapter.parse({ name: "test.html" }), /unsupported file-like input/);
});

test("HtmlAdapter: __internal helpers work correctly", async () => {
  const { __internal } = await import("../../../js/agents/ingest/adapters/html.js");

  assert.equal(__internal.guessMimeType("page.html"), "text/html");
  assert.equal(__internal.guessMimeType("page.htm"), "text/html");
  assert.equal(__internal.extFromMime("image/jpeg"), "jpg");
  assert.equal(__internal.extFromMime("image/png"), "png");

  const parsed = __internal.parseDataUri("data:image/png;base64,AAAA");
  assert.equal(parsed.mimeType, "image/png");
  assert.equal(parsed.base64, "AAAA");
  assert.equal(__internal.parseDataUri("invalid"), null);

  const extracted = __internal.extractDataUriImagesFromHtml('<img src="data:image/png;base64,XXXX">');
  assert.ok(extracted.images.length === 1);
  assert.equal(extracted.images[0].data, "XXXX");
});

// ─────────────────────────────────────────────────────────────────────────────
// DocxAdapter Tests
// ─────────────────────────────────────────────────────────────────────────────

test("DocxAdapter: converts via mammoth + turndown and extracts images as assets", async () => {
  const { DocxAdapter } = await import("../../../js/agents/ingest/adapters/docx.js");

  const mammothStub = {
    images: {
      imgElement(fn) {
        return fn;
      },
    },
    async convertToHtml({ convertImage }) {
      const fakeImage = {
        contentType: "image/png",
        async read(kind) {
          assert.equal(kind, "base64");
          return "AAAA";
        },
      };
      const el = await convertImage(fakeImage);
      return {
        value: `<h1>Hello</h1><p>World</p><img alt="x" src="${el.src}">`,
        messages: [{ message: "mammoth warning" }],
      };
    },
  };

  const adapter = new DocxAdapter({ defaultChunkOptions: { chunkSize: 50, overlap: 0, includeLineNumbers: false } });
  const parsed = await adapter.parse(
    {
      name: "a.docx",
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: 1,
      async arrayBuffer() {
        return new ArrayBuffer(1);
      },
    },
    { mammoth: mammothStub }
  );

  assert.equal(parsed.sourceType, "docx");
  assert.ok(parsed.markdown.includes("Hello"));
  assert.ok(Array.isArray(parsed.assets) && parsed.assets.length === 1);
  assert.equal(parsed.assets[0].mimeType, "image/png");
  assert.equal(parsed.assets[0].data, "AAAA");
  assert.equal(parsed.assets[0].source, "extracted");
  assert.equal(parsed.assets[0].docId, parsed.docId);
  assert.ok(Array.isArray(parsed.parseInfo.warnings) && parsed.parseInfo.warnings.some((w) => w.includes("mammoth")));
});

test("DocxAdapter: rejects oversized inputs before invoking mammoth", async () => {
  const { DocxAdapter } = await import("../../../js/agents/ingest/adapters/docx.js");

  let called = false;
  const mammothStub = {
    images: {
      imgElement(fn) {
        return fn;
      },
    },
    async convertToHtml() {
      called = true;
      return { value: "", messages: [] };
    },
  };

  const adapter = new DocxAdapter({ maxFileSize: 1 });
  await assert.rejects(
    () =>
      adapter.parse(
        {
          name: "big.docx",
          size: 2,
          async arrayBuffer() {
            return new ArrayBuffer(2);
          },
        },
        { mammoth: mammothStub }
      ),
    /file too large/
  );
  assert.equal(called, false);
});

test("PptxAdapter: extracts slide text + images as assets", async () => {
  const { PptxAdapter } = await import("../../../js/agents/ingest/adapters/pptx.js");

  const pptxParser = {
    async parse() {
      return {
        slides: [
          {
            id: "slide-1",
            elements: [
              { type: "text", role: "title", content: "Deck Title" },
              { type: "text", content: "Point A" },
              { type: "image", src: "data:image/png;base64,BBBB" },
            ],
          },
        ],
        metadata: { slideCount: 1 },
      };
    },
  };

  const adapter = new PptxAdapter({ defaultChunkOptions: { chunkSize: 50, overlap: 0, includeLineNumbers: false } });
  const parsed = await adapter.parse(
    {
      name: "slides.pptx",
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      size: 1,
      async arrayBuffer() {
        return new ArrayBuffer(1);
      },
    },
    { pptxParser }
  );

  assert.equal(parsed.sourceType, "pptx");
  assert.equal(parsed.metadata.slideCount, 1);
  assert.ok(parsed.markdown.includes("Slide 1: Deck Title"));
  assert.ok(parsed.markdown.includes("Point A"));
  assert.ok(Array.isArray(parsed.assets) && parsed.assets.length === 1);
  assert.equal(parsed.assets[0].mimeType, "image/png");
  assert.equal(parsed.assets[0].data, "BBBB");
  assert.equal(parsed.assets[0].source, "extracted");
});

test("HtmlAdapter: converts HTML to markdown and extracts base64 images", async () => {
  const { HtmlAdapter } = await import("../../../js/agents/ingest/adapters/html.js");

  const html = `<h1>Hi</h1><p>Body</p><img src="data:image/png;base64,CCCC">`;
  const adapter = new HtmlAdapter({ defaultChunkOptions: { chunkSize: 50, overlap: 0, includeLineNumbers: false } });
  const parsed = await adapter.parse({
    name: "page.html",
    type: "text/html",
    async text() {
      return html;
    },
  });

  assert.equal(parsed.sourceType, "html");
  assert.ok(parsed.markdown.includes("# Hi"));
  assert.ok(parsed.markdown.includes("Body"));
  assert.ok(!parsed.markdown.includes("data:image/"));
  assert.ok(Array.isArray(parsed.assets) && parsed.assets.length === 1);
  assert.equal(parsed.assets[0].data, "CCCC");
  assert.equal(parsed.assets[0].mimeType, "image/png");
});

test("EpubAdapter: parses OPF+spine, converts chapters, extracts images as assets", async () => {
  const { default: JSZip } = await import("jszip");
  const { EpubAdapter } = await import("../../../js/agents/ingest/adapters/epub.js");

  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
  );
  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="3.0">
  <manifest>
    <item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="i1" href="images/pic.png" media-type="image/png"/>
  </manifest>
  <spine>
    <itemref idref="c1"/>
  </spine>
</package>`
  );

  const chapter = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Chapter One</title></head>
  <body>
    <h1>Chapter One</h1>
    <p>Text</p>
    <img src="images/pic.png" />
  </body>
</html>`;
  zip.file("OEBPS/chapter1.xhtml", chapter);

  const pngBytes = Buffer.from("PNGDATA", "utf8");
  zip.file("OEBPS/images/pic.png", pngBytes);

  const epubArrayBuffer = await zip.generateAsync({ type: "arraybuffer" });
  const expectedBase64 = pngBytes.toString("base64");

  const adapter = new EpubAdapter({ defaultChunkOptions: { chunkSize: 50, overlap: 0, includeLineNumbers: false } });
  const parsed = await adapter.parse({
    name: "book.epub",
    type: "application/epub+zip",
    async arrayBuffer() {
      return epubArrayBuffer;
    },
  });

  assert.equal(parsed.sourceType, "epub");
  assert.equal(parsed.metadata.chapterCount, 1);
  assert.ok(Array.isArray(parsed.chapters) && parsed.chapters.length === 1);
  assert.equal(parsed.chapters[0].title, "Chapter One");
  assert.ok(parsed.markdown.includes("## Chapter One"));
  assert.ok(parsed.markdown.includes("Text"));
  assert.ok(Array.isArray(parsed.assets) && parsed.assets.length === 1);
  assert.equal(parsed.assets[0].data, expectedBase64);
  assert.equal(parsed.assets[0].mimeType, "image/png");
  assert.equal(parsed.assets[0].source, "extracted");
});

// ─────────────────────────────────────────────────────────────────────────────
// PptxAdapter Additional Tests
// ─────────────────────────────────────────────────────────────────────────────

test("PptxAdapter: rejects invalid input types", async () => {
  const { PptxAdapter } = await import("../../../js/agents/ingest/adapters/pptx.js");
  const adapter = new PptxAdapter();

  await assert.rejects(() => adapter.parse(12345), /must be a path string or a file-like object/);
  await assert.rejects(
    () => adapter.parse({ name: "slides.pptx" }),
    /unsupported file-like input/
  );
});

test("PptxAdapter: handles empty slides array", async () => {
  const { PptxAdapter } = await import("../../../js/agents/ingest/adapters/pptx.js");

  const pptxParser = {
    async parse() {
      return { slides: [], metadata: { slideCount: 0 } };
    },
  };

  const adapter = new PptxAdapter({ defaultChunkOptions: { chunkSize: 50, overlap: 0 } });
  const parsed = await adapter.parse(
    {
      name: "empty.pptx",
      async arrayBuffer() {
        return new ArrayBuffer(1);
      },
    },
    { pptxParser }
  );

  assert.equal(parsed.sourceType, "pptx");
  assert.equal(parsed.metadata.slideCount, 0);
  assert.ok(parsed.markdown.includes("empty.pptx"));
});

test("PptxAdapter: handles slides without title", async () => {
  const { PptxAdapter } = await import("../../../js/agents/ingest/adapters/pptx.js");

  const pptxParser = {
    async parse() {
      return {
        slides: [
          {
            id: "s1",
            elements: [{ type: "text", content: "Bullet point only" }],
          },
        ],
        metadata: { slideCount: 1 },
      };
    },
  };

  const adapter = new PptxAdapter({ defaultChunkOptions: { chunkSize: 100, overlap: 0 } });
  const parsed = await adapter.parse(
    {
      name: "notitle.pptx",
      async arrayBuffer() {
        return new ArrayBuffer(1);
      },
    },
    { pptxParser }
  );

  assert.ok(parsed.markdown.includes("## Slide 1"));
  assert.ok(!parsed.markdown.includes("Slide 1:"));
  assert.ok(parsed.markdown.includes("Bullet point only"));
});

// ─────────────────────────────────────────────────────────────────────────────
// DocxAdapter Additional Tests
// ─────────────────────────────────────────────────────────────────────────────

test("DocxAdapter: rejects invalid input types", async () => {
  const { DocxAdapter } = await import("../../../js/agents/ingest/adapters/docx.js");
  const adapter = new DocxAdapter();

  await assert.rejects(() => adapter.parse(12345), /must be a path string or a file-like object/);
  await assert.rejects(
    () => adapter.parse({ name: "doc.docx" }),
    /unsupported file-like input/
  );
});

test("DocxAdapter: handles image read failure gracefully", async () => {
  const { DocxAdapter } = await import("../../../js/agents/ingest/adapters/docx.js");

  const mammothStub = {
    images: {
      imgElement(fn) {
        return fn;
      },
    },
    async convertToHtml({ convertImage }) {
      const failingImage = {
        contentType: "image/png",
        async read() {
          throw new Error("Image read failed");
        },
      };
      const el = await convertImage(failingImage);
      return {
        value: `<h1>Doc</h1><img src="${el.src}">`,
        messages: [],
      };
    },
  };

  const adapter = new DocxAdapter({ defaultChunkOptions: { chunkSize: 50, overlap: 0 } });
  const parsed = await adapter.parse(
    {
      name: "fail-img.docx",
      async arrayBuffer() {
        return new ArrayBuffer(1);
      },
    },
    { mammoth: mammothStub }
  );

  assert.equal(parsed.sourceType, "docx");
  assert.ok(parsed.markdown.includes("Doc"));
  assert.ok(parsed.assets.length >= 1);
  assert.ok(parsed.parseInfo.warnings?.some((w) => w.includes("Image read failed")));
});

// ─────────────────────────────────────────────────────────────────────────────
// BaseAdapter Edge Cases
// ─────────────────────────────────────────────────────────────────────────────

test("BaseAdapter: parseStream handles CRLF line endings", async () => {
  const { BaseAdapter } = await import("../../../js/agents/ingest/adapters/base.js");
  const adapter = new BaseAdapter({ defaultChunkOptions: { chunkSize: 50, overlap: 0, includeLineNumbers: true } });

  const chunks = await adapter.parse(["Line1\r\nLine2\rLine3\n"]);
  const combined = chunks.map((c) => c.text).join("");
  assert.ok(combined.includes("Line1"));
  assert.ok(combined.includes("Line2"));
  assert.ok(combined.includes("Line3"));
  assert.ok(!combined.includes("\r"), "CRLF should be normalized to LF");
});

test("BaseAdapter: parseStream handles NBSP normalization", async () => {
  const { BaseAdapter } = await import("../../../js/agents/ingest/adapters/base.js");
  const adapter = new BaseAdapter({ defaultChunkOptions: { chunkSize: 50, overlap: 0 } });

  const chunks = await adapter.parse(["Hello\u00A0World"]);
  const combined = chunks.map((c) => c.text).join("");
  assert.ok(combined.includes("Hello World"), "NBSP should be normalized to space");
});

test("BaseAdapter: parseStream handles empty input", async () => {
  const { BaseAdapter } = await import("../../../js/agents/ingest/adapters/base.js");
  const adapter = new BaseAdapter();

  const chunks = await adapter.parse([]);
  assert.deepEqual(chunks, []);
});

test("BaseAdapter: buildParsedDocument with smartChunk enabled", async () => {
  const { BaseAdapter } = await import("../../../js/agents/ingest/adapters/base.js");
  const adapter = new BaseAdapter({ adapterName: "smart" });

  const doc = adapter.buildParsedDocument({
    sourceType: "markdown",
    origin: { filename: "test.md" },
    markdown: "# Section 1\n\nParagraph one.\n\n# Section 2\n\nParagraph two.",
    assets: [],
    metadata: {},
    useSmartChunk: true,
  });

  assert.ok(Array.isArray(doc.chunks));
  assert.ok(doc.chunkStrategy);
  assert.ok(doc.chunkMeta);
});

// ─────────────────────────────────────────────────────────────────────────────
// PdfAdapter Edge Cases
// ─────────────────────────────────────────────────────────────────────────────

test("PdfAdapter: handles empty PDF gracefully", async () => {
  const { PdfAdapter } = await import("../../../js/agents/ingest/adapters/pdf.js");
  const adapter = new PdfAdapter({ defaultChunkOptions: { chunkSize: 50, overlap: 0 } });

  const parsed = await adapter.parse({
    name: "empty.pdf",
    type: "application/pdf",
    size: 0,
    async arrayBuffer() {
      return new ArrayBuffer(0);
    },
  });

  assert.equal(parsed.sourceType, "pdf");
  assert.ok(parsed.markdown.includes("empty.pdf"));
});

test("PdfAdapter: calls onProgress when provided", async () => {
  const { PdfAdapter } = await import("../../../js/agents/ingest/adapters/pdf.js");

  const progressCalls = [];
  const ocr = {
    async processFile(file, progress) {
      progress(0, 2, "start");
      progress(1, 2, "processing");
      progress(2, 2, "done");
      return { markdown: "# Done", images: [], metadata: {} };
    },
  };

  const adapter = new PdfAdapter();
  await adapter.parse(
    {
      name: "progress.pdf",
      async arrayBuffer() {
        return new ArrayBuffer(1);
      },
    },
    {
      ocr,
      onProgress: (cur, total, msg) => progressCalls.push({ cur, total, msg }),
    }
  );

  assert.equal(progressCalls.length, 3);
  assert.equal(progressCalls[0].msg, "start");
  assert.equal(progressCalls[2].msg, "done");
});
