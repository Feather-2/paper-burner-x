// 浏览器兼容的 EventEmitter 简易实现
export class ModelEventEmitter {
  constructor() {
    this._events = new Map();
  }

  on(event, listener) {
    if (!this._events.has(event)) this._events.set(event, []);
    this._events.get(event).push(listener);
    return this;
  }

  off(event, listener) {
    const listeners = this._events.get(event);
    if (listeners) {
      const idx = listeners.indexOf(listener);
      if (idx !== -1) listeners.splice(idx, 1);
    }
    return this;
  }

  emit(event, ...args) {
    const listeners = this._events.get(event);
    if (listeners) for (const fn of [...listeners]) fn(...args);
    return listeners?.length > 0;
  }

  removeAllListeners(event) {
    if (event) this._events.delete(event);
    else this._events.clear();
    return this;
  }
}
