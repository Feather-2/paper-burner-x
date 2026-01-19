/**
 * CodeSearch Stage - 代码探索 Agent Loop
 *
 * 基于 Agent Loop 模式的代码分析：
 * - 使用 CodeSearchState 统一状态管理
 * - 使用 phases 拆分：planning -> execution -> summarizing
 * - 支持 EventBus、MemoryStore、StateEngine 集成
 * - 支持 DI 容器注入依赖
 */

import {
  AgentStatus,
  BaseAgentLoop,
  checkCancelled,
  StagePausedError,
  loadMechanisms,
  initMechanisms,
  createLifecycleEmitter,
  Watchdog,
} from "../../runtime/index.js";
import { createBudgetManager, BudgetAction } from "../../shared/index.js";
import { createLogger } from "../../shared/index.js";
import { isPlainObject, toNonEmptyString } from "../../shared/index.js";
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

// DI ServiceId 常量（避免循环依赖）
const ServiceId = {
  EVENT_BUS: "eventBus",
  MEMORY_STORE: "memoryStore",
  STATE_ENGINE: "stateEngine",
  MODEL_ROUTER: "modelRouter",
  BUDGET_MANAGER: "budgetManager",
  WATCHDOG: "watchdog",
  // P6.4-P6.7
  RUNTIME_SCHEDULER: "runtimeScheduler",
  SCHEMA_VALIDATOR: "schemaValidator",
  FILE_LOCK: "fileLock",
  TOC_BUILDER: "tocBuilder",
};

/**
 * @typedef {object} CodeSearchStageOptions
 * @property {any=} eventBus
 * @property {number=} maxSteps
 * @property {number=} timeoutMs
 * @property {number=} maxBacktracks
 * @property {any=} container
 */

function resolveWatchdogSettings(userConfig) {
  const raw = userConfig && typeof userConfig === "object" ? userConfig.watchdog : null;
  const cfg = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};

  const maxRecentOutputs = Number.isFinite(cfg.maxRecentOutputs) ? Math.max(2, Math.floor(cfg.maxRecentOutputs)) : 6;
  const similarityThreshold = Number.isFinite(cfg.similarityThreshold)
    ? Math.min(1, Math.max(0, cfg.similarityThreshold))
    : 0.8;
  const maxConsecutiveSimilar = Number.isFinite(cfg.maxConsecutiveSimilar)
    ? Math.max(2, Math.floor(cfg.maxConsecutiveSimilar))
    : 3;

  return { maxRecentOutputs, similarityThreshold, maxConsecutiveSimilar };
}

function buildCodeSearchWatchdogAdvice(issues) {
  const rows = Array.isArray(issues) ? issues : [];
  const types = new Set(rows.map((x) => String(x?.type || "")));

  const tips = [];
  if (types.has("tool_loop")) {
    const loop = rows.find((x) => x?.type === "tool_loop");
    const hint = loop?.suggestion ? `（${loop.suggestion}）` : "";
    tips.push(`检测到重复工具调用模式；建议切换策略/参数或换 todo，必要时 ask-user 澄清。${hint}`.trim());
  }
  if (types.has("oscillation")) {
    tips.push("你可能在重复调用同一工具/读取同一文件；尝试切换到不同 todo，或改变检索策略（tree → grep/glob → find_symbol）。");
    tips.push("优先使用更粗粒度的工具（tree/grep/glob）定位入口，再少量 read_file。");
  }
  if (types.has("stuck") || types.has("timeout")) {
    tips.push("本轮耗时过长；缩小范围/降低单次 read_file 行数，必要时先输出当前结论并提出需要用户澄清的问题。");
  }
  if (types.has("max_iterations")) {
    tips.push("迭代次数过多；总结已有证据，列出未完成 todo 及下一步建议。");
  }

  if (!tips.length) {
    tips.push("检测到潜在卡死；改变策略或参数，避免重复操作。");
  }

  return tips.join(" ");
}

