/**
 * @file Observability layer for Agent execution tracking.
 * Emits structured events for UI consumption.
 */

/**
 * @typedef {object} ObservabilityEvent
 * @property {string} type - Event type (fs:read/write, http:request, code:execute, etc.)
 * @property {number} timestamp - Unix timestamp in ms
 * @property {object} data - Event-specific payload
 * @property {object} [meta] - Optional metadata (duration, size, etc.)
 */

export class ObservabilityStream {
  constructor() {
    /** @type {Set<(event: ObservabilityEvent) => void>} */
    this._listeners = new Set();
    this._buffer = [];
    this._maxBuffer = 1000;
  }

  /**
   * @param {(event: ObservabilityEvent) => void} listener
   * @returns {() => void} unsubscribe function
   */
  subscribe(listener) {
    this._listeners.add(listener);
    // Send buffered events to new subscriber
    this._buffer.forEach(e => listener(e));
    return () => this._listeners.delete(listener);
  }

  /**
   * @param {string} type
   * @param {object} data
   * @param {object} [meta]
   */
  emit(type, data, meta) {
    const event = { type, timestamp: Date.now(), data, meta };

    // Buffer for late subscribers
    this._buffer.push(event);
    if (this._buffer.length > this._maxBuffer) {
      this._buffer.shift();
    }

    // Broadcast to all listeners
    this._listeners.forEach(fn => {
      try { fn(event); } catch (e) { console.error('Observability listener error:', e); }
    });
  }

  clear() {
    this._buffer = [];
  }
}

/**
 * Wrap VFS with observability hooks.
 * @param {object} vfs
 * @param {ObservabilityStream} stream
 * @param {import('./quota.js').QuotaEnforcer} [quotaEnforcer]
 * @returns {object} Wrapped VFS
 */
export function withObservability(vfs, stream, quotaEnforcer) {
  return new Proxy(vfs, {
    get(target, prop) {
      const original = target[prop];
      if (typeof original !== 'function') return original;

      // Intercept async methods
      if (['readFile', 'readText', 'writeFile', 'mkdir', 'unlink', 'rmdir'].includes(prop)) {
        return async function(...args) {
          const path = args[0];
          const start = Date.now();

          // Quota enforcement
          if (quotaEnforcer) {
            if (prop === 'writeFile') quotaEnforcer.trackFileWrite();
          }

          try {
            const result = await original.apply(target, args);
            const duration = Date.now() - start;

            // Track read size for quota
            if (quotaEnforcer && (prop === 'readFile' || prop === 'readText')) {
              const bytes = result instanceof Uint8Array ? result.length : new Blob([result]).size;
              quotaEnforcer.trackFileRead(bytes);
            }

            stream.emit(`fs:${prop}`, { path, success: true }, { duration });
            return result;
          } catch (error) {
            stream.emit(`fs:${prop}`, { path, success: false, error: error.message }, { duration: Date.now() - start });
            throw error;
          }
        };
      }

      return original;
    }
  });
}
