import { describe, it, expect, vi, beforeEach } from "vitest";

const DEFAULT_MAX_FILE_SIZE = 25 * 1024 * 1024;
const DEFAULT_MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const DEFAULT_MAX_ZIP_ENTRIES = 2000;
const DEFAULT_MAX_COMPRESSION_RATIO = 100;

let docCounter = 0;

const baseAdapterMocks = vi.hoisted(() => {
  const buildParsedDocument = vi.fn();
  class BaseAdapter {
    constructor(options = {}) {
      this.adapterName = options.adapterName || "base";
      this.defaultChunkOptions = options.defaultChunkOptions || {};
    }

    buildParsedDocument(params = {}) {
      return buildParsedDocument(params);
    }
  }

  return { BaseAdapter, buildParsedDocument };
});

const extractAssetsFromMarkdownMock = vi.hoisted(() => vi.fn());
const nodeIoMocks = vi.hoisted(() => ({
  basenameOfPath: vi.fn(),
  fileLikeFromPath: vi.fn(),
}));
const sharedMocks = vi.hoisted(() => ({
  isPlainObject: vi.fn(),
  toNonEmptyString: vi.fn(),
}));
const sourceKindMock = vi.hoisted(() => ({ EPUB: "epub" }));
const jszipMocks = vi.hoisted(() => ({ loadAsync: vi.fn() }));
const turndownMocks = vi.hoisted(() => ({
  ctor: vi.fn(),
  turndown: vi.fn(),
  TurndownService: class TurndownService {
    constructor(options) {
      turndownMocks.ctor(options);
    }
    turndown(html) {
      return turndownMocks.turndown(html);
    }
  },
}));
const turndownMockControl = vi.hoisted(() => ({
  defaultExportMode: "function",
}));

vi.mock("../../../../../js/agents/ingest/adapters/base.js", () => ({
  BaseAdapter: baseAdapterMocks.BaseAdapter,
}));

vi.mock("../../../../../js/agents/ingest/extract-assets.js", () => ({
  extractAssetsFromMarkdown: extractAssetsFromMarkdownMock,
}));

vi.mock("../../../../../js/agents/ingest/constants.js", () => ({
  SourceKind: sourceKindMock,
}));

vi.mock("../../../../../js/agents/ingest/adapters/node-io.js", () => ({
  basenameOfPath: nodeIoMocks.basenameOfPath,
  fileLikeFromPath: nodeIoMocks.fileLikeFromPath,
}));

vi.mock("../../../../../js/agents/shared/index.js", () => ({
  isPlainObject: sharedMocks.isPlainObject,
  toNonEmptyString: sharedMocks.toNonEmptyString,
}));

vi.mock("jszip", () => ({
  default: jszipMocks,
  loadAsync: jszipMocks.loadAsync,
}));

vi.mock("turndown", () => ({
  get default() {
    if (turndownMockControl.defaultExportMode === "undefined") return undefined;
    if (turndownMockControl.defaultExportMode === "object") return {};
    return turndownMocks.TurndownService;
  },
}));

import { EpubAdapter } from "../../../../../js/agents/ingest/adapters/epub.js";
import { SourceKind } from "../../../../../js/agents/ingest/constants.js";

const defaultToNonEmptyString = (value) => {
  if (value === undefined || value === null) return undefined;
  const s = String(value).trim();
  return s.length ? s : undefined;
};

