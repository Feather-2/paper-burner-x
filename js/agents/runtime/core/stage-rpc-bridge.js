/**
 * Stage RPC Bridge - 跨 Stage 通信桥接
 *
 * 将 MessageBus RPC 能力注入 Stage API，使 Stage 间可以：
 * - registerHandler(endpoint, handler): 注册 RPC 服务端点
 * - request(endpoint, payload, options): 发起跨 Stage RPC 请求
 *
 * 设计原则：
 * - 不侵入现有 Stage 代码，通过 stageApi 注入
 * - 端点格式: stageName:action (如 codesearch:search, deepsearch:query)
 * - 自动绑定 AbortSignal 和超时
 * - 与 agent-message.js 协议兼容
 */

import { MessageBus } from "../../core/message-bus.js";
import { EventBus } from "../../core/event-bus.js";
import { toNonEmptyString } from "../../shared/index.js";

const DEFAULT_RPC_TIMEOUT_MS = 30_000;
const STAGE_RPC_META_VERSION = 1;

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function normalizePositiveTimeout(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const normalized = Math.floor(n);
  return normalized > 0 ? normalized : fallback;
}

/**
 * @param {string} endpoint
 * @param {string | null} targetStageId
 * @returns {string}
 */
function resolveEndpoint(endpoint, targetStageId) {
  if (endpoint.includes(":")) return endpoint;
  const target = toNonEmptyString(targetStageId);
  return target ? `${target}:${endpoint}` : endpoint;
}

/**
 * @param {unknown} err
 * @returns {{ message: string, code?: string, name?: string }}
 */
function serializeRpcError(err) {
  if (err instanceof Error) {
    const errorLike = /** @type {Error & { code?: string }} */ (err);
    const out = {
      message: err.message || "Unknown RPC error",
      name: err.name || undefined,
      code: typeof errorLike.code === "string" ? errorLike.code : undefined,
    };
    return out;
  }
  if (err && typeof err === "object") {
    const raw = /** @type {{ message?: unknown, code?: unknown, name?: unknown, error?: unknown }} */ (err);
    const message = toNonEmptyString(raw.message) || toNonEmptyString(raw.error) || "Unknown RPC error";
    return {
      message,
      code: typeof raw.code === "string" ? raw.code : undefined,
      name: typeof raw.name === "string" ? raw.name : undefined,
    };
  }
  return { message: String(err ?? "Unknown RPC error") };
}

/**
 * @param {unknown} incoming
 * @returns {{ payload: unknown, meta: { v?: number, from?: string, to?: string, requestId?: string } | null }}
 */
function unwrapStagePayload(incoming) {
  if (!incoming || typeof incoming !== "object") return { payload: incoming, meta: null };
  const record = /** @type {{ __stageRpc?: any, payload?: unknown }} */ (incoming);
  if (!record.__stageRpc || typeof record.__stageRpc !== "object") return { payload: incoming, meta: null };
  return { payload: record.payload, meta: record.__stageRpc };
}

/**
 * @typedef {(payload: unknown, meta: { from: string, to: string, endpoint: string, requestId: string | null }) => Promise<unknown>} StageRpcHandler
 */

/**
 * @param {unknown} response
 * @returns {{ ok: true, data: unknown } | { ok: false, error: { message: string, code?: string, name?: string } } | null}
 */
function unwrapStageResponseEnvelope(response) {
  const root = response && typeof response === "object"
    ? /** @type {{ __stageRpcResponse?: unknown, data?: unknown, ok?: unknown, error?: unknown }} */ (response)
    : null;
  const nestedData = root && root.data && typeof root.data === "object"
    ? /** @type {{ __stageRpcResponse?: unknown, ok?: unknown, data?: unknown, error?: unknown }} */ (root.data)
    : null;
  const direct = root?.__stageRpcResponse
    ? root
    : (nestedData?.__stageRpcResponse
      ? nestedData
      : null);
  if (!direct || typeof direct !== "object") return null;
  if (direct.ok === true) return { ok: true, data: direct.data };
  if (direct.ok === false) return { ok: false, error: serializeRpcError(direct.error) };
  return null;
}

/**
 * @typedef {{
 *   __stageRpcResponse: true,
 *   ok: boolean,
 *   data?: unknown,
 *   error?: { message: string, code?: string, name?: string },
 *   from: string,
 *   requestId: string | null,
 *   v: number
 * }} StageRpcResponseEnvelope
 */

/**
 * @typedef {Object} StageRpcBridgeOptions
 * @property {import("../../core/event-bus.js").EventBus} [eventBus]
 * @property {import("../../core/message-bus.js").MessageBus} [messageBus]
 * @property {string} [stageId] - 当前 Stage 标识
 * @property {number} [defaultTimeoutMs]
 */

export class StageRpcBridge {
  /**
   * @param {StageRpcBridgeOptions} [options]
   */
  constructor(options = {}) {
    const eventBus = options?.eventBus instanceof EventBus
      ? options.eventBus
      : new EventBus();

    this._messageBus = options?.messageBus instanceof MessageBus
      ? options.messageBus
      : new MessageBus(eventBus);

    this._ownsMessageBus = !(options?.messageBus instanceof MessageBus);
    this._stageId = toNonEmptyString(options?.stageId) || 'unknown';
    this._defaultTimeoutMs = typeof options?.defaultTimeoutMs === 'number' && options.defaultTimeoutMs > 0
      ? options.defaultTimeoutMs
      : DEFAULT_RPC_TIMEOUT_MS;
    this._requestSeq = 0;

    /** @type {Map<string, Function>} endpoint -> unsubscribe */
    this._handlers = new Map();
    this.disposed = false;
  }

