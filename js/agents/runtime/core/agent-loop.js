import { createStageApi } from "../../shared/index.js";
import { checkCancelled, mergeSignals } from "../../shared/index.js";
import { StagePausedError } from "./stage-errors.js";
import { getRuntimeState } from "./loop-runtime-state.js";
import { estimateTokensCached } from "../../shared/index.js";
import { getGlobalTokenCounter } from "../../shared/index.js";
import { DEFAULT_CONTEXT_CONFIG, mergeContextConfig } from "./context-config.js";
import { MessageHandling } from "./agent-loop-message-handling.js";
import { ToolDispatch } from "./agent-loop-tool-dispatch.js";
import { LoopStatusController } from "./agent-loop-status.js";
import { StepRunner } from "./agent-loop-steps.js";
import { PhaseRunner } from "./agent-loop-phases.js";
import { UserActionHandler } from "./agent-loop-user-actions.js";
import { runWithAgentLifecycleHooks } from "./agent-loop-lifecycle-hooks.js";

/**
 * @typedef {Record<string, any>} AnyRecord
 *
 * @typedef {{ process?: { env?: Record<string, string | undefined> } }} GlobalThisWithProcessEnv
 *
 * @typedef {ImportMeta & { env?: { MODE?: unknown } }} ImportMetaWithEnv
 *
 * @typedef {(eventName: string, record: { actor?: string, status?: string, payload?: any }) => void} EmitFn
 *
 * @typedef {{ emit?: EmitFn, subscribe?: (eventName: string, handler: (evt: any) => void, options?: { signal?: AbortSignal }) => (() => void) }} EventBusLike
 *
 * @typedef {{ warn?: (...args: any[]) => void, info?: (...args: any[]) => void, error?: (...args: any[]) => void, debug?: (...args: any[]) => void }} LoggerLike
 *
 * @typedef {{ count: (text: string) => number }} TokenCounterLike
 *
 * @typedef {{ ok: boolean, data?: any, error?: any, [key: string]: any }} ToolResult
 *
 * @typedef {(name: string, params: any, context?: any) => any | Promise<any>} ToolExecutor
 * @typedef {{ execute: (name: string, params: any, context?: any) => any | Promise<any> }} ToolExecutorContainer
 *
 * @typedef {{ signal?: AbortSignal, eventBus?: EventBusLike | null, emit?: EmitFn | null, checkCancelled?: (() => void) | null }} StageApiLike
 *
 * @typedef {{ force?: boolean, allowReset?: boolean, strict?: boolean, [key: string]: any }} LoopStatusTransitionMeta
 *
 * @typedef {{ name?: string, eventBus?: EventBusLike | null, logger?: LoggerLike | null }} BaseStageOptions
 *
 * @typedef {object} BaseAgentLoopOptions
 * @property {EventBusLike | null} [eventBus]
 * @property {{ transition?: Function } | null} [stateMachine]
 * @property {Record<string, Function> | Array<[string, Function]> | Map<string, Function> | null} [tools]
 * @property {string} [actor]
 * @property {string} [stageName]
 * @property {EmitFn | null} [emit]
 * @property {{ before?: Array<(ctx: any) => any>, after?: Array<(ctx: any) => any> } | null} [hooks]
 * @property {AnyRecord | null} [contextConfig]
 * @property {LoggerLike | null} [logger]
 * @property {boolean} [strictLoopStatus]
 * @property {TokenCounterLike | null} [tokenCounter]
 * @property {number} [maxUserInputs]
 *
 * @typedef {{ timeout?: number, eventBus?: EventBusLike | null, signal?: AbortSignal }} WaitForUserActionOptions
 * @typedef {{ eventName?: string, signal?: AbortSignal }} AttachListenerOptions
 * @typedef {{ clear?: boolean }} ConsumeUserInputsOptions
 * @typedef {{ clear?: boolean }} DrainUserInputsOptions
 * @typedef {{ key?: string }} ApplyUserInputsOptions
 *
 * @typedef {object} TransitionPhaseOptions
 * @property {EmitFn | null} [emit]
 * @property {string | null} [runId]
 * @property {AnyRecord | null} [payload]
 * @property {string | null} [eventName]
 *
 * @typedef {object} StepMeta
 * @property {string} [stepId]
 * @property {string} [name]
 * @property {string} [step]
 * @property {string | null} [runId]
 * @property {number | null} [iteration]
 * @property {any} [meta]
 *
 * @typedef {{ payload: any, ts: number }} UserInputEntry
 *
 * @typedef {object} StepInfo
 * @property {string} stepId
 * @property {string} name
 * @property {string | null} runId
 * @property {number | null} iteration
 * @property {number} startedAt
 * @property {any} meta
 *
 * @typedef {StepInfo & { signal: AbortSignal, controller: AbortController }} ActiveStep
 *
 * @typedef {{ status?: string, error?: any, result?: any }} EndStepOptions
 */

