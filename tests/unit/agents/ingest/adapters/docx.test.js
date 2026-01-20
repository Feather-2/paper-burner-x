import { describe, it, expect, vi, beforeEach } from "vitest";

const nodeIOMocks = vi.hoisted(() => ({
  basenameOfPath: vi.fn(),
  fileLikeFromPath: vi.fn(),
}));

const extractAssetsMocks = vi.hoisted(() => ({
  extractAssetsFromMarkdown: vi.fn(),
}));

const mammothMocks = vi.hoisted(() => {
  const defaultExport = {
    convertToHtml: vi.fn(),
    images: { imgElement: vi.fn((fn) => fn) },
  };
  return { module: { default: defaultExport }, defaultExport };
});

const turndownMocks = vi.hoisted(() => {
  const mocks = {
    ctor: vi.fn(),
    turndown: vi.fn(),
  };
  class TurndownService {
    constructor(options) {
      mocks.ctor(options);
    }
    turndown(html) {
      return mocks.turndown(html);
    }
  }
  return { ...mocks, module: { default: TurndownService }, TurndownService };
});

const jszipMocks = vi.hoisted(() => {
  const defaultExport = { loadAsync: vi.fn() };
  return { module: { default: defaultExport }, defaultExport };
});

vi.mock("../../../../../js/agents/ingest/adapters/node-io.js", () => ({
  basenameOfPath: nodeIOMocks.basenameOfPath,
  fileLikeFromPath: nodeIOMocks.fileLikeFromPath,
}));

vi.mock("../../../../../js/agents/ingest/extract-assets.js", () => ({
  extractAssetsFromMarkdown: extractAssetsMocks.extractAssetsFromMarkdown,
}));

vi.mock("mammoth", () => mammothMocks.module);
vi.mock("turndown", () => turndownMocks.module);
vi.mock("jszip", () => jszipMocks.module);

import { DocxAdapter } from "../../../../../js/agents/ingest/adapters/docx.js";

const makeArrayBuffer = (size) => new ArrayBuffer(Math.max(0, size ?? 0));

const makeFileLike = ({ name, filename, type, size = 1, arrayBufferSize } = {}) => ({
  name,
  filename,
  type,
  size,
  arrayBuffer: vi.fn(async () => makeArrayBuffer(arrayBufferSize ?? size ?? 0)),
});

const makeZip = (entries = {}) => ({ files: entries });

const makeEntry = ({ uncompressed, compressed, dir } = {}) => ({
  dir: Boolean(dir),
  _data: { uncompressedSize: uncompressed, compressedSize: compressed },
});

