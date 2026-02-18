/**
 * VFS EventEmitter mixin — wraps any VFS instance with a Proxy that emits
 * change/delete events after successful write/unlink/rmdir/move/copy ops.
 *
 * @module vfs-events
 */

import { normalizeVfsPath } from '../../vfs/path.js';
import { createLogger } from '../../shared/utils/logger.js';

const logger = createLogger({ stage: 'vfs-events' });

/** @typedef {(path: string, data: unknown) => void} VfsChangeListener */
/** @typedef {(path: string) => void} VfsDeleteListener */
/** @typedef {object} VfsEventBridge @property {() => void} dispose */

/**
 * Method specs for simple single-path interceptions.
 * move/copy require special handling and are not listed here.
 */
const INTERCEPTED = {
  writeFile:  { event: 'change', pathIdx: 0, dataIdx: 1 },
  writeText:  { event: 'change', pathIdx: 0, dataIdx: 1 },
  appendText: { event: 'change', pathIdx: 0, dataIdx: 1 },
  unlink:     { event: 'delete', pathIdx: 0 },
  rmdir:      { event: 'delete', pathIdx: 0 },
};

/**
 * Wrap a VFS instance with event emission.
 * The original VFS is never mutated.
 *
 * @param {object} vfs - Any object implementing the VFS interface.
 * @returns {object} Proxy-wrapped VFS with on/off/once/removeAllListeners.
 */
export function withVfsEvents(vfs) {
  /** @type {Map<string, Set<Function>>} */
  const listeners = new Map();

  function getSet(event) {
    let s = listeners.get(event);
    if (!s) { s = new Set(); listeners.set(event, s); }
    return s;
  }

  function emit(event, ...args) {
    const s = listeners.get(event);
    if (!s) return;
    for (const fn of s) {
      try { fn(...args); } catch (err) { logger.error('VFS event listener error', { error: err }); }
    }
  }

  const proxy = new Proxy(vfs, {
    get(target, prop, _receiver) {
      if (prop === 'on') return (event, listener) => {
        getSet(event).add(listener);
        return proxy;
      };
      if (prop === 'off') return (event, listener) => {
        listeners.get(event)?.delete(listener);
        return proxy;
      };
      if (prop === 'once') return (event, listener) => {
        const wrapper = (...a) => { listeners.get(event)?.delete(wrapper); listener(...a); };
        getSet(event).add(wrapper);
        return proxy;
      };
      if (prop === 'removeAllListeners') return (event) => {
        if (event) listeners.delete(event); else listeners.clear();
        return proxy;
      };

      const spec = INTERCEPTED[prop];
      if (spec) {
        return async (...args) => {
          const result = await target[prop](...args);
          const p = normalizeVfsPath(args[spec.pathIdx]);
          if (spec.event === 'change') emit('change', p, args[spec.dataIdx]);
          else emit('delete', p);
          return result;
        };
      }

      if (prop === 'move') {
        return async (src, dest) => {
          const result = await target.move(src, dest);
          const srcP = normalizeVfsPath(src);
          const destP = normalizeVfsPath(dest);
          let data;
          try { data = await target.readFile(destP); } catch (_) { data = undefined; }
          emit('delete', srcP);
          emit('change', destP, data);
          return result;
        };
      }

      if (prop === 'copy') {
        return async (src, dest) => {
          const result = await target.copy(src, dest);
          const destP = normalizeVfsPath(dest);
          let data;
          try { data = await target.readFile(destP); } catch (_) { data = undefined; }
          emit('change', destP, data);
          return result;
        };
      }

      const val = target[prop];
      return typeof val === 'function' ? val.bind(target) : val;
    },
  });

  return proxy;
}

/**
 * Bridge change/delete events from an event-enabled VFS to a target VFS.
 *
 * @param {object} eventVfs - VFS wrapped by withVfsEvents (must have .on).
 * @param {object} target   - Destination VFS to replicate writes/deletes into.
 * @returns {VfsEventBridge} Object with dispose() to detach listeners.
 */
export function createVfsEventBridge(eventVfs, target) {
  const toBytes = (data) => {
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) {
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
    if (typeof data === 'string') {
      if (typeof TextEncoder === 'function') return new TextEncoder().encode(data);
      return null;
    }
    if (data == null) return null;
    try {
      const json = JSON.stringify(data);
      if (typeof json === 'string') {
        return typeof TextEncoder === 'function' ? new TextEncoder().encode(json) : null;
      }
    } catch {
      return null;
    }
    return null;
  };

  const onChange = async (path, data) => {
    try {
      if (typeof data === 'string' && typeof target.writeText === 'function') {
        await target.writeText(path, data);
        return;
      }

      const bytes = toBytes(data) || (typeof eventVfs.readFile === 'function'
        ? await eventVfs.readFile(path).catch(() => null)
        : null);
      if (bytes) {
        await target.writeFile(path, bytes);
        return;
      }

      await target.writeFile(path, data);
    } catch (err) {
      logger.error('VFS bridge change error', { error: err });
    }
  };

  const onDelete = async (path) => {
    const attempts = [
      async () => { if (typeof target.unlink === 'function') await target.unlink(path); },
      async () => { if (typeof target.rmdir === 'function') await target.rmdir(path, { recursive: true }); },
      async () => { if (typeof target.rm === 'function') await target.rm(path, { recursive: true, force: true }); },
      async () => { if (typeof target.remove === 'function') await target.remove(path); },
    ];

    for (const attempt of attempts) {
      try {
        await attempt();
        if (typeof target.exists === 'function') {
          const exists = await target.exists(path);
          if (!exists) return;
          continue;
        }
        return;
      } catch {
        // try next strategy
      }
    }

    logger.error('VFS bridge delete error', { error: new Error(`Failed to delete ${path}`) });
  };

  eventVfs.on('change', onChange);
  eventVfs.on('delete', onDelete);

  return {
    dispose() {
      eventVfs.off('change', onChange);
      eventVfs.off('delete', onDelete);
    },
  };
}
