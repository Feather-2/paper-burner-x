import { createStageApi } from "../../shared/utils/stage-api.js";
import { StagePausedError } from "./stage-errors.js";
import { AgentStatus, isValidAgentStatus } from "./agent-status.js";
import { getRuntimeState } from "../telemetry/loop-runtime-state.js";
import { estimateTokenCount } from "../../shared/utils/value-utils.js";

const USER_ACTION_PREFIX = "user.action";

// 默认上下文配置
const DEFAULT_CONTEXT_CONFIG = Object.freeze({
  contextWindow: 128000,      // 默认 128K tokens
  maxOutputTokens: 4096,      // 默认输出限制
  compressThreshold: 0.9,     // 90% 触发压缩
  keepLastTurns: 6,           // 保留最近 6 轮
  userMessageBuffer: 20000,   // 用户消息缓冲区 20K tokens
});

// 简单 token 估算 (4 chars ≈ 1 token)
function estimateTokens(text) {
  if (!text) return 0;
  const rawText = typeof text === "string" ? text : JSON.stringify(text);
  return estimateTokenCount(rawText);
}

function isProductionRuntime() {
  try {
    const env = typeof process !== "undefined" ? process.env : null;
    if (env && typeof env.NODE_ENV === "string") return env.NODE_ENV === "production";
  } catch {}
  try {
    const mode = import.meta?.env?.MODE;
    if (typeof mode === "string") return mode === "production";
  } catch {}
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
  } catch {}

  // Default: enforce in production, warn-only elsewhere.
  return isProductionRuntime();
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

