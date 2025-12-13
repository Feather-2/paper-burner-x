const test = require("node:test");
const assert = require("node:assert/strict");

test("ExternalSearch: Provider interface contract + result validators", async () => {
  const { SearchProvider, assertSearchResult, assertFetchResult } = await import("../../js/agents/external-search/provider.js");

  const p = new SearchProvider({ id: "base", name: "Base" });
  await assert.rejects(() => p.query({ query: "x" }), /not implemented/);
  await assert.rejects(() => p.fetch({ url: "https://example.com" }), /not implemented/);

  assert.doesNotThrow(() =>
    assertSearchResult({
      url: "https://example.com/a",
      title: "A",
      snippet: "S",
      source: "mock",
      fetchedAt: new Date().toISOString(),
      metadata: { publishedAt: "2025-01-01" },
    })
  );
  assert.throws(() => assertSearchResult({ url: "", title: "A", snippet: "S", source: "x" }), /url/);
  assert.throws(() => assertFetchResult({ content: 1, extractedText: "", metadata: {} }), /content/);
  assert.doesNotThrow(() => assertFetchResult({ content: "<html/>", extractedText: "text", metadata: { url: "u" }, attachments: [] }));
});

test("ExternalSearch: MockProvider returns deterministic fixtures and no network calls", async () => {
  const { MockSearchProvider } = await import("../../js/agents/external-search/mock-provider.js");

  const p = new MockSearchProvider();

  const r1 = await p.query({ query: "alpha", limit: 10 });
  assert.equal(r1.length, 2);
  assert.equal(r1[0].url, "https://example.com/alpha");
  assert.equal(r1[0].source, "mock");
  assert.ok(r1[0].fetchedAt.includes("T"));

  const r2 = await p.query({ query: "beta policy", limit: 10 });
  assert.ok(r2.some((x) => x.url.includes("gov.example.org/policy")));

  const f = await p.fetch({ url: "https://example.com/alpha" });
  assert.ok(f.content.includes("<html"));
  assert.ok(f.extractedText.includes("Alpha"));
  assert.equal(f.metadata.url, "https://example.com/alpha");

  assert.equal(p.calls.query.length, 2);
  assert.equal(p.calls.fetch.length, 1);
});

test("ExternalSearch: Orchestrator concurrency limit is enforced (query + fetch)", async () => {
  const { SearchProvider } = await import("../../js/agents/external-search/provider.js");
  const { SearchOrchestrator } = await import("../../js/agents/external-search/orchestrator.js");

  let inFlightQuery = 0;
  let maxInFlightQuery = 0;
  let inFlightFetch = 0;
  let maxInFlightFetch = 0;

  class SlowProvider extends SearchProvider {
    constructor(time) {
      super({ id: "slow", name: "SlowProvider" });
      this._time = time;
    }
    async query({ query }) {
      inFlightQuery++;
      maxInFlightQuery = Math.max(maxInFlightQuery, inFlightQuery);
      await this._time.sleep(10);
      inFlightQuery--;
      return [
        { url: `https://example.com/${encodeURIComponent(query)}`, title: `T ${query}`, snippet: `S ${query}`, source: "slow", metadata: { publishedAt: "2025-01-01" } },
      ];
    }
    async fetch({ url }) {
      inFlightFetch++;
      maxInFlightFetch = Math.max(maxInFlightFetch, inFlightFetch);
      await this._time.sleep(10);
      inFlightFetch--;
      return { content: `<html>${url}</html>`, extractedText: `body for ${url}`, metadata: { url } };
    }
  }

  let now = 0;
  const time = {
    now: () => now,
    sleep: async (ms) => {
      await new Promise((r) => setImmediate(r));
      now += ms;
    },
  };

  const orch = new SearchOrchestrator({
    providers: [new SlowProvider(time)],
    maxConcurrency: 2,
    perProviderPerSecond: Infinity,
    time,
    queryTimeoutMs: 10_000,
    fetchTimeoutMs: 10_000,
    retries: 0,
  });

  const gaps = Array.from({ length: 6 }, (_, i) => ({ text: `gap_${i + 1}` }));
  const out = await orch.searchFromGaps(gaps, { perQueryLimit: 1, fetchTopK: 4 });

  assert.ok(out.results.length >= 1);
  assert.ok(out.documents.length >= 1);
  assert.ok(out.evidences.length >= 1);
  assert.ok(maxInFlightQuery <= 2);
  assert.ok(maxInFlightFetch <= 2);
});

