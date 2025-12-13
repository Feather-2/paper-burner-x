import { DeepSearchState, checkCancelled, extractJsonCandidate, makeStageEmitter } from "./state.js";
import { getModelCaller } from "./model.js";

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

function normalizeSlideIntent(v, i) {
  if (!isPlainObject(v)) return null;
  const pageType = toNonEmptyString(v?.pageType) || "overview";
  const slideIntentId = toNonEmptyString(v?.slideIntentId) || `s_${i + 1}`;
  const title = toNonEmptyString(v?.title) || "";
  const objective = toNonEmptyString(v?.objective) || undefined;
  const keyPoints = Array.isArray(v?.keyPoints) ? v.keyPoints.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 8) : undefined;
  const claimIds = Array.isArray(v?.claimIds) ? v.claimIds.map((x) => String(x || "").trim()).filter(Boolean) : [];
  return { slideIntentId, pageType, title, ...(objective ? { objective } : {}), ...(keyPoints ? { keyPoints } : {}), claimIds };
}

function ensureCoreSlidesMerged(slideIntents, { title, claimIds }) {
  const out = (Array.isArray(slideIntents) ? slideIntents : []).map(normalizeSlideIntent).filter(Boolean);
  const core = ensureCoreSlides({ title, claimIds });

  const has = new Set(out.map((s) => s.pageType).filter(Boolean));
  if (!has.has("cover")) out.unshift(core.find((s) => s.pageType === "cover"));
  if (!has.has("agenda")) out.splice(1, 0, core.find((s) => s.pageType === "agenda"));
  if (!has.has("overview")) out.splice(2, 0, core.find((s) => s.pageType === "overview"));
  if (!has.has("summary")) out.push(core.find((s) => s.pageType === "summary"));

  const seen = new Set();
  for (let i = 0; i < out.length; i++) {
    const s = out[i];
    let id = toNonEmptyString(s?.slideIntentId);
    if (!id || seen.has(id)) id = `s_${i + 1}`;
    seen.add(id);
    out[i] = { ...s, slideIntentId: id };
  }
  return out.filter(Boolean);
}

async function tryLLMSlidePlan(state, { title, claimIds, claims }, stageApi) {
  const callModel = getModelCaller(stageApi, { usage: "writer" });
  if (!callModel) return null;

  const messages = [
    {
      role: "system",
      content:
        "You are a PPT slide planner. Return ONLY JSON: {slideIntents:[{slideIntentId,pageType,title,objective,keyPoints,claimIds}],outlineCandidates:[{outlineId,title,bullets}]}. " +
        "pageType examples: cover, agenda, overview, comparison, process, summary, appendix. Do not invent facts.",
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          taskGoal: String(state?.taskGoal || ""),
          title: String(title || ""),
          claimIds: Array.isArray(claimIds) ? claimIds : [],
          claims: (Array.isArray(claims) ? claims : []).slice(0, 24).map((c) => ({ claimId: c?.claimId, text: c?.text, importance: c?.importance, gapIds: c?.gapIds })),
        },
        null,
        2
      ),
    },
  ];

  try {
    const result = await callModel(messages, { model: "auto", temperature: 0.2, maxTokens: 1000 });
    const candidate = extractJsonCandidate(result?.content);
    if (!candidate) return null;
    const parsed = JSON.parse(candidate);
    if (!isPlainObject(parsed) || !Array.isArray(parsed.slideIntents)) return null;
    return {
      slideIntents: parsed.slideIntents,
      outlineCandidates: Array.isArray(parsed.outlineCandidates) ? parsed.outlineCandidates : null,
    };
  } catch {
    return null;
  }
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

  const llm = await tryLLMSlidePlan(state, { title, claimIds, claims }, stageApi);
  const slideIntents = llm?.slideIntents ? ensureCoreSlidesMerged(llm.slideIntents, { title, claimIds }) : ensureCoreSlides({ title, claimIds });
  const outlineCandidates =
    llm?.outlineCandidates && Array.isArray(llm.outlineCandidates) && llm.outlineCandidates.length
      ? llm.outlineCandidates
      : [
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