// Re-export 组合类供外部使用
export { MessageManager } from "./message-manager.js";
export { ToolRegistry } from "./tool-registry.js";
export { StatusController } from "./status-controller.js";

// Re-export 配置供外部自定义
export { DEFAULT_CONTEXT_CONFIG, mergeContextConfig };

// 简单 token 估算 (4 chars ≈ 1 token)
/**
 * @param {unknown} text
 * @param {TokenCounterLike | null | undefined} tokenCounter
 * @returns {number}
 */
function estimateTokens(text, tokenCounter) {
  if (text === null || text === undefined) return 0;
  let rawText = "";
  if (typeof text === "string") {
    rawText = text;
  } else {
    try {
      rawText = JSON.stringify(text);
    } catch {
      rawText = String(text);
    }
  }
  return estimateTokensCached(rawText, tokenCounter);
}

/**
 * @returns {boolean}
 */
function isProductionRuntime() {
  try {
    const g = /** @type {GlobalThisWithProcessEnv} */ (typeof globalThis !== "undefined" ? globalThis : {});
    const env = g?.process?.env ?? null;
    if (env && typeof env.NODE_ENV === "string") return env.NODE_ENV === "production";
  } catch { /* intentional: process.env may not exist */ }
  try {
    const meta = /** @type {ImportMetaWithEnv} */ (import.meta);
    const mode = meta?.env?.MODE;
    if (typeof mode === "string") return mode === "production";
  } catch { /* intentional: import.meta.env may not exist */ }
  return false;
}

/**
 * @param {unknown} value
 * @returns {boolean | undefined}
 */
function parseBooleanish(value) {
  if (value === true || value === false) return value;
  const s = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!s) return undefined;
  if (["1", "true", "yes", "y", "on", "enabled"].includes(s)) return true;
  if (["0", "false", "no", "n", "off", "disabled"].includes(s)) return false;
  return undefined;
}

/**
 * @param {unknown} explicit
 * @returns {boolean}
 */
function resolveStrictLoopStatusTransitions(explicit) {
  if (explicit === true || explicit === false) return explicit;

  const g = /** @type {GlobalThisWithProcessEnv} */ (typeof globalThis !== "undefined" ? globalThis : {});
  const env = g?.process?.env ?? null;
  const fromEnv = parseBooleanish(env?.PB_STRICT_LOOP_STATUS_TRANSITIONS);
  if (typeof fromEnv === "boolean") return fromEnv;

  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem("pb_strictLoopStatusTransitions") : null;
    const fromStorage = parseBooleanish(raw);
    if (typeof fromStorage === "boolean") return fromStorage;
  } catch { /* intentional: localStorage may be blocked */ }

  // Default: enforce everywhere (illegal transitions are bugs).
  return true;
}

// isAllowedLoopStatusTransition moved to agent-loop-phases.js
export { isAllowedLoopStatusTransition } from "./agent-loop-phases.js";

/**
 * @param {any} ctx
 * @returns {EmitFn | null}
 */
export function getEmitFn(ctx) {
  const emit = ctx?.emit || ctx?.eventBus?.emit;
  return typeof emit === "function" ? emit : null;
}

export { checkCancelled };

/**
 * @param {AbortSignal | null | undefined} signal
 * @throws {StagePausedError}
 */
export function checkPaused(signal) {
  const runtimeState = getRuntimeState(signal);
  if (!runtimeState) return;
  if (runtimeState.status !== "paused") return;

  throw new StagePausedError("Run paused", {
    checkpointId: runtimeState.lastCheckpointId ?? null,
    reason: runtimeState.pausedReason ?? null,
    timestamp: Date.now(),
  });
}

/**
 * @param {AbortSignal | null | undefined} signal
 */
export function checkCancelledOrPaused(signal) {
  checkCancelled(signal);
  checkPaused(signal);
}

// Re-export from contracts for backward compatibility
export { normalizeToolResult, resolveToolExecutor } from "./agent-loop-tool-dispatch.js";



export class BaseStage {
  /**
   * @param {BaseStageOptions} [options]
   */
  constructor({ name, eventBus, logger } = {}) {
    this.name = name || "stage";
    this.eventBus = eventBus || null;
    this.logger = logger || null;
  }