test("ExternalSearch: Orchestrator per-provider rate limiting spaces calls", async () => {
  const { MockSearchProvider } = await import("../../js/agents/external-search/mock-provider.js");
  const { SearchOrchestrator } = await import("../../js/agents/external-search/orchestrator.js");

  let now = 0;
  const time = {
    now: () => now,
    sleep: async (ms) => {
      await new Promise((r) => setImmediate(r));
      now += ms;
    },
  };

  const orch = new SearchOrchestrator({
    providers: [new MockSearchProvider()],
    maxConcurrency: 10,
    perProviderPerSecond: 1,
    time,
    queryTimeoutMs: 10_000,
    fetchTimeoutMs: 10_000,
    retries: 0,
  });

  const gaps = [{ text: "alpha beta" }]; // generates 3 queries
  const out = await orch.searchFromGaps(gaps, { fetchTopK: 0, trace: true });
  const starts = out.trace
    .filter((t) => t.kind === "query" && t.ok)
    .map((t) => t.startedAtMs)
    .sort((a, b) => a - b);

  assert.equal(starts.length, 3);
  assert.ok(starts[1] - starts[0] >= 1000);
  assert.ok(starts[2] - starts[1] >= 1000);
});

test("ExternalSearch: canonical URL + similar title dedup keeps best", async () => {
  const { canonicalizeUrl, SearchOrchestrator } = await import("../../js/agents/external-search/orchestrator.js");
  const { MockSearchProvider } = await import("../../js/agents/external-search/mock-provider.js");

  assert.equal(canonicalizeUrl("https://example.com/a?utm_source=x&utm_medium=y"), "https://example.com/a");

  const orch = new SearchOrchestrator({ providers: [new MockSearchProvider()], maxConcurrency: 1, perProviderPerSecond: Infinity, retries: 0 });

  const items = [
    { url: "https://example.com/x?utm_source=a", title: "Alpha Beta report!", snippet: "s", source: "mock", quality: { total: 0.2 } },
    { url: "https://example.com/x?utm_source=b", title: "Alpha Beta report!", snippet: "s", source: "mock", quality: { total: 0.9 } },
    { url: "https://example.com/y", title: "Alpha Beta report", snippet: "s", source: "mock", quality: { total: 0.1 } },
  ];

  const deduped = orch.dedupeResults(items, { titleSimilarityThreshold: 0.8 });
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].url.includes("utm_source=b"), true);
});

test("ExternalSearch: quality scoring fields are present and plausible", async () => {
  const { scoreSearchResult } = await import("../../js/agents/external-search/orchestrator.js");

  const gov = scoreSearchResult(
    { url: "https://agency.gov/report", title: "Alpha Beta", snippet: "Alpha Beta definition", source: "x", metadata: { publishedAt: "2025-12-01" } },
    { query: "alpha beta", now: Date.parse("2025-12-05") }
  );
  const blog = scoreSearchResult(
    { url: "https://example.com/blog", title: "Alpha Beta", snippet: "Alpha Beta definition", source: "x", metadata: { publishedAt: "2020-01-01" } },
    { query: "alpha beta", now: Date.parse("2025-12-05") }
  );

  for (const s of [gov, blog]) {
    assert.ok(typeof s.total === "number");
    assert.ok(typeof s.credibility === "number");
    assert.ok(typeof s.recency === "number");
    assert.ok(typeof s.relevance === "number");
    assert.ok(s.total >= 0 && s.total <= 1);
  }
  assert.ok(gov.credibility > blog.credibility);
  assert.ok(gov.total > blog.total);
});

test("ExternalSearch: results are stored into L0 DocumentLibrary and L1 EvidenceLedger", async () => {
  const { MockSearchProvider } = await import("../../js/agents/external-search/mock-provider.js");
  const { SearchOrchestrator, InMemoryDocumentLibrary, InMemoryEvidenceLedger } = await import("../../js/agents/external-search/orchestrator.js");

  const documentLibrary = new InMemoryDocumentLibrary();
  const evidenceLedger = new InMemoryEvidenceLedger();
  const orch = new SearchOrchestrator({
    providers: [new MockSearchProvider()],
    documentLibrary,
    evidenceLedger,
    maxConcurrency: 3,
    perProviderPerSecond: Infinity,
    retries: 0,
  });

  const out = await orch.searchFromGaps([{ text: "alpha" }], { fetchTopK: 2 });
  assert.equal(out.documents.length, 2);
  assert.equal(out.evidences.length, 2);

  const docs = documentLibrary.listDocuments();
  const evidences = evidenceLedger.listEvidence();
  assert.equal(docs.length, 2);
  assert.equal(evidences.length, 2);

  const bySourceId = new Map(docs.map((d) => [d.sourceId, d]));
  for (const e of evidences) {
    assert.ok(e.evidenceId && e.evidenceId.startsWith("e_ext_"));
    assert.ok(bySourceId.has(e.sourceId));
    const doc = bySourceId.get(e.sourceId);
    const { charStart, charEnd } = e.locator || {};
    assert.ok(typeof charStart === "number" && typeof charEnd === "number" && charStart < charEnd);
    const slice = String(doc.extractedText || "").slice(charStart, charEnd);
    assert.ok(slice.includes(e.quote));
    assert.ok(e.quality && typeof e.quality.total === "number");
  }
});

