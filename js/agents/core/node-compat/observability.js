/**
 * @file Observability layer for Agent execution tracking.
 * Emits structured events for UI consumption.
 */

import { createLogger } from '../../shared/utils/logger.js';

const logger = createLogger({ stage: 'observability' });

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
    this._replayBatchSize = 100;
  }

  /**
   * @param {(event: ObservabilityEvent) => void} listener
   * @returns {() => void} unsubscribe function
   */
  subscribe(listener) {
    const snapshot = this._buffer.slice();
    this._listeners.add(listener);
    // Replay buffered events asynchronously in batches to avoid blocking subscribe()
    this._replayBufferedEvents(listener, snapshot);
    return () => this._listeners.delete(listener);
  }

  /**
   * @private
   * @param {(event: ObservabilityEvent) => void} listener
   * @param {ObservabilityEvent[]} events
   */
  _replayBufferedEvents(listener, events) {
    if (!events.length) return;
    let cursor = 0;
    const batchSize = this._replayBatchSize;
    const flush = () => {
      if (!this._listeners.has(listener)) return;
      const end = Math.min(cursor + batchSize, events.length);
      for (; cursor < end; cursor += 1) {
        try {
          listener(events[cursor]);
        } catch (error) {
          logger.error('Observability replay listener error', { error });
        }
      }
      if (cursor < events.length) {
        setTimeout(flush, 0);
      }
    };
    setTimeout(flush, 0);
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
      try { fn(event); } catch (e) { logger.error('Observability listener error', { error: e }); }
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
  const observedMethods = new Set([
    'readFile',
    'readText',
    'readdir',
    'stat',
    'writeFile',
    'writeText',
    'appendText',
    'mkdir',
    'unlink',
    'rmdir',
    'copy',
    'move',
    'rename',
  ]);

  return new Proxy(vfs, {
    get(target, prop) {
      const original = target[prop];
      if (typeof original !== 'function') return original;

      // Intercept async methods
      if (typeof prop === 'string' && observedMethods.has(prop)) {
        return async function(...args) {
          const path = args[0];
          const start = Date.now();

          // Quota enforcement
          if (quotaEnforcer) {
            if (['writeFile', 'writeText', 'appendText', 'copy', 'move', 'rename'].includes(prop)) {
              quotaEnforcer.trackFileWrite();
            }
          }

          try {
            const result = await original.apply(target, args);
            const duration = Date.now() - start;

            // Track read size for quota
            if (quotaEnforcer && (prop === 'readFile' || prop === 'readText')) {
              const bytes = result instanceof Uint8Array
                ? result.length
                : new Blob([result ?? '']).size;
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
