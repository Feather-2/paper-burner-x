/**
 * Node.js EventEmitter shim for browser sandbox.
 * @module events
 */

const DEFAULT_MAX_LISTENERS = 10;

export class EventEmitter {
  constructor() {
    /** @type {Map<string|symbol, Function[]>} */
    this._events = new Map();
    this._maxListeners = DEFAULT_MAX_LISTENERS;
  }

  /**
   * @param {string|symbol} event
   * @param {Function} listener
   * @returns {this}
   */
  on(event, listener) {
    return this._addListener(event, listener, false);
  }

  /** Alias for on. */
  addListener(event, listener) {
    return this.on(event, listener);
  }

  /**
   * @param {string|symbol} event
   * @param {Function} listener
   * @returns {this}
   */
  prependListener(event, listener) {
    return this._addListener(event, listener, true);
  }

  /**
   * Register a one-time listener.
   * @param {string|symbol} event
   * @param {Function} listener
   * @returns {this}
   */
  once(event, listener) {
    const wrapper = (...args) => {
      this.removeListener(event, wrapper);
      listener.apply(this, args);
    };
    wrapper._original = listener;
    return this._addListener(event, wrapper, false);
  }

  /**
   * Register a one-time listener at the front.
   * @param {string|symbol} event
   * @param {Function} listener
   * @returns {this}
   */
  prependOnceListener(event, listener) {
    const wrapper = (...args) => {
      this.removeListener(event, wrapper);
      listener.apply(this, args);
    };
    wrapper._original = listener;
    return this._addListener(event, wrapper, true);
  }

  /**
   * Remove a specific listener.
   * @param {string|symbol} event
   * @param {Function} listener
   * @returns {this}
   */
  removeListener(event, listener) {
    const list = this._events.get(event);
    if (!list) return this;
    const idx = list.findIndex(fn => fn === listener || fn._original === listener);
    if (idx !== -1) list.splice(idx, 1);
    if (list.length === 0) this._events.delete(event);
    return this;
  }

  /** Alias for removeListener. */
  off(event, listener) {
    return this.removeListener(event, listener);
  }

  /**
   * Remove all listeners for an event, or all events if none specified.
   * @param {string|symbol} [event]
   * @returns {this}
   */
  removeAllListeners(event) {
    if (event === undefined) {
      this._events.clear();
    } else {
      this._events.delete(event);
    }
    return this;
  }

  /**
   * Emit an event.
   * @param {string|symbol} event
   * @param {...*} args
   * @returns {boolean}
   */
  emit(event, ...args) {
    const list = this._events.get(event);
    if (!list || list.length === 0) {
      if (event === 'error') {
        const err = args[0];
        throw err instanceof Error ? err : new Error('Unhandled error event');
      }
      return false;
    }
    const copy = [...list];
    for (const fn of copy) fn.apply(this, args);
    return true;
  }

  /**
   * Return a copy of the listeners array for an event.
   * @param {string|symbol} event
   * @returns {Function[]}
   */
  listeners(event) {
    const list = this._events.get(event);
    return list ? [...list] : [];
  }

  /**
   * @param {string|symbol} event
   * @returns {number}
   */
  listenerCount(event) {
    const list = this._events.get(event);
    return list ? list.length : 0;
  }

  /** @returns {(string|symbol)[]} */
  eventNames() {
    return [...this._events.keys()];
  }

  /**
   * @param {number} n
   * @returns {this}
   */
  setMaxListeners(n) {
    this._maxListeners = n;
    return this;
  }

  /** @returns {number} */
  getMaxListeners() {
    return this._maxListeners;
  }

  // ── internal ──

  /** @private */
  _addListener(event, listener, prepend) {
    let list = this._events.get(event);
    if (!list) {
      list = [];
      this._events.set(event, list);
    }
    if (prepend) list.unshift(listener);
    else list.push(listener);
    if (this._maxListeners > 0 && list.length > this._maxListeners) {
      console.warn(
        `MaxListenersExceededWarning: Possible memory leak detected. ` +
        `${list.length} ${String(event)} listeners added. ` +
        `Use emitter.setMaxListeners() to increase limit.`
      );
    }
    return this;
  }
}

export default EventEmitter;
