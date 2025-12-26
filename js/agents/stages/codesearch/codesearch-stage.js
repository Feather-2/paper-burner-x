/**
 * CodeSearch Stage - 代码探索 Agent Loop
 *
 * 基于 Agent Loop 模式的代码分析：
 * - LLM 自主决定下一步操作
 * - 调用工具探索代码库
 * - 迭代直到完成分析
 *
 * 复用 DeepSearch 的：
 * - Budget 管理
 * - 取消机制
 * - 日志
 * - 错误处理
 */

import { createToolExecutor, formatToolDefinitionsForLLM } from "./code-tools.js";
import {
  CODESEARCH_SYSTEM_PROMPT,
  CODESEARCH_TODO_PLANNER_PROMPT,
  CODESEARCH_STEP_PROMPT,
  CODESEARCH_SUMMARIZE_PROMPT,
} from "./prompts.js";
import { CodeSearchPhase, TodoStatus, isValidTodoStatus } from "./states.js";
import { AgentStatus } from "../../runtime/core/agent-status.js";

// 复用 DeepSearch 基础设施
import { createBudgetManager, BudgetAction } from "../../shared/utils/budget.js";
import { makeStageEmitter } from "../deepsearch/state.js";
import { createLogger } from "../deepsearch/runtime/logger.js";
import { getModelCaller } from "../deepsearch/model.js";
import { createTodo, transitionTodoStatus, validateTodo } from "../deepsearch/utils/todo-utils.js";
import { extractJsonCandidate } from "../deepsearch/utils/state-utils.js";
import { isPlainObject, toNonEmptyString } from "../../shared/utils/value-utils.js";
import { BaseAgentLoop, checkCancelled } from "../../runtime/core/agent-loop.js";
import { StagePausedError } from "../../runtime/core/stage-errors.js";

const DEFAULT_MAX_STEPS = 20;
const DEFAULT_TIMEOUT_MS = 120_000; // 2 分钟
const PAUSE_REASON = "LLM unavailable, awaiting user input";

/**
 * 解析 LLM 输出的 action
 */
function parseAction(text) {
  // 尝试提取 JSON
  const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1]);
    } catch {
      // 继续尝试其他格式
    }
  }

  // 尝试直接解析 JSON
  try {
    const parsed = JSON.parse(text);
    if (parsed.action || parsed.tool) return parsed;
  } catch {
    // 继续
  }

  // 尝试提取 action 字段
  const actionMatch = text.match(/"action"\s*:\s*"(\w+)"/);
  const toolMatch = text.match(/"tool"\s*:\s*"(\w+)"/);
  const argsMatch = text.match(/"args"\s*:\s*(\{[^}]+\})/);

  if (actionMatch || toolMatch) {
    return {
      action: actionMatch?.[1] || toolMatch?.[1],
      args: argsMatch ? JSON.parse(argsMatch[1]) : {},
    };
  }

  // 检查是否是完成信号
  if (text.includes('"action": "done"') || text.includes('"done": true') || text.toLowerCase().includes("analysis complete")) {
    return { action: "done" };
  }

  return null;
}

