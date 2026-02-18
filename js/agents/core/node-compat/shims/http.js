/**
 * @fileoverview Node.js `http` module shim for browser sandbox.
 * Includes fetch-based ClientRequest for http.request()/http.get().
 *
 * Factory pattern: call createHttpShim({ networkPolicy, onViolation }) to get
 * an isolated instance with its own mutable state (policy, servers, callbacks).
 */

import { EventEmitter } from './events.js';
import { Readable, Writable } from './stream.js';
import { Buffer } from './buffer.js';
import { Socket } from './net.js';
import { validateDomainPattern, matchesDomainPattern, isUrlAllowed, isUrlAllowedAsync } from '../../sandbox/network-policy-utils.js';

export class IncomingMessage extends Readable {
  constructor(socket) {
    super();
    this.httpVersion = '1.1';
    this.httpVersionMajor = 1;
    this.httpVersionMinor = 1;
    this.complete = false;
    this.headers = {};
    this.rawHeaders = [];
    this.trailers = {};
    this.rawTrailers = [];
    this.method = undefined;
    this.url = undefined;
    this.statusCode = undefined;
    this.statusMessage = undefined;
    this.socket = socket || new Socket();
  }

  setTimeout(ms, cb) { if (cb) this.once('timeout', cb); return this; }

  _setBody(body) {
    const buf = typeof body === 'string' ? Buffer.from(body) : body;
    if (buf) this.push(buf);
    this.push(null);
    this.complete = true;
  }

  static fromRequest(method, url, headers, body) {
    const msg = new IncomingMessage();
    msg.method = method;
    msg.url = url;
    msg.headers = { ...headers };
    for (const [k, v] of Object.entries(headers)) msg.rawHeaders.push(k, v);
    if (body) msg._setBody(body);
    else { msg.push(null); msg.complete = true; }
    return msg;
  }

  static fromFetchResponse(resp) {
    const msg = new IncomingMessage();
    msg.statusCode = resp.status;
    msg.statusMessage = resp.statusText || STATUS_CODES[resp.status] || '';
    msg.headers = {};
    resp.headers.forEach((v, k) => {
      msg.headers[k.toLowerCase()] = v;
      msg.rawHeaders.push(k, v);
    });
    return msg;
  }
}

export class ServerResponse extends Writable {
  constructor(req) {
    super();
    this.statusCode = 200;
    this.statusMessage = 'OK';
    this.headersSent = false;
    this.finished = false;
    this.sendDate = true;
    this.socket = req?.socket || null;
    this._headers = new Map();
    this._body = [];
    this._resolve = null;
  }

  _setResolver(resolve) { this._resolve = resolve; }

  setHeader(name, value) {
    if (this.headersSent) throw new Error('Cannot set headers after they are sent');
    this._headers.set(name.toLowerCase(), String(value));
    return this;
  }

  getHeader(name) { return this._headers.get(name.toLowerCase()); }

  getHeaders() {
    const h = {};
    for (const [k, v] of this._headers) h[k] = v;
    return h;
  }

  getHeaderNames() { return [...this._headers.keys()]; }
  hasHeader(name) { return this._headers.has(name.toLowerCase()); }
  removeHeader(name) { this._headers.delete(name.toLowerCase()); }

  writeHead(statusCode, statusMessageOrHeaders, headers) {
    this.statusCode = statusCode;
    if (typeof statusMessageOrHeaders === 'string') {
      this.statusMessage = statusMessageOrHeaders;
      if (headers) for (const [k, v] of Object.entries(headers)) this.setHeader(k, v);
    } else if (statusMessageOrHeaders) {
      for (const [k, v] of Object.entries(statusMessageOrHeaders)) this.setHeader(k, v);
    }
    return this;
  }

  write(chunk, encodingOrCb, cb) {
    this.headersSent = true;
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    this._body.push(buf);
    const callback = typeof encodingOrCb === 'function' ? encodingOrCb : cb;
    if (callback) queueMicrotask(() => callback(null));
    return true;
  }

