/**
 * CodeSearch Summarizing Phase
 *
 * 职责：
 * - 生成最终总结报告
 * - 汇总 Todo 完成状态
 */

import { createLogger } from "../../../shared/index.js";
import { checkCancelled } from "../../../shared/index.js";
import { TodoStatus } from "../states.js";
import { CODESEARCH_SUMMARIZE_PROMPT } from "../prompts.js";

const logger = createLogger("stages/codesearch/phases/summarizing-phase");

/**
 * 构建 Todo 完成统计
 *
 * @typedef {object} CodeSearchTodoLike
 * @property {string=} todoId
 * @property {string=} status
 *
 * @typedef {object} CodeSearchStateLike
 * @property {string=} query
 * @property {string=} taskGoal
 * @property {string[]} observations
 * @property {any[]} steps
 * @property {CodeSearchTodoLike[]} todos
 * @property {string|null=} finalThought
 * @property {any=} budgetUsage
 *
 * @typedef {object} BudgetManagerLike
 * @property {(usage: { input: number, output: number }) => void=} recordUsage
 * @property {() => any=} getStats
 *
 * @typedef {(eventName: string, payload: any) => void} EmitFn
 *
 * @typedef {(messages: Array<{ role: string, content: string }>, options?: any) => Promise<any>} CallModelFn
 *
 * @typedef {object} TodoCompletionStats
 * @property {number} total
 * @property {number} completed
 * @property {number} cancelled
 * @property {number} open
 *
 * @typedef {object} RunSummarizingPhaseArgs
 * @property {CodeSearchStateLike} state
 * @property {CallModelFn} callModel
 * @property {BudgetManagerLike=} budgetManager
 * @property {EmitFn=} emit
 * @property {AbortSignal|null=} signal
 *
 * @typedef {object} SummarizingPhaseResult
 * @property {string} summary
 * @property {TodoCompletionStats} todoStats
 * @property {any} budgetUsage
 *
 * @param {CodeSearchTodoLike[]|null|undefined} todos
 * @returns {TodoCompletionStats}
 */
export function buildTodoCompletionStats(todos) {
  const rows = Array.isArray(todos) ? todos : [];
  const completed = rows.filter((t) => t?.status === TodoStatus.COMPLETED).length;
  const cancelled = rows.filter((t) => t?.status === TodoStatus.CANCELLED).length;
  return { total: rows.length, completed, cancelled, open: rows.length - completed - cancelled };
}

/**
 * 运行总结阶段
 * @param {RunSummarizingPhaseArgs} args
 * @returns {Promise<SummarizingPhaseResult>}
 */
export async function runSummarizingPhase({
  state,
  callModel,
  budgetManager,
  emit,
  signal,
}) {
  checkCancelled(signal);

  logger.info("Starting summarizing phase");
  emit?.("codesearch:summarizing_started", { steps: state.steps.length });

  const query = state.query || state.taskGoal || "";
  const observations = state.observations.join("\n\n---\n\n");

  const summarizePrompt = CODESEARCH_SUMMARIZE_PROMPT
    .replace("{QUERY}", query)
    .replace("{OBSERVATIONS}", observations);

  const messages = [
    { role: "system", content: "你是代码分析专家。根据探索结果生成结构化的分析报告。使用 Markdown 格式，包含 Mermaid 架构图。" },
    { role: "user", content: summarizePrompt },
  ];

  let summary;
  try {
    const response = await callModel(messages, {
      model: "auto",
      temperature: 0.3,
      maxTokens: 2000,
      signal,
    });

    if (response?.usage && budgetManager) {
      budgetManager.recordUsage({
        input: response.usage.input || response.usage.prompt_tokens || 0,
        output: response.usage.output || response.usage.completion_tokens || 0,
      });
    }

    summary = response?.content || response?.text || state.finalThought || "分析完成";
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err ?? "Unknown error");
    logger.error("Summary generation failed", { error: errorMsg });
    summary = state.finalThought || `分析完成，共 ${state.steps.length} 步`;
  }

  const todoStats = buildTodoCompletionStats(state.todos);
  state.budgetUsage = budgetManager?.getStats?.() || null;

  emit?.("codesearch:summarizing_completed", { todoStats });
  logger.info("Summarizing phase completed", { todoStats });

  return {
    summary,
    todoStats,
    budgetUsage: state.budgetUsage,
  };
}
