/**
 * DeepSearch Stage - 兼容层
 *
 * 将旧 API (runDeepSearchStage, DeepSearchStage, registerDeepSearchStages)
 * 映射到新的 DeepSearchAgentLoop 架构
 */

import { BaseStage } from "../../runtime/agent-loop.js";
import DeepSearchAgentLoop from "./deepsearch-agent-loop.js";
import { DeepSearchState, validateIteration } from "./state.js";
import { __test as trajectoryTest } from "./trajectory.js";
import { runDeepSearchScanStage } from "./scan.js";
import { runDeepSearchTodosStage } from "./todos.js";
import { runDeepSearchRetrieveStage } from "./retrieve.js";
import { runDeepSearchUnderstandStage } from "./understand.js";
import { runDeepSearchWriteStage } from "./write.js";
import { runDeepSearchCondenseStage } from "./condense.js";
import { isPlainObject, safeInt } from "../../shared/value-utils.js";

/**
 * 判断是否应该继续迭代
 * @deprecated 使用 DeepSearchAgentLoop 的内部逻辑
 */
export function shouldContinue(state, roundResult) {
  if (!state || typeof state !== "object") return false;
  const iteration = state.iteration || 0;
  const maxIterations = state.maxIterations || 5;
  if (iteration >= maxIterations) return false;

  const gaps = Array.isArray(state?.L1?.gaps) ? state.L1.gaps : [];
  const openGaps = gaps.filter(g => g?.status === "open" || !g?.status);
  if (openGaps.length === 0 && state?.L1?.report) return false;

  return true;
}

function ensureState(runContext, input) {
  if (input instanceof DeepSearchState) return input;
  if (input?.state instanceof DeepSearchState) return input.state;
  if (isPlainObject(input?.state)) return DeepSearchState.fromJSON(input.state);

  const sources = Array.isArray(input?.sources) ? input.sources : [];
  const assets = Array.isArray(input?.assets) ? input.assets : [];
  const taskGoal = typeof input?.taskGoal === "string" ? input.taskGoal : "";
  const userConfig = isPlainObject(input?.userConfig) ? input.userConfig : {};
  const s = new DeepSearchState({ runId: runContext?.runId, taskGoal, userConfig, L0: { sources, assets } });
  const maxIt = safeInt(userConfig?.maxIterations);
  if (maxIt !== null && maxIt >= 1) s.maxIterations = maxIt;
  return s;
}

/**
 * DeepSearchStage - BaseStage 兼容包装
 * @deprecated 使用 DeepSearchAgentLoop
 */
export class DeepSearchStage extends BaseStage {
  constructor(options = {}) {
    super({ name: "deepsearch.pipeline", ...options });
    this._agentLoop = new DeepSearchAgentLoop(options);
  }

  async run(input, stageApi = {}) {
    const runContext = stageApi?.runContext || {};
    return this._agentLoop.execute(runContext, input, stageApi);
  }
}

/**
 * 运行 DeepSearch 阶段
 * @deprecated 使用 runDeepSearchAgentLoop
 */
export async function runDeepSearchStage(runContext, input, stageApi = {}) {
  const stage = new DeepSearchStage();
  return stage.execute(runContext, input, stageApi);
}

/**
 * 注册 DeepSearch 阶段到 orchestrator
 * @deprecated 使用 DeepSearchAgentLoop 直接
 */
export function registerDeepSearchStages(orchestrator, { timeoutMs = 30_000 } = {}) {
  if (!orchestrator || typeof orchestrator.registerStage !== "function") {
    throw new TypeError("registerDeepSearchStages: orchestrator must have registerStage method");
  }

  orchestrator.registerStage("deepsearch.scan", runDeepSearchScanStage, { actor: "deepsearch", timeoutMs });
  orchestrator.registerStage("deepsearch.todos", runDeepSearchTodosStage, { actor: "deepsearch", timeoutMs });
  orchestrator.registerStage("deepsearch.gaps", runDeepSearchTodosStage, { actor: "deepsearch", timeoutMs });
  orchestrator.registerStage("deepsearch.retrieve", runDeepSearchRetrieveStage, { actor: "deepsearch", timeoutMs });
  orchestrator.registerStage("deepsearch.understand", runDeepSearchUnderstandStage, { actor: "deepsearch", timeoutMs });
  orchestrator.registerStage("deepsearch.write", runDeepSearchWriteStage, { actor: "deepsearch", timeoutMs });
  orchestrator.registerStage("deepsearch.condense", runDeepSearchCondenseStage, { actor: "deepsearch", timeoutMs });
  orchestrator.registerStage("deepsearch.pipeline", runDeepSearchStage, { actor: "deepsearch", timeoutMs });
}

export { runDeepSearchTodosStage };
export const runDeepSearchGapsStage = runDeepSearchTodosStage;

/**
 * 测试辅助导出
 * @internal
 */
export const __test = {
  DeepSearchAgentLoop,
  DeepSearchState,
  ensureState,
  shouldContinue,
  validateIteration,
  signatureForRetrievedChunk: trajectoryTest.signatureForRetrievedChunk,
};

export default DeepSearchStage;
