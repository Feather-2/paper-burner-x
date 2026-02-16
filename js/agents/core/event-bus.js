/**
 * EventBus - 统一事件总线
 *
 * 合并了 core/event-bus 和 runtime/events/event-bus 的功能：
 *
 * 来自 core:
 * - waitFor() 等待事件
 * - getHistory() 事件历史
 * - emitSync() 同步发射
 *
 * 来自 runtime:
 * - 优先级订阅 (priority)
 * - 背压控制 (backpressure)
 * - Lamport 逻辑时钟
 * - EventRecord 结构化事件
 * - 持久化适配器
 * - AbortSignal 支持
 */

import { createLogger } from '../shared/index.js';
import { createEventRecord, createEventBusClock } from './event-record.js';
import { createEventId, matchPattern } from './event-bus-utils.js';
import { EventBusSubscriptions } from './event-bus-subscriptions.js';
import {
  appendEventsToRunStore,
  assertPersistenceAdapter,
  assertRunStoreShape,
  cancelBackpressureSchedule,
  collectMatchingWaiters,
  createBackpressureState,
  createReplayEvent,
  extractEventDataFields,
  flushBackpressureQueue,
  isObject,
  normalizeRunStore,
  toWaitForResult,
  enqueueBackpressureEvent,
} from './event-bus-helpers.js';

/**
 * @typedef {import('./types.d.ts').EventBusOptions} CoreEventBusOptions
 * @typedef {import('./types.d.ts').LamportClockState} LamportClockState
 * @typedef {import('./types.d.ts').EventRecord} CoreEventRecord
 */

/**
 * EventBus 内部使用的结构化事件记录。
 *
 * 说明：
 * - `CoreEventRecord` 来自 `core/types.d.ts`（兼容旧字段：id/type/timestamp/clock）
 * - 本模块同时保留运行时字段：schemaVersion/eventId/runId/ts/name/_clock/seq 等
 *
 * @typedef {Omit<CoreEventRecord, 'payload'> & { payload?: unknown } & {
 *   schemaVersion: string,
 *   eventId: string,
 *   runId: string | null,
 *   ts: string,
 *   name: string,
 *   actor: string,
 *   level?: string,
 *   durationMs?: number,
 *   meta?: unknown,
 *   status?: string,
 *   _clock: LamportClockState,
 *   seq: number,
 * }} EventRecord
 */

/**
 * EventBus 构造参数
 * - 基础字段对齐 `core/types.d.ts` 的 `EventBusOptions`
 * - 扩展字段为本模块的兼容/增强能力（不要求调用方提供）
 *
 * @typedef {CoreEventBusOptions & {
 *   runId?: string | null,
 *   persistenceAdapter?: any,
 *   onListenerError?: (err: unknown, evt: EventRecord, fn: Function) => void,
 * }} EventBusOptions
 */

/**
 * @typedef {import('./event-bus-subscriptions.js').EventHandler} EventHandler
 */

const logger = createLogger('core/event-bus');
const PERSIST_DEBOUNCE_MS = 500;

// ============================================================
// 持久化适配器
// ============================================================

/**
 * RunStoreAdapter - 将 RunStore 适配为 EventBus 的 persistenceAdapter 接口。
 *
 * 兼容两种 runStore 形态：
 * - runStore.appendEvents(runId, events[]) + runStore.getEvents(runId)
 * - runStore.appendEvent(runId, event) + runStore.getEvents(runId)
 */
export class RunStoreAdapter {
  /**
   * @param {any} runStore
   */
  constructor(runStore) {
    const store = normalizeRunStore(runStore);
    assertRunStoreShape(store);
    this._runStore = store;
  }

  /**
   * @param {any[]} events
   * @returns {Promise<any>}
   */
  async appendEvents(events) {
    return appendEventsToRunStore(this._runStore, events);
  }

  /**
   * @param {string} runId
   * @returns {Promise<any[]>}
   */
  async getEvents(runId) {
    return this._runStore.getEvents(runId);
  }
}

// ============================================================
// EventBus 主类
// ============================================================

