import { describe, it, expect, vi, beforeEach } from "vitest";

const DEFAULT_MAX_FILE_SIZE = 25 * 1024 * 1024;
const DEFAULT_MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const DEFAULT_MAX_ZIP_ENTRIES = 2000;
const DEFAULT_MAX_COMPRESSION_RATIO = 100;

let docCounter = 0;

vi.mock("../../../../../js/agents/ingest/adapters/base.js", () => {
  class BaseAdapter {
    constructor({ adapterName } = {}) {
      this.adapterName = adapterName || "base";
    }

    buildParsedDocument(params = {}) {
      docCounter += 1;
      return {
        docId: `doc_${docCounter}`,
        sourceType: params.sourceType,
        origin: params.origin,
        markdown: params.markdown,
        assets: Array.isArray(params.assets) ? params.assets : [],
        metadata: params.metadata,
        parseInfo: params.parseInfo,
      };
    }
  }

  return { BaseAdapter };
});

vi.mock("../../../../../js/agents/ingest/extract-assets.js", () => ({
  extractAssetsFromMarkdown: vi.fn(),
}));

vi.mock("../../../../../js/agents/ingest/constants.js", () => ({
  SourceKind: { PPTX: "pptx" },
}));

vi.mock("../../../../../js/agents/ingest/adapters/node-io.js", () => ({
  basenameOfPath: vi.fn(),
  fileLikeFromPath: vi.fn(),
  isNodeEnvironment: vi.fn(),
  readFileFromPath: vi.fn(),
}));

vi.mock("../../../../../js/agents/shared/index.js", () => ({
  toNonEmptyString: (v) => {
    if (v === undefined || v === null) return undefined;
    const s = String(v).trim();
    return s.length ? s : undefined;
  },
}));

vi.mock("jszip", () => ({
  ...(() => {
    const jszip = { loadAsync: vi.fn() };
    return { default: jszip, loadAsync: jszip.loadAsync };
  })(),
}));

const originalGlobalParser = globalThis.PPTXSlideParser;

const makeFileLike = ({
  name = "slides.pptx",
  filename,
  type,
  mimeType,
  size = 10,
  byteLength = 10,
} = {}) => ({
  name,
  filename,
  type,
  mimeType,
  size,
  arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(byteLength)),
});

const makeParser = (parsed) => ({
  parse: vi.fn(async () => parsed),
});

const makeZipEntry = (uncompressed, compressed, dir = false) => ({
  dir,
  _data: { uncompressedSize: uncompressed, compressedSize: compressed },
});

const makeZip = (files = {}) => ({ files });
const makeValidZipBuffer = async () => {
  const jszipActual = await vi.importActual("jszip");
  const JSZipActual = jszipActual.default || jszipActual;
  const zip = new JSZipActual();
  zip.file("ok.txt", "ok");
  return await zip.generateAsync({ type: "arraybuffer" });
};

