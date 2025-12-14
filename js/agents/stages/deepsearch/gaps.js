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

function safeInt(n) {
  return typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : null;
}

function clampProgress(progress) {
  if (typeof progress !== "number" || !Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(1, progress));
}

function emitGapProgress(emit, { step, current, total, msg, detail }) {
  emit?.(
    "deepsearch.gaps.progress",
    {
      phase: "gaps",
      step: String(step || "gap"),
      current,
      total: Math.max(1, total),
      progress: clampProgress(total > 0 ? current / total : 1),
      msg: String(msg || ""),
      ...(detail && typeof detail === "object" && !Array.isArray(detail) ? { detail } : {}),
    },
    { status: "progress" }
  );
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

function extractGoalTerms(taskGoal, { maxTerms = 6 } = {}) {
  const goal = String(taskGoal || "");
  const tokens = goal.match(/[\p{L}\p{N}]+/gu) || [];
  const out = [];
  const seen = new Set();
  for (const raw of tokens) {
    const t = String(raw || "").trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (key.length < 2) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= (safeInt(maxTerms) ?? 6)) break;
  }
  return out;
}

function buildDefaultGaps(taskGoal, scanSummary) {
  const goal = String(taskGoal || "");
  const topics = Array.isArray(scanSummary?.keyTopics) ? scanSummary.keyTopics : [];
  const goalTerms = extractGoalTerms(goal, { maxTerms: 6 });

  const out = [
    gap("gap_1", "definition", "核心定义和研究范围是什么？", { priority: "high", queryHints: ["定义", "范围", ...goalTerms.slice(0, 3), ...topics.slice(0, 2)] }),
    gap("gap_2", "data", "有哪些关键数据和指标需要引用？", { priority: "high", queryHints: ["数据", "统计", "指标", ...goalTerms.slice(0, 3)] }),
  ];

  if (/compare|vs|versus|对比|比较/i.test(goal)) {
    out.push(gap(`gap_${out.length + 1}`, "comparison", "主要的替代方案和权衡是什么？", { priority: "medium", queryHints: ["对比", "优缺点", ...goalTerms.slice(0, 3)] }));
  }
  if (/how|mechanism|原理|机制/i.test(goal)) {
    out.push(gap(`gap_${out.length + 1}`, "mechanism", "它是如何工作的（原理/流程）？", { priority: "medium", queryHints: ["原理", "流程", "机制", ...goalTerms.slice(0, 3)] }));
  }
  if (/example|case|案例/i.test(goal)) {
    out.push(gap(`gap_${out.length + 1}`, "example", "有哪些具体的案例或实例？", { priority: "low", queryHints: ["案例", "实例", ...goalTerms.slice(0, 3)] }));
  }

  return out;
}

async function tryLLMGaps(state, scanSummary, existingGaps, stageApi) {
  const callModel = getModelCaller(stageApi, { usage: "planner", state });
  if (!callModel) return null;

  const messages = [
    {
      role: "system",
      content:
        "You are a DeepSearch gap planner. Return ONLY JSON: {gaps:[{type,question,priority,queryHints[]}]}.\n" +
        "gap.type examples: definition,data,comparison,mechanism,example. Keep question short and concrete.",
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          taskGoal: String(state?.taskGoal || ""),
          scanSummary: isPlainObject(scanSummary) ? scanSummary : {},
          existingGaps: (Array.isArray(existingGaps) ? existingGaps : []).map((g) => ({
            type: g?.type,
            question: g?.question,
            priority: g?.priority,
            status: g?.status,
            missCount: g?.missCount,
          })),
        },
        null,
        2
      ),
    },
  ];

  try {
    const result = await callModel(messages, { model: "auto", temperature: 0.2, maxTokens: 700 });
    const candidate = extractJsonCandidate(result?.content);
    if (!candidate) return null;
    const parsed = JSON.parse(candidate);
    if (!isPlainObject(parsed) || !Array.isArray(parsed.gaps)) return null;
    return parsed.gaps;
  } catch {
    return null;
  }
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
    const t = state.addTodo({ text: `填补缺口: ${g.type} — ${g.question}`, relatedGapId: gid, status: g.status === "filled" ? "done" : "open" });
    todos.push(t);
    emit?.("deepsearch.todo.created", { todoId: t.todoId, relatedGapId: gid });
  }
  return todos;
}