export class EventBus {
  /**
   * @param {Partial<EventBusOptions>} [options]
   */
  constructor(options = {}) {
    this.runId = options.runId || null;
    this._seq = 0;

    this._subscriptions = new EventBusSubscriptions();

    // 事件历史
    this._history = options.keepHistory ? [] : null;
    this._maxHistory = options.maxHistory || 100;

    // 背压控制
    this._backpressure = null;

    // 持久化
    const adapter = options.persistenceAdapter ?? null;
    if (adapter !== null) {
      assertPersistenceAdapter(adapter);
    }
    this._persistenceAdapter = adapter;
    this._onListenerError = options.onListenerError || null;

    // Archive 集成（用于历史持久化）
    /** @type {import('../archive/archive-core.js').Archive | null} */
    this._archive = options.archive || null;

    // 等待队列 (用于 waitFor)
    this._waiters = new Map(); // pattern -> Set({ resolve, reject, timer })

    /** @type {Promise<void> | null} */
    this._initPromise = null;

    /** @type {ReturnType<typeof setTimeout> | null} */
    this._persistHistoryTimerId = null;
  }

  // ============================================================
  // 初始化
  // ============================================================

  /**
   * 初始化 EventBus，从 Archive 恢复历史（如果可用）
   * @returns {Promise<void>}
   */
  async init() {
    if (this._initPromise) return this._initPromise;
    if (!this._archive || !this._history) return;

    this._initPromise = (async () => {
      try {
        const checkpoints = await this._archive.list(this.runId);
        if (!Array.isArray(checkpoints) || checkpoints.length === 0) return;

        // Hydrate history from Archive to memory
        for (const ckpt of checkpoints) {
          if (!ckpt?.id) continue;
          const parts = ckpt.id.split(':');
          if (parts.length < 2) continue;

          // 只恢复 history 类型的检查点
          if (!ckpt.id.includes(':history:')) continue;

          try {
            const restored = await this._archive.load(ckpt.id);
            if (restored?.events && Array.isArray(restored.events)) {
              // 合并历史事件到内存，去重
              const existingIds = new Set(this._history.map(e => e.eventId));
              for (const evt of restored.events) {
                if (evt?.eventId && !existingIds.has(evt.eventId)) {
                  this._history.push(evt);
                  existingIds.add(evt.eventId);
                }
              }

              // 保持历史大小限制
              if (this._history.length > this._maxHistory) {
                this._history.splice(0, this._history.length - this._maxHistory);
              }
            }
          } catch (err) {
            logger.warn(`Failed to hydrate history from ${ckpt.id}:`, err);
          }
        }
      } catch (err) {
        logger.warn('Failed to hydrate history from Archive:', err);
      }
    })();

    return this._initPromise;
  }

  // ============================================================
  // 订阅 API
  // ============================================================

  /**
   * 订阅事件
   * @param {string} name - 事件名或通配符模式
   * @param {EventHandler} handler - 处理函数
   * @param {{ priority?: number }} [options] - 可选配置（priority: 正数=高优先级，负数=低优先级，0=默认）
   * @returns {() => void} 取消订阅函数
   */
  on(name, handler, options) {
    return this._subscriptions.on(name, handler, options);
  }

  /**
   * 一次性订阅
   * @param {string} name - 事件名或通配符模式
   * @param {EventHandler} handler - 处理函数
   * @returns {() => void} 取消订阅函数
   */
  once(name, handler) {
    return this._subscriptions.once(name, handler);
  }

  /**
   * 高级订阅（支持优先级和 AbortSignal）
   *
   * ⚠️ 内存泄漏风险：必须手动调用返回的 unsubscribe 函数以释放监听器。
   * 未调用 unsubscribe 会导致监听器累积，造成内存泄漏。
   *
   * @param {string} eventType - 事件类型
   * @param {EventHandler} handler - 处理函数
   * @param {{ priority?: number, signal?: AbortSignal }} [options] - { priority, signal }
   * @returns {() => void} 取消订阅函数
   */
  subscribe(eventType, handler, options = {}) {
    const unsub = this._subscriptions.subscribe(eventType, handler, options);

    // 监控订阅数，检测潜在泄漏
    const count = this._subscriptions.count(eventType);
    if (count > 100) {
      logger.warn(`High subscription count for ${eventType}: ${count}. Potential memory leak - ensure unsubscribe is called.`);
    }

    return unsub;
  }

