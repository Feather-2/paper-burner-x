import { describe, it, expect, beforeEach, afterEach } from "vitest";

const assert = require("node:assert/strict");

const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pb_ingest_test_"));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

it("AssetManager: dedup by hash + per-doc refs", async () => {
  const { AssetManager } = await import("../../../js/agents/ingest/asset-manager.js");
  const m = new AssetManager();

  const a1 = { docId: "d1", type: "image", data: "data:image/png;base64,AAAA", mimeType: "image/png", source: "extracted", reusable: true };
  const a2 = { docId: "d1", type: "image", data: "data:image/png;base64,AAAA", mimeType: "image/png", source: "extracted", reusable: true, assetId: "custom" };
  const id1 = m.addAsset(a1);
  const id2 = m.addAsset(a2);

  expect(id1).toBe(id2);
  expect(m.count()).toBe(1);
  expect(m.getAsset(id1)).toMatchObject({
    assetId: id1,
    docId: "d1",
    type: "image",
    data: "data:image/png;base64,AAAA",
    mimeType: "image/png",
    source: "extracted",
    reusable: true,
  });
  expect(m.getAssetIdsForDoc("d1")).toEqual([id1]);

  const id3 = m.addAsset({ ...a1, docId: "d2" });
  expect(id3).toBe(id1);
  expect(m.getAssetIdsForDoc("d2")).toEqual([id1]);
});

it("AssetManager: hash collision stores distinct assets", async () => {
  const { AssetManager } = await import("../../../js/agents/ingest/asset-manager.js");
  const m = new AssetManager();

  // Force a sampling-hash collision by keeping the sampled slices identical and mutating
  // a character outside computeAssetHash()'s sampling windows.
  const payloadLen = 6000;
  const data1 = `data:image/png;base64,${"A".repeat(payloadLen)}`;
  const mutateAt = 3000; // outside 0..512, 1/3±256, 2/3±256, and last-512 windows
  const data2 = data1.slice(0, mutateAt) + "B" + data1.slice(mutateAt + 1);

  const id1 = m.addAsset({ docId: "d1", type: "image", data: data1, mimeType: "image/png", source: "extracted", reusable: true });
  const id2 = m.addAsset({ docId: "d1", type: "image", data: data2, mimeType: "image/png", source: "extracted", reusable: true });

  expect(id1).not.toBe(id2);
  expect(m.count()).toBe(2);
  expect(m.getAsset(id1)).toMatchObject({ assetId: id1, docId: "d1", data: data1 });
  expect(m.getAsset(id2)).toMatchObject({ assetId: id2, docId: "d1", data: data2 });
});

it("MarkdownAdapter: parses path string + file-like object", async () => {
  const { MarkdownAdapter } = await import("../../../js/agents/ingest/adapters/markdown.js");

  await withTempDir(async (dir) => {
    const mdPath = path.join(dir, "note.md");
    await fs.writeFile(mdPath, "# Title\n\nHello world.\n", "utf8");

    const adapter = new MarkdownAdapter({ defaultChunkOptions: { chunkSize: 8, overlap: 0, includeLineNumbers: true } });
    const parsed = await adapter.parse(mdPath);

    expect(parsed.sourceType).toBe("markdown");
    expect(parsed.docId).toMatch(/^markdown_/);
    expect(parsed.markdown.includes("Hello world")).toBe(true);
    expect(parsed.textHash.startsWith("sha256:")).toBe(true);
    expect(parsed.chunks).toBeInstanceOf(Array);
    expect(parsed.chunks.length).toBeGreaterThanOrEqual(2);
    expect(parsed.toc).toBeInstanceOf(Array);
    expect(parsed.toc.length).toBeGreaterThanOrEqual(1);
    expect(parsed.origin.filename).toBe("note.md");

    const parsed2 = await adapter.parse({
      name: "inline.txt",
      type: "text/plain",
      async text() {
        return "LINE1\nLINE2\n";
      },
    });
    expect(parsed2.sourceType).toBe("markdown");
    expect(parsed2.origin.filename).toBe("inline.txt");
    expect(parsed2.origin.mimeType).toBe("text/plain");
    expect(parsed2.textNormalized).toContain("LINE2");
  });
});

