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

import * as LamportClock from './lamport-clock.js';

const SCHEMA_VERSION = '0.2';

// ============================================================
// 工具函数
// ============================================================

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidEventName(name) {
  if (name === '*') return true;
  return typeof name === 'string' && /^[a-z0-9_]+(\.[a-z0-9_]+)*$/i.test(name);
}

function createEventId(runId, seq) {
  const base = runId && typeof runId === 'string' ? runId : 'run';
  return `evt_${base}_${seq}`;
}

/**
 * 双指针通配符匹配 - O(m*n) 最坏情况，无指数回溯（防 ReDoS）
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
} = {}) {
  // 生成逻辑时钟
  let clock = _clock;
  if (!clock || typeof clock.seq !== 'number') {
    clock = LamportClock.nextTick();
  } else {
    LamportClock.sync(clock.seq);
  }

  const record = {
    schemaVersion: SCHEMA_VERSION,
    eventId,
    runId,
    ts: ts || new Date().toISOString(),
    name,
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
// EventBus 主类
// ============================================================

export class EventBus {
  /**
   * @param {Object} options
   * @param {string} options.runId - 运行 ID
   * @param {boolean} options.keepHistory - 保留事件历史
   * @param {number} options.maxHistory - 最大历史数量
   * @param {Object} options.persistenceAdapter - 持久化适配器
   * @param {Function} options.onListenerError - 错误处理器
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
   * @param {Function} handler - 处理函数
   * @returns {Function} 取消订阅函数
   */
  on(name, handler) {
    if (typeof handler !== 'function') {
      throw new TypeError('EventBus.on: handler must be a function');
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
   */
  once(name, handler) {
    const wrapper = (...args) => {
      this.off(name, wrapper);
      return handler(...args);
    };
    wrapper._original = handler;
    return this.on(name, wrapper);
  }

  /**
   * 高级订阅（支持优先级和 AbortSignal）
   * @param {string} eventType - 事件类型
   * @param {Function} handler - 处理函数
   * @param {Object} options - { priority, signal }
   */
  subscribe(eventType, handler, options = {}) {
    const { priority = 0, signal } = options;

    if (typeof handler !== 'function') {
      throw new TypeError('EventBus.subscribe: handler must be a function');
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
   * @param {*} data - 事件数据或 EventRecord
   * @returns {Object} EventRecord
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
   * @param {number} timeout - 超时毫秒
   * @returns {Promise<{ event, data }>}
   */
  waitFor(pattern, timeout = 30000) {
    return new Promise((resolve, reject) => {
      const timer = timeout > 0
        ? setTimeout(() => {
            this._removeWaiter(pattern, waiter);
            reject(new Error(`EventBus.waitFor timeout: ${pattern}`));
          }, timeout)
        : null;

      const waiter = {
        resolve: (evt) => {
          if (timer) clearTimeout(timer);
          resolve({ event: evt.name, data: evt.payload ?? evt });
        },
        reject,
        timer,
      };

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
   */
  enableBackpressure(options = {}) {
    const {
      batchWindowMs = 16,
      coalescePattern = /\.progress$/,
      deferNonCoalesced = true,
      maxQueueSize = 1000,
    } = options;

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
      generation: ++this._backpressureGen,
    };

    return this;
  }

  /**
   * 禁用背压控制
   */
  disableBackpressure() {
    if (!this._backpressure?.enabled) return this;

    this._flushBackpressure();
    this._backpressure = null;
    return this;
  }

  // ============================================================
  // 历史与状态
  // ============================================================

  /**
   * 获取事件历史
   */
  getHistory(pattern) {
    if (!this._history) return [];
    if (!pattern) return [...this._history];

    return this._history.filter(e => matchPattern(pattern, e.name));
  }

  /**
   * 清空历史
   */
  clearHistory() {
    if (this._history) this._history.length = 0;
  }

  /**
   * 重放事件
   */
  async replay(runId) {
    if (!this._persistenceAdapter) {
      throw new Error('EventBus.replay: persistenceAdapter required');
    }

    const events = await this._persistenceAdapter.getEvents(runId);
    if (!Array.isArray(events)) return [];

    const result = [];
    for (const raw of events) {
      if (!isObject(raw)) continue;
      const evt = createEventRecord({
        ...raw,
        runId: raw.runId ?? runId,
        meta: { ...(raw.meta || {}), replay: true },
      });
      this._dispatch(evt);
      result.push(evt);
    }

    return result;
  }

  /**
   * 清理所有监听器
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
   */
  dispose() {
    this.clear();
  }

  // ============================================================
  // 内部方法
  // ============================================================

  _createEvent(name, data) {
    let payload = data;
    let meta = undefined;

    // 如果是 EventRecord 格式，提取 payload
    if (isObject(data) && ('payload' in data || 'actor' in data || 'status' in data)) {
      payload = data.payload;
      meta = data.meta;
    }

    return createEventRecord({
      runId: this.runId,
      eventId: createEventId(this.runId, ++this._seq),
      ts: new Date().toISOString(),
      name,
      payload,
      meta,
      ...((isObject(data) && data.actor) ? { actor: data.actor } : {}),
      ...((isObject(data) && data.status) ? { status: data.status } : {}),
      ...((isObject(data) && data.level) ? { level: data.level } : {}),
    });
  }

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

  _removeWaiter(pattern, waiter) {
    const waiters = this._waiters.get(pattern);
    if (waiters) {
      waiters.delete(waiter);
      if (waiters.size === 0) {
        this._waiters.delete(pattern);
      }
    }
  }

  _enqueueBackpressure(evt) {
    const bp = this._backpressure;
    if (!bp) return;

    // 溢出处理
    if (bp.queue.length >= bp.maxQueueSize) {
      bp.queue.shift();
    }

    const shouldCoalesce = bp.coalescePattern.test(evt.name);
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

  _scheduleFlush() {
    const bp = this._backpressure;
    if (!bp?.enabled || bp.scheduled) return;

    bp.scheduled = true;
    const gen = bp.generation;

    const flush = () => {
      if (this._backpressure?.generation !== gen) return;
      this._flushBackpressure();
    };

    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(flush);
    } else {
      setTimeout(flush, bp.batchWindowMs);
    }
  }

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

  _persistAsync(events) {
    if (!this._persistenceAdapter) return;

    queueMicrotask(() => {
      try {
        const result = this._persistenceAdapter.appendEvents(events);
        if (result?.then) result.catch(() => {});
      } catch {}
    });
  }

  _handleError(err, evt, fn) {
    if (this._onListenerError) {
      try {
        this._onListenerError(err, evt, fn);
      } catch {}
    } else {
      console.error(`[EventBus] Error in handler for "${evt.name}":`, err);
    }
  }
}

// ============================================================
// 导出
// ============================================================

export { LamportClock };
export { isValidEventName, matchPattern };
export default EventBus;