  /**
   * 取消订阅
   * @param {string} name - 事件名或通配符模式
   * @param {EventHandler} handler - 处理函数
   * @returns {boolean} 是否成功取消
   */
  off(name, handler) {
    return this._subscriptions.off(name, handler);
  }

  // ============================================================
  // 发射 API
  // ============================================================

  /**
   * 发射事件（异步处理）
   * @param {string} name - 事件名
   * @param {unknown} [data] - 事件数据或 EventRecord-like 对象
   * @returns {EventRecord} 结构化事件记录
   */
  emit(name, data = {}) {
    const evt = this._createEvent(name, data);

    // 记录历史
    if (this._history) {
      this._history.push(evt);
      if (this._history.length > this._maxHistory) {
        this._history.shift();
      }

      // 持久化历史到 Archive (dual-write pattern)
      this._persistHistoryAsync();
    }

    // 持久化到 persistenceAdapter
    this._persistAsync([evt]);

    // 检查 waitFor
    this._resolveWaiters(name, evt);

    // 背压处理
    if (this._backpressure?.enabled) {
      this._enqueueBackpressure(evt);
    } else {
      this._dispatch(evt);
    }

    return evt;
  }

  /**
   * 同步发射（立即执行所有处理器，不等待异步）
   * @param {string} name - 事件名
   * @param {unknown} [data] - 事件数据或 EventRecord-like 对象
   * @returns {EventRecord} 结构化事件记录
   */
  emitSync(name, data = {}) {
    const evt = this._createEvent(name, data);

    if (this._history) {
      this._history.push(evt);
      if (this._history.length > this._maxHistory) {
        this._history.shift();
      }

      // 持久化历史到 Archive (dual-write pattern)
      this._persistHistoryAsync();
    }

    this._resolveWaiters(name, evt);
    this._dispatchSync(evt);

    return evt;
  }

