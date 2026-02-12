/**
 * http2 shim - HTTP/2 is not available in browser
 */

import { EventEmitter } from './events.js';

export class Http2Session extends EventEmitter {
  close(_callback) {
    if (_callback) setTimeout(_callback, 0);
  }
  destroy(_error, _code) {}
  get destroyed() { return false; }
  get encrypted() { return false; }
  get closed() { return false; }
  ping(_callback) {
    return false;
  }
  ref() {}
  unref() {}
  setTimeout(_msecs, _callback) {}
}

export class ClientHttp2Session extends Http2Session {}
export class ServerHttp2Session extends Http2Session {}

export class Http2Stream extends EventEmitter {
  close(_code, _callback) {}
  get id() { return 0; }
  get pending() { return false; }
  get destroyed() { return false; }
  get closed() { return false; }
  priority(_options) {}
  setTimeout(_msecs, _callback) {}
  end(_data, _encoding, _callback) {}
}

export class Http2ServerRequest extends EventEmitter {}
export class Http2ServerResponse extends EventEmitter {
  writeHead(_statusCode, _headers) { return this; }
  end(_data) {}
}

export function createServer(_options, _onRequestHandler) {
  return new EventEmitter();
}

export function createSecureServer(_options, _onRequestHandler) {
  return new EventEmitter();
}

export function connect(_authority, _options, _listener) {
  return new ClientHttp2Session();
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
  return Buffer.from('');
}

export function getUnpackedSettings(_buf) {
  return {};
}

export const sensitiveHeaders = Symbol('sensitiveHeaders');

export default {
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
