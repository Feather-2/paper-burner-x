import { DeepSearchState, checkCancelled, makeStageEmitter } from "./state.js";

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function ensureState(_runContext, input) {
  if (input instanceof DeepSearchState) return input;
  if (input?.state instanceof DeepSearchState) return input.state;
  if (isPlainObject(input?.state)) return DeepSearchState.fromJSON(input.state);
  throw new TypeError("DeepSearch retrieve: input.state is required");
}

function findFirstMatch(text, hints) {
  const t = String(text || "");
  if (!t) return null;
  const hs = (Array.isArray(hints) ? hints : []).map((h) => String(h || "").trim()).filter(Boolean);
  if (hs.length === 0) return null;

  const lower = t.toLowerCase();
  for (const h of hs) {
    const idx = lower.indexOf(h.toLowerCase());
    if (idx >= 0) return { idx, hint: h };
  }
  return null;
}

function windowAround(text, idx, { before = 120, after = 200 } = {}) {
  const t = String(text || "");
  const start = Math.max(0, idx - before);
  const end = Math.min(t.length, idx + after);
  return { start, end, slice: t.slice(start, end) };
}

/**
 * S4 Retrieval Router wrapper (placeholder): searches within provided sources by gap queryHints.
 * @param {object} runContext
 * @param {DeepSearchState|{state:DeepSearchState|object}} input
 * @param {{emit?:Function,eventBus?:object,signal?:AbortSignal,checkCancelled?:Function}=} stageApi
 */
export async function runDeepSearchRetrieveStage(runContext, input, stageApi = {}) {
  const emit = makeStageEmitter(stageApi, "deepsearch");
  const state = ensureState(runContext, input);

  checkCancelled(stageApi);
  const sources = Array.isArray(state?.L0?.sources) ? state.L0.sources : [];
  const gaps = Array.isArray(state?.L1?.gaps) ? state.L1.gaps : [];

  const retrievedChunks = [];
  for (const g of gaps) {
    const hints = Array.isArray(g?.queryHints) ? g.queryHints : [g?.question].filter(Boolean);
    for (const s of sources) {
      const text = s?.sourceTextNormalized;
      const m = findFirstMatch(text, hints);
      if (!m) continue;

      const w = windowAround(text, m.idx, { before: 80, after: 220 });
      const retrievedId = `rch_${retrievedChunks.length + 1}`;
      retrievedChunks.push({
        chunkId: retrievedId, // RetrievedChunk contract for S5 (no stable source chunking in placeholder path)
        retrievedId,
        gapId: String(g?.gapId || ""),
        sourceId: String(s?.sourceId || "source_unknown"),
        locator: { charStart: w.start, charEnd: w.end },
        text: w.slice,
        score: 1,
        hit: { hint: m.hint, idx: m.idx },
      });
      break;
    }
  }

  state.L2.retrievedChunks = retrievedChunks;
  state.addTimeline({ name: "deepsearch.retrieve", status: "completed", payload: { retrievedCount: retrievedChunks.length } });

  emit?.("deepsearch.retrieve.completed", { retrievedCount: retrievedChunks.length, gapCount: gaps.length });
  return { state, retrievedChunks };
}
