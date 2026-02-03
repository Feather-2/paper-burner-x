/**
 * CodeSearch Execution Phase
 *
 * 职责：
 * - 工具执行循环
 * - 解析 LLM 决策
 * - 执行工具调用
 * - 更新 Todo 状态
 */

import { isPlainObject, toNonEmptyString } from "../../../shared/index.js";
import { createLogger } from "../../../shared/index.js";
import { checkCancelled } from "../../../shared/index.js";
import { TodoStatus } from "../states.js";
import { CODESEARCH_STEP_PROMPT } from "../prompts.js";
import { formatOpenTodos, isTodoOpen } from "./planning-phase.js";

const logger = createLogger("stages/codesearch/phases/execution-phase");

const MAX_DECISION_RESPONSE_CHARS = 12000;
const MAX_DECISION_JSON_CHARS = 8000;
const MAX_ACTIONS = 5;
const MAX_ARG_STRING_CHARS = 2000;
const MAX_NEW_TODOS = 10;
const MAX_TODO_TEXT_CHARS = 400;
const MAX_TODO_HINTS = 10;
const MAX_TODO_HINT_CHARS = 80;
const MAX_TODO_EVIDENCE_CHARS = 400;
const ALLOWED_TODO_KEYS = new Set(["text", "priority", "queryHints", "expectedEvidence"]);
const ALLOWED_TODO_PRIORITIES = new Set(["low", "medium", "high"]);
const ALLOWED_TODO_STATUSES = new Set(["pending", "completed", "cancelled"]);
const TOOL_ARG_SCHEMA = {
  glob: { pattern: "string", path: "string" },
  grep: { pattern: "string", path: "string", regex: "boolean", caseSensitive: "boolean" },
  read_file: { path: "string", startLine: "number", endLine: "number" },
  write_file: { path: "string", content: "string", checkpoint: "boolean" },
  multi_edit: { path: "string", edits: "edits", checkpoint: "boolean" },
  list_dir: { path: "string", showHidden: "boolean" },
  tree: { path: "string", depth: "number", pattern: "string" },
  index_symbols: { pattern: "string", path: "string", paths: "paths", limit: "number", force: "boolean", workspaceId: "string" },
  find_symbol: { query: "string", pathPrefix: "string", limit: "number", workspaceId: "string" },
};
const TOOL_NAMES = new Set(Object.keys(TOOL_ARG_SCHEMA));
const DEFAULT_CALL_TIMEOUT_MS = 30000;
const DEFAULT_TOOL_TIMEOUT_MS = 30000;

/**
 * @typedef {object} WatchdogOutputArgs
 * @property {number=} step
 * @property {string=} todoId
 * @property {any=} decision
 * @property {string=} actionName
 * @property {any=} args
 * @property {string=} resultSummary
 */

/** @private */
function safeJsonStringify(value, maxChars = 600) {
  try {
    const text = JSON.stringify(value);
    if (typeof text !== "string") return "";
    return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
  } catch {
    const text = String(value ?? "");
    return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
  }
}

function withTimeout(promise, timeoutMs, label) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = Object.assign(new Error(`${label} timed out after ${timeoutMs}ms`), { code: "timeout" });
      reject(error);
    }, timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}

function clampNumber(value, { min = -Infinity, max = Infinity, fallback = 0 } = {}) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

function normalizeString(value, maxLen = MAX_ARG_STRING_CHARS) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLen) return null;
  return trimmed;
}

function sanitizeTodoId(value) {
  const s = toNonEmptyString(value);
  if (!s) return null;
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(s)) return null;
  return s;
}

function sanitizeTodoStatus(value) {
  const s = toNonEmptyString(value);
  if (!s) return null;
  const lowered = s.toLowerCase();
  return ALLOWED_TODO_STATUSES.has(lowered) ? lowered : null;
}

