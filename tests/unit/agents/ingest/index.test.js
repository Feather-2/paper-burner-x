import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const jszipMocks = vi.hoisted(() => ({
  loadAsync: vi.fn(),
}));

vi.mock("jszip", () => ({
  default: { loadAsync: jszipMocks.loadAsync },
  loadAsync: jszipMocks.loadAsync,
}));

vi.mock("linkedom", () => {
  class MockElement {
    constructor(attrs = {}, text = "") {
      this._attrs = attrs;
      this.textContent = text;
    }
    getAttribute(name) {
      return this._attrs[name] ?? null;
    }
  }

  const parseAttrs = (tag) => {
    const attrs = {};
    const attrRe = /([\w:-]+)\s*=\s*"([^"]*)"/g;
    let m;
    while ((m = attrRe.exec(tag))) {
      attrs[m[1]] = m[2];
    }
    return attrs;
  };

  const selectAll = (xml, tagName) => {
    const re = new RegExp(`<${tagName}\\b[^>]*>`, "gi");
    const out = [];
    let m;
    while ((m = re.exec(xml))) {
      out.push(new MockElement(parseAttrs(m[0])));
    }
    return out;
  };

  return {
    DOMParser: class DOMParser {
      parseFromString(xmlText) {
        const xml = String(xmlText || "");
        return {
          querySelector(selector) {
            if (selector === "rootfile") {
              const match = /<rootfile\b[^>]*>/i.exec(xml);
              return match ? new MockElement(parseAttrs(match[0])) : null;
            }
            if (selector === "title") {
              const match = /<title[^>]*>([^<]*)<\/title>/i.exec(xml);
              return match ? new MockElement({}, match[1]) : null;
            }
            return null;
          },
          querySelectorAll(selector) {
            if (selector === "manifest > item") return selectAll(xml, "item");
            if (selector === "spine > itemref") return selectAll(xml, "itemref");
            return [];
          },
        };
      }
    },
  };
});

import {
  IngestStage,
  AssetManager,
  BaseAdapter,
  MarkdownAdapter,
  HistoryAdapter,
  RawTextAdapter,
  PdfAdapter,
  DocxAdapter,
  PptxAdapter,
  HtmlAdapter,
  EpubAdapter,
  AudioAdapter,
  VideoAdapter,
  CodeAdapter,
  extractAssetsFromMarkdown,
} from "../../../../js/agents/ingest/index.js";

const toArrayBuffer = (value) => {
  const buf = Buffer.from(String(value ?? ""), "utf8");
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
};

const makeArrayBufferFile = ({ name = "file", type, size, buffer } = {}) => ({
  name,
  type,
  size,
  arrayBuffer: vi.fn().mockResolvedValue(buffer ?? new ArrayBuffer(0)),
});

const makeTextFile = ({ name = "file.txt", type, size, text } = {}) => ({
  name,
  type,
  size,
  text: vi.fn().mockResolvedValue(text ?? ""),
});

const makeDeferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const collect = async (iterable) => {
  const out = [];
  for await (const item of iterable) out.push(item);
  return out;
};

