/**
 * DeepSearch Planning Phase
 *
 * Responsibilities:
 * - Build system prompt (tools + optional skills catalog)
 * - Inject ephemeral context (shadow, blackboard, memory, budget, convergence, reminders)
 * - Call model + parse decisions (via ModelResponseHandler)
 */

import { isPlainObject, toNonNegativeInt, toPositiveInt } from "../../../shared/index.js";
import { DeepSearchEvents } from "../../../runtime/index.js";
import {
  DEFAULT_MODEL_TIMEOUT_MS,
  MAX_TASK_GOAL_LEN,
  buildEphemeralMessages,
  buildSkillsPrompt,
  createModelSignal,
  getSystemPrompt,
  logSuppressedError,
  resolveModeDescription,
  sanitizePromptInput,
} from "./planning-phase-helpers.js";

/**
 * @typedef {"system"|"user"|"assistant"} DeepSearchChatRole
 *
 * @typedef {object} DeepSearchChatMessage
 * @property {DeepSearchChatRole | string} role
 * @property {any} content
 *
 * @typedef {object} DeepSearchModelCallOptions
 * @property {number=} temperature
 * @property {number=} maxTokens
 * @property {AbortSignal=} signal
 *
 * @typedef {object} DeepSearchModelResponse
 * @property {string=} content
 * @property {any=} usage
 *
 * @typedef {(messages: DeepSearchChatMessage[], options: DeepSearchModelCallOptions) => Promise<DeepSearchModelResponse>} DeepSearchCallModel
 *
 * @typedef {object} DeepSearchToolAction
 * @property {string} action
 * @property {Record<string, any>=} args
 *
 * @typedef {object} DeepSearchDecision
 * @property {string=} thought
 * @property {string=} action
 * @property {Record<string, any>=} args
 * @property {DeepSearchToolAction[]=} actions
 *
 * @typedef {object} DeepSearchGapsConfig
 * @property {number=} maxFindingGaps
 * @property {number=} maxGapFindings
 * @property {number=} maxGaps
 * @property {number=} gapOnlyStreakLimit
 * @property {number=} maxGapOnlyIterations
 * @property {number=} gapOnlyLimit
 * @property {number=} noProgressStreakLimit
 * @property {number=} maxNoProgressIterations
 * @property {number=} stagnationLimit
 *
 * @typedef {object} DeepSearchUserConfig
 * @property {DeepSearchGapsConfig=} gaps
 * @property {{ includeCatalog?: boolean }=} skills
 *
 * @typedef {object} DeepSearchState
 * @property {DeepSearchUserConfig=} userConfig
 *
 * @typedef {object} DeepSearchGapConvergencePolicy
 * @property {number} maxFindingGaps
 * @property {number} gapOnlyStreakLimit
 * @property {number} noProgressStreakLimit
 *
 * @typedef {object} AddInitialDeepSearchMessagesParams
 * @property {any} agent
 * @property {any} stageApi
 * @property {Function=} SkillsManager
 * @property {string=} modeDescription
 *
 * @typedef {object} DeepSearchConvergenceState
 * @property {number} lastClaimCount
 * @property {number} lastGapFindingCount
 * @property {number} lastOpenTodoCount
 * @property {number} lastCompletedTodoCount
 * @property {number} gapOnlyStreak
 * @property {number} noProgressStreak
 *
 * @typedef {object} IterationConvergenceTracker
 * @property {DeepSearchGapConvergencePolicy} convergencePolicy
 * @property {DeepSearchConvergenceState} convergence
 * @property {() => void} initBaselines
 * @property {(plannedIteration: number) => void} emitIterationCompleted
 *
 * @typedef {object} CreateIterationConvergenceTrackerParams
 * @property {any} agent
 * @property {DeepSearchGapConvergencePolicy} convergencePolicy
 *
 * @typedef {"success"|"retry"|"skip"|"stop"} PlanningIterationStatus
 *
 * @typedef {object} PlanningIterationResult
 * @property {PlanningIterationStatus} status
 * @property {DeepSearchDecision=} decision
 * @property {string=} content
 * @property {string=} reason
 *
 * @typedef {object} DeepSearchResponseHandler
 * @property {number} retryCount
 * @property {number} maxRetries
 * @property {(response: DeepSearchModelResponse, options: { stageApi: any, addMessage: (msg: DeepSearchChatMessage) => void, budget: any }) => Promise<PlanningIterationResult>} handleResponse
 *
 * @typedef {object} RunPlanningPhaseIterationParams
 * @property {any} agent
 * @property {any} stageApi
 * @property {any} context
 * @property {DeepSearchCallModel} callModel
 * @property {DeepSearchResponseHandler} responseHandler
 * @property {number} iteration
 * @property {number} toolCallCount
 * @property {number} systemRetryCount
 * @property {number} maxSystemRetriesPerIteration
 * @property {DeepSearchGapConvergencePolicy} convergencePolicy
 * @property {DeepSearchConvergenceState} convergence
 */

