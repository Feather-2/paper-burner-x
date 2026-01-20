import { describe, it, expect, vi, beforeEach } from "vitest";

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
  readTextFromPath: vi.fn(),
}));
const sharedMocks = vi.hoisted(() => ({
  isPlainObject: vi.fn(),
  toNonEmptyString: vi.fn(),
}));
const sourceKindMock = vi.hoisted(() => ({ HTML: "html" }));
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
  readTextFromPath: nodeIoMocks.readTextFromPath,
}));

vi.mock("../../../../../js/agents/shared/index.js", () => ({
  isPlainObject: sharedMocks.isPlainObject,
  toNonEmptyString: sharedMocks.toNonEmptyString,
}));

vi.mock("turndown", () => ({
  get default() {
    if (turndownMockControl.throwOnDefaultAccess) {
      throw new Error("turndown unavailable (mocked)");
    }
    if (turndownMockControl.defaultExportMode === "undefined") return undefined;
    if (turndownMockControl.defaultExportMode === "object") return {};
    return turndownMocks.TurndownService;
  },
}));

import { HtmlAdapter, __internal } from "../../../../../js/agents/ingest/adapters/html.js";
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
  const ext = String(id || "").split(".").pop();
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();

  baseAdapterMocks.buildParsedDocument.mockReset();
  baseAdapterMocks.buildParsedDocument.mockImplementation((params = {}) => {
    const assets = Array.isArray(params.assets) ? params.assets : [];
    const originName = params.origin && typeof params.origin === "object" ? params.origin.filename : "unknown";
    return {
      ...params,
      docId: params.docId || `doc_${originName || "unknown"}`,
      assets,
    };
  });

  extractAssetsFromMarkdownMock.mockReset();
  extractAssetsFromMarkdownMock.mockImplementation(defaultExtractAssetsFromMarkdown);

  nodeIoMocks.basenameOfPath.mockReset();
  nodeIoMocks.basenameOfPath.mockImplementation(async (path) => defaultBasenameOfPath(path));
  nodeIoMocks.readTextFromPath.mockReset();
  nodeIoMocks.readTextFromPath.mockResolvedValue({ text: "", size: 0 });

  sharedMocks.isPlainObject.mockReset();
  sharedMocks.isPlainObject.mockImplementation(defaultIsPlainObject);
  sharedMocks.toNonEmptyString.mockReset();
  sharedMocks.toNonEmptyString.mockImplementation(defaultToNonEmptyString);

  turndownMockControl.throwOnDefaultAccess = false;
  turndownMockControl.defaultExportMode = "function";
  turndownMocks.ctor.mockReset();
  turndownMocks.turndown.mockReset();
  turndownMocks.turndown.mockImplementation((html) => String(html || ""));
});

