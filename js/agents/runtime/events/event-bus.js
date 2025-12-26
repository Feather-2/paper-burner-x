import { matchEventPattern } from "./events.js";
import { EventBusItemKind } from "../core/constants.js";

const SCHEMA_VERSION = "0.1";

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function testRegExp(re, value) {
  if (re.global || re.sticky) re.lastIndex = 0;
  return re.test(value);
}

function ensurePersistenceAdapter(persistenceAdapter) {
  if (persistenceAdapter === undefined || persistenceAdapter === null) return null;
  if (!isObject(persistenceAdapter)) {
    throw new TypeError("EventBus({ persistenceAdapter }): persistenceAdapter must be an object");
  }
  if (typeof persistenceAdapter.appendEvents !== "function") {
    throw new TypeError("EventBus({ persistenceAdapter }): persistenceAdapter.appendEvents must be a function");
  }
  if (typeof persistenceAdapter.getEvents !== "function") {
    throw new TypeError("EventBus({ persistenceAdapter }): persistenceAdapter.getEvents must be a function");
  }
  return persistenceAdapter;
}

export function isValidEventName(name) {
  // dot-separated lowercase segments: a-z0-9, must start with a letter/number.
  return typeof name === "string" && /^[a-z0-9_]+(\.[a-z0-9_]+)*$/.test(name);
}

export function createEventId(runId, seq) {
  const base = runId && typeof runId === "string" ? runId : "run_unknown";
  return `evt_${base}_${seq}`;
}

export function createEventRecord({
  runId,
  eventId,
  ts,
  name,
  actor,
  status,
  payload,
  meta,
  level,
  durationMs,
} = {}) {
  if (!isValidEventName(name)) {
    throw new Error(`Invalid event name: ${String(name)}`);
  }

  const record = {
    schemaVersion: SCHEMA_VERSION,
    eventId,
    runId,
    ts,
    name,
    actor,
  };

  if (level) record.level = level;
  if (status) record.status = status;
  if (typeof durationMs === "number") record.durationMs = durationMs;
  if (payload !== undefined) record.payload = payload;
  if (meta !== undefined) record.meta = meta;

  return record;
}

export class EventBus {
  constructor({ runId, persistenceAdapter } = {}) {
    this.runId = runId;
    this._seq = 0;
    this._listeners = new Map(); // name -> Set(fn)
    this._wildcardListeners = new Map(); // pattern -> Set(fn)
    this._priorityListeners = new Map(); // name -> Map(priority -> Set(fn))
    this._wildcardPriorityListeners = new Map(); // pattern -> Map(priority -> Set(fn))
    this._sortedHandlersCache = new Map(); // eventName -> [{ fn, priority }]
    this._cacheVersion = 0; // 递增版本号，用于失效缓存
    this._backpressure = null;
    this._persistenceAdapter = ensurePersistenceAdapter(persistenceAdapter);
  }

  /**
   * 使缓存失效
   */
  _invalidateCache() {
    this._cacheVersion++;
    this._sortedHandlersCache.clear();
  }

  on(name, handler) {
    if (typeof handler !== "function") {
      throw new TypeError("EventBus.on(name, handler): handler must be a function");
    }
    if (name !== "*" && !isValidEventName(name)) {
      throw new Error(`Invalid event name: ${String(name)}`);
    }

    let set = this._listeners.get(name);
    if (!set) {
      set = new Set();
      this._listeners.set(name, set);
    }
    set.add(handler);
    this._invalidateCache();

    return () => this.off(name, handler);
  }

  once(name, handler) {
    const off = this.on(name, (evt) => {
      off();
      handler(evt);
    });
    return off;
  }