describe("PptxAdapter", () => {
  let PptxAdapter;
  let extractAssetsFromMarkdown;
  let basenameOfPath;
  let fileLikeFromPath;
  let isNodeEnvironment;
  let readFileFromPath;
  let JSZip;

  beforeEach(async () => {
    vi.resetModules();
    docCounter = 0;
    ({ PptxAdapter } = await import("../../../../../js/agents/ingest/adapters/pptx.js"));
    ({ extractAssetsFromMarkdown } = await import("../../../../../js/agents/ingest/extract-assets.js"));
    ({ basenameOfPath, fileLikeFromPath, isNodeEnvironment, readFileFromPath } = await import("../../../../../js/agents/ingest/adapters/node-io.js"));
    {
      const jszipMod = await import("jszip");
      JSZip = jszipMod.default || jszipMod;
    }

    if (originalGlobalParser === undefined) {
      delete globalThis.PPTXSlideParser;
    } else {
      globalThis.PPTXSlideParser = originalGlobalParser;
    }

    vi.clearAllMocks();

    extractAssetsFromMarkdown.mockImplementation((markdown, images = []) => images.map((img) => ({ ...img })));
    basenameOfPath.mockResolvedValue("slides.pptx");
    fileLikeFromPath.mockResolvedValue(makeFileLike());
    isNodeEnvironment.mockReturnValue(true);
    readFileFromPath.mockResolvedValue("");
    if (!JSZip || (typeof JSZip !== "object" && typeof JSZip !== "function")) {
      JSZip = {};
    }
    JSZip.loadAsync = vi.fn().mockResolvedValue(makeZip({}));
  });

  it("normalizes option values including strings and Infinity", () => {
    const adapter = new PptxAdapter({
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

  it("falls back to default limits for invalid option values", () => {
    const adapter = new PptxAdapter({
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

  it("parses file-like input and builds markdown/assets/metadata", async () => {
    const adapter = new PptxAdapter();
    const slides = [
      {
        elements: [
          { role: "title", content: "Intro" },
          { text: "Bullet 1" },
          { content: "Bullet 2" },
          { type: "image", src: "data:image/png;base64,AAA" },
          { type: "image", src: "data:image/jpeg;base64,BBB" },
          { type: "image", src: "http://example.com/skip.png" },
        ],
      },
    ];
    const parser = makeParser({ slides, metadata: { slideCount: 9 } });
    const file = makeFileLike({ name: "Deck.pptx", size: 8, byteLength: 8 });

    JSZip.loadAsync.mockResolvedValue(
      makeZip({
        "ppt/slides/slide1.xml": makeZipEntry(4, 2),
        "ppt/media/image1.png": makeZipEntry(2, 2),
      }),
    );
    extractAssetsFromMarkdown.mockImplementation((markdown, images) => images.map((img) => ({ ...img, kind: "image" })));

    const doc = await adapter.parse(file, { pptxParser: parser });

    expect(parser.parse).toHaveBeenCalledTimes(1);
    expect(extractAssetsFromMarkdown).toHaveBeenCalledTimes(1);

    const [markdownArg, imagesArg] = extractAssetsFromMarkdown.mock.calls[0];
    expect(markdownArg).toContain("# Deck.pptx");
    expect(markdownArg).toContain("## Slide 1: Intro");
    expect(markdownArg).toContain("- Intro");
    expect(markdownArg).toContain("- Bullet 1");
    expect(markdownArg).toContain("- Bullet 2");
    expect(markdownArg).toContain("![](images/pptx_img_1.png)");
    expect(markdownArg).toContain("![](images/pptx_img_2.jpg)");

    expect(imagesArg).toEqual([
      { id: "pptx_img_1.png", data: "AAA" },
      { id: "pptx_img_2.jpg", data: "BBB" },
    ]);

    expect(doc.sourceType).toBe("pptx");
    expect(doc.origin).toEqual({
      filename: "Deck.pptx",
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      size: 8,
    });
    expect(doc.metadata).toEqual({ title: "Deck.pptx", slideCount: 9 });
    expect(doc.assets).toHaveLength(2);
    expect(doc.assets[0]).toEqual(
      expect.objectContaining({
        id: "pptx_img_1.png",
        data: "AAA",
        kind: "image",
        source: "extracted",
        docId: doc.docId,
      }),
    );
    expect(doc.assets[1]).toEqual(
      expect.objectContaining({
        id: "pptx_img_2.jpg",
        data: "BBB",
        kind: "image",
        source: "extracted",
        docId: doc.docId,
      }),
    );
    expect(doc.parseInfo).toEqual(expect.objectContaining({ adapter: "pptx" }));
    expect(doc.parseInfo.durationMs).toEqual(expect.any(Number));
  });

  it("handles non-array elements, deep nesting, and long strings with slide count fallback", async () => {
    const adapter = new PptxAdapter();
    const longText = "x".repeat(5000);
    const deepNested = { level1: { level2: { level3: "value" } } };
    const slides = [
      { elements: { not: "array" } },
      { elements: [{ content: deepNested }, { text: longText }] },
    ];
    const parser = makeParser({ slides });
    const file = makeFileLike({ name: "nested.pptx", size: 6, byteLength: 6 });

    const doc = await adapter.parse(file, { pptxParser: parser });

    expect(doc.metadata.slideCount).toBe(2);
    expect(doc.markdown).toContain("## Slide 2");
    expect(doc.markdown).toContain("[object Object]");
    expect(doc.markdown).toContain(longText);
  });

  it("prefers stageApi.pptxParser over global PPTXSlideParser", async () => {
    let constructed = false;
    globalThis.PPTXSlideParser = class {
      constructor() {
        constructed = true;
        this.parse = vi.fn(async () => ({ slides: [] }));
      }
    };

    const adapter = new PptxAdapter();
    const parser = makeParser({ slides: [] });
    const file = makeFileLike({ name: "deck.pptx", size: 4, byteLength: 4 });

    await adapter.parse(file, { pptxParser: parser });

    expect(parser.parse).toHaveBeenCalledTimes(1);
    expect(constructed).toBe(false);
  });

  it("uses global PPTXSlideParser when stageApi is missing", async () => {
    let instance;
    globalThis.PPTXSlideParser = class {
      constructor() {
        instance = this;
        this.parse = vi.fn(async () => ({ slides: [] }));
      }
    };

    const adapter = new PptxAdapter();
    const file = makeFileLike({ name: "global.pptx", size: 4, byteLength: 4 });

    await adapter.parse(file);

    expect(instance.parse).toHaveBeenCalledTimes(1);
  });

  it("throws when no parser is available in non-node environments", async () => {
    delete globalThis.PPTXSlideParser;
    isNodeEnvironment.mockReturnValue(false);
    const adapter = new PptxAdapter();
    const file = makeFileLike({ name: "missing.pptx", size: 4, byteLength: 4 });

    await expect(adapter.parse(file)).rejects.toThrow("loadPptxSlideParserFromScript requires Node.js");
  });

  it("reads path input when allowPathRead is true and uses node basename", async () => {
    basenameOfPath.mockResolvedValue("path-deck.pptx");
    fileLikeFromPath.mockResolvedValue(makeFileLike({ name: "path-deck.pptx", size: 12, byteLength: 12 }));

    const adapter = new PptxAdapter({ maxFileSize: 99 });
    const parser = makeParser({ slides: [] });

    const doc = await adapter.parse("/tmp/path-deck.pptx", { allowPathRead: true, pptxParser: parser });

    expect(basenameOfPath).toHaveBeenCalledWith("/tmp/path-deck.pptx");
    expect(fileLikeFromPath).toHaveBeenCalledWith("/tmp/path-deck.pptx", {
      maxBytes: adapter.maxFileSize,
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    });
    expect(doc.origin.filename).toBe("path-deck.pptx");
  });

  it("uses path splitting when not running in node environment", async () => {
    isNodeEnvironment.mockReturnValue(false);
    fileLikeFromPath.mockResolvedValue(makeFileLike({ name: "report.pptx", size: 12, byteLength: 12 }));

    const adapter = new PptxAdapter();
    const parser = makeParser({ slides: [] });

    const doc = await adapter.parse("C:\\dir\\report.pptx", { allowPathRead: true, pptxParser: parser });

    expect(basenameOfPath).not.toHaveBeenCalled();
    expect(doc.origin.filename).toBe("report.pptx");
  });

  it("rejects path input when allowPathRead is false (empty/whitespace)", async () => {
    const adapter = new PptxAdapter();

    await expect(adapter.parse("")).rejects.toThrow("path string inputs are disabled");
    await expect(adapter.parse("   ")).rejects.toThrow("path string inputs are disabled");
  });

  it("rejects non-string/non-object inputs including null/undefined/0/-1", async () => {
    const adapter = new PptxAdapter();

    for (const value of [null, undefined, 0, -1]) {
      await expect(adapter.parse(value)).rejects.toThrow(TypeError);
    }
  });

  it("rejects file-like inputs without arrayBuffer including empty object/array", async () => {
    const adapter = new PptxAdapter();

    for (const value of [{}, [], { arrayBuffer: "nope" }]) {
      await expect(adapter.parse(value)).rejects.toThrow("unsupported file-like input");
    }
  });

  it("enforces file size limits using the declared size", async () => {
    const adapter = new PptxAdapter({ maxFileSize: 10 });
    const file = makeFileLike({ name: "big.pptx", size: Number.MAX_SAFE_INTEGER, byteLength: 1 });

    await expect(adapter.parse(file)).rejects.toThrow("file too large");
  });

  it("enforces file size limits using arrayBuffer byteLength", async () => {
    const adapter = new PptxAdapter({ maxFileSize: 10 });
    const file = makeFileLike({ name: "big.pptx", size: 9, byteLength: 11 });
    const parser = makeParser({ slides: [] });

    await expect(adapter.parse(file, { pptxParser: parser })).rejects.toThrow("file too large");
  });

  it("throws when JSZip.loadAsync is missing", async () => {
    JSZip.loadAsync = undefined;
    const adapter = new PptxAdapter();
    const file = makeFileLike({ name: "zip.pptx", size: 4, byteLength: 4 });
    const parser = makeParser({ slides: [] });

    await expect(adapter.parse(file, { pptxParser: parser })).rejects.toThrow("JSZip is required");
  });

  it("enforces zip entry count limits", async () => {
    const adapter = new PptxAdapter({ maxZipEntries: 1 });
    JSZip.loadAsync.mockResolvedValue(
      makeZip({
        a: makeZipEntry(1, 1),
        b: makeZipEntry(1, 1),
      }),
    );
    const file = makeFileLike({ name: "zip.pptx", size: 4, byteLength: 4 });
    const parser = makeParser({ slides: [] });

    await expect(adapter.parse(file, { pptxParser: parser })).rejects.toThrow("zip entry count");
  });

  it("enforces zip uncompressed byte limits", async () => {
    const adapter = new PptxAdapter({ maxUncompressedBytes: 5 });
    JSZip.loadAsync.mockResolvedValue(
      makeZip({
        a: makeZipEntry(3, 3),
        b: makeZipEntry(4, 4),
      }),
    );
    const file = makeFileLike({ name: "zip.pptx", size: 4, byteLength: 4 });
    const parser = makeParser({ slides: [] });

    await expect(adapter.parse(file, { pptxParser: parser })).rejects.toThrow("zip uncompressed bytes");
  });

  it("enforces zip compression ratio limits", async () => {
    const adapter = new PptxAdapter({ maxCompressionRatio: 2 });
    JSZip.loadAsync.mockResolvedValue(
      makeZip({
        a: makeZipEntry(10, 1),
      }),
    );
    const file = makeFileLike({ name: "zip.pptx", size: 4, byteLength: 4 });
    const parser = makeParser({ slides: [] });

    await expect(adapter.parse(file, { pptxParser: parser })).rejects.toThrow("zip compression ratio");
  });

  it("handles concurrent parse calls with isolated image counters", async () => {
    const adapter = new PptxAdapter();
    const slides = [{ elements: [{ type: "image", src: "data:image/png;base64,AAA" }] }];
    const parser = makeParser({ slides });
    const fileA = makeFileLike({ name: "a.pptx", size: 4, byteLength: 4 });
    const fileB = makeFileLike({ name: "b.pptx", size: 4, byteLength: 4 });
    const zipBuffer = await makeValidZipBuffer();
    fileA.arrayBuffer.mockResolvedValue(zipBuffer);
    fileB.arrayBuffer.mockResolvedValue(zipBuffer);

    const [docA, docB] = await Promise.all([
      adapter.parse(fileA, { pptxParser: parser }),
      adapter.parse(fileB, { pptxParser: parser }),
    ]);

    expect(docA.assets[0].id).toBe("pptx_img_1.png");
    expect(docB.assets[0].id).toBe("pptx_img_1.png");
    expect(docA.docId).not.toBe(docB.docId);
  });

  it("handles rapid consecutive parse calls without leaking state", async () => {
    const adapter = new PptxAdapter();
    const slides = [{ elements: [{ type: "image", src: "data:image/png;base64,AAA" }] }];
    const parser = makeParser({ slides });
    const file = makeFileLike({ name: "seq.pptx", size: 4, byteLength: 4 });

    const first = await adapter.parse(file, { pptxParser: parser });
    const second = await adapter.parse(file, { pptxParser: parser });

    expect(first.assets[0].id).toBe("pptx_img_1.png");
    expect(second.assets[0].id).toBe("pptx_img_1.png");
    expect(first.docId).not.toBe(second.docId);
  });
});
