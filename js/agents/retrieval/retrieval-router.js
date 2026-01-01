import { buildIndex as buildBm25Index, search as bm25Search } from "./bm25.js";
import { grepChunks } from "./grep.js";
import { readAround } from "./readaround.js";
import { chunksInScope, selectScope } from "./scope.js";
import { buildToc } from "./toc-builder.js";

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

const _bm25CacheBySource = typeof WeakMap === "function" ? new WeakMap() : null;

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

let _mmrSegmenter = null;
function getMmrSegmenter() {
  if (_mmrSegmenter !== null) return _mmrSegmenter;
  try {
    if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
      _mmrSegmenter = new Intl.Segmenter(undefined, { granularity: "word" });
      return _mmrSegmenter;
    }
  } catch {
    // ignore
  }
  _mmrSegmenter = undefined;
  return _mmrSegmenter;
}

function mmrWordRegex() {
  try {
    // eslint-disable-next-line no-new
    new RegExp("\\p{L}", "u");
    return /[\p{L}\p{N}]+/gu;
  } catch {
    return /[A-Za-z0-9]+|[\u4e00-\u9fff]+|[\u3040-\u30ff]+|[\uac00-\ud7af]+/g;
  }
}

const MMR_WORD_RE = mmrWordRegex();

function tokenizeForSimilarity(text, { maxTokens = 200 } = {}) {
  const s = String(text || "").toLowerCase();
  if (!s) return [];

  const max = Number.isFinite(maxTokens) ? Math.max(10, Math.floor(maxTokens)) : 200;
  const seg = getMmrSegmenter();
  const out = [];
  const seen = new Set();

  const push = (t) => {
    if (!t) return;
    if (seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };

  if (seg && typeof seg.segment === "function") {
    for (const part of seg.segment(s)) {
      if (out.length >= max) break;
      if (part && part.isWordLike === false) continue;
      const t = String(part?.segment || "").trim().toLowerCase();
      if (!t) continue;
      push(t);
    }
    return out;
  }

  const tokens = s.match(MMR_WORD_RE) || [];
  for (const t of tokens) {
    if (out.length >= max) break;
    push(t);
  }
  return out;
}

function jaccardSimilarity(aTokens, bTokens) {
  const a = Array.isArray(aTokens) ? aTokens : [];
  const b = Array.isArray(bTokens) ? bTokens : [];
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0 || b.length === 0) return 0;

  const setA = new Set(a);
  let inter = 0;
  for (const t of b) {
    if (setA.has(t)) inter += 1;
  }
  const union = setA.size + new Set(b).size - inter;
  return union > 0 ? inter / union : 0;
}

