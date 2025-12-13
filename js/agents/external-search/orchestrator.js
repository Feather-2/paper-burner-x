import { assertFetchResult, assertSearchResult } from "./provider.js";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toNonEmptyString(v) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

function clamp01(n) {
  if (typeof n !== "number" || Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function tokenize(s) {
  return String(s || "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9\u00c0-\u024f]+/gi, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function normalizeTitle(title) {
  return tokenize(title).join(" ");
}

export function jaccardSimilarity(aTokens, bTokens) {
  const a = new Set(Array.isArray(aTokens) ? aTokens : tokenize(aTokens));
  const b = new Set(Array.isArray(bTokens) ? bTokens : tokenize(bTokens));
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
}

export function canonicalizeUrl(url) {
  const raw = toNonEmptyString(url) || "";
  try {
    const u = new URL(raw);
    const proto = u.protocol.toLowerCase();
    const host = u.hostname.toLowerCase();
    const path = u.pathname.replaceAll(/\/+$/g, "") || "/";

    const params = new URLSearchParams(u.search);
    for (const k of Array.from(params.keys())) {
      const key = k.toLowerCase();
      if (key.startsWith("utm_") || key === "gclid" || key === "fbclid") params.delete(k);
    }
    const qs = params.toString();
    return `${proto}//${host}${path}${qs ? `?${qs}` : ""}`;
  } catch {
    return raw.trim();
  }
}

function fnv1a32Hex(input) {
  let h = 0x811c9dc5;
  const s = String(input || "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function scoreSearchResult(result, { query, now = Date.now() } = {}) {
  const q = toNonEmptyString(query) || "";
  const title = toNonEmptyString(result?.title) || "";
  const snippet = toNonEmptyString(result?.snippet) || "";

  const url = toNonEmptyString(result?.url) || "";
  const hostname = (() => {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return "";
    }
  })();

  const credibility = (() => {
    if (!hostname) return 0.4;
    if (hostname.endsWith(".gov") || hostname.includes(".gov.")) return 0.95;
    if (hostname.endsWith(".edu") || hostname.includes(".edu.")) return 0.9;
    if (hostname.endsWith(".org") || hostname.includes(".org.")) return 0.75;
    if (hostname.includes("wikipedia.org")) return 0.7;
    return 0.6;
  })();

  const recency = (() => {
    const published = result?.metadata?.publishedAt;
    if (!published) return 0.5;
    const t = Date.parse(published);
    if (!Number.isFinite(t)) return 0.5;
    const ageDays = Math.max(0, (now - t) / 86_400_000);
    if (ageDays <= 30) return 0.95;
    if (ageDays <= 365) return 0.75;
    if (ageDays <= 365 * 3) return 0.55;
    return 0.35;
  })();

  const relevance = (() => {
    const qTokens = tokenize(q);
    if (qTokens.length === 0) return 0.6;
    const bag = tokenize(`${title} ${snippet}`);
    const overlap = jaccardSimilarity(qTokens, bag);
    return clamp01(0.2 + overlap); // keep non-zero even for short snippets
  })();

  const total = clamp01(0.45 * credibility + 0.2 * recency + 0.35 * relevance);
  return { credibility, recency, relevance, total };
}

function createConcurrencyLimiter(maxConcurrency) {
  const max = typeof maxConcurrency === "number" && maxConcurrency > 0 ? Math.floor(maxConcurrency) : 1;
  let active = 0;
  const queue = [];

  const pump = () => {
    while (active < max && queue.length) {
      active++;
      const job = queue.shift();
      job();
    }
  };

  return async (fn) =>
    new Promise((resolve, reject) => {
      const run = async () => {
        try {
          const out = await fn();
          resolve(out);
        } catch (err) {
          reject(err);
        } finally {
          active--;
          pump();
        }
      };
      queue.push(run);
      pump();
    });
}

class RateLimiter {
  constructor({ perSecond = Infinity, time } = {}) {
    this._minIntervalMs = perSecond === Infinity ? 0 : Math.max(0, Math.ceil(1000 / Math.max(1, perSecond)));
    this._time = time;
    this._nextAllowedAt = 0;
  }

  async waitTurn() {
    if (this._minIntervalMs <= 0) return;
    const now = this._time.now();
    const waitMs = Math.max(0, this._nextAllowedAt - now);
    this._nextAllowedAt = Math.max(this._nextAllowedAt, now) + this._minIntervalMs;
    if (waitMs > 0) await this._time.sleep(waitMs);
  }
}

function withTimeout(promise, ms, { errorMessage } = {}) {
  const timeoutMs = typeof ms === "number" && ms > 0 ? ms : null;
  if (!timeoutMs) return promise;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const t = setTimeout(() => {
        clearTimeout(t);
        reject(new Error(errorMessage || `Timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }),
  ]);
}

async function retry(fn, { retries = 0, baseDelayMs = 80, time } = {}) {
  let lastErr = null;
  const n = typeof retries === "number" ? Math.max(0, Math.floor(retries)) : 0;
  for (let attempt = 0; attempt <= n; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt === n) break;
      const backoff = baseDelayMs * Math.pow(2, attempt);
      await time.sleep(Math.min(2000, backoff));
    }
  }
  throw lastErr;
}

export class InMemoryDocumentLibrary {
  constructor() {
    this._docs = new Map(); // sourceId -> doc
  }
  addDocument(doc) {
    const sourceId = toNonEmptyString(doc?.sourceId);
    if (!sourceId) throw new TypeError("DocumentLibrary.addDocument(doc): doc.sourceId required");
    this._docs.set(sourceId, { ...doc });
    return sourceId;
  }
  getDocument(sourceId) {
    return this._docs.get(String(sourceId)) || null;
  }
  listDocuments() {
    return Array.from(this._docs.values());
  }
}

export class InMemoryEvidenceLedger {
  constructor() {
    this._items = [];
    this._seq = 0;
  }
  addEvidence(evidence) {
    this._seq += 1;
    const evidenceId = toNonEmptyString(evidence?.evidenceId) || `e_ext_${String(this._seq).padStart(4, "0")}`;
    const item = { ...evidence, evidenceId };
    this._items.push(item);
    return evidenceId;
  }
  listEvidence() {
    return this._items.slice();
  }
}

export class SearchOrchestrator {
  constructor({
    providers,
    maxConcurrency = 4,
    perProviderPerSecond = 3,
    queryTimeoutMs = 5000,
    fetchTimeoutMs = 8000,
    retries = 1,
    baseDelayMs = 50,
    documentLibrary,
    evidenceLedger,
    time,
  } = {}) {
    this.providers = Array.isArray(providers) ? providers.filter(Boolean) : [];
    if (this.providers.length === 0) throw new Error("SearchOrchestrator requires at least one provider");

    this._limit = createConcurrencyLimiter(maxConcurrency);
    this._time = {
      now: typeof time?.now === "function" ? time.now : () => Date.now(),
      sleep:
        typeof time?.sleep === "function"
          ? time.sleep
          : (ms) =>
              new Promise((resolve) => {
                setTimeout(resolve, ms);
              }),
    };
    this._rateLimiters = new Map(this.providers.map((p) => [p.id, new RateLimiter({ perSecond: perProviderPerSecond, time: this._time })]));
    this._timeouts = { queryTimeoutMs, fetchTimeoutMs };
    this._retries = { retries, baseDelayMs };

    this.documentLibrary = documentLibrary || new InMemoryDocumentLibrary();
    this.evidenceLedger = evidenceLedger || new InMemoryEvidenceLedger();
  }

  generateQueriesFromGaps(gaps, { domain, timeRange, limit = 3 } = {}) {
    const out = [];
    const items = Array.isArray(gaps) ? gaps : [];
    for (const g of items) {
      const seed = toNonEmptyString(g?.query) || toNonEmptyString(g?.question) || toNonEmptyString(g?.text) || toNonEmptyString(g?.title);
      if (!seed) continue;
      const variants = [seed, `${seed} overview`, `${seed} definition`];
      for (const q of variants.slice(0, limit)) {
        out.push({ query: q, ...(toNonEmptyString(domain) ? { domain } : {}), ...(toNonEmptyString(timeRange) ? { timeRange } : {}) });
      }
    }
    return out;
  }

  async _callProvider(provider, kind, input, { timeoutMs } = {}) {
    const limiter = this._rateLimiters.get(provider.id);
    return this._limit(async () => {
      await limiter?.waitTurn();
      const startedAtMs = this._time.now();
      const p = kind === "query" ? provider.query(input) : provider.fetch(input);
      const res = await withTimeout(p, timeoutMs, { errorMessage: `${provider.id}.${kind} timeout` });
      const endedAtMs = this._time.now();
      return { res, startedAtMs, endedAtMs };
    });
  }

  dedupeResults(results, { titleSimilarityThreshold = 0.86 } = {}) {
    const items = Array.isArray(results) ? results : [];
    const byCanonical = new Map(); // canonical -> item
    for (const r of items) {
      if (!r) continue;
      const canonicalUrl = canonicalizeUrl(r.url);
      const existing = byCanonical.get(canonicalUrl);
      if (!existing) {
        byCanonical.set(canonicalUrl, { ...r, canonicalUrl, _dupeOf: null });
      } else {
        const prevScore = existing?.quality?.total ?? 0;
        const nextScore = r?.quality?.total ?? 0;
        if (nextScore > prevScore) byCanonical.set(canonicalUrl, { ...r, canonicalUrl, _dupeOf: existing.url });
      }
    }

    const canonList = Array.from(byCanonical.values()).sort((a, b) => (b?.quality?.total ?? 0) - (a?.quality?.total ?? 0));
    const kept = [];
    const seen = new Set();
    for (let i = 0; i < canonList.length; i++) {
      const a = canonList[i];
      if (seen.has(a.canonicalUrl)) continue;
      kept.push(a);
      const aTitle = normalizeTitle(a.title);
      const aTokens = tokenize(aTitle);
      for (let j = i + 1; j < canonList.length; j++) {
        const b = canonList[j];
        if (seen.has(b.canonicalUrl)) continue;
        const sim = jaccardSimilarity(aTokens, tokenize(normalizeTitle(b.title)));
        if (sim >= titleSimilarityThreshold) seen.add(b.canonicalUrl);
      }
    }
    return kept;
  }

  async searchFromGaps(gaps, { domain, timeRange, perQueryLimit = 5, fetchTopK = 3, trace = false } = {}) {
    const queries = this.generateQueriesFromGaps(gaps, { domain, timeRange, limit: 3 });
    const traceLog = [];

    const allResults = [];
    const queryTasks = [];
    for (const q of queries) {
      for (const provider of this.providers) {
        queryTasks.push(
          (async () => {
            const input = { ...q, limit: perQueryLimit };
            const result = await retry(
              async (attempt) => {
                const { res, startedAtMs, endedAtMs } = await this._callProvider(provider, "query", input, { timeoutMs: this._timeouts.queryTimeoutMs });
                if (trace) traceLog.push({ kind: "query", providerId: provider.id, startedAtMs, endedAtMs, attempt, ok: true });
                return res;
              },
              { retries: this._retries.retries, baseDelayMs: this._retries.baseDelayMs, time: this._time }
            );
            const rows = Array.isArray(result) ? result : [];
            for (const r of rows) {
              assertSearchResult(r);
              const quality = scoreSearchResult(r, { query: q.query, now: this._time.now() });
              allResults.push({ ...r, query: q.query, providerId: provider.id, quality });
            }
          })().catch((err) => {
            if (trace) traceLog.push({ kind: "query", providerId: provider.id, startedAtMs: this._time.now(), endedAtMs: this._time.now(), ok: false, error: err?.message });
          })
        );
      }
    }
    await Promise.all(queryTasks);

    const deduped = this.dedupeResults(allResults);
    deduped.sort((a, b) => (b?.quality?.total ?? 0) - (a?.quality?.total ?? 0));
    const selected = deduped.slice(0, Math.max(0, fetchTopK));

    const documents = [];
    const evidences = [];

    const fetchTasks = selected.map((r) =>
      (async () => {
        const provider = this.providers.find((p) => p.id === r.providerId) || this.providers[0];
        const fetchResult = await retry(
          async (attempt) => {
            const { res, startedAtMs, endedAtMs } = await this._callProvider(provider, "fetch", { url: r.url }, { timeoutMs: this._timeouts.fetchTimeoutMs });
            if (trace) traceLog.push({ kind: "fetch", providerId: provider.id, startedAtMs, endedAtMs, attempt, ok: true, url: r.url });
            return res;
          },
          { retries: this._retries.retries, baseDelayMs: this._retries.baseDelayMs, time: this._time }
        );
        assertFetchResult(fetchResult);

        const canonicalUrl = canonicalizeUrl(r.url);
        const sourceId = `ext_${fnv1a32Hex(canonicalUrl)}`;
        const fetchedAt = new Date(this._time.now()).toISOString();
        const doc = {
          sourceId,
          kind: "external_url",
          uri: canonicalUrl,
          title: r.title,
          fetchedAt,
          providerId: provider.id,
          query: r.query,
          content: fetchResult.content,
          extractedText: fetchResult.extractedText,
          metadata: { ...(fetchResult.metadata || {}), ...(r.metadata || {}), url: canonicalUrl },
        };
        this.documentLibrary.addDocument(doc);
        documents.push(doc);

        const text = String(fetchResult.extractedText || "");
        let quote = String(r.snippet || "").trim();
        let idx = quote ? text.indexOf(quote) : -1;
        if (idx < 0) {
          quote = text.slice(0, 220);
          idx = quote ? 0 : -1;
        }
        const locator = idx >= 0 ? { charStart: idx, charEnd: idx + quote.length } : { charStart: 0, charEnd: 0 };
        const evidence = {
          evidenceId: undefined,
          sourceId,
          locator,
          quote: quote.slice(0, 400),
          url: canonicalUrl,
          title: r.title,
          snippet: r.snippet,
          fetchedAt,
          quality: r.quality,
          providerId: provider.id,
          query: r.query,
        };
        evidence.evidenceId = this.evidenceLedger.addEvidence(evidence);
        evidences.push(evidence);
      })().catch((err) => {
        if (trace) traceLog.push({ kind: "fetch", providerId: r.providerId, startedAtMs: this._time.now(), endedAtMs: this._time.now(), ok: false, error: err?.message, url: r.url });
      })
    );

    await Promise.all(fetchTasks);

    return {
      queries,
      results: deduped,
      selected,
      documents,
      evidences,
      ...(trace ? { trace: traceLog } : {}),
    };
  }
}
