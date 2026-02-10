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

    /** @type {Map<string, Function>} endpoint -> unsubscribe */
    this._handlers = new Map();
    this.disposed = false;
  }

  /** @returns {MessageBus} */
  get messageBus() { return this._messageBus; }

  /**
   * Register an RPC handler for an endpoint.
   * @param {string} endpoint - Format: stageName:action
   * @param {(payload: unknown, meta: { from: string }) => Promise<unknown>} handler
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

    const off = this._messageBus.on(`rpc.${name}`, async (payload) => {
      return await handler(payload, { from: this._stageId });
    });

    this._handlers.set(name, off);
    return { ok: true };
  }

  /**
   * Send an RPC request to another stage's endpoint.
   * @param {string} endpoint - Format: stageName:action
   * @param {unknown} payload
   * @param {{ timeoutMs?: number, signal?: AbortSignal }} [options]
   * @returns {Promise<{ ok: true, data: unknown } | { ok: false, error: string }>}
   */
  async request(endpoint, payload, options = {}) {
    if (this.disposed) return { ok: false, error: 'Bridge disposed' };
    const name = toNonEmptyString(endpoint);
    if (!name) return { ok: false, error: 'endpoint required' };

    const timeoutMs = typeof options?.timeoutMs === 'number' && options.timeoutMs > 0
      ? options.timeoutMs
      : this._defaultTimeoutMs;

    try {
      const result = await this._messageBus.request(`rpc.${name}`, payload, {
        timeoutMs,
        signal: options?.signal,
      });
      return { ok: true, data: result?.data ?? result };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
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
    const signal = options?.signal;
    return {
      request: (endpoint, payload, reqOptions = {}) => {
        return this.request(endpoint, payload, {
          ...reqOptions,
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
