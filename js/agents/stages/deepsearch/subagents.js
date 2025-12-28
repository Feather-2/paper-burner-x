/**
 * DeepSearch 子代理注册
 *
 * 注册可被 Task skill 调用的子代理类型
 */

import { globalSubagentRegistry } from "../../sdk/SubagentRegistry.js";
import { DeepSearchAgentLoop } from "./deepsearch-agent-loop.js";
import { EventBus } from "../../runtime/events/event-bus.js";

/**
 * 创建轻量级研究子代理
 */
function createResearcherFactory() {
  return async ({ prompt, inheritedContext, modelTier = "fast", parentStageApi }) => {
    const eventBus = new EventBus();
    const agent = new DeepSearchAgentLoop({
      maxIterations: 10,
      eventBus,
      sharedContext: inheritedContext?.sharedContext,
    });

    return {
      run: async (input, ctx) => {
        // 合并父级 stageApi（继承 modelRouter）
        const mergedStageApi = {
          ...parentStageApi,
          ...ctx?.stageApi,
          eventBus,
          modelTier,
          signal: ctx?.signal || parentStageApi?.signal,
        };

        const result = await agent.run(
          {
            taskGoal: prompt,
            L0: inheritedContext?.L0 || input.L0,
            userConfig: { maxIterations: 10 },
          },
          { stageApi: mergedStageApi }
        );
        return {
          ok: true,
          summary: result.report?.slice(0, 500) || "Research completed",
          report: result.report,
          findings: result.findings,
        };
      },
    };
  };
}

/**
 * 创建分析子代理（更深入，迭代更多）
 */
function createAnalyzerFactory() {
  return async ({ prompt, inheritedContext, modelTier = "normal", parentStageApi }) => {
    const eventBus = new EventBus();
    const agent = new DeepSearchAgentLoop({
      maxIterations: 15,
      eventBus,
      sharedContext: inheritedContext?.sharedContext,
    });

    return {
      run: async (input, ctx) => {
        // 合并父级 stageApi（继承 modelRouter）
        const mergedStageApi = {
          ...parentStageApi,
          ...ctx?.stageApi,
          eventBus,
          modelTier,
          signal: ctx?.signal || parentStageApi?.signal,
        };

        const result = await agent.run(
          {
            taskGoal: prompt,
            L0: inheritedContext?.L0 || input.L0,
            userConfig: { maxIterations: 15 },
          },
          { stageApi: mergedStageApi }
        );
        return {
          ok: true,
          summary: result.report?.slice(0, 500) || "Analysis completed",
          report: result.report,
          analysis: result.analysis,
        };
      },
    };
  };
}

/**
 * 注册所有 DeepSearch 子代理
 */
export function registerDeepSearchSubagents(registry = globalSubagentRegistry) {
  registry.register(
    "researcher",
    createResearcherFactory(),
    "专项文档研究，快速提取关键信息（10轮迭代）"
  );

  registry.register(
    "analyzer",
    createAnalyzerFactory(),
    "深度分析，适合复杂问题（15轮迭代）"
  );
}

// 自动注册
registerDeepSearchSubagents();

export { globalSubagentRegistry };
