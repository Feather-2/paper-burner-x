/**
 * DeepSearch Stage - 简化入口
 *
 * 使用 Skills-based Agent Loop 架构
 */

import DeepSearchAgentLoop, { AgentStatus } from "./deepsearch-agent-loop.js";
import { DeepSearchState } from "./state.js";
import { runDeepSearchTodosStage } from "./todos.js";
import { skills, executeSkill, getSkillCatalogPrompt } from "./skills/index.js";
import { isPlainObject, safeInt } from "../../shared/utils/value-utils.js";

/**
 * 创建状态对象
 */
function ensureState(runContext, input) {
  if (input instanceof DeepSearchState) return input;
  if (input?.state instanceof DeepSearchState) return input.state;
  if (isPlainObject(input?.state)) return DeepSearchState.fromJSON(input.state);

  const sources = Array.isArray(input?.sources) ? input.sources : [];
  const assets = Array.isArray(input?.assets) ? input.assets : [];
  const taskGoal = typeof input?.taskGoal === "string" ? input.taskGoal : "";
  const userConfig = isPlainObject(input?.userConfig) ? input.userConfig : {};

  return new DeepSearchState({
    runId: runContext?.runId,
    taskGoal,
    userConfig,
    L0: { sources, assets },
  });
}

/**
 * 运行 DeepSearch Agent
 */
export async function runDeepSearchAgent(runContext, input, stageApi = {}) {
  const agent = new DeepSearchAgentLoop({
    eventBus: stageApi.eventBus,
    maxIterations: input?.userConfig?.maxIterations || 20,
  });

  return agent.run(input, { stageApi, runContext });
}

/**
 * 兼容旧 API
 * @deprecated 使用 runDeepSearchAgent
 */
export async function runDeepSearchStage(runContext, input, stageApi = {}) {
  return runDeepSearchAgent(runContext, input, stageApi);
}

// 导出
export {
  DeepSearchAgentLoop,
  DeepSearchState,
  AgentStatus,
  runDeepSearchTodosStage,
  skills,
  executeSkill,
  getSkillCatalogPrompt,
  ensureState,
};

export default DeepSearchAgentLoop;