export class CodeSearchStage extends BaseAgentLoop {
  /**
   * @param {CodeSearchStageOptions} [options]
   */
  constructor(options = {}) {
    super({ actor: "codesearch", stageName: "codesearch", eventBus: options.eventBus });
    this.maxSteps = options.maxSteps || DEFAULT_MAX_STEPS;
    this.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    this.maxBacktracks = options.maxBacktracks ?? 3;
    this.state = null;
    this._logger = null;
    this._container = options.container || null;
    this._watchdog = null;

    this.initLoopStatus({
      status: AgentStatus.IDLE,
      eventName: "codesearch:agent:status:changed",
    });
  }

  /**
   * 向后兼容: loopState getter 代理到 state
   */
  get loopState() {
    return this.state;
  }

  /**
   * 从容器或 context 解析依赖
   * @private
   */
  /**
   * @private
   * @param {string} serviceId
   * @param {any} context
   * @param {any} fallback
   * @returns {Promise<any>}
   */
  async _resolveDependency(serviceId, context, fallback) {
    // 优先从 context 获取（显式传入）
    if (context?.[serviceId]) return context[serviceId];
    // 其次从容器获取
    if (this._container) {
      try {
        return await this._container.get(serviceId);
      } catch { /* fallback */ }
    }
    // 最后使用回退值
    return fallback;
  }

