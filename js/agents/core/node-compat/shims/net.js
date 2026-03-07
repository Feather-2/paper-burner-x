/**
 * @fileoverview Node.js `net` module shim for browser sandbox.
 */

import { EventEmitter } from './events.js';
import { Buffer } from './buffer.js';
import { Duplex } from './stream.js';

const LISTEN_ANY_IPV4 = '0.0.0.0';
const DEFAULT_HOST = '127.0.0.1';
const LOCALHOST = 'localhost';
const MIN_SERVER_PORT = 3000;
const MAX_SERVER_PORT = 65535;
const MIN_CLIENT_PORT = 40000;
const MAX_CLIENT_PORT = 60999;

const LISTENERS = new Map();
let NEXT_SERVER_PORT = MIN_SERVER_PORT;
let NEXT_CLIENT_PORT = MIN_CLIENT_PORT;

/**
 * @typedef {Error & {
 *   code?: string,
 *   errno?: string,
 *   syscall?: string,
 *   address?: string,
 *   port?: number
 * }} NetError
 */

/**
 * @param {string} message
 * @param {string} code
 * @param {{ errno?: string, syscall?: string, address?: string, port?: number }} [details]
 * @returns {NetError}
 */
function createNetError(message, code, details = {}) {
  const err = /** @type {NetError} */ (new Error(message));
  err.code = code;
  if (details.errno) err.errno = details.errno;
  if (details.syscall) err.syscall = details.syscall;
  if (details.address) err.address = details.address;
  if (details.port !== undefined) err.port = details.port;
  return err;
}

export const NET_SHIM_CAPABILITIES = Object.freeze({
  transport: 'in-memory',
  supportsRealTcp: false,
  supportsDnsResolution: false,
});

export function isRealNetworkSupported() {
  return false;
}

function normalizeHost(host) {
  const raw = String(host || '').trim();
  if (!raw) return DEFAULT_HOST;
  if (raw === LOCALHOST) return DEFAULT_HOST;
  return raw;
}

function endpointKey(host, port) {
  return `${normalizeHost(host)}:${Number(port)}`;
}

function canBind(host, port) {
  const normalizedHost = normalizeHost(host);
  const exact = endpointKey(normalizedHost, port);
  const wildcard = endpointKey(LISTEN_ANY_IPV4, port);
  if (LISTENERS.has(exact)) return false;
  if (normalizedHost === LISTEN_ANY_IPV4) {
    for (const key of LISTENERS.keys()) {
      const parts = key.split(':');
      const existingPort = Number(parts[parts.length - 1]);
      if (existingPort === Number(port)) return false;
    }
    return true;
  }
  return !LISTENERS.has(wildcard);
}

function allocateServerPort(host) {
  const maxAttempts = MAX_SERVER_PORT - MIN_SERVER_PORT + 1;
  for (let i = 0; i < maxAttempts; i++) {
    const candidate = NEXT_SERVER_PORT++;
    if (NEXT_SERVER_PORT > MAX_SERVER_PORT) NEXT_SERVER_PORT = MIN_SERVER_PORT;
    if (canBind(host, candidate)) return candidate;
  }
  return 0;
}

function allocateClientPort() {
  const candidate = NEXT_CLIENT_PORT++;
  if (NEXT_CLIENT_PORT > MAX_CLIENT_PORT) NEXT_CLIENT_PORT = MIN_CLIENT_PORT;
  return candidate;
}

function findListeningServer(host, port) {
  const exact = LISTENERS.get(endpointKey(host, port));
  if (exact) return exact;
  return LISTENERS.get(endpointKey(LISTEN_ANY_IPV4, port)) || null;
}

function createConnectError(host, port) {
  return createNetError(`connect ECONNREFUSED ${host}:${port}`, 'ECONNREFUSED', {
    errno: 'ECONNREFUSED',
    syscall: 'connect',
    address: host,
    port,
  });
}

function createAddrInUseError(host, port) {
  return createNetError(`listen EADDRINUSE ${host}:${port}`, 'EADDRINUSE', {
    errno: 'EADDRINUSE',
    syscall: 'listen',
    address: host,
    port,
  });
}

