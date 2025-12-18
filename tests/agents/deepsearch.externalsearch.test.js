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

test("DeepSearch ExternalSearch stage: concurrency limit is enforced (mcp search + fetch)", async () => {
  const { runExternalSearch } = await import("../../js/agents/stages/deepsearch/external-search.js");

  let inFlightSearch = 0;
  let maxInFlightSearch = 0;
  let startedSearch = 0;
  let resolveSearchGate;
  const searchGate = new Promise((r) => (resolveSearchGate = r));

  let inFlightFetch = 0;
  let maxInFlightFetch = 0;
  let startedFetch = 0;
  let resolveFetchGate;
  const fetchGate = new Promise((r) => (resolveFetchGate = r));

  const provider = {
    listProviders: () => ["mock"],
    search: async ({ query }) => {
      inFlightSearch++;
      maxInFlightSearch = Math.max(maxInFlightSearch, inFlightSearch);
      startedSearch++;
      if (startedSearch === 10) resolveSearchGate();
      await searchGate;
      await new Promise((r) => setImmediate(r));
      inFlightSearch--;
      return {
        success: true,
        content: [{ type: "json", data: { results: [{ url: `https://example.com/${encodeURIComponent(query)}`, title: `T ${query}` }] } }],
      };
    },
    fetch: async ({ url }) => {
      inFlightFetch++;
      maxInFlightFetch = Math.max(maxInFlightFetch, inFlightFetch);
      startedFetch++;
      if (startedFetch === 10) resolveFetchGate();
      await fetchGate;
      await new Promise((r) => setImmediate(r));
      inFlightFetch--;
      return {
        success: true,
        content: [{ type: "json", data: { metadata: { title: `Title ${url}` } } }],
        getText: () => `body for ${url} `.repeat(10), // >= 50 chars
      };
    },
  };

  const gaps = Array.from({ length: 13 }, (_, i) => ({ gapId: `g${i + 1}`, text: `q_${i + 1}` }));
  const config = { enabled: true, maxExternalResults: 1 };
  const state = { L0: { sources: [] }, L2: {}, userConfig: { retrieval: { maxChunks: 1000 } }, addTimeline: () => {} };
  const stageApi = { externalSearchProvider: provider };

  const out = await runExternalSearch(gaps, config, { state, stageApi });

  assert.ok(out.documents.length >= 1);
  assert.ok(out.chunks.length >= 1);
  assert.ok(maxInFlightSearch <= 10);
  assert.ok(maxInFlightFetch <= 10);
});

test("DeepSearch ExternalSearch stage: sourceTextNormalized is truncated for long documents", async () => {
  const { runExternalSearch } = await import("../../js/agents/stages/deepsearch/external-search.js");

  const longText = `BEGIN\n${"x".repeat(80050)}\nEND`;
  const shortText = "short ".repeat(20); // >= 50 chars

  const provider = {
    listProviders: () => ["mock"],
    search: async ({ query }) => {
      return {
        success: true,
        content: [
          {
            type: "json",
            data: {
              results: [
                { url: `https://example.com/${encodeURIComponent(query)}/long`, title: "Long" },
                { url: `https://example.com/${encodeURIComponent(query)}/short`, title: "Short" },
              ],
            },
          },
        ],
      };
    },
    fetch: async ({ url }) => {
      const text = url.includes("/long") ? longText : shortText;
      return {
        success: true,
        content: [{ type: "json", data: { metadata: { title: url.includes("/long") ? "LongDoc" : "ShortDoc" } } }],
        getText: () => text,
      };
    },
  };

  const gaps = [{ gapId: "g1", text: "alpha" }];
  const config = { enabled: true, maxExternalResults: 2 };
  const state = { L0: { sources: [] }, L2: {}, userConfig: { retrieval: { maxChunks: 1000 } }, addTimeline: () => {} };
  const stageApi = { externalSearchProvider: provider };

  const out = await runExternalSearch(gaps, config, { state, stageApi });
  assert.equal(out.documents.length, 2);

  const longDoc = out.documents.find((d) => String(d?.uri || "").includes("/long"));
  const shortDoc = out.documents.find((d) => String(d?.uri || "").includes("/short"));
  assert.ok(longDoc);
  assert.ok(shortDoc);

  assert.equal(longDoc.truncated, true);
  assert.equal(longDoc.originalLength, longText.length);
  assert.ok(String(longDoc.sourceTextNormalized).includes(`[... 省略 ${longText.length - 80000} 字符 ...]`));
  assert.ok(String(longDoc.sourceTextNormalized).startsWith(longText.slice(0, 20)));
  assert.ok(String(longDoc.sourceTextNormalized).endsWith(longText.slice(-20)));

  assert.equal("truncated" in shortDoc, false);
  assert.equal("originalLength" in shortDoc, false);
  assert.equal(shortDoc.sourceTextNormalized, shortText);
});