it("RawTextAdapter: validates input + produces ParsedDocument", async () => {
  const { RawTextAdapter } = await import("../../../js/agents/ingest/adapters/raw-text.js");
  const a = new RawTextAdapter({ defaultChunkOptions: { chunkSize: 10, overlap: 0, includeLineNumbers: false } });

  await expect(() => a.parse({ text: "   " })).rejects.toThrow(/input\.text is required/);

  const parsed = await a.parse({ text: "Alpha\nBeta\nGamma\n", title: "My Notes" });
  expect(parsed.sourceType).toBe("user_text");
  expect(parsed.metadata.title).toBe("My Notes");
  expect(parsed.textNormalized).toContain("Beta");
  expect(parsed.chunks).toBeInstanceOf(Array);
  expect(parsed.chunks.length).toBeGreaterThanOrEqual(2);
});

it("HistoryAdapter: loads record via injected storageAdapter + maps images to assets", async () => {
  const { HistoryAdapter } = await import("../../../js/agents/ingest/adapters/history.js");

  const storageAdapter = {
    async getResultFromDB(id) {
      if (id === "missing") return null;
      return {
        id,
        name: "Report.pdf",
        fileType: "pdf",
        ocr: "## Section\nSome text.\n",
        images: [{ id: "img-1.png", data: "data:image/png;base64,AAAA" }],
      };
    },
  };

  const a = new HistoryAdapter(storageAdapter, { defaultChunkOptions: { chunkSize: 50, overlap: 0, includeLineNumbers: false } });
  const parsed = await a.parse("h1");

  expect(parsed.origin.historyId).toBe("h1");
  expect(parsed.sourceType).toBe("pdf");
  expect(parsed.docId).toMatch(/^pdf_/);
  expect(parsed.assets).toBeInstanceOf(Array);
  expect(parsed.assets).toHaveLength(1);
  expect(parsed.assets[0].docId).toBe(parsed.docId);
  expect(parsed.assets[0].mimeType).toBe("image/png");

  await expect(() => a.parse("missing")).rejects.toThrow(/history record not found/);
});

it("IngestStage: dispatches rawTexts/historyIds/files + aggregates assets/errors/events", async () => {
  const { IngestStage } = await import("../../../js/agents/ingest/ingest-stage.js");

  await withTempDir(async (dir) => {
    const mdPath = path.join(dir, "a.md");
    await fs.writeFile(mdPath, "# A\n\nText.\n", "utf8");

    const storageAdapter = {
      async getResultFromDB(id) {
        return { id, name: "FromHistory.txt", fileType: "markdown", ocr: "History text.\n", images: [{ id: "img-1.png", data: "data:image/png;base64,AAAA" }] };
      },
    };

    const events = [];
    const emit = (name, record) => events.push({ name, record });

    const stage = new IngestStage({ defaultChunkOptions: { chunkSize: 20, overlap: 0, includeLineNumbers: true } });
    const out = await stage.execute(
      { runId: "run_ingest_test", constraints: {} },
      {
        rawTexts: [{ text: "Raw text input.\n", title: "Raw" }],
        historyIds: ["h1"],
        files: [mdPath, path.join(dir, "unsupported.pdf")],
        urls: ["https://example.com"],
      },
      { emit, storageAdapter }
    );

    expect(out.metrics.totalDocs).toBe(5);
    expect(out.metrics.successDocs).toBe(3);
    expect(out.metrics.failedDocs).toBe(2);
    expect(out.sources.length).toBe(3);
    expect(out.assets.length).toBe(1);
    expect(out.parseErrors.length).toBe(2);

    const kinds = new Set(out.sources.map((s) => s.kind));
    expect(kinds.has("user_text")).toBe(true);
    expect(kinds.has("markdown")).toBe(true);

    const historySource = out.sources.find((s) => s.title === "FromHistory.txt");
    expect(historySource).toBeDefined();
    expect(historySource.assetIds).toBeInstanceOf(Array);
    expect(historySource.assetIds).toHaveLength(1);

    const names = events.map((e) => e.name);
    expect(names).toContain("ingest.started");
    expect(names).toContain("ingest.completed");
    expect(names.filter((n) => n === "ingest.doc.completed").length).toBe(3);
    expect(names.filter((n) => n === "ingest.doc.failed").length).toBe(2);
  });
});