  /**
   * 订阅事件，支持通配符模式如 "deepsearch.*"
   * @param {string} eventType - 事件类型或通配符模式
   * @param {Function} handler - 事件处理器
   * @param {Object} [options] - 订阅选项
   * @param {number} [options.priority=0] - 优先级，数值越大越先执行
   * @returns {Function} 取消订阅函数
   */
  subscribe(eventType, handler, { priority = 0 } = {}) {
    if (typeof handler !== "function") {
      throw new TypeError("EventBus.subscribe(eventType, handler): handler must be a function");
    }
    if (typeof eventType !== "string" || !eventType.length) {
      throw new Error("EventBus.subscribe(eventType, handler): eventType must be a non-empty string");
    }
    if (typeof priority !== "number" || !Number.isFinite(priority)) {
      throw new TypeError("EventBus.subscribe: priority must be a finite number");
    }

    // 非零优先级使用优先级监听器
    if (priority !== 0) {
      if (eventType.includes("*")) {
        // 通配符 + 优先级
        let priorityMap = this._wildcardPriorityListeners.get(eventType);
        if (!priorityMap) {
          priorityMap = new Map();
          this._wildcardPriorityListeners.set(eventType, priorityMap);
        }
        let set = priorityMap.get(priority);
        if (!set) {
          set = new Set();
          priorityMap.set(priority, set);
        }
        set.add(handler);
        this._invalidateCache();
        return () => {
          set.delete(handler);
          if (set.size === 0) priorityMap.delete(priority);
          if (priorityMap.size === 0) this._wildcardPriorityListeners.delete(eventType);
          this._invalidateCache();
        };
      } else {
        // 精确匹配 + 优先级
        let priorityMap = this._priorityListeners.get(eventType);
        if (!priorityMap) {
          priorityMap = new Map();
          this._priorityListeners.set(eventType, priorityMap);
        }
        let set = priorityMap.get(priority);
        if (!set) {
          set = new Set();
          priorityMap.set(priority, set);
        }
        set.add(handler);
        this._invalidateCache();
        return () => {
          set.delete(handler);
          if (set.size === 0) priorityMap.delete(priority);
          if (priorityMap.size === 0) this._priorityListeners.delete(eventType);
          this._invalidateCache();
        };
      }
    }

    // 优先级为 0 的使用普通监听器
    if (eventType.includes("*")) {
      let set = this._wildcardListeners.get(eventType);
      if (!set) {
        set = new Set();
        this._wildcardListeners.set(eventType, set);
      }
      set.add(handler);
      this._invalidateCache();
      return () => {
        set.delete(handler);
        if (set.size === 0) this._wildcardListeners.delete(eventType);
        this._invalidateCache();
      };
    }

    // 精确匹配委托给 on
    return this.on(eventType, handler);
  }

  off(name, handler) {
    const set = this._listeners.get(name);
    if (!set) return;
    set.delete(handler);
    if (set.size === 0) this._listeners.delete(name);
    this._invalidateCache();
  }

  enableBackpressure(options = {}) {
    if (options === null || options === undefined) options = {};
    if (!isObject(options)) {
      throw new TypeError("EventBus.enableBackpressure(options): options must be an object");
    }

    const batchWindowMs = options.batchWindowMs ?? 16;
    const coalescePattern = options.coalescePattern ?? /\.progress$/;

    if (typeof batchWindowMs !== "number" || !Number.isFinite(batchWindowMs) || batchWindowMs < 0) {
      throw new TypeError("EventBus.enableBackpressure(options): batchWindowMs must be a non-negative finite number");
    }
    if (!(coalescePattern instanceof RegExp)) {
      throw new TypeError("EventBus.enableBackpressure(options): coalescePattern must be a RegExp");
    }

    if (this._backpressure?.enabled) {
      this._cancelScheduledFlush();
      this._flushBackpressureQueue();
    }

    this._backpressure = {
      enabled: true,
      batchWindowMs,
      coalescePattern,
      scheduled: false,
      timerId: null,
      rafId: null,
      queue: [],
      coalesced: new Map(), // name -> { token, evt }
      token: 0,
    };

    return this;
  }

  disableBackpressure() {
    if (!this._backpressure?.enabled) return this;
    this._cancelScheduledFlush();
    this._flushBackpressureQueue();
    this._backpressure = null;
    return this;
  }

