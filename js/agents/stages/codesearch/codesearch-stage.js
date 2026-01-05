/**
 * CodeSearch Stage - 代码探索 Agent Loop
 *
 * 基于 Agent Loop 模式的代码分析：
 * - 使用 CodeSearchState 统一状态管理
 * - 使用 phases 拆分：planning -> execution -> summarizing
 * - 支持 EventBus、MemoryStore、StateEngine 集成
 */

import { AgentStatus } from "../../runtime/core/agent-status.js";
import { BaseAgentLoop, checkCancelled } from "../../runtime/core/agent-loop.js";
import { StagePausedError } from "../../runtime/core/stage-errors.js";
import { loadMechanisms, initMechanisms } from "../../runtime/core/mechanisms.js";
import { createBudgetManager, BudgetAction } from "../../shared/utils/budget.js";
import { createLogger } from "../../shared/utils/logger.js";
import { isPlainObject, toNonEmptyString } from "../../shared/utils/value-utils.js";
import { makeStageEmitter } from "../deepsearch/state.js";
import { getModelCaller } from "../deepsearch/model.js";
import { createToolExecutor } from "./code-tools.js";
import { CodeSearchPhase } from "./states.js";
import { CodeSearchState } from "./state.js";
import {
  runPlanningPhase,
  buildSystemPrompt,
  runExecutionStep,
  runSummarizingPhase,
  buildTodoCompletionStats,
  isTodoOpen,
} from "./phases/index.js";

const DEFAULT_MAX_STEPS = 20;
const DEFAULT_TIMEOUT_MS = 120_000;
const PAUSE_REASON = "LLM unavailable, awaiting user input";

export class CodeSearchStage extends BaseAgentLoop {
  constructor(options = {}) {
    super({ actor: "codesearch", stageName: "codesearch", eventBus: options.eventBus });
    this.maxSteps = options.maxSteps || DEFAULT_MAX_STEPS;
    this.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    this.maxBacktracks = options.maxBacktracks ?? 3;
    this.state = null;
    this._logger = null;

    this.initLoopStatus({
      status: AgentStatus.IDLE,
      eventName: "codesearch.agent.status.changed",
    });
  }

  /**
   * 向后兼容: loopState getter 代理到 state
   */
  get loopState() {
    return this.state;
  }