  end(chunkOrCb, encodingOrCb, callback) {
    if (typeof chunkOrCb === 'function') callback = chunkOrCb;
    else if (chunkOrCb !== undefined && chunkOrCb !== null) this.write(chunkOrCb);
    if (typeof encodingOrCb === 'function') callback = encodingOrCb;
    this.headersSent = true;
    this.finished = true;
    if (this._resolve) {
      const headers = {};
      for (const [k, v] of this._headers) headers[k] = Array.isArray(v) ? v.join(', ') : v;
      this._resolve({
        statusCode: this.statusCode,
        statusMessage: this.statusMessage,
        headers,
        body: Buffer.concat(this._body),
      });
    }
    queueMicrotask(() => { this.emit('finish'); if (callback) callback(); });
    return this;
  }

  json(data) {
    this.setHeader('Content-Type', 'application/json');
    return this.end(JSON.stringify(data));
  }

  status(code) { this.statusCode = code; return this; }
}

export const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];

export const STATUS_CODES = {
  200: 'OK', 201: 'Created', 204: 'No Content',
  301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified',
  400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found',
  500: 'Internal Server Error',
};

/**
 * Create an isolated http shim instance with its own network policy and server state.
 * @param {{ networkPolicy?: { allowedDomains?: string[], deniedDomains?: string[], onViolation?: (info: object) => void }, quotaEnforcer?: import('../quota.js').QuotaEnforcer, observability?: import('../observability.js').ObservabilityStream }} [options]
 */
