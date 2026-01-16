
// ─────────────────────────────────────────────────────────────────────────────
// BaseAdapter Tests
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach } from "vitest";

it("BaseAdapter: constructor sets defaults", async () => {
  const { BaseAdapter } = await import("../../../js/agents/ingest/adapters/base.js");
  const a = new BaseAdapter();
  expect(a.adapterName).toBe("base");
  expect(a.defaultChunkOptions).toEqual({ chunkSize: 2000, overlap: 200, includeLineNumbers: true });

  const b = new BaseAdapter({ adapterName: "custom", defaultChunkOptions: { chunkSize: 500, overlap: 50 } });
  expect(b.adapterName).toBe("custom");
  expect(b.defaultChunkOptions.chunkSize).toBe(500);
});

it("BaseAdapter: parseStream yields chunks with locators", async () => {
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

  expect(chunks.length >= 2, "should produce multiple chunks").toBeTruthy();
  expect(chunks[0].chunkId.startsWith("chunk_")).toBeTruthy();
  expect(typeof chunks[0].locator.charStart).toBe("number");
  expect(typeof chunks[0].locator.charEnd).toBe("number");
  expect(chunks[0].locator.charStart).toBe(0);
});

it("BaseAdapter: parseStream handles Uint8Array input", async () => {
  const { BaseAdapter } = await import("../../../js/agents/ingest/adapters/base.js");
  const adapter = new BaseAdapter({ defaultChunkOptions: { chunkSize: 100, overlap: 0 } });

  const encoder = new TextEncoder();
  async function* bytesSource() {
    yield encoder.encode("Line 1\n");
    yield encoder.encode("Line 2\n");
  }

  const chunks = await adapter.parse(bytesSource());
  expect(Array.isArray(chunks ) && chunks.length >= 1).toBeTruthy();
  expect(chunks[0].text.includes("Line 1")).toBeTruthy();
});

it("BaseAdapter: parseStream respects AbortSignal", async () => {
  const { BaseAdapter } = await import("../../../js/agents/ingest/adapters/base.js");
  const adapter = new BaseAdapter({ defaultChunkOptions: { chunkSize: 5, overlap: 0 } });

  const ac = new AbortController();
  async function* slowSource() {
    yield "abc";
    ac.abort();
    yield "def";
  }

  await expect(async () => {
      // eslint-disable-next-line no-unused-vars
      for await (const _ of adapter.parseStream(slowSource(), { signal: ac.signal })) {
        // consume
      }
    },
    /aborted/i
  );
});

it("BaseAdapter: parseStream rejects invalid options", async () => {
  const { BaseAdapter } = await import("../../../js/agents/ingest/adapters/base.js");
  const adapter = new BaseAdapter();

  await expect(async () => {
      // eslint-disable-next-line no-unused-vars
      for await (const _ of adapter.parseStream(["test"], { chunkOptions: { chunkSize: 10, overlap: 20 } })) {
        // consume
      }
    },
    /overlap must be < chunkSize/
  );
});

it("BaseAdapter: parseStream rejects non-iterable input", async () => {
  const { BaseAdapter } = await import("../../../js/agents/ingest/adapters/base.js");
  const adapter = new BaseAdapter();

  await expect(async () => {
      // eslint-disable-next-line no-unused-vars
      for await (const _ of adapter.parseStream(42)) {
        // consume
      }
    },
    /must be an async iterable/
  );
});

it("BaseAdapter: parse collects parseStream into array", async () => {
  const { BaseAdapter } = await import("../../../js/agents/ingest/adapters/base.js");
  const adapter = new BaseAdapter({ defaultChunkOptions: { chunkSize: 10, overlap: 0 } });

  const result = await adapter.parse(["0123456789", "abcdefghij"]);
  expect(Array.isArray(result ) && result.length >= 2).toBeTruthy();
});

it("BaseAdapter: buildParsedDocument produces valid structure", async () => {
  const { BaseAdapter } = await import("../../../js/agents/ingest/adapters/base.js");
  const adapter = new BaseAdapter({ adapterName: "test" });

  const doc = adapter.buildParsedDocument({
    sourceType: "markdown",
    origin: { filename: "test.md" },
    markdown: "# Title\n\nContent here.",
    assets: [],
    metadata: { title: "Test" },
  });

  expect(doc.docId.startsWith("markdown_")).toBeTruthy();
  expect(doc.sourceType).toBe("markdown");
  expect(doc.textHash.startsWith("sha256:")).toBeTruthy();
  expect(Array.isArray(doc.chunks ) && doc.chunks.length >= 1).toBeTruthy();
  expect(Array.isArray(doc.toc)).toBeTruthy();
  expect(doc.parseInfo.adapter).toBe("test");
});

