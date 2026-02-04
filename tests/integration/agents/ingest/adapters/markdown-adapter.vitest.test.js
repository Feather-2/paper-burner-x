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

describe("MarkdownAdapter (vitest)", () => {
  let priorTextDecoder;

  beforeEach(() => {
    vi.resetModules();
    fsMocks.readFile.mockReset();
    fsMocks.stat.mockReset();
    priorTextDecoder = globalThis.TextDecoder;
  });

  afterEach(() => {
    globalThis.TextDecoder = priorTextDecoder;
    vi.clearAllMocks();
  });

	  it("reads markdown from a path via mocked fs.readFile()", async () => {
	    const { MarkdownAdapter } = await import("../../../../../js/agents/ingest/adapters/markdown.js");

	    const mdPath = "/virtual/notes.MARKDOWN";
	    const body = "# Title\n\nHello\n";
	    fsMocks.stat.mockResolvedValue({ size: Buffer.byteLength(body, "utf8") });
	    fsMocks.readFile.mockResolvedValue(body);

	    const adapter = new MarkdownAdapter();
	    const parsed = await adapter.parse(mdPath, { allowPathRead: true });

	    expect(fsMocks.stat).toHaveBeenCalledTimes(1);
	    expect(fsMocks.stat).toHaveBeenCalledWith(mdPath);
	    expect(fsMocks.readFile).toHaveBeenCalledTimes(1);
	    expect(fsMocks.readFile).toHaveBeenCalledWith(mdPath, "utf8");

	    expect(parsed.sourceType).toBe("markdown");
	    expect(parsed.origin.filename).toBe("notes.MARKDOWN");
	    expect(parsed.origin.mimeType).toBe("text/markdown");
	    expect(parsed.markdown).toBe(body);
    expect(parsed.origin.size).toBe(Buffer.byteLength(body, "utf8"));
  });

  it("prefers input.text() when present", async () => {
    const { MarkdownAdapter } = await import("../../../../../js/agents/ingest/adapters/markdown.js");

    const text = vi.fn(async () => "hello");
    const adapter = new MarkdownAdapter();
    const parsed = await adapter.parse({ name: "x.txt", type: "text/plain", text });

    expect(text).toHaveBeenCalledTimes(1);
    expect(parsed.origin.mimeType).toBe("text/plain");
    expect(parsed.markdown).toBe("hello");
  });

  it("guesses text/plain for .txt inputs when type is missing", async () => {
    const { MarkdownAdapter } = await import("../../../../../js/agents/ingest/adapters/markdown.js");

    const text = vi.fn(async () => "hi");
    const adapter = new MarkdownAdapter();
    const parsed = await adapter.parse({ name: "notes.txt", text });

    expect(parsed.origin.mimeType).toBe("text/plain");
    expect(parsed.markdown).toBe("hi");
  });

  it("defaults unknown extensions to text/plain", async () => {
    const { MarkdownAdapter } = await import("../../../../../js/agents/ingest/adapters/markdown.js");

    const adapter = new MarkdownAdapter();
    const parsed = await adapter.parse({ name: "README", content: "x" });

    expect(parsed.origin.mimeType).toBe("text/plain");
    expect(parsed.markdown).toBe("x");
  });

  it("decodes input.arrayBuffer() as UTF-8 and infers size when missing", async () => {
    const { MarkdownAdapter } = await import("../../../../../js/agents/ingest/adapters/markdown.js");

    const bytes = new TextEncoder().encode("abc");
    const arrayBuffer = vi.fn(async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const adapter = new MarkdownAdapter();
    const parsed = await adapter.parse({ name: "buf.md", arrayBuffer });

    expect(arrayBuffer).toHaveBeenCalledTimes(1);
    expect(parsed.markdown).toBe("abc");
    expect(parsed.origin.size).toBe(3);
    expect(parsed.origin.mimeType).toBe("text/markdown");
  });

  it("handles input.arrayBuffer() returning a Uint8Array view", async () => {
    const { MarkdownAdapter } = await import("../../../../../js/agents/ingest/adapters/markdown.js");

    const bytes = new Uint8Array([97, 98, 99]); // "abc"
    const arrayBuffer = vi.fn(async () => bytes);

    const adapter = new MarkdownAdapter();
    const parsed = await adapter.parse({ name: "view.md", arrayBuffer });

    expect(parsed.markdown).toBe("abc");
    expect(parsed.origin.size).toBe(3);
  });

  it("accepts plain objects with { content: string }", async () => {
    const { MarkdownAdapter } = await import("../../../../../js/agents/ingest/adapters/markdown.js");

    const adapter = new MarkdownAdapter();
    const parsed = await adapter.parse({ name: "in-memory.md", content: "from content" });

    expect(parsed.markdown).toBe("from content");
    expect(parsed.origin.filename).toBe("in-memory.md");
  });

  it("falls back when TextDecoder is unavailable/throws", async () => {
    const { MarkdownAdapter } = await import("../../../../../js/agents/ingest/adapters/markdown.js");

    globalThis.TextDecoder = class TextDecoder {
      constructor() {
        throw new Error("no TextDecoder");
      }
    };

    const adapter = new MarkdownAdapter();
    const parsed = await adapter.parse({
      name: "raw.md",
      arrayBuffer: vi.fn(async () => new ArrayBuffer(2)),
    });

    expect(parsed.markdown).toContain("[object ArrayBuffer]");
  });

  it("throws on unsupported file-like inputs", async () => {
    const { MarkdownAdapter } = await import("../../../../../js/agents/ingest/adapters/markdown.js");

    const adapter = new MarkdownAdapter();
    await expect(adapter.parse({ name: "bad.md" })).rejects.toThrow(/unsupported file-like input/i);

    // @ts-expect-error - intentional bad input for runtime validation.
    await expect(adapter.parse(123)).rejects.toThrow(/input must be a path string/i);
  });
});