  /**
   * 执行代码分析
   */
  async run(input, context = {}) {
    const runContext = context.runContext || {};
    const stageApi = context;
    const runId = runContext?.runId || input?.runId || "run_unknown";
    const query = toNonEmptyString(input?.query) || "分析这个代码库的架构";
    const userConfig = isPlainObject(input?.userConfig) ? input.userConfig : {};

    // 初始化日志
    this._logger = createLogger({
      emit: stageApi?.emit,
      getContext: () => ({ runId, stage: "codesearch" }),
    });
    const logger = this._logger;

    // 初始化状态
    this.state = new CodeSearchState({
      runId,
      query,
      taskGoal: query,
      memoryStore: stageApi?.memoryStore || context.memoryStore,
      stateEngine: stageApi?.stateEngine || context.stateEngine,
    });

    // 初始化共享机制
    await loadMechanisms();
    initMechanisms(this, { stageApi, emit: stageApi?.emit, logger, runId });

    // 初始化预算
    const budgetManager = createBudgetManager(userConfig);
    let budgetStopRequested = false;
    budgetManager.onThresholdReached = ({ action }) => {
      if (action === BudgetAction.STOP) budgetStopRequested = true;
    };

    // 事件发射 - 使用 EventBus
    const emit = this._createEmitter(stageApi);

    // 取消/预算检查
    const checkStop = (signal) => {
      checkCancelled(signal);
      if (budgetStopRequested) throw new Error("CodeSearch: Budget exceeded");
    };

    // 初始化工具
    const tools = createToolExecutor({
      fs: stageApi?.fs || await this._getDefaultFs(),
      vfs: stageApi?.vfs,
      globFn: stageApi?.globFn,
      basePath: input?.basePath || ".",
      logger,
      emit,
      policy: stageApi?.policy,
      runStore: stageApi?.runStore,
      runId,
      stageApi,
    });

    // 初始化 LLM
    const callModel = getModelCaller(stageApi, { usage: "codesearch" });
    if (!callModel) {
      await this._pauseForUserFeedback(runId, PAUSE_REASON);
    }

    // 开始执行
    this._transitionLoopStatus(AgentStatus.RUNNING, { runId, iteration: 0 });
    logger.info("CodeSearch started", { data: { query, maxSteps: this.maxSteps } });
    emit("codesearch.started", { query, maxSteps: this.maxSteps });

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 1: Planning
    // ─────────────────────────────────────────────────────────────────────────
    this._transitionPhase({ status: this.state.phase }, CodeSearchPhase.PLANNING, {
      runId,
      emit,
      eventName: "codesearch.phase.transition",
    });
    this.state.phase = CodeSearchPhase.PLANNING;

    try {
      checkStop(stageApi?.signal);
      const planResult = await runPlanningPhase({
        state: this.state,
        callModel,
        budgetManager,
        emit,
        signal: stageApi?.signal,
      });

      if (!planResult.success) {
        await this._pauseForUserFeedback(runId, PAUSE_REASON);
      }
    } catch (err) {
      if (err instanceof StagePausedError) throw err;
      logger.warn("Planning phase failed", { error: err?.message });
      await this._pauseForUserFeedback(runId, PAUSE_REASON);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 2: Execution
    // ─────────────────────────────────────────────────────────────────────────
    this._transitionPhase({ status: this.state.phase }, CodeSearchPhase.EXECUTING, {
      runId,
      emit,
      eventName: "codesearch.phase.transition",
    });
    this.state.phase = CodeSearchPhase.EXECUTING;

    const systemPrompt = buildSystemPrompt();
    let step = 0;
    let aborted = false;

    while (step < this.maxSteps) {
      const openTodos = this.state.todos.filter(isTodoOpen);
      if (!openTodos.length) break;

      step++;
      const { step: stepMeta, context: stepContext } = this._beginStep(
        { name: "codesearch.step", runId, iteration: step },
        stageApi
      );

      try {
        checkStop(stepContext.signal);
        await this._transitionLoopStatus(AgentStatus.RUNNING, { runId, iteration: step, stepId: stepMeta.stepId });

        const stepResult = await runExecutionStep({
          state: this.state,
          step,
          maxSteps: this.maxSteps,
          systemPrompt,
          callModel,
          tools,
          budgetManager,
          emit,
          signal: stepContext.signal,
        });

        this._endStep({ step: stepMeta }, { status: "completed" });

        if (stepResult.done) break;
      } catch (err) {
        if (err instanceof StagePausedError) throw err;

        const pauseLike = this._shouldPauseFromError(err, stepContext.signal);
        this._endStep({ step: stepMeta }, { status: pauseLike ? "paused" : "failed", error: err?.message });

        if (pauseLike) {
          await this._transitionLoopStatus(AgentStatus.PAUSED, { runId, iteration: step, reason: err?.message });
          throw this._createPauseError({ signal: stepContext.signal, runId });
        }

        logger.error("Execution step failed", { error: err?.message });
        emit("codesearch.step.failed", { step, error: err?.message });
        aborted = true;
        await this._transitionLoopStatus(AgentStatus.FAILED, { runId, iteration: step, error: err?.message });
        break;
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 3: Summarizing
    // ─────────────────────────────────────────────────────────────────────────
    this._transitionPhase({ status: this.state.phase }, CodeSearchPhase.SUMMARIZING, {
      runId,
      emit,
      eventName: "codesearch.phase.transition",
    });
    this.state.phase = CodeSearchPhase.SUMMARIZING;

    const { summary, todoStats, budgetUsage } = await runSummarizingPhase({
      state: this.state,
      callModel,
      budgetManager,
      emit,
      signal: stageApi?.signal,
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 完成
    // ─────────────────────────────────────────────────────────────────────────
    const result = {
      query,
      summary,
      steps: this.state.steps,
      totalSteps: step,
      budgetUsage,
      todos: this.state.todos,
      todoCompletionStats: todoStats,
      awaitUserFeedback: this.state.awaitUserFeedback,
    };

    logger.info("CodeSearch completed", { data: { totalSteps: step } });
    emit("codesearch.completed", { totalSteps: step });

    if (!aborted) {
      this._transitionPhase({ status: this.state.phase }, CodeSearchPhase.COMPLETED, {
        runId,
        emit,
        eventName: "codesearch.phase.transition",
      });
      this.state.phase = CodeSearchPhase.COMPLETED;
      this._transitionLoopStatus(AgentStatus.COMPLETED, { runId, iteration: step });
    }

    return result;
  }

  /**
   * 创建事件发射器（统一 EventBus 接入）
   */
  _createEmitter(stageApi) {
    const eventBus = this.eventBus || stageApi?.eventBus;
    const directEmit = stageApi?.emit;

    return (eventName, payload = {}) => {
      const fullPayload = { actor: "codesearch", status: "info", payload };

      // 通过 EventBus 发射
      if (eventBus?.emit) {
        try {
          eventBus.emit(eventName, fullPayload);
        } catch { /* intentional */ }
      }

      // 直接发射（兼容）
      if (directEmit && directEmit !== eventBus?.emit) {
        try {
          directEmit(eventName, fullPayload);
        } catch { /* intentional */ }
      }
    };
  }

  /**
   * 暂停等待用户反馈
   */
  async _pauseForUserFeedback(runId, reason) {
    this.state.awaitUserFeedback = true;
    this.state.pauseReason = reason;
    if (this.loopStatus !== AgentStatus.PAUSED) {
      // 如果还在 IDLE，需要先转到 RUNNING 再到 PAUSED
      if (this.loopStatus === AgentStatus.IDLE) {
        await this._transitionLoopStatus(AgentStatus.RUNNING, { runId, iteration: 0 });
      }
      await this._transitionLoopStatus(AgentStatus.PAUSED, { runId, iteration: 0, reason });
    }
    const err = new StagePausedError("Run paused", { runId, reason });
    err.awaitUserFeedback = true;
    throw err;
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
 * 便捷函数
 */
export async function runCodeSearchStage(runContext, input, stageApi = {}) {
  const stage = new CodeSearchStage(input?.options);
  return stage.execute(runContext, input, stageApi);
}

/**
 * 注册到 Orchestrator
 */
export function registerCodeSearchStages(orchestrator, { timeoutMs = 120_000 } = {}) {
  orchestrator.registerStage("codesearch.pipeline", runCodeSearchStage, {
    actor: "codesearch",
    timeoutMs,
  });
}

// 导出状态类
export { CodeSearchState } from "./state.js";
