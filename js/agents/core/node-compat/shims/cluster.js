/**
 * cluster shim - Clustering is not available in browser
 */

import { EventEmitter } from './events.js';

export const isMaster = true;
export const isPrimary = true;
export const isWorker = false;

export class Worker extends EventEmitter {
  constructor() {
    super();
    this.id = 0;
    this.process = null;
  }

  send(_message, _callback) {
    return false;
  }

  kill(_signal) {}
  disconnect() {}
  isDead() { return false; }
  isConnected() { return false; }
}

export const worker = null;
export const workers = {};

export function fork(_env) {
  return new Worker();
}

export function disconnect(_callback) {
  if (_callback) setTimeout(_callback, 0);
}

export const settings = {};
export const SCHED_NONE = 1;
export const SCHED_RR = 2;
export const schedulingPolicy = SCHED_RR;

export function setupMaster(_settings) {}
export function setupPrimary(_settings) {}

const clusterEmitter = new EventEmitter();
export const on = clusterEmitter.on.bind(clusterEmitter);
export const once = clusterEmitter.once.bind(clusterEmitter);
export const emit = clusterEmitter.emit.bind(clusterEmitter);
export const removeListener = clusterEmitter.removeListener.bind(clusterEmitter);

export default {
  isMaster,
  isPrimary,
  isWorker,
  Worker,
  worker,
  workers,
  fork,
  disconnect,
  settings,
  SCHED_NONE,
  SCHED_RR,
  schedulingPolicy,
  setupMaster,
  setupPrimary,
  on,
  once,
  emit,
  removeListener,
};
