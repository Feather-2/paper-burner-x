import { SearchProvider, assertFetchResult, assertSearchResult } from "./provider.js";

function toNonEmptyString(v) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

function toISO(d = new Date()) {
  return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
}

function buildFixtures() {
  const pages = {
    "https://example.com/alpha": {
      title: "Alpha Overview",
      extractedText: "Alpha is a placeholder concept used in examples. It is often paired with beta.",
      metadata: { publishedAt: "2025-01-01", domain: "example.com" },
    },
    "https://example.com/beta?utm_source=test": {
      title: "Beta Deep Dive",
      extractedText: "Beta follows alpha. Beta details: definitions, examples, and cautions.",
      metadata: { publishedAt: "2024-08-15", domain: "example.com" },
    },
    "https://gov.example.org/policy": {
      title: "Policy Note: Alpha Beta",
      extractedText: "Government policy note about Alpha and Beta. This is a high-credibility source.",
      metadata: { publishedAt: "2025-06-01", domain: "gov.example.org", authority: "gov" },
    },
    "https://news.example.net/alpha-beta": {
      title: "Alpha Beta report!",
      extractedText: "News report: alpha beta report. Includes a quick timeline and quoted numbers.",
      metadata: { publishedAt: "2025-11-30", domain: "news.example.net", category: "news" },
    },
  };

  const searches = [
    {
      keywords: ["alpha"],
      results: [
        {
          url: "https://example.com/alpha",
          title: "Alpha Overview",
          snippet: "Alpha overview and key definitions.",
          source: "mock",
          metadata: { publishedAt: "2025-01-01" },
        },
        {
          url: "https://news.example.net/alpha-beta",
          title: "Alpha Beta report!",
          snippet: "A short report covering alpha/beta timeline.",
          source: "mock",
          metadata: { publishedAt: "2025-11-30" },
        },
      ],
    },
    {
      keywords: ["beta"],
      results: [
        {
          url: "https://example.com/beta?utm_source=test",
          title: "Beta Deep Dive",
          snippet: "Beta details and examples; includes definitions.",
          source: "mock",
          metadata: { publishedAt: "2024-08-15" },
        },
        {
          url: "https://gov.example.org/policy",
          title: "Policy Note: Alpha Beta",
          snippet: "Policy guidance with high credibility.",
          source: "mock",
          metadata: { publishedAt: "2025-06-01" },
        },
      ],
    },
    {
      keywords: ["policy"],
      results: [
        {
          url: "https://gov.example.org/policy",
          title: "Policy Note: Alpha Beta",
          snippet: "Official policy note about alpha and beta.",
          source: "mock",
          metadata: { publishedAt: "2025-06-01" },
        },
      ],
    },
  ];

  return { pages, searches };
}

export class MockSearchProvider extends SearchProvider {
  constructor({ id = "mock", name = "MockSearchProvider", fixtures } = {}) {
    super({ id, name });
    this._fixtures = fixtures || buildFixtures();
    this._calls = { query: [], fetch: [] };
  }

  get calls() {
    return this._calls;
  }

  async query({ query, domain, timeRange, limit, filters } = {}) {
    const q = toNonEmptyString(query) || "";
    this._calls.query.push({ query: q, domain, timeRange, limit, filters });

    const lower = q.toLowerCase();
    const match = this._fixtures.searches.find((s) => s.keywords.some((k) => lower.includes(k)));
    const results = (match ? match.results : []).slice(0, typeof limit === "number" ? Math.max(0, limit) : undefined).map((r) => ({
      ...r,
      fetchedAt: toISO("2025-12-01T00:00:00.000Z"),
    }));

    for (const r of results) assertSearchResult(r);
    return results;
  }

  async fetch({ url } = {}) {
    const u = toNonEmptyString(url);
    if (!u) throw new TypeError("fetch({url}): url must be a non-empty string");
    this._calls.fetch.push({ url: u });

    const page = this._fixtures.pages[u] || this._fixtures.pages[String(u).split("?")[0]];
    const title = page?.title || "Unknown";
    const extractedText = page?.extractedText || "";
    const content = `<html><head><title>${title}</title></head><body><p>${extractedText}</p></body></html>`;
    const out = {
      content,
      extractedText,
      metadata: {
        url: u,
        title,
        ...(page?.metadata || {}),
      },
    };
    assertFetchResult(out);
    return out;
  }
}