describe("HtmlAdapter", () => {
  it("normalizes maxFileSize boundaries", () => {
    const fallback = 10 * 1024 * 1024;
    const cases = [
      { input: Infinity, expected: Infinity },
      { input: 0, expected: fallback },
      { input: -1, expected: fallback },
      { input: Number.MAX_SAFE_INTEGER, expected: Number.MAX_SAFE_INTEGER },
      { input: "16", expected: 16 },
    ];

    for (const { input, expected } of cases) {
      const adapter = new HtmlAdapter({ maxFileSize: input });
      expect(adapter.maxFileSize).toBe(expected);
    }
  });

  it("rejects path inputs when allowPathRead is false (including empty string)", async () => {
    const adapter = new HtmlAdapter();
    const paths = ["./index.html", ""];

    for (const path of paths) {
      await expect(adapter.parse(path)).rejects.toThrow(/path string inputs are disabled/i);
    }

    expect(nodeIoMocks.readTextFromPath).not.toHaveBeenCalled();
  });

  it("parses path inputs with allowPathRead and extracts assets", async () => {
    const html = '<h1>Title</h1><img src="data:image/png;base64,AAAA"><p>Body</p>';
    nodeIoMocks.basenameOfPath.mockResolvedValueOnce("page.html");
    nodeIoMocks.readTextFromPath.mockResolvedValueOnce({ text: html, size: html.length });

    const ctor = vi.fn();
    class TurndownServiceStub {
      constructor(options) {
        ctor(options);
      }
      turndown(inputHtml) {
        expect(inputHtml).toContain('src="images/html_img_1.png"');
        expect(inputHtml).not.toContain("data:image/");
        return "# Title\n\n![img](images/html_img_1.png)\n\n![embedded](data:image/gif;base64,BBBB)\n";
      }
    }

    const adapter = new HtmlAdapter({ maxFileSize: 1024 });
    const parsed = await adapter.parse("/docs/page.html", { allowPathRead: true, TurndownService: TurndownServiceStub });

    expect(nodeIoMocks.basenameOfPath).toHaveBeenCalledWith("/docs/page.html");
    expect(nodeIoMocks.readTextFromPath).toHaveBeenCalledWith("/docs/page.html", { maxBytes: adapter.maxFileSize });
    expect(ctor).toHaveBeenCalledWith({ headingStyle: "atx", codeBlockStyle: "fenced" });

    expect(parsed.sourceType).toBe(SourceKind.HTML);
    expect(parsed.origin).toEqual({ filename: "page.html", mimeType: "text/html", size: html.length });
    expect(parsed.metadata).toEqual({ title: "page.html" });
    expect(parsed.markdown).toContain("images/html_extracted_2.gif");
    expect(parsed.markdown).not.toContain("data:image");

    expect(extractAssetsFromMarkdownMock).toHaveBeenCalledTimes(1);
    const [markdownArg, imagesArg] = extractAssetsFromMarkdownMock.mock.calls[0];
    expect(markdownArg).toBe(parsed.markdown);
    expect(imagesArg).toEqual([
      { id: "html_img_1.png", data: "AAAA" },
      { id: "html_extracted_2.gif", data: "BBBB" },
    ]);

    expect(parsed.assets).toHaveLength(2);
    for (const asset of parsed.assets) {
      expect(asset.source).toBe("extracted");
      expect(asset.docId).toBe(parsed.docId);
    }
  });

  it("prefers injected TurndownService for text() input with whitespace names and size 0", async () => {
    const textFn = vi.fn(async () => "<p>Hello</p>");
    const ctor = vi.fn();
    class TurndownServiceStub {
      constructor(options) {
        ctor(options);
      }
      turndown(html) {
        return `MD:${html}`;
      }
    }

    const adapter = new HtmlAdapter();
    const parsed = await adapter.parse(
      { name: "   ", filename: "  ", size: 0, text: textFn },
      { TurndownService: TurndownServiceStub }
    );

    expect(textFn).toHaveBeenCalledTimes(1);
    expect(ctor).toHaveBeenCalledWith({ headingStyle: "atx", codeBlockStyle: "fenced" });
    expect(parsed.origin.filename).toBe("document.html");
    expect(parsed.origin.mimeType).toBe("text/html");
    expect(parsed.origin.size).toBe(0);
    expect(parsed.markdown).toBe("MD:<p>Hello</p>");
  });

  it("parses arrayBuffer() input and infers size", async () => {
    const encoder = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
    const bytes = encoder ? encoder.encode("<p>Buffer</p>") : new Uint8Array(Buffer.from("<p>Buffer</p>", "utf8"));
    const arrayBuffer = vi.fn(async () => bytes);
    let seenHtml = "";
    class TurndownServiceStub {
      turndown(html) {
        seenHtml = html;
        return "md";
      }
    }

    const adapter = new HtmlAdapter();
    const parsed = await adapter.parse({ name: "buf.html", arrayBuffer }, { TurndownService: TurndownServiceStub });

    expect(arrayBuffer).toHaveBeenCalledTimes(1);
    expect(seenHtml).toBe("<p>Buffer</p>");
    expect(parsed.origin.size).toBe(bytes.byteLength);
  });

  it("accepts content string on plain objects and preserves size -1", async () => {
    class TurndownServiceStub {
      turndown() {
        return "ok";
      }
    }

    const adapter = new HtmlAdapter();
    const parsed = await adapter.parse(
      { name: "inline.html", size: -1, content: "<p>x</p>" },
      { TurndownService: TurndownServiceStub }
    );

    expect(sharedMocks.isPlainObject).toHaveBeenCalled();
    expect(parsed.origin.filename).toBe("inline.html");
    expect(parsed.origin.size).toBe(-1);
    expect(parsed.markdown).toBe("ok");
  });

  it("rejects invalid input types and unsupported file-like shapes", async () => {
    const adapter = new HtmlAdapter();
    const invalidTypes = [null, undefined, 123, true];
    for (const input of invalidTypes) {
      await expect(adapter.parse(input)).rejects.toThrow(/input must be a path string/i);
    }

    const unsupported = [
      {},
      [],
      { 0: "x", length: 1 },
      { content: [] },
      { text: "nope" },
    ];
    for (const input of unsupported) {
      await expect(adapter.parse(input)).rejects.toThrow(/unsupported file-like input/i);
    }
  });

  it("rejects oversized inputs early and via estimated size", async () => {
    const adapter = new HtmlAdapter({ maxFileSize: 1024 });
    const textFn = vi.fn(async () => "<p>ignored</p>");
    await expect(
      adapter.parse({ name: "huge.html", size: Number.MAX_SAFE_INTEGER, text: textFn })
    ).rejects.toThrow(/file too large/i);
    expect(textFn).not.toHaveBeenCalled();

    const adapter2 = new HtmlAdapter({ maxFileSize: "5" });
    await expect(
      adapter2.parse({ name: "estimate.html", content: "123456" })
    ).rejects.toThrow(/file too large/i);
  });

  it("parses long/deep content within maxFileSize", async () => {
    const deep = `${"<div>".repeat(200)}${"x".repeat(50000)}${"</div>".repeat(200)}`;
    class TurndownServiceStub {
      turndown(html) {
        expect(html).toBe(deep);
        return "# ok";
      }
    }

    const adapter = new HtmlAdapter({ maxFileSize: 200000 });
    const parsed = await adapter.parse({ name: "deep.html", content: deep }, { TurndownService: TurndownServiceStub });

    expect(parsed.markdown).toBe("# ok");
    expect(extractAssetsFromMarkdownMock).toHaveBeenCalledWith("# ok", []);
  });

  it("handles concurrent and rapid sequential parse calls", async () => {
    class TurndownServiceStub {
      turndown(html) {
        return `md:${html}`;
      }
    }

    const adapter = new HtmlAdapter();
    const [first, second] = await Promise.all([
      adapter.parse({ name: "a.html", content: "<p>A</p>" }, { TurndownService: TurndownServiceStub }),
      adapter.parse({ name: "b.html", content: "<p>B</p>" }, { TurndownService: TurndownServiceStub }),
    ]);

    expect(first.markdown).toBe("md:<p>A</p>");
    expect(second.markdown).toBe("md:<p>B</p>");

    const outputs = [];
    for (let i = 0; i < 3; i += 1) {
      outputs.push(
        await adapter.parse({ name: `s${i}.html`, content: `<p>${i}</p>` }, { TurndownService: TurndownServiceStub })
      );
    }
    expect(outputs.map((out) => out.markdown)).toEqual(["md:<p>0</p>", "md:<p>1</p>", "md:<p>2</p>"]);
  });

  it("uses dynamic turndown when no stageApi/global provided", async () => {
    delete globalThis.TurndownService;
    turndownMocks.turndown.mockReturnValue("md");

    const adapter = new HtmlAdapter();
    const parsed = await adapter.parse({ name: "x.html", content: "<p>x</p>" });

    expect(turndownMocks.ctor).toHaveBeenCalledWith({ headingStyle: "atx", codeBlockStyle: "fenced" });
    expect(parsed.markdown).toBe("md");
  });

  it("throws when TurndownService cannot be resolved", async () => {
    delete globalThis.TurndownService;
    turndownMockControl.defaultExportMode = "undefined";

    const adapter = new HtmlAdapter();
    await expect(adapter.parse({ name: "x.html", content: "<p>x</p>" })).rejects.toThrow(/TurndownService is required/i);
  });
});

