/**
 * DeepSearch Agent Loop
 *
 * 极简核心 + 可插拔（capabilities loader）+ phases（planning/execution/writing）
 */

import {
  BaseAgentLoop,
  DeepSearchEvents,
  createLifecycleEmitter,
} from "../../runtime/index.js";
import { DeepSearchState } from "./state.js";
import { getModelCaller } from "./model.js";
import { createLogger } from "../../shared/index.js";
import { robustParseJson } from "../../shared/index.js";
import { checkCancelled, shouldDegrade as shouldDegradeCheck } from "../../shared/index.js";
import { isPlainObject, toPositiveInt } from "../../shared/index.js";
import { classifyDeepSearchError } from "../../shared/index.js";
import { ModelResponseHandler } from "./internal/model-response-handler.js";
import SourceManager from "./source-manager.js";
import { loadDeepSearchCapabilities } from "./capabilities-loader.js";
import { ConvergenceDetector, BehaviorFingerprint } from "../../plugins/analysis/index.js";
import {
  addInitialDeepSearchMessages,
  createIterationConvergenceTracker,
  getGapConvergencePolicy,
  runPlanningPhaseIteration,
} from "./phases/planning-phase.js";
import { executeDeepSearchDecision } from "./phases/execution-phase.js";
import { ensureReportOnComplete, runWritingPhaseIfNeeded } from "./phases/writing-phase.js";
import {
  DEFAULT_MODE_CONFIG,
  deepSortForStableJson,
  stableStringify,
  toClamped01Float,
  normalizeReportConvergenceConfig,
  normalizeNewlines,
  sliceTail,
  buildConvergenceSample,
  resolveErrorBoundary,
  normalizeToolCallGuard,
  normalizeBehaviorFingerprintConfig,
  resolveStageTraceContext,
  getModeConfig,
} from "./deepsearch-helpers.js";

export const AgentStatus = Object.freeze({
  IDLE: "idle",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
});

/** @typedef {"idle"|"running"|"completed"|"failed"} DeepSearchAgentStatus */

/**
 * @typedef {object} EventBusBackpressureState
 * @property {boolean=} enabled
 *
 * @typedef {object} EventBusWithBackpressure
 * @property {((options: { coalescePattern?: RegExp, deferNonCoalesced?: boolean, maxQueueSize?: number } & Record<string, unknown>) => void)=} enableBackpressure
 * @property {EventBusBackpressureState=} _backpressure
 */

// 分析模式配置（默认值，可被 config.json 覆盖）
export const AnalysisMode = Object.freeze({
  QUICK: "quick",
  WIDER: "wider",
  DEEPER: "deeper",
});

export class DeepSearchAgentLoop extends BaseAgentLoop {
  /**
   * Message handling helpers are provided by `MessageHandling` composed in
   * `BaseAgentLoop`. `checkJs` can't infer those class-level methods,
   * so we redeclare thin wrappers here to satisfy TS.
   *
   * @param {any} message
   * @returns {any}
   */
  addMessage(message) {
    return (/** @type {{ addMessage: (message: any) => any }} */ (/** @type {unknown} */ (BaseAgentLoop.prototype))).addMessage.call(this, message);
  }

  /**
   * @param {{ clearCompressionHistory?: boolean } | null | undefined} [options]
   * @returns {Promise<void>}
   */
  resetMessages(options = {}) {
    return (
      /** @type {{ resetMessages: (options?: { clearCompressionHistory?: boolean } | null | undefined) => Promise<void> }} */ (
        /** @type {unknown} */ (BaseAgentLoop.prototype)
      )
    ).resetMessages.call(this, options);
  }

