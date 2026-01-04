import { createStageApi } from "../../shared/utils/stage-api.js";
import { checkCancelled } from "../../shared/utils/cancellation.js";
import { StagePausedError } from "./stage-errors.js";
import { AgentStatus, isValidAgentStatus } from "./agent-status.js";
import { getRuntimeState } from "../telemetry/loop-runtime-state.js";
import { estimateTokensCached } from "../../shared/utils/token-cache.js";
import { getGlobalTokenCounter } from "../../shared/tokenizers/adaptive-token-counter.js";
import { CompressionCoordinator } from "../compression/coordinator.js";
import { MessageManager } from "./message-manager.js";
import { ToolRegistry } from "./tool-registry.js";
import { StatusController } from "./status-controller.js";

// Re-export 组合类供外部使用
export { MessageManager, ToolRegistry, StatusController };

const USER_ACTION_PREFIX = "user.action";

// 默认上下文配置
const DEFAULT_CONTEXT_CONFIG = Object.freeze({
  contextWindow: 128000,      // 默认 128K tokens
  maxOutputTokens: 4096,      // 默认输出限制
  compressThreshold: 0.9,     // 90% 触发压缩
  compressCooldownMs: 5000,   // 压缩触发冷却（避免频繁触发）
  keepLastTurns: 6,           // 保留最近 6 轮
  userMessageBuffer: 20000,   // 用户消息缓冲区 20K tokens
  titleOnlySummaryThreshold: 0.8, // 80% 时对旧消息做 title-only 摘要
  titleOnlySummaryMaxWords: 10,   // 英文单词上限
  titleOnlySummaryMaxChars: 80,   // 字符上限（含 CJK）
  maxKeptMessageChars: 16000,     // kept 消息硬截断保护（避免极端大消息霸占上下文）
  useCompressionWorker: true,     // 启用 Worker 压缩（浏览器环境）
  workerThresholdMessages: 50,    // 消息数阈值触发 Worker
});

// 简单 token 估算 (4 chars ≈ 1 token)
function estimateTokens(text, tokenCounter) {
  if (!text) return 0;
  if (tokenCounter && typeof tokenCounter.count === "function") {
    try {
      return tokenCounter.count(text);
    } catch {
      // fall back below
    }
  }
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
  return estimateTokensCached(rawText);
}

function isProductionRuntime() {
  try {
    const env = typeof process !== "undefined" ? process.env : null;
    if (env && typeof env.NODE_ENV === "string") return env.NODE_ENV === "production";
  } catch { /* intentional: process.env may not exist */ }
  try {
    const mode = import.meta?.env?.MODE;
    if (typeof mode === "string") return mode === "production";
  } catch { /* intentional: import.meta.env may not exist */ }
  return false;
}

function parseBooleanish(value) {
  if (value === true || value === false) return value;
  const s = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!s) return undefined;
  if (["1", "true", "yes", "y", "on", "enabled"].includes(s)) return true;
  if (["0", "false", "no", "n", "off", "disabled"].includes(s)) return false;
  return undefined;
}

