/**
 * SSE writer for streaming agent events to HTTP clients.
 *
 * Handles event formatting, heartbeat pings, and connection lifecycle.
 * Works with any writable interface (Node.js res, browser ReadableStream controller).
 *
 * @module sdk/http/sse-writer
 */

import { STREAM_EVENT_TYPES } from './stream-events.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * @typedef {object} WritableTarget
 * @property {(chunk: string) => void} write
 * @property {() => void} [end]
 */

/**
 * @typedef {object} SseWriterOptions
 * @property {number} [heartbeatMs=15000]  Heartbeat interval in ms
 * @property {boolean} [autoHeartbeat=true]  Start heartbeat on construction
 */

// ---------------------------------------------------------------------------
// SseWriter
// ---------------------------------------------------------------------------

export class SseWriter {
  /**
   * @param {WritableTarget} target
   * @param {SseWriterOptions} [options]
   */
  constructor(target, options = {}) {
    /** @type {WritableTarget} */
    this._target = target;
    /** @type {number} */
    this._heartbeatMs = options.heartbeatMs ?? 15000;
    /** @type {ReturnType<typeof setInterval> | null} */
    this._heartbeatTimer = null;
    /** @type {boolean} */
    this._closed = false;

    if (options.autoHeartbeat !== false) {
      this.startHeartbeat();
    }
  }

  /**
   * Write an SSE event.
   *
   * @param {string} type   Event type (from STREAM_EVENT_TYPES)
   * @param {*} [data]      Event data (will be JSON-stringified)
   */
  writeEvent(type, data) {
    if (this._closed) return;
    const payload = data !== undefined
      ? JSON.stringify({ type, ...( typeof data === 'object' && data !== null ? data : { data }) })
      : JSON.stringify({ type });
    this._target.write(`data: ${payload}\n\n`);
  }

  /** Write a ping heartbeat event. */
  writePing() {
    if (this._closed) return;
    this._target.write(`data: ${JSON.stringify({ type: STREAM_EVENT_TYPES.PING })}\n\n`);
  }

  /** Start periodic heartbeat pings. */
  startHeartbeat() {
    this.stopHeartbeat();
    if (this._heartbeatMs > 0) {
      this._heartbeatTimer = setInterval(() => this.writePing(), this._heartbeatMs);
    }
  }

  /** Stop periodic heartbeat pings. */
  stopHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  /**
   * Write a terminal error event and close.
   * @param {string} message
   */
  writeError(message) {
    this.writeEvent(STREAM_EVENT_TYPES.ERROR, { error: message });
    this.close();
  }

  /** Close the writer and stop heartbeat. */
  close() {
    if (this._closed) return;
    this._closed = true;
    this.stopHeartbeat();
    if (this._target.end) {
      try { this._target.end(); } catch { /* intentional: target may already be closed */ }
    }
  }

  /** @returns {boolean} */
  get closed() { return this._closed; }
}

// ---------------------------------------------------------------------------
// SSE response headers
// ---------------------------------------------------------------------------

/** @type {Record<string, string>} */
export const SSE_HEADERS = Object.freeze({
  'Content-Type':  'text/event-stream',
  'Cache-Control': 'no-cache',
  'Connection':    'keep-alive',
});
