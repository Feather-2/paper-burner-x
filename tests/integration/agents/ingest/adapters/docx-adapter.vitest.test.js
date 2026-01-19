import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fsMocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  stat: vi.fn(),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    readFile: fsMocks.readFile,
    stat: fsMocks.stat,
  };
});

// Mocks used to exercise DocxAdapter's optional dynamic imports (importMammoth/importTurndownService).
const mammothMocks = vi.hoisted(() => ({
  convertToHtml: vi.fn(),
  imgElement: vi.fn((fn) => fn),
}));

vi.mock("mammoth", () => ({
  default: {
    convertToHtml: mammothMocks.convertToHtml,
    images: { imgElement: mammothMocks.imgElement },
  },
}));

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

vi.mock("turndown", () => ({
  default: turndownMocks.TurndownService,
}));

describe("DocxAdapter (vitest)", () => {
  beforeEach(() => {
    vi.resetModules();
    fsMocks.readFile.mockReset();
    fsMocks.stat.mockReset();
    mammothMocks.convertToHtml.mockReset();
    mammothMocks.imgElement.mockReset().mockImplementation((fn) => fn);
    turndownMocks.ctor.mockReset();
    turndownMocks.turndown.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("parses a path input, extracts images (including placeholder on read error), and strips data URIs", async () => {
    const { DocxAdapter } = await import("../../../../js/agents/ingest/adapters/docx.js");

    const docxPath = "/virtual/doc.docx";
    const bytes = Buffer.from("PK\x03\x04fake-docx", "utf8");
    fsMocks.stat.mockResolvedValue({ size: bytes.length });
    fsMocks.readFile.mockResolvedValue(bytes);

    const mammoth = {
      images: {
        imgElement: vi.fn((fn) => fn),
      },
      convertToHtml: vi.fn(async ({ arrayBuffer, convertImage }) => {
        expect(arrayBuffer).toBeInstanceOf(ArrayBuffer);

        const okImage = {
          contentType: "image/png",
          read: vi.fn(async (kind) => {
            expect(kind).toBe("base64");
            return "DOCX_OK";
          }),
        };
        const badImage = {
          contentType: "image/bmp",
          read: vi.fn(async () => {
            throw new Error("read failed");
          }),
        };

        const el1 = await convertImage(okImage);
        const el2 = await convertImage(badImage);

        return {
          value: `<p>Hello</p><img alt="ok" src="${el1.src}"><img alt="bad" src="${el2.src}">`,
          messages: [{ message: "mammoth warning" }, 42],
        };
      }),
    };

    const turndownFn = vi.fn(() => {
      // Also exercise embedded base64 extraction/rewrite.
      const longBase64 = "A".repeat(100);
      return [
        "![ok](images/img_1.png)",
        "![bad](images/img_2.png)",
        "![Inline](data:image/png;base64,INLINE)",
        `data:image/webp;base64,${longBase64}`,
        "",
      ].join("\n");
    });

    const ctor = vi.fn();
    class TurndownServiceStub {
      constructor(options) {
        ctor(options);
      }
      turndown(html) {
        return turndownFn(html);
      }
    }

    const adapter = new DocxAdapter({ defaultChunkOptions: { chunkSize: 64, overlap: 0, includeLineNumbers: false } });
    const parsed = await adapter.parse(docxPath, { mammoth, TurndownService: TurndownServiceStub });

    expect(fsMocks.stat).toHaveBeenCalledWith(docxPath);
    expect(fsMocks.readFile).toHaveBeenCalledWith(docxPath);

    expect(mammoth.convertToHtml).toHaveBeenCalledTimes(1);
    expect(ctor).toHaveBeenCalledWith({ headingStyle: "atx", codeBlockStyle: "fenced" });

    expect(parsed.sourceType).toBe("docx");
    expect(parsed.origin.filename).toBe("doc.docx");
    expect(parsed.origin.mimeType).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(parsed.origin.size).toBe(bytes.length);
    expect(String(parsed.docId)).toMatch(/^docx_/);

    // Embedded base64 should be rewritten away.
    expect(parsed.markdown).toContain("images/img_extracted_1.png");
    expect(parsed.markdown).not.toContain("data:image/png;base64,INLINE");
    expect(parsed.markdown).toContain("[image:img_extracted_2.webp]");
    expect(parsed.markdown).not.toContain("data:image/webp;base64,");

    // Assets include docx images + the rewritten embedded markdown image.
    expect(parsed.assets.length).toBe(3);
    for (const a of parsed.assets) {
      expect(a.docId).toBe(parsed.docId);
      expect(a.source).toBe("extracted");
      expect(a.mimeType).toBe("image/png");
    }

    expect(Array.isArray(parsed.parseInfo.warnings)).toBe(true);
    expect(parsed.parseInfo.warnings.join("\n")).toMatch(/mammoth warning/);
    expect(parsed.parseInfo.warnings.join("\n")).toMatch(/image#2/i);
  });

  it("falls back to mocked dynamic imports when stageApi does not inject mammoth/TurndownService", async () => {
    const { DocxAdapter } = await import("../../../../js/agents/ingest/adapters/docx.js");

    mammothMocks.convertToHtml.mockResolvedValue({ value: "<p>From imported mammoth</p>", messages: [] });
    turndownMocks.turndown.mockReturnValue("# From imported TurndownService\n");

    const adapter = new DocxAdapter({ defaultChunkOptions: { chunkSize: 64, overlap: 0, includeLineNumbers: false } });
    const parsed = await adapter.parse({
      name: "auto.docx",
      size: 3,
      arrayBuffer: vi.fn(async () => new ArrayBuffer(3)),
    });

    expect(mammothMocks.convertToHtml).toHaveBeenCalledTimes(1);
    expect(turndownMocks.ctor).toHaveBeenCalledTimes(1);
    expect(turndownMocks.turndown).toHaveBeenCalledTimes(1);
    expect(parsed.sourceType).toBe("docx");
    expect(parsed.markdown).toBe("# From imported TurndownService\n");
  });

  it("rejects unsupported file-like inputs and oversized files before converting", async () => {
    const { DocxAdapter } = await import("../../../../js/agents/ingest/adapters/docx.js");

    const convertToHtml = vi.fn(async () => ({ value: "", messages: [] }));
    class TurndownServiceStub {
      turndown() {
        return "";
      }
    }

    const adapter = new DocxAdapter({ maxFileSize: 1 });

    await expect(adapter.parse({ name: "bad.docx" }, { mammoth: { convertToHtml }, TurndownService: TurndownServiceStub })).rejects.toThrow(
      /missing arrayBuffer/i
    );

    await expect(
      adapter.parse(
        {
          name: "big.docx",
          size: 2,
          arrayBuffer: vi.fn(async () => new ArrayBuffer(2)),
        },
        { mammoth: { convertToHtml }, TurndownService: TurndownServiceStub }
      )
    ).rejects.toThrow(/file too large/i);

    expect(convertToHtml).not.toHaveBeenCalled();

    // @ts-expect-error - intentional bad input for runtime validation.
    await expect(adapter.parse(null, { mammoth: { convertToHtml }, TurndownService: TurndownServiceStub })).rejects.toThrow(/input must be a path string/i);
  });

  it("uses application/octet-stream when input name is not .docx and type is missing", async () => {
    const { DocxAdapter } = await import("../../../../js/agents/ingest/adapters/docx.js");

    const adapter = new DocxAdapter({ defaultChunkOptions: { chunkSize: 64, overlap: 0, includeLineNumbers: false } });
    const parsed = await adapter.parse(
      {
        name: "scan.bin",
        arrayBuffer: vi.fn(async () => new ArrayBuffer(1)),
      },
      {
        mammoth: { convertToHtml: vi.fn(async () => ({ value: "<p>x</p>", messages: [] })) },
        TurndownService: class {
          turndown() {
            return "x";
          }
        },
      }
    );

    expect(parsed.origin.mimeType).toBe("application/octet-stream");
  });

  it("rejects oversized path inputs before readFile()", async () => {
    const { DocxAdapter } = await import("../../../../js/agents/ingest/adapters/docx.js");

    const docxPath = "/virtual/big.docx";
    fsMocks.stat.mockResolvedValue({ size: 2 });
    fsMocks.readFile.mockResolvedValue(Buffer.alloc(2));

    const adapter = new DocxAdapter({ maxFileSize: 1 });
    await expect(adapter.parse(docxPath)).rejects.toThrow(/file too large/i);
    expect(fsMocks.readFile).not.toHaveBeenCalled();
  });

  it("defaults unknown image contentType to .png via extFromMime()", async () => {
    const { DocxAdapter } = await import("../../../../js/agents/ingest/adapters/docx.js");

    const mammoth = {
      // No `images.imgElement` -> exercise the direct convertImageImpl branch.
      convertToHtml: vi.fn(async ({ convertImage }) => {
        const unknownImage = {
          contentType: "application/octet-stream",
          read: vi.fn(async () => "BBBB"),
        };
        const el = await convertImage(unknownImage);
        return { value: `<img src="${el.src}">`, messages: [] };
      }),
    };

    class TurndownServiceStub {
      turndown() {
        return "![u](images/img_1.png)\n";
      }
    }

    const adapter = new DocxAdapter({ defaultChunkOptions: { chunkSize: 64, overlap: 0, includeLineNumbers: false } });
    const parsed = await adapter.parse(
      { name: "x.docx", arrayBuffer: vi.fn(async () => new ArrayBuffer(1)) },
      { mammoth, TurndownService: TurndownServiceStub }
    );

    expect(parsed.assets).toHaveLength(1);
    expect(parsed.assets[0].mimeType).toBe("image/png");
  });

  it("normalizeMaxFileSize handles Infinity and invalid values", async () => {
    const { DocxAdapter } = await import("../../../../js/agents/ingest/adapters/docx.js");

    // Infinity should pass through (no size limit)
    const adapterInf = new DocxAdapter({ maxFileSize: Infinity });
    mammothMocks.convertToHtml.mockResolvedValue({ value: "<p>ok</p>", messages: [] });
    turndownMocks.turndown.mockReturnValue("ok");

    const parsed = await adapterInf.parse({
      name: "huge.docx",
      size: 999999999,
      arrayBuffer: vi.fn(async () => new ArrayBuffer(1)),
    });
    expect(parsed.sourceType).toBe("docx");

    // Negative and zero should fallback to default
    const adapterNeg = new DocxAdapter({ maxFileSize: -1 });
    const adapterZero = new DocxAdapter({ maxFileSize: 0 });
    // These use internal default (25MB), just check they don't throw on small files
    const small = { name: "s.docx", size: 100, arrayBuffer: vi.fn(async () => new ArrayBuffer(1)) };
    const p1 = await adapterNeg.parse(small);
    const p2 = await adapterZero.parse(small);
    expect(p1.sourceType).toBe("docx");
    expect(p2.sourceType).toBe("docx");
  });

  it("uses globalThis.mammoth and globalThis.TurndownService when stageApi is empty", async () => {
    const convertToHtml = vi.fn(async () => ({ value: "<p>global</p>", messages: [] }));
    globalThis.mammoth = { convertToHtml };
    globalThis.TurndownService = class {
      turndown() { return "from global"; }
    };

    // Reset modules to clear cached dynamic imports
    vi.resetModules();
    const { DocxAdapter } = await import("../../../../js/agents/ingest/adapters/docx.js");

    const adapter = new DocxAdapter();
    const parsed = await adapter.parse({
      name: "g.docx",
      size: 1,
      arrayBuffer: vi.fn(async () => new ArrayBuffer(1)),
    }, {});

    expect(convertToHtml).toHaveBeenCalled();
    expect(parsed.markdown).toBe("from global");

    delete globalThis.mammoth;
    delete globalThis.TurndownService;
  });

  it("extFromMime handles jpg variant", async () => {
    const { DocxAdapter } = await import("../../../../js/agents/ingest/adapters/docx.js");

    const mammoth = {
      convertToHtml: vi.fn(async ({ convertImage }) => {
        const jpgImage = { contentType: "image/jpg", read: vi.fn(async () => "JPGDATA") };
        const el = await convertImage(jpgImage);
        return { value: `<img src="${el.src}">`, messages: [] };
      }),
    };

    class TurndownServiceStub {
      turndown() { return "![](images/img_1.jpg)\n"; }
    }

    const adapter = new DocxAdapter();
    const parsed = await adapter.parse(
      { name: "x.docx", arrayBuffer: vi.fn(async () => new ArrayBuffer(1)) },
      { mammoth, TurndownService: TurndownServiceStub }
    );

    expect(parsed.assets.length).toBeGreaterThanOrEqual(1);
    // The image filename in docxImages should have .jpg extension
    expect(parsed.markdown).toContain("img_1.jpg");
  });

  it("warning limit is respected (MAX_WARNINGS)", async () => {
    const { DocxAdapter } = await import("../../../../js/agents/ingest/adapters/docx.js");

    const manyWarnings = Array.from({ length: 100 }, (_, i) => ({ message: `warn${i}` }));
    const mammoth = {
      convertToHtml: vi.fn(async () => ({
        value: "<p>x</p>",
        messages: manyWarnings,
      })),
    };

    class TurndownServiceStub {
      turndown() { return "x"; }
    }

    const adapter = new DocxAdapter();
    const parsed = await adapter.parse(
      { name: "w.docx", size: 1, arrayBuffer: vi.fn(async () => new ArrayBuffer(1)) },
      { mammoth, TurndownService: TurndownServiceStub }
    );

    // MAX_WARNINGS is 50
    expect(parsed.parseInfo.warnings.length).toBeLessThanOrEqual(50);
  });
});
