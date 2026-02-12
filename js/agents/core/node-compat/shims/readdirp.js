/**
 * readdirp shim - Simplified recursive directory reader
 * Provides basic API surface for compatibility
 */

export function setVFS(_vfs) {}

class ReaddirpStream {
  constructor(_root, _options) {
    this.entries = [];
  }

  async *[Symbol.asyncIterator]() {
    for (const entry of this.entries) {
      yield entry;
    }
  }

  async toArray() {
    return [...this.entries];
  }

  on(event, callback) {
    if (event === 'data') {
      setTimeout(() => {
        for (const entry of this.entries) {
          callback(entry);
        }
        this.emit('end');
      }, 0);
    }
    return this;
  }

  emit(event, ...args) {
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const handler of handlers) {
        handler(...args);
      }
    }
  }

  listeners = new Map();

  once(event, callback) {
    const wrapper = (...args) => {
      callback(...args);
      this.off(event, wrapper);
    };
    return this.on(event, wrapper);
  }

  off(event, callback) {
    const handlers = this.listeners.get(event);
    if (handlers) {
      const index = handlers.indexOf(callback);
      if (index !== -1) {
        handlers.splice(index, 1);
      }
    }
    return this;
  }
}

export function readdirp(_root, _options) {
  return new ReaddirpStream(_root, _options);
}

export async function readdirpPromise(_root, _options) {
  const stream = new ReaddirpStream(_root, _options);
  return stream.toArray();
}

export default readdirp;
export { ReaddirpStream };
