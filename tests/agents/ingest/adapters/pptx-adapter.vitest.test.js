import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Adapters dynamically import `node:fs/promises` at runtime.
// Use a module mock so no real filesystem IO happens in these unit tests.
const fsMocks = vi.hoisted(() => ({
  readFile: vi.fn(),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    readFile: fsMocks.readFile,
  };
});

// PptxAdapter's fallback script loader imports these packages. Mock them to keep this a pure unit test.
vi.mock("linkedom", () => ({
  DOMParser: class DOMParser {},
}));

vi.mock("jszip", () => ({
  default: class JSZip {},
}));

describe("PptxAdapter (vitest)", () => {
  let priorParser;

  beforeEach(() => {
    vi.resetModules();
    fsMocks.readFile.mockReset();
    priorParser = globalThis.PPTXSlideParser;
  });

  afterEach(() => {
    globalThis.PPTXSlideParser = priorParser;
    vi.clearAllMocks();
  });

  it("parses a file-like input via injected stageApi.pptxParser and extracts data URI images", async () => {
    delete globalThis.PPTXSlideParser;

    const { PptxAdapter } = await import("../../../../js/agents/ingest/adapters/pptx.js");

    const pptxParser = {
      parse: vi.fn(async (arrayBuffer) => {
        expect(arrayBuffer).toBeInstanceOf(ArrayBuffer);
        return {
          slides: [
            {
              id: "slide-1",
              elements: [
                { type: "text", role: "title", content: "Deck Title" },
                { type: "text", content: "Point A" },
                // Ignored (non-data URI).
                { type: "image", src: "images/external.png" },
                { type: "image", src: "data:image/png;base64,BBBB" },
                { type: "image", src: "data:image/jpeg;base64,CCCC" },
              ],
            },
          ],
          metadata: { slideCount: 1 },
        };
      }),
    };

    const adapter = new PptxAdapter({ defaultChunkOptions: { chunkSize: 64, overlap: 0, includeLineNumbers: false } });
    const parsed = await adapter.parse(
      {
        name: "deck.pptx",
        size: 8,
        arrayBuffer: vi.fn(async () => new ArrayBuffer(8)),
      },
      { pptxParser }
    );

    expect(pptxParser.parse).toHaveBeenCalledTimes(1);
    expect(parsed.sourceType).toBe("pptx");
    expect(parsed.origin.mimeType).toBe("application/vnd.openxmlformats-officedocument.presentationml.presentation");
    expect(parsed.metadata.slideCount).toBe(1);

    expect(parsed.markdown).toContain("# deck.pptx");
    expect(parsed.markdown).toContain("## Slide 1: Deck Title");
    expect(parsed.markdown).toContain("- Deck Title");
    expect(parsed.markdown).toContain("- Point A");

    // Two extracted image assets.
    expect(parsed.assets).toHaveLength(2);
    const dataToMime = new Map(parsed.assets.map((a) => [a.data, a.mimeType]));
    expect(dataToMime.get("BBBB")).toBe("image/png");
    expect(dataToMime.get("CCCC")).toBe("image/jpeg");

    for (const a of parsed.assets) {
      expect(a.docId).toBe(parsed.docId);
      expect(a.source).toBe("extracted");
    }
  });

  it("covers guessMimeType() fallback and extFromMime() branches (gif/webp/svg/bmp/default)", async () => {
    delete globalThis.PPTXSlideParser;

    const { PptxAdapter } = await import("../../../../js/agents/ingest/adapters/pptx.js");

    const pptxParser = {
      parse: vi.fn(async () => ({
        slides: [
          {
            elements: [
              { type: "image", src: "data:image/gif;base64,GGGG" },
              { type: "image", src: "data:image/webp;base64,WWWW" },
              { type: "image", src: "data:image/svg+xml;base64,SSSS" },
              { type: "image", src: "data:image/bmp;base64,DDDD" },
              // Unknown mime -> default .png extension.
              { type: "image", src: "data:image/unknown;base64,UUUU" },
            ],
          },
        ],
        metadata: {},
      })),
    };

    const adapter = new PptxAdapter({ defaultChunkOptions: { chunkSize: 64, overlap: 0, includeLineNumbers: false } });
    const parsed = await adapter.parse(
      {
        // Not `.pptx` and no explicit type -> uses guessMimeType() fallback.
        name: "slides.bin",
        arrayBuffer: vi.fn(async () => new ArrayBuffer(1)),
      },
      { pptxParser }
    );

    expect(parsed.origin.mimeType).toBe("application/octet-stream");
    expect(parsed.markdown).toContain("images/pptx_img_1.gif");
    expect(parsed.markdown).toContain("images/pptx_img_2.webp");
    expect(parsed.markdown).toContain("images/pptx_img_3.svg");
    expect(parsed.markdown).toContain("images/pptx_img_4.bmp");
    expect(parsed.markdown).toContain("images/pptx_img_5.png");

    expect(parsed.assets).toHaveLength(5);
    const dataToMime = new Map(parsed.assets.map((a) => [a.data, a.mimeType]));
    expect(dataToMime.get("GGGG")).toBe("image/gif");
    expect(dataToMime.get("WWWW")).toBe("image/webp");
    expect(dataToMime.get("SSSS")).toBe("image/svg+xml");
    expect(dataToMime.get("DDDD")).toBe("application/octet-stream");
    expect(dataToMime.get("UUUU")).toBe("image/png");
  });

  it("parses a path input via mocked fs.readFile(), uses globalThis.PPTXSlideParser, and falls back slideCount to slides.length", async () => {
    fsMocks.readFile.mockResolvedValue(Buffer.from("FAKEPPTX", "utf8"));

    const parse = vi.fn(async () => ({
      slides: [
        { elements: [{ type: "text", content: "No title role" }] },
        { elements: [] },
      ],
      metadata: { slideCount: NaN },
    }));

    class PPTXSlideParser {
      parse(arrayBuffer) {
        expect(arrayBuffer).toBeInstanceOf(ArrayBuffer);
        return parse(arrayBuffer);
      }
    }
    globalThis.PPTXSlideParser = PPTXSlideParser;

    const { PptxAdapter } = await import("../../../../js/agents/ingest/adapters/pptx.js");
    const adapter = new PptxAdapter({ defaultChunkOptions: { chunkSize: 64, overlap: 0, includeLineNumbers: false } });

    const parsed = await adapter.parse("/virtual/Slides.PPTX");

    expect(fsMocks.readFile).toHaveBeenCalledTimes(1);
    expect(fsMocks.readFile).toHaveBeenCalledWith("/virtual/Slides.PPTX");
    expect(parse).toHaveBeenCalledTimes(1);

    expect(parsed.origin.filename).toBe("Slides.PPTX");
    expect(parsed.origin.mimeType).toBe("application/vnd.openxmlformats-officedocument.presentationml.presentation");
    expect(parsed.metadata.slideCount).toBe(2);
    expect(parsed.markdown).toContain("## Slide 1");
    expect(parsed.markdown).toContain("## Slide 2");
  });

  it("loads PPTXSlideParser from script via mocked fs.readFile when no parser is injected and no global exists", async () => {
    delete globalThis.PPTXSlideParser;

    const script = [
      "(function(){",
      "  class PPTXSlideParser {",
      "    async parse() {",
      "      return {",
      "        slides: [{ elements: [{ type: 'text', content: 'From script' }] }],",
      "        metadata: { slideCount: 1 }",
      "      };",
      "    }",
      "  }",
      "  this.PPTXSlideParser = PPTXSlideParser;",
      "})();",
      "",
    ].join("\n");

    fsMocks.readFile.mockImplementation(async (_pathOrUrl, encoding) => {
      if (encoding === "utf8") return script;
      return Buffer.from("FAKEPPTX", "utf8");
    });

    const { PptxAdapter } = await import("../../../../js/agents/ingest/adapters/pptx.js");
    const adapter = new PptxAdapter({ defaultChunkOptions: { chunkSize: 64, overlap: 0, includeLineNumbers: false } });

    const parsed = await adapter.parse("/virtual/scripted.pptx");

    expect(parsed.sourceType).toBe("pptx");
    expect(parsed.markdown).toContain("From script");

    // One call to read the PPTX bytes + one call to read the parser script (utf8).
    expect(fsMocks.readFile.mock.calls.some((call) => call[1] === "utf8")).toBe(true);
  });

  it("rejects unsupported file-like inputs and non-object/non-string inputs", async () => {
    const { PptxAdapter } = await import("../../../../js/agents/ingest/adapters/pptx.js");

    const adapter = new PptxAdapter();
    await expect(adapter.parse({ name: "bad.pptx" })).rejects.toThrow(/missing arrayBuffer/i);

    // @ts-expect-error - intentional bad input for runtime validation.
    await expect(adapter.parse(123)).rejects.toThrow(/input must be a path string/i);
  });
});
