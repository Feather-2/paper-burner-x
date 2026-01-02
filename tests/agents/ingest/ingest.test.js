const test = require("node:test");
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

test("AssetManager: dedup by hash + per-doc refs", async () => {
  const { AssetManager } = await import("../../../js/agents/ingest/asset-manager.js");
  const m = new AssetManager();

  const a1 = { docId: "d1", type: "image", data: "data:image/png;base64,AAAA", mimeType: "image/png", source: "extracted", reusable: true };
  const a2 = { docId: "d1", type: "image", data: "data:image/png;base64,AAAA", mimeType: "image/png", source: "extracted", reusable: true, assetId: "custom" };
  const id1 = m.addAsset(a1);
  const id2 = m.addAsset(a2);

  assert.equal(id1, id2);
  assert.equal(m.count(), 1);
  assert.ok(m.getAsset(id1));
  assert.deepEqual(m.getAssetIdsForDoc("d1"), [id1]);

  const id3 = m.addAsset({ ...a1, docId: "d2" });
  assert.equal(id3, id1);
  assert.deepEqual(m.getAssetIdsForDoc("d2"), [id1]);
});

test("AssetManager: hash collision stores distinct assets", async () => {
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

  assert.notEqual(id1, id2);
  assert.equal(m.count(), 2);
  assert.ok(m.getAsset(id1));
  assert.ok(m.getAsset(id2));
});

test("MarkdownAdapter: parses path string + file-like object", async () => {
  const { MarkdownAdapter } = await import("../../../js/agents/ingest/adapters/markdown.js");

  await withTempDir(async (dir) => {
    const mdPath = path.join(dir, "note.md");
    await fs.writeFile(mdPath, "# Title\n\nHello world.\n", "utf8");

    const adapter = new MarkdownAdapter({ defaultChunkOptions: { chunkSize: 8, overlap: 0, includeLineNumbers: true } });
    const parsed = await adapter.parse(mdPath);

    assert.equal(parsed.sourceType, "markdown");
    assert.ok(parsed.docId.startsWith("markdown_"));
    assert.equal(parsed.markdown.includes("Hello world"), true);
    assert.equal(parsed.textHash.startsWith("sha256:"), true);
    assert.ok(Array.isArray(parsed.chunks) && parsed.chunks.length >= 2);
    assert.ok(Array.isArray(parsed.toc) && parsed.toc.length >= 1);
    assert.equal(parsed.origin.filename, "note.md");

    const parsed2 = await adapter.parse({
      name: "inline.txt",
      type: "text/plain",
      async text() {
        return "LINE1\nLINE2\n";
      },
    });
    assert.equal(parsed2.sourceType, "markdown");
    assert.equal(parsed2.origin.filename, "inline.txt");
    assert.equal(parsed2.origin.mimeType, "text/plain");
    assert.ok(parsed2.textNormalized.includes("LINE2"));
  });
});

test("RawTextAdapter: validates input + produces ParsedDocument", async () => {
  const { RawTextAdapter } = await import("../../../js/agents/ingest/adapters/raw-text.js");
  const a = new RawTextAdapter({ defaultChunkOptions: { chunkSize: 10, overlap: 0, includeLineNumbers: false } });

  await assert.rejects(() => a.parse({ text: "   " }), /input\.text is required/);

  const parsed = await a.parse({ text: "Alpha\nBeta\nGamma\n", title: "My Notes" });
  assert.equal(parsed.sourceType, "user_text");
  assert.equal(parsed.metadata.title, "My Notes");
  assert.ok(parsed.textNormalized.includes("Beta"));
  assert.ok(Array.isArray(parsed.chunks) && parsed.chunks.length >= 2);
});

test("HistoryAdapter: loads record via injected storageAdapter + maps images to assets", async () => {
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

  assert.equal(parsed.origin.historyId, "h1");
  assert.equal(parsed.sourceType, "pdf");
  assert.ok(parsed.docId.startsWith("pdf_"));
  assert.ok(Array.isArray(parsed.assets) && parsed.assets.length === 1);
  assert.equal(parsed.assets[0].docId, parsed.docId);
  assert.equal(parsed.assets[0].mimeType, "image/png");

  await assert.rejects(() => a.parse("missing"), /history record not found/);
});

test("IngestStage: dispatches rawTexts/historyIds/files + aggregates assets/errors/events", async () => {
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

    assert.equal(out.metrics.totalDocs, 5);
    assert.equal(out.metrics.successDocs, 3);
    assert.equal(out.metrics.failedDocs, 2);
    assert.equal(out.sources.length, 3);
    assert.equal(out.assets.length, 1);
    assert.equal(out.parseErrors.length, 2);

    const kinds = new Set(out.sources.map((s) => s.kind));
    assert.ok(kinds.has("user_text"));
    assert.ok(kinds.has("markdown"));

    const historySource = out.sources.find((s) => s.title === "FromHistory.txt");
    assert.ok(historySource && Array.isArray(historySource.assetIds) && historySource.assetIds.length === 1);

    const names = events.map((e) => e.name);
    assert.ok(names.includes("ingest.started"));
    assert.ok(names.includes("ingest.completed"));
    assert.equal(names.filter((n) => n === "ingest.doc.completed").length, 3);
    assert.equal(names.filter((n) => n === "ingest.doc.failed").length, 2);
  });
});
