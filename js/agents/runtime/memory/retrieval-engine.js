import { isPlainObject, toNonEmptyString } from "../../shared/utils/value-utils.js";
import { EmbeddingService } from "../../shared/embeddings/embedding-service.js";
import { VectorIndex } from "../../shared/embeddings/vector-index.js";

function toPositiveInt(value, fallback) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function tokenizeQuery(text) {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    .split(/[\s,，。！？；：""''（）【】\[\]{}]+/)
    .filter((t) => t.length >= 2);
}

function buildArchiveEmbeddingText(entry) {
  const e = entry && typeof entry === "object" ? entry : null;
  if (!e) return "";
  const stage = toNonEmptyString(e.stageKey) || "";
  const summary = toNonEmptyString(e.summary) || "";
  const prefix = stage ? `stage:${stage}` : "";
  const text = [prefix, summary].filter(Boolean).join("\n");
  return text.trim();
}

export class RetrievalEngine {
  constructor(options = {}) {
    const opts = isPlainObject(options) ? options : {};
    const memoryStore = opts.memoryStore || opts.store || null;
    if (!memoryStore) throw new Error("RetrievalEngine requires { memoryStore }");

    this.memoryStore = memoryStore;
    this.eventBus = opts.eventBus || memoryStore.eventBus || null;

    const embeddingService = opts.embeddingService ?? memoryStore.embeddingService ?? memoryStore._embeddingService ?? null;
    this.embeddingService = embeddingService instanceof EmbeddingService || (embeddingService && typeof embeddingService === "object")
      ? embeddingService
      : null;

    const maxItems = toPositiveInt(opts.vectorMaxItems ?? memoryStore.config?.vectorMaxItems, 1000);
    const vectorIndex = opts.vectorIndex ?? memoryStore.vectorIndex ?? memoryStore._vectorIndex ?? null;
    if (vectorIndex) {
      this.vectorIndex = vectorIndex;
    } else if (this.embeddingService) {
      this.vectorIndex = new VectorIndex({ maxItems });
    } else {
      this.vectorIndex = null;
    }

    this._unsubscribeArchived = null;
    if (opts.subscribe !== false) {
      this._subscribeToMemoryEvents();
    }
  }

  _subscribeToMemoryEvents() {
    if (!this.eventBus || typeof this.eventBus.on !== "function") return;
    if (this._unsubscribeArchived) return;

    this._unsubscribeArchived = this.eventBus.on("memory.archived", (evt) => {
      const payload = evt && typeof evt === "object" ? evt.payload : null;
      const id = toNonEmptyString(payload?.id);
      if (!id) return;
      this.queueIndexArchive(id);
    });
  }

  dispose() {
    if (this._unsubscribeArchived) {
      try {
        this._unsubscribeArchived();
      } catch {
        // ignore
      }
      this._unsubscribeArchived = null;
    }
  }

  queueIndexArchive(archiveId) {
    const id = toNonEmptyString(archiveId);
    if (!id) return false;
    const svc = this.embeddingService;
    const idx = this.vectorIndex;
    if (!svc || typeof svc.enqueue !== "function") return false;
    if (!idx || typeof idx.upsert !== "function") return false;

    const entry = this.memoryStore?._L3?.snapshots?.get?.(id) || null;
    if (!entry) return false;

    const text = buildArchiveEmbeddingText(entry);
    if (!text) return false;

    void svc
      .enqueue([text], { immediate: false })
      .then((vectors) => {
        const v = Array.isArray(vectors) ? vectors[0] : null;
        if (!v) return;
        try {
          idx.upsert(id, v, { stageKey: entry.stageKey, ts: entry.ts });
        } catch {
          // ignore vector dimension errors / index failures
        }
      })
      .catch(() => {});

    return true;
  }

  async ensureIndexed({ timeoutMs } = {}) {
    const svc = this.embeddingService;
    const idx = this.vectorIndex;
    if (!svc || typeof svc.embed !== "function") return false;
    if (!idx || typeof idx.upsert !== "function") return false;

    const snapshots = this.memoryStore?._L3?.snapshots;
    if (!snapshots || typeof snapshots.entries !== "function") return true;

    const pending = [];
    for (const [id, entry] of snapshots.entries()) {
      if (typeof idx.has === "function" && idx.has(id)) continue;
      const text = buildArchiveEmbeddingText(entry);
      if (!text) continue;
      pending.push({ id, entry, text });
    }

    if (!pending.length) return true;

    const vectors = await svc.embed(
      pending.map((p) => p.text),
      { ...(timeoutMs ? { timeoutMs } : {}) }
    );
    if (!Array.isArray(vectors) || vectors.length !== pending.length) return false;

    for (let i = 0; i < pending.length; i++) {
      const row = pending[i];
      const vec = vectors[i];
      if (!vec) continue;
      try {
        idx.upsert(row.id, vec, { stageKey: row.entry.stageKey, ts: row.entry.ts });
      } catch {
        // ignore vector dimension errors / index failures
      }
    }

    return true;
  }