export class Socket extends Duplex {
  constructor(options = {}) {
    super(options);
    this._connecting = false;
    this._connected = false;
    this._destroyed = false;
    this._peer = null;
    this.localAddress = DEFAULT_HOST;
    this.localPort = 0;
    this.remoteAddress = undefined;
    this.remotePort = undefined;
    this.remoteFamily = undefined;
    this.connecting = false;
    this.destroyed = false;
    this.readyState = 'closed';
    this._timeoutMs = 0;
    this._timeoutHandle = null;
    this.isVirtualSocket = true;
    this._write = (chunk, encoding, cb) => {
      if (this._destroyed || !this.writable) {
        const err = createNetError('This socket is closed', 'ERR_SOCKET_CLOSED');
        if (typeof cb === 'function') cb(err);
        return;
      }

      const peer = this._peer;
      if (!peer || peer._destroyed) {
        const err = createNetError('Socket is not connected', 'ENOTCONN');
        if (typeof cb === 'function') cb(err);
        return;
      }

      const payload = typeof chunk === 'string'
        ? Buffer.from(chunk, encoding || 'utf8')
        : (chunk instanceof Uint8Array ? Buffer.from(chunk) : Buffer.from(String(chunk ?? '')));

      this._touchActivity();
      queueMicrotask(() => {
        if (!peer._destroyed) peer._receiveData(payload);
      });
      if (typeof cb === 'function') cb();
    };
  }

  _clearTimeoutHandle() {
    if (this._timeoutHandle) {
      clearTimeout(this._timeoutHandle);
      this._timeoutHandle = null;
    }
  }

  _scheduleTimeout() {
    this._clearTimeoutHandle();
    if (!this._timeoutMs || this._destroyed) return;
    this._timeoutHandle = setTimeout(() => {
      this.emit('timeout');
    }, this._timeoutMs);
  }

  _touchActivity() {
    if (!this._timeoutMs) return;
    this._scheduleTimeout();
  }

  connect(portOrOptions, hostOrCallback, callback) {
    let port;
    let host = DEFAULT_HOST;
    let cb;

    if (typeof portOrOptions === 'number') {
      port = portOrOptions;
      if (typeof hostOrCallback === 'string') { host = hostOrCallback; cb = callback; }
      else cb = hostOrCallback;
    } else if (portOrOptions && typeof portOrOptions === 'object') {
      port = portOrOptions.port;
      host = portOrOptions.host || DEFAULT_HOST;
      cb = typeof hostOrCallback === 'function' ? hostOrCallback : callback;
    } else {
      const err = new TypeError('Socket.connect(port[, host][, callback]): invalid arguments');
      queueMicrotask(() => {
        this.emit('error', err);
        if (typeof cb === 'function') cb(err);
      });
      return this;
    }

    const normalizedHost = normalizeHost(host);
    const normalizedPort = Number(port);

    this._connecting = true;
    this.connecting = true;
    this.remoteAddress = normalizedHost;
    this.remotePort = normalizedPort;
    this.remoteFamily = isIPv6(normalizedHost) ? 'IPv6' : 'IPv4';
    this.readyState = 'opening';

    queueMicrotask(() => {
      if (this._destroyed) return;
      const server = findListeningServer(normalizedHost, normalizedPort);
      if (!server || !server.listening) {
        const err = createConnectError(normalizedHost, normalizedPort);
        this._connecting = false;
        this.connecting = false;
        this._connected = false;
        this.readyState = 'closed';
        this.emit('error', err);
        if (typeof cb === 'function') cb(err);
        return;
      }

      this._connecting = false;
      this.connecting = false;
      this._connected = true;
      this.readyState = 'open';
      this.destroyed = false;
      this.localPort = allocateClientPort();

      const serverSocket = new Socket();
      serverSocket._connected = true;
      serverSocket.readyState = 'open';
      serverSocket.destroyed = false;
      serverSocket.localAddress = server._address?.address || LISTEN_ANY_IPV4;
      serverSocket.localPort = normalizedPort;
      serverSocket.remoteAddress = this.localAddress;
      serverSocket.remotePort = this.localPort;
      serverSocket.remoteFamily = 'IPv4';

      this._peer = serverSocket;
      serverSocket._peer = this;

      server._handleConnection(serverSocket);
      this.emit('connect');
      this._touchActivity();
      if (typeof cb === 'function') cb();
    });
    return this;
  }

