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

function ensureState(runContext, input) {
  if (input instanceof DeepSearchState) return input;
  if (input?.state instanceof DeepSearchState) return input.state;
  if (isPlainObject(input?.state)) return DeepSearchState.fromJSON(input.state);

  const sources = Array.isArray(input?.sources) ? input.sources : [];
  return new DeepSearchState({
    runId: toNonEmptyString(runContext?.runId),
    taskGoal: toNonEmptyString(input?.taskGoal) || "",
    userConfig: isPlainObject(input?.userConfig) ? input.userConfig : {},
    L0: { sources },
  });
}

function clampProgress(progress) {
  if (typeof progress !== "number" || !Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(1, progress));
}

function toSourceCardsWithProgress(sources, emit) {
  const rows = Array.isArray(sources) ? sources : [];
  const total = rows.length;
  const cards = [];

  for (let i = 0; i < rows.length; i++) {
    const s = rows[i];
    const card = {
      sourceId: toNonEmptyString(s?.sourceId) || "source_unknown",
      kind: toNonEmptyString(s?.kind) || "unknown",
      title: toNonEmptyString(s?.title),
      uri: toNonEmptyString(s?.uri),
      chars: typeof s?.sourceTextNormalized === "string" ? s.sourceTextNormalized.length : undefined,
    };
    cards.push(card);

    emit?.(
      "deepsearch.scan.progress",
      {
        phase: "scan",
        step: "source",
        current: i + 1,
        total: Math.max(1, total),
        progress: clampProgress(total > 0 ? (i + 1) / total : 1),
        msg: `正在扫描来源 ${card.sourceId}${card.title ? `：${card.title}` : ""}`,
        detail: card,
      },
      { status: "progress" }
    );
  }

  return cards;
}

function fallbackScanSummary(state, sourceCards) {
  const cards = Array.isArray(sourceCards) ? sourceCards : [];
  const best = cards
    .slice()
    .sort((a, b) => (b.chars || 0) - (a.chars || 0))
    .slice(0, 5);

  return {
    schemaVersion: "0.1",
    taskGoal: state.taskGoal || "",
    sourceCount: cards.length,
    sources: cards,
    topSources: best,
    summaryText: `Sources=${cards.length}; taskGoal=${String(state.taskGoal || "").slice(0, 120)}`,
  };
}

function fallbackDeepDivePlan(state) {
  const sources = Array.isArray(state?.L0?.sources) ? state.L0.sources : [];
  const take = sources.slice(0, 3).map((s) => toNonEmptyString(s?.sourceId)).filter(Boolean);
  return {
    schemaVersion: "0.1",
    steps: take.map((sourceId, i) => ({ stepId: `step_${i + 1}`, action: "review_source", sourceId })),
    notes: "placeholder plan (no LLM)",
  };
}

async function tryLLMScan(state, sourceCards, stageApi) {
  const callModel = getModelCaller(stageApi, { usage: "analyst", state });
  if (!callModel) return null;

  const sources = Array.isArray(sourceCards) ? sourceCards : [];
  const messages = [
    {
      role: "system",
      content:
        "You are a DeepSearch scanner. Return ONLY JSON: {scanSummary:{summaryText,topSources:[{sourceId,reason}]},deepDivePlan:{steps:[{action,sourceId,notes}]}}.",
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          taskGoal: state.taskGoal || "",
          sources: sources.map((s) => ({ sourceId: s?.sourceId, title: s?.title, kind: s?.kind, uri: s?.uri, chars: s?.chars })),
        },
        null,
        2
      ),
    },
  ];

  try {
    const result = await callModel(messages, { model: "auto", temperature: 0.2, maxTokens: 900 });
    const candidate = extractJsonCandidate(result?.content);
    if (!candidate) return null;
    const parsed = JSON.parse(candidate);
    if (!isPlainObject(parsed) || !isPlainObject(parsed.scanSummary) || !isPlainObject(parsed.deepDivePlan)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * S2 Fast Look Around: produce scanSummary + deepDivePlan (placeholder LLM hook).
 * @param {object} runContext
 * @param {DeepSearchState|{state?:DeepSearchState|object,sources?:Array<object>,taskGoal?:string}} input
 * @param {{emit?:Function,eventBus?:object,signal?:AbortSignal,checkCancelled?:Function,aiApiService?:object}=} stageApi
 */
export async function runDeepSearchScanStage(runContext, input, stageApi = {}) {
  const emit = makeStageEmitter(stageApi, "deepsearch");
  const state = ensureState(runContext, input);

  checkCancelled(stageApi);
  const sources = Array.isArray(state?.L0?.sources) ? state.L0.sources : [];
  const sourceCards = toSourceCardsWithProgress(sources, emit);
  const llm = await tryLLMScan(state, sourceCards, stageApi);

  const scanSummary =
    llm?.scanSummary && isPlainObject(llm.scanSummary) ? { ...fallbackScanSummary(state, sourceCards), ...llm.scanSummary } : fallbackScanSummary(state, sourceCards);
  const deepDivePlan = llm?.deepDivePlan && isPlainObject(llm.deepDivePlan) ? { ...fallbackDeepDivePlan(state), ...llm.deepDivePlan } : fallbackDeepDivePlan(state);

  state.L1.scanSummary = scanSummary;
  state.L1.deepDivePlan = deepDivePlan;
  state.addTimeline({ name: "deepsearch.scan", status: "completed", payload: { sourceCount: scanSummary.sourceCount } });

  emit?.("deepsearch.scan.completed", { sourceCount: scanSummary.sourceCount, plannedSteps: Array.isArray(deepDivePlan.steps) ? deepDivePlan.steps.length : 0 });
  return { state, scanSummary, deepDivePlan };
}