describe("__internal.guessMimeType", () => {
  it("returns text/html for common and boundary filenames", () => {
    const cases = [
      "index.html",
      "INDEX.HTM",
      "file.txt",
      "",
      "   ",
      null,
      undefined,
    ];

    for (const input of cases) {
      expect(__internal.guessMimeType(input)).toBe("text/html");
    }
  });
});

describe("__internal.decodeUtf8", () => {
  it("decodes ArrayBuffer/ArrayBufferView and handles empty inputs", () => {
    const encoder = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
    const bytes = encoder ? encoder.encode("abc") : new Uint8Array(Buffer.from("abc", "utf8"));
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

    expect(__internal.decodeUtf8(buf)).toBe("abc");
    expect(__internal.decodeUtf8(bytes)).toBe("abc");
    expect(__internal.decodeUtf8(null)).toBe("");
    expect(__internal.decodeUtf8(undefined)).toBe("");
    expect(__internal.decodeUtf8({})).toBe("");
  });

  it("falls back when TextDecoder throws", () => {
    vi.stubGlobal("TextDecoder", class TextDecoder {
      constructor() {
        throw new Error("no decoder");
      }
    });

    const buf = new ArrayBuffer(0);
    expect(__internal.decodeUtf8(buf)).toBe("[object ArrayBuffer]");
  });
});

describe("__internal.resolveTurndownService", () => {
  it("prefers stageApi and falls back to globalThis", () => {
    const fromStage = function StageService() {};
    const fromGlobal = function GlobalService() {};

    expect(__internal.resolveTurndownService({ TurndownService: fromStage })).toBe(fromStage);

    vi.stubGlobal("TurndownService", fromGlobal);
    expect(__internal.resolveTurndownService({ TurndownService: "nope" })).toBe(fromGlobal);
  });

  it("returns null when no TurndownService is available", () => {
    delete globalThis.TurndownService;
    expect(__internal.resolveTurndownService({})).toBeNull();
    expect(__internal.resolveTurndownService(null)).toBeNull();
  });
});

