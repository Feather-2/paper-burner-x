import { DeepSearchState, checkCancelled, extractJsonCandidate, makeStageEmitter, EventStatus } from "./state.js";
import { getModelCaller } from "./model.js";
import { loadPrompt, renderPromptTemplate } from "../../prompts/prompt-loader.js";
import { validateTodo } from "./utils/todo-utils.js";
import { createLogger } from "./runtime/logger.js";
import { extractServices } from "./utils/stage-api.js";
import { isPlainObject, toNonEmptyString } from "../../shared/utils/value-utils.js";

const FALLBACK_REASON = "LLM unavailable or invalid output; using heuristic todos";
const DEFAULT_PROMPT =
  "You are a DeepSearch todo planner. Return ONLY a JSON array of todos " +
  "with fields: text, priority, queryHints, expectedEvidence. " +
  "priority must be high|medium|low. queryHints should be 3-6 short keywords.";

function ensureState(_runContext, input) {
  if (input instanceof DeepSearchState) return input;
  if (input?.state instanceof DeepSearchState) return input.state;
  if (isPlainObject(input?.state)) return DeepSearchState.fromJSON(input.state);
  throw new TypeError("DeepSearch todos: input.state is required");
}

function collapseWhitespace(s) {
  return String(s || "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(s, maxLen = 240) {
  const t = collapseWhitespace(s);
  return t.length > maxLen ? t.slice(0, maxLen) : t;
}

function normalizeStringArray(value) {
  const raw = Array.isArray(value) ? value : value ? [value] : [];
  return raw.map((item) => String(item || "").trim()).filter(Boolean);
}

function normalizeTodosCacheKeyInputs(taskGoal, scanSummary) {
  const summaryText = truncate(scanSummary?.summaryText || "", 320);
  const keyTopics = Array.isArray(scanSummary?.keyTopics)
    ? scanSummary.keyTopics.map((t) => truncate(t, 60))
    : [];
  return {
    taskGoal: truncate(taskGoal || "", 200),
    summaryText,
    keyTopics,
  };
}

function uniqueStrings(values) {
  const out = [];
  const seen = new Set();
  for (const v of values) {
    const s = typeof v === "string" ? v.trim() : "";
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

function buildFallbackTodos(state, scanSummary) {
  const taskGoal = truncate(state?.taskGoal || "", 160);
  const topics = Array.isArray(scanSummary?.keyTopics) ? scanSummary.keyTopics.map((t) => truncate(t, 60)) : [];
  const summary = truncate(scanSummary?.summaryText || "", 240);
  const baseHints = uniqueStrings([taskGoal, ...topics]).slice(0, 6);

  const todos = [];

  const mainText = taskGoal
    ? `围绕目标“${taskGoal}”检索关键事实并整理可引用证据`
    : "围绕用户目标检索关键事实并整理可引用证据";
  todos.push({
    text: mainText,
    priority: "high",
    queryHints: baseHints.length ? baseHints : [],
    expectedEvidence: "可引用的原文片段/数据/权威结论",
    source: "system",
  });

  const topicTodos = topics.filter(Boolean).slice(0, 2);
  for (const topic of topicTodos) {
    const hints = uniqueStrings([topic, ...baseHints]).slice(0, 6);
    todos.push({
      text: `聚焦主题“${topic}”：提取定义、关键指标与结论`,
      priority: "medium",
      queryHints: hints,
      expectedEvidence: "定义/数据/对比/结论（含出处）",
      source: "system",
    });
  }

  if (!topicTodos.length) {
    const hints = uniqueStrings([taskGoal, ...(summary ? [summary] : [])]).slice(0, 6);
    todos.push({
      text: "从现有来源中提炼 5-10 条关键论点，并为每条论点补充证据",
      priority: "medium",
      queryHints: hints,
      expectedEvidence: "论点 + 支撑证据（引用片段/出处）",
      source: "system",
    });
  }

  return todos.filter((t) => toNonEmptyString(t?.text)).slice(0, 4);
}

async function loadTodosPrompt() {
  try {
    const prompt = await loadPrompt("deepsearch/todos");
    return prompt || DEFAULT_PROMPT;
  } catch (err) {
    console.warn("[DeepSearch] todos: prompt load failed; using fallback.", err?.message || err);
    return DEFAULT_PROMPT;
  }
}

async function tryLLMTodos(state, scanSummary, stageApi) {
  const callModel = getModelCaller(stageApi, { usage: "planner", state });
  if (!callModel) return null;

  const promptTemplate = await loadTodosPrompt();
  const prompt = renderPromptTemplate(promptTemplate, {
    vars: {
      currentDate: new Date().toISOString().slice(0, 10),
      taskGoal: String(state?.taskGoal || ""),
    },
  });
  const contextSummary = stageApi?.getContextSummary?.() || "";
  const cacheKeyInputs = normalizeTodosCacheKeyInputs(state?.taskGoal, scanSummary);

  const userPayload = JSON.stringify(
    {
      taskGoal: String(state?.taskGoal || ""),
      scanSummary: isPlainObject(scanSummary) ? scanSummary : {},
    },
    null,
    2
  );
  const userContent = contextSummary ? `## Context\n${contextSummary}\n\n${userPayload}` : userPayload;

  const messages = [
    { role: "system", content: prompt },
    { role: "user", content: userContent },
  ];

  try {
    const result = await callModel(messages, { model: "auto", temperature: 0.3, maxTokens: 900, cacheKeyInputs });
    const candidate = extractJsonCandidate(result?.content);
    if (!candidate) return null;
    const parsed = JSON.parse(candidate);
    if (Array.isArray(parsed)) return parsed;
    if (isPlainObject(parsed) && Array.isArray(parsed.todos)) return parsed.todos;
    return null;
  } catch {
    return null;
  }
}

function normalizeTodoInput(item) {
  if (!isPlainObject(item)) return null;
  const text = toNonEmptyString(item.text);
  if (!text) return null;
  return {
    text,
    priority: toNonEmptyString(item.priority),
    queryHints: normalizeStringArray(item.queryHints),
    expectedEvidence: toNonEmptyString(item.expectedEvidence) || "",
    source: "llm",
  };
}

export async function runDeepSearchTodosStage(runContext, input, stageApi = {}) {
  const { emit: rawEmit, logger: injectedLogger } = extractServices(stageApi);
  const state = ensureState(runContext, input);
  const emit = makeStageEmitter(stageApi, "deepsearch", () => ({
    runId: state.runId,
    iteration: state.iteration || 0,
    trajectoryId: state.trajectoryId,
    stage: "todos",
  }));
  const logger =
    injectedLogger && typeof injectedLogger.info === "function"
      ? injectedLogger
      : createLogger({
          emit: rawEmit,
          getContext: () => ({ runId: state.runId, iteration: state.iteration || 0, trajectoryId: state.trajectoryId, stage: "todos" }),
        });

  checkCancelled(stageApi);

  const existingTodos = Array.isArray(state?.todos) ? state.todos : [];
  const hasExistingTodos = existingTodos.some((t) => toNonEmptyString(t?.text));
  const hasUserTodos = existingTodos.some((t) => String(t?.source || "").toLowerCase() === "user");

  emit?.(
    "deepsearch.todos.started",
    { runId: state.runId, existingTodoCount: existingTodos.length, hasUserTodos },
    { status: EventStatus.STARTED, throttle: false }
  );

  if (hasExistingTodos) {
    state.setAwaitUserFeedback(false);
    emit?.(
      "deepsearch.todos.completed",
      { runId: state.runId, todoCount: existingTodos.length, createdCount: 0, skippedLLM: true, source: hasUserTodos ? "user" : "existing" },
      { status: EventStatus.COMPLETED, throttle: false }
    );
    return { state, todos: existingTodos, created: [] };
  }

  const scanSummary = isPlainObject(input?.scanSummary) ? input.scanSummary : isPlainObject(state?.L1?.scanSummary) ? state.L1.scanSummary : {};
  const rawTodos = await tryLLMTodos(state, scanSummary, stageApi);

  const created = [];

  const emitCreated = (row) => {
    emit?.(
      "deepsearch.todo.created",
      {
        runId: state.runId,
        todoId: toNonEmptyString(row.todoId) || "todo_unknown",
        status: row.status,
        priority: row.priority,
        source: row.source,
      },
      { throttle: false }
    );
  };

  const createTodos = (items) => {
    for (const item of items) {
      const row = state.addTodo(item);
      const { valid } = validateTodo(row);
      if (!valid) {
        state.todos.pop();
        continue;
      }
      created.push(row);
      emitCreated(row);
    }
  };

  if (Array.isArray(rawTodos)) {
    const normalized = rawTodos.map((item) => normalizeTodoInput(item)).filter(Boolean);
    createTodos(normalized);
  }

  if (!created.length) {
    logger.warn("Todos stage fallback: LLM unavailable or invalid output", { stage: "todos", data: { reason: FALLBACK_REASON } });
    const fallbackTodos = buildFallbackTodos(state, scanSummary);
    createTodos(fallbackTodos);
  }

  if (!created.length) {
    // Last-resort fallback: ensure at least one todo to avoid agent loop stalling.
    createTodos([
      {
        text: "基于现有来源生成一份结构化研究摘要（含关键结论与出处）",
        priority: "high",
        queryHints: [],
        expectedEvidence: "摘要 + 关键引用/出处",
        source: "system",
      },
    ]);
  }

  state.setAwaitUserFeedback(false, "");

  emit?.(
    "deepsearch.todos.completed",
    {
      runId: state.runId,
      todoCount: state.todos.length,
      createdCount: created.length,
      skippedLLM: Array.isArray(rawTodos) ? false : true,
      source: Array.isArray(rawTodos) ? "llm" : "system_fallback",
    },
    { status: EventStatus.COMPLETED, throttle: false }
  );

  return { state, todos: state.todos, created };
}
