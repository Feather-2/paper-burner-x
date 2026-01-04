import { buildIndexAsync as buildBm25IndexAsync, search as bm25Search, serializeIndex as serializeBm25Index, deserializeIndex as deserializeBm25Index } from "./bm25.js";
import { grepChunksAsync } from "./grep.js";
import { readAround } from "./readaround.js";
import { chunksInScope, selectScope } from "./scope.js";
import { buildTocAsync } from "./toc-builder.js";
import { mmrSelect } from "./mmr.js";

import { isPlainObject } from "../shared/utils/value-utils.js";
function getGapId(gap) {
  if (!gap || !isPlainObject(gap)) return null;
  const id = gap.gapId || gap.id || null;
  return typeof id === "string" && id ? id : null;
}

function getGapQueries(gap) {
  if (!gap) return [];
  if (typeof gap === "string") {
    const s = gap.trim();
    return s ? [s] : [];
  }
  if (!isPlainObject(gap)) return [];

  const out = [];
  if (Array.isArray(gap.queryHints)) {
    for (const h of gap.queryHints) {
      const s = String(h || "").trim();
      if (s) out.push(s);
    }
  }

  const primary = String(gap.query || gap.question || gap.title || gap.text || gap.description || "").trim();
  if (primary) out.push(primary);

  return Array.from(new Set(out));
}

function getGapTargetSectionId(gap) {
  if (!gap || !isPlainObject(gap)) return null;
  const id = gap.targetSectionId || gap.sectionId || gap.tocNodeId || null;
  return typeof id === "string" && id ? id : null;
}

function mergeGapIds(existing, incoming) {
  const a = Array.isArray(existing) ? existing.map(String).filter(Boolean) : [];
  const b = Array.isArray(incoming) ? incoming.map(String).filter(Boolean) : [];
  if (!a.length) return b;
  if (!b.length) return a;
  return Array.from(new Set([...a, ...b]));
}

function sortByCharStart(a, b) {
  const as = a && a.locator && Number.isFinite(a.locator.charStart) ? a.locator.charStart : 0;
  const bs = b && b.locator && Number.isFinite(b.locator.charStart) ? b.locator.charStart : 0;
  return as - bs;
}

function scoreFromGrepMatchCount(matchCount) {
  // Keep grep scores roughly comparable to BM25 scores for merging.
  return Math.log(1 + Math.max(0, matchCount));
}

function safeFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function normalizeScoreMergeConfig(config) {
  const cfg = isPlainObject(config) ? config : {};
  const wGrep = safeFiniteNumber(cfg.wGrep ?? cfg.grepWeight ?? cfg.grep) ?? 0.7;
  const wBm25 = safeFiniteNumber(cfg.wBm25 ?? cfg.bm25Weight ?? cfg.bm25) ?? 0.3;
  const grepBase = safeFiniteNumber(cfg.grepBase ?? cfg.grepBonus ?? cfg.grepMatchBase) ?? 1.0;

  const sum = wGrep + wBm25;
  const normGrep = sum > 0 ? wGrep / sum : 0.7;
  const normBm25 = sum > 0 ? wBm25 / sum : 0.3;
  return { wGrep: normGrep, wBm25: normBm25, grepBase };
}

function resolveBm25IndexStore(config) {
  const cfg = isPlainObject(config) ? config : {};
  const store = cfg.bm25IndexStore || cfg.indexStore || cfg.persistence?.bm25IndexStore || null;
  if (!store || typeof store !== "object") return null;
  if (typeof store.get !== "function") return null;
  // set() is optional: read-only stores are allowed
  return store;
}

function resolveBm25IndexCache(config) {
  const cfg = isPlainObject(config) ? config : {};
  const cache = cfg.bm25IndexCache || cfg.indexCache || cfg.persistence?.bm25IndexCache || null;
  if (!cache || typeof cache !== "object") return null;
  if (typeof cache.get !== "function" || typeof cache.set !== "function") return null;
  return cache;
}

function bm25PersistKey(sourceIndex, chunks, bm25Options) {
  const sourceId = String(sourceIndex?.sourceId || "source_1");
  const textHash = typeof sourceIndex?.textHash === "string" ? sourceIndex.textHash.trim() : "";
  const base = bm25CacheKey(chunks, bm25Options);
  return textHash ? `bm25|${sourceId}|${textHash}|${base}` : `bm25|${sourceId}|${base}`;
}

function isCompatibleBm25Index(index, chunks) {
  if (!index || typeof index !== "object") return false;
  if (!Array.isArray(index.chunkIds)) return false;
  const n = Array.isArray(chunks) ? chunks.length : 0;
  if (index.chunkIds.length !== n) return false;
  if (!n) return true;
  for (let i = 0; i < n; i++) {
    if (String(index.chunkIds[i] || "") !== String(chunks[i]?.chunkId || "")) return false;
  }
  return true;
}

