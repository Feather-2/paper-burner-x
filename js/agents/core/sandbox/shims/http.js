/**
 * @fileoverview Node.js `http` module shim for browser sandbox.
 */

import { EventEmitter } from './events.js';
import { Readable, Writable } from './stream.js';
import { Buffer } from './buffer.js';
import { Socket } from './net.js';

let _serverListenCallback = null;
let _serverCloseCallback = null;
let _servers = new Map();

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

export function request() {
  throw new Error('http.request not supported in browser sandbox');
}

export function get() {
  throw new Error('http.get not supported in browser sandbox');
}

export const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];

export const STATUS_CODES = {
  200: 'OK', 201: 'Created', 204: 'No Content',
  301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified',
  400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found',
  500: 'Internal Server Error',
};

export default {
  IncomingMessage, ServerResponse, Server, createServer,
  request, get, METHODS, STATUS_CODES,
  setServerListenCallback, setServerCloseCallback, getServer,
};
