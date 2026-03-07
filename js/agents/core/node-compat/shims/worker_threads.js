/**
 * worker_threads shim - Browser-safe compatibility layer.
 *
 * Notes:
 * - Worker threads are NOT available in this shim.
 * - MessageChannel/MessagePort/BroadcastChannel are in-memory logical channels.
 */

import { EventEmitter } from './events.js';

/** @typedef {Error & { code?: string }} WorkerThreadsShimError */

export const isMainThread = true;
export const parentPort = null;
export const workerData = null;
export const threadId = 0;

const BROADCAST_REGISTRY = new Map();
const ENV_DATA = new Map();

function createUnsupportedError(api) {
  const err = /** @type {WorkerThreadsShimError} */ (new Error(`${api} is not supported in browser worker_threads shim`));
  err.code = 'ERR_WORKER_THREADS_UNSUPPORTED';
  return err;
}

export const capabilities = Object.freeze({
  workers: false,
  messageChannels: true,
  broadcastChannels: true,
});

export function isFeatureSupported(feature) {
  return !!capabilities[feature];
}

export class Worker extends EventEmitter {
  constructor(filename, options = {}) {
    super();
    this.filename = filename;
    this.options = options;
    this.threadId = 0;
    this.resourceLimits = {};
    this.isSupported = false;
    console.warn('[worker_threads shim] Worker is not supported; use Web Worker APIs directly if needed.');
  }

  postMessage(_value, _transferList) {
    throw createUnsupportedError('Worker.postMessage');
  }

  terminate() {
    queueMicrotask(() => this.emit('exit', 0));
    return Promise.resolve(0);
  }

  ref() { return this; }
  unref() { return this; }

  getHeapSnapshot() {
    return Promise.reject(createUnsupportedError('Worker.getHeapSnapshot'));
  }
}

export class MessagePort extends EventEmitter {
  constructor() {
    super();
    this._peer = null;
    this._closed = false;
    this._started = false;
    this._queue = [];
  }

  _attachPeer(port) {
    this._peer = port;
  }

  postMessage(value, _transferList) {
    if (this._closed) {
      const err = /** @type {WorkerThreadsShimError} */ (new Error('Cannot postMessage on a closed MessagePort'));
      err.code = 'ERR_INVALID_STATE';
      throw err;
    }
    if (!this._peer || this._peer._closed) {
      return;
    }
    const payload = { data: value };
    queueMicrotask(() => {
      if (!this._peer || this._peer._closed) return;
      this._peer._queue.push(payload);
      if (this._peer._started || this._peer.listenerCount('message') > 0) {
        this._peer.emit('message', payload);
      }
    });
  }

  start() {
    if (this._closed) return this;
    this._started = true;
    while (this._queue.length > 0) {
      const payload = this._queue.shift();
      this.emit('message', payload);
    }
    return this;
  }

  close() {
    if (this._closed) return;
    this._closed = true;
    this._queue.length = 0;
    this.emit('close');
  }

  ref() { return this; }
  unref() { return this; }
}

export class MessageChannel {
  constructor() {
    this.port1 = new MessagePort();
    this.port2 = new MessagePort();
    this.port1._attachPeer(this.port2);
    this.port2._attachPeer(this.port1);
  }
}

export class BroadcastChannel extends EventEmitter {
  constructor(name) {
    super();
    if (typeof name !== 'string' || !name) {
      throw new TypeError('BroadcastChannel name must be a non-empty string');
    }
    this.name = name;
    this._closed = false;

    if (!BROADCAST_REGISTRY.has(name)) BROADCAST_REGISTRY.set(name, new Set());
    BROADCAST_REGISTRY.get(name).add(this);
  }

  postMessage(message) {
    if (this._closed) {
      const err = /** @type {WorkerThreadsShimError} */ (new Error('Cannot postMessage on a closed BroadcastChannel'));
      err.code = 'ERR_INVALID_STATE';
      throw err;
    }
    const peers = BROADCAST_REGISTRY.get(this.name);
    if (!peers) return;
    for (const channel of peers) {
      if (channel === this || channel._closed) continue;
      queueMicrotask(() => {
        if (!channel._closed) channel.emit('message', { data: message });
      });
    }
  }

  close() {
    if (this._closed) return;
    this._closed = true;
    const peers = BROADCAST_REGISTRY.get(this.name);
    if (peers) {
      peers.delete(this);
      if (peers.size === 0) BROADCAST_REGISTRY.delete(this.name);
    }
    this.emit('close');
  }

  ref() { return this; }
  unref() { return this; }
}

export function moveMessagePortToContext(port, _contextifiedSandbox) {
  return port;
}

export function receiveMessageOnPort(port) {
  if (!(port instanceof MessagePort)) return undefined;
  const payload = port._queue.shift();
  if (!payload) return undefined;
  return { message: payload.data };
}

export const SHARE_ENV = Symbol.for('nodejs.worker_threads.SHARE_ENV');

export function markAsUntransferable(_object) {}

export function getEnvironmentData(key) {
  return ENV_DATA.get(key);
}

export function setEnvironmentData(key, value) {
  ENV_DATA.set(key, value);
}

export default {
  isMainThread,
  parentPort,
  workerData,
  threadId,
  capabilities,
  isFeatureSupported,
  Worker,
  MessageChannel,
  MessagePort,
  BroadcastChannel,
  moveMessagePortToContext,
  receiveMessageOnPort,
  SHARE_ENV,
  markAsUntransferable,
  getEnvironmentData,
  setEnvironmentData,
};
