/**
 * dgram shim - UDP sockets are not available in browser
 */

import { EventEmitter } from './events.js';

export class Socket extends EventEmitter {
  bind(_port, _address, _callback) {
    if (_callback) setTimeout(_callback, 0);
    return this;
  }

  close(_callback) {
    if (_callback) setTimeout(_callback, 0);
  }

  send(_msg, _offset, _length, _port, _address, _callback) {
    if (_callback) setTimeout(() => _callback(null, 0), 0);
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