  // Standard stage entrypoint.
  /**
   * @param {any} runContext
   * @param {any} input
   * @param {StageApiLike | null | undefined} [stageApi]
   * @returns {Promise<any>}
   */
  async execute(runContext, input, stageApi = {}) {
    /** @type {StageApiLike} */
    const base = stageApi && typeof stageApi === "object" ? stageApi : {};
    const api = createStageApi({ ...base, eventBus: base.eventBus || this.eventBus });
    api.checkCancelled?.();

    this._emitStage("started", {}, api);
    try {
      const result = await this.run(input, { runContext, ...api });
      this._emitStage("completed", { result }, api);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this._emitStage("failed", { error: message }, api);
      throw err;
    }
  }

  // Subclasses must implement.
  /**
   * @param {any} _input
   * @param {any} _context
   * @returns {Promise<any>}
   */
  async run(_input, _context) {
    throw new Error("Subclass must implement run()");
  }

  /**
   * @param {string} status
   * @param {AnyRecord} payload
   * @param {StageApiLike} api
   */
  _emitStage(status, payload, api) {
    const stageName = String(this.name || "").trim();
    if (!stageName) return;
    api.emit?.(`${stageName}.${status}`, { actor: stageName, status, payload });
  }
}

export class BaseAgentLoop {
  /**
   * @param {BaseAgentLoopOptions} [options]
   */
  constructor({
    eventBus,
    stateMachine,
    tools,
    actor,
    stageName,
    emit,
    hooks,
    contextConfig,
    logger,
    strictLoopStatus,
    tokenCounter,
    maxUserInputs,
  } = {}) {
    this.eventBus = eventBus || null;
    this.logger = logger || null;
    this.stateMachine = stateMachine || null;
    this.actor = actor || stageName || "agent";
    this.stageName = stageName || actor || "agent";
    this.emit = typeof emit === "function" ? emit : null;

    this._messageHandling = new MessageHandling(this, {
      contextConfig,
      tokenCounter,
      logger,
      emit: this.emit,
      stageName: this.stageName,
      actor: this.actor,
      maxUserInputs,
    });

    this._toolDispatch = new ToolDispatch(this, { tools, hooks, logger });

    this._statusMixin = new LoopStatusController(this, {
      strictLoopStatus,
      logger,
      emit: this.emit,
      stageName: this.stageName,
      actor: this.actor,
    });

    this._stepMixin = new StepRunner(this);
    this._phaseMixin = new PhaseRunner(this);
    this._userActionMixin = new UserActionHandler(this);
    this._executeAbortController = null;
  }

  /**
   * Subclasses should implement: (input, context) => Promise<unknown>
   * @param {any} _input
   * @param {AnyRecord} _context
   * @returns {Promise<any>}
   */
  async run(_input, _context) {
    throw new Error("BaseAgentLoop.run() is not implemented");
  }