  constructor(options = {}) {
    const contextConfig = {
      contextWindow: options.contextWindow || options.userConfig?.contextWindow,
      compressThreshold: options.compressThreshold || options.userConfig?.compressThreshold,
    };
    super({ actor: "deepsearch", stageName: "deepsearch", contextConfig, ...options });

    /** @type {DeepSearchAgentStatus} */
    this.status = AgentStatus.IDLE;
    this.state = null;

    this.globalConfig = options.config || options.globalConfig || null;

    this.mode = options.mode || AnalysisMode.WIDER;
    const modeConfig = getModeConfig(this.mode, this.globalConfig);
    this.maxIterations = options.maxIterations || modeConfig.maxIterations;
    this.writeIterations = modeConfig.writeIterations;
    this.maxToolCalls = modeConfig.maxToolCalls;
    this.subagentIterations = modeConfig.subagentIterations;

    this.sourceManager = options.sourceManager || null;

    // 可插拔机制（允许外部注入）
    this.budget = options.budget || null;
    this.checkpoint = options.checkpoint || null;
    this.sharedContext = options.sharedContext || null;
    this.backtrackManager = options.backtrackManager || null;
    this.discoveryManager = options.discoveryManager || null;
    this.maxBacktracks = options.maxBacktracks ?? 3;

    // Memory 2.0
    this.memory = options.memory || null;
    this.memoryConfig = options.memoryConfig || options.userConfig?.memory || null;

    // Unified context facade
    this.context = options.context || null;

    this._logger = createLogger({ actor: "deepsearch", getContext: () => ({ stage: "agent-loop" }) });
    this._failureReported = false;

    this._toolCallGuardConfig = normalizeToolCallGuard(
      options.toolCallGuard || options.doomLoopGuard || options.userConfig?.toolCallGuard || options.globalConfig?.toolCallGuard
    );
    this._toolCallGuardState = { lastSig: null, consecutive: 0, warnedAt: 0 };

    const bfCfg = normalizeBehaviorFingerprintConfig(
      options.behaviorFingerprint || options.userConfig?.behaviorFingerprint || options.globalConfig?.behaviorFingerprint
    );
    this._behaviorFingerprint = bfCfg.enabled ? new BehaviorFingerprint(bfCfg) : null;
    this._behaviorLoopLastWarnedCount = 0;
  }

  _recordToolCall(toolName, toolArgs) {
    const cfg = this._toolCallGuardConfig;
    const guardEnabled = !!cfg?.enabled;

    const name = typeof toolName === "string" ? toolName.trim() : String(toolName || "").trim();
    if (!name) return null;
    if (cfg?.ignoreTools?.has(name)) return null;

    // Always record behavior fingerprints (best-effort), even when the legacy guard is disabled.
    let behavior = null;
    if (this._behaviorFingerprint && typeof this._behaviorFingerprint.recordAction === "function") {
      try {
        const res = this._behaviorFingerprint.recordAction({ type: name, args: isPlainObject(toolArgs) ? toolArgs : {} });
        if (res?.loopDetected && res.loopInfo) {
          const loopCount = typeof res.loopInfo.totalLoopsDetected === "number" ? res.loopInfo.totalLoopsDetected : 0;
          if (loopCount > this._behaviorLoopLastWarnedCount) {
            this._behaviorLoopLastWarnedCount = loopCount;
            const suggestion = typeof this._behaviorFingerprint.getSuggestion === "function" ? this._behaviorFingerprint.getSuggestion() : null;
            behavior = { loopDetected: true, loopInfo: res.loopInfo, suggestion };
          }
        }
      } catch {
        // ignore behavior fingerprint failures
      }
    }

    if (!guardEnabled) {
      return behavior ? { tool: name, signature: null, consecutive: 1, shouldWarn: true, shouldStop: false, behavior } : null;
    }

    const sig = `${name}|${stableStringify(toolArgs, { maxChars: cfg.maxSigChars })}`;
    if (sig === this._toolCallGuardState.lastSig) {
      this._toolCallGuardState.consecutive += 1;
    } else {
      this._toolCallGuardState.lastSig = sig;
      this._toolCallGuardState.consecutive = 1;
      this._toolCallGuardState.warnedAt = 0;
    }

    const n = this._toolCallGuardState.consecutive;
    const shouldWarn = n >= cfg.warnAt && this._toolCallGuardState.warnedAt < cfg.warnAt;
    if (shouldWarn) this._toolCallGuardState.warnedAt = cfg.warnAt;

    const shouldStop = n >= cfg.maxConsecutive;
    const warn = shouldWarn || !!behavior;
    return { tool: name, signature: sig, consecutive: n, shouldWarn: warn, shouldStop, ...(behavior ? { behavior } : {}) };
  }

