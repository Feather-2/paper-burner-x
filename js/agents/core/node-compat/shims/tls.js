/**
 * tls shim - TLS/SSL is not available in browser
 * Provides stubs that allow code to load without crashing
 */

import { EventEmitter } from './events.js';

export class TLSSocket extends EventEmitter {
  constructor(_socket, _options) {
    super();
    this.authorized = false;
    this.encrypted = true;
  }

  getPeerCertificate(_detailed) {
    return {};
  }

  getCipher() {
    return null;
  }

  getProtocol() {
    return null;
  }

  setServername(_name) {}

  renegotiate(_options, _callback) {
    return false;
  }
}

export class Server extends EventEmitter {
  constructor(_options, _connectionListener) {
    super();
  }

  listen(..._args) {
    return this;
  }

  close(_callback) {
    return this;
  }

  address() {
    return null;
  }

  getTicketKeys() {
    return new Uint8Array(0);
  }

  setTicketKeys(_keys) {}

  setSecureContext(_options) {}
}

export function createServer(_options, _connectionListener) {
  return new Server(_options, _connectionListener);
}

export function connect(_options, _callback) {
  const socket = new TLSSocket();
  if (_callback) {
    setTimeout(_callback, 0);
  }
  return socket;
}

export const createSecureContext = (_options) => ({});

export const getCiphers = () => ['TLS_AES_256_GCM_SHA384', 'TLS_AES_128_GCM_SHA256'];

export const DEFAULT_ECDH_CURVE = 'auto';
export const DEFAULT_MAX_VERSION = 'TLSv1.3';
export const DEFAULT_MIN_VERSION = 'TLSv1.2';

export const rootCertificates = [];

export default {
  TLSSocket,
  Server,
  createServer,
  connect,
  createSecureContext,
  getCiphers,
  DEFAULT_ECDH_CURVE,
  DEFAULT_MAX_VERSION,
  DEFAULT_MIN_VERSION,
  rootCertificates,
};
