const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

function workerUrl() {
  const p = path.resolve(__dirname, "../../../js/agents/workers/deepsearch-worker.js");
  return pathToFileURL(p);
}

test("WorkerPool: initialization", async () => {
  const { WorkerPool } = await import("../../../js/agents/workers/worker-pool.js");
  const pool = new WorkerPool({ size: 2, workerUrl: workerUrl() });
  try {
    assert.equal(pool.workers.length, 2);
    assert.equal(pool.queue.length, 0);
    assert.equal(typeof pool.exec, "function");
  } finally {
    await pool.terminate();
  }
});

test("WorkerPool: queuing + execution + error propagation", async () => {
  const { WorkerPool } = await import("../../../js/agents/workers/worker-pool.js");
  const pool = new WorkerPool({ size: 1, workerUrl: workerUrl() });
  try {
    const p1 = pool.normalize("a\r\nb");
    const p2 = pool.normalize("x\r\ny");
    assert.equal(pool.queue.length, 1);

    const [r1, r2] = await Promise.all([p1, p2]);
    assert.equal(r1.normalized, "a\nb");
    assert.equal(r2.normalized, "x\ny");
    assert.match(r1.textHash, /^sha256:[a-f0-9]{64}$/);

    await assert.rejects(
      pool.grep([{ chunkId: "c1", text: "hello" }], "[", { regex: true }),
      /Worker task failed|Invalid regular expression|Unterminated character class/
    );
  } finally {
    await pool.terminate();
  }
});

test("Chunked loader: loadChunksStream + processLargeFile", async () => {
  const { loadChunksStream, processLargeFile } = await import("../../../js/agents/ingest/chunked-loader.js");
  const text = "abcdefghijklmnopqrstuvwxyz";
  const blob = new Blob([text]);

  const seen = [];
  for await (const chunk of loadChunksStream(blob, 5)) seen.push(chunk);

  assert.equal(seen.length, Math.ceil(text.length / 5));
  assert.equal(
    seen.map((c) => c.text).join(""),
    text
  );
  assert.deepEqual(
    seen.map((c) => c.offset),
    [0, 5, 10, 15, 20, 25]
  );

  const progress = [];
  const out = await processLargeFile(
    blob,
    async (c) => c.text.toUpperCase(),
    {
      chunkSize: 7,
      onProgress: (p) => progress.push(p),
    }
  );
  assert.equal(out.join(""), text.toUpperCase());
  assert.ok(progress.length >= 1);
  assert.equal(progress.at(-1).processed >= text.length, true);
  assert.equal(progress.at(-1).total, blob.size);
});

test("BM25: buildIndexAsync offloads to WorkerPool", async () => {
  const { WorkerPool } = await import("../../../js/agents/workers/worker-pool.js");
  const { buildIndex, buildIndexAsync, search } = await import("../../../js/agents/retrieval/bm25.js");

  const chunks = [
    { chunkId: "a", text: "deep learning for search and retrieval" },
    { chunkId: "b", text: "bm25 ranking function for information retrieval" },
    { chunkId: "c", text: "cats and dogs" },
  ];

  const pool = new WorkerPool({ size: 1, workerUrl: workerUrl() });
  try {
    const idxSync = buildIndex(chunks, { k1: 1.2, b: 0.75 });
    const idxAsync = await buildIndexAsync(chunks, { k1: 1.2, b: 0.75, workerPool: pool });

    const q = "bm25 retrieval";
    const rSync = search(idxSync, q, 3);
    const rAsync = search(idxAsync, q, 3);
    assert.deepEqual(
      rAsync.map((r) => r.chunkId),
      rSync.map((r) => r.chunkId)
    );
    assert.equal(rAsync[0].chunkId, "b");
  } finally {
    await pool.terminate();
  }
});