  end(chunk, encoding, cb) {
    super.end(chunk, encoding, cb);
    const peer = this._peer;
    if (peer && !peer._destroyed) {
      queueMicrotask(() => peer._receiveEnd());
    }
    return this;
  }

  address() {
    if (!this._connected) return null;
    return { address: this.localAddress, family: 'IPv4', port: this.localPort };
  }

  setEncoding() { return this; }
  setTimeout(timeout, cb) {
    const value = Number(timeout);
    if (!Number.isFinite(value) || value < 0) {
      const err = /** @type {RangeError & { code?: string }} */ (new RangeError(
        `The value of "msecs" is out of range. It must be a non-negative finite number. Received ${timeout}`
      ));
      err.code = 'ERR_OUT_OF_RANGE';
      throw err;
    }
    this._timeoutMs = Math.floor(value);
    if (cb) this.once('timeout', cb);
    if (this._timeoutMs === 0) {
      this._clearTimeoutHandle();
    } else {
      this._scheduleTimeout();
    }
    return this;
  }
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
    this._clearTimeoutHandle();

    const peer = this._peer;
    this._peer = null;
    if (peer && !peer._destroyed) {
      peer._peer = null;
      queueMicrotask(() => peer._receiveEnd());
    }

    if (error) this.emit('error', error);
    queueMicrotask(() => this.emit('close', !!error));
    return this;
  }

  _receiveData(data) {
    this._touchActivity();
    this.push(typeof data === 'string' ? Buffer.from(data) : data);
  }

  _receiveEnd() {
    this._connected = false;
    this.readyState = 'closed';
    this._clearTimeoutHandle();
    this.push(null);
  }
}

export class Server extends EventEmitter {
  constructor(optionsOrListener, connectionListener) {
    super();
    this._listening = false;
    this._address = null;
    this._connections = new Set();
    this._listenKey = null;
    this.listening = false;
    const listener = typeof optionsOrListener === 'function'
      ? optionsOrListener : connectionListener;
    if (listener) this.on('connection', listener);
  }

  listen(portOrOptions, hostOrCallback, backlogOrCallback, callback) {
    let port = 0;
    let host = LISTEN_ANY_IPV4;
    let cb;

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
    } else if (portOrOptions && typeof portOrOptions === 'object') {
      port = portOrOptions.port || 0;
      host = portOrOptions.host || LISTEN_ANY_IPV4;
      cb = typeof hostOrCallback === 'function' ? hostOrCallback : callback;
    }

    if (port === 0) {
      port = allocateServerPort(host);
      if (port === 0) {
        const err = createNetError('No free ephemeral ports available for net.Server.listen(0)', 'EADDRNOTAVAIL');
        queueMicrotask(() => {
          this.emit('error', err);
          if (typeof cb === 'function') cb(err);
        });
        return this;
      }
    }

    const normalizedHost = normalizeHost(host);
    if (!canBind(normalizedHost, port)) {
      const err = createAddrInUseError(normalizedHost, port);
      queueMicrotask(() => {
        this.emit('error', err);
        if (typeof cb === 'function') cb(err);
      });
      return this;
    }

    this._listenKey = endpointKey(normalizedHost, port);
    LISTENERS.set(this._listenKey, this);
    this._address = { address: normalizedHost, family: isIPv6(normalizedHost) ? 'IPv6' : 'IPv4', port };
    this._listening = true;
    this.listening = true;

    queueMicrotask(() => {
      this.emit('listening');
      if (typeof cb === 'function') cb();
    });
    return this;
  }

  address() { return this._address; }

  close(cb) {
    if (this._listenKey) {
      LISTENERS.delete(this._listenKey);
      this._listenKey = null;
    }
    this._listening = false;
    this.listening = false;
    for (const s of this._connections) s.destroy();
    this._connections.clear();
    queueMicrotask(() => {
      this.emit('close');
      if (typeof cb === 'function') cb();
    });
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
  NET_SHIM_CAPABILITIES,
  isRealNetworkSupported,
  Socket, Server, createServer, createConnection, connect,
  isIP, isIPv4, isIPv6,
};