function parseJsonPayload(text) {
  const candidate = extractJsonCandidate(text);
  if (!candidate) return null;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function parseTodoPlannerOutput(text) {
  const parsed = parseJsonPayload(text);
  if (Array.isArray(parsed)) return parsed;
  if (isPlainObject(parsed) && Array.isArray(parsed.todos)) return parsed.todos;
  return null;
}

function normalizeStringArray(value) {
  const raw = Array.isArray(value) ? value : value ? [value] : [];
  return raw.map((item) => String(item || "").trim()).filter(Boolean);
}

function normalizeTodoInput(item) {
  if (typeof item === "string") return { text: item };
  if (!isPlainObject(item)) return null;
  const text = toNonEmptyString(item.text || item.todo || item.title);
  if (!text) return null;
  return {
    todoId: toNonEmptyString(item.todoId),
    text,
    priority: toNonEmptyString(item.priority),
    status: toNonEmptyString(item.status),
    queryHints: normalizeStringArray(item.queryHints),
    expectedEvidence: toNonEmptyString(item.expectedEvidence),
    source: "llm",
  };
}

function normalizeTodoStatus(value) {
  const raw = toNonEmptyString(value);
  if (!raw) return "";
  const normalized = raw.toLowerCase();
  return isValidTodoStatus(normalized) ? normalized : "";
}

function parseStepDecision(text) {
  const parsed = parseJsonPayload(text);
  const raw = isPlainObject(parsed) ? parsed : parseAction(text);
  if (!isPlainObject(raw)) return null;

  return {
    action: toNonEmptyString(raw.action || raw.tool),
    args: isPlainObject(raw.args) ? raw.args : {},
    done: raw.done === true || String(raw.action || "").toLowerCase() === "done",
    todoId: toNonEmptyString(raw.todoId || raw.todo_id || raw.todo),
    todoIndex: Number.isFinite(raw.todoIndex) ? raw.todoIndex : Number.parseInt(raw.todoIndex, 10),
    todoText: toNonEmptyString(raw.todoText || raw.todo_text),
    todoStatus: normalizeTodoStatus(raw.todoStatus || raw.todo_status || raw.status),
    completeTodo: raw.completeTodo === true || raw.todoCompleted === true || raw.completed === true,
    newTodos: Array.isArray(raw.newTodos) ? raw.newTodos : Array.isArray(raw.todos) ? raw.todos : [],
    thought: toNonEmptyString(raw.thought || raw.summary),
  };
}

function isTodoOpen(todo) {
  const status = normalizeTodoStatus(todo?.status) || TodoStatus.OPEN;
  return status !== TodoStatus.COMPLETED && status !== TodoStatus.CANCELLED;
}

function resolveTodoSelection(decision, openTodos) {
  if (!Array.isArray(openTodos) || openTodos.length === 0) return null;
  const todoId = toNonEmptyString(decision?.todoId);
  if (todoId) {
    const matched = openTodos.find((todo) => String(todo?.todoId || "") === todoId);
    if (matched) return matched;
    const matchedLoose = openTodos.find((todo) => String(todo?.todoId || "").toLowerCase() === todoId.toLowerCase());
    if (matchedLoose) return matchedLoose;
    const matchedText = openTodos.find((todo) => String(todo?.text || "").includes(todoId));
    if (matchedText) return matchedText;
  }

  if (Number.isFinite(decision?.todoIndex)) {
    const idx = decision.todoIndex;
    if (idx >= 1 && idx <= openTodos.length) return openTodos[idx - 1];
    if (idx >= 0 && idx < openTodos.length) return openTodos[idx];
  }

  const todoText = toNonEmptyString(decision?.todoText);
  if (todoText) {
    const matched = openTodos.find((todo) => String(todo?.text || "").includes(todoText));
    if (matched) return matched;
  }

  return openTodos[0];
}

function formatOpenTodos(todos) {
  const openTodos = Array.isArray(todos) ? todos.filter(isTodoOpen) : [];
  if (!openTodos.length) return "(无)";
  return openTodos
    .map((todo, idx) => {
      const hints = Array.isArray(todo.queryHints) && todo.queryHints.length
        ? ` | hints: ${todo.queryHints.slice(0, 6).join(", ")}`
        : "";
      const priority = toNonEmptyString(todo.priority) || "medium";
      const todoId = toNonEmptyString(todo.todoId) || `todo_${idx + 1}`;
      return `${idx + 1}. [${todoId}] (${priority}) ${todo.text}${hints}`;
    })
    .join("\n");
}

function buildTodoCompletionStats(todos) {
  const rows = Array.isArray(todos) ? todos : [];
  const completed = rows.filter((t) => normalizeTodoStatus(t?.status) === TodoStatus.COMPLETED).length;
  const cancelled = rows.filter((t) => normalizeTodoStatus(t?.status) === TodoStatus.CANCELLED).length;
  return { total: rows.length, completed, cancelled };
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

    default:
      return `[${toolName}]\n${JSON.stringify(result, null, 2)}`;
  }
}

export class CodeSearchStage extends BaseAgentLoop {
  constructor(options = {}) {
    super({ actor: "codesearch", stageName: "codesearch", eventBus: options.eventBus });
    this.maxSteps = options.maxSteps || DEFAULT_MAX_STEPS;
    this.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    this.initLoopStatus({
      status: AgentStatus.IDLE,
      eventName: "codesearch.agent.status.changed",
    });
  }

