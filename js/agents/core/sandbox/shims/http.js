/**
 * @fileoverview Node.js `http` module shim for browser sandbox.
 * Includes fetch-based ClientRequest for http.request()/http.get().
 */

import { EventEmitter } from './events.js';
import { Readable, Writable } from './stream.js';
import { Buffer } from './buffer.js';
import { Socket } from './net.js';

let _serverListenCallback = null;
let _serverCloseCallback = null;
let _servers = new Map();

/**
 * Network policy for outbound request filtering.
 * @type {{ allowedDomains?: string[], deniedDomains?: string[], onViolation?: (info: object) => void } | null}
 */
let _networkPolicy = null;

/**
 * Set the network policy for outbound requests.
 * @param {{ allowedDomains?: string[], deniedDomains?: string[], onViolation?: (info: object) => void } | null} policy
 */
export function setNetworkPolicy(policy) { _networkPolicy = policy; }

/**
 * Check if a hostname matches a domain pattern (supports *.example.com wildcards).
 * @param {string} hostname
 * @param {string} pattern
 * @returns {boolean}
 */
function matchesDomainPattern(hostname, pattern) {
  if (pattern.startsWith('*.')) {
    return hostname.toLowerCase().endsWith('.' + pattern.slice(2).toLowerCase());
  }
  return hostname.toLowerCase() === pattern.toLowerCase();
}

/**
 * Check if a URL is allowed by the current network policy.
 * @param {string} url
 * @returns {boolean}
 */
function isRequestAllowed(url) {
  if (!_networkPolicy) return true;
  let hostname;
  try { hostname = new URL(url).hostname; } catch { return false; }

  // Deny list takes precedence
  if (_networkPolicy.deniedDomains) {
    for (const pattern of _networkPolicy.deniedDomains) {
      if (matchesDomainPattern(hostname, pattern)) return false;
    }
  }

  // If allowedDomains is set, only those domains are permitted
  if (_networkPolicy.allowedDomains) {
    for (const pattern of _networkPolicy.allowedDomains) {
      if (matchesDomainPattern(hostname, pattern)) return true;
    }
    return false; // Not in allowlist
  }

  return true; // No allowlist = allow all (minus deny list)
}

export function setServerListenCallback(cb) { _serverListenCallback = cb; }
export function setServerCloseCallback(cb) { _serverCloseCallback = cb; }
export function getServer(port) { return _servers.get(port); }

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

/**
 * Fetch-based ClientRequest for http.request()/http.get().
 * Accumulates body via write(), fires fetch on end().
 */
export class ClientRequest extends Writable {
  constructor(options, callback) {
    super();
    this._options = typeof options === 'string' ? new URL(options) : options;
    this._body = [];
    this._headers = {};
    this._method = this._options.method || 'GET';
    this._aborted = false;
    this._timeout = null;

    // Build URL
    if (this._options instanceof URL) {
      this._url = this._options.href;
    } else {
      const protocol = this._options.protocol || 'http:';
      const host = this._options.hostname || this._options.host || 'localhost';
      const port = this._options.port ? ':' + this._options.port : '';
      const path = this._options.path || '/';
      this._url = `${protocol}//${host}${port}${path}`;
    }

    // Copy headers
    if (this._options.headers) {
      for (const [k, v] of Object.entries(this._options.headers)) {
        this._headers[k.toLowerCase()] = v;
      }
    }

    if (callback) this.once('response', callback);
  }

  setHeader(name, value) {
    this._headers[name.toLowerCase()] = value;
    return this;
  }

  getHeader(name) {
    return this._headers[name.toLowerCase()];
  }

  removeHeader(name) {
    delete this._headers[name.toLowerCase()];
  }

  setTimeout(ms, cb) {
    this._timeout = ms;
    if (cb) this.once('timeout', cb);
    return this;
  }

  abort() {
    this._aborted = true;
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
      (resp) => { if (cb) cb(); this.emit('response', resp); },
      (err) => this.emit('error', err)
    );
    return this;
  }

  /** @private */
  async _doFetch() {
    if (this._aborted) throw new Error('Request aborted');

    // Network policy check
    if (!isRequestAllowed(this._url)) {
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
    fetchOptions.signal = controller.signal;

    let timer;
    if (this._timeout) {
      timer = setTimeout(() => {
        controller.abort();
        this.emit('timeout');
      }, this._timeout);
    }

    try {
      const fetchResp = await fetch(this._url, fetchOptions);
      if (timer) clearTimeout(timer);

      const msg = IncomingMessage.fromFetchResponse(fetchResp);

      // Stream the body if available
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
        // Fallback: read entire body
        const buf = await fetchResp.arrayBuffer();
        msg.push(Buffer.from(new Uint8Array(buf)));
        msg.push(null);
        msg.complete = true;
      }

      return msg;
    } catch (err) {
      if (timer) clearTimeout(timer);
      throw err;
    }
  }
}

export class Server extends EventEmitter {
  constructor(options, requestListener) {
    super();
    this._listening = false;
    this._address = null;
    const listener = typeof options === 'function' ? options : requestListener;
    if (listener) this.on('request', listener);
  }

  listen(port, host, backlog, cb) {
    if (typeof host === 'function') { cb = host; host = '0.0.0.0'; }
    if (typeof backlog === 'function') { cb = backlog; }
    this._address = { port: port || 3000, address: host || '0.0.0.0', family: 'IPv4' };
    this._listening = true;
    _servers.set(port, this);
    if (_serverListenCallback) _serverListenCallback(port, this);
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

export function createServer(options, requestListener) {
  return new Server(options, requestListener);
}

/**
 * Make an HTTP request using fetch under the hood.
 * @param {string|URL|object} urlOrOptions
 * @param {object|Function} [optionsOrCallback]
 * @param {Function} [callback]
 * @returns {ClientRequest}
 */
export function request(urlOrOptions, optionsOrCallback, callback) {
  let options, cb;
  if (typeof urlOrOptions === 'string' || urlOrOptions instanceof URL) {
    const parsed = typeof urlOrOptions === 'string' ? new URL(urlOrOptions) : urlOrOptions;
    if (typeof optionsOrCallback === 'function') {
      cb = optionsOrCallback;
      options = parsed;
    } else {
      options = { ...optionsOrCallback, hostname: parsed.hostname, port: parsed.port, path: parsed.pathname + parsed.search, protocol: parsed.protocol };
      cb = callback;
    }
  } else {
    options = urlOrOptions;
    cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
  }
  return new ClientRequest(options, cb);
}

/**
 * Convenience shorthand that calls request() and ends it immediately.
 * @param {string|URL|object} urlOrOptions
 * @param {object|Function} [optionsOrCallback]
 * @param {Function} [callback]
 * @returns {ClientRequest}
 */
export function get(urlOrOptions, optionsOrCallback, callback) {
  const req = request(urlOrOptions, optionsOrCallback, callback);
  req.end();
  return req;
}

export const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];

export const STATUS_CODES = {
  200: 'OK', 201: 'Created', 204: 'No Content',
  301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified',
  400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found',
  500: 'Internal Server Error',
};

export default {
  IncomingMessage, ServerResponse, Server, ClientRequest, createServer,
  request, get, METHODS, STATUS_CODES,
  setServerListenCallback, setServerCloseCallback, getServer,
  setNetworkPolicy,
};