/**
 * 从 state.userConfig.gaps 推导 Gap 收敛策略配置。
 * @param {DeepSearchState} state
 * @returns {DeepSearchGapConvergencePolicy}
 */
export function getGapConvergencePolicy(state) {
  const cfg = isPlainObject(state?.userConfig?.gaps) ? state.userConfig.gaps : {};
  return {
    maxFindingGaps: toNonNegativeInt(cfg.maxFindingGaps ?? cfg.maxGapFindings ?? cfg.maxGaps, 50), // 0 disables cap
    gapOnlyStreakLimit: toPositiveInt(cfg.gapOnlyStreakLimit ?? cfg.maxGapOnlyIterations ?? cfg.gapOnlyLimit, 2),
    noProgressStreakLimit: toPositiveInt(cfg.noProgressStreakLimit ?? cfg.maxNoProgressIterations ?? cfg.stagnationLimit, 3),
  };
}

/**
 * 注入 DeepSearch 初始 system/user 消息（system prompt + 目标/预算等提示）。
 * @param {AddInitialDeepSearchMessagesParams} params
 * @returns {Promise<void>}
 */
export async function addInitialDeepSearchMessages({
  agent,
  stageApi,
  SkillsManager,
  modeDescription,
}) {
  const skillsPrompt = await buildSkillsPrompt({ agent, stageApi, SkillsManager });
  const systemPrompt = await getSystemPrompt({ skillsPrompt, config: agent.globalConfig, mode: agent.mode });
  agent.addMessage({ role: "system", content: systemPrompt });

  const sources = agent.state.L0?.sources || [];
  const taskGoal = sanitizePromptInput(agent.state?.taskGoal, "分析文档", MAX_TASK_GOAL_LEN);
  const modeDesc = resolveModeDescription(modeDescription, agent.mode);
  agent.addMessage({
    role: "user",
    content: `目标: ${taskGoal}
文档: ${sources.length} 个
模式: ${modeDesc}

## 研究预算
- 最大迭代: ${agent.maxIterations} 轮
- 工具调用上限: ${agent.maxToolCalls} 次
- 写作阶段: 第 ${agent.maxIterations - agent.writeIterations + 1} 轮开始（预留 ${agent.writeIterations} 轮写报告）

## 预算使用建议
- 前 ${Math.floor(agent.maxIterations * 0.6)} 轮: 收集信息、记录 findings（至少 5 条 claims）
- 中间 ${Math.floor(agent.maxIterations * 0.2)} 轮: 填补 gaps、交叉验证
- 最后 ${agent.writeIterations} 轮: 写报告、提交

请开始。`,
  });
}

/**
 * 创建“收敛追踪器”，用于统计每轮 claims/gaps/todos 变化并发出 completed 事件。
 * @param {CreateIterationConvergenceTrackerParams} params
 * @returns {IterationConvergenceTracker}
 */
