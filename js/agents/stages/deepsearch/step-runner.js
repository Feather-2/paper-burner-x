/**
 * StepRunner - 单步执行器
 *
 * 职责：
 * - 执行单个 observe → think → execute → review 循环
 * - 管理步骤上下文和信号
 * - 返回 review 决策
 */

import { AgentLoopStatus } from "./constants.js";
import { isPlainObject } from "../../shared/value-utils.js";

/**
 * Agent 观察结果
 */
export function observe(state, config = {}) {
  const sources = Array.isArray(state?.L0?.sources) ? state.L0.sources : [];
  const gaps = Array.isArray(state?.L1?.gaps) ? state.L1.gaps : [];
  const todos = Array.isArray(state?.todos) ? state.todos : [];
  const claims = Array.isArray(state?.L1?.claims) ? state.L1.claims : [];
  const evidenceLedger = Array.isArray(state?.L1?.evidenceLedger) ? state.L1.evidenceLedger : [];
  const report = state?.L1?.report;
  const needsWrite = Boolean(state?.L2?.needsWrite);

  const useTodos = todos.length > 0;
  const todoItems = useTodos ? todos : gaps;
  const statusOf = (item) => {
    const raw = String(item?.status || "open").toLowerCase();
    if (useTodos) {
      if (raw === "completed") return "completed";
      if (raw === "cancelled") return "blocked";
      if (raw === "pending") return "open";
      return "open";
    }
    if (raw === "filled") return "completed";
    if (raw === "blocked") return "blocked";
    if (raw === "searching" || raw === "understanding") return "open";
    return "open";
  };

  const openTodos = todoItems.filter((t) => statusOf(t) === "open");
  const completedTodos = todoItems.filter((t) => statusOf(t) === "completed");
  const blockedTodos = todoItems.filter((t) => statusOf(t) === "blocked");

  const openGaps = gaps.filter((g) => g?.status === "open" || !g?.status);
  const filledGaps = gaps.filter((g) => g?.status === "filled");

  const totalChars = sources.reduce((sum, s) => sum + (s?.sourceTextNormalized?.length || 0), 0);
  const estimatedTokens = Math.ceil(totalChars / 2);
  const smallDocThreshold = config.smallDocThreshold || 8000;

  return {
    sourceCount: sources.length,
    totalChars,
    estimatedTokens,
    isLargeDoc: estimatedTokens > smallDocThreshold,
    totalTodos: todoItems.length,
    openTodoCount: openTodos.length,
    completedTodoCount: completedTodos.length,
    blockedTodoCount: blockedTodos.length,
    openTodos,
    totalGaps: gaps.length,
    openGapCount: openGaps.length,
    filledGapCount: filledGaps.length,
    openGaps,
    claimCount: claims.length,
    evidenceCount: evidenceLedger.length,
    hasReport: isPlainObject(report),
    iteration: state?.iteration || 0,
    maxIterations: state?.maxIterations || 5,
    sources,
    gaps,
    todos: todoItems,
    claims,
    evidenceLedger,
    report,
    needsWrite,
  };
}

/**
 * 规则思考（无 LLM）
 */
export function think(observation, context = {}) {
  const { openTodoCount, hasReport, iteration, maxIterations, isLargeDoc, claimCount, evidenceCount } = observation;
  const totalTodos = typeof observation.totalTodos === "number" ? observation.totalTodos : 0;
  const { budgetExhausted, aborted, isSubAgent, subagentsForked } = context;

  if (aborted) {
    return { action: "abort", reason: "user_aborted" };
  }
  if (budgetExhausted) {
    return { action: "complete", reason: "budget_exhausted", forceOutput: true };
  }

  if (isLargeDoc && iteration === 0 && !isSubAgent && !subagentsForked) {
    return { action: "fork_subagents", reason: "large_document" };
  }

  if (observation.needsWrite) {
    return { action: "generate_report", reason: "pending_write" };
  }

  if (hasReport && openTodoCount === 0) {
    return { action: "complete", reason: "all_todos_resolved" };
  }

  if (iteration >= maxIterations) {
    return { action: "complete", reason: "max_iterations", forceOutput: true };
  }

  if (openTodoCount > 0) {
    return { action: "retrieve_and_extract", reason: "open_todos_exist", todoCount: openTodoCount };
  }

  if (!hasReport && (claimCount > 0 || evidenceCount > 0)) {
    return { action: "generate_report", reason: "content_ready" };
  }

  if (totalTodos === 0) {
    return { action: "scan_and_identify_gaps", reason: "initial_state" };
  }

  if (!hasReport) {
    return { action: "complete", reason: "no_action_needed", forceOutput: true };
  }

  return { action: "complete", reason: "no_action_needed" };
}

/**
 * Agent 决策枚举
 */
export const AgentDecision = Object.freeze({
  CONTINUE: "continue",
  COMPLETE: "complete",
  ABORT: "abort",
  RETRY: "retry",
  BACKTRACK: "backtrack",
  REPLAN: "replan",
});

export class StepRunner {
  constructor(agentLoop) {
    this.agentLoop = agentLoop;
  }

  /**
   * 执行单步
   * @returns {{ decision, result, observation, action }}
   */
  async runOne(state, stageApi, context = {}) {
    const { logger } = context;
    const loop = this.agentLoop;

    // 1. 观察
    await loop._transitionTo(AgentLoopStatus.OBSERVING, {
      runId: state.runId,
      iteration: context.loopCount,
    });
    const observation = observe(state, { smallDocThreshold: loop.smallDocThreshold });

    // 2. 思考
    await loop._transitionTo(AgentLoopStatus.THINKING, {
      runId: state.runId,
      iteration: context.loopCount,
    });
    const decision = await loop._think(observation, state, stageApi, {
      budgetExhausted: loop.budgetManager?.stopped,
      aborted: stageApi?.signal?.aborted,
      isSubAgent: loop.isSubAgent,
      subagentsForked: Boolean(state?.L2?.subagentsForked),
      logger,
    });

    logger?.info(`Agent decision: ${decision.action}`, {
      stage: "step-runner",
      data: { action: decision.action, reason: decision.reason, iteration: state.iteration },
    });

    // 3. 执行
    await loop._transitionTo(AgentLoopStatus.EXECUTING, {
      runId: state.runId,
      iteration: context.loopCount,
      decision,
    });
    const result = await loop._execute(decision, state, stageApi, { logger, runContext: context.runContext });

    // 4. 审查
    await loop._transitionTo(AgentLoopStatus.REVIEWING, {
      runId: state.runId,
      iteration: context.loopCount,
    });
    const review = await loop._review(decision, result, state, stageApi);

    return { decision, result, observation, review };
  }
}

export function createStepRunner(agentLoop) {
  return new StepRunner(agentLoop);
}
