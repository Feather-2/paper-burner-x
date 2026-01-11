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

import * as LamportClockModule from './lamport-clock.js';
import { LamportClock } from './lamport-clock.js';

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
 * @typedef {(event: EventRecord) => void | Promise<void>} EventHandler
 */

const SCHEMA_VERSION = '0.1';

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

/**
 * @param {unknown} name
 * @returns {boolean}
 */
function isValidEventName(name) {
  if (name === '*') return true;
  return typeof name === 'string' && /^[a-z0-9_]+(\.[a-z0-9_]+)*$/.test(name);
}

/**
 * @param {string | null | undefined} runId
 * @param {number} seq
 * @returns {string}
 */
function createEventId(runId, seq) {
  const base = runId && typeof runId === 'string' ? runId : 'run';
  return `evt_${base}_${seq}`;
}

/**
 * 双指针通配符匹配 - O(m*n) 最坏情况，无指数回溯（防 ReDoS）
 * @param {string} pattern
 * @param {string} text
 * @returns {boolean}
 */
function wildcardMatch(pattern, text) {
  let pi = 0, ti = 0;
  let starIdx = -1, matchIdx = -1;
  const pLen = pattern.length, tLen = text.length;

  while (ti < tLen) {
    if (pi < pLen && (pattern[pi] === text[ti] || pattern[pi] === '?')) {
      pi++;
      ti++;
    } else if (pi < pLen && pattern[pi] === '*') {
      starIdx = pi;
      matchIdx = ti;
      pi++;
    } else if (starIdx !== -1) {
      pi = starIdx + 1;
      matchIdx++;
      ti = matchIdx;
    } else {
      return false;
    }
  }

  while (pi < pLen && pattern[pi] === '*') pi++;
  return pi === pLen;
}

/**
 * 匹配事件模式（安全实现，防 ReDoS）
 * @param {string} pattern
 * @param {string} eventName
 * @returns {boolean}
 */
function matchPattern(pattern, eventName) {
  if (typeof pattern !== 'string' || typeof eventName !== 'string') return false;
  if (pattern === '*') return true;
  if (pattern === eventName) return true;
  if (!pattern.includes('*')) return false;

  // 快速路径: "prefix.*" 模式
  if (pattern.endsWith('.*') && !pattern.slice(0, -2).includes('*')) {
    const prefix = pattern.slice(0, -2);
    return eventName === prefix || eventName.startsWith(prefix + '.');
  }

  // 通用通配符匹配
  return wildcardMatch(pattern, eventName);
}

// ============================================================
// EventRecord 结构化事件
// ============================================================

/**
 * @typedef {object} CreateEventRecordOptions
 * @property {string | null} [runId]
 * @property {string} [eventId]
 * @property {string} [ts]
 * @property {string} [name]
 * @property {string} [actor]
 * @property {string} [status]
 * @property {unknown} [payload]
 * @property {unknown} [meta]
 * @property {string} [level]
 * @property {number} [durationMs]
 * @property {LamportClockState} [_clock]
 * @property {string} [id] - legacy alias for eventId
 * @property {string} [type] - legacy alias for name
 * @property {number} [timestamp] - legacy alias for ts (ms)
 * @property {LamportClockState} [clock] - legacy alias for _clock
 */

/**
 * 创建结构化事件记录
 * @param {CreateEventRecordOptions} [options]
 * @returns {EventRecord}
 */