async function loadBm25IndexFromStore(store, key) {
  if (!store || typeof store.get !== "function") return null;
  try {
    const raw = await store.get(key);
    if (!raw) return null;
    const snapshot = typeof raw === "string" ? JSON.parse(raw) : raw;
    return deserializeBm25Index(snapshot);
  } catch {
    return null;
  }
}

async function saveBm25IndexToStore(store, key, index) {
  if (!store || typeof store.set !== "function") return false;
  try {
    const snapshot = serializeBm25Index(index);
    await store.set(key, snapshot);
    return true;
  } catch {
    return false;
  }
}

function bm25CacheKey(chunks, bm25Options) {
  const k1 = safeFiniteNumber(bm25Options?.k1) ?? 1.2;
  const b = safeFiniteNumber(bm25Options?.b) ?? 0.75;
  const n = Array.isArray(chunks) ? chunks.length : 0;
  const firstId = n ? String(chunks[0]?.chunkId || "") : "";
  const lastId = n ? String(chunks[n - 1]?.chunkId || "") : "";
  return `${k1}|${b}|${n}|${firstId}|${lastId}`;
}

async function ensureTocAsync(sourceIndex, { signal } = {}) {
  if (sourceIndex && Array.isArray(sourceIndex.toc) && sourceIndex.toc.length) return sourceIndex.toc;
  if (sourceIndex && typeof sourceIndex.fullText === "string") {
    const text = sourceIndex.fullText;
    const { tocNodes } = await buildTocAsync(text, { signal, yieldEveryLines: 800 });
    return tocNodes;
  }
  return [];
}

function sleep0() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * S4 Retrieval Router: scope selection -> search -> readAround -> return.
 *
 * @param {{sourceId:string,chunks:Array<{chunkId:string,text:string,locator:any}>,toc?:any[],fullText?:string}} sourceIndex
 * @param {Array<any>} gaps
 * @param {object=} config
 * @returns {Promise<Array<{chunkId:string,sourceId:string,locator:any,text:string,score?:number,relevance?:string,matchedGapIds?:string[]}>>}
 */