export function createIterationConvergenceTracker({ agent, convergencePolicy }) {
  const convergence = {
    lastClaimCount: 0,
    lastGapFindingCount: 0,
    lastOpenTodoCount: 0,
    lastCompletedTodoCount: 0,
    gapOnlyStreak: 0,
    noProgressStreak: 0,
  };

  const getIterationMetrics = () => {
    const todos = Array.isArray(agent.context?.todos)
      ? agent.context.todos
      : Array.isArray(agent.state?.todos)
        ? agent.state.todos
        : [];
    const normalize = (value) => (typeof value === "string" ? value.trim().toLowerCase() : "");
    let completedTodoCount = 0;
    let blockedTodoCount = 0;
    for (const todo of todos) {
      const status = normalize(todo?.status);
      if (status === "completed" || status === "done") completedTodoCount += 1;
      else if (status === "cancelled" || status === "blocked") blockedTodoCount += 1;
    }
    const totalTodos = todos.length;
    const openTodoCount = Math.max(0, totalTodos - completedTodoCount - blockedTodoCount);

    const gaps = Array.isArray(agent.state?.L1?.gaps) ? agent.state.L1.gaps : [];
    let openGapCount = 0;
    for (const gap of gaps) {
      const status = normalize(gap?.status) || "open";
      if (status === "open") openGapCount += 1;
    }

    return { openTodoCount, completedTodoCount, blockedTodoCount, totalTodos, openGapCount };
  };

  const initBaselines = () => {
    try {
      const claimIds = agent.sharedContext?.search?.("finding_claim") || [];
      const gapIds = agent.sharedContext?.search?.("finding_gap") || [];
      const m = getIterationMetrics();
      convergence.lastClaimCount = claimIds.length;
      convergence.lastGapFindingCount = gapIds.length;
      convergence.lastOpenTodoCount = m.openTodoCount;
      convergence.lastCompletedTodoCount = m.completedTodoCount;
    } catch (err) {
      logSuppressedError(agent, "initBaselines", err);
    }
  };

  const emitIterationCompleted = (plannedIteration) => {
    const completedIteration = Number.isFinite(plannedIteration) ? plannedIteration - 1 : null;
    if (completedIteration === null || completedIteration < 0) return;
    const metrics = getIterationMetrics();
    const claimIds = agent.sharedContext?.search?.("finding_claim") || [];
    const gapIds = agent.sharedContext?.search?.("finding_gap") || [];
    const claimCount = claimIds.length;
    const gapFindingCount = gapIds.length;

    const claimDelta = claimCount - convergence.lastClaimCount;
    const gapDelta = gapFindingCount - convergence.lastGapFindingCount;
    const completedDelta = metrics.completedTodoCount - convergence.lastCompletedTodoCount;
    const openTodoDelta = metrics.openTodoCount - convergence.lastOpenTodoCount;

    const didProgress = claimDelta > 0 || completedDelta > 0 || openTodoDelta < 0;
    if (didProgress) convergence.noProgressStreak = 0;
    else convergence.noProgressStreak += 1;

    const gapOnly = gapDelta > 0 && claimDelta <= 0 && completedDelta <= 0 && openTodoDelta >= 0;
    if (gapOnly) convergence.gapOnlyStreak += 1;
    else convergence.gapOnlyStreak = 0;

    convergence.lastClaimCount = claimCount;
    convergence.lastGapFindingCount = gapFindingCount;
    convergence.lastOpenTodoCount = metrics.openTodoCount;
    convergence.lastCompletedTodoCount = metrics.completedTodoCount;

    const payload = {
      iteration: completedIteration,
      ...metrics,
      findingClaims: claimCount,
      findingGaps: gapFindingCount,
    };
    agent._emit?.("deepsearch.iteration.completed", payload, { status: "completed" });
    agent.eventBus?.emit?.("iteration.completed", { actor: "deepsearch", status: "completed", payload });
  };

  return { convergencePolicy, convergence, initBaselines, emitIterationCompleted };
}