export function checkCancelled(signal) {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  throw new Error(typeof reason === "string" ? reason : "Run cancelled");
}

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
  constructor({ eventBus, stateMachine, tools, actor, stageName, emit, hooks, contextConfig, logger, strictLoopStatus } = {}) {
    this.eventBus = eventBus || null;
    this.logger = logger || null;
    this.stateMachine = stateMachine || null;
    this.actor = actor || stageName || "agent";
    this.stageName = stageName || actor || "agent";
    this.emit = typeof emit === "function" ? emit : null;
    this._tools = {};
    this._hooks = { before: [], after: [], ...(hooks || {}) };
    this.registerTools(tools);
    this._loopMachine = null;
    this._loopEventName = null;
    this._loopStatus = null;
    this._strictLoopStatusTransitions = resolveStrictLoopStatusTransitions(strictLoopStatus);
    this._statusHistory = [];
    this._pauseRequested = false;
    this._pauseReason = null;
    this._activeStep = null;
    this._userInputs = [];
    this._userInputUnsub = null;
    this._userInputBus = null;
    this._userInputEvent = "user.input";
    this._pauseListenerUnsub = null;

    // 消息管理
    this._messages = [];
    this._contextConfig = { ...DEFAULT_CONTEXT_CONFIG, ...contextConfig };
    this._compressor = null;  // 懒加载
    this._tokenUsage = { input: 0, output: 0, total: 0 };
    this._compressionPending = false;
    this._compressionPromise = null;
    this._compressionHistory = [];
  }

  // ===== 消息管理 =====

  /**
   * 获取当前消息列表
   */
  get messages() {
    return this._messages;
  }

  /**
   * 添加消息并检查是否需要压缩
   */
  addMessage(message) {
    this._messages.push(message);
    // 增量更新 Token 计数
    const messageTokens = estimateTokens(message.content);
    this._tokenUsage.input += messageTokens;
    this._tokenUsage.total += messageTokens;

    // 检查是否需要压缩
    if (this._shouldCompress()) {
      this._scheduleCompression();
    }

    return message;
  }

  /**
   * 批量添加消息
   */
  addMessages(messages) {
    let addedTokens = 0;
    for (const msg of messages) {
      this._messages.push(msg);
      addedTokens += estimateTokens(msg.content);
    }
    // 增量更新 Token 计数
    this._tokenUsage.input += addedTokens;
    this._tokenUsage.total += addedTokens;

    if (this._shouldCompress()) {
      this._scheduleCompression();
    }
  }

  /**
   * 全量重算 token 使用统计（仅在压缩或回溯后调用）
   */
  _recalculateTokenUsage() {
    let total = 0;
    for (const msg of this._messages) {
      total += estimateTokens(msg.content);
    }
    this._tokenUsage.input = total;
    this._tokenUsage.total = total;
  }

  /**
   * 检查是否需要压缩
   */
  _shouldCompress() {
    const { contextWindow, compressThreshold } = this._contextConfig;
    const threshold = contextWindow * compressThreshold;
    return this._tokenUsage.total >= threshold;
  }

  /**
   * 调度压缩（异步，不阻塞主流程）
   */
  _scheduleCompression() {
    // 防止重复调度
    if (this._compressionPending) return;
    this._compressionPending = true;

    let resolve = null;
    const done = new Promise((r) => {
      resolve = r;
    });
    this._compressionPromise = done;

    queueMicrotask(() => {
      Promise.resolve()
        .then(() => this._compressMessages())
        .catch(() => { })
        .finally(() => {
          this._compressionPending = false;
          if (this._compressionPromise === done) this._compressionPromise = null;
          resolve?.();
        });
    });
  }

  /**
   * Flush pending compression, and optionally enforce compression before a model call.
   * This makes compression a synchronous barrier to avoid "schedule but not applied" races.
   *
   * @param {object} [options]
   * @param {number} [options.maxRounds=2] Max extra compression rounds if still above threshold.
   */
  async flushCompression(options = {}) {
    const maxRoundsRaw = typeof options?.maxRounds === "number" && Number.isFinite(options.maxRounds) ? options.maxRounds : 2;
    const maxRounds = Math.max(0, Math.floor(maxRoundsRaw));

    if (this._compressionPromise) {
      try {
        await this._compressionPromise;
      } catch { }
    }

    let rounds = 0;
    while (this._shouldCompress() && rounds < maxRounds) {
      rounds += 1;
      this._compressionPending = true;
      const p = Promise.resolve()
        .then(() => this._compressMessages())
        .catch(() => { })
        .finally(() => {
          this._compressionPending = false;
        });
      this._compressionPromise = p;
      try {
        await p;
      } catch { }
      if (this._compressionPromise === p) this._compressionPromise = null;
    }
  }

  /**
   * 执行消息压缩（委托给 CicadaCompressor）
   */
  async _compressMessages() {
    const { keepLastTurns } = this._contextConfig;
    const beforeCount = this._messages.length;
    const beforeTokens = this._tokenUsage.total;

    const isContextSummaryMessage = (msg) =>
      msg && typeof msg === "object" && msg.role === "system" && String(msg.content || "").startsWith("[Context Summary]");

    const extractContextSummaryBody = (msg) => {
      if (!isContextSummaryMessage(msg)) return "";
      const raw = String(msg?.content ?? "");
      const newline = raw.indexOf("\n");
      return newline >= 0 ? raw.slice(newline + 1).trim() : "";
    };

    // Preserve any prior summary text (do NOT include it in the compression input to avoid re-summarizing).
    const priorSummaryMsg = this._messages.find(isContextSummaryMessage);
    const priorSummary = extractContextSummaryBody(priorSummaryMsg);

    // Anchors: keep system prompts verbatim; exclude prior summaries from the compression input.
    const messagesForCompression = this._messages.filter((msg) => !isContextSummaryMessage(msg));

    // 懒加载 CicadaCompressor
    if (!this._compressor) {
      try {
        const { CicadaCompressor } = await import("../compression/cicada-compressor.js");
        this._compressor = new CicadaCompressor({
          maxTokens: this._contextConfig.maxOutputTokens,
          eventBus: this.eventBus,
        });
      } catch {
        // 回退到简单压缩
        return this._simpleCompress();
      }
    }

    // 使用 CicadaCompressor 的 SESSION_HISTORY 层
    const result = await this._compressor.compress(
      { messages: messagesForCompression, ...(priorSummary ? { sessionSummary: priorSummary } : {}) },
      { keepLastTurns, layers: ["session_history"] }
    );

    this._messages = result.context.messages || messagesForCompression;

    // 如果有摘要，追加到末尾（更利于 prompt caching：前缀保持稳定）
    if (result.context.sessionSummary) {
      const summaryMsg = { role: "system", content: `[Context Summary]\n${result.context.sessionSummary}` };
      this._messages.push(summaryMsg);
    }

    this._recalculateTokenUsage();
    this._recordCompression(beforeCount, beforeTokens);
  }

  /**
   * 简单压缩回退（无 CicadaCompressor 时）
   */
  _simpleCompress() {
    const { keepLastTurns } = this._contextConfig;
    const beforeCount = this._messages.length;
    const beforeTokens = this._tokenUsage.total;

    const isContextSummaryMessage = (msg) =>
      msg && typeof msg === "object" && msg.role === "system" && String(msg.content || "").startsWith("[Context Summary]");

    const extractContextSummaryBody = (msg) => {
      if (!isContextSummaryMessage(msg)) return "";
      const raw = String(msg?.content ?? "");
      const newline = raw.indexOf("\n");
      return newline >= 0 ? raw.slice(newline + 1).trim() : "";
    };

    const priorSummaryMsg = this._messages.find(isContextSummaryMessage);
    const priorSummary = extractContextSummaryBody(priorSummaryMsg);

    // Exclude prior summaries from the compression input (they are derived).
    const messagesForCompression = this._messages.filter((msg) => !isContextSummaryMessage(msg));

    // Anchors: keep leading system prompts verbatim.
    const anchors = [];
    let anchorEnd = 0;
    while (anchorEnd < messagesForCompression.length) {
      const msg = messagesForCompression[anchorEnd];
      if (msg?.role === "system" && !isContextSummaryMessage(msg)) {
        anchors.push(msg);
        anchorEnd += 1;
        continue;
      }
      break;
    }

    const kept = [];
    const toCompress = [];
    let turnCount = 0;

    const compressible = messagesForCompression.slice(anchorEnd);
    for (let i = compressible.length - 1; i >= 0; i--) {
      const msg = compressible[i];
      if (turnCount < keepLastTurns) {
        kept.unshift(msg);
        if (msg.role === "assistant") turnCount++;
      } else {
        toCompress.unshift(msg);
      }
    }

    if (toCompress.length === 0) return;

    const summary = this._buildCompressionSummary(toCompress);
    const combined = priorSummary ? `${priorSummary}\n${summary}` : summary;
    this._messages = [...anchors, ...kept, { role: "system", content: `[Context Summary]\n${combined}` }];

    this._recalculateTokenUsage();
    this._recordCompression(beforeCount, beforeTokens);
  }

  /**
   * 记录压缩历史
   */
  _recordCompression(beforeCount, beforeTokens) {
    const record = {
      timestamp: Date.now(),
      beforeCount,
      afterCount: this._messages.length,
      beforeTokens,
      afterTokens: this._tokenUsage.total,
    };
    this._compressionHistory.push(record);

    const emit = this.emit || this.eventBus?.emit;
    if (typeof emit === "function") {
      emit(`${this.stageName}.context.compressed`, {
        actor: this.actor,
        status: "info",
        payload: record,
      });
    }
  }

  /**
   * 构建压缩摘要
   */
  _buildCompressionSummary(messages) {
    const lines = [];
    for (const msg of messages) {
      const role = msg.role || "unknown";
      const content = String(msg.content || "").slice(0, 200);
      if (content) {
        lines.push(`[${role}] ${content}${msg.content?.length > 200 ? "..." : ""}`);
      }
    }
    return lines.join("\n");
  }

  /**
   * 获取上下文状态
   */
  getContextStatus() {
    const { contextWindow, compressThreshold } = this._contextConfig;
    return {
      messageCount: this._messages.length,
      tokenUsage: { ...this._tokenUsage },
      contextWindow,
      fillRatio: this._tokenUsage.total / contextWindow,
      compressThreshold,
      needsCompression: this._shouldCompress(),
      compressionPending: !!this._compressionPending,
      compressionCount: this._compressionHistory.length,
    };
  }

  /**
   * 设置上下文配置（支持运行时调整）
   */
  setContextConfig(config) {
    this._contextConfig = { ...this._contextConfig, ...config };
  }

  registerTools(tools) {
    if (!tools) return;
    if (tools instanceof Map) {
      for (const [name, fn] of tools.entries()) {
        this.registerTool(name, fn);
      }
      return;
    }
    if (Array.isArray(tools)) {
      for (const [name, fn] of tools) {
        this.registerTool(name, fn);
      }
      return;
    }
    if (typeof tools === "object") {
      for (const [name, fn] of Object.entries(tools)) {
        this.registerTool(name, fn);
      }
      return;
    }
    throw new TypeError("BaseAgentLoop.registerTools: tools must be an object, array, or map");
  }

  registerTool(name, fn) {
    if (!name || typeof name !== "string") {
      throw new TypeError("BaseAgentLoop.registerTool: name must be a non-empty string");
    }
    if (typeof fn !== "function") {
      throw new TypeError("BaseAgentLoop.registerTool: fn must be a function");
    }
    this._tools[name] = fn;
  }

  /**
   * 注册 Hook (SDK 风格)
   * @param {"before"|"after"} phase
   * @param {Function} fn
   * @returns {BaseAgentLoop}
   */
  useHook(phase, fn) {
    if (phase !== "before" && phase !== "after") {
      throw new Error(`Invalid hook phase: ${phase}`);
    }
    if (typeof fn !== "function") {
      throw new Error("Hook must be a function");
    }
    this._hooks[phase].push(fn);
    return this;
  }

  _emitStage(name, status, payload) {
    const emit = this.emit || this.eventBus?.emit;
    if (typeof emit !== "function") return;
    emit(name, { actor: this.actor, status, payload });
  }

  async _callTool(name, params, context) {
    // Before hooks - can skip or modify params
    let finalParams = params;
    // Before hooks - can skip or modify params (isolated)
    for (const hook of this._hooks.before) {
      try {
        const hookResult = await hook({ tool: name, params: finalParams, context });
        if (hookResult?.skip) {
          return normalizeToolResult(hookResult.value);
        }
        if (hookResult?.params) {
          finalParams = hookResult.params;
        }
      } catch (e) {
        this.logger?.warn(`[agent-loop] BeforeHook failed for ${name}: ${e.message}`);
      }
    }

    // Execute tool
    const executor = resolveToolExecutor(context);
    let result;
    if (executor) {
      result = normalizeToolResult(await executor(name, finalParams, context));
    } else {
      const tool = this._tools[name];
      if (!tool) {
        result = { ok: false, error: `Unknown tool: ${name}` };
      } else {
        try {
          const data = await tool(finalParams, context);
          result = { ok: true, data };
        } catch (err) {
          result = { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }
    }

    // After hooks - can transform result
    // After hooks - can transform result (isolated)
    for (const hook of this._hooks.after) {
      try {
        const hookResult = await hook({ tool: name, params: finalParams, result, context });
        if (hookResult !== undefined) {
          result = normalizeToolResult(hookResult);
        }
      } catch (e) {
        this.logger?.warn(`[agent-loop] AfterHook failed for ${name}: ${e.message}`);
      }
    }

    return result;
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
    const context = { ...stageApi, runContext };
    this.eventBus = stageApi.eventBus || this.eventBus || null;
    this.emit = getEmitFn(stageApi) || this.emit || this.eventBus?.emit || null;
    if (this.eventBus) {
      this._attachUserInputListener(this.eventBus);
      this._attachPauseListener(this.eventBus);
    }
    return this.run(input, context);
  }

  _checkPaused(signal) {
    checkPaused(signal);
  }

  pause(reason = "user_requested") {
    this._pauseRequested = true;
    this._pauseReason = reason;
    this._abortActiveStep(reason);
  }

  resume() {
    this._pauseRequested = false;
    this._pauseReason = null;
  }

  get loopStatus() {
    return this._loopStatus;
  }

  get isPaused() {
    return this._pauseRequested;
  }

  get statusHistory() {
    return Array.isArray(this._statusHistory) ? [...this._statusHistory] : [];
  }

  initLoopStatus({ status, machine, eventName, strict } = {}) {
    if (machine) this._loopMachine = machine;
    if (eventName) this._loopEventName = eventName;
    if (status) this._loopStatus = status;
    if (typeof strict === "boolean") this._strictLoopStatusTransitions = strict;
    if (!Array.isArray(this._statusHistory)) this._statusHistory = [];
  }

  _emitAgentStatusChanged(payload, { eventName } = {}) {
    const emit = this.emit || this.eventBus?.emit;
    if (typeof emit !== "function") return;
    const name = eventName || this._loopEventName || `${this.stageName}.agent.status.changed`;
    emit(name, { actor: this.actor, status: "info", payload });
  }

  _recordLoopStatusTransition({ from, to, timestamp, ...meta } = {}) {
    const ts = typeof timestamp === "number" ? timestamp : Date.now();
    const entry = { from, to, timestamp: ts, ...meta };
    if (!Array.isArray(this._statusHistory)) this._statusHistory = [];
    this._statusHistory.push(entry);
    this._loopStatus = to;
    this._emitAgentStatusChanged(entry);
    return entry;
  }

  _transitionLoopStatus(newStatus, metadata = {}) {
    const oldStatus = this._loopStatus;
    if (oldStatus === newStatus) return null;

    const meta = metadata && typeof metadata === "object" ? metadata : {};
    const from = oldStatus;
    const to = newStatus;

    let ok = true;
    const machine = this._loopMachine;
    if (machine) {
      try {
        if (typeof machine === "function") ok = machine(from, to, meta) !== false;
        else if (typeof machine.canTransition === "function") ok = machine.canTransition(from, to, meta) !== false;
        else if (typeof machine.transition === "function") ok = machine.transition(from, to, meta) !== false;
      } catch (err) {
        ok = false;
        const message = err instanceof Error ? err.message : String(err);
        this.logger?.warn?.(`[agent-loop] loopStatus machine threw: ${message}`);
      }
    } else {
      ok = isAllowedLoopStatusTransition(from, to, meta);
    }

    if (!ok) {
      const strict = typeof meta.strict === "boolean" ? meta.strict : this._strictLoopStatusTransitions;
      const msg = `${this.stageName} loopStatus transition rejected: ${from} -> ${to}`;
      if (strict) throw new Error(msg);
      if (this.logger && typeof this.logger.warn === "function") {
        this.logger.warn(msg);
      } else {
        console.warn(msg);
      }
      return this._recordLoopStatusTransition({ from: oldStatus, to: newStatus, invalid: true, ...meta });
    }

    return this._recordLoopStatusTransition({ from: oldStatus, to: newStatus, ...meta });
  }

  _attachUserInputListener(eventBus, { eventName } = {}) {
    if (!eventBus || typeof eventBus.subscribe !== "function") return;
    const resolvedEvent = typeof eventName === "string" && eventName ? eventName : this._userInputEvent;
    if (this._userInputBus === eventBus && this._userInputEvent === resolvedEvent) return;
    if (typeof this._userInputUnsub === "function") this._userInputUnsub();
    this._userInputBus = eventBus;
    this._userInputEvent = resolvedEvent;
    this._userInputUnsub = eventBus.subscribe(resolvedEvent, (evt) => {
      const payload = evt && typeof evt === "object" && "payload" in evt ? evt.payload : evt;
      this.recordUserInput(payload);
    });
  }

  _attachPauseListener(eventBus) {
    if (!eventBus || typeof eventBus.subscribe !== "function") return;
    if (this._pauseListenerUnsub) return;
    this._pauseListenerUnsub = eventBus.subscribe("user.action.pause", (evt) => {
      const payload = evt && typeof evt === "object" && "payload" in evt ? evt.payload : evt;
      const reason = payload?.reason || payload?.message || payload;
      this.pause(typeof reason === "string" ? reason : "user_requested");
    });
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
