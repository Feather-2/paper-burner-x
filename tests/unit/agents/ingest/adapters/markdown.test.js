import { describe, it, expect, vi, beforeEach } from "vitest";

const nodeIoMocks = vi.hoisted(() => ({
  basenameOfPath: vi.fn(),
  readTextFromPath: vi.fn(),
  isNodeEnvironment: vi.fn(),
}));

const sharedMocks = vi.hoisted(() => ({
  isPlainObject: vi.fn((v) => {
    if (v === null || typeof v !== "object") return false;
    if (Array.isArray(v)) return false;
    const proto = Object.getPrototypeOf(v);
    return proto === Object.prototype || proto === null;
  }),
  toNonEmptyString: vi.fn((v) => {
    if (v === undefined || v === null) return undefined;
    const s = String(v).trim();
    return s.length ? s : undefined;
  }),
}));

const sourceKindMock = vi.hoisted(() => ({ MARKDOWN: "mock-markdown" }));

vi.mock("../../../../../js/agents/ingest/adapters/node-io.js", () => ({
  basenameOfPath: nodeIoMocks.basenameOfPath,
  readTextFromPath: nodeIoMocks.readTextFromPath,
  isNodeEnvironment: nodeIoMocks.isNodeEnvironment,
}));

vi.mock("../../../../../js/agents/shared/index.js", () => ({
  isPlainObject: sharedMocks.isPlainObject,
  toNonEmptyString: sharedMocks.toNonEmptyString,
}));

vi.mock("../../../../../js/agents/ingest/constants.js", () => ({
  SourceKind: sourceKindMock,
}));

vi.mock("../../../../../js/agents/ingest/adapters/base.js", () => {
  class BaseAdapter {
    constructor(options = {}) {
      this.adapterName = options.adapterName || "base";
    }

    buildParsedDocument(params = {}) {
      return { built: true, ...params };
    }
  }

  return { BaseAdapter };
});

import { MarkdownAdapter } from "../../../../../js/agents/ingest/adapters/markdown.js";
import { SourceKind } from "../../../../../js/agents/ingest/constants.js";