function clamp01(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function mmrSelect(candidates, { topK, lambda = 0.7, seed = [] } = {}) {
  const list = Array.isArray(candidates) ? candidates : [];
  const k = Number.isFinite(topK) ? Math.max(0, Math.floor(topK)) : list.length;
  if (k <= 0) return [];
  if (list.length <= 1) return list.slice(0, k);

  const l = clamp01(lambda === undefined ? 0.7 : lambda);

  const selected = [];
  const selectedIds = new Set();

  for (const item of Array.isArray(seed) ? seed : []) {
    if (!item) continue;
    const id = String(item.chunkId || "");
    if (!id || selectedIds.has(id)) continue;
    selected.push(item);
    selectedIds.add(id);
    if (selected.length >= k) return selected.slice(0, k);
  }

  const byId = new Map();
  for (const c of list) {
    if (!c) continue;
    const id = String(c.chunkId || "");
    if (!id) continue;
    if (!byId.has(id)) byId.set(id, c);
  }

  const tokenCache = new Map(); // chunkId -> tokens[]
  const getTokens = (row) => {
    const id = String(row?.chunkId || "");
    if (!id) return [];
    if (tokenCache.has(id)) return tokenCache.get(id);
    const toks = tokenizeForSimilarity(row?.text || "", { maxTokens: 200 });
    tokenCache.set(id, toks);
    return toks;
  };

  const remaining = () => Array.from(byId.values()).filter((c) => !selectedIds.has(String(c.chunkId)));

  while (selected.length < k) {
    const pool = remaining();
    if (pool.length === 0) break;

    if (selected.length === 0) {
      pool.sort((a, b) => (b.score || 0) - (a.score || 0));
      const best = pool[0];
      selected.push(best);
      selectedIds.add(String(best.chunkId));
      continue;
    }

    let best = null;
    let bestScore = -Infinity;
    for (const cand of pool) {
      const rel = typeof cand.score === "number" && Number.isFinite(cand.score) ? cand.score : 0;
      const candTokens = getTokens(cand);
      let maxSim = 0;
      for (const sel of selected) {
        const sim = jaccardSimilarity(candTokens, getTokens(sel));
        if (sim > maxSim) maxSim = sim;
      }
      const mmr = l * rel - (1 - l) * maxSim;
      if (mmr > bestScore) {
        bestScore = mmr;
        best = cand;
      }
    }
    if (!best) break;
    selected.push(best);
    selectedIds.add(String(best.chunkId));
  }

  return selected.slice(0, k);
}

function safeFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function bm25CacheKey(chunks, bm25Options) {
  const k1 = safeFiniteNumber(bm25Options?.k1) ?? 1.2;
  const b = safeFiniteNumber(bm25Options?.b) ?? 0.75;
  const n = Array.isArray(chunks) ? chunks.length : 0;
  const firstId = n ? String(chunks[0]?.chunkId || "") : "";
  const lastId = n ? String(chunks[n - 1]?.chunkId || "") : "";
  return `${k1}|${b}|${n}|${firstId}|${lastId}`;
}

function ensureToc(sourceIndex) {
  if (sourceIndex && Array.isArray(sourceIndex.toc) && sourceIndex.toc.length) return sourceIndex.toc;
  if (sourceIndex && typeof sourceIndex.fullText === "string") {
    const { tocNodes } = buildToc(sourceIndex.fullText);
    return tocNodes;
  }
  return [];
}

/**
 * S4 Retrieval Router: scope selection -> search -> readAround -> return.
 *
 * @param {{sourceId:string,chunks:Array<{chunkId:string,text:string,locator:any}>,toc?:any[],fullText?:string}} sourceIndex
 * @param {Array<any>} gaps
 * @param {object=} config
 * @returns {Array<{chunkId:string,sourceId:string,locator:any,text:string,score?:number,relevance?:string,matchedGapIds?:string[]}>}
 */
export function retrieve(sourceIndex, gaps, config = {}) {
  if (!isPlainObject(sourceIndex)) throw new TypeError("retrieve(sourceIndex, gaps, config): sourceIndex must be an object");
  if (!Array.isArray(sourceIndex.chunks)) throw new TypeError("retrieve(sourceIndex, gaps, config): sourceIndex.chunks must be an array");
  if (!Array.isArray(gaps)) throw new TypeError("retrieve(sourceIndex, gaps, config): gaps must be an array");
  if (!isPlainObject(config)) throw new TypeError("retrieve(sourceIndex, gaps, config): config must be an object");

  const sourceId = String(sourceIndex.sourceId || "source_1");
  const allChunks = sourceIndex.chunks.slice().sort(sortByCharStart);
  const posByChunkId = new Map();
  for (let i = 0; i < allChunks.length; i++) posByChunkId.set(String(allChunks[i].chunkId), i);

  const tocNodes = ensureToc(sourceIndex);
  const topK = Number.isFinite(config.topK) ? Math.max(1, Math.floor(config.topK)) : 8;
  const windowSize = Number.isFinite(config.windowSize) ? Math.max(0, Math.floor(config.windowSize)) : 1;
  const useBm25 = config.useBm25 !== false;
  const useGrep = config.useGrep !== false;

  let bm25Index = null;
  if (useBm25) {
    const cacheKey = bm25CacheKey(allChunks, config.bm25);
    const cached = _bm25CacheBySource ? _bm25CacheBySource.get(sourceIndex) : null;
    if (cached && cached.key === cacheKey && cached.index) bm25Index = cached.index;
    else {
      bm25Index = buildBm25Index(allChunks, config.bm25 || {});
      try {
        _bm25CacheBySource?.set(sourceIndex, { key: cacheKey, index: bm25Index });
      } catch {
        // ignore if WeakMap unavailable / sourceIndex not compatible
      }
    }
  }

  const byChunkId = new Map();
  const hitRecords = [];

  for (const gap of gaps) {
    const queries = getGapQueries(gap);
    if (!queries.length) continue;

    const scope = selectScope(tocNodes, getGapTargetSectionId(gap));
    const scopedChunks = chunksInScope(allChunks, scope);
    if (!scopedChunks.length) continue;

    const scopedIdSet = new Set(scopedChunks.map((c) => c.chunkId));
    const scored = new Map(); // chunkId -> score
    let grepHitCount = 0;

    // 优先使用 grep 精确匹配
    for (const query of queries) {
      if (useGrep) {
        const grepMatches = grepChunks(scopedChunks, query, { regex: Boolean(config.grepRegex), caseSensitive: Boolean(config.caseSensitive) });
        for (const m of grepMatches) {
          // grep 匹配给更高的基础分，确保优先级
          const grepScore = scoreFromGrepMatchCount(m.matchCount) + 1.0;
          scored.set(m.chunkId, Math.max(scored.get(m.chunkId) || 0, grepScore));
          grepHitCount++;
        }
      }
    }

    // 只在 grep 结果不足时使用 BM25 补充
    const minGrepHits = typeof config.minGrepHits === "number" ? config.minGrepHits : 15;
    const bm25MinScore = typeof config.bm25MinScore === "number" ? config.bm25MinScore : 0.5;
    if (useBm25 && bm25Index && grepHitCount < minGrepHits) {
      for (const query of queries) {
        const results = bm25Search(bm25Index, query, topK * 5, {
          filterDocIndex: (docIndex) => scopedIdSet.has(bm25Index.chunkIds[docIndex]),
        });
        for (const r of results) {
          // BM25 结果需要超过阈值才使用
          if (r.score >= bm25MinScore) {
            scored.set(r.chunkId, Math.max(scored.get(r.chunkId) || 0, r.score));
          }
        }
      }
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

  // Optional: diversify hits via MMR before expanding readAround context.
  const mmrCfg = config.mmr;
  const diversify = mmrCfg === true || isPlainObject(mmrCfg);
  if (diversify) {
    const hits = Array.from(byChunkId.values()).filter((row) => row && row.relevance === "hit" && typeof row.score === "number");
    const uniqueHits = hits.length;
    const mmrTopKRaw = isPlainObject(mmrCfg) && typeof mmrCfg.topK === "number" ? mmrCfg.topK : null;
    const mmrTopK = mmrTopKRaw !== null && Number.isFinite(mmrTopKRaw) ? Math.max(1, Math.floor(mmrTopKRaw)) : Math.min(uniqueHits, topK * 3);
    const lambdaRaw = isPlainObject(mmrCfg) ? mmrCfg.lambda : null;
    const lambda = lambdaRaw !== null && lambdaRaw !== undefined ? clamp01(lambdaRaw) : 0.7;
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

    // Shrink hit records + hit map to diversified selection only.
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

  const retrieved = Array.from(byChunkId.values()).sort(sortByCharStart);
  return retrieved;
}
