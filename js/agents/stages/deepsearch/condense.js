import { DeepSearchState, checkCancelled, makeStageEmitter } from "./state.js";
import { condenseDeepSearchState } from "../../deepsearch/condense/condense.js";
import { writeDeepSearchArtifacts } from "../../deepsearch/condense/cache-writer.js";
import { isPlainObject } from "../../shared/value-utils.js";

function ensureState(_runContext, input) {
  if (input instanceof DeepSearchState) return input;
  if (input?.state instanceof DeepSearchState) return input.state;
  if (isPlainObject(input?.state)) return DeepSearchState.fromJSON(input.state);
  throw new TypeError("DeepSearch condense: input.state is required");
}

/**
 * S7 Condense wrapper: clear L2 + build condensedMemory + persist artifacts.
 * @param {object} runContext
 * @param {DeepSearchState|{state:DeepSearchState|object}} input
 * @param {{emit?:Function,eventBus?:object,signal?:AbortSignal,checkCancelled?:Function,runStore?:object}=} stageApi
 */
export async function runDeepSearchCondenseStage(runContext, input, stageApi = {}) {
  const emit = makeStageEmitter(stageApi, "deepsearch");
  const state = ensureState(runContext, input);

  checkCancelled(stageApi);
  const now = new Date().toISOString();
  const retrieved = Array.isArray(state?.L2?.retrievedChunks) ? state.L2.retrievedChunks : [];
  for (const c of retrieved) {
    if (!c || typeof c !== "object") continue;
    if (!c.consumed) c.consumed = true;
    if (!c.consumedAt) c.consumedAt = now;
  }

  const { condensedMemory, l1Preserved, l2Cleared } = condenseDeepSearchState(state);

  state.addTimeline({
    name: "deepsearch.condense",
    status: "completed",
    payload: { summary: condensedMemory?.summary || "", l2Cleared },
  });

  if (stageApi?.runStore && runContext?.runId) {
    try {
      await writeDeepSearchArtifacts({
        runStore: stageApi.runStore,
        runId: String(runContext.runId),
        state,
        condensedMemory,
        pretty: true,
        updateManifest: true,
      });
    } catch (err) {
      state.addTimeline({ name: "deepsearch.cache.failed", status: "warning", payload: { message: err?.message } });
    }
  }

  emit?.("deepsearch.condense.completed", { summary: condensedMemory?.summary || "", keptChunks: l2Cleared?.retrievedChunks?.after || 0 });
  emit?.("deepsearch.condense.ended", { summary: condensedMemory?.summary || "", l2Cleared });
  return { state, condensedMemory, l1Preserved, l2Cleared };
}
