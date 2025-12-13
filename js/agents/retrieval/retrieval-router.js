import { buildIndex as buildBm25Index, search as bm25Search } from "./bm25.js";
import { grepChunks } from "./grep.js";
import { readAround } from "./readaround.js";
import { chunksInScope, selectScope } from "./scope.js";
import { buildToc } from "./toc-builder.js";

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function getGapQuery(gap) {
  if (!gap) return "";
  if (typeof gap === "string") return gap;
  if (!isPlainObject(gap)) return "";
  return String(gap.query || gap.question || gap.title || gap.text || gap.description || "");
}

function getGapTargetSectionId(gap) {
  if (!gap || !isPlainObject(gap)) return null;
  const id = gap.targetSectionId || gap.sectionId || gap.tocNodeId || null;
  return typeof id === "string" && id ? id : null;
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
 * @returns {Array<{chunkId:string,sourceId:string,locator:any,text:string,score?:number,relevance?:string}>}
 */
export function retrieve(sourceIndex, gaps, config = {}) {
  if (!isPlainObject(sourceIndex)) throw new TypeError("retrieve(sourceIndex, gaps, config): sourceIndex must be an object");
  if (!Array.isArray(sourceIndex.chunks)) throw new TypeError("retrieve(sourceIndex, gaps, config): sourceIndex.chunks must be an array");
  if (!Array.isArray(gaps)) throw new TypeError("retrieve(sourceIndex, gaps, config): gaps must be an array");
  if (!isPlainObject(config)) throw new TypeError("retrieve(sourceIndex, gaps, config): config must be an object");

  const sourceId = String(sourceIndex.sourceId || "source_1");
  const allChunks = sourceIndex.chunks.slice().sort(sortByCharStart);

  const tocNodes = ensureToc(sourceIndex);
  const topK = Number.isFinite(config.topK) ? Math.max(1, Math.floor(config.topK)) : 8;
  const windowSize = Number.isFinite(config.windowSize) ? Math.max(0, Math.floor(config.windowSize)) : 1;
  const useBm25 = config.useBm25 !== false;
  const useGrep = config.useGrep !== false;

  const bm25Index = useBm25 ? buildBm25Index(allChunks, config.bm25 || {}) : null;

  const byChunkId = new Map();
  const hitChunkIds = [];

  for (const gap of gaps) {
    const query = getGapQuery(gap).trim();
    if (!query) continue;

    const scope = selectScope(tocNodes, getGapTargetSectionId(gap));
    const scopedChunks = chunksInScope(allChunks, scope);
    if (!scopedChunks.length) continue;

    const scopedIdSet = new Set(scopedChunks.map((c) => c.chunkId));
    const scored = new Map();

    if (useGrep) {
      const grepMatches = grepChunks(scopedChunks, query, { regex: Boolean(config.grepRegex), caseSensitive: Boolean(config.caseSensitive) });
      for (const m of grepMatches) scored.set(m.chunkId, Math.max(scored.get(m.chunkId) || 0, scoreFromGrepMatchCount(m.matchCount)));
    }

    if (useBm25 && bm25Index) {
      const results = bm25Search(bm25Index, query, topK * 5, {
        filterDocIndex: (docIndex) => scopedIdSet.has(bm25Index.chunkIds[docIndex]),
      });
      for (const r of results) scored.set(r.chunkId, Math.max(scored.get(r.chunkId) || 0, r.score));
    }

    const ranked = Array.from(scored.entries())
      .map(([chunkId, score]) => ({ chunkId, score }))
      .sort((a, b) => b.score - a.score);

    for (const r of ranked.slice(0, topK)) {
      hitChunkIds.push(r.chunkId);
      const chunk = scopedChunks.find((c) => c.chunkId === r.chunkId) || allChunks.find((c) => c.chunkId === r.chunkId);
      if (!chunk) continue;
      const existing = byChunkId.get(r.chunkId);
      if (!existing || (existing.score || 0) < r.score) {
        byChunkId.set(r.chunkId, { chunkId: r.chunkId, sourceId, locator: chunk.locator, text: chunk.text, score: r.score, relevance: "hit" });
      }
    }
  }

  const expanded = readAround(allChunks, Array.from(new Set(hitChunkIds)), windowSize);
  for (const c of expanded) {
    if (byChunkId.has(c.chunkId)) continue;
    byChunkId.set(c.chunkId, { chunkId: c.chunkId, sourceId, locator: c.locator, text: c.text, relevance: "context" });
  }

  const retrieved = Array.from(byChunkId.values()).sort(sortByCharStart);
  return retrieved;
}

