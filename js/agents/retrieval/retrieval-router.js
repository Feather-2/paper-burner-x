import { buildIndex as buildBm25Index, search as bm25Search } from "./bm25.js";
import { grepChunks } from "./grep.js";
import { readAround } from "./readaround.js";
import { chunksInScope, selectScope } from "./scope.js";
import { buildToc } from "./toc-builder.js";

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

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
    const cached = sourceIndex && sourceIndex._bm25Cache && typeof sourceIndex._bm25Cache === "object" ? sourceIndex._bm25Cache : null;
    if (cached && cached.key === cacheKey && cached.index) {
      bm25Index = cached.index;
    } else {
      bm25Index = buildBm25Index(allChunks, config.bm25 || {});
      try {
        sourceIndex._bm25Cache = { key: cacheKey, index: bm25Index };
      } catch {
        // ignore non-extensible sourceIndex
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
