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
const INIT_TIMEOUT_MS = 30_000;
const PERSIST_DEBOUNCE_MS = 500;

/**
 * @typedef {{ kind: string, requestId: string, replyTo: string }} RpcRequestMeta
 * @typedef {{ kind: string, requestId: string }} RpcResponseMeta
 * @typedef {{ ok: boolean, data?: unknown, error?: string }} RpcResponseBody
 * @typedef {object} Message
 * @property {string} id - Message id
 * @property {string} type - 消息类型
 * @property {unknown} payload - 消息负载
 * @property {string} from - 发送方标识
 * @property {string} [to] - 定向接收方标识
 * @property {string} [channel] - 消息频道 (topic-based routing)
 * @property {number} ts - 时间戳（毫秒）
 * @property {unknown} [metadata] - 扩展元数据
 * @typedef {{ to?: string, channel?: string, metadata?: unknown, trace?: { traceId: string, spanId?: string, parentSpanId?: string, traceparent?: string } }} EmitOptions
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
 * @returns {string}
 */
function createReplyToEventName() {
  const c = globalThis?.crypto;
  const uuid = typeof c?.randomUUID === 'function' ? c.randomUUID() : null;
  if (uuid) return `rpc.response.${uuid.toLowerCase().replace(/-/g, '_')}`;

  const partA = Math.random().toString(36).slice(2, 12) || '0';
  const partB = Math.random().toString(36).slice(2, 12) || '0';
  return `rpc.response.r_${partA}_${partB}`;
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
 * @template T
 * @param {Promise<T> | T} value
 * @param {number} timeoutMs
 * @returns {Promise<T>}
 */
function withTimeout(value, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timerId = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`Operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    Promise.resolve(value).then(
      (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timerId);
        resolve(result);
      },
      (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timerId);
        reject(err);
      }
    );
  });
}

/**
 * MessageBus - RPC over EventBus
 */
export class MessageBus {
  /**
   * @param {EventBus | { eventBus?: EventBus, archive?: any, runId?: string }} [eventBusOrOptions]
   */
  constructor(eventBusOrOptions) {
    /** @type {string} */
    this._agentId = createRpcId();

    // 支持两种调用方式：new MessageBus(eventBus) 或 new MessageBus({ eventBus, archive, runId })
    let eventBus = eventBusOrOptions;
    let archive = null;
    let runId = 'default';

    if (eventBusOrOptions && typeof eventBusOrOptions === 'object' && !(eventBusOrOptions instanceof EventBus)) {
      const options = /** @type {{ eventBus?: EventBus, archive?: any, runId?: string }} */ (eventBusOrOptions);
      eventBus = options.eventBus;
      archive = options.archive || null;
      runId = options.runId || 'default';
    }

    if (eventBus === undefined || eventBus === null) {
      /** @type {EventBus} */
      this.eventBus = new EventBus();
      /** @type {boolean} */
      this._ownsEventBus = true;
    } else {
      if (!(eventBus instanceof EventBus)) {
        throw new TypeError('MessageBus(eventBus): eventBus must be an EventBus');
      }
      this.eventBus = eventBus;
      this._ownsEventBus = false;
    }

    // Archive 集成（用于 RPC 历史持久化）
    /** @type {any | null} */
    this._archive = archive;
    /** @type {string} */
    this._runId = runId;
    /** @type {Array<{ requestId: string, type: string, payload: unknown, response: unknown, timestamp: number, durationMs?: number }>} */
    this._rpcHistory = [];
    /** @type {number} */
    this._maxRpcHistory = 1000;
    /** @type {Promise<void> | null} */
    this._initPromise = null;
    /** @type {boolean} */
    this._disposed = false;

    /** @type {ReturnType<typeof setTimeout> | null} */
    this._persistRpcTimerId = null;
  }

  /** @type {Map<string, Promise<any>>} */
  _inflightRequests = new Map();

  /**
   * 初始化 MessageBus，从 Archive 恢复 RPC 历史（如果可用）
   * @returns {Promise<void>}
   */
  async init() {
    if (this._initPromise) return this._initPromise;
    if (!this._archive) return;

    this._initPromise = withTimeout(
      (async () => {
        try {
          const checkpoints = await this._archive.list(this._runId);
          if (!Array.isArray(checkpoints) || checkpoints.length === 0) return;

          // Hydrate RPC history from Archive to memory
          for (const ckpt of checkpoints) {
            if (!ckpt?.id) continue;

            // 只恢复 rpc 类型的检查点
            if (!ckpt.id.includes(':rpc:')) continue;

            try {
              const restored = await this._archive.load(ckpt.id);
              if (restored?.records && Array.isArray(restored.records)) {
                // 合并 RPC 历史到内存，去重
                const existingIds = new Set(this._rpcHistory.map(r => r.requestId));
                for (const record of restored.records) {
                  if (record?.requestId && !existingIds.has(record.requestId)) {
                    this._rpcHistory.push(record);
                    existingIds.add(record.requestId);
                  }
                }

                // 保持历史大小限制
                if (this._rpcHistory.length > this._maxRpcHistory) {
                  this._rpcHistory.splice(0, this._rpcHistory.length - this._maxRpcHistory);
                }
              }
            } catch (err) {
              // 持久化失败不影响启动
            }
          }
        } catch (err) {
          // 持久化失败不影响启动
        }
      })(),
      INIT_TIMEOUT_MS
    ).catch(() => {});

    return this._initPromise;
  }

  /**
   * 释放资源
   * @returns {void}
   */
  dispose() {
    if (this._disposed) return;
    this._disposed = true;

    // 清空 inflight requests Map（promise 通过 .then 自清理，这里释放 Map 引用）
    this._inflightRequests.clear();

    // Flush pending debounce timer before clearing history
    if (this._persistRpcTimerId !== null) {
      clearTimeout(this._persistRpcTimerId);
      this._persistRpcTimerId = null;
      this._flushRpc();
    }

    // 清空 RPC 历史（释放内存）
    this._rpcHistory.length = 0;

    // 释放 archive 引用
    this._archive = null;

    // 最后处理 owned EventBus
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
   * @param {EmitOptions} [options]
   * @returns {EventRecord}
   */
  emit(type, payload, options = {}) {
    if (this._disposed) {
      throw new Error('MessageBus.emit(): bus is disposed');
    }
    const name = toNonEmptyString(type);
    if (!name || !isValidEventName(name)) {
      throw new Error('MessageBus.emit(type, payload): type must be a valid event name');
    }

    const to = toNonEmptyString(options?.to);
    const channel = toNonEmptyString(options?.channel);

    /** @type {Message} */
    const message = {
      id: `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      type: name,
      payload,
      from: this._agentId,
      ...(to ? { to } : {}),
      ...(channel ? { channel } : {}),
      ts: Date.now(),
      ...(options?.metadata !== undefined ? { metadata: options.metadata } : {}),
    };

    const record = this.eventBus.emit(name, {
      payload,
      meta: {
        message,
        ...(to ? { to } : {}),
        ...(channel ? { channel } : {}),
        ...(options?.metadata !== undefined ? { metadata: options.metadata } : {}),
      },
      ...(options?.trace ? { trace: options.trace } : {}),
    });

    if (channel) {
      this.eventBus.emit(`channel:${channel}:${name}`, {
        payload,
        meta: {
          message,
          channel,
          ...(options?.metadata !== undefined ? { metadata: options.metadata } : {}),
        },
        ...(options?.trace ? { trace: options.trace } : {}),
      });
    }

    return record;
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
      const reqTrace = /** @type {any} */ (evt).trace;

      Promise.resolve()
        .then(() => handler(evt.payload, evt))
        .then(
          (data) => {
            this.eventBus.emit(replyTo, {
              payload: { ok: true, data },
              meta: { kind: RPC_KIND_RESPONSE, requestId },
              ...(reqTrace ? { trace: reqTrace } : {}),
            });
          },
          (err) => {
            const message = err instanceof Error ? err.message : String(err);
            this.eventBus.emit(replyTo, {
              payload: { ok: false, error: message },
              meta: { kind: RPC_KIND_RESPONSE, requestId },
              ...(reqTrace ? { trace: reqTrace } : {}),
            });
          }
        );
    });

    return /** @type {() => void} */ (off);
  }

  /**
   * Subscribe to messages on a specific channel.
   * @param {string} channel - Channel name
   * @param {string} type - Message type (or "*" for all)
   * @param {(payload: unknown, evt: unknown) => void | Promise<void>} handler
   * @returns {() => void} unsubscribe
   */
  onChannel(channel, type, handler) {
    if (typeof channel !== 'string' || typeof type !== 'string' || typeof handler !== 'function') {
      return () => {};
    }

    const key = `channel:${channel}:${type}`;

    const off = this.eventBus.on(key, (evt) => {
      handler(evt.payload, evt);
    });

    return /** @type {() => void} */ (off);
  }

  /**
   * 发送请求并等待响应
   * @template T
   * @param {string} type
   * @param {unknown} payload
   * @param {{ timeoutMs?: number, signal?: AbortSignal, idempotencyKey?: string, trace?: { traceId: string, spanId?: string, parentSpanId?: string, traceparent?: string } }} [options]
   * @returns {Promise<T>}
   */
  request(type, payload, options = {}) {
    if (this._disposed) {
      return Promise.reject(new Error('MessageBus.request(): bus is disposed'));
    }
    const name = toNonEmptyString(type);
    if (!name || !isValidEventName(name)) {
      throw new Error('MessageBus.request(type, payload): type must be a valid event name');
    }

    // Idempotency: deduplicate in-flight requests with same key
    const idempotencyKey = toNonEmptyString(options?.idempotencyKey);
    if (idempotencyKey && this._inflightRequests.has(idempotencyKey)) {
      return /** @type {Promise<T>} */ (this._inflightRequests.get(idempotencyKey));
    }

    const timeoutMs = toPositiveInt(options?.timeoutMs, DEFAULT_TIMEOUT_MS);
    const signal = options?.signal;
    if (signal !== undefined && !isAbortSignal(signal)) {
      throw new TypeError('MessageBus.request(...): options.signal must be an AbortSignal');
    }

    const requestId = createRpcId();
    const replyTo = createReplyToEventName();
    const startTime = Date.now();

    const promise = new Promise((resolve, reject) => {
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
        const durationMs = Date.now() - startTime;
        this._recordRpc(requestId, name, payload, { ok: true, data: value }, startTime, durationMs);
        cleanup();
        resolve(value);
      };

      /** @param {Error} error */
      const finishReject = (error) => {
        const durationMs = Date.now() - startTime;
        this._recordRpc(requestId, name, payload, { ok: false, error: error.message }, startTime, durationMs);
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
        ...(options?.trace ? { trace: options.trace } : {}),
      });
    });

    // Cache in-flight promise for idempotency dedup
    if (idempotencyKey) {
      this._inflightRequests.set(idempotencyKey, promise);
      const clearInflight = () => {
        this._inflightRequests.delete(idempotencyKey);
      };
      void promise.then(clearInflight, clearInflight);
    }
    return promise;
  }

  /**
   * 记录 RPC 调用到历史并触发异步持久化
   * @private
   * @param {string} requestId
   * @param {string} type
   * @param {unknown} payload
   * @param {unknown} response
   * @param {number} timestamp
   * @param {number} durationMs
   * @returns {void}
   */
  _recordRpc(requestId, type, payload, response, timestamp, durationMs) {
    const record = {
      requestId,
      type,
      payload,
      response,
      timestamp,
      durationMs,
    };

    this._rpcHistory.push(record);

    // 保持历史大小限制
    if (this._rpcHistory.length > this._maxRpcHistory) {
      this._rpcHistory.shift();
    }

    // 异步持久化到 Archive (dual-write pattern)
    this._persistRpcAsync();
  }

  /**
   * 异步持久化 RPC 历史到 Archive (dual-write pattern)
   * @private
   * @returns {void}
   */
  _persistRpcAsync() {
    if (!this._archive || this._rpcHistory.length === 0) return;
    if (this._persistRpcTimerId !== null) {
      clearTimeout(this._persistRpcTimerId);
    }
    this._persistRpcTimerId = setTimeout(() => {
      this._persistRpcTimerId = null;
      this._flushRpc();
    }, PERSIST_DEBOUNCE_MS);
  }

  /**
   * 立即执行 RPC 历史持久化写入（fire-and-forget）
   * @private
   * @returns {void}
   */
  _flushRpc() {
    if (!this._archive || this._rpcHistory.length === 0) return;
    const archive = this._archive;
    const runId = this._runId;
    const snapshot = [...this._rpcHistory];
    (async () => {
      try {
        const checkpointId = `${runId}:rpc:${Date.now()}`;
        await archive.save(checkpointId, {
          schemaVersion: 1,
          records: snapshot,
          timestamp: Date.now(),
          metadata: { runId, recordCount: snapshot.length },
        });
      } catch (err) {
        // 持久化失败不影响内存操作
      }
    })();
  }
}

export default MessageBus;
