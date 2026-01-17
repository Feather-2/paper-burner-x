/**
 * CodeSearch Planning Phase
 *
 * 职责：
 * - 初始 Todo 规划（调用 LLM 生成待办列表）
 * - 构建系统 prompt
 */

import { isPlainObject, toNonEmptyString } from "../../../shared/utils/value-utils.js";
import { createLogger } from "../../../shared/utils/logger.js";
import { checkCancelled } from "../../../shared/utils/cancellation.js";
import { TodoStatus } from "../states.js";
import {
  CODESEARCH_TODO_PLANNER_PROMPT,
  CODESEARCH_SYSTEM_PROMPT,
} from "../prompts.js";
import { formatToolDefinitionsForLLM } from "../code-tools.js";

const logger = createLogger("stages/codesearch/phases/planning-phase");

/**
 * @typedef {object} CodeSearchTodoLike
 * @property {string=} todoId
 * @property {string=} text
 * @property {string=} priority
 * @property {string=} status
 * @property {string[]=} queryHints
 * @property {string=} expectedEvidence
 * @property {string=} source
 * @property {string=} createdAt
 *
 * @typedef {object} CodeSearchStateLike
 * @property {string=} query
 * @property {string=} taskGoal
 * @property {CodeSearchTodoLike[]=} todos
 * @property {(todo: CodeSearchTodoLike) => (CodeSearchTodoLike|null)=} addTodo
 * @property {(text: string) => void=} addObservation
 *
 * @typedef {object} BudgetManagerLike
 * @property {(usage: { input: number, output: number }) => void=} recordUsage
 *
 * @typedef {(eventName: string, payload: any) => void} EmitFn
 *
 * @typedef {(messages: Array<{ role: string, content: string }>, options?: any) => Promise<any>} CallModelFn
 *
 * @typedef {object} RunPlanningPhaseArgs
 * @property {CodeSearchStateLike} state
 * @property {CallModelFn} callModel
 * @property {BudgetManagerLike=} budgetManager
 * @property {EmitFn=} emit
 * @property {AbortSignal|null=} signal
 *
 * @typedef {object} PlanningPhaseResult
 * @property {boolean} success
 * @property {CodeSearchTodoLike[]} todos
 * @property {string=} error
 */

/**
 * 解析 Todo 规划输出
 * @param {string} text
 * @returns {any[]|null}
 */
function parseTodoPlannerOutput(text) {
  if (!text) return null;

  // 尝试提取 JSON
  const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      if (Array.isArray(parsed)) return parsed;
      if (isPlainObject(parsed) && Array.isArray(parsed.todos)) return parsed.todos;
    } catch { /* continue */ }
  }

  // 尝试直接解析
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    if (isPlainObject(parsed) && Array.isArray(parsed.todos)) return parsed.todos;
  } catch { /* continue */ }

  return null;
}

/**
 * 规范化 Todo 输入
 * @param {any} item
 * @returns {CodeSearchTodoLike|null}
 */
function normalizeTodoInput(item) {
  if (typeof item === "string") return { text: item };
  if (!isPlainObject(item)) return null;

  const text = toNonEmptyString(item.text || item.todo || item.title);
  if (!text) return null;

  return {
    todoId: toNonEmptyString(item.todoId) || `todo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    text,
    priority: toNonEmptyString(item.priority) || "medium",
    status: TodoStatus.OPEN,
    queryHints: Array.isArray(item.queryHints) ? item.queryHints : [],
    expectedEvidence: toNonEmptyString(item.expectedEvidence) || "",
    source: "llm",
    createdAt: new Date().toISOString(),
  };
}

/**
 * 运行 Todo 规划阶段
 * @param {RunPlanningPhaseArgs} args
 * @returns {Promise<PlanningPhaseResult>}
 */
export async function runPlanningPhase({
  state,
  callModel,
  budgetManager,
  emit,
  signal,
}) {
  checkCancelled(signal);

  const query = state.query || state.taskGoal || "分析代码库";
  logger.info("Starting planning phase", { query });
  emit?.("codesearch.planning.started", { query });

  const todoPrompt = CODESEARCH_TODO_PLANNER_PROMPT.replace("{QUERY}", query);
  const messages = [
    { role: "system", content: todoPrompt },
    { role: "user", content: query },
  ];

  let response;
  try {
    response = await callModel(messages, {
      model: "auto",
      temperature: 0.3,
      maxTokens: 700,
      signal,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn("Todo planning failed: model error", { error: message });
    emit?.("codesearch.planning.failed", { error: message });
    return { success: false, todos: [], error: message };
  }

  // 记录 token 消耗
  if (response?.usage && budgetManager) {
    budgetManager.recordUsage({
      input: response.usage.input || response.usage.prompt_tokens || 0,
      output: response.usage.output || response.usage.completion_tokens || 0,
    });
  }

  const responseText = response?.content || response?.text || "";
  const planned = parseTodoPlannerOutput(responseText);

  if (!planned || !planned.length) {
    logger.warn("Todo planning failed: no valid todos");
    return { success: false, todos: [], error: "no_todos_generated" };
  }

  const createdTodos = [];
  for (const item of planned) {
    const normalized = normalizeTodoInput(item);
    if (normalized) {
      state.addTodo(normalized);
      createdTodos.push(normalized);
    }
  }

  if (createdTodos.length === 0) {
    logger.warn("Todo planning failed: all todos invalid");
    return { success: false, todos: [], error: "all_todos_invalid" };
  }

  state.addObservation(`[Planning] Todos created (${createdTodos.length})\n${formatOpenTodos(state.todos)}`);
  emit?.("codesearch.planning.completed", { todoCount: createdTodos.length });

  logger.info("Planning phase completed", { todoCount: createdTodos.length });
  return { success: true, todos: createdTodos };
}

/**
 * 构建系统 Prompt
 * @returns {string}
 */
export function buildSystemPrompt() {
  return CODESEARCH_SYSTEM_PROMPT.replace("{TOOLS}", formatToolDefinitionsForLLM());
}

/**
 * 格式化待办列表
 * @param {CodeSearchTodoLike[]|null|undefined} todos
 * @returns {string}
 */
export function formatOpenTodos(todos) {
  const openTodos = Array.isArray(todos)
    ? todos.filter((t) => t.status !== TodoStatus.COMPLETED && t.status !== TodoStatus.CANCELLED)
    : [];

  if (!openTodos.length) return "(无)";

  return openTodos
    .map((todo, idx) => {
      const hints = Array.isArray(todo.queryHints) && todo.queryHints.length
        ? ` | hints: ${todo.queryHints.slice(0, 6).join(", ")}`
        : "";
      const priority = toNonEmptyString(todo.priority) || "medium";
      const todoId = toNonEmptyString(todo.todoId) || `todo_${idx + 1}`;
      const text =
        toNonEmptyString(todo.text) ||
        toNonEmptyString(todo.title) ||
        toNonEmptyString(todo.todo) ||
        toNonEmptyString(todo.name) ||
        "Untitled";
      return `${idx + 1}. [${todoId}] (${priority}) ${text}${hints}`;
    })
    .join("\n");
}

/**
 * 判断 Todo 是否打开
 * @param {CodeSearchTodoLike|null|undefined} todo
 * @returns {boolean}
 */
export function isTodoOpen(todo) {
  const status = toNonEmptyString(todo?.status)?.toLowerCase() || TodoStatus.OPEN;
  return status !== TodoStatus.COMPLETED && status !== TodoStatus.CANCELLED;
}
