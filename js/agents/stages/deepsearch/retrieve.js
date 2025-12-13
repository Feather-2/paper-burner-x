import { DeepSearchState, checkCancelled, makeStageEmitter } from "./state.js";
import { chunkText } from "../textprep/chunk.js";
import { retrieve as retrieveWithRouter } from "../../retrieval/retrieval-router.js";

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export function deduplicateChunks(newChunks, existingChunks) {
  const existingIds = new Set((Array.isArray(existingChunks) ? existingChunks : []).map((c) => c?.chunkId));
  const existingTexts = new Set((Array.isArray(existingChunks) ? existingChunks : []).map((c) => c?.text?.slice(0, 200)));

  return (Array.isArray(newChunks) ? newChunks : []).filter((c) => !existingIds.has(c?.chunkId) && !existingTexts.has(c?.text?.slice(0, 200)));
}

function ensureState(_runContext, input) {
  if (input instanceof DeepSearchState) return input;
  if (input?.state instanceof DeepSearchState) return input.state;
  if (isPlainObject(input?.state)) return DeepSearchState.fromJSON(input.state);
  throw new TypeError("DeepSearch retrieve: input.state is required");
}

function toNonEmptyString(v) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

function safeInt(n) {
  return typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : null;
}

function clampProgress(progress) {
  if (typeof progress !== "number" || !Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(1, progress));
}

function emitRetrieveProgress(emit, { current, total, msg, detail }) {
  emit?.(
    "deepsearch.retrieve.progress",
    {
      phase: "retrieve",
      step: "gap",
      current,
      total: Math.max(1, total),
      progress: clampProgress(total > 0 ? current / total : 1),
      msg: String(msg || ""),
      ...(detail && typeof detail === "object" && !Array.isArray(detail) ? { detail } : {}),
    },
    { status: "progress" }
  );
}

function nextAddedSeq(existingChunks) {
  let maxSeq = 0;
  for (const c of Array.isArray(existingChunks) ? existingChunks : []) {
    const seq = typeof c?.addedSeq === "number" && Number.isFinite(c.addedSeq) ? c.addedSeq : 0;
    if (seq > maxSeq) maxSeq = seq;
  }
  return maxSeq + 1;
}

function ensureAddedMeta(chunks, { now, startSeq } = {}) {
  let seq = safeInt(startSeq) ?? 1;
  const t = typeof now === "string" && now ? now : new Date().toISOString();
  for (const c of Array.isArray(chunks) ? chunks : []) {
    if (!c || typeof c !== "object") continue;
    if (!(typeof c.addedSeq === "number" && Number.isFinite(c.addedSeq))) {
      c.addedSeq = seq;
      seq += 1;
    } else {
      seq = Math.max(seq, c.addedSeq + 1);
    }
    if (!toNonEmptyString(c.addedAt)) c.addedAt = t;
  }
  return seq;
}

function applyChunkLru(chunks, { maxChunks } = {}) {
  const max = safeInt(maxChunks);
  if (max === null || max <= 0) return Array.isArray(chunks) ? chunks : [];
  const arr = Array.isArray(chunks) ? chunks : [];
  if (arr.length <= max) return arr;

  const over = arr.length - max;
  if (over <= 0) return arr;

  const removeConsumedIndexes = [];
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] && arr[i].consumed) removeConsumedIndexes.push(i);
  }

  const consumedToRemove = new Set(removeConsumedIndexes.slice(0, over));
  const afterConsumed = consumedToRemove.size ? arr.filter((_, i) => !consumedToRemove.has(i)) : arr;
  if (afterConsumed.length <= max) return afterConsumed;

  return afterConsumed.slice(afterConsumed.length - max);
}