  /**
   * 执行代码分析
   */
  /**
   * @param {any} [input]
   * @param {any} [context]
   * @returns {Promise<any>}
   */
  async run(input = {}, context = {}) {
    const runContext = context.runContext || {};
    const stageApi = context;
    const runId = runContext?.runId || input?.runId || "run_unknown";
    const query = toNonEmptyString(input?.query) || "分析这个代码库的架构";
    const userConfig = isPlainObject(input?.userConfig) ? input.userConfig : {};

    // 解析依赖（DI 容器优先）
    const memoryStore = await this._resolveDependency(ServiceId.MEMORY_STORE, stageApi, null);
    const stateEngine = await this._resolveDependency(ServiceId.STATE_ENGINE, stageApi, null);
    const eventBus = await this._resolveDependency(ServiceId.EVENT_BUS, stageApi, this.eventBus);
    this.eventBus = eventBus || this.eventBus || null;

    // P4.6: Enable backpressure for high-frequency events (best-effort).
    /** @type {any} */
    const backpressureBus = this.eventBus;
    if (backpressureBus && typeof backpressureBus.enableBackpressure === "function" && !backpressureBus?._backpressure?.enabled) {
      const cfg = stageApi?.eventBusBackpressure ?? stageApi?.backpressure;
      if (cfg !== false) {
        const opts = isPlainObject(cfg) ? cfg : {};
        try {
          backpressureBus.enableBackpressure({
            coalescePattern: /\.progress$/,
            deferNonCoalesced: false,
            maxQueueSize: 10000,
            ...opts,
          });
        } catch {
          // ignore
        }
      }
    }

    const lifecycle = createLifecycleEmitter({
      actor: "codesearch",
      emit: stageApi?.emit,
      eventBus: this.eventBus,
    });

    // 初始化日志
    this._logger = createLogger({
      emit: stageApi?.emit,
      getContext: () => ({ runId, stage: "codesearch" }),
    });
    const logger = this._logger;

    // 初始化状态（使用已解析的依赖）
    this.state = new CodeSearchState({
      runId,
      query,
      taskGoal: query,
      memoryStore,
      stateEngine,
    });

    // 初始化共享机制
    await loadMechanisms();
    initMechanisms(this, { stageApi, emit: stageApi?.emit, logger, runId });

    // 初始化预算（尝试从容器获取）
    let budgetManager = await this._resolveDependency(ServiceId.BUDGET_MANAGER, stageApi, null);
    if (!budgetManager) {
      budgetManager = createBudgetManager(userConfig);
    }
    let budgetStopRequested = false;
    budgetManager.onThresholdReached = ({ action }) => {
      if (action === BudgetAction.STOP) budgetStopRequested = true;
    };

    // 事件发射 - 使用统一生命周期 emitter（默认 status=info）
    const emit = lifecycle.emit;

    // 取消/预算检查
    const checkStop = (signal) => {
      checkCancelled(signal);
      if (budgetStopRequested) throw new Error("CodeSearch: Budget exceeded");
    };

    // 初始化 LLM
    const callModel = getModelCaller(stageApi, { usage: "codesearch" });
    if (!callModel) {
      await this._pauseForUserFeedback(runId, PAUSE_REASON);
    }

    // 初始化 Watchdog（用于循环/震荡检测）
    const watchdogSettings = resolveWatchdogSettings(userConfig);
    let watchdog = await this._resolveDependency(ServiceId.WATCHDOG, stageApi, null);
    if (watchdog && typeof watchdog.reset === "function") {
      watchdog.reset();
    }
    if (!watchdog) {
      watchdog = new Watchdog(/** @type {any} */ ({
        eventBus: this.eventBus,
        maxRecentOutputs: watchdogSettings.maxRecentOutputs,
        oscillationThreshold: watchdogSettings.similarityThreshold,
      }));
    } else {
      // Best-effort: apply user config to instance from DI.
      if (typeof watchdog.configure === "function") {
        watchdog.configure({
          maxRecentOutputs: watchdogSettings.maxRecentOutputs,
          oscillationThreshold: watchdogSettings.similarityThreshold,
        });
      }
    }
    this._watchdog = watchdog;
    let watchdogInterventions = 0;

    // 初始化工具（注入 watchdog 以记录工具调用指纹）
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
      watchdog,
    });

    // 开始执行
    this._transitionLoopStatus(AgentStatus.RUNNING, { runId, iteration: 0 });
    logger.info("CodeSearch started", { data: { query, maxSteps: this.maxSteps } });
    lifecycle.started(runId, { query, maxSteps: this.maxSteps });

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 1: Planning
    // ─────────────────────────────────────────────────────────────────────────
    lifecycle.phaseTransition(this.state.phase, CodeSearchPhase.PLANNING, runId);
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
    lifecycle.phaseTransition(this.state.phase, CodeSearchPhase.EXECUTING, runId);
    this.state.phase = CodeSearchPhase.EXECUTING;

    const systemPrompt = buildSystemPrompt();
    let step = 0;
    let aborted = false;
    let stoppedEarlyReason = null;

    while (step < this.maxSteps) {
      const openTodos = this.state.todos.filter(isTodoOpen);
      if (!openTodos.length) break;

      step++;
      watchdog?.tick?.();
      let stopRequested = false;
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

        if (watchdog && typeof watchdog.recordOutput === "function" && stepResult?.watchdogOutput) {
          watchdog.recordOutput(stepResult.watchdogOutput);
        }
        if (watchdog && typeof watchdog.checkHealth === "function") {
          const health = watchdog.checkHealth({
            maxIterations: this.maxSteps + 1,
            maxTimeMs: this.timeoutMs,
            stuckThresholdMs: Math.min(60_000, Math.max(5_000, Math.floor(this.timeoutMs / 2))),
            oscillationConsecutiveThreshold: watchdogSettings.maxConsecutiveSimilar,
          });
          if (!health.healthy) {
            watchdogInterventions += 1;
            const advice = buildCodeSearchWatchdogAdvice(health.issues);
            logger.warn("Watchdog intervention (CodeSearch)", {
              step,
              issues: health.issues,
              stats: health.stats,
              advice,
            });
            emit("codesearch.watchdog.intervention", { step, issues: health.issues, stats: health.stats, advice });
            this.state.addObservation(`[Watchdog] 检测到潜在卡死/震荡。建议：${advice}`);

            const hasOscillation = health.issues.some((x) => x?.type === "oscillation");
            const hasTimeout = health.issues.some((x) => x?.type === "timeout");
            const hasStuck = health.issues.some((x) => x?.type === "stuck");
            const hasToolLoop = health.issues.some((x) => x?.type === "tool_loop");

            // Soft intervention: reset watchdog window after hinting the model.
            if (typeof watchdog.resetOscillation === "function") watchdog.resetOscillation();
            if (hasToolLoop && typeof watchdog.resetToolLoop === "function") watchdog.resetToolLoop();

            // Hard stop if repeatedly oscillating, or if timing issues appear.
            if (hasTimeout || hasStuck || (hasOscillation && watchdogInterventions >= 2)) {
              stoppedEarlyReason = hasTimeout ? "timeout" : hasStuck ? "stuck" : "oscillation";
              emit("codesearch.watchdog.stop", { step, reason: stoppedEarlyReason, issues: health.issues });
              stopRequested = true;
            }
          }
        }

        this._endStep({ step: stepMeta }, { status: "completed" });

        if (stopRequested) break;
        if (stepResult.done) break;
      } catch (err) {
        if (err instanceof StagePausedError) throw err;

        const pauseLike = this._shouldPauseFromError(err, stepContext.signal);
        this._endStep({ step: stepMeta }, /** @type {any} */ ({ status: pauseLike ? "paused" : "failed", error: err?.message }));

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
    lifecycle.phaseTransition(this.state.phase, CodeSearchPhase.SUMMARIZING, runId);
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
      ...(stoppedEarlyReason ? { completionReason: `watchdog_${stoppedEarlyReason}` } : {}),
    };

    logger.info("CodeSearch completed", { data: { totalSteps: step } });
    lifecycle.completed(runId, { totalSteps: step });

    if (!aborted) {
      lifecycle.phaseTransition(this.state.phase, CodeSearchPhase.COMPLETED, runId);
      this.state.phase = CodeSearchPhase.COMPLETED;
      this._transitionLoopStatus(AgentStatus.COMPLETED, { runId, iteration: step });
    }

    return result;
  }

  /**
   * 暂停等待用户反馈
   */
  /**
   * @param {string} runId
   * @param {string} reason
   * @returns {Promise<never>}
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
    /** @type {any} */ (err).awaitUserFeedback = true;
    throw err;
  }

  /**
   * @param {any} runContext
   * @param {any} input
   * @param {any} [stageApi]
   * @returns {Promise<any>}
   */
  async execute(runContext, input, stageApi = {}) {
    return super.execute(runContext, input, stageApi);
  }

  /**
   * 获取默认文件系统（仅 Node.js 环境）
   *
   * 注意：此方法是 Node-only polyfill。浏览器环境下 dynamic import 会失败，
   * catch 后返回 null，调用方应通过依赖注入提供 fs 或 vfs。
   *
   * @private
   * @returns {Promise<{ readFile: Function, readdir: Function, stat: Function } | null>}
   */
  async _getDefaultFs() {
    try {
      // @ts-ignore - this tsconfig is browser-first (no @types/node)
      const { readFile, readdir, stat } = await import("node:fs/promises");
      return { readFile, readdir, stat };
    } catch {
      // 浏览器环境下无法导入 node:fs/promises，返回 null
      return null;
    }
  }
}

/**
 * 便捷函数：创建 CodeSearchStage 并执行
 * @param {any} runContext - 运行上下文
 * @param {any} input - 输入参数
 * @param {any} [stageApi] - Stage API
 * @returns {Promise<any>} 执行结果
 */
export async function runCodeSearchStage(runContext, input, stageApi = {}) {
  const stage = new CodeSearchStage(input?.options);
  return stage.execute(runContext, input, stageApi);
}

/**
 * 注册 CodeSearch 阶段到 Orchestrator
 * @param {any} orchestrator - Orchestrator 实例
 * @param {{ timeoutMs?: number }} [options] - 选项
 * @returns {void}
 */
export function registerCodeSearchStages(orchestrator, { timeoutMs = 120_000 } = {}) {
  orchestrator.registerStage("codesearch.pipeline", runCodeSearchStage, {
    actor: "codesearch",
    timeoutMs,
  });
}

// 导出状态类
export { CodeSearchState } from "./state.js";
