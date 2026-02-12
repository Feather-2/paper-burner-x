/**
 * async_hooks shim - Async tracking is not available in browser
 */

export class AsyncResource {
  constructor(_type, _options) {}

  runInAsyncScope(fn, thisArg, ...args) {
    return fn.apply(thisArg, args);
  }

  emitDestroy() { return this; }
  asyncId() { return 0; }
  triggerAsyncId() { return 0; }

  static bind(fn, _type) {
    return fn;
  }
}

export class AsyncLocalStorage {
  constructor() {
    this.store = undefined;
  }

  disable() {}

  getStore() {
    return this.store;
  }

  run(store, callback) {
    const prev = this.store;
    this.store = store;
    try {
      return callback();
    } finally {
      this.store = prev;
    }
  }

  exit(callback) {
    const prev = this.store;
    this.store = undefined;
    try {
      return callback();
    } finally {
      this.store = prev;
    }
  }

  enterWith(store) {
    this.store = store;
  }
}

export function createHook(_callbacks) {
  return {
    enable() { return this; },
    disable() { return this; },
  };
}

export function executionAsyncId() {
  return 0;
}

export function executionAsyncResource() {
  return {};
}

export function triggerAsyncId() {
  return 0;
}

export default {
  AsyncResource,
  AsyncLocalStorage,
  createHook,
  executionAsyncId,
  executionAsyncResource,
  triggerAsyncId,
};
