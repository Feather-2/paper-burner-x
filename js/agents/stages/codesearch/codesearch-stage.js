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
import { CODESEARCH_SYSTEM_PROMPT, CODESEARCH_STEP_PROMPT, CODESEARCH_SUMMARIZE_PROMPT } from "./prompts.js";

// 复用 DeepSearch 基础设施
import { createBudgetManager, BudgetAction } from "../deepsearch/budget.js";
import { checkCancelled, makeStageEmitter } from "../deepsearch/state.js";
import { createLogger } from "../deepsearch/logger.js";
import { getModelCaller } from "../deepsearch/model.js";
import { isPlainObject, toNonEmptyString } from "../../shared/value-utils.js";

const DEFAULT_MAX_STEPS = 20;
const DEFAULT_TIMEOUT_MS = 120_000; // 2 分钟

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

export class CodeSearchStage {
  constructor(options = {}) {
    this.maxSteps = options.maxSteps || DEFAULT_MAX_STEPS;
    this.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
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
  async execute(runContext, input, stageApi = {}) {
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
    const checkStop = () => {
      checkCancelled(stageApi);
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
    if (!callModel) {
      throw new Error("CodeSearch: No LLM model available. Provide stageApi.modelRouter or stageApi.aiApiService.");
    }

    logger.info("CodeSearch started", { stage: "codesearch", data: { query, maxSteps: this.maxSteps } });
    emit?.("codesearch.started", { query, maxSteps: this.maxSteps });

    // Agent Loop 上下文
    const context = {
      query,
      steps: [],
      observations: [],
    };

    // 系统 prompt
    const systemPrompt = CODESEARCH_SYSTEM_PROMPT.replace("{TOOLS}", formatToolDefinitionsForLLM());

    let step = 0;
    let done = false;

    while (!done && step < this.maxSteps) {
      checkStop();
      step++;

      logger.info(`Step ${step}`, { stage: "codesearch", data: { step } });
      emit?.("codesearch.step.started", { step, total: this.maxSteps });

      // 构建当前 prompt
      const stepPrompt = CODESEARCH_STEP_PROMPT
        .replace("{QUERY}", query)
        .replace("{STEP}", String(step))
        .replace("{MAX_STEPS}", String(this.maxSteps))
        .replace("{OBSERVATIONS}", context.observations.slice(-10).join("\n\n---\n\n") || "(无)");

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
        });

        // 记录 token 消耗
        if (llmResponse?.usage) {
          budgetManager.recordUsage({
            input: llmResponse.usage.input || llmResponse.usage.prompt_tokens || 0,
            output: llmResponse.usage.output || llmResponse.usage.completion_tokens || 0,
          });
        }
      } catch (err) {
        logger.error("LLM call failed", { stage: "codesearch", data: { error: err.message } });
        emit?.("codesearch.step.failed", { step, error: err.message });
        break;
      }

      const responseText = llmResponse?.content || llmResponse?.text || "";

      // 解析 action
      const action = parseAction(responseText);

      if (!action) {
        logger.warn("Failed to parse action", { stage: "codesearch", data: { response: responseText.slice(0, 200) } });
        context.observations.push(`[Step ${step}] Failed to parse LLM response`);
        continue;
      }

      // 检查是否完成
      if (action.action === "done" || action.done) {
        done = true;
        context.finalThought = action.thought || action.summary || responseText;
        emit?.("codesearch.step.completed", { step, action: "done" });
        break;
      }

      // 执行工具
      const toolName = action.action || action.tool;
      const toolArgs = action.args || {};

      logger.info(`Executing tool: ${toolName}`, { stage: "codesearch", data: { toolName, args: toolArgs } });

      let result;
      try {
        result = await tools.execute(toolName, toolArgs);
      } catch (err) {
        result = { error: err.message };
      }

      // 格式化结果
      const formattedResult = formatToolResult(toolName, result);
      context.observations.push(`[Step ${step}] ${formattedResult}`);
      context.steps.push({ step, tool: toolName, args: toolArgs, result });

      emit?.("codesearch.step.completed", {
        step,
        tool: toolName,
        args: toolArgs,
        resultSummary: result.error || `${toolName} completed`,
      });
    }

    // 生成最终总结
    logger.info("Generating summary", { stage: "codesearch" });
    emit?.("codesearch.summarizing", { steps: step });

    let summary;
    try {
      const summarizePrompt = CODESEARCH_SUMMARIZE_PROMPT
        .replace("{QUERY}", query)
        .replace("{OBSERVATIONS}", context.observations.join("\n\n---\n\n"));

      const messages = [
        { role: "system", content: "你是代码分析专家。根据探索结果生成结构化的分析报告。使用 Markdown 格式，包含 Mermaid 架构图。" },
        { role: "user", content: summarizePrompt },
      ];

      const summaryResponse = await callModel(messages, {
        model: "auto",
        temperature: 0.3,
        maxTokens: 2000,
      });

      summary = summaryResponse?.content || summaryResponse?.text || context.finalThought || "分析完成";
    } catch (err) {
      logger.error("Summary generation failed", { stage: "codesearch", data: { error: err.message } });
      summary = context.finalThought || `分析完成，共 ${step} 步`;
    }

    const result = {
      query,
      summary,
      steps: context.steps,
      totalSteps: step,
      budgetUsage: budgetManager.getStats(),
    };

    logger.info("CodeSearch completed", { stage: "codesearch", data: { totalSteps: step } });
    emit?.("codesearch.completed", { totalSteps: step });

    return result;
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
