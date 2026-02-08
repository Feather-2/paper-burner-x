import { createStageApi } from "../../shared/index.js";
import { checkCancelled, mergeSignals } from "../../shared/index.js";
import { StagePausedError } from "./stage-errors.js";
import { AgentStatus, isValidAgentStatus } from "./agent-status.js";
import { getRuntimeState } from "./loop-runtime-state.js";
import { estimateTokensCached } from "../../shared/index.js";
import { getGlobalTokenCounter } from "../../shared/index.js";
import { DEFAULT_CONTEXT_CONFIG, mergeContextConfig } from "./context-config.js";
import { initMessageHandling, attachMessageHandling } from "./agent-loop-message-handling.js";
import { initToolDispatch, attachToolDispatch } from "./agent-loop-tool-dispatch.js";
import { initStatusMixin, attachStatusMixin } from "./agent-loop-status-mixin.js";
import { initStepMixin, attachStepMixin } from "./agent-loop-step-mixin.js";
import { attachPhaseMixin } from "./agent-loop-phase-mixin.js";
import { attachUserActionMixin } from "./agent-loop-user-action-mixin.js";
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

// isAllowedLoopStatusTransition moved to agent-loop-phase-mixin.js
export { isAllowedLoopStatusTransition } from "./agent-loop-phase-mixin.js";

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

    initStatusMixin(this, {
      strictLoopStatus,
      logger,
      emit: this.emit,
      stageName: this.stageName,
      actor: this.actor,
    });

    initStepMixin(this);
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

}

attachMessageHandling(BaseAgentLoop);
attachToolDispatch(BaseAgentLoop);
attachStatusMixin(BaseAgentLoop);
attachStepMixin(BaseAgentLoop);
attachPhaseMixin(BaseAgentLoop);
attachUserActionMixin(BaseAgentLoop);
