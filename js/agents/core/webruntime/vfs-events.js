/**
 * VFS EventEmitter mixin — wraps any VFS instance with a Proxy that emits
 * change/delete events after successful write/unlink/rmdir/move/copy ops.
 *
 * @module vfs-events
 */

import { normalizeVfsPath } from '../../vfs/path.js';

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
      try { fn(...args); } catch (err) { console.error('VFS event listener error:', err); }
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
  const onChange = async (path, data) => {
    try { await target.writeFile(path, data); }
    catch (err) { console.error('VFS bridge change error:', err); }
  };
  const onDelete = async (path) => {
    try { await target.unlink(path); }
    catch (_) {
      try { await target.rmdir(path); }
      catch (err) { console.error('VFS bridge delete error:', err); }
    }
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
