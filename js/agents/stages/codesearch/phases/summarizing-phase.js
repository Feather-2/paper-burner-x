/**
 * CodeSearch Summarizing Phase
 *
 * 职责：
 * - 生成最终总结报告
 * - 汇总 Todo 完成状态
 */

import { createLogger } from "../../../shared/utils/logger.js";
import { checkCancelled } from "../../../shared/utils/cancellation.js";
import { TodoStatus } from "../states.js";
import { CODESEARCH_SUMMARIZE_PROMPT } from "../prompts.js";

const logger = createLogger("stages/codesearch/phases/summarizing-phase");

/**
 * 构建 Todo 完成统计
 */
export function buildTodoCompletionStats(todos) {
  const rows = Array.isArray(todos) ? todos : [];
  const completed = rows.filter((t) => t?.status === TodoStatus.COMPLETED).length;
  const cancelled = rows.filter((t) => t?.status === TodoStatus.CANCELLED).length;
  return { total: rows.length, completed, cancelled, open: rows.length - completed - cancelled };
}

/**
 * 运行总结阶段
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
  emit?.("codesearch.summarizing.started", { steps: state.steps.length });

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
    logger.error("Summary generation failed", { error: err.message });
    summary = state.finalThought || `分析完成，共 ${state.steps.length} 步`;
  }

  const todoStats = buildTodoCompletionStats(state.todos);
  state.budgetUsage = budgetManager?.getStats?.() || null;

  emit?.("codesearch.summarizing.completed", { todoStats });
  logger.info("Summarizing phase completed", { todoStats });

  return {
    summary,
    todoStats,
    budgetUsage: state.budgetUsage,
  };
}
