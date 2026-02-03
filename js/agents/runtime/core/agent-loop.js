import { createStageApi } from "../../shared/index.js";
import { checkCancelled } from "../../shared/index.js";
import { StagePausedError } from "./stage-errors.js";
import { AgentStatus, isValidAgentStatus } from "./agent-status.js";
import { getRuntimeState } from "./loop-runtime-state.js";
import { estimateTokensCached } from "../../shared/index.js";
import { getGlobalTokenCounter } from "../../shared/index.js";
import { StatusController } from "./status-controller.js";
import { DEFAULT_CONTEXT_CONFIG, mergeContextConfig } from "./context-config.js";
import { initMessageHandling, attachMessageHandling } from "./agent-loop-message-handling.js";
import { initToolDispatch, attachToolDispatch } from "./agent-loop-tool-dispatch.js";
import { runWithAgentLifecycleHooks } from "./agent-loop-lifecycle-hooks.js";

/**
 * @typedef {Record<string, any>} AnyRecord
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
export { StatusController };

// Re-export 配置供外部自定义
export { DEFAULT_CONTEXT_CONFIG, mergeContextConfig };

const USER_ACTION_PREFIX = "user.action";

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
    /** @type {any} */
    const g = typeof globalThis !== "undefined" ? globalThis : {};
    const env = g?.process?.env ?? null;
    if (env && typeof env.NODE_ENV === "string") return env.NODE_ENV === "production";
  } catch { /* intentional: process.env may not exist */ }
  try {
    /** @type {any} */
    const meta = import.meta;
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

  /** @type {any} */
  const g = typeof globalThis !== "undefined" ? globalThis : {};
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

/** @type {Record<string, readonly string[]>} */
const DEFAULT_LOOP_STATUS_TRANSITIONS = Object.freeze({
  [AgentStatus.IDLE]: [AgentStatus.RUNNING, AgentStatus.COMPLETED, AgentStatus.FAILED],
  [AgentStatus.RUNNING]: [AgentStatus.PAUSED, AgentStatus.COMPLETED, AgentStatus.FAILED],
  [AgentStatus.PAUSED]: [AgentStatus.RUNNING, AgentStatus.COMPLETED, AgentStatus.FAILED],
  [AgentStatus.COMPLETED]: [AgentStatus.IDLE],
  [AgentStatus.FAILED]: [AgentStatus.IDLE],
});

/**
 * @param {string} from
 * @param {string} to
 * @param {LoopStatusTransitionMeta} [meta]
 * @returns {boolean}
 */
function isAllowedLoopStatusTransition(from, to, meta = /** @type {LoopStatusTransitionMeta} */ ({})) {
  if (meta && typeof meta === "object") {
    if (meta.force) return true;
    if (meta.allowReset && to === AgentStatus.IDLE) return true;
  }
  if (!isValidAgentStatus(from) || !isValidAgentStatus(to)) return true;
  const allowed = DEFAULT_LOOP_STATUS_TRANSITIONS[from] || [];
  return allowed.includes(/** @type {any} */ (to));
}

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

/**
 * @param {AbortSignal | null | undefined} a
 * @param {AbortSignal | null | undefined} b
 * @returns {AbortSignal | null}
 */
function mergeSignals(a, b) {
  const signals = [a, b].filter(Boolean);
  if (signals.length === 0) return null;
  if (signals.length === 1) return signals[0];
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.any === "function") return AbortSignal.any(signals);

  const controller = new AbortController();
  const abort = () => controller.abort();
  for (const s of signals) {
    if (s.aborted) return s;
    s.addEventListener?.("abort", abort, { once: true });
  }
  return controller.signal;
}

let _stepSeq = 0;
/**
 * @param {string | null | undefined} prefix
 * @returns {string}
 */