function sanitizeNewTodos(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > MAX_NEW_TODOS) return null;
  const sanitized = [];

  for (const item of value) {
    if (!isPlainObject(item)) return null;
    const keys = Object.keys(item);
    if (keys.some((key) => !ALLOWED_TODO_KEYS.has(key))) return null;

    const text = toNonEmptyString(item.text);
    if (!text || text.length > MAX_TODO_TEXT_CHARS) return null;

    const priority = toNonEmptyString(item.priority);
    if (priority && !ALLOWED_TODO_PRIORITIES.has(priority)) return null;

    const rawHints = Array.isArray(item.queryHints) ? item.queryHints : [];
    const hints = [];
    for (const hint of rawHints) {
      if (typeof hint !== "string") return null;
      const trimmed = hint.trim();
      if (!trimmed) continue;
      if (trimmed.length > MAX_TODO_HINT_CHARS) return null;
      hints.push(trimmed);
      if (hints.length > MAX_TODO_HINTS) return null;
    }

    const expectedEvidence = toNonEmptyString(item.expectedEvidence);
    if (expectedEvidence && expectedEvidence.length > MAX_TODO_EVIDENCE_CHARS) return null;

    const entry = { text };
    if (priority) entry.priority = priority;
    if (hints.length) entry.queryHints = hints;
    if (expectedEvidence) entry.expectedEvidence = expectedEvidence;
    sanitized.push(entry);
  }

  return sanitized;
}

function sanitizeEdits(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 50) return null;
  const sanitized = [];
  for (const edit of value) {
    if (!isPlainObject(edit)) return null;
    const keys = Object.keys(edit);
    if (keys.some((key) => key !== "old_string" && key !== "new_string")) return null;
    const oldString = normalizeString(edit.old_string, MAX_ARG_STRING_CHARS);
    if (!oldString) return null;
    const newString = typeof edit.new_string === "string" ? edit.new_string : null;
    if (newString == null || newString.length > MAX_ARG_STRING_CHARS) return null;
    sanitized.push({ old_string: oldString, new_string: newString });
  }
  return sanitized;
}

function sanitizePaths(value) {
  if (typeof value === "string") {
    const s = normalizeString(value, MAX_ARG_STRING_CHARS);
    return s ? s : null;
  }
  if (Array.isArray(value)) {
    const out = [];
    for (const entry of value) {
      const s = normalizeString(entry, MAX_ARG_STRING_CHARS);
      if (!s) return null;
      out.push(s);
    }
    return out;
  }
  return null;
}

function sanitizeArgs(toolName, args) {
  const schema = TOOL_ARG_SCHEMA[toolName];
  if (!schema) return null;
  if (args == null) return {};
  if (!isPlainObject(args)) return null;
  const output = {};
  for (const [key, value] of Object.entries(args)) {
    if (!Object.prototype.hasOwnProperty.call(schema, key)) return null;
    const type = schema[key];
    let sanitized = null;
    if (type === "string") {
      sanitized = normalizeString(value, MAX_ARG_STRING_CHARS);
    } else if (type === "number") {
      sanitized = Number.isFinite(value) ? value : null;
    } else if (type === "boolean") {
      sanitized = typeof value === "boolean" ? value : null;
    } else if (type === "edits") {
      sanitized = sanitizeEdits(value);
    } else if (type === "paths") {
      sanitized = sanitizePaths(value);
    }
    if (sanitized == null) return null;
    output[key] = sanitized;
  }
  return output;
}

function summarizeToolResultForWatchdog(toolName, result) {
  const r = result && typeof result === "object" ? result : { value: result };
  const err = typeof r.error === "string" ? r.error : null;
  if (err) return `error:${err.slice(0, 160)}`;

  switch (toolName) {
    case "tree":
      return `tree:${clampNumber(r.stats?.files, { min: 0, fallback: -1 })}f:${clampNumber(r.stats?.dirs, { min: 0, fallback: -1 })}d`;
    case "list_dir":
      return `list_dir:${String(r.path || "")}:${Array.isArray(r.entries) ? r.entries.length : 0}`;
    case "read_file":
      return `read_file:${String(r.path || "")}:${clampNumber(r.range?.start, { min: 0, fallback: 0 })}-${clampNumber(r.range?.end, { min: 0, fallback: 0 })}/${clampNumber(r.totalLines, { min: 0, fallback: 0 })}`;
    case "glob":
      return `glob:${clampNumber(r.total, { min: 0, fallback: Array.isArray(r.files) ? r.files.length : 0 })}`;
    case "grep":
      return `grep:${clampNumber(r.total, { min: 0, fallback: Array.isArray(r.matches) ? r.matches.length : 0 })}`;
    case "find_symbol":
      return `find_symbol:${clampNumber(r.total, { min: 0, fallback: Array.isArray(r.matches) ? r.matches.length : 0 })}`;
    default: {
      const keys = Object.keys(r).slice(0, 10).join(",");
      return keys ? `ok:${keys}` : "ok";
    }
  }
}