export function createEventRecord({
  runId,
  eventId,
  ts,
  name,
  actor = 'system',
  status,
  payload,
  meta,
  level,
  durationMs,
  _clock,
  // legacy aliases (core/types.d.ts)
  id,
  type,
  timestamp,
  clock: clockInput,
} = {}) {
  // 生成逻辑时钟
  let clock = _clock || clockInput;
  if (!clock || typeof clock.seq !== 'number') {
    clock = LamportClockModule.nextTick();
  } else {
    LamportClockModule.sync(clock.seq);
  }

  const resolvedName = typeof name === 'string' && name
    ? name
    : (typeof type === 'string' && type ? type : 'unknown');

  if (!isValidEventName(resolvedName) || resolvedName === '*') {
    throw new TypeError(`Invalid event name: ${resolvedName}`);
  }

  const resolvedTs = typeof ts === 'string' && ts
    ? ts
    : (typeof timestamp === 'number' && Number.isFinite(timestamp)
        ? new Date(timestamp).toISOString()
        : new Date().toISOString());

  const resolvedTimestamp = (typeof timestamp === 'number' && Number.isFinite(timestamp))
    ? timestamp
    : (Number.isFinite(Date.parse(resolvedTs)) ? Date.parse(resolvedTs) : Date.now());

  const resolvedEventId = (typeof eventId === 'string' && eventId)
    ? eventId
    : (typeof id === 'string' && id ? id : createEventId(runId, clock.seq));

  /** @type {EventRecord} */
  const record = {
    // core/types.d.ts compatible fields
    id: resolvedEventId,
    type: resolvedName,
    timestamp: resolvedTimestamp,
    clock,

    schemaVersion: SCHEMA_VERSION,
    eventId: resolvedEventId,
    runId: typeof runId === 'string' ? runId : null,
    ts: resolvedTs,
    name: resolvedName,
    actor,
    _clock: clock,
    seq: clock.seq,
  };

  if (level) record.level = level;
  if (status) record.status = status;
  if (typeof durationMs === 'number') record.durationMs = durationMs;
  if (payload !== undefined) record.payload = payload;
  if (meta !== undefined) record.meta = meta;

  return record;
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
    if (!runStore || typeof runStore.getEvents !== 'function') {
      throw new TypeError('RunStoreAdapter(runStore): runStore.getEvents must be a function');
    }
    if (typeof runStore.appendEvents !== 'function' && typeof runStore.appendEvent !== 'function') {
      throw new TypeError('RunStoreAdapter(runStore): runStore.appendEvents/appendEvent must be a function');
    }

    this._runStore = runStore;
  }

  /**
   * @param {any[]} events
   * @returns {any}
   */
  async appendEvents(events) {
    if (!Array.isArray(events)) {
      throw new TypeError('RunStoreAdapter.appendEvents(events): events must be an array');
    }
    if (events.length === 0) return 0;

    const runStore = this._runStore;
    const hasBatch = typeof runStore.appendEvents === 'function';
    let total = 0;

    // 批量写入路径（优先）
    if (hasBatch) {
      /** @type {Map<string, any[]>} */
      const byRunId = new Map();
      for (const evt of events) {
        if (!isObject(evt)) continue;
        const runId = evt.runId;
        if (typeof runId !== 'string' || !runId) {
          throw new TypeError('RunStoreAdapter.appendEvents: events must include a string runId');
        }
        total += 1;
        const bucket = byRunId.get(runId);
        if (bucket) bucket.push(evt);
        else byRunId.set(runId, [evt]);
      }

      const tasks = [];
      for (const [runId, batch] of byRunId) {
        tasks.push(runStore.appendEvents(runId, batch));
      }
      if (tasks.length === 0) return 0;
      await Promise.all(tasks);
      return total;
    }

    // 单条写入路径（appendEvent-only）
    const tasks = [];
    for (const evt of events) {
      if (!isObject(evt)) continue;
      const runId = evt.runId;
      if (typeof runId !== 'string' || !runId) {
        throw new TypeError('RunStoreAdapter.appendEvents: events must include a string runId');
      }
      total += 1;
      tasks.push(runStore.appendEvent(runId, evt));
    }
    if (tasks.length === 0) return 0;
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

    // 监听器存储
    this._listeners = new Map(); // name -> Set(fn)
    this._wildcardListeners = new Map(); // pattern -> Set(fn)
    this._priorityListeners = new Map(); // name -> Map(priority -> Set(fn))
    this._wildcardPriorityListeners = new Map(); // pattern -> Map(priority -> Set(fn))

    // 事件历史
    this._history = options.keepHistory ? [] : null;
    this._maxHistory = options.maxHistory || 100;

    // 背压控制
    this._backpressure = null;
    this._backpressureGen = 0;

    // 持久化
    this._persistenceAdapter = options.persistenceAdapter || null;
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
    if (typeof handler !== 'function') {
      throw new TypeError('EventBus.on: handler must be a function');
    }

    if (typeof name !== 'string' || !name) {
      throw new TypeError('EventBus.on: name must be a string');
    }
    if (!name.includes('*') && !isValidEventName(name)) {
      throw new TypeError(`Invalid event name: ${name}`);
    }

    const priority = options?.priority ?? 0;

    // 带优先级的订阅走 subscribe 路径
    if (priority !== 0) {
      return this.subscribe(name, handler, { priority });
    }

    if (name.includes('*')) {
      let set = this._wildcardListeners.get(name);
      if (!set) {
        set = new Set();
        this._wildcardListeners.set(name, set);
      }
      set.add(handler);
    } else {
      let set = this._listeners.get(name);
      if (!set) {
        set = new Set();
        this._listeners.set(name, set);
      }
      set.add(handler);
    }

    return () => this.off(name, handler);
  }

  /**
   * 一次性订阅
   * @param {string} name - 事件名或通配符模式
   * @param {EventHandler} handler - 处理函数
   * @returns {() => void} 取消订阅函数
   */
  once(name, handler) {
    /** @type {EventHandler & { _original?: EventHandler }} */
    const wrapper = (evt) => {
      this.off(name, wrapper);
      return handler(evt);
    };
    wrapper._original = handler;
    return this.on(name, wrapper);
  }

  /**
   * 高级订阅（支持优先级和 AbortSignal）
   * @param {string} eventType - 事件类型
   * @param {EventHandler} handler - 处理函数
   * @param {{ priority?: number, signal?: AbortSignal }} [options] - { priority, signal }
   * @returns {() => void} 取消订阅函数
   */
  subscribe(eventType, handler, options = {}) {
    const { priority = 0, signal } = options;

    if (typeof handler !== 'function') {
      throw new TypeError('EventBus.subscribe: handler must be a function');
    }

    if (typeof eventType !== 'string' || !eventType) {
      throw new TypeError('EventBus.subscribe: eventType must be a string');
    }
    if (!eventType.includes('*') && !isValidEventName(eventType)) {
      throw new TypeError(`Invalid event name: ${eventType}`);
    }
    if (options && Object.prototype.hasOwnProperty.call(options, 'priority')) {
      if (typeof priority !== 'number' || !Number.isFinite(priority)) {
        throw new TypeError('EventBus.subscribe: priority must be a finite number');
      }
    }

    // AbortSignal 支持
    if (signal?.aborted) return () => {};

    const wrapWithSignal = (unsubscribe) => {
      if (!signal || typeof signal.addEventListener !== 'function') {
        return unsubscribe;
      }

      let done = false;
      const off = () => {
        if (done) return;
        done = true;
        signal.removeEventListener?.('abort', off);
        unsubscribe();
      };

      signal.addEventListener('abort', off, { once: true });
      return off;
    };

    // 优先级订阅
    if (priority !== 0) {
      const isWildcard = eventType.includes('*');
      const map = isWildcard ? this._wildcardPriorityListeners : this._priorityListeners;

      let priorityMap = map.get(eventType);
      if (!priorityMap) {
        priorityMap = new Map();
        map.set(eventType, priorityMap);
      }

      let set = priorityMap.get(priority);
      if (!set) {
        set = new Set();
        priorityMap.set(priority, set);
      }
      set.add(handler);

      return wrapWithSignal(() => {
        set.delete(handler);
        if (set.size === 0) priorityMap.delete(priority);
        if (priorityMap.size === 0) map.delete(eventType);
      });
    }

    // 普通订阅
    return wrapWithSignal(this.on(eventType, handler));
  }

  /**
   * 取消订阅
   * @param {string} name - 事件名或通配符模式
   * @param {EventHandler} handler - 处理函数
   * @returns {boolean} 是否成功取消
   */
  off(name, handler) {
    // 检查普通监听器
    const set = name.includes('*')
      ? this._wildcardListeners.get(name)
      : this._listeners.get(name);

    if (set) {
      for (const fn of set) {
        if (fn === handler || fn._original === handler) {
          set.delete(fn);
          if (set.size === 0) {
            (name.includes('*') ? this._wildcardListeners : this._listeners).delete(name);
          }
          return true;
        }
      }
    }

    return false;
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
    if (typeof name !== 'string' || !name) {
      throw new TypeError('EventBus.emit: name must be a string');
    }
    if (!isValidEventName(name) || name === '*') {
      throw new TypeError(`Invalid event name: ${name}`);
    }

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

      const timer = timeout > 0
        ? setTimeout(() => {
            cleanup();
            reject(new Error(`EventBus.waitFor timeout: ${pattern}`));
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

      const waiter = {
        resolve: (evt) => {
          cleanup();
          // 同时提供新旧字段名以保持兼容
          resolve({
            type: evt.name,
            payload: evt.payload ?? evt,
            // 兼容旧 API
            event: evt.name,
            data: evt.payload ?? evt,
          });
        },
        reject: (err) => {
          cleanup();
          reject(err);
        },
        timer,
      };

      // 设置 abort 处理
      if (signal) {
        abortHandler = () => {
          cleanup();
          reject(signal.reason || new Error('Aborted'));
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
    if (options === undefined) options = {};
    if (!isObject(options)) {
      throw new TypeError('EventBus.enableBackpressure: options must be an object');
    }

    const {
      batchWindowMs = 16,
      coalescePattern = /\.progress$/,
      deferNonCoalesced = true,
      maxQueueSize = 1000,
    } = options;

    if (typeof batchWindowMs !== 'number' || !Number.isFinite(batchWindowMs) || batchWindowMs < 0) {
      throw new TypeError('EventBus.enableBackpressure: batchWindowMs must be a non-negative number');
    }
    if (!(coalescePattern instanceof RegExp)) {
      throw new TypeError('EventBus.enableBackpressure: coalescePattern must be a RegExp');
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
      timerId: null,
      flushToken: 0,
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

    this._cancelScheduledFlush();
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
      throw new Error(`EventBus.replay: failed to load events: ${err?.message || String(err)}`);
    }
    if (!Array.isArray(events)) return [];

    const result = [];
    for (const raw of events) {
      if (!isObject(raw)) continue;
      const rawRunId = typeof raw.runId === 'string' ? raw.runId : undefined;
      const rawMeta = isObject(raw.meta) ? raw.meta : undefined;
      const evt = createEventRecord({
        ...raw,
        runId: rawRunId ?? runId,
        meta: { ...(rawMeta || {}), replay: true },
      });
      this._dispatch(evt);
      result.push(evt);
    }

    return result;
  }

  /**
   * 清理所有监听器
   * @returns {void}
   */
  clear() {
    this._listeners.clear();
    this._wildcardListeners.clear();
    this._priorityListeners.clear();
    this._wildcardPriorityListeners.clear();
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
    const handlers = [];
    let hasNonZeroPriority = false;

    // 精确匹配 - 优先级
    const priorityMap = this._priorityListeners.get(eventName);
    if (priorityMap) {
      for (const [priority, set] of priorityMap) {
        for (const fn of set) {
          handlers.push({ fn, priority });
          if (priority !== 0) hasNonZeroPriority = true;
        }
      }
    }

    // 精确匹配 - 普通
    const direct = this._listeners.get(eventName);
    if (direct) {
      for (const fn of direct) handlers.push({ fn, priority: 0 });
    }

    // 全局通配符
    const any = this._listeners.get('*');
    if (any) {
      for (const fn of any) handlers.push({ fn, priority: 0 });
    }

    // 通配符 - 优先级
    for (const [pattern, pMap] of this._wildcardPriorityListeners) {
      if (matchPattern(pattern, eventName)) {
        for (const [priority, set] of pMap) {
          for (const fn of set) {
            handlers.push({ fn, priority });
            if (priority !== 0) hasNonZeroPriority = true;
          }
        }
      }
    }

    // 通配符 - 普通
    for (const [pattern, set] of this._wildcardListeners) {
      if (matchPattern(pattern, eventName)) {
        for (const fn of set) handlers.push({ fn, priority: 0 });
      }
    }

    // 按优先级排序
    if (hasNonZeroPriority) {
      handlers.sort((a, b) => b.priority - a.priority);
    }

    return handlers;
  }

  /**
   * @param {string} eventName
   * @param {EventRecord} evt
   * @returns {void}
   */
  _resolveWaiters(eventName, evt) {
    for (const [pattern, waiters] of this._waiters) {
      if (matchPattern(pattern, eventName)) {
        for (const waiter of waiters) {
          waiter.resolve(evt);
        }
        this._waiters.delete(pattern);
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

    const re = bp.coalescePattern;
    if (re.global || re.sticky) re.lastIndex = 0;
    const shouldCoalesce = re.test(evt.name);
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
    const token = ++bp.flushToken;

    const flush = () => {
      if (this._backpressure?.generation !== gen) return;
      if (this._backpressure?.flushToken !== token) return;
      this._flushBackpressure();
    };

    const raf = globalThis.requestAnimationFrame;
    if (typeof raf === 'function') {
      bp.rafId = raf(flush);
    } else {
      bp.timerId = globalThis.setTimeout(flush, bp.batchWindowMs);
    }
  }

  /**
   * @returns {void}
   */
  _flushBackpressure() {
    const bp = this._backpressure;
    if (!bp) return;

    bp.scheduled = false;
    bp.rafId = null;
    bp.timerId = null;
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
   * @returns {void}
   */
  _cancelScheduledFlush() {
    const bp = this._backpressure;
    if (!bp) return;

    try {
      const cancel = globalThis.cancelAnimationFrame;
      if (typeof cancel === 'function' && bp.rafId !== null && bp.rafId !== undefined) {
        cancel(bp.rafId);
      }
    } catch {
      // ignore
    }

    try {
      if (bp.timerId !== null && bp.timerId !== undefined) {
        globalThis.clearTimeout(bp.timerId);
      }
    } catch {
      // ignore
    }

    bp.rafId = null;
    bp.timerId = null;
    bp.scheduled = false;
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
        if (result?.then) result.catch(() => {});
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
    return {
      seq: LamportClockModule.currentSeq(),
      ts: typeof performance !== 'undefined' ? performance.now() : Date.now(),
      id: `eventbus_${this._seq}`,
    };
  }
}

// ============================================================
// 导出
// ============================================================

export { LamportClock };
export { isValidEventName, matchPattern };
export default EventBus;