  _cancelScheduledFlush() {
    const bp = this._backpressure;
    if (!bp) return;
    bp.scheduled = false;
    if (bp.timerId !== null) {
      clearTimeout(bp.timerId);
      bp.timerId = null;
    }
    if (bp.rafId !== null && typeof globalThis.cancelAnimationFrame === "function") {
      globalThis.cancelAnimationFrame(bp.rafId);
      bp.rafId = null;
    }
  }

  _scheduleFlush() {
    const bp = this._backpressure;
    if (!bp?.enabled || bp.scheduled) return;
    bp.scheduled = true;

    // Browser: rAF; Node: setTimeout.
    if (typeof globalThis.requestAnimationFrame === "function") {
      bp.rafId = globalThis.requestAnimationFrame(() => this._flushBackpressureQueue());
      return;
    }

    bp.timerId = setTimeout(() => this._flushBackpressureQueue(), bp.batchWindowMs);
  }

  _flushBackpressureQueue() {
    const bp = this._backpressure;
    if (!bp?.enabled) return;

    bp.scheduled = false;
    bp.timerId = null;
    bp.rafId = null;

    if (bp.queue.length === 0) {
      bp.coalesced.clear();
      return;
    }

    const queue = bp.queue;
    const coalesced = bp.coalesced;

    bp.queue = [];
    bp.coalesced = new Map();

    for (const item of queue) {
      if (item.kind === EventBusItemKind.EVENT) {
        this._dispatch(item.evt);
        continue;
      }

      const latest = coalesced.get(item.name);
      if (latest && latest.token === item.token) this._dispatch(latest.evt);
    }
  }

  _dispatch(evt) {
    // 收集所有匹配的 handlers 及其优先级
    const handlers = []; // [{ fn, priority }]
    let hasNonZeroPriority = false;

    // 精确匹配 - 优先级监听器
    const priorityMap = this._priorityListeners.get(evt.name);
    if (priorityMap) {
      for (const [priority, set] of priorityMap) {
        for (const fn of set) {
          handlers.push({ fn, priority });
          if (priority !== 0) hasNonZeroPriority = true;
        }
      }
    }

    // 精确匹配 - 普通监听器 (优先级 0)
    const direct = this._listeners.get(evt.name);
    if (direct) {
      for (const fn of direct) handlers.push({ fn, priority: 0 });
    }

    // 全局通配符 "*" (优先级 0)
    const any = this._listeners.get("*");
    if (any) {
      for (const fn of any) handlers.push({ fn, priority: 0 });
    }

    // 通配符模式 - 优先级监听器
    for (const [pattern, pMap] of this._wildcardPriorityListeners) {
      if (matchEventPattern(pattern, evt.name)) {
        for (const [priority, set] of pMap) {
          for (const fn of set) {
            handlers.push({ fn, priority });
            if (priority !== 0) hasNonZeroPriority = true;
          }
        }
      }
    }

    // 通配符模式 - 普通监听器 (优先级 0)
    for (const [pattern, set] of this._wildcardListeners) {
      if (matchEventPattern(pattern, evt.name)) {
        for (const fn of set) handlers.push({ fn, priority: 0 });
      }
    }

    // 只在有非零优先级时才排序（优化：大多数情况不需要排序）
    if (hasNonZeroPriority) {
      handlers.sort((a, b) => b.priority - a.priority);
    }

    // 执行所有 handlers
    for (const { fn } of handlers) {
      fn(evt);
    }
  }

  _persistAsync(events) {
    if (!this._persistenceAdapter) return;
    if (!Array.isArray(events) || events.length === 0) return;

    queueMicrotask(() => {
      try {
        const res = this._persistenceAdapter.appendEvents(events);
        if (res && typeof res.then === "function") res.catch(() => {});
      } catch {
        // ignore persistence errors; EventBus is best-effort by default
      }
    });
  }

