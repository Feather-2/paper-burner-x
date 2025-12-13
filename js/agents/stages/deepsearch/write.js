import { DeepSearchState, checkCancelled, makeStageEmitter } from "./state.js";

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function toNonEmptyString(v) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

function ensureState(_runContext, input) {
  if (input instanceof DeepSearchState) return input;
  if (input?.state instanceof DeepSearchState) return input.state;
  if (isPlainObject(input?.state)) return DeepSearchState.fromJSON(input.state);
  throw new TypeError("DeepSearch write: input.state is required");
}

function ensureCoreSlides({ title, claimIds }) {
  const ids = Array.isArray(claimIds) ? claimIds : [];
  return [
    { slideIntentId: "s_cover", pageType: "cover", title: title || "Presentation", objective: "Set the context", claimIds: [] },
    { slideIntentId: "s_agenda", pageType: "agenda", title: "Agenda", objective: "Outline the flow", keyPoints: ["Background", "Findings", "Implications"], claimIds: [] },
    { slideIntentId: "s_overview", pageType: "overview", title: "Key Findings", objective: "Summarize the core findings", claimIds: ids.slice(0, 5) },
    { slideIntentId: "s_summary", pageType: "summary", title: "Summary", objective: "Wrap up with takeaways", claimIds: ids.slice(Math.max(0, ids.length - 5)) },
  ];
}

/**
 * S6 PPT Writing: produce slideIntents[] from claims (placeholder).
 * @param {object} runContext
 * @param {DeepSearchState|{state:DeepSearchState|object}} input
 * @param {{emit?:Function,eventBus?:object,signal?:AbortSignal,checkCancelled?:Function}=} stageApi
 */
export async function runDeepSearchWriteStage(runContext, input, stageApi = {}) {
  const emit = makeStageEmitter(stageApi, "deepsearch");
  const state = ensureState(runContext, input);

  checkCancelled(stageApi);
  const claims = Array.isArray(state?.L1?.claims) ? state.L1.claims : [];
  const claimIds = claims.map((c) => toNonEmptyString(c?.claimId)).filter(Boolean);
  const title = toNonEmptyString(state?.userConfig?.title) || toNonEmptyString(state?.L1?.scanSummary?.title) || "";

  const slideIntents = ensureCoreSlides({ title, claimIds });
  const outlineCandidates = [
    {
      outlineId: "o_1",
      title: "Default Outline",
      bullets: ["Background", "Evidence-backed findings", "Implications & recommendations"],
    },
  ];

  state.L1.slideIntents = slideIntents;
  state.L1.outlineCandidates = outlineCandidates;
  state.addTimeline({ name: "deepsearch.write", status: "completed", payload: { slideCount: slideIntents.length } });

  emit?.("deepsearch.write.completed", { slideCount: slideIntents.length, claimCount: claimIds.length });
  return { state, slideIntents, outlineCandidates };
}