/**
 * @param {WatchdogOutputArgs=} args
 * @returns {string}
 */
function buildWatchdogOutput({ step, todoId, decision, actionName, args, resultSummary } = {}) {
  const parts = [];
  if (Number.isFinite(step)) parts.push(`step=${step}`);
  if (todoId) parts.push(`todo=${String(todoId)}`);
  if (decision?.done) parts.push("done=true");
  if (decision?.thought) parts.push(`thought=${String(decision.thought).slice(0, 120)}`);
  if (actionName) parts.push(`action=${String(actionName)}`);
  if (args && typeof args === "object") parts.push(`args=${safeJsonStringify(args, 320)}`);
  if (resultSummary) parts.push(`result=${String(resultSummary).slice(0, 260)}`);
  return parts.join(" | ");
}

function buildInvalidDecision() {
  return {
    action: null,
    actions: null,
    args: {},
    done: false,
    newTodos: [],
    invalid: true,
  };
}

function safeParseJsonObject(text, maxChars) {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > maxChars) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * 解析 LLM 步骤决策
 */
function parseStepDecision(text) {
  const raw = String(text ?? "");
  if (!raw) {
    logger.warn("Empty step decision response");
    return buildInvalidDecision();
  }
  if (raw.length > MAX_DECISION_RESPONSE_CHARS) {
    logger.warn("Step decision response too long", { length: raw.length });
    return buildInvalidDecision();
  }

  // 尝试提取 JSON
  const jsonMatch = raw.match(/```json\s*([\s\S]*?)\s*```/);
  const candidates = [];
  if (jsonMatch) candidates.push(jsonMatch[1]);
  candidates.push(raw);

  let parsed = null;
  for (const candidate of candidates) {
    const trimmed = String(candidate || "").trim();
    if (!trimmed) continue;
    parsed = safeParseJsonObject(trimmed, MAX_DECISION_JSON_CHARS);
    if (parsed) break;
  }

  if (!parsed) {
    // 尝试提取字段
    const actionMatch = raw.match(/"action"\s*:\s*"(\w+)"/);
    const toolMatch = raw.match(/"tool"\s*:\s*"(\w+)"/);
    const argsMatch = raw.match(/"args"\s*:\s*(\{[^}]+\})/);

    if (actionMatch || toolMatch) {
      let parsedArgs = {};
      if (argsMatch) {
        const argsText = String(argsMatch[1] || "");
        const safeArgs = safeParseJsonObject(argsText, MAX_DECISION_JSON_CHARS);
        if (safeArgs) {
          parsedArgs = safeArgs;
        } else {
          logger.warn("Failed to parse args JSON in LLM response", { argsText: argsText.slice(0, 200) });
        }
      }
      parsed = {
        action: actionMatch?.[1] || toolMatch?.[1],
        args: parsedArgs,
      };
    } else if (raw.includes('"done": true') || raw.toLowerCase().includes("analysis complete")) {
      parsed = { done: true };
    }
  }

  if (!parsed) {
    logger.warn("Failed to parse step decision", { responsePreview: raw.slice(0, 200) });
    return buildInvalidDecision();
  }

  const done = parsed.done === true || String(parsed.action || "").toLowerCase() === "done";
  const action = toNonEmptyString(parsed.action || parsed.tool);
  if (action && !TOOL_NAMES.has(action) && !done) return buildInvalidDecision();

  let actions = null;
  if (Array.isArray(parsed.actions) && parsed.actions.length > 0) {
    if (parsed.actions.length > MAX_ACTIONS) return buildInvalidDecision();
    actions = [];
    for (const item of parsed.actions) {
      if (!isPlainObject(item)) return buildInvalidDecision();
      const toolName = toNonEmptyString(item.action || item.tool);
      if (!toolName || !TOOL_NAMES.has(toolName)) return buildInvalidDecision();
      const toolArgs = sanitizeArgs(toolName, item.args);
      if (toolArgs == null) return buildInvalidDecision();
      actions.push({ action: toolName, args: toolArgs });
    }
  } else if (parsed.actions != null) {
    return buildInvalidDecision();
  }

  if (!done && !action && !actions) return buildInvalidDecision();

  const args = action ? sanitizeArgs(action, parsed.args) : {};
  if (action && args == null) return buildInvalidDecision();

  const newTodos = sanitizeNewTodos(parsed.newTodos);
  if (parsed.newTodos && newTodos == null) return buildInvalidDecision();

  return {
    action,
    actions,
    args: args || {},
    done,
    todoId: sanitizeTodoId(parsed.todoId || parsed.todo_id),
    todoStatus: sanitizeTodoStatus(parsed.todoStatus || parsed.todo_status),
    completeTodo: parsed.completeTodo === true || parsed.completed === true,
    newTodos: Array.isArray(newTodos) ? newTodos : [],
    thought: toNonEmptyString(parsed.thought || parsed.summary),
  };
}

