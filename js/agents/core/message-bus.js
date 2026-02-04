/**
 * MessageBus - RPC over EventBus
 *
 * 提供基于 EventBus 的 request-response RPC 模式，
 * 用于跨 Stage/Agent 的同步通信。
 *
 * 特性：
 * - emit(type, payload) - 单向消息
 * - on(type, handler) - 订阅消息（支持 RPC 响应）
 * - request(type, payload, options) - 请求/响应模式
 * - 内置超时控制（默认 30s）
 * - AbortSignal 支持
 */

import { EventBus, isValidEventName } from './event-bus.js';

/**
 * @typedef {import('./types.d.ts').EventBus} EventBusType
 * @typedef {import('./event-bus.js').EventRecord} EventRecord
 */

const RPC_KIND_REQUEST = 'rpc_request';
const RPC_KIND_RESPONSE = 'rpc_response';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_ABORT_MESSAGE = 'Request aborted';

/**
 * @typedef {{ kind: string, requestId: string, replyTo: string }} RpcRequestMeta
 * @typedef {{ kind: string, requestId: string }} RpcResponseMeta
 * @typedef {{ ok: boolean, data?: unknown, error?: string }} RpcResponseBody
 */

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function toNonEmptyString(value) {
  const s = typeof value === 'string' ? value : String(value ?? '');
  return s.trim().length ? s : null;
}

/**
 * @param {unknown} value
 * @param {number} defaultValue
 * @returns {number}
 */
function toPositiveInt(value, defaultValue) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return defaultValue;
  }
  return Math.floor(value);
}

/**
 * @returns {string}
 */
