/**
 * CodeSearch Execution Phase
 *
 * 职责：
 * - 工具执行循环
 * - 解析 LLM 决策
 * - 执行工具调用
 * - 更新 Todo 状态
 */

import { isPlainObject, toNonEmptyString } from "../../../shared/utils/value-utils.js";
import { createLogger } from "../../../shared/utils/logger.js";
import { checkCancelled } from "../../../shared/utils/cancellation.js";
import { TodoStatus } from "../states.js";
import { CODESEARCH_STEP_PROMPT } from "../prompts.js";
import { formatOpenTodos, isTodoOpen } from "./planning-phase.js";

const logger = createLogger("stages/codesearch/phases/execution-phase");

/**
 * @typedef {object} WatchdogOutputArgs
 * @property {number=} step
 * @property {string=} todoId
 * @property {any=} decision
 * @property {string=} actionName
 * @property {any=} args
 * @property {string=} resultSummary
 */

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

function clampNumber(value, { min = -Infinity, max = Infinity, fallback = 0 } = {}) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
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

/**
 * 解析 LLM 步骤决策
 */
function parseStepDecision(text) {
  if (!text) return null;

  // 尝试提取 JSON
  const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
  let parsed = null;

  if (jsonMatch) {
    try {
      parsed = JSON.parse(jsonMatch[1]);
    } catch { /* continue */ }
  }

  if (!parsed) {
    try {
      parsed = JSON.parse(text);
    } catch { /* continue */ }
  }

  if (!isPlainObject(parsed)) {
    // 尝试提取字段
    const actionMatch = text.match(/"action"\s*:\s*"(\w+)"/);
    const toolMatch = text.match(/"tool"\s*:\s*"(\w+)"/);
    const argsMatch = text.match(/"args"\s*:\s*(\{[^}]+\})/);

    if (actionMatch || toolMatch) {
      parsed = {
        action: actionMatch?.[1] || toolMatch?.[1],
        args: argsMatch ? JSON.parse(argsMatch[1]) : {},
      };
    } else if (text.includes('"done": true') || text.toLowerCase().includes("analysis complete")) {
      parsed = { done: true };
    }
  }

  if (!parsed) return null;

  // 支持批量 actions
  const batchActions = Array.isArray(parsed.actions) && parsed.actions.length > 0 ? parsed.actions : null;

  return {
    action: toNonEmptyString(parsed.action || parsed.tool),
    actions: batchActions,
    args: isPlainObject(parsed.args) ? parsed.args : {},
    done: parsed.done === true || String(parsed.action || "").toLowerCase() === "done",
    todoId: toNonEmptyString(parsed.todoId || parsed.todo_id),
    todoStatus: toNonEmptyString(parsed.todoStatus || parsed.todo_status),
    completeTodo: parsed.completeTodo === true || parsed.completed === true,
    newTodos: Array.isArray(parsed.newTodos) ? parsed.newTodos : [],
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
 * 运行执行阶段（单步）
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
  emit?.("codesearch.step.started", { step, total: maxSteps });

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
  const response = await callModel(messages, {
    model: "auto",
    temperature: 0.3,
    maxTokens: 1000,
    signal,
  });

  if (response?.usage && budgetManager) {
    budgetManager.recordUsage({
      input: response.usage.input || response.usage.prompt_tokens || 0,
      output: response.usage.output || response.usage.completion_tokens || 0,
    });
  }

  const responseText = response?.content || response?.text || "";
  const decision = parseStepDecision(responseText);

  if (!decision) {
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
    emit?.("codesearch.step.completed", { step, action: "done" });
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

  // 将选中的 todo 标记为 pending（正在处理）
  if (selectedTodo && selectedTodo.status === TodoStatus.OPEN) {
    state.updateTodo(selectedTodo.todoId, { status: TodoStatus.PENDING });
  }

  // 批量执行工具
  if (decision.actions) {
    const batchResults = await Promise.all(
      decision.actions.map(async (item) => {
        const toolName = toNonEmptyString(item.action || item.tool);
        const toolArgs = isPlainObject(item.args) ? item.args : {};
        if (!toolName) return { tool: "unknown", error: "missing tool name" };
        try {
          const result = await tools.execute(toolName, toolArgs);
          return { tool: toolName, args: toolArgs, success: true, result };
        } catch (err) {
          return { tool: toolName, args: toolArgs, success: false, error: err.message };
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

    emit?.("codesearch.step.completed", { step, tool: "batch", count: batchResults.length });
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

  // 单个工具执行
  let result;
  try {
    result = await tools.execute(actionName, decision.args);
  } catch (err) {
    result = { error: err.message };
  }

  const formattedResult = formatToolResult(actionName, result);
  const todoLabel = selectedTodo ? `[todo ${selectedTodo.todoId}]` : "[todo none]";
  state.addObservation(`[Step ${step}] ${todoLabel} ${formattedResult}`);
  state.addStep({ step, tool: actionName, args: decision.args, result, todoId: selectedTodo?.todoId });

  // 处理 todo 状态更新
  if (selectedTodo && (decision.completeTodo || decision.todoStatus === "completed")) {
    state.updateTodo(selectedTodo.todoId, { status: TodoStatus.COMPLETED });
  } else if (selectedTodo && decision.todoStatus === "cancelled") {
    state.updateTodo(selectedTodo.todoId, { status: TodoStatus.CANCELLED });
  }

  emit?.("codesearch.step.completed", { step, tool: actionName, resultSummary: result.error || `${actionName} completed` });
  return {
    done: false,
    watchdogOutput: buildWatchdogOutput({
      step,
      todoId: selectedTodo?.todoId,
      decision,
      actionName,
      args: decision.args,
      resultSummary: summarizeToolResultForWatchdog(actionName, result),
    }),
  };
}
