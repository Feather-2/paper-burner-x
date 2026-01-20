import { describe, it, expect, beforeEach, afterEach } from "vitest";

const test = require("node:test");
const assert = require("node:assert/strict");

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");

function expectedChunkCount(textLen, { chunkSize, overlap }) {
  if (textLen <= 0) return 0;
  if (textLen <= chunkSize) return 1;
  const step = chunkSize - overlap;
  return 1 + Math.ceil((textLen - chunkSize) / step);
}

it("Ingest streaming: ByteBuffer append/slice/indexOf/consume", async () => {
  const { ByteBuffer } = await import("../../../js/agents/ingest/streaming/byte-buffer.js");

  const buf = new ByteBuffer();
  buf.append(new Uint8Array([1, 2, 3, 4]));
  buf.append([5, 6, 7]);

  expect(buf.length).toBe(7);
  expect(buf.indexOf([3, 4, 5])).toBe(2);
  expect(buf.indexOf([9])).toBe(-1);
  expect(Array.from(buf.slice(1, 4))).toEqual([2, 3, 4]);
  expect(Array.from(buf.slice(-2))).toEqual([6, 7]);

  // Cover compaction + growth paths deterministically.
  const big = new ByteBuffer();
  big.append(new Uint8Array(200).fill(1)); // alloc 256
  big.consume(100); // leave room at the front
  big.append(new Uint8Array(70).fill(2)); // triggers compaction (end+len exceeds cap but required fits)
  expect(big.length).toBe(170);
  expect(big.indexOf([2, 2, 2])).toBe(100);
  big.append(new Uint8Array(300).fill(3)); // triggers growth
  expect(big.length).toBe(470);
  expect(big.indexOf([3, 3, 3])).toBe(170);

  buf.consume(3);
  expect(buf.length).toBe(4);
  expect(Array.from(buf.slice())).toEqual([4, 5, 6, 7]);

  buf.append(new Uint8Array(250).fill(8)); // triggers compaction (end+len exceeds cap but required fits)
  expect(buf.indexOf([5, 6, 7])).toBe(1);
});

it("Ingest streaming: BaseAdapter.parseStream matches normalizeText+chunkText (string parts)", async () => {
  const { BaseAdapter } = await import("../../../js/agents/ingest/adapters/base.js");
  const { normalizeText } = await import("../../../js/agents/stages/textprep/normalize.js");
  const { chunkText } = await import("../../../js/agents/stages/textprep/chunk.js");

  const chunkOptions = { chunkSize: 6, overlap: 2, includeLineNumbers: true };

  const raw = "A\r\nB\rC\u00A0D\nE";
  const normalized = normalizeText(raw).normalized;
  const expected = chunkText(normalized, chunkOptions);

  async function* parts() {
    yield "A\r";
    yield "\nB\rC\u00A0";
    yield "D\nE";
  }

  const adapter = new BaseAdapter({ defaultChunkOptions: chunkOptions });
  const got = await adapter.parse(parts(), { chunkOptions });
  expect(got).toEqual(expected);
});

it("Ingest streaming: BaseAdapter.parseStream handles UTF-8 splits (Uint8Array parts)", async () => {
  const { BaseAdapter } = await import("../../../js/agents/ingest/adapters/base.js");
  const { normalizeText } = await import("../../../js/agents/stages/textprep/normalize.js");
  const { chunkText } = await import("../../../js/agents/stages/textprep/chunk.js");

  const chunkOptions = { chunkSize: 5, overlap: 1, includeLineNumbers: false };

  const raw = "Hi 你好\r\nZ";
  const normalized = normalizeText(raw).normalized;
  const expected = chunkText(normalized, chunkOptions);

  const bytes = new TextEncoder().encode(raw);
  // Split in the middle of the multi-byte "你" (3 bytes, starts at index 3).
  const p1 = bytes.slice(0, 4);
  const p2 = bytes.slice(4);

  async function* parts() {
    yield p1;
    yield p2;
  }

  const adapter = new BaseAdapter({ defaultChunkOptions: chunkOptions });
  const got = await adapter.parse(parts(), { chunkOptions });
  expect(got).toEqual(expected);
});

