/**
 * @fileoverview Node.js `net` module shim for browser sandbox.
 */

import { EventEmitter } from './events.js';
import { Duplex } from './stream.js';

export class Socket extends Duplex {
  constructor(options) {
    super();
    this._connecting = false;
    this._connected = false;
    this._destroyed = false;
    this.localAddress = '127.0.0.1';
    this.localPort = 0;
    this.remoteAddress = undefined;
    this.remotePort = undefined;
    this.remoteFamily = undefined;
    this.connecting = false;
    this.destroyed = false;
    this.readyState = 'closed';
  }

  connect(portOrOptions, hostOrCallback, callback) {
    let port, host = '127.0.0.1', cb;
    if (typeof portOrOptions === 'number') {
      port = portOrOptions;
      if (typeof hostOrCallback === 'string') { host = hostOrCallback; cb = callback; }
      else cb = hostOrCallback;
    } else {
      port = portOrOptions.port;
      host = portOrOptions.host || '127.0.0.1';
      cb = typeof hostOrCallback === 'function' ? hostOrCallback : callback;
    }

    this._connecting = true;
    this.connecting = true;
    this.remoteAddress = host;
    this.remotePort = port;
    this.remoteFamily = 'IPv4';
    this.readyState = 'opening';

    queueMicrotask(() => {
      this._connecting = false;
      this.connecting = false;
      this.readyState = 'closed';
      const err = new Error('net.Socket.connect() is not supported in browser shim');
      err.code = 'ERR_NOT_SUPPORTED';
      this.emit('error', err);
      if (cb) cb(err);
    });
    return this;
  }

  address() {
    if (!this._connected) return null;
    return { address: this.localAddress, family: 'IPv4', port: this.localPort };
  }

  setEncoding() { return this; }
  setTimeout(timeout, cb) { if (cb) this.once('timeout', cb); return this; }
  setNoDelay() { return this; }
  setKeepAlive() { return this; }
  ref() { return this; }
  unref() { return this; }

  destroy(error) {
    if (this._destroyed) return this;
    this._destroyed = true;
    this._connected = false;
    this.destroyed = true;
    this.readyState = 'closed';
    if (error) this.emit('error', error);
    queueMicrotask(() => this.emit('close', !!error));
    return this;
  }

  _receiveData(data) {
    this.push(typeof data === 'string' ? Buffer.from(data) : data);
  }

  _receiveEnd() { this.push(null); }
}

export class Server extends EventEmitter {
  constructor(optionsOrListener, connectionListener) {
    super();
    this._listening = false;
    this._address = null;
    this._connections = new Set();
    this.listening = false;
    const listener = typeof optionsOrListener === 'function'
      ? optionsOrListener : connectionListener;
    if (listener) this.on('connection', listener);
  }

  listen(portOrOptions, hostOrCallback, backlogOrCallback, callback) {
    let port = 0, host = '0.0.0.0', cb;
    if (typeof portOrOptions === 'number') {
      port = portOrOptions;
      if (typeof hostOrCallback === 'string') {
        host = hostOrCallback;
        cb = typeof backlogOrCallback === 'function' ? backlogOrCallback : callback;
      } else if (typeof hostOrCallback === 'function') {
        cb = hostOrCallback;
      } else {
        cb = typeof backlogOrCallback === 'function' ? backlogOrCallback : callback;
      }
    } else if (portOrOptions) {
      port = portOrOptions.port || 0;
      host = portOrOptions.host || '0.0.0.0';
      cb = typeof hostOrCallback === 'function' ? hostOrCallback : callback;
    }
    if (port === 0) port = 3000 + Math.floor(Math.random() * 1000);

    this._address = { address: host, family: 'IPv4', port };
    this._listening = true;
    this.listening = true;
    queueMicrotask(() => { this.emit('listening'); if (cb) cb(); });
    return this;
  }

  address() { return this._address; }

  close(cb) {
    this._listening = false;
    this.listening = false;
    for (const s of this._connections) s.destroy();
    this._connections.clear();
    queueMicrotask(() => { this.emit('close'); if (cb) cb(); });
    return this;
  }

  getConnections(cb) { cb(null, this._connections.size); }
  ref() { return this; }
  unref() { return this; }

  _handleConnection(socket) {
    if (!this._listening) { socket.destroy(); return; }
    this._connections.add(socket);
    socket.on('close', () => this._connections.delete(socket));
    this.emit('connection', socket);
  }
}

export function createServer(opts, listener) { return new Server(opts, listener); }
export function createConnection(port, host, cb) { return new Socket().connect(port, host, cb); }
export const connect = createConnection;

export function isIP(input) {
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(input)) return 4;
  if (/^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/.test(input)) return 6;
  return 0;
}
export function isIPv4(input) { return isIP(input) === 4; }
export function isIPv6(input) { return isIP(input) === 6; }

export default {
  Socket, Server, createServer, createConnection, connect,
  isIP, isIPv4, isIPv6,
};