  emit(name, record = {}) {
    // Allow emit(name, payloadObject) by treating non-EventRecord-shaped objects as payload.
    let partial = record;
    if (!isObject(record)) partial = { payload: record };
    else if (!("payload" in record) && !("actor" in record) && !("status" in record)) {
      partial = { payload: record };
    }

    const runId = partial.runId ?? this.runId;
    const eventId = partial.eventId ?? createEventId(runId, ++this._seq);
    const ts = partial.ts ?? new Date().toISOString();
    const actor = partial.actor ?? "system";

    const evt = createEventRecord({
      ...partial,
      runId,
      eventId,
      ts,
      name,
      actor,
    });

    this._persistAsync([evt]);

    const bp = this._backpressure;
    if (!bp?.enabled) {
      this._dispatch(evt);
      return evt;
    }

    const shouldCoalesce = testRegExp(bp.coalescePattern, name);
    if (shouldCoalesce) {
      const token = ++bp.token;
      bp.coalesced.set(name, { token, evt });
      bp.queue.push({ kind: EventBusItemKind.COALESCE, name, token });
    } else {
      bp.queue.push({ kind: EventBusItemKind.EVENT, evt });
    }

    this._scheduleFlush();

    return evt;
  }

  async replay(runId) {
    if (!this._persistenceAdapter) {
      throw new Error("EventBus.replay(runId): persistenceAdapter is required");
    }
    if (!runId || typeof runId !== "string") {
      throw new TypeError("EventBus.replay(runId): runId must be a string");
    }

    let events;
    try {
      events = await this._persistenceAdapter.getEvents(runId);
    } catch (err) {
      throw new Error(`EventBus.replay(runId): failed to load events for runId=${runId}: ${String(err?.message || err)}`);
    }

    if (events === null || events === undefined) {
      throw new Error(`EventBus.replay(runId): no events found for runId=${runId}`);
    }
    if (!Array.isArray(events)) {
      throw new TypeError("EventBus.replay(runId): persistenceAdapter.getEvents(runId) must return an array");
    }

    const out = [];
    for (const raw of events) {
      if (!isObject(raw)) continue;
      const mergedMeta = isObject(raw.meta) ? { ...raw.meta, replay: true } : { replay: true };
      const evt = createEventRecord({ ...raw, runId: raw.runId ?? runId, meta: mergedMeta });
      this._dispatch(evt);
      out.push(evt);
    }
    return out;
  }
}

// Example adapter for persisting EventBus events into RunStore without changing RunStore code.
export class RunStoreAdapter {
  constructor(runStore) {
    if (!runStore || typeof runStore.getEvents !== "function") {
      throw new TypeError("RunStoreAdapter(runStore): runStore.getEvents must be a function");
    }
    if (typeof runStore.appendEvents !== "function" && typeof runStore.appendEvent !== "function") {
      throw new TypeError("RunStoreAdapter(runStore): runStore.appendEvents/appendEvent must be a function");
    }
    this.runStore = runStore;
  }

  async appendEvents(events = []) {
    if (!Array.isArray(events)) {
      throw new TypeError("RunStoreAdapter.appendEvents(events): events must be an array");
    }
    if (events.length === 0) return 0;

    const byRunId = new Map();
    for (const evt of events) {
      if (!isObject(evt)) continue;
      const runId = evt.runId;
      if (!runId || typeof runId !== "string") {
        throw new Error("RunStoreAdapter.appendEvents(events): each event must include a string runId");
      }
      const list = byRunId.get(runId) || [];
      list.push(evt);
      byRunId.set(runId, list);
    }

    for (const [runId, list] of byRunId) {
      if (typeof this.runStore.appendEvents === "function") {
        await this.runStore.appendEvents(runId, list);
        continue;
      }
      for (const evt of list) {
        await this.runStore.appendEvent(runId, evt);
      }
    }

    return events.length;
  }

  async getEvents(runId) {
    return this.runStore.getEvents(runId);
  }
}