/**
 * 选择关联的 Todo
 */
function resolveTodoSelection(decision, openTodos) {
  if (!Array.isArray(openTodos) || openTodos.length === 0) return null;

  const todoId = toNonEmptyString(decision?.todoId);
  if (todoId) {
    const matched = openTodos.find((t) => String(t?.todoId || "") === todoId);
    if (matched) return matched;
  }

  return openTodos[0];
}

/**
 * 格式化工具执行结果
 */
function formatToolResult(toolName, result) {
  if (result.error) {
    return `[${toolName}] Error: ${result.error}`;
  }

  switch (toolName) {
    case "tree":
      return `[tree]\n${result.tree}\n(${result.stats?.files} files, ${result.stats?.dirs} dirs)`;

    case "list_dir":
      const entries = result.entries || [];
      return `[list_dir: ${result.path}]\n${entries.map(e => `${e.type === "dir" ? "📁" : "📄"} ${e.name}`).join("\n")}`;

    case "read_file":
      return `[read_file: ${result.path}] (lines ${result.range?.start}-${result.range?.end} of ${result.totalLines})\n${result.content}`;

    case "glob":
      return `[glob] Found ${result.total} files:\n${(result.files || []).slice(0, 20).join("\n")}${result.truncated ? "\n..." : ""}`;

    case "grep":
      const matches = result.matches || [];
      return `[grep] Found ${result.total} matches:\n${matches.map(m => `${m.file}: ${m.matchCount} matches`).join("\n")}`;

    case "find_symbol":
      const rows = Array.isArray(result.matches) ? result.matches : [];
      const preview = rows
        .slice(0, 20)
        .map((m) => `${m.name || "?"} ${m.kind ? `(${m.kind}) ` : ""}- ${m.file || m.path}${m.startLine ? `:${m.startLine}` : ""}`)
        .join("\n");
      return `[find_symbol] Found ${result.total || 0} matches:\n${preview || "(none)"}`;

    default:
      return `[${toolName}]\n${JSON.stringify(result, null, 2)}`;
  }
}

/**
 * @typedef {object} ExecutionStepArgs
 * @property {import('../state.js').CodeSearchState} state - CodeSearch 状态
 * @property {number} step - 当前步骤号
 * @property {number} maxSteps - 最大步骤数
 * @property {string} systemPrompt - 系统提示词
 * @property {(messages: Array<{ role: string, content: string }>, options?: any) => Promise<any>} callModel - LLM 调用函数
 * @property {{ execute: (toolName: string, args: any) => Promise<any> }} tools - 工具执行器
 * @property {import('../../../shared/utils/budget.js').BudgetManager=} budgetManager - 预算管理器
 * @property {((eventName: string, payload: any) => void)=} emit - 事件发射函数
 * @property {AbortSignal|null=} signal - 取消信号
 *
 * @typedef {object} ExecutionStepResult
 * @property {boolean} done - 是否完成
 * @property {string=} reason - 完成原因
 * @property {string=} error - 错误信息
 * @property {string=} watchdogOutput - Watchdog 输出
 */

