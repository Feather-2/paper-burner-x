/**
 * @file Sandbox violation store — records denied operations for auditing.
 *
 * Inspired by Anthropic's SandboxViolationStore from sandbox-runtime.
 * Uses a ring buffer to cap memory usage.
 */

/**
 * @typedef {object} Violation
 * @property {'network'|'fs:read'|'fs:write'|'exec'|'capability'} type
 * @property {string} detail - Human-readable description
 * @property {number} timestamp - Date.now()
 * @property {Record<string, unknown>} [meta] - Extra context
 */

const DEFAULT_MAX = 256;

export class ViolationStore {
  /**
   * @param {{ maxEntries?: number }} [options]
   */
  constructor(options = {}) {
    /** @type {Violation[]} */
    this._entries = [];
    this._max = options.maxEntries || DEFAULT_MAX;
    /** @type {Set<(v: Violation) => void>} */
    this._listeners = new Set();
    this._totalCount = 0;
  }

  /**
   * Record a violation.
   * @param {Violation} violation
   */
  add(violation) {
    const entry = { ...violation, timestamp: violation.timestamp || Date.now() };
    this._entries.push(entry);
    this._totalCount++;
    if (this._entries.length > this._max) {
      // Note: shift() is O(n), but with DEFAULT_MAX=256, performance impact is negligible.
      // If max entries increases significantly (10000+), consider using a circular buffer.
      this._entries.shift();
    }
    for (const fn of this._listeners) {
      try { fn(entry); } catch (_) { /* swallow */ }
    }
  }

  /**
   * Get all recorded violations.
   * @returns {Violation[]}
   */
  getAll() {
    return [...this._entries];
  }

  /**
   * Get violations filtered by type.
   * @param {'network'|'fs:read'|'fs:write'|'exec'|'capability'} type
   * @returns {Violation[]}
   */
  getByType(type) {
    return this._entries.filter(v => v.type === type);
  }

  /**
   * Subscribe to new violations.
   * @param {(v: Violation) => void} fn
   * @param {{ emitExisting?: boolean }} [options]
   * @returns {() => void} unsubscribe
   */
  subscribe(fn, options = {}) {
    this._listeners.add(fn);
    if (options.emitExisting) {
      for (const entry of this._entries) {
        try { fn(entry); } catch (_) { /* swallow */ }
      }
    }
    return () => this._listeners.delete(fn);
  }

  /** Clear all entries. */
  clear() {
    this._entries.length = 0;
  }

  /**
   * Get violations filtered by encoded command.
   * @param {string} encodedCommand
   * @returns {Violation[]}
   */
  getByCommand(encodedCommand) {
    return this._entries.filter(v => v.meta?.encodedCommand === encodedCommand);
  }

  /** @returns {number} Total violations ever recorded (not reset by clear). */
  get totalCount() {
    return this._totalCount;
  }

  /** @returns {number} */
  get size() {
    return this._entries.length;
  }
}

/**
 * Create a ViolationStore instance.
 * @param {{ maxEntries?: number }} [options]
 * @returns {ViolationStore}
 */
export function createViolationStore(options) {
  return new ViolationStore(options);
}

export default { ViolationStore, createViolationStore };