describe("MarkdownAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    nodeIoMocks.isNodeEnvironment.mockReturnValue(true);
    nodeIoMocks.basenameOfPath.mockImplementation((path) => {
      const parts = String(path || "").split(/[\\/]/);
      return parts[parts.length - 1] || String(path || "");
    });
    nodeIoMocks.readTextFromPath.mockResolvedValue({ text: "", size: 0 });
  });

  it("constructs with adapterName markdown", () => {
    const adapter = new MarkdownAdapter();
    expect(adapter.adapterName).toBe("markdown");
  });

  it("parses path strings when allowPathRead is true", async () => {
    nodeIoMocks.basenameOfPath.mockReturnValueOnce("README.md");
    nodeIoMocks.readTextFromPath.mockResolvedValueOnce({ text: "# Hello", size: 7 });

    const adapter = new MarkdownAdapter();
    const parsed = await adapter.parse("/docs/README.md", { allowPathRead: true });

    expect(nodeIoMocks.basenameOfPath).toHaveBeenCalledWith("/docs/README.md");
    expect(nodeIoMocks.readTextFromPath).toHaveBeenCalledWith("/docs/README.md");
    expect(parsed.sourceType).toBe(SourceKind.MARKDOWN);
    expect(parsed.origin).toEqual({ filename: "README.md", mimeType: "text/markdown", size: 7 });
    expect(parsed.markdown).toBe("# Hello");
    expect(parsed.assets).toEqual([]);
    expect(parsed.metadata).toEqual({ title: "README.md" });
    expect(parsed.parseInfo.adapter).toBe("markdown");
    expect(parsed.parseInfo.durationMs).toEqual(expect.any(Number));
    expect(parsed.parseInfo.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("rejects path strings when allowPathRead is false", async () => {
    const adapter = new MarkdownAdapter();

    await expect(adapter.parse("/docs/README.md")).rejects.toThrow(
      "MarkdownAdapter: path string inputs are disabled (set allowPathRead:true to enable in Node.js)"
    );
    expect(nodeIoMocks.readTextFromPath).not.toHaveBeenCalled();
  });

  it("falls back to path splitting when not in a Node environment", async () => {
    nodeIoMocks.isNodeEnvironment.mockReturnValue(false);
    nodeIoMocks.readTextFromPath.mockResolvedValueOnce({ text: "content", size: 7 });

    const adapter = new MarkdownAdapter();
    const parsed = await adapter.parse("dir\\sub/guide.markdown", { allowPathRead: true });

    expect(nodeIoMocks.basenameOfPath).not.toHaveBeenCalled();
    expect(parsed.origin.filename).toBe("guide.markdown");
    expect(parsed.origin.mimeType).toBe("text/markdown");
  });

  it("parses file-like inputs with text() and trims names", async () => {
    const textFn = vi.fn(async () => "hi");
    const adapter = new MarkdownAdapter();

    const parsed = await adapter.parse({
      name: "  note.txt  ",
      type: " ",
      size: 0,
      text: textFn,
    });

    expect(textFn).toHaveBeenCalledTimes(1);
    expect(parsed.origin.filename).toBe("note.txt");
    expect(parsed.origin.mimeType).toBe("text/plain");
    expect(parsed.origin.size).toBe(0);
    expect(parsed.markdown).toBe("hi");
  });

  it("parses file-like inputs with arrayBuffer() and derives size for large files", async () => {
    const size = 1024 * 256;
    const data = new Uint8Array(size);
    data.fill(97);

    const arrayBufferFn = vi.fn(async () => data);
    const adapter = new MarkdownAdapter();

    const parsed = await adapter.parse({ name: "large.md", arrayBuffer: arrayBufferFn });

    expect(arrayBufferFn).toHaveBeenCalledTimes(1);
    expect(parsed.origin.mimeType).toBe("text/markdown");
    expect(parsed.origin.size).toBe(size);
    expect(parsed.markdown.length).toBe(size);
    expect(parsed.markdown.slice(0, 1)).toBe("a");
    expect(parsed.markdown.slice(-1)).toBe("a");
  });

  it("parses plain object inputs with content and deep nesting", async () => {
    const content = "x".repeat(200000);
    const nested = { depth: 0 };
    let cursor = nested;
    for (let i = 0; i < 20; i += 1) {
      cursor.child = { depth: i + 1 };
      cursor = cursor.child;
    }

    const adapter = new MarkdownAdapter();
    const parsed = await adapter.parse({ name: "deep.markdown", content, nested });

    expect(parsed.origin.filename).toBe("deep.markdown");
    expect(parsed.origin.mimeType).toBe("text/markdown");
    expect(parsed.origin.size).toBe(undefined);
    expect(parsed.markdown.length).toBe(content.length);
  });

  it("rejects empty object inputs", async () => {
    const adapter = new MarkdownAdapter();
    await expect(adapter.parse({})).rejects.toThrow("MarkdownAdapter.parse(input): unsupported file-like input");
  });

  it("rejects empty array inputs", async () => {
    const adapter = new MarkdownAdapter();
    await expect(adapter.parse([])).rejects.toThrow("MarkdownAdapter.parse(input): unsupported file-like input");
  });

  it("rejects null inputs", async () => {
    const adapter = new MarkdownAdapter();
    await expect(adapter.parse(null)).rejects.toThrow("MarkdownAdapter.parse(input): input must be a path string or a file-like object");
  });

  it("rejects undefined inputs", async () => {
    const adapter = new MarkdownAdapter();
    await expect(adapter.parse(undefined)).rejects.toThrow("MarkdownAdapter.parse(input): input must be a path string or a file-like object");
  });

  it("handles boundary size values and numeric strings", async () => {
    const adapter = new MarkdownAdapter();
    const cases = [
      { size: 0, expected: 0 },
      { size: -1, expected: -1 },
      { size: Number.MAX_SAFE_INTEGER, expected: Number.MAX_SAFE_INTEGER },
      { size: "123", expected: undefined },
    ];

    for (const entry of cases) {
      const parsed = await adapter.parse({ name: "edge.md", content: "ok", size: entry.size });
      expect(parsed.origin.size).toBe(entry.expected);
    }
  });

  it("handles empty string path inputs", async () => {
    nodeIoMocks.basenameOfPath.mockReturnValueOnce("");
    nodeIoMocks.readTextFromPath.mockResolvedValueOnce({ text: "", size: 0 });

    const adapter = new MarkdownAdapter();
    const parsed = await adapter.parse("", { allowPathRead: true });

    expect(nodeIoMocks.readTextFromPath).toHaveBeenCalledWith("");
    expect(parsed.origin.filename).toBe("");
    expect(parsed.origin.mimeType).toBe("text/plain");
    expect(parsed.origin.size).toBe(0);
  });

  it("falls back to untitled.md when the name is whitespace", async () => {
    const adapter = new MarkdownAdapter();
    const parsed = await adapter.parse({ name: "   ", text: async () => "data" });

    expect(parsed.origin.filename).toBe("untitled.md");
  });

  it("supports concurrent parse calls", async () => {
    nodeIoMocks.basenameOfPath.mockReturnValueOnce("a.md").mockReturnValueOnce("b.txt");
    nodeIoMocks.readTextFromPath
      .mockResolvedValueOnce({ text: "A", size: 1 })
      .mockResolvedValueOnce({ text: "B", size: 1 });

    const adapter = new MarkdownAdapter();
    const [first, second] = await Promise.all([
      adapter.parse("/tmp/a.md", { allowPathRead: true }),
      adapter.parse("/tmp/b.txt", { allowPathRead: true }),
    ]);

    expect(first.origin.filename).toBe("a.md");
    expect(first.origin.mimeType).toBe("text/markdown");
    expect(first.markdown).toBe("A");

    expect(second.origin.filename).toBe("b.txt");
    expect(second.origin.mimeType).toBe("text/plain");
    expect(second.markdown).toBe("B");
  });

  it("supports rapid sequential parse calls", async () => {
    const adapter = new MarkdownAdapter();
    const inputs = Array.from({ length: 5 }, (_, index) => ({
      name: `file-${index}.md`,
      content: `content-${index}`,
    }));

    const results = [];
    for (const input of inputs) {
      results.push(await adapter.parse(input));
    }

    expect(results.map((result) => result.markdown)).toEqual([
      "content-0",
      "content-1",
      "content-2",
      "content-3",
      "content-4",
    ]);
  });
});