const makeZipEntry = ({ text = "", base64 = "", uncompressedSize, compressedSize, dir = false } = {}) => {
  const textSize = typeof text === "string" ? text.length : 0;
  const base64Size = typeof base64 === "string" ? base64.length : 0;
  const uncompressed = Number.isFinite(uncompressedSize) ? uncompressedSize : Math.max(1, textSize, base64Size);
  const compressed = Number.isFinite(compressedSize) ? compressedSize : Math.max(1, Math.floor(uncompressed / 2));
  return {
    dir,
    _data: { uncompressedSize: uncompressed, compressedSize: compressed },
    async: async (type) => {
      if (type === "base64") return base64;
      return text;
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

const makeTurndownService = (markdown) =>
  class TurndownService {
    turndown() {
      return markdown;
    }
  };

const makeParsedDoc = ({ docId, text, sourceType = "user_text", metadata = {}, origin = {} } = {}) => ({
  docId,
  sourceType,
  markdown: String(text ?? ""),
  textNormalized: String(text ?? "").toLowerCase(),
  textHash: `hash_${docId}`,
  toc: [],
  chunks: [],
  assets: [],
  metadata,
  origin,
  parseInfo: { adapter: "stub", durationMs: 0 },
});

const originalOcrManager = globalThis.OcrManager;

beforeEach(() => {
  vi.clearAllMocks();
  jszipMocks.loadAsync.mockReset();
});

afterEach(() => {
  if (originalOcrManager === undefined) {
    delete globalThis.OcrManager;
  } else {
    globalThis.OcrManager = originalOcrManager;
  }
});

describe("IngestStage", () => {
  it("returns empty output for empty inputs", async () => {
    const stage = new IngestStage();
    const result = await stage.execute(
      { runId: "run-empty" },
      { input: { files: null, urls: undefined, historyIds: [], rawTexts: [] }, config: { persist: false, resume: false } },
    );

    expect(result.sources).toEqual([]);
    expect(result.parseErrors).toEqual([]);
    expect(result.metrics.totalDocs).toBe(0);
    expect(result.metrics.successDocs).toBe(0);
    expect(result.metrics.failedDocs).toBe(0);
  });

  it("processes raw texts with concurrency and preserves deep metadata", async () => {
    const stage = new IngestStage();
    const rawTexts = ["alpha", "beta", "x".repeat(10000)];
    const deepMeta = { level1: { level2: { value: "deep" } } };

    const gates = rawTexts.map(() => makeDeferred());
    let callIndex = 0;
    let inFlight = 0;
    let maxInFlight = 0;

    const rawTextAdapter = {
      parse: vi.fn(async (input) => {
        const idx = callIndex++;
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await gates[idx].promise;
        inFlight -= 1;
        return makeParsedDoc({
          docId: `doc_${idx}`,
          text: input,
          metadata: { title: `Doc ${idx}`, ...(idx === 0 ? { nested: deepMeta } : {}) },
          origin: { title: `Doc ${idx}` },
        });
      }),
    };

    const execPromise = stage.execute(
      { runId: "run-concurrent" },
      {
        input: { rawTexts },
        config: {
          maxConcurrentDocs: "2",
          persist: false,
          resume: false,
          adapters: { rawText: rawTextAdapter },
        },
      },
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(maxInFlight).toBeGreaterThan(1);

    gates.forEach((gate) => gate.resolve());
    const result = await execPromise;

    expect(result.metrics.successDocs).toBe(3);
    expect(result.sources).toHaveLength(3);
    expect(rawTextAdapter.parse).toHaveBeenCalledWith(
      rawTexts[2],
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        checkCancelled: expect.any(Function),
      }),
    );
    const withNested = result.sources.find((source) => source.metadata?.nested);
    expect(withNested.metadata.nested.level1.level2.value).toBe("deep");
  });

  it("sanitizes adapter errors and handles empty URLs", async () => {
    const stage = new IngestStage();
    const rawTextAdapter = {
      parse: vi.fn(async () => {
        throw new Error(` boom \n ${"x".repeat(300)} `);
      }),
    };

    const result = await stage.execute(
      { runId: "run-errors" },
      {
        input: { rawTexts: ["bad"], urls: [""] },
        config: { persist: false, resume: false, adapters: { rawText: rawTextAdapter } },
      },
    );

    expect(result.parseErrors).toHaveLength(2);
    const rawErr = result.parseErrors.find((e) => e.origin.startsWith("raw:"));
    const urlErr = result.parseErrors.find((e) => e.origin.startsWith("url:"));
    expect(rawErr.error).toMatch(/boom/);
    expect(rawErr.error.length).toBeLessThanOrEqual(200);
    expect(urlErr.error).toBe("URL is empty");
    expect(result.metrics.failedDocs).toBe(2);
  });
});

describe("AssetManager", () => {
  it("deduplicates assets and returns stored data", () => {
    const manager = new AssetManager();
    const data = "data:image/png;base64,AAAA";
    const asset = { docId: "doc1", type: "image", data, mimeType: "image/png" };

    const id1 = manager.addAsset(asset);
    const id2 = manager.addAsset({ ...asset });

    expect(id2).toBe(id1);
    expect(manager.count()).toBe(1);
    expect(manager.getAssetIdsForDoc("doc1")).toContain(id1);
    const stored = manager.getAsset(id1);
    expect(stored.data).toBe(data);
  });

  it("rejects invalid inputs and handles empty lookups", () => {
    const manager = new AssetManager();
    expect(() => manager.addAsset(null)).toThrow(TypeError);
    expect(() => manager.addAsset(undefined)).toThrow(TypeError);
    expect(() => manager.addAsset({})).toThrow(Error);
    expect(() => manager.addAssets({})).toThrow(TypeError);
    expect(manager.getAsset("")).toBe(null);
    expect(manager.getAssetIdsForDoc("")).toEqual([]);
  });

  it("stores large base64 payloads and accepts numeric docId", () => {
    const manager = new AssetManager();
    const base64 = Buffer.alloc(4096, 7).toString("base64");
    const id = manager.addAsset({ docId: 0, type: "image", data: base64, mimeType: "image/png" });

    const stored = manager.getAsset(id);
    expect(stored.data).toBe(base64);
    expect(manager.getAssetIdsForDoc("0")).toContain(id);
  });
});

describe("BaseAdapter", () => {
  it("chunks text streams with locators", async () => {
    const adapter = new BaseAdapter({ defaultChunkOptions: { chunkSize: 3, overlap: 0, includeLineNumbers: false } });
    const chunks = await collect(adapter.parseStream(["abcdef"], { chunkOptions: { chunkSize: 3, overlap: 0, includeLineNumbers: false } }));

    expect(chunks).toHaveLength(2);
    expect(chunks[0].text).toBe("abc");
    expect(chunks[0].locator).toEqual({ charStart: 0, charEnd: 3 });
    expect(chunks[1].text).toBe("def");
    expect(chunks[1].locator).toEqual({ charStart: 3, charEnd: 6 });
  });

  it("throws on invalid options and overlap boundaries", async () => {
    const adapter = new BaseAdapter();
    await expect(collect(adapter.parseStream(["x"], "bad"))).rejects.toThrow("options must be an object");
    await expect(collect(adapter.parseStream(["x"], { chunkOptions: { chunkSize: 2, overlap: 2 } }))).rejects.toThrow(
      "overlap must be < chunkSize",
    );
  });
});

describe("MarkdownAdapter", () => {
  it("parses file-like text input", async () => {
    const adapter = new MarkdownAdapter();
    const file = makeTextFile({ name: "README.md", text: "# Title" });
    const parsed = await adapter.parse(file);

    expect(parsed.markdown).toBe("# Title");
    expect(parsed.origin.filename).toBe("README.md");
    expect(parsed.metadata.title).toBe("README.md");
    expect(parsed.sourceType).toBe("markdown");
  });

  it("accepts empty content", async () => {
    const adapter = new MarkdownAdapter();
    const parsed = await adapter.parse({ name: "empty.md", content: "" });
    expect(parsed.markdown).toBe("");
  });

  it("rejects path inputs without allowPathRead and invalid file-like objects", async () => {
    const adapter = new MarkdownAdapter();
    await expect(adapter.parse("docs/readme.md")).rejects.toThrow("path string inputs are disabled");
    await expect(adapter.parse({ name: "x.md" })).rejects.toThrow("unsupported file-like input");
  });
});

describe("HistoryAdapter", () => {
  it("parses history records and assigns asset docIds", async () => {
    const storageAdapter = {
      getResultFromDB: vi.fn(async (hid) => ({
        translation: "# Doc",
        name: "Doc",
        fileType: "markdown",
        images: [{ id: "img1.png", data: "data:image/png;base64,AAAA" }],
      })),
    };
    const adapter = new HistoryAdapter(storageAdapter);
    const parsed = await adapter.parse(0);

    expect(storageAdapter.getResultFromDB).toHaveBeenCalledWith("0");
    expect(parsed.metadata.historyId).toBe("0");
    expect(parsed.assets).toHaveLength(1);
    expect(parsed.assets[0].docId).toBe(parsed.docId);
  });

  it("throws on missing historyId or storage adapter", async () => {
    const adapter = new HistoryAdapter(null);
    await expect(adapter.parse(null)).rejects.toThrow(TypeError);
    await expect(adapter.parse("id")).rejects.toThrow("storageAdapter");
  });

  it("throws when history record lacks text", async () => {
    const storageAdapter = { getResult: vi.fn(async () => ({ name: "Doc" })) };
    const adapter = new HistoryAdapter(storageAdapter);
    await expect(adapter.parse("missing-text")).rejects.toThrow("missing markdown/ocr");
  });
});

describe("RawTextAdapter", () => {
  it("parses string input with default title", async () => {
    const adapter = new RawTextAdapter();
    const parsed = await adapter.parse("Hello");
    expect(parsed.markdown).toBe("Hello");
    expect(parsed.metadata.title).toBe("User Input");
  });

  it("rejects blank strings and handles numeric text", async () => {
    const adapter = new RawTextAdapter();
    await expect(adapter.parse("   ")).rejects.toThrow("input.text is required");
    const parsed = await adapter.parse({ text: -1 });
    expect(parsed.markdown).toBe("-1");
  });
});

describe("PdfAdapter", () => {
  it("falls back to embedded text extraction without OCR", async () => {
    const adapter = new PdfAdapter();
    const file = makeArrayBufferFile({
      name: "scan.pdf",
      type: "application/pdf",
      size: 10,
      buffer: toArrayBuffer("Hello World"),
    });
    globalThis.OcrManager = undefined;

    const parsed = await adapter.parse(file);
    expect(parsed.markdown).toContain("scan.pdf");
    expect(parsed.markdown).toContain("Hello World");
    expect(parsed.metadata.engine).toBe("fallback");
  });

  it("throws on invalid input types and oversized files", async () => {
    const adapter = new PdfAdapter({ maxFileSize: 1 });
    await expect(adapter.parse(null)).rejects.toThrow(TypeError);
    await expect(adapter.parse({ name: "x.pdf" })).rejects.toThrow("unsupported file-like input");
    await expect(adapter.parse(makeArrayBufferFile({ name: "big.pdf", size: 2, buffer: new ArrayBuffer(2) }))).rejects.toThrow(
      "file too large",
    );
  });
});

describe("DocxAdapter", () => {
  it("parses file-like input with injected mammoth and TurndownService", async () => {
    const adapter = new DocxAdapter();
    const file = makeArrayBufferFile({
      name: "doc.docx",
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: 4,
      buffer: new ArrayBuffer(8),
    });
    jszipMocks.loadAsync.mockResolvedValue(makeZip({ "word/document.xml": { text: "x" } }));

    const mammoth = {
      images: { imgElement: (fn) => fn },
      convertToHtml: vi.fn(async () => ({ value: "<p>Doc</p>", messages: [{ message: "warn1" }] })),
    };
    const TurndownService = makeTurndownService("![img](data:image/png;base64,AAAA)");

    const parsed = await adapter.parse(file, { mammoth, TurndownService });
    expect(parsed.assets).toHaveLength(1);
    expect(parsed.assets[0].docId).toBe(parsed.docId);
    expect(parsed.parseInfo.warnings).toContain("warn1");
  });

  it("rejects invalid inputs and enforces max file size", async () => {
    const adapter = new DocxAdapter({ maxFileSize: 1 });
    await expect(adapter.parse({ name: "x.docx" })).rejects.toThrow("unsupported file-like input");
    await expect(adapter.parse(makeArrayBufferFile({ name: "big.docx", size: 2, buffer: new ArrayBuffer(2) }))).rejects.toThrow(
      "file too large",
    );
  });
});

describe("PptxAdapter", () => {
  it("parses slides and extracts image assets", async () => {
    const adapter = new PptxAdapter();
    const file = makeArrayBufferFile({
      name: "slides.pptx",
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      size: 4,
      buffer: new ArrayBuffer(8),
    });
    jszipMocks.loadAsync.mockResolvedValue(makeZip({ "ppt/presentation.xml": { text: "x" } }));

    const pptxParser = {
      parse: vi.fn(async () => ({
        slides: [
          {
            elements: [
              { role: "title", text: "Intro" },
              { text: "Point" },
              { type: "image", src: "data:image/png;base64,AAAA" },
            ],
          },
        ],
        metadata: { slideCount: 1 },
      })),
    };

    const parsed = await adapter.parse(file, { pptxParser });
    expect(parsed.metadata.slideCount).toBe(1);
    expect(parsed.assets).toHaveLength(1);
    expect(parsed.assets[0].docId).toBe(parsed.docId);
    expect(parsed.markdown).toContain("Slide 1");
  });

  it("rejects invalid inputs and oversized files", async () => {
    const adapter = new PptxAdapter({ maxFileSize: 1 });
    await expect(adapter.parse({ name: "x.pptx" })).rejects.toThrow("unsupported file-like input");
    await expect(adapter.parse(makeArrayBufferFile({ name: "big.pptx", size: 2, buffer: new ArrayBuffer(2) }))).rejects.toThrow(
      "file too large",
    );
  });
});

describe("HtmlAdapter", () => {
  it("parses HTML content and extracts data URI images", async () => {
    const adapter = new HtmlAdapter();
    const TurndownService = makeTurndownService("![img](images/html_img_1.png)");
    const parsed = await adapter.parse(
      { name: "page.html", content: '<img src="data:image/png;base64,AAAA" />' },
      { TurndownService },
    );

    expect(parsed.assets).toHaveLength(1);
    expect(parsed.assets[0].docId).toBe(parsed.docId);
    expect(parsed.origin.filename).toBe("page.html");
  });

  it("accepts empty content and enforces size limits", async () => {
    const adapter = new HtmlAdapter({ maxFileSize: 1 });
    const emptyParsed = await adapter.parse({ name: "empty.html", content: "" }, { TurndownService: makeTurndownService("") });
    expect(emptyParsed.markdown).toBe("");

    await expect(
      adapter.parse({ name: "big.html", size: 2, content: "<p>hi</p>" }, { TurndownService: makeTurndownService("x") }),
    ).rejects.toThrow("file too large");
  });

  it("rejects invalid inputs", async () => {
    const adapter = new HtmlAdapter();
    await expect(adapter.parse(null)).rejects.toThrow(TypeError);
  });
});

describe("EpubAdapter", () => {
  it("parses EPUB chapters and assets", async () => {
    const adapter = new EpubAdapter();
    const TurndownService = makeTurndownService("![img](images/epub_img_1.png)");

    const containerXml = `<?xml version="1.0"?><container><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>`;
    const opfXml = `<?xml version="1.0"?><package><manifest><item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>`;
    const xhtml = `<?xml version="1.0"?><html><head><title>Chap 1</title></head><body><img src="images/pic.png"/></body></html>`;

    jszipMocks.loadAsync.mockResolvedValue(
      makeZip({
        "META-INF/container.xml": { text: containerXml },
        "content.opf": { text: opfXml },
        "chapter1.xhtml": { text: xhtml },
        "images/pic.png": { base64: "AAAA" },
      }),
    );

    const file = makeArrayBufferFile({ name: "book.epub", size: 8, buffer: new ArrayBuffer(8) });
    const parsed = await adapter.parse(file, { TurndownService });

    expect(parsed.chapters).toHaveLength(1);
    expect(parsed.metadata.chapterCount).toBe(1);
    expect(parsed.assets).toHaveLength(1);
    expect(parsed.assets[0].docId).toBe(parsed.docId);
  });

  it("rejects invalid inputs and oversized files", async () => {
    const adapter = new EpubAdapter({ maxFileSize: 1 });
    await expect(adapter.parse(null)).rejects.toThrow(TypeError);
    await expect(adapter.parse(makeArrayBufferFile({ name: "big.epub", size: 2, buffer: new ArrayBuffer(2) }))).rejects.toThrow(
      "file too large",
    );
  });
});

describe("AudioAdapter", () => {
  it("transcribes audio and builds LRC output", async () => {
    const adapter = new AudioAdapter();
    const whisperApi = {
      transcribe: vi.fn(async () => ({
        text: "",
        segments: [
          { text: "Hello", start_ms: 0, end_ms: 1000 },
          { text: "World", start_ms: 1000, end_ms: 2000 },
        ],
        durationSec: 2,
        language: "en",
        format: "audio/mpeg",
      })),
    };
    const parsed = await adapter.parse(makeArrayBufferFile({ name: "clip.mp3", size: 4, buffer: new ArrayBuffer(4) }), {
      whisperApi,
    });

    expect(parsed.markdown).toContain("Hello");
    expect(parsed.lrc).toContain("[00:00.00]Hello");
    expect(parsed.metadata.language).toBe("en");
  });

  it("requires whisperApi and enforces size limits", async () => {
    const adapter = new AudioAdapter({ maxFileSize: 1 });
    await expect(adapter.parse(makeArrayBufferFile({ name: "clip.mp3", size: 2, buffer: new ArrayBuffer(2) }))).rejects.toThrow(
      "file too large",
    );
    await expect(adapter.parse(makeArrayBufferFile({ name: "clip.mp3", size: 1, buffer: new ArrayBuffer(1) }))).rejects.toThrow(
      "whisperApi is required",
    );
  });
});

describe("VideoAdapter", () => {
  it("transcribes video and extracts frames", async () => {
    const frameExtractor = vi.fn(async () => ["AAA", "BBB", "CCC"]);
    const adapter = new VideoAdapter({ extractFrames: true, frameCount: 3, frameExtractor });
    const whisperApi = {
      transcribe: vi.fn(async () => ({
        text: "Hello",
        segments: [{ text: "Hello", start_ms: 0, end_ms: 1000 }],
        durationSec: 2,
        metadata: { fps: 30, resolution: "1920x1080" },
      })),
    };

    const parsed = await adapter.parse(makeArrayBufferFile({ name: "clip.mp4", size: 4, buffer: new ArrayBuffer(4) }), {
      whisperApi,
      extractAudioTrack: () => {
        throw new Error("audio fail");
      },
    });

    expect(parsed.assets).toHaveLength(3);
    expect(parsed.metadata.frameCount).toBe(3);
    expect(parsed.assets[0].docId).toBe(parsed.docId);
    expect(parsed.parseInfo.warnings).toContain("audio fail");
  });

  it("requires whisperApi", async () => {
    const adapter = new VideoAdapter();
    await expect(adapter.parse(makeArrayBufferFile({ name: "clip.mp4", size: 1, buffer: new ArrayBuffer(1) }))).rejects.toThrow(
      "whisperApi is required",
    );
  });
});

describe("CodeAdapter", () => {
  it("parses code content with doc comments", async () => {
    const adapter = new CodeAdapter({ maxFileSize: Number.MAX_SAFE_INTEGER });
    const code = "/**\n * This is a long doc comment.\n */\nconsole.log('hi');";
    const parsed = await adapter.parse({ name: "test.js", size: code.length, content: code });

    expect(parsed.metadata.language).toBe("javascript");
    expect(parsed.markdown).toContain("This is a long doc comment.");
    expect(parsed.markdown).toContain("```javascript");
    expect(CodeAdapter.isSupported("test.js")).toBe(true);
    expect(CodeAdapter.isSupported(".env")).toBe(false);
  });

  it("rejects blocked or oversized files", async () => {
    const adapter = new CodeAdapter({ maxFileSize: 1 });
    await expect(adapter.parse({ name: ".env", content: "SECRET" })).rejects.toThrow("blocked file type");
    await expect(adapter.parse({ name: "big.js", size: 2, content: "xx" })).rejects.toThrow("file too large");
  });
});

describe("extractAssetsFromMarkdown", () => {
  it("extracts assets with locators and mime types", () => {
    const markdown = "Hello ![alt](images/img1.png) world";
    const images = [{ id: "img1.png", data: "data:image/png;base64,AAAA" }];
    const assets = extractAssetsFromMarkdown(markdown, images);

    expect(assets).toHaveLength(1);
    expect(assets[0].mimeType).toBe("image/png");
    expect(assets[0].locator.charStart).toBe(markdown.indexOf("![alt](images/img1.png)"));
  });

  it("normalizes angle brackets, queries, and handles empty inputs", () => {
    const markdown = "![alt](<images/img2.jpg?x=1#y>)";
    const images = [{ id: "img2.jpg", data: "data:image/jpeg;base64,AAAA" }];
    const assets = extractAssetsFromMarkdown(markdown, images);

    expect(assets).toHaveLength(1);
    expect(assets[0].mimeType).toBe("image/jpeg");
    expect(extractAssetsFromMarkdown("", null)).toEqual([]);
  });
});
