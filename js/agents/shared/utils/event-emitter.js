/**
 * EventEmitter - Cross-platform lightweight event emitter
 * @module shared/utils/event-emitter
 */

import { createLogger } from "./logger.js";

const logger = createLogger("shared/utils/event-emitter");

/**
 * @callback EventListener
 * @param {...any} args
 * @returns {void}
 */

/**
 * Minimal EventEmitter compatible with both browser and Node.js runtimes.
 */
export class EventEmitter {
  constructor() {
    /** @type {Map<string, Set<EventListener>>} */
    this._events = new Map();
  }

  /**
   * Register an event listener.
   * @param {string} event
   * @param {EventListener} listener
   * @returns {this}
   */
  on(event, listener) {
    if (typeof listener !== "function") {
      throw new TypeError("EventEmitter.on(event, listener): listener must be a function");
    }

    const key = String(event);
    if (!this._events.has(key)) {
      this._events.set(key, new Set());
    }
    this._events.get(key).add(listener);
    return this;
  }

  /**
   * Register a one-time event listener.
   * @param {string} event
   * @param {EventListener} listener
   * @returns {this}
   */
  once(event, listener) {
    if (typeof listener !== "function") {
      throw new TypeError("EventEmitter.once(event, listener): listener must be a function");
    }

    const wrapper = (...args) => {
      this.off(event, wrapper);
      listener(...args);
    };
    return this.on(event, wrapper);
  }

  /**
   * Remove an event listener, or all listeners for an event.
   * @param {string} event
   * @param {EventListener=} listener
   * @returns {this}
   */
  off(event, listener) {
    const key = String(event);
    if (!this._events.has(key)) return this;

    if (typeof listener === "function") {
      this._events.get(key)?.delete(listener);
      if (this._events.get(key)?.size === 0) {
        this._events.delete(key);
      }
      return this;
    }

    this._events.delete(key);
    return this;
  }

  /**
   * Emit an event.
   * @param {string} event
   * @param {...any} args
   * @returns {boolean} True if any listeners were invoked.
   */
  emit(event, ...args) {
    const key = String(event);
    const listeners = this._events.get(key);
    if (!listeners || listeners.size === 0) return false;

    // Snapshot to tolerate mutation during emit.
    for (const listener of Array.from(listeners)) {
      try {
        listener(...args);
      } catch (err) {
        // Best-effort: don't let one bad listener break others.
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`EventEmitter listener error: ${key}`, { event: key, error: message });
      }
    }

    return true;
  }

  /**
   * Clear all listeners.
   * @returns {this}
   */
  clear() {
    this._events.clear();
    return this;
  }
}

export default EventEmitter;