function priorityRank(priority) {
  const p = String(priority || "").toLowerCase();
  if (p === "high") return 0;
  if (p === "medium") return 1;
  if (p === "low") return 2;
  return 3;
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

  // 发射阶段开始事件
  emitGapProgress(emit, {
    step: "init",
    current: 0,
    total: 1,
    msg: "正在启动缺口分析...",
    detail: { step: "init" },
  });

  const scanSummary = state?.L1?.scanSummary || {};
  const existingRaw = Array.isArray(state?.L1?.gaps) ? state.L1.gaps : [];

  const normalizedExisting = [];
  const makeId = nextGapId(existingRaw, 1);
  for (let i = 0; i < existingRaw.length; i++) {
    const g = existingRaw[i];
    const ng = normalizeGap(g, toNonEmptyString(g?.gapId) ? undefined : makeId());
    if (ng) normalizedExisting.push(ng);

    emitGapProgress(emit, {
      step: "normalize_existing",
      current: i + 1,
      total: existingRaw.length,
      msg: `正在规范化已有知识缺口 (${i + 1}/${existingRaw.length || 1})`,
      detail: ng ? { gapId: ng.gapId, type: ng.type, question: ng.question, priority: ng.priority, status: ng.status } : { skipped: true },
    });
  }

  const suggested = buildDefaultGaps(state.taskGoal, scanSummary);
  const llmSuggested = await tryLLMGaps(state, scanSummary, normalizedExisting, stageApi);
  const merged = [];
  const byKey = new Map();
  for (const g of normalizedExisting) {
    merged.push(g);
    byKey.set(gapKey(g), g);
  }

  for (let i = 0; i < suggested.length; i++) {
    const s = suggested[i];
    const key = gapKey(s);
    if (byKey.has(key)) continue;
    const ng = normalizeGap({ ...s, gapId: makeId(), status: "open", missCount: 0 }, s.gapId);
    if (!ng) continue;
    merged.push(ng);
    byKey.set(key, ng);
    state?.planningTree?.expandFromGap?.(ng);

    emitGapProgress(emit, {
      step: "identify_default",
      current: i + 1,
      total: suggested.length,
      msg: `正在识别默认知识缺口 (${i + 1}/${suggested.length})`,
      detail: { gapId: ng.gapId, type: ng.type, question: ng.question, priority: ng.priority },
    });
  }

  const llmRows = Array.isArray(llmSuggested) ? llmSuggested : [];
  for (let i = 0; i < llmRows.length; i++) {
    const s = llmRows[i];
    if (!isPlainObject(s)) continue;
    const candidate = {
      type: toNonEmptyString(s?.type) || "unknown",
      question: toNonEmptyString(s?.question) || "",
      priority: toNonEmptyString(s?.priority) || "medium",
      queryHints: Array.isArray(s?.queryHints) ? s.queryHints : [],
    };
    const key = gapKey(candidate);
    if (byKey.has(key)) continue;
    const ng = normalizeGap({ ...candidate, gapId: makeId(), status: "open", missCount: 0 }, undefined);
    if (!ng) continue;
    merged.push(ng);
    byKey.set(key, ng);
    state?.planningTree?.expandFromGap?.(ng);

    emitGapProgress(emit, {
      step: "identify_llm",
      current: i + 1,
      total: llmRows.length,
      msg: `正在识别 AI 建议的知识缺口 (${i + 1}/${llmRows.length})`,
      detail: { gapId: ng.gapId, type: ng.type, question: ng.question, priority: ng.priority },
    });
  }

  const openQuestions = Array.isArray(state?.L1?.openQuestions) ? state.L1.openQuestions : [];
  for (let i = 0; i < openQuestions.length; i++) {
    const q = openQuestions[i];
    const qt = toNonEmptyString(q?.question) || toNonEmptyString(q?.text);
    if (!qt) continue;
    const candidate = { type: "question", question: qt, priority: "low", queryHints: qt.split(/\s+/).slice(0, 6) };
    const key = gapKey(candidate);
    if (byKey.has(key)) continue;
    const ng = normalizeGap({ ...candidate, gapId: makeId(), status: "open", missCount: 0 }, candidate.gapId);
    if (!ng) continue;
    merged.push(ng);
    byKey.set(key, ng);
    state?.planningTree?.expandFromGap?.(ng);

    emitGapProgress(emit, {
      step: "identify_open_questions",
      current: i + 1,
      total: openQuestions.length,
      msg: `正在添加开放问题 (${i + 1}/${openQuestions.length})`,
      detail: { gapId: ng.gapId, question: ng.question, priority: ng.priority },
    });
  }

  // Prioritize: open gaps first, then priority, then stable by id.
  merged.sort((a, b) => {
    const aOpen = a?.status === "open";
    const bOpen = b?.status === "open";
    if (aOpen !== bOpen) return aOpen ? -1 : 1;
    const pr = priorityRank(a?.priority) - priorityRank(b?.priority);
    if (pr) return pr;
    return String(a?.gapId || "").localeCompare(String(b?.gapId || ""));
  });
  emitGapProgress(emit, { step: "prioritize_sort", current: 1, total: 1, msg: "正在排序和设定优先级", detail: { totalGaps: merged.length } });

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
  extractGoalTerms,
  normalizeGap,
  nextGapId,
  ensureTodosForGaps,
};
