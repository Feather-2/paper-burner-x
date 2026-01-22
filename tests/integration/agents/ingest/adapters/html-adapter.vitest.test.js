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
  defaultExportMode: "function",
}));

vi.mock("turndown", () => ({
  get default() {
    // `importTurndownService()` does `mod?.default || mod`. Throwing from this getter
    // exercises the try/catch "import failed" path without needing per-test re-mocking.
    if (turndownMockControl.throwOnDefaultAccess) throw new Error("turndown unavailable (mocked)");
    if (turndownMockControl.defaultExportMode === "undefined") return undefined;
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
    turndownMockControl.defaultExportMode = "function";

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

    const { HtmlAdapter } = await import("../../../../../js/agents/ingest/adapters/html.js");

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
    const parsed = await adapter.parse(htmlPath, { allowPathRead: true });

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
    const { HtmlAdapter } = await import("../../../../../js/agents/ingest/adapters/html.js");

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
    const { HtmlAdapter } = await import("../../../../../js/agents/ingest/adapters/html.js");

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
    const { HtmlAdapter } = await import("../../../../../js/agents/ingest/adapters/html.js");

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
    const { HtmlAdapter } = await import("../../../../../js/agents/ingest/adapters/html.js");

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

  it("covers filename fallbacks, explicit size branch, and UTF-8 ArrayBuffer decoding (special chars)", async () => {
    const { HtmlAdapter } = await import("../../../../../js/agents/ingest/adapters/html.js");

    const html = "<p>Hi\u00A0你好 &amp; &lt;tag&gt; ©</p>";
    const buf = Buffer.from(html, "utf8");
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const arrayBuffer = vi.fn(async () => ab);

    class TurndownServiceStub {
      turndown(inputHtml) {
        // Verify UTF-8 decode preserves special characters.
        expect(inputHtml).toContain("Hi\u00A0你好");
        expect(inputHtml).toContain("&amp;");
        expect(inputHtml).toContain("&lt;tag&gt;");
        expect(inputHtml).toContain("©");
        return "md";
      }
    }

    const adapter = new HtmlAdapter({ defaultChunkOptions: { chunkSize: 64, overlap: 0, includeLineNumbers: false } });
    const parsed = await adapter.parse(
      {
        // Blank name -> falls back to `filename` branch.
        name: "   ",
        filename: "from-filename.htm",
        // Blank `type` -> uses `mimeType` branch.
        type: "",
        mimeType: "text/html",
        // Finite size -> exercises the `Number.isFinite(input.size)` true branch.
        size: 999,
        arrayBuffer,
      },
      { TurndownService: TurndownServiceStub }
    );

    expect(arrayBuffer).toHaveBeenCalledTimes(1);
    expect(parsed.origin.filename).toBe("from-filename.htm");
    expect(parsed.origin.mimeType).toBe("text/html");
    // Explicit size should win over inferred ArrayBuffer length.
    expect(parsed.origin.size).toBe(999);
    expect(parsed.markdown).toBe("md");
  });

  it("infers size from ArrayBuffer when input.size is missing (ArrayBuffer branch)", async () => {
    const { HtmlAdapter } = await import("../../../../../js/agents/ingest/adapters/html.js");

    const html = "<p>abc</p>";
    const buf = Buffer.from(html, "utf8");
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const arrayBuffer = vi.fn(async () => ab);

    class TurndownServiceStub {
      turndown(inputHtml) {
        expect(inputHtml).toContain(html);
        return "ok";
      }
    }

    const adapter = new HtmlAdapter({ defaultChunkOptions: { chunkSize: 64, overlap: 0, includeLineNumbers: false } });
    const parsed = await adapter.parse({ name: "buf.html", arrayBuffer }, { TurndownService: TurndownServiceStub });

    expect(arrayBuffer).toHaveBeenCalledTimes(1);
    expect(parsed.origin.size).toBe(buf.byteLength);
  });

  it("handles non-ArrayBuffer arrayBuffer() results: empty HTML + undefined size + empty markdown", async () => {
    const { HtmlAdapter } = await import("../../../../../js/agents/ingest/adapters/html.js");

    const arrayBuffer = vi.fn(async () => "not-bytes");

    class TurndownServiceStub {
      turndown(inputHtml) {
        // decodeUtf8() falls back to decoding an empty buffer for non-bytes.
        expect(inputHtml).toBe("");
        return "";
      }
    }

    const adapter = new HtmlAdapter({ defaultChunkOptions: { chunkSize: 64, overlap: 0, includeLineNumbers: false } });
    const parsed = await adapter.parse({ name: "weird.html", size: Number.NaN, arrayBuffer }, { TurndownService: TurndownServiceStub });

    expect(arrayBuffer).toHaveBeenCalledTimes(1);
    expect(parsed.origin.size).toBeUndefined();
    expect(parsed.markdown).toBe("");
    expect(parsed.assets).toHaveLength(0);
  });

  it("parses data URIs without `;` and skips malformed URIs with no payload (HTML extraction boundaries)", async () => {
    const { HtmlAdapter } = await import("../../../../../js/agents/ingest/adapters/html.js");

    const html = [
      // No `;base64,` segment -> semi=-1, comma>5 -> still extracts.
      '<img alt="ok" src="data:image/png,AAAA">',
      // No comma payload -> should not extract; leaves HTML untouched for this image.
      '<img alt="bad" src="data:image/pngbase64BBBB">',
      "",
    ].join("");

    class TurndownServiceStub {
      turndown(inputHtml) {
        expect(inputHtml).toContain('src="images/html_img_1.png"');
        expect(inputHtml).toContain('src="data:image/pngbase64BBBB"');
        return ["![](images/html_img_1.png)", "![](data:image/pngbase64BBBB)", ""].join("\n");
      }
    }

    const adapter = new HtmlAdapter({ defaultChunkOptions: { chunkSize: 64, overlap: 0, includeLineNumbers: false } });
    const parsed = await adapter.parse({ name: "x.html", content: html }, { TurndownService: TurndownServiceStub });

    expect(parsed.assets).toHaveLength(1);
    expect(parsed.assets[0].data).toBe("AAAA");
  });

  it("reports a helpful error when `turndown` resolves but does not export a function (default undefined)", async () => {
    delete globalThis.TurndownService;
    turndownMockControl.defaultExportMode = "undefined";

    const { HtmlAdapter } = await import("../../../../../js/agents/ingest/adapters/html.js");
    const adapter = new HtmlAdapter();

    await expect(adapter.parse({ name: "x.html", content: "<p>x</p>" })).rejects.toThrow(/TurndownService is required/i);
  });

  it("falls back to document.html when neither name nor filename is provided (file-like boundary)", async () => {
    const { HtmlAdapter } = await import("../../../../../js/agents/ingest/adapters/html.js");

    class TurndownServiceStub {
      turndown() {
        return "ok";
      }
    }

    const adapter = new HtmlAdapter({ defaultChunkOptions: { chunkSize: 64, overlap: 0, includeLineNumbers: false } });
    const parsed = await adapter.parse({ content: "<p>x</p>" }, { TurndownService: TurndownServiceStub });
    expect(parsed.origin.filename).toBe("document.html");
  });

  it("exposes internal helpers for unit testing (parseDataUri/extFromMime/idPrefix fallback)", async () => {
    const { __internal } = await import("../../../../../js/agents/ingest/adapters/html.js");

    // guessMimeType(): `filename || ""` falsy branch.
    expect(__internal.guessMimeType(undefined)).toBe("text/html");

    // parseDataUri(): `dataUri || ""` + `!startsWith(\"data:\")` branches.
    expect(__internal.parseDataUri(undefined)).toBeNull();
    expect(__internal.parseDataUri("http://example.com")).toBeNull();

    // extFromMime(): `mimeType || \"\"` branch.
    expect(__internal.extFromMime(undefined)).toBe("png");

    // Embedded markdown extractor: `idPrefix || \"img\"` fallback branch.
    const embedded = __internal.extractEmbeddedDataUriImagesFromMarkdown("![x](data:image/png;base64,AAAA)", {});
    expect(embedded.markdown).toContain("images/img_1.png");
    expect(embedded.images).toEqual([{ id: "img_1.png", data: "AAAA" }]);
  });

  it("reports a helpful error when TurndownService cannot be resolved (import fails)", async () => {
    delete globalThis.TurndownService;
    turndownMockControl.throwOnDefaultAccess = true;

    const { HtmlAdapter } = await import("../../../../../js/agents/ingest/adapters/html.js");
    const adapter = new HtmlAdapter();

    await expect(adapter.parse({ name: "x.html", content: "<p>x</p>" })).rejects.toThrow(/TurndownService is required/i);
  });
});
