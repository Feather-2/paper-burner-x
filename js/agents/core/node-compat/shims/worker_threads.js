/**
 * worker_threads shim - Worker threads API
 * Stub implementation for browser environment
 */

import { EventEmitter } from './events.js';

export const isMainThread = true;
export const parentPort = null;
export const workerData = null;
export const threadId = 0;

export class Worker extends EventEmitter {
  constructor(filename, options) {
    super();
    this.threadId = 0;
    this.resourceLimits = {};
    console.warn('Worker threads are not fully supported in browser environment');
  }

  postMessage(value, transferList) {}

  terminate() {
    return Promise.resolve(0);
  }

  ref() {}
  unref() {}

  getHeapSnapshot() {
    return Promise.resolve({});
  }
}

export class MessageChannel {
  constructor() {
    this.port1 = new MessagePort();
    this.port2 = new MessagePort();
  }
}

export class MessagePort extends EventEmitter {
  postMessage(value, transferList) {}
  start() {}
  close() {}
  ref() {}
  unref() {}
}

export class BroadcastChannel extends EventEmitter {
  constructor(name) {
    super();
    this.name = name;
  }

  postMessage(message) {}
  close() {}
  ref() {}
  unref() {}
}

export function moveMessagePortToContext(port, contextifiedSandbox) {
  return port;
}

export function receiveMessageOnPort(port) {
  return undefined;
}

export const SHARE_ENV = Symbol.for('nodejs.worker_threads.SHARE_ENV');

export function markAsUntransferable(object) {}

export function getEnvironmentData(key) {
  return undefined;
}

export function setEnvironmentData(key, value) {}

export default {
  isMainThread,
  parentPort,
  workerData,
  threadId,
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
