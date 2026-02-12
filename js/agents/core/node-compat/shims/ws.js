/**
 * ws (WebSocket) shim for browser environment
 * Minimal implementation wrapping native WebSocket
 */

import { EventEmitter } from './events.js';

/**
 * WebSocket class wrapping native WebSocket
 */
export class WebSocket extends EventEmitter {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  CONNECTING = WebSocket.CONNECTING;
  OPEN = WebSocket.OPEN;
  CLOSING = WebSocket.CLOSING;
  CLOSED = WebSocket.CLOSED;

  /**
   * @param {string | URL} address
   * @param {string | string[]} [protocols]
   * @param {object} [options]
   */
  constructor(address, protocols, options) {
    super();

    const url = typeof address === 'string' ? address : address.toString();

    // Use native WebSocket if available
    if (typeof globalThis.WebSocket !== 'undefined') {
      this._ws = new globalThis.WebSocket(url, protocols);
      this._setupNativeHandlers();
    } else {
      // Fallback: create a stub that emits error
      this.readyState = WebSocket.CLOSED;
      setTimeout(() => this.emit('error', new Error('WebSocket not available')), 0);
    }
  }

  _setupNativeHandlers() {
    this._ws.onopen = (event) => {
      this.readyState = WebSocket.OPEN;
      this.emit('open', event);
    };

    this._ws.onmessage = (event) => {
      this.emit('message', event.data, false);
    };

    this._ws.onerror = (event) => {
      this.emit('error', event.error || new Error('WebSocket error'));
    };

    this._ws.onclose = (event) => {
      this.readyState = WebSocket.CLOSED;
      this.emit('close', event.code, event.reason);
    };
  }

  get readyState() {
    return this._ws ? this._ws.readyState : WebSocket.CLOSED;
  }

  set readyState(value) {
    this._readyState = value;
  }

  get bufferedAmount() {
    return this._ws ? this._ws.bufferedAmount : 0;
  }

  get extensions() {
    return this._ws ? this._ws.extensions : '';
  }

  get protocol() {
    return this._ws ? this._ws.protocol : '';
  }

  get url() {
    return this._ws ? this._ws.url : '';
  }

  /**
   * @param {*} data
   * @param {object} [options]
   * @param {Function} [callback]
   */
  send(data, options, callback) {
    if (this._ws) {
      try {
        this._ws.send(data);
        if (callback) callback();
      } catch (err) {
        if (callback) callback(err);
        else this.emit('error', err);
      }
    }
  }

  /**
   * @param {number} [code]
   * @param {string} [reason]
   */
  close(code, reason) {
    if (this._ws) {
      this._ws.close(code, reason);
    }
  }

  /**
   * @param {Function} [callback]
   */
  terminate(callback) {
    this.close(1000, 'terminated');
    if (callback) callback();
  }

  ping() {}
  pong() {}
}

/**
 * WebSocketServer stub (not supported in browser)
 */
export class WebSocketServer extends EventEmitter {
  constructor(options) {
    super();
    this.options = options || {};
    this.clients = new Set();
  }

  close(callback) {
    this.clients.clear();
    if (callback) callback();
  }

  handleUpgrade() {}
  shouldHandle() { return false; }
}

export default WebSocket;