function normalizeChunkIdList(v) {
  const out = [];
  const seen = new Set();
  for (const x of Array.isArray(v) ? v : []) {
    const id = toNonEmptyString(x);
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function trackSeenChunkIds(state, chunkIds, { maxSize } = {}) {
  if (!state || typeof state !== "object") return [];
  if (!isPlainObject(state.L2)) state.L2 = {};
  const existing = normalizeChunkIdList(state.L2.retrievedChunkIdsSeen);
  const next = existing.slice();
  const seen = new Set(existing);

  for (const id of normalizeChunkIdList(chunkIds)) {
    if (seen.has(id)) continue;
    seen.add(id);
    next.push(id);
  }

  const cap = safeInt(maxSize);
  if (cap !== null && cap > 0 && next.length > cap) {
    const trimmed = next.slice(next.length - cap);
    state.L2.retrievedChunkIdsSeen = trimmed;
    return trimmed;
  }

  state.L2.retrievedChunkIdsSeen = next;
  return next;
}

/**
 * S4 Retrieval Router wrapper: TOC-scope -> BM25/grep -> readAround.
 * @param {object} runContext
 * @param {DeepSearchState|{state:DeepSearchState|object}} input
 * @param {{emit?:Function,eventBus?:object,signal?:AbortSignal,checkCancelled?:Function}=} stageApi
 */
export async function runDeepSearchRetrieveStage(runContext, input, stageApi = {}) {
  const emit = makeStageEmitter(stageApi, "deepsearch");
  const state = ensureState(runContext, input);

  checkCancelled(stageApi);
  const sources = Array.isArray(state?.L0?.sources) ? state.L0.sources : [];
  const gapsAll = Array.isArray(state?.L1?.gaps) ? state.L1.gaps : [];
  const gaps = gapsAll.filter((g) => String(g?.status || "open") === "open");
  const existingChunks = Array.isArray(state?.L2?.retrievedChunks) ? state.L2.retrievedChunks : [];

  const retrievalConfig = isPlainObject(state?.userConfig?.retrieval) ? state.userConfig.retrieval : {};
  const chunkSize = Number.isFinite(retrievalConfig.chunkSize) ? Math.max(200, Math.floor(retrievalConfig.chunkSize)) : 1600;
  const overlap = Number.isFinite(retrievalConfig.overlap) ? Math.max(0, Math.floor(retrievalConfig.overlap)) : 180;
  const topK = Number.isFinite(retrievalConfig.topK) ? Math.max(1, Math.floor(retrievalConfig.topK)) : 6;
  const windowSize = Number.isFinite(retrievalConfig.windowSize) ? Math.max(0, Math.floor(retrievalConfig.windowSize)) : 1;
  const maxChunks = safeInt(retrievalConfig.maxChunks) ?? 100;

  const routerConfig = {
    topK,
    windowSize,
    useBm25: retrievalConfig.useBm25 !== false,
    useGrep: retrievalConfig.useGrep !== false,
    grepRegex: Boolean(retrievalConfig.grepRegex),
    caseSensitive: Boolean(retrievalConfig.caseSensitive),
    bm25: isPlainObject(retrievalConfig.bm25) ? retrievalConfig.bm25 : {},
  };

  const sourceIndexes = [];
  for (const s of sources) {
    const sourceId = toNonEmptyString(s?.sourceId) || "source_unknown";
    const fullText = typeof s?.sourceTextNormalized === "string" ? s.sourceTextNormalized : "";
    if (!fullText) continue;

    const rawChunks = Array.isArray(s?.chunks)
      ? s.chunks
      : chunkText(fullText, { chunkSize, overlap, includeLineNumbers: Boolean(retrievalConfig.includeLineNumbers) });

    const chunks = rawChunks
      .map((c, i) => {
        const cid = toNonEmptyString(c?.chunkId) || `chunk_${i + 1}`;
        const chunkId = cid.startsWith(`${sourceId}::`) ? cid : `${sourceId}::${cid}`;
        const text = typeof c?.text === "string" ? c.text : "";
        const locator = isPlainObject(c?.locator) ? c.locator : null;
        return locator && Number.isFinite(locator.charStart) && Number.isFinite(locator.charEnd)
          ? { chunkId, text, locator: { ...locator } }
          : null;
      })
      .filter(Boolean);

    const sourceIndex = {
      sourceId,
      fullText,
      toc: Array.isArray(s?.toc) ? s.toc : Array.isArray(s?.tocNodes) ? s.tocNodes : undefined,
      chunks,
    };
    sourceIndexes.push(sourceIndex);
  }

  const existingByChunkId = new Map();
  for (const r of existingChunks) {
    const cid = toNonEmptyString(r?.chunkId);
    if (cid) existingByChunkId.set(cid, r);
  }

  const retrievedByChunkId = new Map(); // chunkId -> merged row (without retrievedId)
  for (let i = 0; i < gaps.length; i++) {
    const g = gaps[i];
    const gapId = toNonEmptyString(g?.gapId) || `gap_${i + 1}`;

    emitRetrieveProgress(emit, {
      current: i + 1,
      total: gaps.length,
      msg: `Retrieving evidence for gap ${gapId}${g?.question ? `: ${String(g.question).slice(0, 80)}` : ""}`,
      detail: { gapId, type: toNonEmptyString(g?.type) || "unknown", priority: toNonEmptyString(g?.priority) || "medium", question: toNonEmptyString(g?.question) || "" },
    });

    for (const sourceIndex of sourceIndexes) {
      const retrieved = retrieveWithRouter(sourceIndex, [{ ...g, gapId }], routerConfig);
      for (const r of retrieved) {
        const chunkId = String(r?.chunkId || "");
        if (!chunkId) continue;

        const matchedGapIds = Array.isArray(r?.matchedGapIds) ? r.matchedGapIds.map(String).filter(Boolean) : [gapId];
        if (!matchedGapIds.includes(gapId)) matchedGapIds.unshift(gapId);

        const existing = retrievedByChunkId.get(chunkId);
        if (!existing) {
          retrievedByChunkId.set(chunkId, {
            chunkId,
            sourceId: String(r?.sourceId || sourceIndex.sourceId),
            locator: r?.locator,
            text: String(r?.text || ""),
            ...(typeof r?.score === "number" && Number.isFinite(r.score) ? { score: r.score } : {}),
            ...(toNonEmptyString(r?.relevance) ? { relevance: String(r.relevance) } : {}),
            matchedGapIds: matchedGapIds.slice(),
            gapId: matchedGapIds[0],
          });
          continue;
        }

        const mergedGapIds = Array.from(new Set([...(Array.isArray(existing.matchedGapIds) ? existing.matchedGapIds : []), ...matchedGapIds]));
        existing.matchedGapIds = mergedGapIds;
        existing.gapId = existing.gapId || mergedGapIds[0];
        if (typeof r?.score === "number" && Number.isFinite(r.score) && (!(typeof existing.score === "number") || r.score > existing.score)) {
          existing.score = r.score;
        }
        if (toNonEmptyString(r?.relevance) && !toNonEmptyString(existing.relevance)) existing.relevance = String(r.relevance);
      }
    }
  }

  const roundChunks = [];
  for (const row of retrievedByChunkId.values()) {
    const retrievedId = `rch_${roundChunks.length + 1}`;
    roundChunks.push({ retrievedId, ...row });
  }

  for (const r of roundChunks) {
    const existing = existingByChunkId.get(String(r?.chunkId || ""));
    if (!existing) continue;
    const mergedGapIds = Array.from(
      new Set([...(Array.isArray(existing.matchedGapIds) ? existing.matchedGapIds.map(String) : []), ...(Array.isArray(r.matchedGapIds) ? r.matchedGapIds.map(String) : [])])
    ).filter(Boolean);
    if (mergedGapIds.length) existing.matchedGapIds = mergedGapIds;
    if (!toNonEmptyString(existing.gapId) && toNonEmptyString(r.gapId)) existing.gapId = String(r.gapId);
    if (mergedGapIds.length) existing.gapId = existing.gapId || mergedGapIds[0];
    if (typeof r?.score === "number" && Number.isFinite(r.score) && (!(typeof existing.score === "number") || r.score > existing.score)) existing.score = r.score;
    if (toNonEmptyString(r?.relevance) && !toNonEmptyString(existing.relevance)) existing.relevance = String(r.relevance);
  }

  const deduped = deduplicateChunks(roundChunks, existingChunks);
  const seenChunkIds = new Set(normalizeChunkIdList(state?.L2?.retrievedChunkIdsSeen));
  const dedupedFresh = deduped.filter((c) => !seenChunkIds.has(String(c?.chunkId || "")));
  emit?.("deepsearch.retrieve.deduped", {
    before: roundChunks.length,
    after: dedupedFresh.length,
    dropped: Math.max(0, roundChunks.length - dedupedFresh.length),
    existing: existingChunks.length,
  });

  const now = new Date().toISOString();
  ensureAddedMeta(existingChunks, { now, startSeq: 1 });
  const startSeq = nextAddedSeq(existingChunks);
  ensureAddedMeta(dedupedFresh, { now, startSeq });

  const combined = [...existingChunks, ...dedupedFresh];
  const trimmed = applyChunkLru(combined, { maxChunks });
  const evictedCount = Math.max(0, combined.length - trimmed.length);

  state.L2.retrievedChunks = trimmed;
  trackSeenChunkIds(
    state,
    [...existingChunks, ...roundChunks].map((c) => toNonEmptyString(c?.chunkId)).filter(Boolean),
    { maxSize: Math.max(1000, maxChunks * 50) }
  );
  state.addTimeline({
    name: "deepsearch.retrieve",
    status: "completed",
    payload: { retrievedCount: dedupedFresh.length, retrievedBeforeDedupe: roundChunks.length, totalRetrieved: trimmed.length, evictedCount, maxChunks },
  });

  emit?.("deepsearch.retrieve.completed", {
    retrievedCount: dedupedFresh.length,
    retrievedBeforeDedupe: roundChunks.length,
    totalRetrieved: trimmed.length,
    evictedCount,
    maxChunks,
    gapCount: gaps.length,
    totalGaps: gapsAll.length,
  });
  return { state, retrievedChunks: roundChunks };
}

export const __test = {
  applyChunkLru,
  ensureAddedMeta,
  nextAddedSeq,
  trackSeenChunkIds,
};