export function createHttpShim(options = {}) {
  let _networkPolicy = null;
  let _askCallback = options.askCallback || null;
  let _serverListenCallback = null;
  let _serverCloseCallback = null;
  let _servers = new Map();
  let _nextServerPort = 3000;
  const _quotaEnforcer = options.quotaEnforcer || null;
  const _observability = options.observability || null;

  // Apply initial policy if provided
  if (options.networkPolicy) {
    const policy = options.networkPolicy;
    for (const list of [policy.allowedDomains, policy.deniedDomains]) {
      if (list) list.forEach(validateDomainPattern);
    }
    _networkPolicy = policy;
  }

  function setNetworkPolicy(policy) {
    if (policy) {
      for (const list of [policy.allowedDomains, policy.deniedDomains]) {
        if (list) list.forEach(validateDomainPattern);
      }
    }
    _networkPolicy = policy;
  }

  function isRequestAllowed(url) {
    return isUrlAllowed(url, _networkPolicy);
  }

  function isRequestAllowedAsync(url, method) {
    return isUrlAllowedAsync(url, _networkPolicy, { askCallback: _askCallback, method });
  }

  function setServerListenCallback(cb) { _serverListenCallback = cb; }
  function setServerCloseCallback(cb) { _serverCloseCallback = cb; }
  function getServer(port) { return _servers.get(Number(port)); }
  function getAllServers() { return Array.from(_servers.values()); }

  function normalizeTimeout(ms) {
    const value = Number(ms);
    if (!Number.isFinite(value) || value < 0) {
      const err = new RangeError(
        `The value of "msecs" is out of range. It must be a non-negative finite number. Received ${ms}`
      );
      err.code = 'ERR_OUT_OF_RANGE';
      throw err;
    }
    return Math.floor(value);
  }

  function createAbortError() {
    const err = new Error('Request aborted');
    err.code = 'ABORT_ERR';
    return err;
  }

  function allocateServerPort() {
    const min = 3000;
    const max = 65535;
    const attempts = max - min + 1;
    for (let i = 0; i < attempts; i++) {
      const candidate = _nextServerPort++;
      if (_nextServerPort > max) _nextServerPort = min;
      if (!_servers.has(candidate)) return candidate;
    }
    return 0;
  }

  function createAddrInUseError(port) {
    const err = new Error(`listen EADDRINUSE 0.0.0.0:${port}`);
    err.code = 'EADDRINUSE';
    return err;
  }

  class ClientRequest extends Writable {
    constructor(opts, callback) {
      super();
      this._options = typeof opts === 'string' ? new URL(opts) : opts;
      this._body = [];
      this._headers = {};
      this._method = this._options.method || 'GET';
      this._aborted = false;
      this._timeout = null;
      this._timeoutHandle = null;
      this._abortController = null;

      if (this._options instanceof URL) {
        this._url = this._options.href;
      } else {
        const protocol = this._options.protocol || 'http:';
        const host = this._options.hostname || this._options.host || 'localhost';
        const port = this._options.port ? ':' + this._options.port : '';
        const path = this._options.path || '/';
        this._url = `${protocol}//${host}${port}${path}`;
      }

      if (this._options.headers) {
        for (const [k, v] of Object.entries(this._options.headers)) {
          this._headers[k.toLowerCase()] = v;
        }
      }

      if (callback) this.once('response', callback);
    }

    setHeader(name, value) { this._headers[name.toLowerCase()] = value; return this; }
    getHeader(name) { return this._headers[name.toLowerCase()]; }
    removeHeader(name) { delete this._headers[name.toLowerCase()]; }

    setTimeout(ms, cb) {
      this._timeout = normalizeTimeout(ms);
      if (cb) this.once('timeout', cb);
      if (this._abortController) {
        if (this._timeoutHandle) clearTimeout(this._timeoutHandle);
        if (this._timeout > 0) {
          this._timeoutHandle = setTimeout(() => {
            if (this._abortController) this._abortController.abort();
            this.emit('timeout');
          }, this._timeout);
        }
      }
      return this;
    }

    abort() {
      if (this._aborted) return;
      this._aborted = true;
      if (this._timeoutHandle) {
        clearTimeout(this._timeoutHandle);
        this._timeoutHandle = null;
      }
      if (this._abortController) {
        this._abortController.abort();
      }
      this.emit('abort');
    }

    write(chunk, encoding, cb) {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      this._body.push(buf);
      if (typeof encoding === 'function') cb = encoding;
      if (cb) queueMicrotask(() => cb(null));
      return true;
    }

    end(chunkOrCb, encoding, cb) {
      if (typeof chunkOrCb === 'function') {
        cb = chunkOrCb;
      } else if (chunkOrCb != null) {
        this.write(chunkOrCb);
      }
      if (typeof encoding === 'function') cb = encoding;

      this._doFetch().then(
        (resp) => {
          if (this._aborted) return;
          if (cb) cb();
          this.emit('response', resp);
        },
        (err) => {
          if (this._aborted && (!err || err.code !== 'ABORT_ERR')) {
            this.emit('error', createAbortError());
            return;
          }
          this.emit('error', err);
        }
      );
      return this;
    }

    /** @private */
    async _doFetch() {
      if (this._aborted) throw createAbortError();

      const allowed = await isRequestAllowedAsync(this._url, this._method);
      if (!allowed) {
        const err = new Error(`Network request blocked by policy: ${this._url}`);
        err.code = 'ERR_NETWORK_POLICY';
        if (_networkPolicy?.onViolation) {
          _networkPolicy.onViolation({ type: 'network', url: this._url, method: this._method });
        }
        throw err;
      }

      const fetchOptions = {
        method: this._method,
        headers: this._headers,
      };

      if (this._body.length > 0 && this._method !== 'GET' && this._method !== 'HEAD') {
        fetchOptions.body = Buffer.concat(this._body);
      }

      const controller = new AbortController();
      this._abortController = controller;
      fetchOptions.signal = controller.signal;
      if (this._aborted) controller.abort();

      if (this._timeoutHandle) {
        clearTimeout(this._timeoutHandle);
        this._timeoutHandle = null;
      }
      if (this._timeout > 0) {
        this._timeoutHandle = setTimeout(() => {
          controller.abort();
          this.emit('timeout');
        }, this._timeout);
      }

      try {
        const fetchResp = await fetch(this._url, fetchOptions);
        if (this._timeoutHandle) {
          clearTimeout(this._timeoutHandle);
          this._timeoutHandle = null;
        }

        const msg = IncomingMessage.fromFetchResponse(fetchResp);

        if (fetchResp.body && typeof fetchResp.body.getReader === 'function') {
          const reader = fetchResp.body.getReader();
          const pump = async () => {
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) { msg.push(null); msg.complete = true; break; }
                msg.push(Buffer.from(value));
              }
            } catch (err) {
              msg.destroy(err);
            }
          };
          pump();
        } else {
          const buf = await fetchResp.arrayBuffer();
          msg.push(Buffer.from(new Uint8Array(buf)));
          msg.push(null);
          msg.complete = true;
        }

        return msg;
      } catch (err) {
        if (this._timeoutHandle) {
          clearTimeout(this._timeoutHandle);
          this._timeoutHandle = null;
        }
        if (this._aborted || err?.name === 'AbortError') {
          throw createAbortError();
        }
        throw err;
      } finally {
        this._abortController = null;
      }
    }
  }

  class Server extends EventEmitter {
    constructor(opts, requestListener) {
      super();
      this._listening = false;
      this._address = null;
      const listener = typeof opts === 'function' ? opts : requestListener;
      if (listener) this.on('request', listener);
    }

    listen(port, host, backlog, cb) {
      if (typeof host === 'function') { cb = host; host = '0.0.0.0'; }
      if (typeof backlog === 'function') { cb = backlog; }

      let requestedPort = Number.isFinite(Number(port)) ? Number(port) : 0;
      if (requestedPort < 0 || requestedPort > 65535) {
        const err = new RangeError(`Invalid port: ${port}`);
        err.code = 'ERR_SOCKET_BAD_PORT';
        queueMicrotask(() => {
          this.emit('error', err);
          if (cb) cb(err);
        });
        return this;
      }
      if (requestedPort === 0) {
        requestedPort = allocateServerPort();
        if (requestedPort === 0) {
          const err = createAddrInUseError(0);
          queueMicrotask(() => {
            this.emit('error', err);
            if (cb) cb(err);
          });
          return this;
        }
      }
      if (_servers.has(requestedPort) && _servers.get(requestedPort) !== this) {
        const err = createAddrInUseError(requestedPort);
        queueMicrotask(() => {
          this.emit('error', err);
          if (cb) cb(err);
        });
        return this;
      }

      this._address = { port: requestedPort, address: host || '0.0.0.0', family: 'IPv4' };
      this._listening = true;
      _servers.set(requestedPort, this);
      if (_serverListenCallback) _serverListenCallback(requestedPort, this);
      queueMicrotask(() => { this.emit('listening'); if (cb) cb(); });
      return this;
    }

    close(cb) {
      this._listening = false;
      const port = this._address?.port;
      if (port) { _servers.delete(port); if (_serverCloseCallback) _serverCloseCallback(port); }
      queueMicrotask(() => { this.emit('close'); if (cb) cb(); });
      return this;
    }

    address() { return this._address; }

    async handleRequest(method, url, headers, body) {
      return new Promise((resolve) => {
        const req = IncomingMessage.fromRequest(method, url, headers || {}, body);
        const res = new ServerResponse(req);
        res._setResolver(resolve);
        this.emit('request', req, res);
      });
    }
  }

  function createServer(opts, requestListener) {
    return new Server(opts, requestListener);
  }

  function request(urlOrOptions, optionsOrCallback, callback) {
    let opts, cb;
    if (typeof urlOrOptions === 'string' || urlOrOptions instanceof URL) {
      const parsed = typeof urlOrOptions === 'string' ? new URL(urlOrOptions) : urlOrOptions;
      if (typeof optionsOrCallback === 'function') {
        cb = optionsOrCallback;
        opts = parsed;
      } else {
        opts = { ...optionsOrCallback, hostname: parsed.hostname, port: parsed.port, path: parsed.pathname + parsed.search, protocol: parsed.protocol };
        cb = callback;
      }
    } else {
      opts = urlOrOptions;
      cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
    }
    return new ClientRequest(opts, cb);
  }

  function get(urlOrOptions, optionsOrCallback, callback) {
    const req = request(urlOrOptions, optionsOrCallback, callback);
    req.end();
    return req;
  }

  return {
    IncomingMessage, ServerResponse,
    ClientRequest, Server, createServer,
    request, get, METHODS, STATUS_CODES,
    setServerListenCallback, setServerCloseCallback, getServer, getAllServers,
    setNetworkPolicy,
  };
}