function resolveStrictLoopStatusTransitions(explicit) {
  if (explicit === true || explicit === false) return explicit;

  const env = typeof process !== "undefined" ? process.env : null;
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

const DEFAULT_LOOP_STATUS_TRANSITIONS = Object.freeze({
  [AgentStatus.IDLE]: [AgentStatus.RUNNING, AgentStatus.COMPLETED, AgentStatus.FAILED],
  [AgentStatus.RUNNING]: [AgentStatus.PAUSED, AgentStatus.COMPLETED, AgentStatus.FAILED],
  [AgentStatus.PAUSED]: [AgentStatus.RUNNING, AgentStatus.COMPLETED, AgentStatus.FAILED],
  [AgentStatus.COMPLETED]: [AgentStatus.IDLE],
  [AgentStatus.FAILED]: [AgentStatus.IDLE],
});

function isAllowedLoopStatusTransition(from, to, meta = {}) {
  if (meta && typeof meta === "object") {
    if (meta.force) return true;
    if (meta.allowReset && to === AgentStatus.IDLE) return true;
  }
  if (!isValidAgentStatus(from) || !isValidAgentStatus(to)) return true;
  const allowed = DEFAULT_LOOP_STATUS_TRANSITIONS[from] || [];
  return allowed.includes(to);
}

export function getEmitFn(ctx) {
  const emit = ctx?.emit || ctx?.eventBus?.emit;
  return typeof emit === "function" ? emit : null;
}

export { checkCancelled };

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

export function checkCancelledOrPaused(signal) {
  checkCancelled(signal);
  checkPaused(signal);
}

export function normalizeToolResult(result) {
  if (result && typeof result === "object" && Object.prototype.hasOwnProperty.call(result, "ok")) {
    return result;
  }
  if (result && typeof result === "object" && ("error" in result || "data" in result)) {
    return { ok: !result.error, data: result.data, error: result.error };
  }
  return { ok: true, data: result };
}

export function resolveToolExecutor(context) {
  const executor = context?.toolExecutor || context?.tools;
  if (typeof executor === "function") return executor;
  if (executor && typeof executor.execute === "function") return (name, params) => executor.execute(name, params);
  return null;
}

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
function buildStepId(prefix) {
  _stepSeq += 1;
  const base = prefix && typeof prefix === "string" ? prefix : "step";
  return `${base}_${Date.now().toString(36)}_${_stepSeq}`;
}

export class BaseStage {
  constructor({ name, eventBus, logger } = {}) {
    this.name = name || "stage";
    this.eventBus = eventBus || null;
    this.logger = logger || null;
  }

  // Standard stage entrypoint.
  async execute(runContext, input, stageApi = {}) {
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
  async run(_input, _context) {
    throw new Error("Subclass must implement run()");
  }

  _emitStage(status, payload, api) {
    const stageName = String(this.name || "").trim();
    if (!stageName) return;
    api.emit?.(`${stageName}.${status}`, { actor: stageName, status, payload });
  }
}

export class BaseAgentLoop {
  constructor({ eventBus, stateMachine, tools, actor, stageName, emit, hooks, contextConfig, logger, strictLoopStatus, tokenCounter } = {}) {
    this.eventBus = eventBus || null;
    this.logger = logger || null;
    this.stateMachine = stateMachine || null;
    this.actor = actor || stageName || "agent";
    this.stageName = stageName || actor || "agent";
    this.emit = typeof emit === "function" ? emit : null;

    // 组合类实例（职责拆分）
    this._messageManager = new MessageManager({
      contextConfig,
      tokenCounter,
      logger,
      emit: this.emit,
      stageName: this.stageName,
      actor: this.actor,
    });

    this._toolRegistry = new ToolRegistry({
      tools,
      hooks,
      logger,
    });

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

    // 用户输入管理（保留在 BaseAgentLoop）
    this._activeStep = null;
    this._userInputs = [];
    this._userInputUnsub = null;
    this._userInputBus = null;
    this._userInputEvent = "user.input";
    this._pauseListenerUnsub = null;
    this._executeAbortController = null;

    // 向后兼容：保留旧属性引用（逐步废弃）
    this._tools = this._toolRegistry._tools;
    this._hooks = this._toolRegistry._hooks;
  }

  // ===== 消息管理 (委托给 MessageManager) =====

  get messages() {
    return this._messageManager.messages;
  }

  get _contextConfig() {
    return this._messageManager._contextConfig;
  }

  set _contextConfig(value) {
    this._messageManager._contextConfig = value;
  }

  get _tokenUsage() {
    return this._messageManager._tokenUsage;
  }

  get _compressionHistory() {
    return this._messageManager._compressionHistory;
  }

  get _compressionPromise() {
    return this._messageManager._compressionPromise;
  }

  get _compressionPending() {
    return this._messageManager._compressionPending;
  }

  addMessage(message) {
    return this._messageManager.addMessage(message);
  }

  addMessages(messages) {
    return this._messageManager.addMessages(messages);
  }

  async resetMessages(options = {}) {
    return this._messageManager.reset(options);
  }

  _shouldCompress() {
    return this._messageManager._shouldCompress();
  }

  _scheduleCompression(options) {
    return this._messageManager._scheduleCompression(options);
  }

  async flushCompression(options) {
    return this._messageManager.flushCompression(options);
  }

  async _compressMessages() {
    return this._messageManager._compress();
  }

  getContextStatus() {
    return this._messageManager.getStatus();
  }

  setContextConfig(config) {
    return this._messageManager.setContextConfig(config);
  }

  // ===== 工具管理 (委托给 ToolRegistry) =====

  registerTools(tools) {
    return this._toolRegistry.registerTools(tools);
  }

  registerTool(name, fn) {
    return this._toolRegistry.registerTool(name, fn);
  }

  useHook(phase, fn) {
    this._toolRegistry.useHook(phase, fn);
    return this;
  }

  async _callTool(name, params, context) {
    return this._toolRegistry.callTool(name, params, context);
  }

  // ===== 状态管理 (委托给 StatusController) =====

  get loopStatus() {
    return this._statusController.status;
  }

  get _loopStatus() {
    return this._statusController._loopStatus;
  }

  set _loopStatus(value) {
    this._statusController._loopStatus = value;
  }

  get isPaused() {
    return this._statusController.isPaused;
  }

  get _pauseRequested() {
    return this._statusController._pauseRequested;
  }

  set _pauseRequested(value) {
    this._statusController._pauseRequested = value;
  }

  get _pauseReason() {
    return this._statusController._pauseReason;
  }

  set _pauseReason(value) {
    this._statusController._pauseReason = value;
  }

  get statusHistory() {
    return this._statusController.statusHistory;
  }

  get _statusHistory() {
    return this._statusController._statusHistory;
  }

  initLoopStatus({ status, machine, eventName, strict } = {}) {
    this._statusController.init({ status, machine, eventName, strict });
  }

  pause(reason = "user_requested") {
    this._statusController.pause(reason);
    this._abortActiveStep(reason);
  }

  resume() {
    this._statusController.resume();
  }

  _transitionLoopStatus(newStatus, metadata = {}) {
    return this._statusController.transition(newStatus, metadata);
  }

  _checkPaused(signal) {
    return this._statusController.checkPaused(signal);
  }

  _createPauseError(options) {
    return this._statusController.createPauseError(options);
  }

  _shouldPauseFromError(err, signal) {
    return this._statusController.shouldPauseFromError(err, signal);
  }

  _isAbortError(err, signal) {
    return this._statusController._isAbortError(err, signal);
  }

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

  async run() {
    throw new Error("BaseAgentLoop.run() is not implemented");
  }

  async execute(runContext, input, stageApi = {}) {
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

    try {
      return await this.run(input, context);
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

  _attachUserInputListener(eventBus, { eventName, signal } = {}) {
    if (!eventBus || typeof eventBus.subscribe !== "function") return;
    const resolvedEvent = typeof eventName === "string" && eventName ? eventName : this._userInputEvent;
    if (this._userInputBus === eventBus && this._userInputEvent === resolvedEvent) return;
    if (typeof this._userInputUnsub === "function") this._userInputUnsub();
    this._userInputBus = eventBus;
    this._userInputEvent = resolvedEvent;
    this._userInputUnsub = eventBus.subscribe(
      resolvedEvent,
      (evt) => {
      const payload = evt && typeof evt === "object" && "payload" in evt ? evt.payload : evt;
      this.recordUserInput(payload);
      },
      { ...(signal ? { signal } : {}) }
    );
  }

  _attachPauseListener(eventBus, { signal } = {}) {
    if (!eventBus || typeof eventBus.subscribe !== "function") return;
    if (this._pauseListenerUnsub) return;
    this._pauseListenerUnsub = eventBus.subscribe(
      "user.action.pause",
      (evt) => {
        const payload = evt && typeof evt === "object" && "payload" in evt ? evt.payload : evt;
        const reason = payload?.reason || payload?.message || payload;
        this.pause(typeof reason === "string" ? reason : "user_requested");
      },
      { ...(signal ? { signal } : {}) }
    );
  }

  _detachEventBusListeners() {
    if (typeof this._userInputUnsub === "function") {
      try {
        this._userInputUnsub();
      } catch {
        // ignore
      }
    }
    this._userInputUnsub = null;
    this._userInputBus = null;

    if (typeof this._pauseListenerUnsub === "function") {
      try {
        this._pauseListenerUnsub();
      } catch {
        // ignore
      }
    }
    this._pauseListenerUnsub = null;
  }

  recordUserInput(payload) {
    const entry = {
      payload,
      ts: Date.now(),
    };
    this._userInputs.push(entry);
    const emit = this.emit || this.eventBus?.emit;
    if (typeof emit === "function") {
      emit(`${this.stageName}.user.input`, { actor: this.actor, status: "info", payload: entry });
    }
    return entry;
  }

  consumeUserInputs({ clear = true } = {}) {
    const items = Array.isArray(this._userInputs) ? [...this._userInputs] : [];
    if (clear) this._userInputs = [];
    return items;
  }

  drainUserInputsAsText({ clear = true } = {}) {
    const items = this.consumeUserInputs({ clear });
    const text = this.formatUserInputs(items);
    return { items, text };
  }

  applyUserInputsToConfig(userConfig, { key = "userNotes" } = {}) {
    const { items, text } = this.drainUserInputsAsText({ clear: true });
    if (!text) return userConfig;
    const next = userConfig && typeof userConfig === "object" ? { ...userConfig } : {};
    const existing = Array.isArray(next[key]) ? next[key] : typeof next[key] === "string" ? [next[key]] : [];
    next[key] = [...existing, text];
    next._lastUserNote = text;
    next._lastUserNoteAt = Date.now();
    next._rawUserInputs = Array.isArray(next._rawUserInputs) ? [...next._rawUserInputs, ...items] : [...items];
    return next;
  }

  hasPendingUserInputs() {
    return Array.isArray(this._userInputs) && this._userInputs.length > 0;
  }

  formatUserInputs(items) {
    const list = Array.isArray(items) ? items : [];
    const lines = [];
    for (const item of list) {
      const payload = item?.payload ?? item;
      if (payload == null) continue;
      if (typeof payload === "string") {
        lines.push(payload.trim());
        continue;
      }
      if (typeof payload?.text === "string") {
        lines.push(payload.text.trim());
        continue;
      }
      if (typeof payload?.message === "string") {
        lines.push(payload.message.trim());
        continue;
      }
      try {
        lines.push(JSON.stringify(payload));
      } catch {
        lines.push(String(payload));
      }
    }
    return lines.filter(Boolean).join("\n");
  }

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

  _endStep(stepInfo, { status = "completed", error, result } = {}) {
    const step = stepInfo?.step || this._activeStep;
    if (!step) return;
    const payload = { ...step };
    if (error) payload.error = error;
    if (result !== undefined) payload.result = result;
    this._emitStepEvent(status, payload);
    if (this._activeStep && this._activeStep.stepId === step.stepId) {
      this._activeStep = null;
    }
  }

  _emitStepEvent(status, payload) {
    const emit = this.emit || this.eventBus?.emit;
    if (typeof emit !== "function") return;
    emit(`${this.stageName}.step.${status}`, { actor: this.actor, status, payload });
  }

  _abortActiveStep(reason) {
    const controller = this._activeStep?.controller;
    if (!controller || controller.signal.aborted) return;
    controller.abort(reason || "paused");
  }

  _createStepSignal(parentSignal) {
    const controller = new AbortController();
    const signal = mergeSignals(parentSignal, controller.signal) || controller.signal;
    return { signal, controller };
  }

  _isAbortError(err, signal) {
    if (!err) return false;
    if (signal?.aborted) return true;
    const name = err.name || err.code;
    if (name === "AbortError" || name === "CanceledError" || name === "CancelledError") return true;
    const msg = err instanceof Error ? err.message : String(err);
    return msg.toLowerCase().includes("aborted") || msg.toLowerCase().includes("cancelled");
  }

  _shouldPauseFromError(err, signal) {
    const runtimeState = getRuntimeState(signal);
    const pauseRequested = this._pauseRequested || runtimeState?.status === "paused";
    if (!pauseRequested) return false;
    return this._isAbortError(err, signal);
  }

  _createPauseError({ signal, runId } = {}) {
    const runtimeState = getRuntimeState(signal);
    const reason = runtimeState?.pausedReason || this._pauseReason || null;
    const checkpointId = runtimeState?.lastCheckpointId ?? null;
    return new StagePausedError("Run paused", {
      checkpointId,
      reason,
      timestamp: Date.now(),
      runId,
    });
  }
}
