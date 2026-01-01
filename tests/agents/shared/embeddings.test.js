const test = require("node:test");
const assert = require("node:assert/strict");

async function loadEmbeddings() {
  const svc = await import("../../../js/agents/shared/embeddings/embedding-service.js");
  const idx = await import("../../../js/agents/shared/embeddings/vector-index.js");
  return { ...svc, ...idx };
}

test("VectorIndex: upsert/search + LRU eviction", async () => {
  const { VectorIndex } = await loadEmbeddings();
  const index = new VectorIndex({ maxItems: 2 });

  assert.equal(index.upsert("a", [1, 0], { tag: "a" }), true);
  assert.equal(index.upsert("b", [0, 1], { tag: "b" }), true);
  assert.equal(index.size, 2);

  const hits1 = index.search([1, 0], { topK: 2 });
  assert.equal(hits1[0].id, "a");
  assert.ok(hits1[0].score > hits1[1].score);

  // Evict oldest ("a") when inserting third item.
  index.upsert("c", [1, 0], { tag: "c" });
  assert.equal(index.size, 2);
  assert.equal(index.has("a"), false);
  assert.equal(index.has("b"), true);
  assert.equal(index.has("c"), true);

  const hits2 = index.search([1, 0], { topK: 2 });
  assert.equal(hits2[0].id, "c");
});

test("EmbeddingService: batches enqueued requests into one call", async () => {
  const { EmbeddingService } = await loadEmbeddings();
  const calls = [];

  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const inputs = Array.isArray(body.input) ? body.input : [];
    const data = inputs.map((text, index) => ({ index, embedding: [String(text).length, 0, 0] }));
    return new Response(JSON.stringify({ data }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const svc = new EmbeddingService(
    {
      endpoint: "https://example.test/v1/embeddings",
      model: "test-embed",
      flushIntervalMs: 0,
      batchSize: 32,
      timeoutMs: 1000,
      cooldownMs: 60_000,
    },
    { fetchImpl }
  );

  const p1 = svc.enqueue(["a"]);
  const p2 = svc.enqueue(["bb"]);
  const [v1, v2] = await Promise.all([p1, p2]);

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].input, ["a", "bb"]);

  assert.equal(v1.length, 1);
  assert.equal(v2.length, 1);
  assert.equal(v1[0][0], 1);
  assert.equal(v2[0][0], 2);
});

test("EmbeddingService: marks unavailable after failure and degrades immediately", async () => {
  const { EmbeddingService } = await loadEmbeddings();
  const calls = [];

  const fetchImpl = async () => {
    calls.push("call");
    return new Response("boom", { status: 500, headers: { "content-type": "text/plain" } });
  };

  const svc = new EmbeddingService(
    {
      endpoint: "https://example.test/v1/embeddings",
      model: "test-embed",
      flushIntervalMs: 0,
      timeoutMs: 50,
      cooldownMs: 60_000,
    },
    { fetchImpl }
  );

  const r1 = await svc.embed(["x"], { timeoutMs: 100 });
  assert.equal(r1, null);
  assert.equal(calls.length, 1);

  const r2 = await svc.embed(["y"], { timeoutMs: 100 });
  assert.equal(r2, null);
  assert.equal(calls.length, 1);

  const status = svc.getStatus();
  assert.equal(status.available, false);
});