it("BaseAdapter: _validateChunks detects invalid chunks", async () => {
  const { BaseAdapter } = await import("../../../js/agents/ingest/adapters/base.js");
  const adapter = new BaseAdapter();

  expect(adapter._validateChunks([])).toEqual({ ok: true, reason: "empty" });
  expect(adapter._validateChunks([{ text: "" }])).toEqual({ ok: false, reason: "chunk_missing_text" });
  expect(adapter._validateChunks([{ text: "ok" }])).toEqual({ ok: false, reason: "chunk_missing_locator" });
  expect(adapter._validateChunks([{ text: "ok", locator: { charStart: 10, charEnd: 5 } }])).toEqual({ ok: false, reason: "chunk_bad_locator" });

  const validChunk = { text: "hello", locator: { charStart: 0, charEnd: 5 } };
  expect(adapter._validateChunks([validChunk], { maxSize: 100 })).toEqual({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// PdfAdapter Tests
// ─────────────────────────────────────────────────────────────────────────────

it("PdfAdapter: uses OCR when available", async () => {
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

  expect(parsed.sourceType).toBe("pdf");
  expect(parsed.markdown.includes("OCR Title")).toBeTruthy();
  expect(parsed.metadata.engine).toBe("test-ocr");
});

it("PdfAdapter: fallback extracts ASCII when OCR unavailable", async () => {
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

  expect(parsed.sourceType).toBe("pdf");
  expect(parsed.markdown.includes("doc.pdf")).toBeTruthy();
  expect(parsed.metadata.engine).toBe("fallback");
});

it("PdfAdapter: rejects oversized files", async () => {
  const { PdfAdapter } = await import("../../../js/agents/ingest/adapters/pdf.js");
  const adapter = new PdfAdapter({ maxFileSize: 50 });

  await expect(() =>
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

it("PdfAdapter: rejects invalid input types", async () => {
  const { PdfAdapter } = await import("../../../js/agents/ingest/adapters/pdf.js");
  const adapter = new PdfAdapter();

  await expect(() => adapter.parse(12345)).rejects.toThrow(/must be a path string or a file-like object/);

  await expect(() => adapter.parse({ name: "test.pdf" })).rejects.toThrow(/unsupported file-like input/
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// MarkdownAdapter Tests
// ─────────────────────────────────────────────────────────────────────────────

it("MarkdownAdapter: parses file-like with text() method", async () => {
  const { MarkdownAdapter } = await import("../../../js/agents/ingest/adapters/markdown.js");
  const adapter = new MarkdownAdapter({ defaultChunkOptions: { chunkSize: 50, overlap: 0 } });

  const parsed = await adapter.parse({
    name: "readme.md",
    type: "text/markdown",
    async text() {
      return "# Readme\n\nThis is content.";
    },
  });

  expect(parsed.sourceType).toBe("markdown");
  expect(parsed.origin.filename).toBe("readme.md");
  expect(parsed.markdown.includes("Readme")).toBeTruthy();
});

it("MarkdownAdapter: parses file-like with arrayBuffer() method", async () => {
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

  expect(parsed.sourceType).toBe("markdown");
  expect(parsed.markdown.includes("From Buffer")).toBeTruthy();
});

it("MarkdownAdapter: parses object with content property", async () => {
  const { MarkdownAdapter } = await import("../../../js/agents/ingest/adapters/markdown.js");
  const adapter = new MarkdownAdapter();

  const parsed = await adapter.parse({
    content: "# Direct Content\n\nInline text.",
    filename: "inline.md",
  });

  expect(parsed.origin.filename).toBe("inline.md");
  expect(parsed.markdown.includes("Direct Content")).toBeTruthy();
});

it("MarkdownAdapter: rejects unsupported input", async () => {
  const { MarkdownAdapter } = await import("../../../js/agents/ingest/adapters/markdown.js");
  const adapter = new MarkdownAdapter();

  await expect(() => adapter.parse(42)).rejects.toThrow(/must be a path string or a file-like object/);

  await expect(() => adapter.parse({ name: "test.md" })).rejects.toThrow(/unsupported file-like input/);
});

it("MarkdownAdapter: uses default filename when not provided", async () => {
  const { MarkdownAdapter } = await import("../../../js/agents/ingest/adapters/markdown.js");
  const adapter = new MarkdownAdapter();

  const parsed = await adapter.parse({
    content: "No name given.",
  });

  expect(parsed.origin.filename).toBe("untitled.md");
});

// ─────────────────────────────────────────────────────────────────────────────
// HtmlAdapter Additional Tests
// ─────────────────────────────────────────────────────────────────────────────

it("HtmlAdapter: parses with arrayBuffer input", async () => {
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

  expect(parsed.sourceType).toBe("html");
  expect(parsed.markdown.includes("Buffer HTML")).toBeTruthy();
});

it("HtmlAdapter: parses with content property", async () => {
  const { HtmlAdapter } = await import("../../../js/agents/ingest/adapters/html.js");
  const adapter = new HtmlAdapter();

  const parsed = await adapter.parse({
    name: "inline.html",
    content: "<h2>Inline</h2><p>Text</p>",
  });

  expect(parsed.markdown.includes("Inline")).toBeTruthy();
});

it("HtmlAdapter: rejects unsupported input", async () => {
  const { HtmlAdapter } = await import("../../../js/agents/ingest/adapters/html.js");
  const adapter = new HtmlAdapter();

  await expect(() => adapter.parse(123)).rejects.toThrow(/must be a path string or a file-like object/);
  await expect(() => adapter.parse({ name: "test.html" })).rejects.toThrow(/unsupported file-like input/);
});

it("HtmlAdapter: __internal helpers work correctly", async () => {
  const { __internal } = await import("../../../js/agents/ingest/adapters/html.js");

  expect(__internal.guessMimeType("page.html")).toBe("text/html");
  expect(__internal.guessMimeType("page.htm")).toBe("text/html");
  expect(__internal.extFromMime("image/jpeg")).toBe("jpg");
  expect(__internal.extFromMime("image/png")).toBe("png");

  const parsed = __internal.parseDataUri("data:image/png;base64,AAAA");
  expect(parsed.mimeType).toBe("image/png");
  expect(parsed.base64).toBe("AAAA");
  expect(__internal.parseDataUri("invalid")).toBe(null);

  const extracted = __internal.extractDataUriImagesFromHtml('<img src="data:image/png;base64,XXXX">');
  expect(extracted.images.length === 1).toBeTruthy();
  expect(extracted.images[0].data).toBe("XXXX");
});

// ─────────────────────────────────────────────────────────────────────────────
// DocxAdapter Tests
// ─────────────────────────────────────────────────────────────────────────────

it("DocxAdapter: converts via mammoth + turndown and extracts images as assets", async () => {
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
          expect(kind).toBe("base64");
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

  expect(parsed.sourceType).toBe("docx");
  expect(parsed.markdown.includes("Hello")).toBeTruthy();
  expect(Array.isArray(parsed.assets ) && parsed.assets.length === 1).toBeTruthy();
  expect(parsed.assets[0].mimeType).toBe("image/png");
  expect(parsed.assets[0].data).toBe("AAAA");
  expect(parsed.assets[0].source).toBe("extracted");
  expect(parsed.assets[0].docId).toBe(parsed.docId);
  expect(Array.isArray(parsed.parseInfo.warnings) && parsed.parseInfo.warnings.some((w) => w.includes("mammoth"))).toBeTruthy();
});

it("DocxAdapter: rejects oversized inputs before invoking mammoth", async () => {
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
  await expect(() =>
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
  expect(called).toBe(false);
});

it("PptxAdapter: extracts slide text + images as assets", async () => {
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

  expect(parsed.sourceType).toBe("pptx");
  expect(parsed.metadata.slideCount).toBe(1);
  expect(parsed.markdown.includes("Slide 1: Deck Title")).toBeTruthy();
  expect(parsed.markdown.includes("Point A")).toBeTruthy();
  expect(Array.isArray(parsed.assets ) && parsed.assets.length === 1).toBeTruthy();
  expect(parsed.assets[0].mimeType).toBe("image/png");
  expect(parsed.assets[0].data).toBe("BBBB");
  expect(parsed.assets[0].source).toBe("extracted");
});

it("HtmlAdapter: converts HTML to markdown and extracts base64 images", async () => {
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

  expect(parsed.sourceType).toBe("html");
  expect(parsed.markdown.includes("# Hi")).toBeTruthy();
  expect(parsed.markdown.includes("Body")).toBeTruthy();
  expect(!parsed.markdown.includes("data:image/")).toBeTruthy();
  expect(Array.isArray(parsed.assets ) && parsed.assets.length === 1).toBeTruthy();
  expect(parsed.assets[0].data).toBe("CCCC");
  expect(parsed.assets[0].mimeType).toBe("image/png");
});

it("EpubAdapter: parses OPF+spine, converts chapters, extracts images as assets", async () => {
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

  expect(parsed.sourceType).toBe("epub");
  expect(parsed.metadata.chapterCount).toBe(1);
  expect(Array.isArray(parsed.chapters ) && parsed.chapters.length === 1).toBeTruthy();
  expect(parsed.chapters[0].title).toBe("Chapter One");
  expect(parsed.markdown.includes("## Chapter One")).toBeTruthy();
  expect(parsed.markdown.includes("Text")).toBeTruthy();
  expect(Array.isArray(parsed.assets ) && parsed.assets.length === 1).toBeTruthy();
  expect(parsed.assets[0].data).toBe(expectedBase64);
  expect(parsed.assets[0].mimeType).toBe("image/png");
  expect(parsed.assets[0].source).toBe("extracted");
});

// ─────────────────────────────────────────────────────────────────────────────
// PptxAdapter Additional Tests
// ─────────────────────────────────────────────────────────────────────────────

it("PptxAdapter: rejects invalid input types", async () => {
  const { PptxAdapter } = await import("../../../js/agents/ingest/adapters/pptx.js");
  const adapter = new PptxAdapter();

  await expect(() => adapter.parse(12345)).rejects.toThrow(/must be a path string or a file-like object/);
  await expect(() => adapter.parse({ name: "slides.pptx" })).rejects.toThrow(/unsupported file-like input/
  );
});

it("PptxAdapter: handles empty slides array", async () => {
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

  expect(parsed.sourceType).toBe("pptx");
  expect(parsed.metadata.slideCount).toBe(0);
  expect(parsed.markdown.includes("empty.pptx")).toBeTruthy();
});

it("PptxAdapter: handles slides without title", async () => {
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

  expect(parsed.markdown.includes("## Slide 1")).toBeTruthy();
  expect(!parsed.markdown.includes("Slide 1:")).toBeTruthy();
  expect(parsed.markdown.includes("Bullet point only")).toBeTruthy();
});

// ─────────────────────────────────────────────────────────────────────────────
// DocxAdapter Additional Tests
// ─────────────────────────────────────────────────────────────────────────────

it("DocxAdapter: rejects invalid input types", async () => {
  const { DocxAdapter } = await import("../../../js/agents/ingest/adapters/docx.js");
  const adapter = new DocxAdapter();

  await expect(() => adapter.parse(12345)).rejects.toThrow(/must be a path string or a file-like object/);
  await expect(() => adapter.parse({ name: "doc.docx" })).rejects.toThrow(/unsupported file-like input/
  );
});

it("DocxAdapter: handles image read failure gracefully", async () => {
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

  expect(parsed.sourceType).toBe("docx");
  expect(parsed.markdown.includes("Doc")).toBeTruthy();
  expect(parsed.assets.length >= 1).toBeTruthy();
  expect(parsed.parseInfo.warnings?.some(w => w.includes("Image read failed"))).toBeTruthy();
});

// ─────────────────────────────────────────────────────────────────────────────
// BaseAdapter Edge Cases
// ─────────────────────────────────────────────────────────────────────────────

it("BaseAdapter: parseStream handles CRLF line endings", async () => {
  const { BaseAdapter } = await import("../../../js/agents/ingest/adapters/base.js");
  const adapter = new BaseAdapter({ defaultChunkOptions: { chunkSize: 50, overlap: 0, includeLineNumbers: true } });

  const chunks = await adapter.parse(["Line1\r\nLine2\rLine3\n"]);
  const combined = chunks.map((c) => c.text).join("");
  expect(combined.includes("Line1")).toBeTruthy();
  expect(combined.includes("Line2")).toBeTruthy();
  expect(combined.includes("Line3")).toBeTruthy();
  expect(!combined.includes("\r")).toBeTruthy();
});

it("BaseAdapter: parseStream handles NBSP normalization", async () => {
  const { BaseAdapter } = await import("../../../js/agents/ingest/adapters/base.js");
  const adapter = new BaseAdapter({ defaultChunkOptions: { chunkSize: 50, overlap: 0 } });

  const chunks = await adapter.parse(["Hello\u00A0World"]);
  const combined = chunks.map((c) => c.text).join("");
  expect(combined.includes("Hello World")).toBeTruthy();
});

it("BaseAdapter: parseStream handles empty input", async () => {
  const { BaseAdapter } = await import("../../../js/agents/ingest/adapters/base.js");
  const adapter = new BaseAdapter();

  const chunks = await adapter.parse([]);
  expect(chunks).toEqual([]);
});

it("BaseAdapter: buildParsedDocument with smartChunk enabled", async () => {
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

  expect(Array.isArray(doc.chunks)).toBeTruthy();
  expect(doc.chunkStrategy).toBeTruthy();
  expect(doc.chunkMeta).toBeTruthy();
});

// ─────────────────────────────────────────────────────────────────────────────
// PdfAdapter Edge Cases
// ─────────────────────────────────────────────────────────────────────────────

it("PdfAdapter: handles empty PDF gracefully", async () => {
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

  expect(parsed.sourceType).toBe("pdf");
  expect(parsed.markdown.includes("empty.pdf")).toBeTruthy();
});

it("PdfAdapter: calls onProgress when provided", async () => {
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

  expect(progressCalls.length).toBe(3);
  expect(progressCalls[0].msg).toBe("start");
  expect(progressCalls[2].msg).toBe("done");
});