const EMPTY_ZIP_BYTES = Uint8Array.from([
  0x50, 0x4b, 0x05, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

const makeEmptyZipBuffer = () => EMPTY_ZIP_BYTES.slice().buffer;

describe("DocxAdapter", () => {
  beforeEach(() => {
    nodeIOMocks.basenameOfPath.mockReset();
    nodeIOMocks.fileLikeFromPath.mockReset();
    extractAssetsMocks.extractAssetsFromMarkdown.mockReset();

    mammothMocks.defaultExport.convertToHtml.mockReset();
    mammothMocks.defaultExport.images.imgElement.mockReset().mockImplementation((fn) => fn);
    mammothMocks.module.default = mammothMocks.defaultExport;

    turndownMocks.ctor.mockReset();
    turndownMocks.turndown.mockReset();
    turndownMocks.module.default = turndownMocks.TurndownService;

    jszipMocks.defaultExport.loadAsync.mockReset();
    jszipMocks.module.default = jszipMocks.defaultExport;

    nodeIOMocks.basenameOfPath.mockResolvedValue("default.docx");
    nodeIOMocks.fileLikeFromPath.mockImplementation(async (_path, options) =>
      makeFileLike({ name: "default.docx", type: options?.mimeType, size: 1, arrayBufferSize: 1 })
    );

    extractAssetsMocks.extractAssetsFromMarkdown.mockImplementation((_markdown, images) => {
      return (Array.isArray(images) ? images : []).map((img, idx) => ({
        assetId: `asset_${idx + 1}`,
        type: "image",
        data: img?.data,
        mimeType: "image/png",
      }));
    });

    mammothMocks.defaultExport.convertToHtml.mockResolvedValue({ value: "<p>ok</p>", messages: [] });
    turndownMocks.turndown.mockReturnValue("ok");
    jszipMocks.defaultExport.loadAsync.mockResolvedValue({ files: {} });
  });

  it("normalizes limit options and handles boundary values", () => {
    const adapter = new DocxAdapter({
      maxFileSize: "1024.9",
      maxUncompressedBytes: 0,
      maxZipEntries: " 7 ",
      maxCompressionRatio: -1,
    });

    expect(adapter.maxFileSize).toBe(1024);
    expect(adapter.maxUncompressedBytes).toBe(100 * 1024 * 1024);
    expect(adapter.maxZipEntries).toBe(7);
    expect(adapter.maxCompressionRatio).toBe(100);

    const adapter2 = new DocxAdapter({
      maxFileSize: Infinity,
      maxUncompressedBytes: Number.MAX_SAFE_INTEGER,
      maxZipEntries: Number.MAX_SAFE_INTEGER,
      maxCompressionRatio: Infinity,
    });

    expect(adapter2.maxFileSize).toBe(Infinity);
    expect(adapter2.maxUncompressedBytes).toBe(Number.MAX_SAFE_INTEGER);
    expect(adapter2.maxZipEntries).toBe(Number.MAX_SAFE_INTEGER);
    expect(adapter2.maxCompressionRatio).toBe(Infinity);
  });

  it("rejects null/undefined and empty array/object inputs", async () => {
    const adapter = new DocxAdapter();

    await expect(adapter.parse(null)).rejects.toThrow(/input must be a path string or a file-like object/i);
    await expect(adapter.parse(undefined)).rejects.toThrow(/input must be a path string or a file-like object/i);
    await expect(adapter.parse([])).rejects.toThrow(/missing arrayBuffer/i);
    await expect(adapter.parse({})).rejects.toThrow(/missing arrayBuffer/i);
  });

  it("rejects path strings when allowPathRead is false (including empty string)", async () => {
    const adapter = new DocxAdapter();

    nodeIOMocks.basenameOfPath.mockResolvedValueOnce("");
    await expect(adapter.parse("")).rejects.toThrow(/path string inputs are disabled/i);
    expect(nodeIOMocks.basenameOfPath).toHaveBeenNthCalledWith(1, "");
    expect(nodeIOMocks.fileLikeFromPath).not.toHaveBeenCalled();

    nodeIOMocks.basenameOfPath.mockResolvedValueOnce("   ");
    await expect(adapter.parse("   ")).rejects.toThrow(/path string inputs are disabled/i);
    expect(nodeIOMocks.basenameOfPath).toHaveBeenNthCalledWith(2, "   ");
  });

  it("parses file-like input, extracts images and embedded data URIs, and records warnings", async () => {
    const adapter = new DocxAdapter({ defaultChunkOptions: { chunkSize: 64, overlap: 0, includeLineNumbers: false } });
    const input = makeFileLike({ name: "Report.DOCX", size: 5, arrayBufferSize: 5 });

    const mammoth = {
      images: { imgElement: vi.fn((fn) => fn) },
      convertToHtml: vi.fn(async ({ arrayBuffer, convertImage }) => {
        expect(arrayBuffer).toBeInstanceOf(ArrayBuffer);

        const okImage = { contentType: "image/jpeg", read: vi.fn(async () => "JPEGDATA") };
        const badImage = {
          contentType: "image/png",
          read: vi.fn(async () => {
            throw new Error("read failed");
          }),
        };

        const okEl = await convertImage(okImage);
        const badEl = await convertImage(badImage);

        return {
          value: `<p>Hello</p><img src="${okEl.src}"><img src="${badEl.src}">`,
          messages: [{ message: "mammoth warn" }, 7],
        };
      }),
    };

    const longBase64 = "A".repeat(120);
    const markdown = [
      "![ok](images/img_1.jpg)",
      "![bad](images/img_2.png)",
      "![Inline](data:image/png;base64,INLINE)",
      `data:image/webp;base64,${longBase64}`,
      "",
    ].join("\n");

    const turndownCtor = vi.fn();
    class TurndownServiceStub {
      constructor(options) {
        turndownCtor(options);
      }
      turndown() {
        return markdown;
      }
    }

    const parsed = await adapter.parse(input, { mammoth, TurndownService: TurndownServiceStub });

    expect(mammoth.convertToHtml).toHaveBeenCalledTimes(1);
    expect(turndownCtor).toHaveBeenCalledWith({ headingStyle: "atx", codeBlockStyle: "fenced" });

    expect(parsed.origin.filename).toBe("Report.DOCX");
    expect(parsed.origin.mimeType).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(parsed.origin.size).toBe(5);
    expect(parsed.sourceType).toBe("docx");

    expect(parsed.markdown).toContain("images/img_extracted_1.png");
    expect(parsed.markdown).toContain("[image:img_extracted_2.webp]");
    expect(parsed.markdown).not.toContain("data:image/png;base64,INLINE");
    expect(parsed.markdown).not.toContain("data:image/webp;base64,");

    expect(extractAssetsMocks.extractAssetsFromMarkdown).toHaveBeenCalledTimes(1);
    const [calledMarkdown, calledImages] = extractAssetsMocks.extractAssetsFromMarkdown.mock.calls[0];
    expect(calledMarkdown).toBe(parsed.markdown);
    expect(Array.isArray(calledImages)).toBe(true);
    expect(calledImages).toHaveLength(4);
    const dataValues = calledImages.map((img) => img.data);
    expect(dataValues).toContain("JPEGDATA");
    expect(dataValues).toContain("INLINE");
    expect(dataValues).toContain(longBase64);
    expect(calledImages.some((img) => img.placeholder === true)).toBe(true);

    expect(parsed.assets).toHaveLength(4);
    for (const asset of parsed.assets) {
      expect(asset.source).toBe("extracted");
      expect(asset.docId).toBe(parsed.docId);
    }

    expect(parsed.parseInfo.warnings.join("\n")).toMatch(/mammoth warn/);
    expect(parsed.parseInfo.warnings.join("\n")).toMatch(/image#2/i);
  });

  it("falls back to default filename when name/filename are blank", async () => {
    const adapter = new DocxAdapter();
    const input = makeFileLike({ name: "   ", filename: "", size: 1, arrayBufferSize: 1 });

    const mammoth = { convertToHtml: vi.fn(async () => ({ value: "<p>x</p>", messages: [] })) };
    class TurndownServiceStub {
      turndown() {
        return "x";
      }
    }

    const parsed = await adapter.parse(input, { mammoth, TurndownService: TurndownServiceStub });

    expect(parsed.origin.filename).toBe("document.docx");
    expect(parsed.origin.mimeType).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  });

  it("reads path inputs when allowPathRead is true and forwards mime/maxBytes", async () => {
    const adapter = new DocxAdapter({ maxFileSize: 123 });

    nodeIOMocks.basenameOfPath.mockResolvedValueOnce("From-PATH.DOCX").mockResolvedValueOnce("From-PATH.DOCX");
    nodeIOMocks.fileLikeFromPath.mockResolvedValueOnce(
      makeFileLike({ name: "From-PATH.DOCX", size: 10, arrayBufferSize: 10 })
    );

    const mammoth = { convertToHtml: vi.fn(async () => ({ value: "<p>x</p>", messages: [] })) };
    class TurndownServiceStub {
      turndown() {
        return "x";
      }
    }

    const parsed = await adapter.parse("/tmp/From-PATH.DOCX", {
      allowPathRead: true,
      mammoth,
      TurndownService: TurndownServiceStub,
    });

    expect(nodeIOMocks.basenameOfPath).toHaveBeenCalledTimes(2);
    expect(nodeIOMocks.fileLikeFromPath).toHaveBeenCalledWith("/tmp/From-PATH.DOCX", {
      maxBytes: 123,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    expect(parsed.origin.filename).toBe("From-PATH.DOCX");
    expect(parsed.origin.mimeType).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  });

  it("rejects oversized inputs before reading arrayBuffer", async () => {
    const adapter = new DocxAdapter({ maxFileSize: 2 });
    const input = makeFileLike({ name: "big.docx", size: 3, arrayBufferSize: 3 });

    const mammoth = { convertToHtml: vi.fn(async () => ({ value: "<p>x</p>", messages: [] })) };
    class TurndownServiceStub {
      turndown() {
        return "x";
      }
    }

    await expect(adapter.parse(input, { mammoth, TurndownService: TurndownServiceStub })).rejects.toThrow(/file too large/i);
    expect(input.arrayBuffer).not.toHaveBeenCalled();
    expect(mammoth.convertToHtml).not.toHaveBeenCalled();
  });

  it("rejects oversized arrayBuffer after reading", async () => {
    const adapter = new DocxAdapter({ maxFileSize: 2 });
    const input = makeFileLike({ name: "big.docx", size: 1, arrayBufferSize: 5 });

    const mammoth = { convertToHtml: vi.fn(async () => ({ value: "<p>x</p>", messages: [] })) };
    class TurndownServiceStub {
      turndown() {
        return "x";
      }
    }

    await expect(adapter.parse(input, { mammoth, TurndownService: TurndownServiceStub })).rejects.toThrow(/file too large/i);
    expect(input.arrayBuffer).toHaveBeenCalledTimes(1);
    expect(mammoth.convertToHtml).not.toHaveBeenCalled();
  });

  it("enforces maxZipEntries", async () => {
    const adapter = new DocxAdapter({ maxZipEntries: 1 });
    jszipMocks.defaultExport.loadAsync.mockResolvedValueOnce(
      makeZip({
        "a.xml": makeEntry({ uncompressed: 1, compressed: 1 }),
        "b.xml": makeEntry({ uncompressed: 1, compressed: 1 }),
      })
    );

    const mammoth = { convertToHtml: vi.fn(async () => ({ value: "<p>x</p>", messages: [] })) };
    class TurndownServiceStub {
      turndown() {
        return "x";
      }
    }

    await expect(
      adapter.parse(makeFileLike({ name: "a.docx", size: 1, arrayBufferSize: 1 }), { mammoth, TurndownService: TurndownServiceStub })
    ).rejects.toThrow(/zip entry count 2 exceeds max 1/);
    expect(mammoth.convertToHtml).not.toHaveBeenCalled();
  });

  it("enforces maxUncompressedBytes", async () => {
    const adapter = new DocxAdapter({ maxUncompressedBytes: 5 });
    jszipMocks.defaultExport.loadAsync.mockResolvedValueOnce(
      makeZip({
        "a.xml": makeEntry({ uncompressed: 3, compressed: 1 }),
        "b.xml": makeEntry({ uncompressed: 4, compressed: 1 }),
      })
    );

    const mammoth = { convertToHtml: vi.fn(async () => ({ value: "<p>x</p>", messages: [] })) };
    class TurndownServiceStub {
      turndown() {
        return "x";
      }
    }

    await expect(
      adapter.parse(makeFileLike({ name: "a.docx", size: 1, arrayBufferSize: 1 }), { mammoth, TurndownService: TurndownServiceStub })
    ).rejects.toThrow(/zip uncompressed bytes 7 exceeds max 5/);
    expect(mammoth.convertToHtml).not.toHaveBeenCalled();
  });

  it("enforces maxCompressionRatio", async () => {
    const adapter = new DocxAdapter({ maxCompressionRatio: 2 });
    jszipMocks.defaultExport.loadAsync.mockResolvedValueOnce(
      makeZip({
        "a.xml": makeEntry({ uncompressed: 100, compressed: 1 }),
      })
    );

    const mammoth = { convertToHtml: vi.fn(async () => ({ value: "<p>x</p>", messages: [] })) };
    class TurndownServiceStub {
      turndown() {
        return "x";
      }
    }

    await expect(
      adapter.parse(makeFileLike({ name: "a.docx", size: 1, arrayBufferSize: 1 }), { mammoth, TurndownService: TurndownServiceStub })
    ).rejects.toThrow(/zip compression ratio 100\.0 exceeds max 2/);
    expect(mammoth.convertToHtml).not.toHaveBeenCalled();
  });

  it("throws when mammoth is unavailable", async () => {
    const adapter = new DocxAdapter();
    mammothMocks.module.default = null;

    await expect(adapter.parse(makeFileLike({ name: "a.docx", size: 1, arrayBufferSize: 1 }))).rejects.toThrow(/mammoth is required/i);
  });

  it("throws when TurndownService is unavailable", async () => {
    const adapter = new DocxAdapter();
    turndownMocks.module.default = null;

    await expect(adapter.parse(makeFileLike({ name: "a.docx", size: 1, arrayBufferSize: 1 }))).rejects.toThrow(/TurndownService is required/i);
  });

  it("throws when JSZip is unavailable", async () => {
    const adapter = new DocxAdapter();
    jszipMocks.module.default = {};

    const mammoth = { convertToHtml: vi.fn(async () => ({ value: "<p>x</p>", messages: [] })) };
    class TurndownServiceStub {
      turndown() {
        return "x";
      }
    }

    await expect(
      adapter.parse(makeFileLike({ name: "a.docx", size: 1, arrayBufferSize: 1 }), { mammoth, TurndownService: TurndownServiceStub })
    ).rejects.toThrow(/JSZip is required/);
  });

  it("handles deep nested html and long markdown", async () => {
    const adapter = new DocxAdapter();
    const depth = 40;
    const html = `${"<div>".repeat(depth)}text${"</div>".repeat(depth)}`;
    const longMarkdown = "x".repeat(10000);

    const mammoth = { convertToHtml: vi.fn(async () => ({ value: html, messages: [] })) };
    class TurndownServiceStub {
      turndown(inputHtml) {
        expect(inputHtml).toBe(html);
        return longMarkdown;
      }
    }

    const parsed = await adapter.parse(makeFileLike({ name: "deep.docx", size: 1, arrayBufferSize: 1 }), {
      mammoth,
      TurndownService: TurndownServiceStub,
    });

    expect(parsed.markdown.length).toBe(10000);
    expect(parsed.markdown).toBe(longMarkdown);
  });

  it("supports concurrent parse calls with independent image counters", async () => {
    const adapter = new DocxAdapter();

    const mammoth = {
      convertToHtml: vi.fn(async ({ convertImage }) => {
        const image = { contentType: "image/png", read: vi.fn(async () => "DATA") };
        const el = await convertImage(image);
        return { value: `<img src="${el.src}">`, messages: [] };
      }),
    };

    class TurndownServiceStub {
      turndown(html) {
        const match = /src=\"([^\"]+)\"/.exec(html);
        return `![img](${match ? match[1] : ""})`;
      }
    }

    const inputA = {
      name: "a.docx",
      size: EMPTY_ZIP_BYTES.length,
      arrayBuffer: vi.fn(async () => makeEmptyZipBuffer()),
    };
    const inputB = {
      name: "b.docx",
      size: EMPTY_ZIP_BYTES.length,
      arrayBuffer: vi.fn(async () => makeEmptyZipBuffer()),
    };

    const [parsedA, parsedB] = await Promise.all([
      adapter.parse(inputA, { mammoth, TurndownService: TurndownServiceStub }),
      adapter.parse(inputB, { mammoth, TurndownService: TurndownServiceStub }),
    ]);

    expect(parsedA.markdown).toContain("img_1.png");
    expect(parsedB.markdown).toContain("img_1.png");
    expect(parsedA.assets).toHaveLength(1);
    expect(parsedB.assets).toHaveLength(1);
    expect(mammoth.convertToHtml).toHaveBeenCalledTimes(2);
  });

  it("supports rapid sequential parse calls without leaking counters", async () => {
    const adapter = new DocxAdapter();

    const mammoth = {
      convertToHtml: vi.fn(async ({ convertImage }) => {
        const image = { contentType: "image/png", read: vi.fn(async () => "DATA") };
        const el = await convertImage(image);
        return { value: `<img src="${el.src}">`, messages: [] };
      }),
    };

    class TurndownServiceStub {
      turndown(html) {
        const match = /src=\"([^\"]+)\"/.exec(html);
        return `![img](${match ? match[1] : ""})`;
      }
    }

    const first = await adapter.parse(makeFileLike({ name: "a.docx", size: 1, arrayBufferSize: 1 }), {
      mammoth,
      TurndownService: TurndownServiceStub,
    });
    const second = await adapter.parse(makeFileLike({ name: "b.docx", size: 1, arrayBufferSize: 1 }), {
      mammoth,
      TurndownService: TurndownServiceStub,
    });

    expect(first.markdown).toContain("img_1.png");
    expect(second.markdown).toContain("img_1.png");
    expect(extractAssetsMocks.extractAssetsFromMarkdown).toHaveBeenCalledTimes(2);
    expect(mammoth.convertToHtml).toHaveBeenCalledTimes(2);
  });
});