test("MemoryStore: semanticRecall prefers vector matches when available", async () => {
  const { EmbeddingService } = await loadEmbeddings();
  const { MemoryStore } = await import("../../../js/agents/runtime/memory/memory-store.js");

  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    const inputs = Array.isArray(body.input) ? body.input : [];
    const data = inputs.map((text, index) => {
      const s = String(text).toLowerCase();
      const revenue = s.includes("revenue") ? 1 : 0;
      const market = s.includes("market") ? 1 : 0;
      return { index, embedding: [revenue, market] };
    });
    return new Response(JSON.stringify({ data }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const svc = new EmbeddingService(
    {
      endpoint: "https://example.test/v1/embeddings",
      model: "test-embed",
      flushIntervalMs: 0,
      batchSize: 32,
      timeoutMs: 1000,
      cooldownMs: 60_000,
    },
    { fetchImpl }
  );

  const store = new MemoryStore({ runId: "mem_semantic", embeddingService: svc });
  const id1 = store.archive("stage1", { summary: "Q3 revenue analysis", content: "..." }, ["q3"]);
  const id2 = store.archive("stage2", { summary: "Market share data", content: "..." }, ["market"]);

  await svc.flush();
  await Promise.resolve(); // let archive() upsert callbacks run

  const hits = await store.semanticRecall("revenue", { limit: 1, fallback: false, timeoutMs: 1000 });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, id1);
  assert.ok(hits[0].score >= 0.5);

  const hits2 = await store.semanticRecall("market", { limit: 1, fallback: false, timeoutMs: 1000 });
  assert.equal(hits2.length, 1);
  assert.equal(hits2[0].id, id2);
});

test("SourceManager: semanticSearch reranks keyword candidates via embeddings", async () => {
  const { EmbeddingService } = await loadEmbeddings();
  const { default: SourceManager } = await import("../../../js/agents/stages/deepsearch/source-manager.js");

  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    const inputs = Array.isArray(body.input) ? body.input : [];
    const data = inputs.map((text, index) => {
      const s = String(text).toLowerCase();
      const revenue = s.includes("revenue") ? 1 : 0;
      const sentiment = s.includes("up") ? 1 : s.includes("down") ? -1 : 0;
      return { index, embedding: [revenue, sentiment] };
    });
    return new Response(JSON.stringify({ data }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const svc = new EmbeddingService(
    { endpoint: "https://example.test/v1/embeddings", model: "test-embed", flushIntervalMs: 0, timeoutMs: 1000, cooldownMs: 60_000 },
    { fetchImpl }
  );

  const manager = new SourceManager([
    { sourceId: "s1", name: "Doc 1", sourceTextNormalized: "Revenue down\nOther" },
    { sourceId: "s2", name: "Doc 2", sourceTextNormalized: "Revenue up\nOther" },
  ]);

  const results = await manager.semanticSearch("revenue up", { limit: 2, embeddingService: svc, timeoutMs: 1000 });
  assert.equal(results.length, 2);
  assert.equal(results[0].sourceId, "s2");
  assert.ok(results[0].score > results[1].score);
});

test("search-docs tool: uses semanticSearch when embedding config provided", async () => {
  const { handler } = await import("../../../js/agents/stages/deepsearch/tools/search-docs/handler.js");

  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    const inputs = Array.isArray(body.input) ? body.input : [];
    const data = inputs.map((text, index) => {
      const s = String(text).toLowerCase();
      const revenue = s.includes("revenue") ? 1 : 0;
      const sentiment = s.includes("up") ? 1 : s.includes("down") ? -1 : 0;
      return { index, embedding: [revenue, sentiment] };
    });
    return new Response(JSON.stringify({ data }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const state = {
    L0: {
      sources: [
        { sourceId: "s1", name: "Doc 1", sourceTextNormalized: "Revenue down\nOther" },
        { sourceId: "s2", name: "Doc 2", sourceTextNormalized: "Revenue up\nOther" },
      ],
    },
  };

  const out = await handler(
    { query: "revenue up", limit: 2 },
    {
      state,
      emit: () => {},
      embedding: { endpoint: "https://example.test/v1/embeddings", model: "test-embed", flushIntervalMs: 0, timeoutMs: 1000, cooldownMs: 60_000 },
      fetchImpl,
    }
  );

  assert.equal(out.success, true);
  assert.equal(out.results.length, 2);
  assert.equal(out.results[0].sourceId, "s2");
  assert.ok(out.results[0].score > out.results[1].score);
});