function createRpcId() {
  const c = globalThis?.crypto;
  const uuid = typeof c?.randomUUID === 'function' ? c.randomUUID() : null;
  if (uuid) return uuid.toLowerCase().replace(/-/g, '_');
  return `r${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * @param {unknown} signal
 * @returns {signal is AbortSignal}
 */
function isAbortSignal(signal) {
  return (
    !!signal &&
    typeof signal === 'object' &&
    typeof /** @type {{ aborted?: unknown }} */ (signal).aborted === 'boolean'
  );
}

/**
 * @param {AbortSignal} signal
 * @returns {unknown}
 */
function getAbortReason(signal) {
  return /** @type {AbortSignal & { reason?: unknown }} */ (signal).reason;
}

/**
 * @param {import('./types.d.ts').EventRecord} evt
 * @returns {unknown}
 */
function getEventMeta(evt) {
  return /** @type {{ meta?: unknown }} */ (/** @type {unknown} */ (evt)).meta;
}

/**
 * @param {unknown} meta
 * @returns {meta is RpcRequestMeta}
 */
function isRpcRequestMeta(meta) {
  if (!meta || typeof meta !== 'object') return false;
  const obj = /** @type {Record<string, unknown>} */ (meta);
  return (
    obj.kind === RPC_KIND_REQUEST &&
    typeof obj.replyTo === 'string' &&
    typeof obj.requestId === 'string'
  );
}

/**
 * @param {unknown} meta
 * @param {string} requestId
 * @returns {meta is RpcResponseMeta}
 */
function isRpcResponseMeta(meta, requestId) {
  if (!meta || typeof meta !== 'object') return false;
  const obj = /** @type {Record<string, unknown>} */ (meta);
  return obj.kind === RPC_KIND_RESPONSE && obj.requestId === requestId;
}

/**
 * Normalize AbortSignal abort reasons to a stable Error instance/message.
 * Node's AbortController.abort() (no reason) uses a DOMException with a
 * platform-specific message ("This operation was aborted"), which we
 * intentionally map to a consistent message for callers/tests.
 *
 * @param {unknown} reason
 * @returns {Error}
 */
function toAbortError(reason) {
  if (reason instanceof Error) {
    if (reason.name === 'AbortError') {
      const msg = String(reason.message || '').toLowerCase();
      if (!msg || msg.includes('aborted')) return new Error(DEFAULT_ABORT_MESSAGE);
    }
    if (!reason.message) return new Error(DEFAULT_ABORT_MESSAGE);
    return reason;
  }

  if (reason === undefined || reason === null) return new Error(DEFAULT_ABORT_MESSAGE);

  const text = String(reason);
  return new Error(text.trim().length ? text : DEFAULT_ABORT_MESSAGE);
}

/**
 * MessageBus - RPC over EventBus
 */
export class MessageBus {
  /**
   * @param {EventBus} [eventBus]
   */
  constructor(eventBus) {
    if (eventBus === undefined || eventBus === null) {
      /** @type {EventBus} */
      this.eventBus = new EventBus();
      /** @type {boolean} */
      this._ownsEventBus = true;
      return;
    }
    if (!(eventBus instanceof EventBus)) {
      throw new TypeError('MessageBus(eventBus): eventBus must be an EventBus');
    }
    this.eventBus = eventBus;
    this._ownsEventBus = false;
  }

  /**
   * 释放资源
   * @returns {void}
   */
  dispose() {
    if (this._ownsEventBus && typeof this.eventBus?.dispose === 'function') {
      try {
        this.eventBus.dispose();
      } catch {
        // ignore
      }
    }
  }

  /**
   * 发送单向消息
   * @param {string} type
   * @param {unknown} payload
   * @returns {EventRecord}
   */
  emit(type, payload) {
    const name = toNonEmptyString(type);
    if (!name || !isValidEventName(name)) {
      throw new Error('MessageBus.emit(type, payload): type must be a valid event name');
    }
    // Always wrap as EventRecord-like to preserve `undefined` payloads and avoid
    // EventBus heuristics that would treat `{ payload: ... }` objects specially.
    return this.eventBus.emit(name, { payload });
  }

  /**
   * 订阅消息
   * @param {string} type
   * @param {(payload: unknown, evt: unknown) => void | Promise<void>} handler
   * @returns {() => void}
   */
  on(type, handler) {
    const name = toNonEmptyString(type);
    if (!name || !isValidEventName(name)) {
      throw new Error('MessageBus.on(type, handler): type must be a valid event name');
    }
    if (typeof handler !== 'function') {
      throw new TypeError('MessageBus.on(type, handler): handler must be a function');
    }

    const off = this.eventBus.on(name, (evt) => {
      const meta = getEventMeta(evt);
      if (!isRpcRequestMeta(meta)) {
        handler(evt.payload, evt);
        return;
      }

      const replyTo = meta.replyTo;
      const requestId = meta.requestId;

      Promise.resolve()
        .then(() => handler(evt.payload, evt))
        .then(
          (data) => {
            this.eventBus.emit(replyTo, {
              payload: { ok: true, data },
              meta: { kind: RPC_KIND_RESPONSE, requestId },
            });
          },
          (err) => {
            const message = err instanceof Error ? err.message : String(err);
            this.eventBus.emit(replyTo, {
              payload: { ok: false, error: message },
              meta: { kind: RPC_KIND_RESPONSE, requestId },
            });
          }
        );
    });

    return /** @type {() => void} */ (off);
  }

  /**
   * 发送请求并等待响应
   * @template T
   * @param {string} type
   * @param {unknown} payload
   * @param {{ timeoutMs?: number, signal?: AbortSignal }} [options]
   * @returns {Promise<T>}
   */
  request(type, payload, options = {}) {
    const name = toNonEmptyString(type);
    if (!name || !isValidEventName(name)) {
      throw new Error('MessageBus.request(type, payload): type must be a valid event name');
    }

    const timeoutMs = toPositiveInt(options?.timeoutMs, DEFAULT_TIMEOUT_MS);
    const signal = options?.signal;
    if (signal !== undefined && !isAbortSignal(signal)) {
      throw new TypeError('MessageBus.request(...): options.signal must be an AbortSignal');
    }

    const requestId = createRpcId();
    const replyTo = `rpc.response.${requestId}`;

    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) {
        reject(toAbortError(getAbortReason(signal)));
        return;
      }

      let done = false;
      /** @type {ReturnType<typeof setTimeout> | null} */
      let timerId = null;
      /** @type {(() => void) | null} */
      let off = null;
      /** @type {(() => void) | null} */
      let onAbort = null;

      const cleanup = () => {
        if (done) return;
        done = true;

        if (timerId) {
          try {
            clearTimeout(timerId);
          } catch {
            // ignore
          }
        }
        timerId = null;

        try {
          off?.();
        } catch {
          // ignore
        }
        off = null;

        if (onAbort && signal && typeof signal.removeEventListener === 'function') {
          try {
            signal.removeEventListener('abort', onAbort);
          } catch {
            // ignore
          }
        }
        onAbort = null;
      };

      /** @param {T} value */
      const finishResolve = (value) => {
        cleanup();
        resolve(value);
      };

      /** @param {Error} error */
      const finishReject = (error) => {
        cleanup();
        reject(error);
      };

      onAbort = () => finishReject(toAbortError(signal ? getAbortReason(signal) : undefined));
      if (signal && typeof signal.addEventListener === 'function') {
        try {
          signal.addEventListener('abort', onAbort, { once: true });
        } catch {
          // ignore
        }
      }

      off = /** @type {() => void} */ (
        this.eventBus.once(replyTo, (evt) => {
          const meta = getEventMeta(evt);
          if (!isRpcResponseMeta(meta, requestId)) {
            finishReject(new Error(`Invalid response for requestId: ${requestId}`));
            return;
          }

          const body = evt.payload;
          if (body && typeof body === 'object' && 'ok' in body) {
            const rsp = /** @type {RpcResponseBody} */ (body);
            if (rsp.ok) finishResolve(/** @type {T} */ (rsp.data));
            else finishReject(new Error(rsp.error || 'Request failed'));
            return;
          }

          finishResolve(/** @type {T} */ (body));
        })
      );

      timerId = setTimeout(() => {
        finishReject(new Error(`Request timeout after ${timeoutMs}ms: ${name}`));
      }, timeoutMs);

      this.eventBus.emit(name, {
        payload,
        meta: { kind: RPC_KIND_REQUEST, requestId, replyTo },
      });
    });
  }
}

export default MessageBus;
