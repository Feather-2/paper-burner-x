/**
 * http2 shim - HTTP/2 transport is not available in browser runtimes.
 * This module exposes API-compatible stubs with explicit capability flags.
 */

import { EventEmitter } from './events.js';

/**
 * @typedef {Error & { code?: string }} Http2ShimError
 * @typedef {EventEmitter & {
 *   isStub?: boolean,
 *   supported?: boolean,
 *   listen?: (...args: unknown[]) => unknown,
 *   close?: (callback?: Function) => unknown
 * }} UnsupportedServer
 */

function createUnsupportedError(api) {
  const err = /** @type {Http2ShimError} */ (new Error(`[http2 shim] ${api} is not supported in browser runtime`));
  err.code = 'ERR_HTTP2_UNSUPPORTED';
  return err;
}

export const HTTP2_SHIM_CAPABILITIES = Object.freeze({
  clientSession: false,
  serverSession: false,
  stream: false,
  server: false,
  secureServer: false,
});

export function isHttp2Supported() {
  return false;
}

export class Http2Session extends EventEmitter {
  constructor() {
    super();
    this._destroyed = false;
    this._closed = false;
    this.isStub = true;
    this.supported = false;
  }

  close(callback) {
    this._closed = true;
    queueMicrotask(() => {
      this.emit('close');
      if (typeof callback === 'function') callback();
    });
  }

  destroy(error, _code) {
    this._destroyed = true;
    this._closed = true;
    if (error && this.listenerCount('error') > 0) this.emit('error', error);
    this.emit('close');
  }

  get destroyed() { return this._destroyed; }
  get encrypted() { return false; }
  get closed() { return this._closed; }

  ping(callback) {
    const err = createUnsupportedError('Http2Session.ping');
    if (typeof callback === 'function') queueMicrotask(() => callback(err));
    return false;
  }

  ref() { return this; }
  unref() { return this; }

  setTimeout(_msecs, callback) {
    if (typeof callback === 'function') this.once('timeout', callback);
    return this;
  }
}

export class ClientHttp2Session extends Http2Session {}
export class ServerHttp2Session extends Http2Session {}

export class Http2Stream extends EventEmitter {
  constructor() {
    super();
    this._destroyed = false;
    this._closed = false;
    this.isStub = true;
    this.supported = false;
  }

  close(_code, callback) {
    this._closed = true;
    queueMicrotask(() => {
      this.emit('close');
      if (typeof callback === 'function') callback();
    });
  }

  get id() { return 0; }
  get pending() { return false; }
  get destroyed() { return this._destroyed; }
  get closed() { return this._closed; }
  priority(_options) { return this; }
  setTimeout(_msecs, callback) {
    if (typeof callback === 'function') this.once('timeout', callback);
    return this;
  }

  end(_data, _encoding, callback) {
    this._closed = true;
    queueMicrotask(() => {
      this.emit('finish');
      if (typeof callback === 'function') callback();
    });
    return this;
  }
}

export class Http2ServerRequest extends EventEmitter {
  constructor() {
    super();
    this.isStub = true;
  }
}

export class Http2ServerResponse extends EventEmitter {
  constructor() {
    super();
    this.isStub = true;
  }

  writeHead(_statusCode, _headers) { return this; }
  end(_data) {
    this.emit('finish');
  }
}

function createUnsupportedServer(kind) {
  const server = /** @type {UnsupportedServer} */ (new EventEmitter());
  server.isStub = true;
  server.supported = false;
  server.listen = function listen(...args) {
    const cb = args.find((arg) => typeof arg === 'function');
    const err = createUnsupportedError(`${kind}.listen`);
    queueMicrotask(() => {
      this.emit('error', err);
      if (cb) cb(err);
    });
    return this;
  };
  server.close = function close(callback) {
    queueMicrotask(() => {
      this.emit('close');
      if (typeof callback === 'function') callback();
    });
    return this;
  };
  return server;
}

export function createServer(_options, _onRequestHandler) {
  return createUnsupportedServer('http2.createServer');
}

export function createSecureServer(_options, _onRequestHandler) {
  return createUnsupportedServer('http2.createSecureServer');
}

export function connect(_authority, _options, listener) {
  const session = new ClientHttp2Session();
  if (typeof listener === 'function') {
    queueMicrotask(() => listener(session, createUnsupportedError('http2.connect')));
  }
  return session;
}

export const constants = {
  NGHTTP2_SESSION_SERVER: 0,
  NGHTTP2_SESSION_CLIENT: 1,
  HTTP2_HEADER_STATUS: ':status',
  HTTP2_HEADER_METHOD: ':method',
  HTTP2_HEADER_AUTHORITY: ':authority',
  HTTP2_HEADER_SCHEME: ':scheme',
  HTTP2_HEADER_PATH: ':path',
  HTTP_STATUS_OK: 200,
  HTTP_STATUS_NOT_FOUND: 404,
};

export function getDefaultSettings() {
  return {};
}

export function getPackedSettings(_settings) {
  return new Uint8Array(0);
}

export function getUnpackedSettings(_buf) {
  return {};
}

export const sensitiveHeaders = Symbol('sensitiveHeaders');

export default {
  HTTP2_SHIM_CAPABILITIES,
  isHttp2Supported,
  Http2Session,
  ClientHttp2Session,
  ServerHttp2Session,
  Http2Stream,
  Http2ServerRequest,
  Http2ServerResponse,
  createServer,
  createSecureServer,
  connect,
  constants,
  getDefaultSettings,
  getPackedSettings,
  getUnpackedSettings,
  sensitiveHeaders,
};
