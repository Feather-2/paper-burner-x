import { DeepSearchState, checkCancelled, extractJsonCandidate, makeStageEmitter } from "./state.js";
import { getModelCaller } from "./model.js";
import { logEvent, setLogContext } from "./logger.js";
import { search as toolChainSearch } from "../../retrieval/tool-chain.js";
import { isPlainObject, toNonEmptyString, safeInt } from "../../shared/value-utils.js";

function collapseWhitespace(s) {
  return String(s || "")
    .replaceAll(/\s+/g, " ")
    .trim();
}

function truncate(s, maxLen = 220) {
  const t = collapseWhitespace(s);
  if (t.length <= maxLen) return t;
  return t.slice(0, maxLen);
}

function normalizeGapsCacheKeyInputs(taskGoal, scanSummary, existingGaps) {
  const scanSummarySummaryText = truncate(scanSummary?.summaryText || "");
  const normalizedGaps = (Array.isArray(existingGaps) ? existingGaps : [])
    .map((g) => ({
      type: truncate(g?.type || "unknown", 60),
      question: truncate(g?.question || "", 240),
      status: truncate(g?.status || "open", 24),
      missCount: typeof g?.missCount === "number" && Number.isFinite(g.missCount) ? Math.max(0, Math.floor(g.missCount)) : 0,
    }))
    .sort((a, b) => `${a.type}::${a.question}`.localeCompare(`${b.type}::${b.question}`));

  return {
    taskGoal: truncate(taskGoal || ""),
    scanSummarySummaryText,
    existingGaps: normalizedGaps,
  };
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

function emitGapUpserted(emit, state, g) {
  const runId = toNonEmptyString(state?.runId) || "run_unknown";
  const iteration = safeInt(state?.iteration) ?? 0;
  const trajectoryId = toNonEmptyString(state?.trajectoryId);
  const gapId = toNonEmptyString(g?.gapId);
  if (!gapId) return;
  emit?.("deepsearch.gap.upserted", {
    runId,
    gapId,
    status: "open",
    type: toNonEmptyString(g?.type) || "unknown",
    priority: toNonEmptyString(g?.priority) || "medium",
    question: toNonEmptyString(g?.question) || "",
    missCount: 0,
    iteration,
    trajectoryId,
  });
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

  // 确保 LLM 失败时至少生成 8 个 fallback gaps（覆盖多种知识类型）
  const out = [
    // 核心 gaps (high priority)
    gap("gap_1", "definition", "核心定义和研究范围是什么？", { priority: "high", queryHints: ["定义", "范围", "概念", ...goalTerms.slice(0, 3), ...topics.slice(0, 2)] }),
    gap("gap_2", "data", "有哪些关键数据和指标需要引用？", { priority: "high", queryHints: ["数据", "统计", "指标", "数字", ...goalTerms.slice(0, 3)] }),
    gap("gap_3", "background", "背景和历史发展是什么？", { priority: "high", queryHints: ["背景", "历史", "发展", "起源", ...goalTerms.slice(0, 3)] }),

    // 支撑 gaps (medium priority)
    gap("gap_4", "mechanism", "核心原理和工作机制是什么？", { priority: "medium", queryHints: ["原理", "机制", "流程", "方法", ...goalTerms.slice(0, 3)] }),
    gap("gap_5", "application", "主要应用场景和实际案例是什么？", { priority: "medium", queryHints: ["应用", "案例", "实例", "场景", ...goalTerms.slice(0, 3)] }),
    gap("gap_6", "comparison", "主要替代方案和对比分析是什么？", { priority: "medium", queryHints: ["对比", "替代", "优缺点", "比较", ...goalTerms.slice(0, 3)] }),
    gap("gap_7", "challenge", "面临的主要挑战和问题是什么？", { priority: "medium", queryHints: ["挑战", "问题", "局限", "风险", ...goalTerms.slice(0, 3)] }),
    gap("gap_8", "trend", "未来发展趋势和方向是什么？", { priority: "medium", queryHints: ["趋势", "未来", "发展", "展望", ...goalTerms.slice(0, 3)] }),
  ];

  // 根据目标内容动态添加更多 gaps (8-12 个)
  if (/solution|解决|方案|策略/i.test(goal)) {
    out.push(gap(`gap_${out.length + 1}`, "solution", "有哪些解决方案和最佳实践？", { priority: "high", queryHints: ["方案", "解决", "最佳实践", ...goalTerms.slice(0, 3)] }));
  }
  if (/benefit|advantage|优势|好处/i.test(goal)) {
    out.push(gap(`gap_${out.length + 1}`, "benefit", "主要优势和收益是什么？", { priority: "medium", queryHints: ["优势", "好处", "收益", ...goalTerms.slice(0, 3)] }));
  }
  if (/implement|实现|部署/i.test(goal)) {
    out.push(gap(`gap_${out.length + 1}`, "implementation", "如何实现和部署？", { priority: "medium", queryHints: ["实现", "部署", "步骤", ...goalTerms.slice(0, 3)] }));
  }
  if (/cost|价格|成本|费用/i.test(goal)) {
    out.push(gap(`gap_${out.length + 1}`, "cost", "成本和资源要求是什么？", { priority: "medium", queryHints: ["成本", "价格", "资源", ...goalTerms.slice(0, 3)] }));
  }

  return out;
}

async function tryLLMGaps(state, scanSummary, existingGaps, stageApi) {
  const callModel = getModelCaller(stageApi, { usage: "planner", state });
  if (!callModel) return null;

  const cacheKeyInputs = normalizeGapsCacheKeyInputs(state?.taskGoal, scanSummary, existingGaps);

  // 工具链支持：允许 LLM 在生成 gaps 时探索代码库
  const enableToolChain = state?.userConfig?.retrieval?.enableToolChain !== false;
  const toolCallLimit = 10; // 限制工具调用次数
  let toolCallCount = 0;

  // 提供给 LLM 的工具：探索性搜索
  const toolExplanation = enableToolChain
    ? "\n\nYou can optionally use a search tool to explore the codebase before generating gaps. " +
      "If you need to search, add a 'toolCalls' array in your response with format:\n" +
      '{toolCalls:[{tool:"search",keywords:["keyword1","keyword2"]}]}\n' +
      "The search results will help you generate more accurate gaps."
    : "";

  const messages = [
    {
      role: "system",
      content:
        "You are a DeepSearch gap planner. Analyze the task goal and identify knowledge gaps that need to be filled.\n\n" +
        "IMPORTANT: Generate 5-10 diverse gaps covering different aspects:\n" +
        "- definition: core concepts and scope\n" +
        "- background: context, history, motivation\n" +
        "- data: key statistics, metrics, evidence\n" +
        "- mechanism: how it works, principles, processes\n" +
        "- application: use cases, examples, implementations\n" +
        "- comparison: alternatives, trade-offs, pros/cons\n" +
        "- challenge: problems, limitations, risks\n" +
        "- solution: methods, approaches, best practices\n" +
        "- trend: future directions, developments\n\n" +
        "Return ONLY JSON: {gaps:[{type,question,priority,queryHints[]}]}.\n" +
        "priority: 'high' for core gaps, 'medium' for supporting, 'low' for optional.\n" +
        "queryHints: 3-5 search keywords for each gap." +
        toolExplanation,
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
    const result = await callModel(messages, { model: "auto", temperature: 0.3, maxTokens: 1200, cacheKeyInputs });
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

  // 设置日志上下文
  setLogContext({ runId: state.runId, iteration: state.iteration || 0 });

  checkCancelled(stageApi);

  // 记录 gaps 阶段开始
  logEvent({
    stage: 'gaps',
    message: 'Gaps stage started',
    data: { existingGaps: Array.isArray(state?.L1?.gaps) ? state.L1.gaps.length : 0 },
  });

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

  const llmSuggested = await tryLLMGaps(state, scanSummary, normalizedExisting, stageApi);

  // 记录 LLM 调用结果
  logEvent({
    stage: 'gaps',
    message: 'LLM gaps generation',
    data: {
      usedLLM: !!llmSuggested,
      llmSuggestedCount: Array.isArray(llmSuggested) ? llmSuggested.length : 0,
    },
  });

  const suggested = buildDefaultGaps(state.taskGoal, scanSummary);
  const merged = [];
  const byKey = new Map();
  for (const g of normalizedExisting) {
    merged.push(g);
    byKey.set(gapKey(g), g);
  }

  const llmTypeSet = new Set(
    (Array.isArray(llmSuggested) ? llmSuggested : [])
      .map((s) => toNonEmptyString(s?.type))
      .filter(Boolean)
      .map((t) => String(t).toLowerCase())
  );

  for (let i = 0; i < suggested.length; i++) {
    const s = suggested[i];
    // If LLM suggested a gap for this type, prefer the LLM version and skip the default one.
    const sType = toNonEmptyString(s?.type);
    if (sType && llmTypeSet.has(String(sType).toLowerCase())) continue;
    const key = gapKey(s);
    if (byKey.has(key)) continue;
    const ng = normalizeGap({ ...s, gapId: makeId(), status: "open", missCount: 0 }, s.gapId);
    if (!ng) continue;
    merged.push(ng);
    byKey.set(key, ng);
    state?.planningTree?.expandFromGap?.(ng);
    emitGapUpserted(emit, state, ng);

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
    emitGapUpserted(emit, state, ng);

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
    emitGapUpserted(emit, state, ng);

    emitGapProgress(emit, {
      step: "identify_open_questions",
      current: i + 1,
      total: openQuestions.length,
      msg: `正在添加开放问题 (${i + 1}/${openQuestions.length})`,
      detail: { gapId: ng.gapId, question: ng.question, priority: ng.priority },
    });
  }

  // Prioritize: open gaps first, then use PlanningTree intelligent sorting
  merged.sort((a, b) => {
    const aOpen = a?.status === "open";
    const bOpen = b?.status === "open";
    if (aOpen !== bOpen) return aOpen ? -1 : 1;
    // For non-open gaps, keep simple priority-based sorting
    if (!aOpen && !bOpen) {
      const pr = priorityRank(a?.priority) - priorityRank(b?.priority);
      if (pr) return pr;
      return String(a?.gapId || "").localeCompare(String(b?.gapId || ""));
    }
    return 0; // Open gaps will be sorted by PlanningTree below
  });

  // Use PlanningTree to intelligently sort open gaps
  const openGapsList = merged.filter(g => g?.status === "open");
  const closedGapsList = merged.filter(g => g?.status !== "open");

  if (state?.planningTree && openGapsList.length > 0) {
    const sortedOpenGaps = state.planningTree.sortGapsByPriority(openGapsList);
    merged.length = 0; // Clear array
    merged.push(...sortedOpenGaps, ...closedGapsList);
  }

  emitGapProgress(emit, { step: "prioritize_sort", current: 1, total: 1, msg: "正在使用 PlanningTree 智能排序", detail: { totalGaps: merged.length, openGaps: openGapsList.length } });

  state.L1.gaps = merged;

  const openGapCount = merged.filter((g) => g.status === "open").length;
  state.addTimeline({ name: "deepsearch.gaps", status: "completed", payload: { gapCount: openGapCount, totalGaps: merged.length } });

  // 记录 gaps 阶段完成
  logEvent({
    stage: 'gaps',
    message: 'Gaps stage completed',
    data: {
      totalGaps: merged.length,
      openGaps: openGapCount,
      closedGaps: merged.length - openGapCount,
      defaultGaps: suggested.length,
      llmGaps: Array.isArray(llmSuggested) ? llmSuggested.length : 0,
    },
  });

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