  /**
   * 等待某个事件
   * @param {string} pattern - 事件模式
   * @param {number | { timeout?: number, signal?: AbortSignal }} [options] - 超时毫秒或选项对象
   * @returns {Promise<{ type: string, payload: unknown, event?: string, data?: unknown }>}
   */
  waitFor(pattern, options = 30000) {
    // 支持 (pattern, timeout) 和 (pattern, { timeout, signal }) 两种调用方式
    const timeout = typeof options === 'number' ? options : (options?.timeout ?? 30000);
    const signal = typeof options === 'object' ? options?.signal : undefined;

    return new Promise((resolve, reject) => {
      // 检查是否已取消
      if (signal?.aborted) {
        reject(signal.reason || new Error('Aborted'));
        return;
      }

      let settled = false;

      const timer = timeout > 0
        ? setTimeout(() => {
            waiter.reject(new Error(`EventBus.waitFor timeout: ${pattern}`));
          }, timeout)
        : null;

      let abortHandler = null;

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        this._removeWaiter(pattern, waiter);
        if (abortHandler && signal) {
          signal.removeEventListener('abort', abortHandler);
        }
      };

      const settle = (fn) => {
        if (settled) return;
        settled = true;
        cleanup();
        fn();
      };

      const waiter = {
        resolve: (evt) => {
          settle(() => resolve(toWaitForResult(evt)));
        },
        reject: (err) => {
          settle(() => reject(err));
        },
        _deferResolve: (evt) => {
          if (settled) return null;
          settled = true;
          cleanup();
          return () => resolve(toWaitForResult(evt));
        },
        timer,
      };

      // 设置 abort 处理
      if (signal) {
        abortHandler = () => {
          waiter.reject(signal.reason || new Error('Aborted'));
        };
        signal.addEventListener('abort', abortHandler, { once: true });
      }

      let waiters = this._waiters.get(pattern);
      if (!waiters) {
        waiters = new Set();
        this._waiters.set(pattern, waiters);
      }
      waiters.add(waiter);
    });
  }

  // ============================================================
  // 背压控制
  // ============================================================

  /**
   * 启用背压控制
   * @param {{ batchWindowMs?: number, maxQueueSize?: number, dropPolicy?: 'oldest' | 'newest' }} [options]
   * @returns {this}
   */
  enableBackpressure(options = {}) {
    if (this._backpressure?.enabled) {
      this.disableBackpressure();
    }
    this._backpressure = createBackpressureState(options);

    return this;
  }

  /**
   * 禁用背压控制
   * @returns {this}
   */
  disableBackpressure() {
    if (!this._backpressure?.enabled) return this;

    const bp = this._backpressure;
    bp.enabled = false;
    cancelBackpressureSchedule(bp);

    this._flushBackpressure();
    this._backpressure = null;
    return this;
  }

  // ============================================================
  // 历史与状态
  // ============================================================

  /**
   * 获取事件历史
   * @param {string} [pattern] - 事件模式（支持通配符）
   * @returns {EventRecord[]}
   */
  getHistory(pattern) {
    if (!this._history) return [];
    if (!pattern) return [...this._history];

    return this._history.filter(e => matchPattern(pattern, e.name));
  }

  /**
   * 清空历史
   * @returns {void | Promise<void>}
   */
  clearHistory() {
    if (!this._history) return;

    this._history.length = 0;

    // 清理 Archive 中的历史检查点
    if (this._archive && this.runId) {
      return (async () => {
        try {
          const checkpoints = await this._archive.list(this.runId);
          if (!Array.isArray(checkpoints)) return;

          for (const ckpt of checkpoints) {
            if (ckpt?.id && ckpt.id.includes(':history:')) {
              try {
                await this._archive.delete(ckpt.id);
              } catch (err) {
                logger.debug(`Failed to delete history checkpoint ${ckpt.id}:`, err);
              }
            }
          }
        } catch (err) {
          logger.warn('Failed to clear history from Archive:', err);
        }
      })();
    }
  }

  /**
   * 重放事件
   * @param {string} runId
   * @returns {Promise<EventRecord[]>}
   */
  async replay(runId) {
    if (!this._persistenceAdapter) {
      throw new Error('EventBus.replay: persistenceAdapter is required');
    }

    if (typeof runId !== 'string' || !runId) {
      throw new TypeError('EventBus.replay: runId must be a string');
    }

    let events;
    try {
      events = await this._persistenceAdapter.getEvents(runId);
    } catch (err) {
      throw new Error(`EventBus.replay: failed to load events (${err?.message || String(err)})`);
    }
    if (!Array.isArray(events)) {
      if (events == null) {
        throw new Error(`EventBus.replay: no events found (runId=${runId})`);
      }
      throw new TypeError("EventBus.replay: persistenceAdapter.getEvents must return an array");
    }

    const result = [];
    let skippedCount = 0;
    for (const raw of events) {
      if (!isObject(raw)) { skippedCount++; continue; }
      try {
        const evt = createReplayEvent(raw, runId);
        this._dispatch(evt);
        result.push(evt);
      } catch (err) {
        logger.debug("Skipping malformed replay event", { error: err?.message });
        skippedCount++;
      }
    }

    // P1: Emit replay skipped telemetry
    if (skippedCount > 0) {
      try {
        this._dispatch(createEventRecord({
          name: 'eventbus:replay:skipped',
          actor: 'system',
          payload: { skippedCount, totalCount: events.length, runId },
          runId: this.runId,
        }));
      } catch (err) {
        logger.debug("Failed to emit replay skipped telemetry", { error: err?.message });
      }
    }

    return result;
  }

  /**
   * 清理所有监听器
   * @returns {void}
   */
  clear() {
    if (this._persistHistoryTimerId !== null) {
      clearTimeout(this._persistHistoryTimerId);
      this._persistHistoryTimerId = null;
      this._flushHistory();
    }
    this._subscriptions.clear();
    this._waiters.clear();
    if (this._history) this._history.length = 0;
    this.disableBackpressure();
  }

  /**
   * 销毁（别名）
   * @returns {void}
   */
  dispose() {
    this.clear();
  }

  // ============================================================
  // 内部方法
  // ============================================================

  /**
   * @param {string} name
   * @param {unknown} data
   * @returns {EventRecord}
   */
  _createEvent(name, data) {
    const { payload, meta, actor, status, level, trace } = extractEventDataFields(data);

    return createEventRecord({
      runId: this.runId,
      eventId: createEventId(this.runId, ++this._seq),
      ts: new Date().toISOString(),
      name,
      payload,
      meta,
      ...(actor ? { actor } : {}),
      ...(status ? { status } : {}),
      ...(level ? { level } : {}),
      ...(trace ? { trace } : {}),
    });
  }

  /**
   * @param {EventRecord} evt
   * @returns {void}
   */
  _dispatch(evt) {
    const handlers = this._collectHandlers(evt.name);

    for (const { fn } of handlers) {
      try {
        const result = fn(evt);
        if (result && typeof result.then === 'function') {
          result.catch(err => this._handleError(err, evt, fn));
        }
      } catch (err) {
        this._handleError(err, evt, fn);
      }
    }
  }

  /**
   * @param {EventRecord} evt
   * @returns {void}
   */
  _dispatchSync(evt) {
    const handlers = this._collectHandlers(evt.name);

    for (const { fn } of handlers) {
      try {
        fn(evt);
      } catch (err) {
        this._handleError(err, evt, fn);
      }
    }
  }

  /**
   * @param {string} eventName
   * @returns {{ fn: Function, priority: number }[]}
   */
  _collectHandlers(eventName) {
    return this._subscriptions.collectHandlers(eventName);
  }

  /**
   * @param {string} eventName
   * @param {EventRecord} evt
   * @returns {void}
   */
  _resolveWaiters(eventName, evt) {
    const toResolve = collectMatchingWaiters(this._waiters, eventName);

    for (const { pattern, waiters } of toResolve) {
      this._waiters.delete(pattern);

      for (const waiter of waiters) {
        const deliver = typeof waiter._deferResolve === 'function'
          ? waiter._deferResolve(evt)
          : () => waiter.resolve(evt);
        if (deliver) {
          queueMicrotask(deliver);
        }
      }
    }
  }

  /**
   * @param {string} pattern
   * @param {{ resolve: Function, reject: Function, timer: any }} waiter
   * @returns {void}
   */
  _removeWaiter(pattern, waiter) {
    const waiters = this._waiters.get(pattern);
    if (waiters) {
      waiters.delete(waiter);
      if (waiters.size === 0) {
        this._waiters.delete(pattern);
      }
    }
  }

  /**
   * @param {EventRecord} evt
   * @returns {void}
   */
  _enqueueBackpressure(evt) {
    const bp = this._backpressure;
    if (!bp) return;

    enqueueBackpressureEvent(bp, evt);

    if (bp.dropCount > 0) {
      const dropCount = bp.dropCount;
      bp.dropCount = 0;
      try {
        this._dispatch(createEventRecord({
          name: 'eventbus:backpressure:drop',
          actor: 'system',
          payload: { dropCount, queueSize: bp.queue.length, maxQueueSize: bp.maxQueueSize },
          runId: this.runId,
        }));
      } catch (err) {
        logger.debug("Failed to emit backpressure drop telemetry", { error: err?.message });
      }
    }

    this._scheduleFlush();
  }

  /**
   * @returns {void}
   */
  _scheduleFlush() {
    const bp = this._backpressure;
    if (!bp?.enabled || bp.scheduled) return;

    bp.scheduled = true;
    const ref = bp;

    const flush = () => {
      if (this._backpressure !== ref) return;
      ref.rafId = null;
      ref.timeoutId = null;
      this._flushBackpressure();
    };

    if (typeof requestAnimationFrame === 'function' && bp.batchWindowMs <= 0) {
      bp.rafId = requestAnimationFrame(flush);
    } else {
      bp.timeoutId = setTimeout(flush, bp.batchWindowMs);
    }
  }

  /**
   * @returns {void}
   */
  _flushBackpressure() {
    const bp = this._backpressure;
    if (!bp) return;
    flushBackpressureQueue(bp, (queuedEvent) => this._dispatch(queuedEvent));
  }

  /**
   * @param {EventRecord[]} events
   * @returns {void}
   */
  _persistAsync(events) {
    if (!this._persistenceAdapter) return;

    queueMicrotask(() => {
      try {
        const result = this._persistenceAdapter.appendEvents(events);
        if (result?.then) {
          result.catch((err) => {
            logger.warn("Event persistence error", { error: err.message });
            // P1: Emit persistence failure event
            try {
              this._dispatch(createEventRecord({
                name: 'eventbus:persist:failed',
                actor: 'system',
                payload: { error: err?.message || String(err), eventCount: events.length },
                runId: this.runId,
              }));
            } catch (e) {
              logger.debug("Failed to emit persistence failure telemetry", { error: e?.message });
            }
          });
        }
      } catch (e) {
        logger.debug("Event persistence sync error", { error: e?.message });
        // P1: Emit persistence failure event
        try {
          this._dispatch(createEventRecord({
            name: 'eventbus:persist:failed',
            actor: 'system',
            payload: { error: e?.message || String(e), eventCount: events.length },
            runId: this.runId,
          }));
        } catch (err) {
          logger.debug("Failed to emit persistence failure telemetry", { error: err?.message });
        }
      }
    });
  }

  /**
   * 异步持久化历史到 Archive (dual-write pattern)
   * @private
   * @returns {void}
   */
  _persistHistoryAsync() {
    if (!this._archive || !this._history || this._history.length === 0) return;
    if (this._persistHistoryTimerId !== null) {
      clearTimeout(this._persistHistoryTimerId);
    }
    this._persistHistoryTimerId = setTimeout(() => {
      this._persistHistoryTimerId = null;
      this._flushHistory();
    }, PERSIST_DEBOUNCE_MS);
  }

  /**
   * 立即执行历史持久化写入（fire-and-forget）
   * @private
   * @returns {void}
   */
  _flushHistory() {
    if (!this._archive || !this._history || this._history.length === 0) return;
    const archive = this._archive;
    const runId = this.runId;
    const snapshot = [...this._history];
    (async () => {
      try {
        const checkpointId = `${runId}:history:${Date.now()}`;
        await archive.save(checkpointId, {
          schemaVersion: 1,
          events: snapshot,
          timestamp: Date.now(),
          metadata: { runId, eventCount: snapshot.length },
        });
      } catch (err) {
        logger.warn('Failed to persist history to Archive:', err);
      }
    })();
  }

  /**
   * @param {unknown} err
   * @param {EventRecord} evt
   * @param {Function} fn
   * @returns {void}
   */
  _handleError(err, evt, fn) {
    // P1: Emit handler error event
    try {
      this._dispatch(createEventRecord({
        name: 'eventbus:handler:error',
        actor: 'system',
        payload: {
          error: err?.message || String(err),
          eventName: evt?.name,
          handlerName: fn?.name || 'anonymous',
          stack: err?.stack,
        },
        runId: this.runId,
      }));
    } catch (e) {
      logger.debug("Failed to emit handler error telemetry", { error: e?.message });
    }

    if (this._onListenerError) {
      try {
        this._onListenerError(err, evt, fn);
      } catch (e) { logger.debug("onListenerError handler threw", { error: e?.message }); }
    } else {
      logger.error("Error in handler", { event: evt?.name, error: err?.message });
    }
  }

  /**
   * 获取当前时钟状态
   * @returns {LamportClockState}
   */
  getClock() {
    return createEventBusClock(this._seq);
  }
}

// ============================================================
// 导出
// ============================================================

export { LamportClock } from './lamport-clock.js';
export { createEventRecord } from './event-record.js';
export { isValidEventName, matchPattern, createEventId } from './event-bus-utils.js';
export default EventBus;
