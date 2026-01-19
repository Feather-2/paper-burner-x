import { assertValidEventName, assertValidEventPattern, matchPattern } from './event-bus-utils.js';

/** @typedef {(event: import('./types.d.ts').EventRecord) => void | Promise<void>} EventHandler */

export class EventBusSubscriptions {
  constructor() {
    this._listeners = new Map(); // name -> Set(fn)
    this._wildcardListeners = new Map(); // pattern -> Set(fn)
    this._priorityListeners = new Map(); // name -> Map(priority -> Set(fn))
    this._wildcardPriorityListeners = new Map(); // pattern -> Map(priority -> Set(fn))
  }

  /**
   * @param {string} name
   * @param {EventHandler} handler
   * @param {{ priority?: number }} [options]
   * @returns {() => void}
   */
  on(name, handler, options) {
    if (typeof handler !== 'function') {
      throw new TypeError('EventBus.on: handler must be a function');
    }

    if (typeof name !== 'string' || !name) {
      throw new TypeError('Invalid event name');
    }
    if (name.includes('*') || name.includes('?')) assertValidEventPattern(name);
    else assertValidEventName(name);

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
   * @param {string} name
   * @param {EventHandler} handler
   * @returns {() => void}
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
   * @param {string} eventType
   * @param {EventHandler} handler
   * @param {{ priority?: number, signal?: AbortSignal }} [options]
   * @returns {() => void}
   */
  subscribe(eventType, handler, options = {}) {
    const { priority = 0, signal } = options;

    if (typeof handler !== 'function') {
      throw new TypeError('EventBus.subscribe: handler must be a function');
    }

    if (typeof eventType !== 'string' || !eventType) {
      throw new TypeError('Invalid event name');
    }
    if (eventType.includes('*') || eventType.includes('?')) assertValidEventPattern(eventType);
    else assertValidEventName(eventType);

    if (typeof priority !== 'number' || !Number.isFinite(priority)) {
      throw new TypeError('EventBus.subscribe: priority must be a finite number');
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
   * @param {string} name
   * @param {EventHandler} handler
   * @returns {boolean}
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

  /**
   * @param {string} eventName
   * @returns {{ fn: Function, priority: number }[]}
   */
  collectHandlers(eventName) {
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
   * @returns {void}
   */
  clear() {
    this._listeners.clear();
    this._wildcardListeners.clear();
    this._priorityListeners.clear();
    this._wildcardPriorityListeners.clear();
  }
}
