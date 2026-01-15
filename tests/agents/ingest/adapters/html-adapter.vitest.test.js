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

// HtmlAdapter optionally dynamic-imports `turndown`.
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
  throwOnDefaultAccess: false,
}));

vi.mock("turndown", () => ({
  get default() {
    // `importTurndownService()` does `mod?.default || mod`. Throwing from this getter
    // exercises the try/catch "import failed" path without needing per-test re-mocking.
    if (turndownMockControl.throwOnDefaultAccess) throw new Error("turndown unavailable (mocked)");
    return turndownMocks.TurndownService;
  },
}));

describe("HtmlAdapter (vitest)", () => {
  let priorTurndownService;
  let priorTextDecoder;

  beforeEach(() => {
    vi.resetModules();
    fsMocks.readFile.mockReset();
    turndownMocks.ctor.mockReset();
    turndownMocks.turndown.mockReset();
    turndownMockControl.throwOnDefaultAccess = false;

    priorTurndownService = globalThis.TurndownService;
    priorTextDecoder = globalThis.TextDecoder;
  });

  afterEach(() => {
    globalThis.TurndownService = priorTurndownService;
    globalThis.TextDecoder = priorTextDecoder;
    vi.clearAllMocks();
  });

  it("parses a path input via mocked fs.readFile(), imports turndown, and extracts data URI images", async () => {
    delete globalThis.TurndownService;

    const { HtmlAdapter } = await import("../../../../js/agents/ingest/adapters/html.js");

    const htmlPath = "/virtual/page.html";
    const html = [
      "<h1>Hi</h1>",
      "<p>Body</p>",
      '<img alt="a" src="data:image/png;base64,AAAA">',
      '<img alt="b" src="data:image/jpeg;base64,BBBB">',
      "",
    ].join("");

    fsMocks.readFile.mockResolvedValue(Buffer.from(html, "utf8"));

    turndownMocks.turndown.mockImplementation((inputHtml) => {
      // Data URIs should be rewritten before turndown runs.
      expect(inputHtml).toContain('src="images/html_img_1.png"');
      expect(inputHtml).toContain('src="images/html_img_2.jpg"');
      expect(inputHtml).not.toContain("data:image/");

      // Also exercise embedded base64 extraction/rewrite in markdown.
      return [
        "# Hi",
        "",
        "Body",
        "",
        "![a](images/html_img_1.png)",
        "![b](images/html_img_2.jpg)",
        "![embedded](data:image/png;base64,EMBEDDED)",
        "",
      ].join("\n");
    });

    const adapter = new HtmlAdapter({ defaultChunkOptions: { chunkSize: 64, overlap: 0, includeLineNumbers: false } });
    const parsed = await adapter.parse(htmlPath);

    expect(fsMocks.readFile).toHaveBeenCalledTimes(1);
    expect(fsMocks.readFile).toHaveBeenCalledWith(htmlPath);

    // Uses imported turndown.
    expect(turndownMocks.ctor).toHaveBeenCalledWith({ headingStyle: "atx", codeBlockStyle: "fenced" });

    expect(parsed.sourceType).toBe("html");
    expect(parsed.origin.filename).toBe("page.html");
    expect(parsed.origin.mimeType).toBe("text/html");
    expect(parsed.origin.size).toBe(Buffer.byteLength(html, "utf8"));

    // Embedded base64 should be rewritten away.
    expect(parsed.markdown).not.toContain("data:image/png;base64,EMBEDDED");
    // startIndex === extracted HTML image count (2) => first extracted is _3
    expect(parsed.markdown).toContain("images/html_extracted_3.png");

    // Assets include 2 images from HTML + 1 embedded markdown image.
    expect(parsed.assets).toHaveLength(3);
    const dataToMime = new Map(parsed.assets.map((a) => [a.data, a.mimeType]));
    expect(dataToMime.get("AAAA")).toBe("image/png");
    expect(dataToMime.get("BBBB")).toBe("image/jpeg");
    expect(dataToMime.get("EMBEDDED")).toBe("image/png");

    for (const a of parsed.assets) {
      expect(a.docId).toBe(parsed.docId);
      expect(a.source).toBe("extracted");
    }
  });

  it("prefers injected TurndownService and supports input.text()", async () => {
    const { HtmlAdapter } = await import("../../../../js/agents/ingest/adapters/html.js");

    const text = vi.fn(async () => "<p>Hello</p>");
    const ctor = vi.fn();
    class TurndownServiceStub {
      constructor(options) {
        ctor(options);
      }
      turndown(html) {
        expect(html).toContain("<p>Hello</p>");
        return "# From injected\n";
      }
    }

    const adapter = new HtmlAdapter({ defaultChunkOptions: { chunkSize: 64, overlap: 0, includeLineNumbers: false } });
    const parsed = await adapter.parse({ name: "x.htm", text }, { TurndownService: TurndownServiceStub });

    expect(text).toHaveBeenCalledTimes(1);
    expect(ctor).toHaveBeenCalledWith({ headingStyle: "atx", codeBlockStyle: "fenced" });
    expect(turndownMocks.ctor).not.toHaveBeenCalled();

    expect(parsed.origin.filename).toBe("x.htm");
    expect(parsed.origin.mimeType).toBe("text/html");
    expect(parsed.markdown).toBe("# From injected\n");
  });

  it("decodes input.arrayBuffer() and infers size; falls back when TextDecoder is unavailable", async () => {
    const { HtmlAdapter } = await import("../../../../js/agents/ingest/adapters/html.js");

    globalThis.TextDecoder = class TextDecoder {
      constructor() {
        throw new Error("no TextDecoder");
      }
    };

    const bytes = new Uint8Array([97, 98, 99]); // "abc"
    const arrayBuffer = vi.fn(async () => bytes);

    class TurndownServiceStub {
      turndown() {
        return "ok";
      }
    }

    const adapter = new HtmlAdapter({ defaultChunkOptions: { chunkSize: 64, overlap: 0, includeLineNumbers: false } });
    const parsed = await adapter.parse({ name: "buf.html", arrayBuffer }, { TurndownService: TurndownServiceStub });

    expect(arrayBuffer).toHaveBeenCalledTimes(1);
    expect(parsed.origin.size).toBe(3);
    expect(parsed.origin.mimeType).toBe("text/html");
  });

  it("accepts { content: string } and rejects unsupported file-like inputs", async () => {
    const { HtmlAdapter } = await import("../../../../js/agents/ingest/adapters/html.js");

    class TurndownServiceStub {
      turndown() {
        return "x";
      }
    }

    const adapter = new HtmlAdapter({ defaultChunkOptions: { chunkSize: 64, overlap: 0, includeLineNumbers: false } });
    const parsed = await adapter.parse({ name: "inline.html", content: "<p>x</p>" }, { TurndownService: TurndownServiceStub });
    expect(parsed.origin.filename).toBe("inline.html");
    expect(parsed.markdown).toBe("x");

    await expect(adapter.parse({ name: "bad.html" }, { TurndownService: TurndownServiceStub })).rejects.toThrow(/unsupported file-like input/i);

    // @ts-expect-error - intentional bad input for runtime validation.
    await expect(adapter.parse(123, { TurndownService: TurndownServiceStub })).rejects.toThrow(/input must be a path string/i);
  });

  it("covers extFromMime() branches (gif/webp/svg/default), globalThis.TurndownService, and guessMimeType() fallback", async () => {
    const { HtmlAdapter } = await import("../../../../js/agents/ingest/adapters/html.js");

    class TurndownServiceStub {
      turndown(inputHtml) {
        // Verify HTML data URIs were rewritten to stable `images/...` paths with the right extensions.
        expect(inputHtml).toContain('src="images/html_img_1.gif"');
        expect(inputHtml).toContain("src='images/html_img_2.webp'");
        expect(inputHtml).toContain('src="images/html_img_3.svg"');
        // Unknown mime defaults to .png
        expect(inputHtml).toContain('src="images/html_img_4.png"');

        return [
          "![](images/html_img_1.gif)",
          "![](images/html_img_2.webp)",
          "![](images/html_img_3.svg)",
          "![](images/html_img_4.png)",
          // Empty alt text -> `image` fallback in the rewrite helper.
          "![](data:image/png;base64,INLINE)",
          "",
        ].join("\n");
      }
    }

    globalThis.TurndownService = TurndownServiceStub;

    const adapter = new HtmlAdapter({ defaultChunkOptions: { chunkSize: 64, overlap: 0, includeLineNumbers: false } });
    const parsed = await adapter.parse({
      // Not .html/.htm -> exercises the (redundant) fallback branch in guessMimeType().
      name: "not-html.bin",
      content: [
        '<img src="data:image/gif;base64,GGGG">',
        "<img src='data:image/webp;base64,WWWW'>",
        '<img src="data:image/svg+xml;base64,SSSS">',
        '<img src="data:image/unknown;base64,UUUU">',
        "",
      ].join(""),
    });

    expect(turndownMocks.ctor).not.toHaveBeenCalled();
    expect(parsed.origin.mimeType).toBe("text/html");
    expect(parsed.markdown).toContain("![image](images/html_extracted_5.png)");

    // 4 extracted from HTML + 1 extracted from markdown.
    expect(parsed.assets).toHaveLength(5);
    const dataToMime = new Map(parsed.assets.map((a) => [a.data, a.mimeType]));
    expect(dataToMime.get("GGGG")).toBe("image/gif");
    expect(dataToMime.get("WWWW")).toBe("image/webp");
    expect(dataToMime.get("SSSS")).toBe("image/svg+xml");
    expect(dataToMime.get("UUUU")).toBe("image/png");
    expect(dataToMime.get("INLINE")).toBe("image/png");
  });

  it("reports a helpful error when TurndownService cannot be resolved (import fails)", async () => {
    delete globalThis.TurndownService;
    turndownMockControl.throwOnDefaultAccess = true;

    const { HtmlAdapter } = await import("../../../../js/agents/ingest/adapters/html.js");
    const adapter = new HtmlAdapter();

    await expect(adapter.parse({ name: "x.html", content: "<p>x</p>" })).rejects.toThrow(/TurndownService is required/i);
  });
});
