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

// ============================================================
// 工具函数
// ============================================================

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function regexTest(re, text) {
  if (!re || typeof re.test !== 'function') return false;
  // Avoid RegExp.lastIndex footguns with /g and /y.
  if (re.global || re.sticky) re.lastIndex = 0;
  return re.test(text);
}

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
    const store = runStore && typeof runStore === 'object' ? runStore : {};
    if (typeof store.getEvents !== 'function') {
      throw new TypeError('RunStoreAdapter(runStore): runStore.getEvents must be a function');
    }
    if (typeof store.appendEvents !== 'function' && typeof store.appendEvent !== 'function') {
      throw new TypeError('RunStoreAdapter(runStore): runStore.appendEvents/appendEvent must be a function');
    }

    this._runStore = store;
  }

  /**
   * @param {any[]} events
   * @returns {Promise<any>}
   */
  async appendEvents(events) {
    if (!Array.isArray(events)) {
      throw new TypeError('RunStoreAdapter.appendEvents(events): events must be an array');
    }
    if (events.length === 0) return 0;

    const runStore = this._runStore;
    const hasBatch = typeof runStore.appendEvents === 'function';
    const total = events.length;

    const isValidEvent = (evt) => isObject(evt) && typeof evt.runId === 'string' && evt.runId;
    for (const evt of events) {
      if (!isValidEvent(evt)) {
        throw new TypeError('RunStoreAdapter.appendEvents(events): events must include a string runId');
      }
    }

    // 批量写入路径（优先）
    if (hasBatch) {
      /** @type {Map<string, any[]>} */
      const byRunId = new Map();
      for (const evt of events) {
        const runId = evt.runId;
        const bucket = byRunId.get(runId);
        if (bucket) bucket.push(evt);
        else byRunId.set(runId, [evt]);
      }

      const tasks = [];
      for (const [runId, batch] of byRunId) {
        tasks.push(runStore.appendEvents(runId, batch));
      }
      if (tasks.length === 0) return total;
      await Promise.all(tasks);
      return total;
    }

    // 单条写入路径（appendEvent-only）
    const tasks = [];
    for (const evt of events) {
      const runId = evt.runId;
      tasks.push(runStore.appendEvent(runId, evt));
    }
    if (tasks.length === 0) return total;
    await Promise.all(tasks);
    return total;
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
    this._backpressureGen = 0;

    // 持久化
    const adapter = options.persistenceAdapter ?? null;
    if (adapter !== null) {
      if (!isObject(adapter)) {
        throw new TypeError('EventBus: persistenceAdapter must be an object');
      }
      if (typeof adapter.appendEvents !== 'function') {
        throw new TypeError('EventBus: persistenceAdapter.appendEvents is required');
      }
      if (typeof adapter.getEvents !== 'function') {
        throw new TypeError('EventBus: persistenceAdapter.getEvents is required');
      }
    }
    this._persistenceAdapter = adapter;
    this._onListenerError = options.onListenerError || null;

    // 等待队列 (用于 waitFor)
    this._waiters = new Map(); // pattern -> Set({ resolve, reject, timer })
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
   * @param {string} eventType - 事件类型
   * @param {EventHandler} handler - 处理函数
   * @param {{ priority?: number, signal?: AbortSignal }} [options] - { priority, signal }
   * @returns {() => void} 取消订阅函数
   */
  subscribe(eventType, handler, options = {}) {
    return this._subscriptions.subscribe(eventType, handler, options);
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
    }

    // 持久化
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

      const toWaitForResult = (evt) => ({
        type: evt.name,
        payload: evt.payload ?? evt,
        // 兼容旧 API
        event: evt.name,
        data: evt.payload ?? evt,
      });

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
   * @param {{ batchWindowMs?: number, coalescePattern?: RegExp, deferNonCoalesced?: boolean, maxQueueSize?: number }} [options]
   * @returns {this}
   */
  enableBackpressure(options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('EventBus.enableBackpressure: options must be an object');
    }

    const {
      batchWindowMs = 16,
      coalescePattern = /\.progress$/,
      deferNonCoalesced = true,
      maxQueueSize = 1000,
    } = options;

    if (typeof batchWindowMs !== 'number' || !Number.isFinite(batchWindowMs) || batchWindowMs < 0) {
      throw new TypeError('EventBus.enableBackpressure: batchWindowMs must be a non-negative finite number');
    }
    if (!(coalescePattern instanceof RegExp)) {
      throw new TypeError('EventBus.enableBackpressure: coalescePattern must be a RegExp');
    }
    if (typeof maxQueueSize !== 'number' || !Number.isFinite(maxQueueSize) || maxQueueSize <= 0) {
      throw new TypeError('EventBus.enableBackpressure: maxQueueSize must be a positive finite number');
    }

    if (this._backpressure?.enabled) {
      this.disableBackpressure();
    }

    this._backpressure = {
      enabled: true,
      batchWindowMs,
      coalescePattern,
      deferNonCoalesced,
      maxQueueSize,
      queue: [],
      coalesced: new Map(),
      token: 0,
      scheduled: false,
      rafId: null,
      timeoutId: null,
      generation: ++this._backpressureGen,
    };

    return this;
  }

  /**
   * 禁用背压控制
   * @returns {this}
   */
  disableBackpressure() {
    if (!this._backpressure?.enabled) return this;

    const bp = this._backpressure;
    if (bp) {
      try {
        if (bp.rafId !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(bp.rafId);
      } catch {
        // ignore
      }
      try {
        if (bp.timeoutId !== null) clearTimeout(bp.timeoutId);
      } catch {
        // ignore
      }
      bp.rafId = null;
      bp.timeoutId = null;
      bp.scheduled = false;
    }

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
   * @returns {void}
   */
  clearHistory() {
    if (this._history) this._history.length = 0;
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
    for (const raw of events) {
      if (!isObject(raw)) continue;
      const rawRunId = typeof raw.runId === 'string' ? raw.runId : undefined;
      const rawMeta = isObject(raw.meta) ? raw.meta : undefined;
      try {
        const clock =
          (isObject(raw._clock) && typeof raw._clock.seq === "number")
            ? raw._clock
            : (isObject(raw.clock) && typeof raw.clock.seq === "number")
              ? raw.clock
              : (typeof raw.seq === "number" ? { seq: raw.seq } : undefined);

        const evt = createEventRecord({
          ...raw,
          _clock: /** @type {LamportClockState | undefined} */ (/** @type {unknown} */ (clock)),
          runId: rawRunId ?? runId,
          meta: { ...(rawMeta || {}), replay: true },
        });
        this._dispatch(evt);
        result.push(evt);
      } catch {
        // Skip malformed events.
      }
    }

    return result;
  }

  /**
   * 清理所有监听器
   * @returns {void}
   */
  clear() {
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
    let payload = data;
    let meta = undefined;

    // 如果是 EventRecord 格式，提取 payload
    if (isObject(data) && ('payload' in data || 'actor' in data || 'status' in data)) {
      payload = data.payload;
      meta = data.meta;
    }

    const actor = isObject(data) && typeof data.actor === 'string' ? data.actor : undefined;
    const status = isObject(data) && typeof data.status === 'string' ? data.status : undefined;
    const level = isObject(data) && typeof data.level === 'string' ? data.level : undefined;

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
    const toResolve = [];

    for (const [pattern, waiters] of this._waiters) {
      if (matchPattern(pattern, eventName)) {
        toResolve.push({ pattern, waiters: [...waiters] });
      }
    }

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

    // 溢出处理
    if (bp.queue.length >= bp.maxQueueSize) {
      bp.queue.shift();
    }

    const shouldCoalesce = regexTest(bp.coalescePattern, evt.name);
    if (shouldCoalesce) {
      bp.coalesced.set(evt.name, { token: ++bp.token, evt });
      bp.queue.push({ kind: 'coalesce', name: evt.name, token: bp.token });
    } else if (bp.deferNonCoalesced) {
      bp.queue.push({ kind: 'event', evt });
    } else {
      this._dispatch(evt);
      return;
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
    const gen = bp.generation;

    const flush = () => {
      const current = this._backpressure;
      if (!current || current.generation !== gen) return;
      current.rafId = null;
      current.timeoutId = null;
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

    bp.scheduled = false;
    const queue = bp.queue;
    const coalesced = bp.coalesced;

    bp.queue = [];
    bp.coalesced = new Map();

    for (const item of queue) {
      if (item.kind === 'event') {
        this._dispatch(item.evt);
      } else if (item.kind === 'coalesce') {
        const latest = coalesced.get(item.name);
        if (latest && latest.token === item.token) {
          this._dispatch(latest.evt);
        }
      }
    }
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
        if (result?.then) result.catch((err) => logger.warn("Event persistence error", { error: err.message }));
      } catch {}
    });
  }

  /**
   * @param {unknown} err
   * @param {EventRecord} evt
   * @param {Function} fn
   * @returns {void}
   */
  _handleError(err, evt, fn) {
    if (this._onListenerError) {
      try {
        this._onListenerError(err, evt, fn);
      } catch {}
    } else {
      console.error(`[EventBus] Error in handler for "${evt.name}":`, err);
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
