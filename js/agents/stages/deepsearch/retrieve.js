import { DeepSearchState, checkCancelled, makeStageEmitter } from "./state.js";
import { chunkText } from "../textprep/chunk.js";
import { retrieve as retrieveWithRouter } from "../../retrieval/retrieval-router.js";

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
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

  const retrievalConfig = isPlainObject(state?.userConfig?.retrieval) ? state.userConfig.retrieval : {};
  const chunkSize = Number.isFinite(retrievalConfig.chunkSize) ? Math.max(200, Math.floor(retrievalConfig.chunkSize)) : 1600;
  const overlap = Number.isFinite(retrievalConfig.overlap) ? Math.max(0, Math.floor(retrievalConfig.overlap)) : 180;
  const topK = Number.isFinite(retrievalConfig.topK) ? Math.max(1, Math.floor(retrievalConfig.topK)) : 6;
  const windowSize = Number.isFinite(retrievalConfig.windowSize) ? Math.max(0, Math.floor(retrievalConfig.windowSize)) : 1;

  const routerConfig = {
    topK,
    windowSize,
    useBm25: retrievalConfig.useBm25 !== false,
    useGrep: retrievalConfig.useGrep !== false,
    grepRegex: Boolean(retrievalConfig.grepRegex),
    caseSensitive: Boolean(retrievalConfig.caseSensitive),
    bm25: isPlainObject(retrievalConfig.bm25) ? retrievalConfig.bm25 : {},
  };

  const retrievedChunks = [];

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

    const retrieved = retrieveWithRouter(sourceIndex, gaps, routerConfig);
    for (const r of retrieved) {
      const retrievedId = `rch_${retrievedChunks.length + 1}`;
      const matchedGapIds = Array.isArray(r?.matchedGapIds) ? r.matchedGapIds.map(String).filter(Boolean) : [];
      retrievedChunks.push({
        retrievedId,
        chunkId: String(r?.chunkId || retrievedId),
        sourceId: String(r?.sourceId || sourceId),
        locator: r?.locator,
        text: String(r?.text || ""),
        ...(typeof r?.score === "number" && Number.isFinite(r.score) ? { score: r.score } : {}),
        ...(toNonEmptyString(r?.relevance) ? { relevance: String(r.relevance) } : {}),
        ...(matchedGapIds.length ? { matchedGapIds, gapId: matchedGapIds[0] } : {}),
      });
    }
  }

  state.L2.retrievedChunks = retrievedChunks;
  state.addTimeline({ name: "deepsearch.retrieve", status: "completed", payload: { retrievedCount: retrievedChunks.length } });

  emit?.("deepsearch.retrieve.completed", { retrievedCount: retrievedChunks.length, gapCount: gaps.length, totalGaps: gapsAll.length });
  return { state, retrievedChunks };
}