/**
 * Minimal Agent shim (compatible shape for https/http callers).
 */
export class Agent {
  constructor(options = {}) {
    this.options = { ...options };
    this.keepAlive = !!options.keepAlive;
    this.maxSockets = Number.isFinite(options.maxSockets) ? options.maxSockets : Infinity;
    this.maxFreeSockets = Number.isFinite(options.maxFreeSockets) ? options.maxFreeSockets : 256;
  }
  addRequest() {}
  createConnection() {
    return new Socket();
  }
  destroy() {}
}

export const globalAgent = new Agent({ keepAlive: true });

const __defaultHttpShim = createHttpShim();

export const Server = __defaultHttpShim.Server;
export const ClientRequest = __defaultHttpShim.ClientRequest;
export const createServer = __defaultHttpShim.createServer;

export function setServerListenCallback(cb) {
  return __defaultHttpShim.setServerListenCallback(cb);
}

export function setServerCloseCallback(cb) {
  return __defaultHttpShim.setServerCloseCallback(cb);
}

export function getServer(port) {
  return __defaultHttpShim.getServer(port);
}

export function getAllServers() {
  return typeof __defaultHttpShim.getAllServers === "function" ? __defaultHttpShim.getAllServers() : [];
}

function withProtocol(urlOrOptions, protocol) {
  if (!protocol) return urlOrOptions;
  if (typeof urlOrOptions === "string") {
    try {
      const parsed = new URL(urlOrOptions);
      parsed.protocol = `${protocol}:`;
      return parsed.toString();
    } catch {
      return urlOrOptions;
    }
  }
  if (urlOrOptions instanceof URL) {
    const cloned = new URL(urlOrOptions.toString());
    cloned.protocol = `${protocol}:`;
    return cloned;
  }
  if (urlOrOptions && typeof urlOrOptions === "object") {
    return {
      ...urlOrOptions,
      protocol: `${protocol}:`,
    };
  }
  return urlOrOptions;
}

export function _createClientRequest(urlOrOptions, optionsOrCallback, callback, protocol = "http") {
  const input = withProtocol(urlOrOptions, protocol);
  return __defaultHttpShim.request(input, optionsOrCallback, callback);
}

export function request(urlOrOptions, optionsOrCallback, callback) {
  return _createClientRequest(urlOrOptions, optionsOrCallback, callback, "http");
}

export function get(urlOrOptions, optionsOrCallback, callback) {
  const req = _createClientRequest(urlOrOptions, optionsOrCallback, callback, "http");
  req.end();
  return req;
}

export default {
  createHttpShim,
  IncomingMessage,
  ServerResponse,
  Server,
  ClientRequest,
  createServer,
  request,
  get,
  METHODS,
  STATUS_CODES,
  setServerListenCallback,
  setServerCloseCallback,
  getServer,
  getAllServers,
  Agent,
  globalAgent,
  _createClientRequest,
};