  /**
   * @param {any} runContext
   * @param {any} input
   * @param {StageApiLike | null | undefined} [stageApi]
   * @returns {Promise<any>}
   */
  async execute(runContext, input, stageApi = {}) {
    /** @type {StageApiLike} */
    const base = stageApi && typeof stageApi === "object" ? stageApi : {};

    // Ensure we can clean up all per-execute subscriptions (EventBus listeners, etc.).
    if (this._executeAbortController && !this._executeAbortController.signal.aborted) {
      try {
        this._executeAbortController.abort("superseded");
      } catch {
        // ignore
      }
    }
    const executeController = new AbortController();
    this._executeAbortController = executeController;

    const combinedSignal = mergeSignals(base.signal, executeController.signal) || base.signal || executeController.signal;
    const context = { ...base, runContext, signal: combinedSignal };

    this.eventBus = base.eventBus || this.eventBus || null;
    this.emit = getEmitFn(base) || this.emit || this.eventBus?.emit || null;

    if (this.eventBus) {
      this._attachUserInputListener(this.eventBus, { signal: combinedSignal });
      this._attachPauseListener(this.eventBus, { signal: combinedSignal });
    }

    // 生成 runId 用于追踪
    const runId = `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const startTime = Date.now();
    const sessionId = runContext?.sessionId || runContext?.id || null;

    try {
      return await runWithAgentLifecycleHooks({
        loop: this,
        runId,
        sessionId,
        input,
        context,
        stageApi: base,
        startTime,
      });
    } finally {
      try {
        executeController.abort("completed");
      } catch {
        // ignore
      }
      this._detachEventBusListeners();
      if (this._executeAbortController === executeController) this._executeAbortController = null;
    }
  }

  // ===== MessageHandling delegates =====

  /** @returns {any[]} */
  get messages() {
    return this._messageHandling.messages;
  }

  /** @returns {any} */
  get _contextConfig() {
    return this._messageHandling._contextConfig;
  }

  /** @param {any} value */
  set _contextConfig(value) {
    this._messageHandling._contextConfig = value;
  }

  /** @returns {{ input: number, output: number, total: number }} */
  get _tokenUsage() {
    return this._messageHandling._tokenUsage;
  }

  /** @returns {any[]} */
  get _compressionHistory() {
    return this._messageHandling._compressionHistory;
  }

  /** @returns {Promise<void> | null} */
  get _compressionPromise() {
    return this._messageHandling._compressionPromise;
  }

  /** @returns {boolean} */
  get _compressionPending() {
    return this._messageHandling._compressionPending;
  }

  /** @param {any} message */
  addMessage(message) {
    return this._messageHandling.addMessage(message);
  }

  /** @param {any[]} messages */
  addMessages(messages) {
    return this._messageHandling.addMessages(messages);
  }

  /** @param {{ clearCompressionHistory?: boolean } | null | undefined} [options] */
  async resetMessages(options = {}) {
    return this._messageHandling.resetMessages(options);
  }

  /** @returns {boolean} */
  _shouldCompress() {
    return this._messageHandling._shouldCompress();
  }

  /** @param {{ force?: boolean } | null | undefined} [options] */
  _scheduleCompression(options) {
    return this._messageHandling._scheduleCompression(options);
  }

  /** @param {{ maxRounds?: number } | null | undefined} [options] */
  async flushCompression(options) {
    return this._messageHandling.flushCompression(options);
  }

  /** @returns {Promise<void>} */
  async _compressMessages() {
    return this._messageHandling._compressMessages();
  }

  /** @returns {any} */
  getContextStatus() {
    return this._messageHandling.getContextStatus();
  }

  /** @param {AnyRecord} config */
  setContextConfig(config) {
    return this._messageHandling.setContextConfig(config);
  }

  /**
   * @param {EventBusLike} eventBus
   * @param {AttachListenerOptions} [options]
   */
  _attachUserInputListener(eventBus, options = {}) {
    return this._messageHandling._attachUserInputListener(eventBus, options);
  }

  /**
   * @param {EventBusLike} eventBus
   * @param {{ signal?: AbortSignal }} [options]
   */
  _attachPauseListener(eventBus, options = {}) {
    return this._messageHandling._attachPauseListener(eventBus, options);
  }

  /** @returns {void} */
  _detachEventBusListeners() {
    return this._messageHandling._detachEventBusListeners();
  }

  /**
   * @param {any} payload
   * @returns {UserInputEntry}
   */
  recordUserInput(payload) {
    return this._messageHandling.recordUserInput(payload);
  }

  /**
   * @param {ConsumeUserInputsOptions} [options]
   * @returns {UserInputEntry[]}
   */
  consumeUserInputs(options = {}) {
    return this._messageHandling.consumeUserInputs(options);
  }

  /**
   * @param {DrainUserInputsOptions} [options]
   * @returns {{ items: UserInputEntry[], text: string }}
   */
  drainUserInputsAsText(options = {}) {
    return this._messageHandling.drainUserInputsAsText(options);
  }

  /**
   * @param {AnyRecord} userConfig
   * @param {ApplyUserInputsOptions} [options]
   * @returns {AnyRecord}
   */
  applyUserInputsToConfig(userConfig, options = {}) {
    return this._messageHandling.applyUserInputsToConfig(userConfig, options);
  }

  /** @returns {boolean} */
  hasPendingUserInputs() {
    return this._messageHandling.hasPendingUserInputs();
  }

  /**
   * @param {Array<UserInputEntry | any>} items
   * @returns {string}
   */
  formatUserInputs(items) {
    return this._messageHandling.formatUserInputs(items);
  }

  // ===== ToolDispatch delegates =====

  /** @param {any} tools */
  registerTools(tools) {
    return this._toolDispatch.registerTools(tools);
  }

  /** @param {string} name @param {Function} fn */
  registerTool(name, fn) {
    return this._toolDispatch.registerTool(name, fn);
  }

  /** @param {"before"|"after"} phase @param {(ctx: any) => any} fn @returns {this} */
  useHook(phase, fn) {
    this._toolDispatch.useHook(phase, fn);
    return this;
  }

  /** @param {string} name @param {any} params @param {any} context @returns {Promise<ToolResult>} */
  async _callTool(name, params, context) {
    return this._toolDispatch._callTool(name, params, context);
  }

  // ===== LoopStatusController delegates =====

  /** @returns {string} */
  get loopStatus() {
    return this._statusMixin.loopStatus;
  }

  /** @returns {string} */
  get _loopStatus() {
    return this._statusMixin._loopStatus;
  }

  /** @param {string} value */
  set _loopStatus(value) {
    this._statusMixin._loopStatus = value;
  }

  /** @returns {boolean} */
  get isPaused() {
    return this._statusMixin.isPaused;
  }

  /** @returns {boolean} */
  get _pauseRequested() {
    return this._statusMixin._pauseRequested;
  }

  /** @param {boolean} value */
  set _pauseRequested(value) {
    this._statusMixin._pauseRequested = value;
  }

  /** @returns {string | null} */
  get _pauseReason() {
    return this._statusMixin._pauseReason;
  }

  /** @param {string | null} value */
  set _pauseReason(value) {
    this._statusMixin._pauseReason = value;
  }

  /** @returns {any[]} */
  get statusHistory() {
    return this._statusMixin.statusHistory;
  }

  /** @returns {any[]} */
  get _statusHistory() {
    return this._statusMixin._statusHistory;
  }

  /** @param {{ status?: string, machine?: any, eventName?: string, strict?: boolean } | null | undefined} [options] */
  initLoopStatus(options = {}) {
    this._statusMixin.initLoopStatus(options);
  }

  /** @param {string} [reason] */
  pause(reason = "user_requested") {
    this._statusMixin.pause(reason);
  }

  /** @returns {void} */
  resume() {
    this._statusMixin.resume();
  }

  /** @param {string} newStatus @param {LoopStatusTransitionMeta} [metadata] */
  _transitionLoopStatus(newStatus, metadata = {}) {
    return this._statusMixin._transitionLoopStatus(newStatus, metadata);
  }

  /** @param {AbortSignal | null | undefined} signal */
  _checkPaused(signal) {
    return this._statusMixin._checkPaused(signal);
  }

  /** @param {{ signal?: AbortSignal, runId?: string | null } | null | undefined} [options] */
  _createPauseError(options) {
    return this._statusMixin._createPauseError(options);
  }

  /** @param {any} err @param {AbortSignal | null | undefined} signal */
  _shouldPauseFromError(err, signal) {
    return this._statusMixin._shouldPauseFromError(err, signal);
  }

  /** @param {any} err @param {AbortSignal | null | undefined} signal */
  _isAbortError(err, signal) {
    return this._statusMixin._isAbortError(err, signal);
  }

  // ===== StepRunner delegates =====

  /**
   * @param {StepMeta} [stepMeta]
   * @param {AnyRecord} [context]
   * @returns {{ step: StepInfo, context: AnyRecord }}
   */
  _beginStep(stepMeta = {}, context = {}) {
    return this._stepMixin._beginStep(stepMeta, context);
  }

  /**
   * @param {{ step?: StepInfo } | null | undefined} stepInfo
   * @param {EndStepOptions} [options]
   */
  _endStep(stepInfo, options = {}) {
    this._stepMixin._endStep(stepInfo, options);
  }

  /**
   * @param {string} status
   * @param {AnyRecord} payload
   */
  _emitStepEvent(status, payload) {
    this._stepMixin._emitStepEvent(status, payload);
  }

  /** @param {string | null | undefined} reason */
  _abortActiveStep(reason) {
    this._stepMixin._abortActiveStep(reason);
  }

  /**
   * @param {AbortSignal | null | undefined} parentSignal
   * @returns {{ signal: AbortSignal, controller: AbortController }}
   */
  _createStepSignal(parentSignal) {
    return this._stepMixin._createStepSignal(parentSignal);
  }

  // ===== PhaseRunner delegates =====

  /**
   * @param {string} serviceId
   * @param {any} context
   * @param {any} fallback
   * @returns {Promise<any>}
   */
  _resolveDependency(serviceId, context, fallback) {
    return this._phaseMixin._resolveDependency(serviceId, context, fallback);
  }

  /**
   * @param {any} state
   * @param {string} next
   * @param {TransitionPhaseOptions} [options]
   * @returns {string}
   */
  _transitionPhase(state, next, options = {}) {
    return this._phaseMixin._transitionPhase(state, next, options);
  }

  // ===== UserActionHandler delegates =====

  /**
   * @param {string} actionName
   * @param {WaitForUserActionOptions} [options]
   * @returns {Promise<any>}
   */
  waitForUserAction(actionName, options = {}) {
    return this._userActionMixin.waitForUserAction(actionName, options);
  }
}