function buildStepId(prefix) {
  _stepSeq += 1;
  const base = prefix && typeof prefix === "string" ? prefix : "step";
  return `${base}_${Date.now().toString(36)}_${_stepSeq}`;
}

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

    initMessageHandling(this, {
      contextConfig,
      tokenCounter,
      logger,
      emit: this.emit,
      stageName: this.stageName,
      actor: this.actor,
      maxUserInputs,
    });

    initToolDispatch(this, { tools, hooks, logger });

    this._statusController = new StatusController({
      status: AgentStatus.IDLE,
      machine: null,
      eventName: null,
      strict: strictLoopStatus,
      logger,
      emit: this.emit,
      stageName: this.stageName,
      actor: this.actor,
    });

    this._activeStep = null;
    this._executeAbortController = null;
  }

  /**
   * @param {EventBusLike} _eventBus
   * @param {AttachListenerOptions} [_options]
   * @returns {void}
   */
  _attachUserInputListener(_eventBus, _options = {}) {}

  /**
   * @param {EventBusLike} _eventBus
   * @param {{ signal?: AbortSignal }} [_options]
   * @returns {void}
   */
  _attachPauseListener(_eventBus, _options = {}) {}

  /** @returns {void} */
  _detachEventBusListeners() {}

  // ===== 状态管理 (委托给 StatusController) =====

  /** @returns {string} */
  get loopStatus() {
    return this._statusController.status;
  }

  /** @returns {string} */
  get _loopStatus() {
    return this._statusController._loopStatus;
  }

  /** @param {string} value */
  set _loopStatus(value) {
    this._statusController._loopStatus = value;
  }

  /** @returns {boolean} */
  get isPaused() {
    return this._statusController.isPaused;
  }

  /** @returns {boolean} */
  get _pauseRequested() {
    return this._statusController._pauseRequested;
  }

  /** @param {boolean} value */
  set _pauseRequested(value) {
    this._statusController._pauseRequested = value;
  }

  /** @returns {string | null} */
  get _pauseReason() {
    return this._statusController._pauseReason;
  }

  /** @param {string | null} value */
  set _pauseReason(value) {
    this._statusController._pauseReason = value;
  }

  /** @returns {any[]} */
  get statusHistory() {
    return this._statusController.statusHistory;
  }

  /** @returns {any[]} */
  get _statusHistory() {
    return this._statusController._statusHistory;
  }

  /** @param {{ status?: string, machine?: any, eventName?: string, strict?: boolean } | null | undefined} [options] */
  initLoopStatus({ status, machine, eventName, strict } = {}) {
    this._statusController.init({ status, machine, eventName, strict });
  }

  /** @param {string} [reason] */
  pause(reason = "user_requested") {
    this._statusController.pause(reason);
    this._abortActiveStep(reason);
  }

  /** @returns {void} */
  resume() {
    this._statusController.resume();
  }

  /** @param {string} newStatus @param {LoopStatusTransitionMeta} [metadata] */
  _transitionLoopStatus(newStatus, metadata = {}) {
    return this._statusController.transition(newStatus, metadata);
  }

  /** @param {AbortSignal | null | undefined} signal */
  _checkPaused(signal) {
    return this._statusController.checkPaused(signal);
  }

  /** @param {{ signal?: AbortSignal, runId?: string | null } | null | undefined} [options] */
  _createPauseError(options) {
    return this._statusController.createPauseError(options);
  }

  /** @param {any} err @param {AbortSignal | null | undefined} signal */
  _shouldPauseFromError(err, signal) {
    return this._statusController.shouldPauseFromError(err, signal);
  }

  /** @param {any} err @param {AbortSignal | null | undefined} signal */
  _isAbortError(err, signal) {
    return this._statusController._isAbortError(err, signal);
  }

  /**
   * @param {any} state
   * @param {string} next
   * @param {TransitionPhaseOptions} [options]
   * @returns {string}
   */
  _transitionPhase(state, next, { emit, runId, payload, eventName } = {}) {
    const from = state?.status ?? state?.state;
    let ok = true;
    if (this.stateMachine && typeof this.stateMachine.transition === "function") {
      ok = this.stateMachine.transition(state, next, { runId, from, to: next, ...payload });
    } else if (state && typeof state === "object") {
      if ("status" in state) state.status = next;
      else if ("state" in state) state.state = next;
      else state.status = next;
    }

    if (!ok) {
      throw new Error(`${this.stageName} phase transition rejected: ${from} -> ${next}`);
    }

    const emitFn = emit || this.emit || this.eventBus?.emit;
    if (typeof emitFn === "function") {
      emitFn(eventName || `${this.stageName}.phase.transition`, {
        actor: this.actor,
        status: "progress",
        payload: { runId, from, to: next, ...payload },
      });
    }

    return next;
  }

  /**
   * @param {string} actionName
   * @param {WaitForUserActionOptions} [options]
   * @returns {Promise<any>}
   */
  async waitForUserAction(actionName, { timeout = 300000, eventBus, signal } = {}) {
    const bus = eventBus || this.eventBus;
    if (!bus || typeof bus.subscribe !== "function") {
      throw new Error("waitForUserAction: eventBus with subscribe() is required");
    }

    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (err, payload) => {
        if (done) return;
        done = true;
        clearTimeout(timeoutId);
        off?.();
        if (signal && typeof signal.removeEventListener === "function") {
          signal.removeEventListener("abort", onAbort);
        }
        if (err) reject(err);
        else resolve(payload);
      };

      const onAbort = () => {
        finish(new Error("Run cancelled"));
      };

      if (signal && typeof signal.addEventListener === "function") {
        signal.addEventListener("abort", onAbort, { once: true });
      }

      const timeoutId = setTimeout(() => {
        finish(new Error(`Timeout waiting for user action: ${actionName}`));
      }, timeout);

      const off = bus.subscribe(`${USER_ACTION_PREFIX}.${actionName}`, (evt) => {
        const payload = evt && typeof evt === "object" && "payload" in evt ? evt.payload : evt;
        finish(null, payload);
      });
    });
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

  /**
   * @param {StepMeta} [stepMeta]
   * @param {AnyRecord} [context]
   * @returns {{ step: StepInfo, context: AnyRecord }}
   */
  _beginStep(stepMeta = {}, context = {}) {
    const meta = stepMeta && typeof stepMeta === "object" ? stepMeta : {};
    const stepId = meta.stepId || buildStepId(this.stageName);
    const startedAt = Date.now();
    const { signal, controller } = this._createStepSignal(context.signal);
    const step = {
      stepId,
      name: meta.name || meta.step || "step",
      runId: meta.runId || null,
      iteration: meta.iteration ?? null,
      startedAt,
      meta: meta.meta || null,
    };
    this._activeStep = { ...step, signal, controller };
    this._emitStepEvent("started", step);
    return {
      step,
      context: { ...context, signal },
    };
  }

  /**
   * @param {{ step?: StepInfo } | null | undefined} stepInfo
   * @param {EndStepOptions} [options]
   */
  _endStep(stepInfo, { status = "completed", error, result } = {}) {
    const step = stepInfo?.step || this._activeStep;
    if (!step) return;
    const payload = /** @type {AnyRecord} */ ({ ...step });
    if (error) payload.error = error;
    if (result !== undefined) payload.result = result;
    this._emitStepEvent(status, payload);
    if (this._activeStep && this._activeStep.stepId === step.stepId) {
      this._activeStep = null;
    }
  }

  /**
   * @param {string} status
   * @param {AnyRecord} payload
   */
  _emitStepEvent(status, payload) {
    const emit = this.emit || this.eventBus?.emit;
    if (typeof emit !== "function") return;
    emit(`${this.stageName}.step.${status}`, { actor: this.actor, status, payload });
  }

  /** @param {string | null | undefined} reason */
  _abortActiveStep(reason) {
    const controller = this._activeStep?.controller;
    if (!controller || controller.signal.aborted) return;
    controller.abort(reason || "paused");
  }

  /**
   * @param {AbortSignal | null | undefined} parentSignal
   * @returns {{ signal: AbortSignal, controller: AbortController }}
   */
  _createStepSignal(parentSignal) {
    const controller = new AbortController();
    const signal = mergeSignals(parentSignal, controller.signal) || controller.signal;
    return { signal, controller };
  }
}

attachMessageHandling(BaseAgentLoop);
attachToolDispatch(BaseAgentLoop);