  /**
   * 执行代码分析
   * @param {object} runContext - 运行上下文
   * @param {object} input - 输入
   * @param {string} input.query - 用户查询
   * @param {object} input.sources - 代码源（从 ingest 来）
   * @param {object} input.userConfig - 用户配置
   * @param {object} stageApi - Stage API
   */
  async run(input, context = {}) {
    const runContext = context.runContext || {};
    const stageApi = context;
    const runId = runContext?.runId || input?.runId || "run_unknown";
    const query = toNonEmptyString(input?.query) || "分析这个代码库的架构";
    const userConfig = isPlainObject(input?.userConfig) ? input.userConfig : {};

    // 初始化日志
    const logger = createLogger({
      emit: stageApi?.emit,
      getContext: () => ({
        runId: runContext?.runId,
        stage: "codesearch",
      }),
    });

    // 初始化预算管理
    const budgetManager = createBudgetManager(userConfig);
    let budgetStopRequested = false;

    budgetManager.onThresholdReached = ({ action }) => {
      if (action === BudgetAction.STOP) {
        budgetStopRequested = true;
      }
    };

    // 事件发射
    const emit = makeStageEmitter(stageApi, "codesearch");

    // 取消检查
    const checkStop = (signal) => {
      checkCancelled(signal);
      if (budgetStopRequested) {
        throw new Error("CodeSearch: Budget exceeded");
      }
    };

    // 初始化工具
    const tools = createToolExecutor({
      fs: stageApi?.fs || await this._getDefaultFs(),
      globFn: stageApi?.globFn,
      basePath: input?.basePath || ".",
    });

    // 初始化 LLM
    const callModel = getModelCaller(stageApi, { usage: "codesearch" });

    this._transitionLoopStatus(AgentStatus.RUNNING, { runId, iteration: 0 });
    logger.info("CodeSearch started", { stage: "codesearch", data: { query, maxSteps: this.maxSteps } });
    emit?.("codesearch.started", { query, maxSteps: this.maxSteps });

    // Agent Loop 上下文
    const loopState = {
      query,
      steps: [],
      observations: [],
      todos: [],
      awaitUserFeedback: false,
      pauseReason: null,
      phase: CodeSearchPhase.PLANNING,
    };
    this.loopState = loopState;

    const phaseState = { status: CodeSearchPhase.PLANNING };

    const transitionPhase = (next, payload = {}) => {
      loopState.phase = this._transitionPhase(phaseState, next, {
        runId,
        emit,
        eventName: "codesearch.phase.transition",
        ...payload,
      });
    };

    const pauseForUserFeedback = async (reason) => {
      loopState.awaitUserFeedback = true;
      loopState.pauseReason = reason;
      if (this.loopStatus !== AgentStatus.PAUSED) {
        await this._transitionLoopStatus(AgentStatus.PAUSED, { runId, iteration: 0, reason });
      }
      const err = new StagePausedError("Run paused", { runId, reason });
      err.awaitUserFeedback = true;
      throw err;
    };

    if (!callModel) {
      await pauseForUserFeedback(PAUSE_REASON);
    }

    const addTodosFromInput = (items) => {
      const created = [];
      for (const item of Array.isArray(items) ? items : []) {
        const normalized = normalizeTodoInput(item);
        if (!normalized) continue;
        const row = createTodo(normalized);
        const { valid } = validateTodo(row);
        if (!valid) continue;
        loopState.todos.push(row);
        created.push(row);
      }
      return created;
    };

    // 初始 todo 规划
    try {
      checkStop(stageApi?.signal);
      const todoPrompt = CODESEARCH_TODO_PLANNER_PROMPT.replace("{QUERY}", query);
      const messages = [
        { role: "system", content: todoPrompt },
        { role: "user", content: query },
      ];

      const todoResponse = await callModel(messages, {
        model: "auto",
        temperature: 0.3,
        maxTokens: 700,
        signal: stageApi?.signal,
      });

      if (todoResponse?.usage) {
        budgetManager.recordUsage({
          input: todoResponse.usage.input || todoResponse.usage.prompt_tokens || 0,
          output: todoResponse.usage.output || todoResponse.usage.completion_tokens || 0,
        });
      }

      const planned = parseTodoPlannerOutput(todoResponse?.content || todoResponse?.text || "");
      const createdTodos = addTodosFromInput(planned);
      if (!createdTodos.length) {
        logger.warn("Todo planning failed: no valid todos", { stage: "codesearch" });
        await pauseForUserFeedback(PAUSE_REASON);
      }
      loopState.observations.push(`[Planning] Todos created (${createdTodos.length})\n${formatOpenTodos(loopState.todos)}`);
    } catch (err) {
      logger.warn("Todo planning failed", { stage: "codesearch", data: { error: err?.message || err } });
      await pauseForUserFeedback(PAUSE_REASON);
    }

    transitionPhase(CodeSearchPhase.EXECUTING);

    // 系统 prompt
    const systemPrompt = CODESEARCH_SYSTEM_PROMPT.replace("{TOOLS}", formatToolDefinitionsForLLM());

    let step = 0;
    let done = false;
    let aborted = false;

    while (!done && step < this.maxSteps) {
      const openTodos = loopState.todos.filter(isTodoOpen);
      if (!openTodos.length) {
        done = true;
        break;
      }

      step++;
      const { step: stepMeta, context: stepContext } = this._beginStep(
        { name: "codesearch.step", runId, iteration: step },
        stageApi
      );
      const stepSignal = stepContext.signal;

      try {
        checkStop(stepSignal);
        await this._transitionLoopStatus(AgentStatus.RUNNING, { runId, iteration: step, stepId: stepMeta.stepId });
        await this._transitionLoopStatus(AgentStatus.RUNNING, { runId, iteration: step, stepId: stepMeta.stepId });

        logger.info(`Step ${step}`, { stage: "codesearch", data: { step } });
        emit?.("codesearch.step.started", { step, total: this.maxSteps });

        const { text: userNotes } = this.drainUserInputsAsText();

        // 构建当前 prompt
        const basePrompt = CODESEARCH_STEP_PROMPT
          .replace("{QUERY}", query)
          .replace("{STEP}", String(step))
          .replace("{MAX_STEPS}", String(this.maxSteps))
          .replace("{OPEN_TODOS}", formatOpenTodos(openTodos))
          .replace("{OBSERVATIONS}", loopState.observations.slice(-10).join("\n\n---\n\n") || "(无)");
        const stepPrompt = userNotes
          ? `${basePrompt}\n\n用户意见:\n${userNotes}`
          : basePrompt;

        // 调用 LLM 决定下一步
        let llmResponse;
        try {
          const messages = [
            { role: "system", content: systemPrompt },
            { role: "user", content: stepPrompt },
          ];

          llmResponse = await callModel(messages, {
            model: "auto",
            temperature: 0.3,
            maxTokens: 1000,
            signal: stepSignal,
          });

          // 记录 token 消耗
          if (llmResponse?.usage) {
            budgetManager.recordUsage({
              input: llmResponse.usage.input || llmResponse.usage.prompt_tokens || 0,
              output: llmResponse.usage.output || llmResponse.usage.completion_tokens || 0,
            });
          }
        } catch (err) {
          const pauseLike = this._shouldPauseFromError(err, stepSignal);
          const message = err instanceof Error ? err.message : String(err);
          this._endStep({ step: stepMeta }, { status: pauseLike ? "paused" : "failed", error: message });
          if (pauseLike) {
            if (this.loopStatus !== AgentStatus.PAUSED) {
              await this._transitionLoopStatus(AgentStatus.PAUSED, {
                runId,
                iteration: step,
                stepId: stepMeta.stepId,
                reason: message,
              });
            }
            throw this._createPauseError({ signal: stepSignal, runId });
          }
          logger.error("LLM call failed", { stage: "codesearch", data: { error: message } });
          emit?.("codesearch.step.failed", { step, error: message });
          aborted = true;
          await this._transitionLoopStatus(AgentStatus.FAILED, {
            runId,
            iteration: step,
            stepId: stepMeta.stepId,
            error: message,
          });
          break;
        }

        const responseText = llmResponse?.content || llmResponse?.text || "";

        // 解析 action
        const decision = parseStepDecision(responseText);
        const hasNewTodos = Array.isArray(decision?.newTodos) && decision.newTodos.length > 0;
        let actionName = toNonEmptyString(decision?.action);
        if (!actionName && hasNewTodos) actionName = "add_todo";

        if (!decision || (!decision.done && !actionName && !hasNewTodos)) {
          logger.warn("Failed to parse action", { stage: "codesearch", data: { response: responseText.slice(0, 200) } });
          loopState.observations.push(`[Step ${step}] Failed to parse LLM response`);
          await this._transitionLoopStatus(AgentStatus.RUNNING, { runId, iteration: step, stepId: stepMeta.stepId });
          this._endStep({ step: stepMeta }, { status: "failed", error: "parse_failed" });
          continue;
        }

        const createdTodos = hasNewTodos ? addTodosFromInput(decision.newTodos) : [];
        if (createdTodos.length) {
          loopState.observations.push(`[Step ${step}] Added todos (${createdTodos.length})`);
        }

        // 检查是否完成
        if (decision.done) {
          const selectedTodo = resolveTodoSelection(decision, openTodos);
          if (selectedTodo) {
            const finalStatus = decision.todoStatus || (decision.completeTodo ? TodoStatus.COMPLETED : "");
            if (finalStatus) transitionTodoStatus(selectedTodo, finalStatus);
          }
          done = true;
          loopState.finalThought = decision.thought || responseText;
          emit?.("codesearch.step.completed", { step, action: "done" });
          await this._transitionLoopStatus(AgentStatus.RUNNING, { runId, iteration: step, stepId: stepMeta.stepId });
          this._endStep({ step: stepMeta }, { status: "completed" });
          break;
        }

        if (actionName === "add_todo") {
          loopState.steps.push({
            step,
            tool: "add_todo",
            args: {},
            result: { createdTodos },
            todoId: null,
          });
          emit?.("codesearch.step.completed", { step, action: "add_todo", createdTodos: createdTodos.length });
          await this._transitionLoopStatus(AgentStatus.RUNNING, { runId, iteration: step, stepId: stepMeta.stepId });
          this._endStep({ step: stepMeta }, { status: "completed" });
          continue;
        }

        const selectedTodo = resolveTodoSelection(decision, openTodos);
        if (selectedTodo && normalizeTodoStatus(selectedTodo.status) === TodoStatus.OPEN) {
          transitionTodoStatus(selectedTodo, TodoStatus.PENDING);
        }

        if (!actionName) {
          loopState.observations.push(`[Step ${step}] Missing tool action in LLM response`);
          await this._transitionLoopStatus(AgentStatus.RUNNING, { runId, iteration: step, stepId: stepMeta.stepId });
          this._endStep({ step: stepMeta }, { status: "failed", error: "missing_action" });
          continue;
        }

        await this._transitionLoopStatus(AgentStatus.RUNNING, { runId, iteration: step, stepId: stepMeta.stepId });

        // 执行工具
        const toolName = actionName;
        const toolArgs = decision.args || {};

        logger.info(`Executing tool: ${toolName}`, { stage: "codesearch", data: { toolName, args: toolArgs } });

        let result;
        try {
          result = await tools.execute(toolName, toolArgs);
        } catch (err) {
          result = { error: err.message };
        }

        // 格式化结果
        const formattedResult = formatToolResult(toolName, result);
        const todoLabel = selectedTodo ? `[todo ${selectedTodo.todoId}]` : "[todo none]";
        loopState.observations.push(`[Step ${step}] ${todoLabel} ${formattedResult}`);
        loopState.steps.push({
          step,
          tool: toolName,
          args: toolArgs,
          result,
          todoId: selectedTodo?.todoId || null,
        });

        const nextStatus = decision.todoStatus || (decision.completeTodo ? TodoStatus.COMPLETED : "");
        if (selectedTodo && nextStatus) {
          transitionTodoStatus(selectedTodo, nextStatus);
        }

        emit?.("codesearch.step.completed", {
          step,
          tool: toolName,
          args: toolArgs,
          resultSummary: result.error || `${toolName} completed`,
        });

        await this._transitionLoopStatus(AgentStatus.RUNNING, { runId, iteration: step, stepId: stepMeta.stepId });
        this._endStep({ step: stepMeta }, { status: "completed" });
      } catch (err) {
        if (err instanceof StagePausedError) {
          throw err;
        }
        const pauseLike = this._shouldPauseFromError(err, stepSignal);
        if (pauseLike) {
          this._endStep({ step: stepMeta }, { status: "paused", error: err?.message });
          if (this.loopStatus !== AgentStatus.PAUSED) {
            await this._transitionLoopStatus(AgentStatus.PAUSED, {
              runId,
              iteration: step,
              stepId: stepMeta.stepId,
              reason: err?.message,
            });
          }
          throw this._createPauseError({ signal: stepSignal, runId });
        }
        this._endStep({ step: stepMeta }, { status: "failed", error: err?.message });
        aborted = true;
        if (this.loopStatus !== AgentStatus.FAILED) {
          await this._transitionLoopStatus(AgentStatus.FAILED, {
            runId,
            iteration: step,
            stepId: stepMeta.stepId,
            error: err?.message,
          });
        }
        throw err;
      }
    }

    transitionPhase(CodeSearchPhase.SUMMARIZING);

    // 生成最终总结
    logger.info("Generating summary", { stage: "codesearch" });
    emit?.("codesearch.summarizing", { steps: step });

    let summary;
    try {
      const summarizePrompt = CODESEARCH_SUMMARIZE_PROMPT
        .replace("{QUERY}", query)
        .replace("{OBSERVATIONS}", loopState.observations.join("\n\n---\n\n"));

      const messages = [
        { role: "system", content: "你是代码分析专家。根据探索结果生成结构化的分析报告。使用 Markdown 格式，包含 Mermaid 架构图。" },
        { role: "user", content: summarizePrompt },
      ];

      const summaryResponse = await callModel(messages, {
        model: "auto",
        temperature: 0.3,
        maxTokens: 2000,
      });

      if (summaryResponse?.usage) {
        budgetManager.recordUsage({
          input: summaryResponse.usage.input || summaryResponse.usage.prompt_tokens || 0,
          output: summaryResponse.usage.output || summaryResponse.usage.completion_tokens || 0,
        });
      }

      summary = summaryResponse?.content || summaryResponse?.text || loopState.finalThought || "分析完成";
    } catch (err) {
      logger.error("Summary generation failed", { stage: "codesearch", data: { error: err.message } });
      summary = loopState.finalThought || `分析完成，共 ${step} 步`;
    }

    const todoCompletionStats = buildTodoCompletionStats(loopState.todos);

    const result = {
      query,
      summary,
      steps: loopState.steps,
      totalSteps: step,
      budgetUsage: budgetManager.getStats(),
      todos: loopState.todos,
      todoCompletionStats,
      awaitUserFeedback: loopState.awaitUserFeedback,
    };

    logger.info("CodeSearch completed", { stage: "codesearch", data: { totalSteps: step } });
    emit?.("codesearch.completed", { totalSteps: step });
    if (!aborted) {
      transitionPhase(CodeSearchPhase.COMPLETED);
      this._transitionLoopStatus(AgentStatus.COMPLETED, { runId, iteration: step });
    }

    return result;
  }

  async execute(runContext, input, stageApi = {}) {
    return super.execute(runContext, input, stageApi);
  }

  async _getDefaultFs() {
    try {
      const { readFile, readdir, stat } = await import("node:fs/promises");
      return { readFile, readdir, stat };
    } catch {
      return null;
    }
  }
}

/**
 * 便捷函数：注册到 Orchestrator
 */
export async function runCodeSearchStage(runContext, input, stageApi = {}) {
  const stage = new CodeSearchStage(input?.options);
  return stage.execute(runContext, input, stageApi);
}

/**
 * 注册所有 CodeSearch stages
 */
export function registerCodeSearchStages(orchestrator, { timeoutMs = 120_000 } = {}) {
  orchestrator.registerStage("codesearch.pipeline", runCodeSearchStage, {
    actor: "codesearch",
    timeoutMs,
  });
}
