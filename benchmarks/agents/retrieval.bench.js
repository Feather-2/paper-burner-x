function seededRand(seed) {
  let x = seed >>> 0;
  return () => {
    // xorshift32
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 0xffffffff;
  };
}

function makeDocText(rng, idx) {
  const topics = ["pricing", "roadmap", "security", "latency", "vector search", "BM25", "compression", "cache", "agent loop"];
  const topic = topics[idx % topics.length];
  const n = 80 + Math.floor(rng() * 80);
  const words = [];
  for (let i = 0; i < n; i++) {
    const w = topics[Math.floor(rng() * topics.length)];
    words.push(w);
  }
  return `Doc ${idx}: ${topic}\n` + words.join(" ");
}

export default async function retrievalBench(runner) {
  const { buildIndex, search } = await import("../../js/agents/retrieval/bm25.js");

  const rng = seededRand(1337);
  const chunks = [];
  for (let i = 0; i < 2000; i++) {
    chunks.push({ chunkId: `chunk_${i + 1}`, text: makeDocText(rng, i + 1) });
  }

  const index = buildIndex(chunks, { maxUniqueTerms: 50_000, maxTokensPerDoc: 2_000 });
  const queries = [
    "security roadmap",
    "vector search latency",
    "BM25 retrieval cache",
    "agent loop compression",
  ];
  let q = 0;

  await runner.run(
    "agents:retrieval:bm25_search",
    () => {
      const query = queries[q++ % queries.length];
      const hits = search(index, query, 8);
      if (!Array.isArray(hits)) throw new Error("unexpected search result");
    },
    { iterations: 500, warmup: 50 }
  );
}