/**
 * 运行单轮规划阶段：注入临时上下文、调用模型、并通过 responseHandler 解析决策。
 * @param {RunPlanningPhaseIterationParams} params
 * @returns {Promise<PlanningIterationResult>}
 */
export async function runPlanningPhaseIteration({
  agent,
  stageApi,
  context,
  callModel,
  responseHandler,
  iteration,
  toolCallCount,
  systemRetryCount,
  maxSystemRetriesPerIteration,
  convergencePolicy,
  convergence,
}) {
  const plannedIteration = iteration + 1;

  const contextStatus = agent.messageHandling?.getContextStatus?.() || {};
  const totalTokens = contextStatus.tokenUsage?.total || 0;
  const tokenPct = contextStatus.contextWindow
    ? Math.round((totalTokens / contextStatus.contextWindow) * 100)
    : 0;
  const compressFlag = contextStatus.needsCompression ? " [COMPRESS]" : "";
  const retryInfo =
    responseHandler.retryCount > 0 ? ` (retry ${responseHandler.retryCount}/${responseHandler.maxRetries})` : "";
  const systemRetryInfo =
    systemRetryCount > 0 ? ` (sys-retry ${systemRetryCount}/${maxSystemRetriesPerIteration})` : "";
  agent._logger?.debug?.(
    `Iteration ${plannedIteration}/${agent.maxIterations}${retryInfo}${systemRetryInfo} | Tokens: ${totalTokens} (${tokenPct}%)${compressFlag} | Messages: ${agent.messages.length}`
  );

  // 预算检查
  if (agent.budget?.isExhausted?.()) {
    agent._logger?.warn?.("Budget exhausted");
    return { status: "stop", reason: "budget_exhausted" };
  }

  agent._emit?.(DeepSearchEvents.AGENT_ITERATION, {
    iteration: plannedIteration,
    retry: responseHandler.retryCount,
    systemRetry: systemRetryCount,
  });

  // Fail-safe: ensure any scheduled compression has applied before the model call.
  await agent.messageHandling?.flushCompression?.();

  const { baseMessages, ephemeralMessages } = buildEphemeralMessages({
    agent,
    stageApi,
    context,
    plannedIteration,
    iteration,
    toolCallCount,
    convergencePolicy,
    convergence,
  });

  const transientMessages = ephemeralMessages.length > 0 ? [...baseMessages, ...ephemeralMessages] : baseMessages;

  const modelTimeoutMs = toPositiveInt(
    stageApi?.modelTimeoutMs ?? stageApi?.env?.DEEPSEARCH_MODEL_TIMEOUT_MS,
    DEFAULT_MODEL_TIMEOUT_MS
  );
  const { signal: modelSignal, cleanup: cleanupModelSignal } = createModelSignal(stageApi, modelTimeoutMs);
  let response;
  try {
    response = await callModel(transientMessages, {
      temperature: 0.3,
      maxTokens: 1000,
      signal: modelSignal,
    });
  } finally {
    cleanupModelSignal();
  }

  const result = await responseHandler.handleResponse(response, {
    stageApi,
    addMessage: (msg) => agent.addMessage(msg),
    budget: agent.budget,
  });

  if (result.status !== "success") return result;

  const decision = result.decision;
  if (agent.context) agent.context.iteration = plannedIteration;
  else agent.state.iteration = plannedIteration;

  if (decision.thought) {
    const thoughtPreview = decision.thought.length > 150 ? decision.thought.slice(0, 150) + "..." : decision.thought;
    agent._logger?.debug?.(`Thought: ${thoughtPreview}`);
  }

  if (decision.action) {
    const decisionRecord = { action: decision.action, reason: decision.thought || "" };
    if (agent.context) agent.context.recordDecision(decisionRecord);
    else if (agent.memory) agent.memory.recordDecision(decisionRecord);
  }

  return { status: "success", decision };
}
