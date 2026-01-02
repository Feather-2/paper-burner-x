const test = require("node:test");
const assert = require("node:assert/strict");

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
  const JSZip = require("jszip");
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
