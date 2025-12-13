import { DeepSearchState, checkCancelled, makeStageEmitter } from "./state.js";

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function toNonEmptyString(v) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

function safeInt(n) {
  return typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : null;
}

function ensureState(_runContext, input) {
  if (input instanceof DeepSearchState) return input;
  if (input?.state instanceof DeepSearchState) return input.state;
  if (isPlainObject(input?.state)) return DeepSearchState.fromJSON(input.state);
  throw new TypeError("DeepSearch gaps: input.state is required");
}

function gap(gapId, type, question, { priority = "medium", queryHints = [], status = "open", missCount = 0, blockedReason } = {}) {
  return {
    gapId,
    type,
    question,
    priority,
    status,
    queryHints: Array.isArray(queryHints) ? queryHints : [],
    ...(safeInt(missCount) !== null ? { missCount: Math.max(0, safeInt(missCount)) } : {}),
    ...(toNonEmptyString(blockedReason) ? { blockedReason: String(blockedReason) } : {}),
  };
}

function buildDefaultGaps(taskGoal, scanSummary) {
  const goal = String(taskGoal || "");
  const topics = Array.isArray(scanSummary?.keyTopics) ? scanSummary.keyTopics : [];

  const out = [
    gap("gap_1", "definition", "What are the core definitions and scope?", { priority: "high", queryHints: ["definition", "scope", ...topics.slice(0, 2)] }),
    gap("gap_2", "data", "What are the key metrics and numbers we must cite?", { priority: "high", queryHints: ["statistics", "numbers", "evidence"] }),
  ];

  if (/compare|vs|versus|对比|比较/i.test(goal)) {
    out.push(gap(`gap_${out.length + 1}`, "comparison", "What are the main alternatives and trade-offs?", { priority: "medium", queryHints: ["compare", "pros cons"] }));
  }
  if (/how|mechanism|原理|机制/i.test(goal)) {
    out.push(gap(`gap_${out.length + 1}`, "mechanism", "How does it work (mechanism/process)?", { priority: "medium", queryHints: ["mechanism", "process", "workflow"] }));
  }
  if (/example|case|案例/i.test(goal)) {
    out.push(gap(`gap_${out.length + 1}`, "example", "What are concrete examples or case studies?", { priority: "low", queryHints: ["case study", "example"] }));
  }

  return out;
}

function gapKey(g) {
  const type = toNonEmptyString(g?.type) || "unknown";
  const question = toNonEmptyString(g?.question) || "";
  return `${type}::${question}`;
}

function normalizeGap(existing, fallbackGapId) {
  if (!isPlainObject(existing)) return null;
  const gapId = toNonEmptyString(existing.gapId) || toNonEmptyString(fallbackGapId);
  const type = toNonEmptyString(existing.type) || "unknown";
  const question = toNonEmptyString(existing.question) || "";
  if (!gapId || !question) return null;
  const status = ["open", "filled", "blocked"].includes(String(existing.status)) ? String(existing.status) : "open";
  const priority = toNonEmptyString(existing.priority) || "medium";
  const queryHints = Array.isArray(existing.queryHints) ? existing.queryHints : [];
  const missCount = safeInt(existing.missCount) ?? 0;
  const blockedReason = toNonEmptyString(existing.blockedReason);
  return gap(gapId, type, question, { priority, queryHints, status, missCount, blockedReason });
}

function nextGapId(existingGaps, startAt = 1) {
  let max = startAt - 1;
  for (const g of Array.isArray(existingGaps) ? existingGaps : []) {
    const m = String(g?.gapId || "").match(/^gap_(\d+)$/);
    if (!m) continue;
    const n = safeInt(Number(m[1]));
    if (n !== null && n > max) max = n;
  }
  return () => `gap_${(max += 1)}`;
}

function ensureTodosForGaps(state, gaps, emit) {
  const todos = [];
  const existingTodoByGapId = new Map();
  for (const t of Array.isArray(state?.todos) ? state.todos : []) {
    const gid = toNonEmptyString(t?.relatedGapId);
    if (!gid) continue;
    existingTodoByGapId.set(String(gid), t);
  }

  for (const g of Array.isArray(gaps) ? gaps : []) {
    const gid = toNonEmptyString(g?.gapId);
    if (!gid) continue;
    if (existingTodoByGapId.has(gid)) continue;
    const t = state.addTodo({ text: `Fill gap: ${g.type} — ${g.question}`, relatedGapId: gid, status: g.status === "filled" ? "done" : "open" });
    todos.push(t);
    emit?.("deepsearch.todo.created", { todoId: t.todoId, relatedGapId: gid });
  }
  return todos;
}

/**
 * S3 Gap Builder: generate gaps[] from scanSummary + taskGoal, and emit todos.
 * @param {object} runContext
 * @param {DeepSearchState|{state:DeepSearchState|object}} input
 * @param {{emit?:Function,eventBus?:object,signal?:AbortSignal,checkCancelled?:Function}=} stageApi
 */
export async function runDeepSearchGapsStage(runContext, input, stageApi = {}) {
  const emit = makeStageEmitter(stageApi, "deepsearch");
  const state = ensureState(runContext, input);

  checkCancelled(stageApi);
  const scanSummary = state?.L1?.scanSummary || {};
  const existingRaw = Array.isArray(state?.L1?.gaps) ? state.L1.gaps : [];

  const normalizedExisting = [];
  const makeId = nextGapId(existingRaw, 1);
  for (const g of existingRaw) {
    const ng = normalizeGap(g, toNonEmptyString(g?.gapId) ? undefined : makeId());
    if (ng) normalizedExisting.push(ng);
  }

  const suggested = buildDefaultGaps(state.taskGoal, scanSummary);
  const merged = [];
  const byKey = new Map();
  for (const g of normalizedExisting) {
    merged.push(g);
    byKey.set(gapKey(g), g);
  }

  for (const s of suggested) {
    const key = gapKey(s);
    if (byKey.has(key)) continue;
    const ng = normalizeGap({ ...s, gapId: makeId(), status: "open", missCount: 0 }, s.gapId);
    if (!ng) continue;
    merged.push(ng);
    byKey.set(key, ng);
  }

  const openQuestions = Array.isArray(state?.L1?.openQuestions) ? state.L1.openQuestions : [];
  for (const q of openQuestions) {
    const qt = toNonEmptyString(q?.question) || toNonEmptyString(q?.text);
    if (!qt) continue;
    const candidate = { type: "question", question: qt, priority: "low", queryHints: qt.split(/\s+/).slice(0, 6) };
    const key = gapKey(candidate);
    if (byKey.has(key)) continue;
    const ng = normalizeGap({ ...candidate, gapId: makeId(), status: "open", missCount: 0 }, candidate.gapId);
    if (!ng) continue;
    merged.push(ng);
    byKey.set(key, ng);
  }

  state.L1.gaps = merged;

  const openGapCount = merged.filter((g) => g.status === "open").length;
  state.addTimeline({ name: "deepsearch.gaps", status: "completed", payload: { gapCount: openGapCount, totalGaps: merged.length } });

  const todos = ensureTodosForGaps(state, merged, emit);
  emit?.("deepsearch.gaps.completed", { gapCount: openGapCount, totalGaps: merged.length, todoCount: todos.length });
  return { state, gaps: merged, todos };
}

export const __test = {
  gap,
  gapKey,
  normalizeGap,
  nextGapId,
  ensureTodosForGaps,
};