  /**
   * Backward-compatible entrypoint: keyword recall.
   * @param {string} query
   * @param {number|{limit?:number}} [limitOrOptions]
   */
  recall(query, limitOrOptions = 3) {
    if (isPlainObject(limitOrOptions)) return this.keywordRecall(query, limitOrOptions);
    return this.keywordRecall(query, { limit: limitOrOptions });
  }

  keywordRecall(query, { limit = 3 } = {}) {
    const q = toNonEmptyString(query) || "";
    const k = toPositiveInt(limit, 3);

    const timeline = this.memoryStore?._L3?.index?.timeline;
    const snapshots = this.memoryStore?._L3?.snapshots;
    const keywordIndex = this.memoryStore?._L3?.index?.keywords;
    if (!Array.isArray(timeline) || !snapshots || typeof snapshots.get !== "function") return [];

    const keywords = tokenizeQuery(q);
    if (!keywords.length) {
      return timeline
        .slice(-k)
        .reverse()
        .map((t) => {
          const snap = snapshots.get(t.id);
          return snap ? { id: t.id, summary: t.summary, data: snap.data } : null;
        })
        .filter(Boolean);
    }

    const scores = new Map();
    for (const kw of keywords) {
      const ids = keywordIndex?.get?.(kw.toLowerCase());
      if (!ids) continue;
      for (const id of ids) {
        scores.set(id, (scores.get(id) || 0) + 1);
      }
    }

    const ranked = Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, k);

    return ranked
      .map(([id]) => {
        const snap = snapshots.get(id);
        return snap ? { id, summary: snap.summary, data: snap.data } : null;
      })
      .filter(Boolean);
  }

  async semanticRecall(query, { limit = 3, fallback = true, timeoutMs } = {}) {
    const q = toNonEmptyString(query) || "";
    const k = toPositiveInt(limit, 3);

    const svc = this.embeddingService;
    const idx = this.vectorIndex;
    if (!svc || typeof svc.embed !== "function" || !idx || typeof idx.search !== "function") {
      return fallback ? this.keywordRecall(q, { limit: k }) : [];
    }

    // Ensure archive vectors exist (best-effort); doesn't block queue-based indexing.
    await this.ensureIndexed({ ...(timeoutMs ? { timeoutMs } : {}) });

    const vectors = await svc.embed([q], { ...(timeoutMs ? { timeoutMs } : {}) });
    const v = Array.isArray(vectors) ? vectors[0] : null;
    if (!v) return fallback ? this.keywordRecall(q, { limit: k }) : [];

    const hits = idx.search(v, { topK: k });
    const out = [];
    for (const h of hits) {
      const snap = this.memoryStore?._L3?.snapshots?.get?.(h.id) || null;
      if (!snap) continue;
      out.push({ id: h.id, score: h.score, summary: snap.summary, data: snap.data });
    }

    if (out.length) return out;
    return fallback ? this.keywordRecall(q, { limit: k }) : [];
  }

  async hybridRecall(query, { limit = 3, fallback = true, timeoutMs } = {}) {
    const q = toNonEmptyString(query) || "";
    const k = toPositiveInt(limit, 3);

    const semantic = await this.semanticRecall(q, { limit: k, fallback: false, ...(timeoutMs ? { timeoutMs } : {}) });
    const keyword = this.keywordRecall(q, { limit: k });

    const out = [];
    const seen = new Set();
    for (const row of semantic) {
      if (out.length >= k) break;
      if (!row?.id) continue;
      out.push(row);
      seen.add(row.id);
    }
    for (const row of keyword) {
      if (out.length >= k) break;
      if (!row?.id || seen.has(row.id)) continue;
      out.push(row);
      seen.add(row.id);
    }

    if (out.length) return out;
    return fallback ? keyword : [];
  }
}

export default RetrievalEngine;