  /**
   * @param {string} name
   * @param {any} payload
   * @param {{ actor?: string, status?: string }=} meta
   * @returns {void}
   */
  _emit(name, payload, { actor = "deepsearch", status } = {}) {
    const eventName = name.startsWith("deepsearch.") ? name : `deepsearch.${name}`;
    const record = {
      actor,
      ...(typeof status === "string" && status ? { status } : {}),
      ...(payload !== undefined ? { payload } : {}),
    };
    const emit = typeof this.emit === "function" ? this.emit : this.eventBus?.emit;
    emit?.(eventName, record);
  }

  _markFailed(err, classification, lifecycle = null) {
    const emitter =
      lifecycle ||
      createLifecycleEmitter({
        actor: "deepsearch",
        emit: this.emit,
        eventBus: this.eventBus,
      });

    const info = classification || classifyDeepSearchError(err);
    const payload = {
      error: info.message,
      recoverable: info.recoverable,
      category: info.category,
      ...(typeof info.statusCode === "number" ? { statusCode: info.statusCode } : {}),
      ...(typeof info.code === "string" && info.code ? { code: info.code } : {}),
    };

    if (!this._failureReported) {
      this._emit(DeepSearchEvents.AGENT_ERROR, payload);
      emitter.failed(this.state?.runId, err, { runId: this.state?.runId, ...payload, error: payload.error });
      this._failureReported = true;
    }

    if (this.status !== AgentStatus.FAILED) {
      const from = this.status;
      emitter.statusChanged(from, AgentStatus.FAILED, this.state?.runId);
      this.status = AgentStatus.FAILED;
    }
  }

