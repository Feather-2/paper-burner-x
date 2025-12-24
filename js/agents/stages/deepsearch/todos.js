import { DeepSearchState, checkCancelled, extractJsonCandidate, makeStageEmitter, EventStatus } from "./state.js";
import { getModelCaller } from "./model.js";
import { loadPrompt } from "../../prompts/prompt-loader.js";
import { createTodo, validateTodo } from "./todo-utils.js";
import { createLogger } from "./logger.js";
import { extractServices } from "./stage-api.js";
import { StagePausedError } from "../../runtime/stage-errors.js";
import { isPlainObject, toNonEmptyString } from "../../shared/value-utils.js";

const PAUSE_REASON = "LLM unavailable, awaiting user input";
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

  const prompt = await loadTodosPrompt();
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

  if (!Array.isArray(rawTodos)) {
    logger.warn("Todos stage paused: LLM unavailable or invalid output", { stage: "todos", data: { reason: PAUSE_REASON } });
    state.setAwaitUserFeedback(true, PAUSE_REASON);
    throw new StagePausedError("Run paused", { runId: state.runId, reason: PAUSE_REASON });
  }

  const created = [];
  for (const item of rawTodos) {
    const normalized = normalizeTodoInput(item);
    if (!normalized) continue;
    const row = state.addTodo(normalized);
    const { valid } = validateTodo(row);
    if (!valid) {
      state.todos.pop();
      continue;
    }
    created.push(row);
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
  }

  if (!created.length) {
    logger.warn("Todos stage paused: no valid todos parsed", { stage: "todos", data: { reason: PAUSE_REASON } });
    state.setAwaitUserFeedback(true, PAUSE_REASON);
    throw new StagePausedError("Run paused", { runId: state.runId, reason: PAUSE_REASON });
  }

  state.setAwaitUserFeedback(false);

  emit?.(
    "deepsearch.todos.completed",
    { runId: state.runId, todoCount: state.todos.length, createdCount: created.length, skippedLLM: false },
    { status: EventStatus.COMPLETED, throttle: false }
  );

  return { state, todos: state.todos, created };
}