export async function retrieve(sourceIndex, gaps, config = {}) {
  if (!isPlainObject(sourceIndex)) throw new TypeError("retrieve(sourceIndex, gaps, config): sourceIndex must be an object");
  if (!Array.isArray(sourceIndex.chunks)) throw new TypeError("retrieve(sourceIndex, gaps, config): sourceIndex.chunks must be an array");
  if (!Array.isArray(gaps)) throw new TypeError("retrieve(sourceIndex, gaps, config): gaps must be an array");
  if (!isPlainObject(config)) throw new TypeError("retrieve(sourceIndex, gaps, config): config must be an object");

  const signal = config.signal;

  const sourceId = String(sourceIndex.sourceId || "source_1");
  const allChunks = sourceIndex.chunks.slice().sort(sortByCharStart);
  const posByChunkId = new Map();
  for (let i = 0; i < allChunks.length; i++) posByChunkId.set(String(allChunks[i].chunkId), i);

  const tocNodes = await ensureTocAsync(sourceIndex, { signal });
  const topK = Number.isFinite(config.topK) ? Math.max(1, Math.floor(config.topK)) : 8;
  const windowSize = Number.isFinite(config.windowSize) ? Math.max(0, Math.floor(config.windowSize)) : 1;
  const useBm25 = config.useBm25 !== false;
  const useGrep = config.useGrep !== false;

  let bm25Index = null;
  if (useBm25) {
    const cache = resolveBm25IndexCache(config);
    const store = resolveBm25IndexStore(config);
    const persistKey = cache || store ? bm25PersistKey(sourceIndex, allChunks, config.bm25) : null;

    if (cache && persistKey) {
      try {
        const cached = cache.get(persistKey);
        if (cached && isCompatibleBm25Index(cached, allChunks)) bm25Index = cached;
      } catch {
        // ignore cache failures
      }
    }

    if (!bm25Index && store && persistKey) {
      const loaded = await loadBm25IndexFromStore(store, persistKey);
      if (loaded && isCompatibleBm25Index(loaded, allChunks)) {
        bm25Index = loaded;
      }
    }

    if (!bm25Index) {
      bm25Index = await buildBm25IndexAsync(allChunks, { ...(config.bm25 || {}), signal, yieldEveryDocs: 80 });
      if (store && persistKey && config.persistBm25Index !== false) {
        await saveBm25IndexToStore(store, persistKey, bm25Index);
      }
    }

    if (cache && persistKey && bm25Index) {
      try {
        cache.set(persistKey, bm25Index);
      } catch {
        // ignore cache failures
      }
    }
  }

  const byChunkId = new Map();
  const hitRecords = [];

  const grepAsyncThreshold =
    typeof config.grepAsyncThreshold === "number" && Number.isFinite(config.grepAsyncThreshold)
      ? Math.max(0, Math.floor(config.grepAsyncThreshold))
      : 2000;
  const grepYieldEvery =
    typeof config.grepYieldEvery === "number" && Number.isFinite(config.grepYieldEvery) && config.grepYieldEvery > 0
      ? Math.floor(config.grepYieldEvery)
      : 200;

  for (let gi = 0; gi < gaps.length; gi++) {
    if (signal?.aborted) throw new Error("retrieve: aborted");
    if (gi > 0 && gi % 20 === 0) await sleep0();

    const gap = gaps[gi];
    const queries = getGapQueries(gap);
    if (!queries.length) continue;

    const scope = selectScope(tocNodes, getGapTargetSectionId(gap));
    const scopedChunks = chunksInScope(allChunks, scope);
    if (!scopedChunks.length) continue;

    const scopedIdSet = new Set(scopedChunks.map((c) => c.chunkId));
    const grepCounts = new Map(); // chunkId -> matchCount
    const bm25Scores = new Map(); // chunkId -> score
    let grepHitCount = 0;

    for (const query of queries) {
      if (!useGrep) continue;
      const shouldAsync = (signal && typeof signal === "object") || scopedChunks.length >= grepAsyncThreshold;
      const grepMatches = shouldAsync
        ? await grepChunksAsync(scopedChunks, query, {
            regex: Boolean(config.grepRegex),
            caseSensitive: Boolean(config.caseSensitive),
            signal,
            yieldEvery: grepYieldEvery,
          })
        : grepChunks(scopedChunks, query, { regex: Boolean(config.grepRegex), caseSensitive: Boolean(config.caseSensitive) });

      for (const m of grepMatches) {
        const prev = grepCounts.get(m.chunkId) || 0;
        grepCounts.set(m.chunkId, Math.max(prev, m.matchCount));
        grepHitCount++;
      }
    }

    const minGrepHits = typeof config.minGrepHits === "number" ? config.minGrepHits : 15;
    const bm25MinScore = typeof config.bm25MinScore === "number" ? config.bm25MinScore : 0.5;
    if (useBm25 && bm25Index && grepHitCount < minGrepHits) {
      for (const query of queries) {
        const results = bm25Search(bm25Index, query, topK * 5, {
          filterDocIndex: (docIndex) => scopedIdSet.has(bm25Index.chunkIds[docIndex]),
        });
        for (const r of results) {
          if (r.score >= bm25MinScore) {
            bm25Scores.set(r.chunkId, Math.max(bm25Scores.get(r.chunkId) || 0, r.score));
          }
        }
      }
    }

    const scoring = normalizeScoreMergeConfig(config.scoreMerge || config.scoring);
    let maxGrepMatch = 0;
    for (const c of grepCounts.values()) maxGrepMatch = Math.max(maxGrepMatch, c || 0);
    const maxGrepScore = maxGrepMatch > 0 ? scoreFromGrepMatchCount(maxGrepMatch) : 0;
    let maxBm25Score = 0;
    for (const s of bm25Scores.values()) maxBm25Score = Math.max(maxBm25Score, s || 0);

    const scored = new Map(); // chunkId -> merged score
    const allIds = new Set([...grepCounts.keys(), ...bm25Scores.keys()]);
    for (const chunkId of allIds) {
      const matchCount = grepCounts.get(chunkId) || 0;
      const bm25Score = bm25Scores.get(chunkId) || 0;
      const grepNorm = matchCount > 0 && maxGrepScore > 0 ? scoreFromGrepMatchCount(matchCount) / maxGrepScore : 0;
      const bm25Norm = bm25Score > 0 && maxBm25Score > 0 ? bm25Score / maxBm25Score : 0;
      // Merge signals without a constant "always-on" bonus:
      // grepBase is treated as an extra weight on grepNorm (not an additive floor),
      // so BM25 can still influence ranking when grep matches are weak.
      const merged = (scoring.wGrep + (matchCount > 0 ? scoring.grepBase : 0)) * grepNorm + scoring.wBm25 * bm25Norm;
      if (merged > 0) scored.set(chunkId, merged);
    }

    const ranked = Array.from(scored.entries())
      .map(([chunkId, score]) => ({ chunkId, score }))
      .sort((a, b) => b.score - a.score);

    const gapId = getGapId(gap);
    for (const r of ranked.slice(0, topK)) {
      if (gapId) hitRecords.push({ chunkId: String(r.chunkId), gapId });
      const chunk = scopedChunks.find((c) => c.chunkId === r.chunkId) || allChunks.find((c) => c.chunkId === r.chunkId);
      if (!chunk) continue;
      const existing = byChunkId.get(r.chunkId);
      if (!existing || (existing.score || 0) < r.score) {
        byChunkId.set(r.chunkId, {
          chunkId: r.chunkId,
          sourceId,
          locator: chunk.locator,
          text: chunk.text,
          score: r.score,
          relevance: "hit",
          ...(gapId ? { matchedGapIds: [gapId] } : {}),
        });
      } else if (gapId) {
        byChunkId.set(r.chunkId, { ...existing, matchedGapIds: mergeGapIds(existing.matchedGapIds, [gapId]) });
      }
    }
  }

  const mmrCfg = config.mmr;
  const diversify = mmrCfg === true || isPlainObject(mmrCfg);
  if (diversify) {
    const hits = Array.from(byChunkId.values()).filter((row) => row && row.relevance === "hit" && typeof row.score === "number");
    const uniqueHits = hits.length;
    const mmrTopKRaw = isPlainObject(mmrCfg) && typeof mmrCfg.topK === "number" ? mmrCfg.topK : null;
    const mmrTopK = mmrTopKRaw !== null && Number.isFinite(mmrTopKRaw) ? Math.max(1, Math.floor(mmrTopKRaw)) : Math.min(uniqueHits, topK * 3);
    const lambdaRaw = isPlainObject(mmrCfg) ? mmrCfg.lambda : null;
    const lambda = lambdaRaw !== null && lambdaRaw !== undefined ? lambdaRaw : 0.7;
    const seedByGap = isPlainObject(mmrCfg) ? mmrCfg.seedByGap !== false : true;

    const seed = [];
    if (seedByGap) {
      const bestByGap = new Map(); // gapId -> row
      for (const row of hits) {
        const ids = Array.isArray(row.matchedGapIds) ? row.matchedGapIds : [];
        for (const gapId of ids) {
          const g = typeof gapId === "string" ? gapId : "";
          if (!g) continue;
          const prev = bestByGap.get(g);
          if (!prev || (prev.score || 0) < (row.score || 0)) bestByGap.set(g, row);
        }
      }
      for (const row of bestByGap.values()) seed.push(row);
      seed.sort((a, b) => (b.score || 0) - (a.score || 0));
    }

    const selected = mmrSelect(hits, { topK: mmrTopK, lambda, seed });
    const selectedIds = new Set(selected.map((r) => String(r.chunkId)));

    for (const cid of Array.from(byChunkId.keys())) {
      if (!selectedIds.has(String(cid))) byChunkId.delete(cid);
    }
    for (let i = hitRecords.length - 1; i >= 0; i--) {
      if (!selectedIds.has(String(hitRecords[i]?.chunkId))) hitRecords.splice(i, 1);
    }
  }

  if (windowSize > 0 && hitRecords.length) {
    const gapIdsByChunkId = new Map(); // chunkId -> string[]

    for (const row of byChunkId.values()) {
      if (row && row.matchedGapIds) gapIdsByChunkId.set(String(row.chunkId), mergeGapIds([], row.matchedGapIds));
    }

    for (const hr of hitRecords) {
      const pos = posByChunkId.get(String(hr.chunkId));
      if (pos === undefined) continue;
      const lo = Math.max(0, pos - windowSize);
      const hi = Math.min(allChunks.length - 1, pos + windowSize);
      for (let i = lo; i <= hi; i++) {
        const cid = String(allChunks[i].chunkId);
        gapIdsByChunkId.set(cid, mergeGapIds(gapIdsByChunkId.get(cid), [hr.gapId]));
      }
    }

    const expanded = readAround(allChunks, Array.from(new Set(hitRecords.map((h) => h.chunkId))), windowSize);
    for (const c of expanded) {
      const cid = String(c.chunkId);
      if (byChunkId.has(cid)) {
        const existing = byChunkId.get(cid);
        if (existing && gapIdsByChunkId.has(cid)) byChunkId.set(cid, { ...existing, matchedGapIds: mergeGapIds(existing.matchedGapIds, gapIdsByChunkId.get(cid)) });
        continue;
      }
      byChunkId.set(cid, {
        chunkId: cid,
        sourceId,
        locator: c.locator,
        text: c.text,
        relevance: "context",
        ...(gapIdsByChunkId.has(cid) ? { matchedGapIds: gapIdsByChunkId.get(cid) } : {}),
      });
    }
  }

  const asyncRetrieved = Array.from(byChunkId.values()).sort(sortByCharStart);

  return asyncRetrieved;
}

/**
 * Backward-compatible alias for async-only retrieval.
 */
export async function retrieveAsync(sourceIndex, gaps, config = {}) {
  return retrieve(sourceIndex, gaps, config);
}