/**
 * 运行执行阶段（单步）
 * @param {ExecutionStepArgs} args - 执行步骤参数
 * @returns {Promise<ExecutionStepResult>} 执行结果
 */
export async function runExecutionStep({
  state,
  step,
  maxSteps,
  systemPrompt,
  callModel,
  tools,
  budgetManager,
  emit,
  signal,
}) {
  checkCancelled(signal);

  const openTodos = state.todos.filter(isTodoOpen);
  if (!openTodos.length) {
    return { done: true, reason: "no_open_todos" };
  }

  logger.info(`Executing step ${step}/${maxSteps}`);
  emit?.("codesearch:step_started", { step, total: maxSteps });

  // 构建 step prompt
  const stepPrompt = CODESEARCH_STEP_PROMPT
    .replace("{QUERY}", state.query)
    .replace("{STEP}", String(step))
    .replace("{MAX_STEPS}", String(maxSteps))
    .replace("{OPEN_TODOS}", formatOpenTodos(openTodos))
    .replace("{OBSERVATIONS}", state.observations.slice(-10).join("\n\n---\n\n") || "(无)");

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: stepPrompt },
  ];

  // 调用 LLM
  let response;
  try {
    response = await withTimeout(
      callModel(messages, {
        model: "auto",
        temperature: 0.3,
        maxTokens: 1000,
        signal,
      }),
      DEFAULT_CALL_TIMEOUT_MS,
      "callModel"
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const errorCode = err && typeof err === "object" && err.code === "timeout" ? "model_timeout" : "model_error";
    logger.warn("Execution step failed: model error", { step, error: message, code: errorCode });
    state.addObservation(`[Step ${step}] Model error: ${message}`);
    return {
      done: false,
      error: errorCode,
      watchdogOutput: `step=${step} | ${errorCode} | ${message.slice(0, 120)}`,
    };
  }

  if (response?.usage && budgetManager) {
    budgetManager.recordUsage({
      input: response.usage.input || response.usage.prompt_tokens || 0,
      output: response.usage.output || response.usage.completion_tokens || 0,
    });
  }

  const responseText = response?.content || response?.text || "";
  const decision = parseStepDecision(responseText);

  if (!decision || decision.invalid) {
    logger.warn("Failed to parse step decision");
    state.addObservation(`[Step ${step}] Failed to parse LLM response`);
    return { done: false, error: "parse_failed", watchdogOutput: `step=${step} | parse_failed | response_len=${responseText.length}` };
  }

  // 检查完成
  if (decision.done) {
    const selectedTodo = resolveTodoSelection(decision, openTodos);
    if (selectedTodo && decision.completeTodo) {
      state.updateTodo(selectedTodo.todoId, { status: TodoStatus.COMPLETED });
    }
    state.finalThought = decision.thought || responseText;
    emit?.("codesearch:step_completed", { step, action: "done" });
    return {
      done: true,
      reason: "llm_done",
      watchdogOutput: buildWatchdogOutput({
        step,
        todoId: selectedTodo?.todoId,
        decision,
        actionName: "done",
        args: decision.args,
        resultSummary: "llm_done",
      }),
    };
  }

  const actionName = toNonEmptyString(decision.action);
  if (!actionName && !decision.actions) {
    state.addObservation(`[Step ${step}] Missing tool action`);
    return { done: false, error: "missing_action" };
  }

  const selectedTodo = resolveTodoSelection(decision, openTodos);

  // 批量执行工具
  if (decision.actions) {
    if (selectedTodo && selectedTodo.status === TodoStatus.OPEN) {
      state.updateTodo(selectedTodo.todoId, { status: TodoStatus.PENDING });
    }
    const batchResults = await Promise.all(
      decision.actions.map(async (item) => {
        const toolName = toNonEmptyString(item.action || item.tool);
        if (!toolName || !TOOL_NAMES.has(toolName)) {
          return { tool: toolName || "unknown", success: false, error: "tool_not_allowed" };
        }
        const toolArgs = sanitizeArgs(toolName, item.args);
        if (toolArgs == null) {
          return { tool: toolName, success: false, error: "invalid_tool_args" };
        }
        try {
          const result = await withTimeout(
            tools.execute(toolName, toolArgs),
            DEFAULT_TOOL_TIMEOUT_MS,
            `tool:${toolName}`
          );
          return { tool: toolName, args: toolArgs, success: true, result };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { tool: toolName, args: toolArgs, success: false, error: message };
        }
      })
    );

    const batchObservation = batchResults
      .map((r, i) => `${i + 1}. ${r.tool}: ${r.success ? formatToolResult(r.tool, r.result) : `Error: ${r.error}`}`)
      .join("\n");
    state.addObservation(`[Step ${step}] Batch (${batchResults.length} tools):\n${batchObservation}`);
    state.addStep({ step, tool: "batch", args: { count: batchResults.length }, result: batchResults, todoId: selectedTodo?.todoId });

    // 处理 todo 状态更新
    if (selectedTodo && (decision.completeTodo || decision.todoStatus === "completed")) {
      state.updateTodo(selectedTodo.todoId, { status: TodoStatus.COMPLETED });
    } else if (selectedTodo && decision.todoStatus === "cancelled") {
      state.updateTodo(selectedTodo.todoId, { status: TodoStatus.CANCELLED });
    }

    emit?.("codesearch:step_completed", { step, tool: "batch", count: batchResults.length });
    return {
      done: false,
      watchdogOutput: buildWatchdogOutput({
        step,
        todoId: selectedTodo?.todoId,
        decision,
        actionName: "batch",
        args: { count: batchResults.length },
        resultSummary: batchResults
          .slice(0, 6)
          .map((r) => `${r.tool}:${r.success ? "ok" : "err"}:${summarizeToolResultForWatchdog(r.tool, r.success ? r.result : { error: r.error })}`)
          .join(" / "),
      }),
    };
  }

  if (actionName && !TOOL_NAMES.has(actionName)) {
    state.addObservation(`[Step ${step}] Tool not allowed: ${actionName}`);
    return { done: false, error: "tool_not_allowed" };
  }
  const sanitizedArgs = actionName ? sanitizeArgs(actionName, decision.args) : null;
  if (actionName && sanitizedArgs == null) {
    state.addObservation(`[Step ${step}] Invalid tool args for ${actionName}`);
    return { done: false, error: "invalid_tool_args" };
  }

  if (selectedTodo && selectedTodo.status === TodoStatus.OPEN) {
    state.updateTodo(selectedTodo.todoId, { status: TodoStatus.PENDING });
  }

  // 单个工具执行
  let result;
  try {
    result = await withTimeout(
      tools.execute(actionName, sanitizedArgs || {}),
      DEFAULT_TOOL_TIMEOUT_MS,
      `tool:${actionName}`
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result = { error: message };
  }

  const formattedResult = formatToolResult(actionName, result);
  const todoLabel = selectedTodo ? `[todo ${selectedTodo.todoId}]` : "[todo none]";
  state.addObservation(`[Step ${step}] ${todoLabel} ${formattedResult}`);
  state.addStep({ step, tool: actionName, args: sanitizedArgs || {}, result, todoId: selectedTodo?.todoId });

  // 处理 todo 状态更新
  if (selectedTodo && (decision.completeTodo || decision.todoStatus === "completed")) {
    state.updateTodo(selectedTodo.todoId, { status: TodoStatus.COMPLETED });
  } else if (selectedTodo && decision.todoStatus === "cancelled") {
    state.updateTodo(selectedTodo.todoId, { status: TodoStatus.CANCELLED });
  }

  emit?.("codesearch:step_completed", { step, tool: actionName, resultSummary: result.error || `${actionName} completed` });
  return {
    done: false,
    watchdogOutput: buildWatchdogOutput({
      step,
      todoId: selectedTodo?.todoId,
      decision,
      actionName,
      args: sanitizedArgs || {},
      resultSummary: summarizeToolResultForWatchdog(actionName, result),
    }),
  };
}
