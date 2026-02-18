/**
 * dgram shim - UDP sockets are not available in browser
 */

import { EventEmitter } from './events.js';

function messageToBytes(msg) {
  if (Array.isArray(msg)) {
    const parts = msg.map(part => messageToBytes(part));
    const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
    const merged = new Uint8Array(total);
    let cursor = 0;
    for (const part of parts) {
      merged.set(part, cursor);
      cursor += part.byteLength;
    }
    return merged;
  }
  if (typeof msg === 'string') return new TextEncoder().encode(msg);
  if (msg instanceof Uint8Array) return msg;
  if (ArrayBuffer.isView(msg)) return new Uint8Array(msg.buffer, msg.byteOffset, msg.byteLength);
  if (msg instanceof ArrayBuffer) return new Uint8Array(msg);
  return new TextEncoder().encode(String(msg ?? ''));
}

export class Socket extends EventEmitter {
  bind(_port, _address, _callback) {
    if (_callback) setTimeout(_callback, 0);
    return this;
  }

  close(_callback) {
    if (_callback) setTimeout(_callback, 0);
  }

  send(msg, offsetOrPort, lengthOrAddress, portOrCallback, addressOrCallback, callback) {
    let offset = 0;
    let length;
    let cb = null;

    if (
      Number.isFinite(offsetOrPort) &&
      Number.isFinite(lengthOrAddress) &&
      Number.isFinite(portOrCallback)
    ) {
      offset = Number(offsetOrPort);
      length = Number(lengthOrAddress);
      cb = typeof addressOrCallback === 'function' ? addressOrCallback : callback;
    } else {
      cb = typeof portOrCallback === 'function'
        ? portOrCallback
        : (typeof addressOrCallback === 'function' ? addressOrCallback : callback);
    }

    const bytes = messageToBytes(msg);
    const start = Number.isFinite(offset) ? Math.max(0, Math.floor(offset)) : 0;
    const effectiveLength = Number.isFinite(length)
      ? Math.max(0, Math.floor(length))
      : Math.max(0, bytes.byteLength - start);
    const sentBytes = Math.max(0, Math.min(effectiveLength, bytes.byteLength - start));

    if (typeof cb === 'function') {
      setTimeout(() => cb(null, sentBytes), 0);
    }
  }

  address() {
    return { address: '0.0.0.0', family: 'IPv4', port: 0 };
  }

  setBroadcast(_flag) {}
  setTTL(_ttl) { return _ttl; }
  setMulticastTTL(_ttl) { return _ttl; }
  setMulticastLoopback(_flag) { return _flag; }
  setMulticastInterface(_multicastInterface) {}
  addMembership(_multicastAddress, _multicastInterface) {}
  dropMembership(_multicastAddress, _multicastInterface) {}
  ref() { return this; }
  unref() { return this; }
  setRecvBufferSize(_size) {}
  setSendBufferSize(_size) {}
  getRecvBufferSize() { return 0; }
  getSendBufferSize() { return 0; }
}

export function createSocket(_type, _callback) {
  return new Socket();
}

export default {
  Socket,
  createSocket,
};
