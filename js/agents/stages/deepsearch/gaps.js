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
  throw new TypeError("DeepSearch gaps: input.state is required");
}

function gap(gapId, type, question, { priority = "medium", queryHints = [] } = {}) {
  return {
    gapId,
    type,
    question,
    priority,
    queryHints: Array.isArray(queryHints) ? queryHints : [],
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
  const gaps = buildDefaultGaps(state.taskGoal, scanSummary);

  state.L1.gaps = gaps;
  state.addTimeline({ name: "deepsearch.gaps", status: "completed", payload: { gapCount: gaps.length } });

  const todos = [];
  for (const g of gaps) {
    const t = state.addTodo({ text: `Fill gap: ${g.type} — ${g.question}`, relatedGapId: g.gapId, status: "open" });
    todos.push(t);
    emit?.("deepsearch.todo.created", { todoId: t.todoId, relatedGapId: g.gapId });
  }

  emit?.("deepsearch.gaps.completed", { gapCount: gaps.length, todoCount: todos.length });
  return { state, gaps, todos };
}