it("Ingest streaming: buildTocStreaming matches buildToc on overlapped chunks", async () => {
  const { normalizeText } = await import("../../../js/agents/stages/textprep/normalize.js");
  const { chunkText } = await import("../../../js/agents/stages/textprep/chunk.js");
  const { buildToc, buildTocStreaming } = await import("../../../js/agents/retrieval/toc-builder.js");

  const raw = [
    "# Title",
    "",
    "Intro text",
    "",
    "```",
    "# Not a heading (code fence)",
    "```",
    "",
    "1. Numbered Heading",
    "",
    "ALL CAPS HEADING",
    "",
    "## Subheading",
    "",
    "Tail",
  ].join("\n");

  const normalized = normalizeText(raw).normalized;
  const expected = buildToc(normalized, {});

  const chunks = chunkText(normalized, { chunkSize: 9, overlap: 3, includeLineNumbers: false });
  const got = await buildTocStreaming(chunks, {});
  expect(got).toEqual(expected);
});

it("Ingest streaming: buildTocStreaming fallback sections when no headings", async () => {
  const { normalizeText } = await import("../../../js/agents/stages/textprep/normalize.js");
  const { chunkText } = await import("../../../js/agents/stages/textprep/chunk.js");
  const { buildTocStreaming } = await import("../../../js/agents/retrieval/toc-builder.js");

  const raw = "plain text\nwith lines\nand no headings\n";
  const normalized = normalizeText(raw).normalized;
  const chunks = chunkText(normalized, { chunkSize: 10, overlap: 2, includeLineNumbers: false });
  const got = await buildTocStreaming(chunks, {});

  expect(got.tocNodes.length).toBe(0);
  expect(Array.isArray(got.fallbackSections)).toBe(true);
  expect(got.fallbackSections.length).toBeGreaterThan(0);
  expect(got.fallbackSections[0].locator.charStart).toBe(0);
  expect(got.fallbackSections.at(-1).locator.charEnd).toBe(normalized.length);
});

it("Ingest streaming: parseStream supports abort via AbortSignal", async () => {
  const { BaseAdapter } = await import("../../../js/agents/ingest/adapters/base.js");

  const adapter = new BaseAdapter({ defaultChunkOptions: { chunkSize: 20, overlap: 5, includeLineNumbers: false } });
  const text = "x".repeat(10_000);

  const controller = new AbortController();
  const readable = Readable.from([text]);

  let seen = 0;
  try {
    for await (const chunk of adapter.parseStream(readable, { signal: controller.signal })) {
      seen += 1;
      if (seen === 3) controller.abort();
    }
    throw new Error("expected abort" || 'Test failed');
  } catch (err) {
    expect(err && err.name).toBe("AbortError");
  }

  expect(readable.destroyed).toBe(true);
  expect(seen).toBe(3);
});

it("Ingest streaming: parseStream processes large files without pre-loading", async () => {
  const { BaseAdapter } = await import("../../../js/agents/ingest/adapters/base.js");
  const { normalizeText } = await import("../../../js/agents/stages/textprep/normalize.js");

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "pb-ingest-stream-"));
  const filePath = path.join(tmpDir, "large.md");

  const chunkOptions = { chunkSize: 8192, overlap: 256, includeLineNumbers: true };
  const adapter = new BaseAdapter({ defaultChunkOptions: chunkOptions });

  try {
    let raw = "";
    for (let i = 0; i < 800; i++) {
      raw += `# Section ${i}\r\n\r\n` + "lorem ipsum ".repeat(60) + "\r\n\r\n";
    }

    await fsp.writeFile(filePath, raw, "utf8");

    const normalizedLen = normalizeText(raw).normalized.length;
    const expectedCount = expectedChunkCount(normalizedLen, chunkOptions);

    const readStream = fs.createReadStream(filePath, { highWaterMark: 64 * 1024 });
    const chunks = [];
    for await (const c of adapter.parseStream(readStream, { chunkOptions })) chunks.push(c);

    expect(chunks.length).toBe(expectedCount);
    expect(chunks[0].locator.charStart).toBe(0);
    expect(chunks.at(-1).locator.charEnd).toBe(normalizedLen);
    if (chunks.length > 1) {
      expect(chunks[1].locator.charStart).toBe(chunks[0].locator.charEnd - chunkOptions.overlap);
    }
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  }
});