describe("__internal.importTurndownService", () => {
  it("returns the turndown constructor when available", async () => {
    turndownMockControl.defaultExportMode = "function";
    const svc = await __internal.importTurndownService();
    expect(svc).toBe(turndownMocks.TurndownService);
  });

  it("returns null when default export is missing or throws", async () => {
    turndownMockControl.defaultExportMode = "undefined";
    await expect(__internal.importTurndownService()).resolves.toBeNull();

    turndownMockControl.throwOnDefaultAccess = true;
    await expect(__internal.importTurndownService()).resolves.toBeNull();
  });
});

describe("__internal.extFromMime", () => {
  it("maps common mime types and defaults to png", () => {
    expect(__internal.extFromMime("image/png")).toBe("png");
    expect(__internal.extFromMime("image/jpeg")).toBe("jpg");
    expect(__internal.extFromMime("image/jpg")).toBe("jpg");
    expect(__internal.extFromMime("image/gif")).toBe("gif");
    expect(__internal.extFromMime("image/webp")).toBe("webp");
    expect(__internal.extFromMime("image/svg+xml")).toBe("svg");
    expect(__internal.extFromMime("application/octet-stream")).toBe("png");
    expect(__internal.extFromMime(null)).toBe("png");
  });
});

describe("__internal.parseDataUri", () => {
  it("parses data URIs and returns null for invalid inputs", () => {
    expect(__internal.parseDataUri("not-a-data-uri")).toBeNull();
    expect(__internal.parseDataUri("")).toBeNull();
    expect(__internal.parseDataUri(null)).toBeNull();

    expect(__internal.parseDataUri("data:image/png;base64,AAAA")).toEqual({
      mimeType: "image/png",
      base64: "AAAA",
    });

    expect(__internal.parseDataUri("data:,abc")).toEqual({
      mimeType: "",
      base64: "abc",
    });
  });
});

describe("__internal.extractDataUriImagesFromHtml", () => {
  it("extracts data URI images and rewrites src attributes", () => {
    const html = [
      "<p>Hi</p>",
      '<img src="data:image/png;base64,AAAA">',
      "<img src='data:image/jpeg;base64,BBBB'>",
      '<img src="https://example.com/x.png">',
    ].join("");

    const result = __internal.extractDataUriImagesFromHtml(html, { idPrefix: "asset" });

    expect(result.html).toContain('src="images/asset_1.png"');
    expect(result.html).toContain("src='images/asset_2.jpg'");
    expect(result.html).toContain('src="https://example.com/x.png"');
    expect(result.images).toEqual([
      { id: "asset_1.png", data: "AAAA" },
      { id: "asset_2.jpg", data: "BBBB" },
    ]);
    expect(result.nextIndex).toBe(2);
  });

  it("ignores invalid data URIs and handles empty inputs", () => {
    const html = '<img src="data:image/png;">';
    const result = __internal.extractDataUriImagesFromHtml(html);
    expect(result.images).toEqual([]);
    expect(result.html).toBe(html);

    const empty = __internal.extractDataUriImagesFromHtml([]);
    expect(empty.html).toBe("");
    expect(empty.images).toEqual([]);
    expect(empty.nextIndex).toBe(0);
  });
});

describe("__internal.extractEmbeddedDataUriImagesFromMarkdown", () => {
  it("extracts embedded markdown data URIs and preserves alt text", () => {
    const markdown = [
      "![alt](data:image/png;base64,AAAA)",
      "![](data:image/jpeg;base64,BBBB)",
    ].join("\n");

    const result = __internal.extractEmbeddedDataUriImagesFromMarkdown(markdown, { idPrefix: "md", startIndex: 2 });

    expect(result.markdown).toContain("![alt](images/md_3.png)");
    expect(result.markdown).toContain("![image](images/md_4.jpeg)");
    expect(result.images).toEqual([
      { id: "md_3.png", data: "AAAA" },
      { id: "md_4.jpeg", data: "BBBB" },
    ]);
    expect(result.nextIndex).toBe(4);
  });

  it("handles empty and non-string markdown inputs", () => {
    const empty = __internal.extractEmbeddedDataUriImagesFromMarkdown("");
    expect(empty.images).toEqual([]);
    expect(empty.markdown).toBe("");

    const fromObject = __internal.extractEmbeddedDataUriImagesFromMarkdown({});
    expect(fromObject.images).toEqual([]);
  });
});