const defaultIsPlainObject = (value) => {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const defaultBasenameOfPath = (path) => {
  const parts = String(path || "").split(/[\\/]/);
  return parts[parts.length - 1] || String(path || "");
};

const mimeFromId = (id) => {
  const ext = String(id || "").split(".").pop()?.toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  if (ext === "svg") return "image/svg+xml";
  return "image/png";
};

const defaultExtractAssetsFromMarkdown = (markdown, images) => {
  if (!Array.isArray(images)) return [];
  return images.map((img) => ({
    id: img.id,
    type: "image",
    data: img.data,
    mimeType: mimeFromId(img.id),
  }));
};

const makeFileLike = ({
  name = "book.epub",
  filename,
  type,
  mimeType,
  size,
  byteLength = 1,
  buffer,
} = {}) => ({
  name,
  filename,
  type,
  mimeType,
  size,
  arrayBuffer: vi.fn().mockResolvedValue(buffer ?? new ArrayBuffer(byteLength)),
});

const makeZipEntry = ({ text = "", base64 = "", uncompressedSize, compressedSize, dir = false } = {}) => {
  const contentLength = typeof text === "string" ? text.length : 0;
  const base64Length = typeof base64 === "string" ? base64.length : 0;
  const uncompressed = Number.isFinite(uncompressedSize) ? uncompressedSize : Math.max(contentLength, base64Length);
  const compressed = Number.isFinite(compressedSize) ? compressedSize : Math.max(1, Math.floor(uncompressed / 2));
  return {
    dir,
    _data: { uncompressedSize: uncompressed, compressedSize: compressed },
    async: async (type) => {
      if (type === "string") return text;
      if (type === "base64") return base64;
      return "";
    },
  };
};

const makeZip = (files = {}) => {
  const entries = {};
  for (const [path, spec] of Object.entries(files)) {
    entries[path] = makeZipEntry(spec);
  }
  return {
    files: entries,
    file: (path) => entries[path] || null,
  };
};

const makeContainerXml = (opfPath) => `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="${opfPath}" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

const makeOpfXml = ({ chapterHref = "chapter1.xhtml", chapterId = "c1", mediaType = "application/xhtml+xml" } = {}) => `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <manifest>
    <item id="${chapterId}" href="${chapterHref}" media-type="${mediaType}"/>
  </manifest>
  <spine>
    <itemref idref="${chapterId}"/>
  </spine>
</package>`;

const makeXhtml = ({ title = "Chapter 1", body = "" } = {}) => `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>${title}</title></head>
  <body>${body}</body>
</html>`;

const makeTurndownService = (handler) =>
  class TurndownService {
    constructor(options) {
      this.options = options;
    }
    turndown(html) {
      return handler(html);
    }
  };

beforeEach(() => {
  vi.clearAllMocks();
  docCounter = 0;

  baseAdapterMocks.buildParsedDocument.mockReset();
  baseAdapterMocks.buildParsedDocument.mockImplementation((params = {}) => {
    docCounter += 1;
    const assets = Array.isArray(params.assets) ? params.assets : [];
    return {
      docId: params.docId || `doc_${docCounter}`,
      sourceType: params.sourceType,
      origin: params.origin,
      markdown: params.markdown,
      assets,
      metadata: params.metadata,
      parseInfo: params.parseInfo,
    };
  });

  extractAssetsFromMarkdownMock.mockReset();
  extractAssetsFromMarkdownMock.mockImplementation(defaultExtractAssetsFromMarkdown);

  nodeIoMocks.basenameOfPath.mockReset();
  nodeIoMocks.basenameOfPath.mockImplementation(async (path) => defaultBasenameOfPath(path));
  nodeIoMocks.fileLikeFromPath.mockReset();
  nodeIoMocks.fileLikeFromPath.mockImplementation(async (path, { mimeType } = {}) =>
    makeFileLike({ name: defaultBasenameOfPath(path), type: mimeType, size: 1, byteLength: 1 })
  );

  sharedMocks.isPlainObject.mockReset();
  sharedMocks.isPlainObject.mockImplementation(defaultIsPlainObject);
  sharedMocks.toNonEmptyString.mockReset();
  sharedMocks.toNonEmptyString.mockImplementation(defaultToNonEmptyString);

  jszipMocks.loadAsync.mockReset();
  jszipMocks.loadAsync.mockResolvedValue(makeZip({}));

  turndownMockControl.defaultExportMode = "function";
  turndownMocks.ctor.mockReset();
  turndownMocks.turndown.mockReset();
  turndownMocks.turndown.mockImplementation((html) => String(html || ""));

  globalThis.TurndownService = undefined;
});

describe("EpubAdapter", () => {
  it("normalizes option values including strings and Infinity", () => {
    const adapter = new EpubAdapter({
      maxFileSize: "1024.9",
      maxUncompressedBytes: Infinity,
      maxZipEntries: Number.MAX_SAFE_INTEGER,
      maxCompressionRatio: "2.5",
    });

    expect(adapter.maxFileSize).toBe(1024);
    expect(adapter.maxUncompressedBytes).toBe(Infinity);
    expect(adapter.maxZipEntries).toBe(Number.MAX_SAFE_INTEGER);
    expect(adapter.maxCompressionRatio).toBe(2.5);
  });

  it("falls back to default limits for invalid values (0/-1/empty)", () => {
    const adapter = new EpubAdapter({
      maxFileSize: 0,
      maxUncompressedBytes: -1,
      maxZipEntries: "0",
      maxCompressionRatio: {},
    });

    expect(adapter.maxFileSize).toBe(DEFAULT_MAX_FILE_SIZE);
    expect(adapter.maxUncompressedBytes).toBe(DEFAULT_MAX_UNCOMPRESSED_BYTES);
    expect(adapter.maxZipEntries).toBe(DEFAULT_MAX_ZIP_ENTRIES);
    expect(adapter.maxCompressionRatio).toBe(DEFAULT_MAX_COMPRESSION_RATIO);
  });

  it("rejects invalid input types (null/undefined/number)", async () => {
    const adapter = new EpubAdapter();
    const invalid = [null, undefined, 123];

    for (const input of invalid) {
      await expect(adapter.parse(input)).rejects.toThrow(/input must be a path string or a file-like object/i);
    }
  });

  it("rejects file-like inputs missing arrayBuffer (empty object/array)", async () => {
    const adapter = new EpubAdapter();

    await expect(adapter.parse({})).rejects.toThrow(/missing arrayBuffer/i);
    await expect(adapter.parse([])).rejects.toThrow(/missing arrayBuffer/i);
  });

  it("rejects path inputs when allowPathRead is false (empty/whitespace string)", async () => {
    const adapter = new EpubAdapter();
    const paths = ["", "   ", "book.epub"];

    for (const path of paths) {
      await expect(adapter.parse(path)).rejects.toThrow(/path string inputs are disabled/i);
    }

    expect(nodeIoMocks.basenameOfPath).toHaveBeenCalledTimes(paths.length);
    expect(nodeIoMocks.fileLikeFromPath).not.toHaveBeenCalled();
  });

  it("throws when declared size exceeds maxFileSize", async () => {
    const adapter = new EpubAdapter({ maxFileSize: 10 });
    const file = makeFileLike({ size: Number.MAX_SAFE_INTEGER, byteLength: 1 });

    await expect(adapter.parse(file)).rejects.toThrow(/file too large/i);
    expect(file.arrayBuffer).not.toHaveBeenCalled();
  });

  it("throws when arrayBuffer byteLength exceeds maxFileSize", async () => {
    const adapter = new EpubAdapter({ maxFileSize: 5 });
    const file = makeFileLike({ size: undefined, byteLength: 6 });
    const TurndownService = makeTurndownService(() => "");

    await expect(adapter.parse(file, { TurndownService })).rejects.toThrow(/file too large/i);
    expect(file.arrayBuffer).toHaveBeenCalledTimes(1);
    expect(jszipMocks.loadAsync).not.toHaveBeenCalled();
  });

  it("parses file-like input, resolves deep paths, and extracts images", async () => {
    const longText = "A".repeat(10000);
    const opfPath = "OEBPS/OPS/content.opf";
    const chapterHref = "../text/ch1.xhtml";
    const chapterPath = "OEBPS/text/ch1.xhtml";
    const chapterHtml = makeXhtml({
      title: "Deep Chapter",
      body: `<p>${longText}</p><img src="../images/pic.png" /><img src="data:image/jpeg;base64,AAAABBBB" />`,
    });

    jszipMocks.loadAsync.mockResolvedValue(
      makeZip({
        "META-INF/container.xml": { text: makeContainerXml(opfPath) },
        [opfPath]: { text: makeOpfXml({ chapterHref }) },
        [chapterPath]: { text: chapterHtml },
        "OEBPS/images/pic.png": { base64: "PICBASE64" },
      })
    );

    const turndownImpl = vi.fn((inputHtml) => {
      expect(inputHtml).toContain('src="images/epub_img_1.png"');
      expect(inputHtml).toContain('src="images/epub_img_2.jpg"');
      expect(inputHtml).not.toContain("data:image");
      return inputHtml.replace(/<[^>]+>/g, "");
    });
    const TurndownService = makeTurndownService(turndownImpl);

    const adapter = new EpubAdapter();
    const file = makeFileLike({ name: "book.epub", size: 10, byteLength: 10 });
    const doc = await adapter.parse(file, { TurndownService });

    expect(turndownImpl).toHaveBeenCalledTimes(1);
    expect(doc.sourceType).toBe(SourceKind.EPUB);
    expect(doc.metadata.chapterCount).toBe(1);
    expect(doc.chapters).toHaveLength(1);
    expect(doc.chapters[0].title).toBe("Deep Chapter");
    expect(doc.chapters[0].path).toBe("OEBPS/text/ch1.xhtml");
    expect(doc.markdown).toContain("# book.epub");
    expect(doc.markdown).toContain("## Deep Chapter");
    expect(doc.markdown.length).toBeGreaterThan(longText.length);

    expect(extractAssetsFromMarkdownMock).toHaveBeenCalledTimes(1);
    const [, imagesArg] = extractAssetsFromMarkdownMock.mock.calls[0];
    expect(imagesArg).toHaveLength(2);
    expect(imagesArg).toEqual(
      expect.arrayContaining([
        { id: "epub_img_1.png", data: "PICBASE64" },
        { id: "epub_img_2.jpg", data: "AAAABBBB" },
      ])
    );

    expect(doc.assets).toHaveLength(2);
    expect(doc.assets.some((asset) => asset.id.endsWith(".jpg") && asset.mimeType === "image/jpeg")).toBe(true);
    expect(doc.assets.every((asset) => asset.source === "extracted")).toBe(true);
    expect(doc.assets.every((asset) => asset.docId === doc.docId)).toBe(true);
  });

  it("extracts embedded data URI images from markdown output", async () => {
    const opfPath = "OEBPS/content.opf";
    const chapterHref = "chapter1.xhtml";
    const chapterPath = "OEBPS/chapter1.xhtml";
    const chapterHtml = makeXhtml({ title: "Inline Chapter", body: "<p>Inline</p>" });

    jszipMocks.loadAsync.mockResolvedValue(
      makeZip({
        "META-INF/container.xml": { text: makeContainerXml(opfPath) },
        [opfPath]: { text: makeOpfXml({ chapterHref }) },
        [chapterPath]: { text: chapterHtml },
      })
    );

    const turndownImpl = vi.fn(() => "![inline](data:image/png;base64,INLINE)");
    const TurndownService = makeTurndownService(turndownImpl);

    const adapter = new EpubAdapter();
    const file = makeFileLike({ name: "inline.epub", size: 5, byteLength: 5 });
    const doc = await adapter.parse(file, { TurndownService });

    const [, imagesArg] = extractAssetsFromMarkdownMock.mock.calls[0];
    expect(imagesArg).toEqual([{ id: "epub_extracted_1.png", data: "INLINE" }]);
    expect(doc.assets).toHaveLength(1);
    expect(doc.assets[0].data).toBe("INLINE");
    expect(doc.markdown).toContain("images/epub_extracted_1.png");
    expect(doc.markdown).not.toContain("data:image/");
  });

  it("parses path input with allowPathRead and uses node-io helpers", async () => {
    const opfPath = "OEBPS/content.opf";
    const chapterHref = "chapter1.xhtml";
    const chapterPath = "OEBPS/chapter1.xhtml";
    const chapterHtml = makeXhtml({ title: "Path Chapter", body: "<p>Body</p>" });

    jszipMocks.loadAsync.mockResolvedValue(
      makeZip({
        "META-INF/container.xml": { text: makeContainerXml(opfPath) },
        [opfPath]: { text: makeOpfXml({ chapterHref }) },
        [chapterPath]: { text: chapterHtml },
      })
    );

    const fileLike = makeFileLike({ name: "book.epub", size: 7, byteLength: 7 });
    nodeIoMocks.basenameOfPath.mockResolvedValueOnce("book.epub");
    nodeIoMocks.fileLikeFromPath.mockResolvedValueOnce(fileLike);

    const TurndownService = makeTurndownService(() => "Body");
    const adapter = new EpubAdapter();
    const doc = await adapter.parse("/tmp/book.epub", { allowPathRead: true, TurndownService });

    expect(nodeIoMocks.basenameOfPath).toHaveBeenCalledWith("/tmp/book.epub");
    expect(nodeIoMocks.fileLikeFromPath).toHaveBeenCalledWith(
      "/tmp/book.epub",
      expect.objectContaining({ maxBytes: DEFAULT_MAX_FILE_SIZE, mimeType: "application/epub+zip" })
    );
    expect(doc.origin.filename).toBe("book.epub");
    expect(doc.origin.mimeType).toBe("application/epub+zip");
    expect(doc.origin.size).toBe(fileLike.size);
  });

  it("rejects when TurndownService is unavailable", async () => {
    turndownMockControl.defaultExportMode = "object";

    const adapter = new EpubAdapter();
    const file = makeFileLike({ size: 1, byteLength: 1 });

    await expect(adapter.parse(file, {})).rejects.toThrow(/invalid EPUB \(missing OPF\)/i);
  });

  it("rejects when JSZip is missing", async () => {
    const originalLoadAsync = jszipMocks.loadAsync;
    jszipMocks.loadAsync = undefined;

    try {
      const adapter = new EpubAdapter();
      const file = makeFileLike({ size: 1, byteLength: 1 });
      const TurndownService = makeTurndownService(() => "");

      await expect(adapter.parse(file, { TurndownService })).rejects.toThrow(/JSZip is required/i);
    } finally {
      jszipMocks.loadAsync = originalLoadAsync;
    }
  });

  it("throws when OPF is missing from the zip", async () => {
    jszipMocks.loadAsync.mockResolvedValue(
      makeZip({
        "META-INF/container.xml": { text: "" },
        "misc.txt": { text: "noop" },
      })
    );

    const adapter = new EpubAdapter();
    const file = makeFileLike({ size: 1, byteLength: 1 });
    const TurndownService = makeTurndownService(() => "");

    await expect(adapter.parse(file, { TurndownService })).rejects.toThrow(/missing OPF/i);
  });

  it("throws when OPF file contents are missing", async () => {
    const opfPath = "OEBPS/content.opf";
    const chapterPath = "OEBPS/chapter1.xhtml";

    jszipMocks.loadAsync.mockResolvedValue(
      makeZip({
        "META-INF/container.xml": { text: makeContainerXml(opfPath) },
        [chapterPath]: { text: makeXhtml({ title: "Missing OPF", body: "Body" }) },
      })
    );

    const adapter = new EpubAdapter();
    const file = makeFileLike({ size: 1, byteLength: 1 });
    const TurndownService = makeTurndownService(() => "");

    await expect(adapter.parse(file, { TurndownService })).rejects.toThrow(/missing OEBPS\/content\.opf/i);
  });

  it("enforces zip entry count limit", async () => {
    const adapter = new EpubAdapter({ maxZipEntries: 2 });
    const opfPath = "OEBPS/content.opf";
    const chapterPath = "OEBPS/chapter1.xhtml";

    jszipMocks.loadAsync.mockResolvedValue(
      makeZip({
        "META-INF/container.xml": { text: makeContainerXml(opfPath) },
        [opfPath]: { text: makeOpfXml({ chapterHref: "chapter1.xhtml" }) },
        [chapterPath]: { text: makeXhtml({ title: "Too Many", body: "Body" }) },
      })
    );

    const file = makeFileLike({ size: 1, byteLength: 1 });
    const TurndownService = makeTurndownService(() => "");

    await expect(adapter.parse(file, { TurndownService })).rejects.toThrow(/zip entry count/i);
  });

  it("enforces zip uncompressed byte limit", async () => {
    const adapter = new EpubAdapter({ maxUncompressedBytes: 50 });
    const opfPath = "OEBPS/content.opf";
    const chapterPath = "OEBPS/chapter1.xhtml";

    jszipMocks.loadAsync.mockResolvedValue(
      makeZip({
        "META-INF/container.xml": { text: makeContainerXml(opfPath), uncompressedSize: 30, compressedSize: 30 },
        [opfPath]: { text: makeOpfXml({ chapterHref: "chapter1.xhtml" }), uncompressedSize: 30, compressedSize: 30 },
        [chapterPath]: { text: makeXhtml({ title: "Big", body: "Body" }), uncompressedSize: 30, compressedSize: 30 },
      })
    );

    const file = makeFileLike({ size: 1, byteLength: 1 });
    const TurndownService = makeTurndownService(() => "");

    await expect(adapter.parse(file, { TurndownService })).rejects.toThrow(/zip uncompressed bytes/i);
  });

  it("enforces zip compression ratio limit", async () => {
    const adapter = new EpubAdapter({ maxCompressionRatio: 5, maxUncompressedBytes: DEFAULT_MAX_UNCOMPRESSED_BYTES });
    const opfPath = "OEBPS/content.opf";
    const chapterPath = "OEBPS/chapter1.xhtml";

    jszipMocks.loadAsync.mockResolvedValue(
      makeZip({
        "META-INF/container.xml": { text: makeContainerXml(opfPath), uncompressedSize: 100, compressedSize: 1 },
        [opfPath]: { text: makeOpfXml({ chapterHref: "chapter1.xhtml" }), uncompressedSize: 10, compressedSize: 10 },
        [chapterPath]: { text: makeXhtml({ title: "Ratio", body: "Body" }), uncompressedSize: 10, compressedSize: 10 },
      })
    );

    const file = makeFileLike({ size: 1, byteLength: 1 });
    const TurndownService = makeTurndownService(() => "");

    await expect(adapter.parse(file, { TurndownService })).rejects.toThrow(/zip compression ratio/i);
  });

  it("handles concurrent and rapid consecutive parses without shared state", async () => {
    const opfPath = "OEBPS/content.opf";
    const chapterHref = "chapter1.xhtml";
    const chapterPath = "OEBPS/chapter1.xhtml";

    const jszipActual = await vi.importActual("jszip");
    const JSZipActual = jszipActual.default || jszipActual;
    const zipBuilder = new JSZipActual();
    zipBuilder.file("META-INF/container.xml", makeContainerXml(opfPath));
    zipBuilder.file(opfPath, makeOpfXml({ chapterHref }));
    zipBuilder.file(chapterPath, makeXhtml({ title: "Concurrent", body: "<p>Body</p>" }));
    const validBuffer = await zipBuilder.generateAsync({ type: "arraybuffer" });

    const buildZip = () =>
      makeZip({
        "META-INF/container.xml": { text: makeContainerXml(opfPath) },
        [opfPath]: { text: makeOpfXml({ chapterHref }) },
        [chapterPath]: { text: makeXhtml({ title: "Concurrent", body: "<p>Body</p>" }) },
      });

    jszipMocks.loadAsync.mockImplementation(async () => buildZip());

    const TurndownService = makeTurndownService(() => "Body");
    const adapter = new EpubAdapter();

    const makeInput = (name) => makeFileLike({ name, size: validBuffer.byteLength, buffer: validBuffer });

    const [docA, docB] = await Promise.all([
      adapter.parse(makeInput("a.epub"), { TurndownService }),
      adapter.parse(makeInput("b.epub"), { TurndownService }),
    ]);

    expect(docA.markdown.startsWith("# a.epub")).toBe(true);
    expect(docB.markdown.startsWith("# b.epub")).toBe(true);

    const docC = await adapter.parse(makeInput("c.epub"), { TurndownService });
    expect(docC.markdown.startsWith("# c.epub")).toBe(true);
  });
});