  /** @returns {MessageBus} */
  get messageBus() { return this._messageBus; }

  /**
   * Register an RPC handler for an endpoint.
   * @param {string} endpoint - Format: stageName:action
   * @param {StageRpcHandler} handler
   * @returns {{ ok: true } | { ok: false, error: string }}
   */
  registerHandler(endpoint, handler) {
    if (this.disposed) return { ok: false, error: 'Bridge disposed' };
    const name = toNonEmptyString(endpoint);
    if (!name) return { ok: false, error: 'endpoint required' };
    if (typeof handler !== 'function') return { ok: false, error: 'handler must be a function' };

    if (this._handlers.has(name)) {
      this._handlers.get(name)();
      this._handlers.delete(name);
    }

    const off = this._messageBus.on(`rpc.${name}`, async (incomingPayload) => {
      const unwrapped = unwrapStagePayload(incomingPayload);
      const from = toNonEmptyString(unwrapped.meta?.from) || "unknown";
      const requestId = toNonEmptyString(unwrapped.meta?.requestId) || null;
      try {
        const data = await handler(unwrapped.payload, {
          from,
          to: this._stageId,
          endpoint: name,
          requestId,
        });
        return /** @type {void | Promise<void>} */ (/** @type {unknown} */ (/** @type {StageRpcResponseEnvelope} */ ({
          __stageRpcResponse: true,
          ok: true,
          data,
          from: this._stageId,
          requestId,
          v: STAGE_RPC_META_VERSION,
        })));
      } catch (err) {
        return /** @type {void | Promise<void>} */ (/** @type {unknown} */ (/** @type {StageRpcResponseEnvelope} */ ({
          __stageRpcResponse: true,
          ok: false,
          error: serializeRpcError(err),
          from: this._stageId,
          requestId,
          v: STAGE_RPC_META_VERSION,
        })));
      }
    });

    this._handlers.set(name, off);
    return { ok: true };
  }

  /**
   * Send an RPC request to another stage's endpoint.
   * @param {string} endpoint - Format: stageName:action
   * @param {unknown} payload
   * @param {{ timeoutMs?: number, signal?: AbortSignal, targetStageId?: string }} [options]
   * @returns {Promise<{ ok: true, data: unknown } | { ok: false, error: string, errorInfo?: { message: string, code?: string, name?: string } }>}
   */
  async request(endpoint, payload, options = {}) {
    if (this.disposed) return { ok: false, error: 'Bridge disposed' };
    const name = toNonEmptyString(endpoint);
    if (!name) return { ok: false, error: 'endpoint required' };

    const timeoutMs = normalizePositiveTimeout(options?.timeoutMs, this._defaultTimeoutMs);
    const targetStageId = toNonEmptyString(options?.targetStageId) || null;
    const resolvedEndpoint = resolveEndpoint(name, targetStageId);
    const requestId = `${this._stageId}:${Date.now().toString(36)}:${++this._requestSeq}`;
    const wrappedPayload = {
      __stageRpc: {
        v: STAGE_RPC_META_VERSION,
        from: this._stageId,
        to: targetStageId,
        endpoint: resolvedEndpoint,
        requestId,
        timestamp: Date.now(),
      },
      payload,
    };

    try {
      const result = await this._messageBus.request(`rpc.${resolvedEndpoint}`, wrappedPayload, {
        timeoutMs,
        signal: options?.signal,
      });
      const envelope = unwrapStageResponseEnvelope(result);
      if (envelope?.ok === true) return { ok: true, data: envelope.data };
      if (envelope?.ok === false) {
        return {
          ok: false,
          error: envelope.error.message,
          errorInfo: envelope.error,
        };
      }
      return { ok: true, data: result?.data ?? result };
    } catch (err) {
      const errorInfo = serializeRpcError(err);
      return { ok: false, error: errorInfo.message, errorInfo };
    }
  }

  /**
   * Get list of registered endpoints.
   * @returns {string[]}
   */
  getEndpoints() {
    return Array.from(this._handlers.keys());
  }

  /**
   * Create a scoped client for a specific stage.
   * @param {string} stageId
   * @param {{ signal?: AbortSignal }} [options]
   * @returns {{ request: Function }}
   */
  createClient(stageId, options = {}) {
    const targetStageId = toNonEmptyString(stageId) || null;
    const signal = options?.signal;
    return {
      request: (endpoint, payload, reqOptions = {}) => {
        return this.request(endpoint, payload, {
          ...reqOptions,
          targetStageId: reqOptions.targetStageId || targetStageId,
          signal: reqOptions.signal || signal,
        });
      },
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const off of this._handlers.values()) {
      try { off(); } catch { /* ignore */ }
    }
    this._handlers.clear();
    if (this._ownsMessageBus && typeof this._messageBus?.dispose === 'function') {
      try { this._messageBus.dispose(); } catch { /* ignore */ }
    }
  }
}

/**
 * Factory: create a StageRpcBridge from orchestrator services.
 * @param {{ eventBus?: EventBus, messageBus?: MessageBus, stageId?: string }} services
 * @returns {StageRpcBridge}
 */
export function createStageRpcBridge(services = {}) {
  return new StageRpcBridge({
    eventBus: services.eventBus,
    messageBus: services.messageBus,
    stageId: services.stageId,
  });
}