  /**
   * @param {any} [input]
   * @param {any} [context]
   * @returns {Promise<any>}
   */
  async run(input = {}, context = {}) {
    const stageApi = context?.stageApi && typeof context.stageApi === "object" ? context.stageApi : context;
    const errorBoundary = resolveErrorBoundary(stageApi);

    // When run() is invoked directly (not via BaseAgentLoop.execute), keep instance wiring in sync.
    this.eventBus = stageApi?.eventBus || this.eventBus || null;
    if (!this.emit && typeof stageApi?.emit === "function") this.emit = stageApi.emit;

    // P4.6: Enable backpressure for high-frequency events (best-effort).
    const eventBus = /** @type {EventBusWithBackpressure | null} */ (/** @type {unknown} */ (this.eventBus));
    if (eventBus && typeof eventBus.enableBackpressure === "function" && !eventBus?._backpressure?.enabled) {
      const cfg = stageApi?.eventBusBackpressure ?? stageApi?.backpressure;
      if (cfg !== false) {
        const opts = isPlainObject(cfg) ? cfg : {};
        try {
          eventBus.enableBackpressure({
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

    const traceContext = resolveStageTraceContext(stageApi);
    try {
      if (!stageApi.traceContext) stageApi.traceContext = traceContext;
    } catch {
      // ignore (non-extensible stageApi)
    }

    const shouldDegrade = () => shouldDegradeCheck({ stageApi, configs: [this.state?.userConfig, this.globalConfig] });

    return await errorBoundary.wrap(
      async () =>
        await traceContext.withSpan(
          "deepsearch.run",
          async (runSpan) => {
        const { signal } = stageApi;
        checkCancelled(signal);

        const lifecycle = createLifecycleEmitter({
          actor: "deepsearch",
          emit: stageApi?.emit,
          eventBus: this.eventBus,
        });

        const capabilities = await traceContext.withSpan("deepsearch.capabilities.load", async (span) => {
          const out = await loadDeepSearchCapabilities();
          span.setAttribute("capabilities.loaded", true);
          return out;
        });
        checkCancelled(signal);

        this.state = this._ensureState(input);

        if (!this.sourceManager) this.sourceManager = new SourceManager(this.state?.L0?.sources || []);
        else this.sourceManager.syncSources(this.state?.L0?.sources);

        if (!this.state.userConfig) this.state.userConfig = {};
        this.state.userConfig.mode = this.mode;
        if (this.globalConfig) this.state.globalConfig = this.globalConfig;

        runSpan.setAttributes({
          runId: this.state?.runId,
          mode: this.mode,
        });

        let currentPhase = "idle";
        const transitionPhase = (next) => {
          const to = typeof next === "string" && next ? next : "unknown";
          if (currentPhase === to) return;
          const span = traceContext.startSpan("deepsearch.phase.transition", {
            attributes: { from: currentPhase, to, runId: this.state?.runId },
          });
          try {
            lifecycle.phaseTransition(currentPhase, to, this.state?.runId);
          } finally {
            traceContext.endSpan(span);
          }
          currentPhase = to;
        };

        const fromStatus = this.status;
        this.status = AgentStatus.RUNNING;
        lifecycle.statusChanged(fromStatus, AgentStatus.RUNNING, this.state.runId);
        this._failureReported = false;
        await this.resetMessages();

        try {
          // ===== Optional mechanisms (DI) =====
          const {
            SkillsManager,
            BudgetManager,
            CheckpointManager,
            SharedContext,
            BacktrackManager,
            DiscoveryManager,
            MemoryStore,
            UnifiedAgentContext,
          } = capabilities;

      if (BudgetManager && !this.budget) this.budget = new BudgetManager(this.state);
      if (SharedContext && !this.sharedContext) this.sharedContext = new SharedContext();

      if (CheckpointManager && !this.checkpoint && stageApi.archive) {
        this.checkpoint = new CheckpointManager({
          archive: stageApi.archive,
          emit: (n, p) => this._emit(n, p),
          logger: this._logger,
        });
      }

      if (BacktrackManager && !this.backtrackManager) {
        this.backtrackManager = new BacktrackManager({
          archive: stageApi.archive,
          maxBacktracks: this.maxBacktracks,
          emit: (n, p) => this._emit(n, p),
          logger: this._logger,
          sideEffects: stageApi?.sideEffects || null,
        });
      }

      if (DiscoveryManager && !this.discoveryManager) {
        this.discoveryManager = new DiscoveryManager({
          sharedContext: this.sharedContext,
          runId: this.state.runId,
          logger: this._logger,
        });
      }

      const memoryConfig = this.memoryConfig || this.state?.userConfig?.memory || null;
      if (MemoryStore && !this.memory) {
        this.memory = new MemoryStore({
          runId: this.state.runId,
          config: memoryConfig,
          eventBus: this.eventBus,
          sharedContext: this.sharedContext,
          discoveryManager: this.discoveryManager,
        });
      } else if (this.memory) {
        this.memory.bind?.({ sharedContext: this.sharedContext, discoveryManager: this.discoveryManager });
      }

      if (this.state && typeof this.state.bindMemoryStore === "function") {
        this.state.bindMemoryStore(this.memory);
      }

      if (UnifiedAgentContext && !this.context) {
        this.context = new UnifiedAgentContext({ runId: this.state.runId, eventBus: this.eventBus });
        this.context.bind?.({ state: this.state, memory: this.memory, sharedContext: this.sharedContext });
      }

          lifecycle.started(this.state.runId, { mode: this.mode });
          transitionPhase("planning");

          const modeConfig = getModeConfig(this.mode, this.globalConfig);
          await traceContext.withSpan("deepsearch.messages.bootstrap", async (span) => {
            span.setAttributes({ mode: this.mode, runId: this.state?.runId });
            return await addInitialDeepSearchMessages({
              agent: this,
              stageApi,
              SkillsManager,
              modeDescription: modeConfig.description || this.mode,
            });
          });

	          const baseCallModel = getModelCaller(stageApi, { usage: "agent", state: this.state });
	          if (!baseCallModel) throw new Error("No model available");
	          const callModel = async (messages, opts = {}) => {
            const model = typeof opts?.model === "string" ? opts.model : undefined;
            const tier = typeof stageApi?.modelTier === "string" ? stageApi.modelTier : undefined;
            const messageCount = Array.isArray(messages) ? messages.length : 0;
            return await traceContext.withSpan("deepsearch.llm.call", async (span) => {
              span.setAttributes({
                runId: this.state?.runId,
                ...(tier ? { modelTier: tier } : {}),
                ...(model ? { model } : {}),
                messageCount,
              });
              return await baseCallModel(messages, opts);
            });
          };

          const responseHandler = new ModelResponseHandler({
            logger: this._logger,
            emit: (n, p) => this._emit(n, p),
            parseDecision: (content) => this._parseDecision(content),
            maxRetries: 5,
          });

      let iteration = 0;
      let toolCallCount = 0;
      let systemRetryCount = 0;
      const maxSystemRetriesPerIteration = (() => {
        const raw = this.state?.userConfig?.budget?.maxSystemRetriesPerIteration ?? this.state?.userConfig?.maxSystemRetriesPerIteration;
        const n = typeof raw === "number" && Number.isFinite(raw) ? Math.floor(raw) : null;
        return n !== null && n >= 1 ? n : 3;
      })();

          const convergencePolicy = getGapConvergencePolicy(this.state);
          const { convergence, initBaselines, emitIterationCompleted } = createIterationConvergenceTracker({ agent: this, convergencePolicy });
          initBaselines();

      const reportConvergenceConfig = normalizeReportConvergenceConfig(
        this.state?.userConfig?.convergenceDetector ??
          this.state?.userConfig?.reportConvergenceDetector ??
          this.state?.userConfig?.reportConvergence ??
          this.globalConfig?.convergenceDetector
      );
      const reportConvergenceDetector = reportConvergenceConfig.enabled
        ? new ConvergenceDetector({
            windowSize: reportConvergenceConfig.windowSize,
            ...(reportConvergenceConfig.entropyThreshold !== undefined
              ? { entropyThreshold: reportConvergenceConfig.entropyThreshold }
              : {}),
            ...(reportConvergenceConfig.similarityThreshold !== undefined
              ? { similarityThreshold: reportConvergenceConfig.similarityThreshold }
              : {}),
          })
        : null;

      const updateReportConvergence = (plannedIteration) => {
        if (!reportConvergenceDetector) return null;
        if (plannedIteration < reportConvergenceConfig.minIterations) return null;

        const report = this.context?.report || this.state?.L1?.report || null;
        const markdown = typeof report?.markdown === "string" ? report.markdown : "";
        const compactLen = markdown.replace(/\s+/g, "").length;
        if (compactLen < reportConvergenceConfig.minReportChars) return null;

        const gaps = Array.isArray(this.state?.L1?.gaps) ? this.state.L1.gaps : [];
        const sample = buildConvergenceSample({
          reportMarkdown: markdown,
          gaps,
          maxChars: reportConvergenceConfig.sampleMaxChars,
        });
        const { metrics } = reportConvergenceDetector.addSample(sample);
        const suggestion = reportConvergenceDetector.getSuggestion();
        this._emit?.("convergence.suggested", {
          iteration: plannedIteration,
          action: suggestion.action,
          reason: suggestion.reason,
          metrics,
        });
        return { suggestion, metrics };
      };

      const afterIterationCompleted = (plannedIteration) => {
        emitIterationCompleted(plannedIteration);
        const reportConvergence = updateReportConvergence(plannedIteration);
        if (reportConvergenceConfig.stopOnConvergence && reportConvergence?.suggestion?.action === "stop") {
          return { shouldStop: true, reportConvergence };
        }
        return { shouldStop: false, reportConvergence };
      };

          while (iteration < this.maxIterations) {
        const plannedIteration = iteration + 1;

        if (toolCallCount >= this.maxToolCalls) {
          this._logger.info?.(`工具调用次数达到上限 (${toolCallCount}/${this.maxToolCalls})，强制进入写作阶段`);
          break;
        }

        checkCancelled(signal);

        if (this.budget?.isExhausted?.()) {
          this._logger.warn?.("Budget exhausted");
          break;
        }

            try {
              const outcome = await traceContext.withSpan("deepsearch.iteration", async (span) => {
                span.setAttributes({
                  runId: this.state?.runId,
                  iteration: plannedIteration,
                  toolCallCount,
                  systemRetryCount,
                });

                transitionPhase("planning");
                const planned = await traceContext.withSpan("deepsearch.planning", async (planningSpan) => {
                  planningSpan.setAttributes({ runId: this.state?.runId, iteration: plannedIteration });
                  return await runPlanningPhaseIteration({
                    agent: this,
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
                  });
                });

                if (planned.status === "retry") return { action: "retry" };
                if (planned.status === "skip") {
                  iteration = plannedIteration;
                  if (this.context) this.context.iteration = iteration;
                  else this.state.iteration = iteration;
                  systemRetryCount = 0;
                  const { shouldStop } = afterIterationCompleted(plannedIteration);
                  return { action: shouldStop ? "break" : "continue" };
                }
                if (planned.status === "stop") return { action: "break" };
                if (planned.status !== "success") return { action: "break" };

                const { decision } = planned;

                if (decision?.action === "complete") {
                  await traceContext.withSpan("deepsearch.complete", async (completeSpan) => {
                    completeSpan.setAttributes({ runId: this.state?.runId, iteration: plannedIteration });
                    return await ensureReportOnComplete({ agent: this, stageApi });
                  });
                  iteration = plannedIteration;
                  systemRetryCount = 0;
                  afterIterationCompleted(plannedIteration);
                  return { action: "break" };
                }

                transitionPhase("execution");
                const executed = await traceContext.withSpan("deepsearch.execution", async (execSpan) => {
                  execSpan.setAttributes({
                    runId: this.state?.runId,
                    iteration: plannedIteration,
                    ...(typeof decision?.action === "string" ? { action: decision.action } : {}),
                    ...(Array.isArray(decision?.actions) ? { actionCount: decision.actions.length } : {}),
                  });
                  return await executeDeepSearchDecision({
                    agent: this,
                    stageApi,
                    decision,
                    plannedIteration,
                  });
                });
                toolCallCount += typeof executed?.toolCalls === "number" ? executed.toolCalls : 0;

                iteration = plannedIteration;
                systemRetryCount = 0;
                const { shouldStop } = afterIterationCompleted(plannedIteration);
                return { action: shouldStop ? "break" : "continue" };
              });
              if (outcome?.action === "retry") continue;
              if (outcome?.action === "break") break;
            } catch (err) {
          const info = classifyDeepSearchError(err);
          this._logger.error?.("Iteration error", {
            error: info.message,
            category: info.category,
            recoverable: info.recoverable,
            ...(typeof info.statusCode === "number" ? { statusCode: info.statusCode } : {}),
            ...(typeof info.code === "string" && info.code ? { code: info.code } : {}),
          });

          if (!info.recoverable) {
            this.addMessage({ role: "user", content: `致命错误: ${info.message}\n\n请检查配置/权限/网络后重试。` });
            this._markFailed(err, info, lifecycle);
            throw err;
          }

          this.addMessage({ role: "user", content: `错误: ${info.message}\n\n请尝试其他方法。` });
          systemRetryCount += 1;

          // System errors do not consume iteration budget by default.
          if (this.context) this.context.iteration = iteration;
          else this.state.iteration = iteration;

          if (systemRetryCount >= maxSystemRetriesPerIteration) {
            iteration = plannedIteration;
            if (this.context) this.context.iteration = iteration;
            else this.state.iteration = iteration;
            systemRetryCount = 0;
            this.addMessage({
              role: "user",
              content: `系统错误已连续发生 ${maxSystemRetriesPerIteration} 次，为避免卡死，已计入 1 轮迭代并继续。`,
            });
            afterIterationCompleted(plannedIteration);
          }
            }
          }

          transitionPhase("writing");
          await traceContext.withSpan("deepsearch.writing", async (span) => {
            span.setAttributes({ runId: this.state?.runId, iteration, toolCallCount });
            return await runWritingPhaseIfNeeded({
              agent: this,
              stageApi,
              callModel,
              iteration,
              toolCallCount,
              signal,
            });
          });

          lifecycle.statusChanged(this.status, AgentStatus.COMPLETED, this.state.runId);
          this.status = AgentStatus.COMPLETED;
          lifecycle.completed(this.state.runId, { iterations: iteration });
          return this._buildOutput();
        } catch (err) {
          const info = classifyDeepSearchError(err);
          this._logger.error?.("DeepSearch run failed", {
            error: info.message,
            category: info.category,
            recoverable: info.recoverable,
            ...(typeof info.statusCode === "number" ? { statusCode: info.statusCode } : {}),
            ...(typeof info.code === "string" && info.code ? { code: info.code } : {}),
          });
          this._markFailed(err, info, lifecycle);
          throw err;
        }
      },
      { attributes: { stage: "deepsearch" } }
        ),
      {
        context: {
          stage: "deepsearch",
          runId: stageApi?.runContext?.runId || input?.runId || this.state?.runId,
          shouldDegrade,
          fallbackFactory: () => this._buildOutput(),
          emit: typeof stageApi?.emit === "function" ? stageApi.emit : null,
        },
        rethrow: true,
      }
    );
  }

  _parseDecision(content) {
    try {
      const parsed = robustParseJson(content);
      if (!parsed) return null;

      if (Array.isArray(parsed.actions) && parsed.actions.length > 0) {
        return { thought: parsed.thought || "", actions: parsed.actions };
      }
      return { thought: parsed.thought || "", action: parsed.action || "complete", args: parsed.args || {} };
    } catch {
      return null;
    }
  }

  _buildOutput() {
    const ctx = this.context;
    return {
      runId: ctx?.runId || this.state.runId,
      status: this.status,
      report: ctx?.report || this.state.L1?.report || null,
      todos: ctx?.todos || this.state.todos || [],
      claims: ctx?.claims || this.state.L1?.claims || [],
    };
  }

  _ensureState(input) {
    if (input instanceof DeepSearchState) return input;
    if (input?.state instanceof DeepSearchState) return input.state;
    if (isPlainObject(input?.state)) return DeepSearchState.fromJSON(input.state);
    if (isPlainObject(input)) return DeepSearchState.fromJSON(input);
    return new DeepSearchState();
  }

  getAgentContextStatus() {
    if (this.context?.getContextStatus) return this.context.getContextStatus();
    return {
      runId: this.state?.runId,
      iteration: this.state?.iteration || 0,
      todoCount: this.state?.todos?.length || 0,
      claimCount: this.state?.L1?.claims?.length || 0,
    };
  }
}

export default DeepSearchAgentLoop;
