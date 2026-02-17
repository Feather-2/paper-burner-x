/**
 * @file Comlink-style Worker RPC layer (zero dependencies).
 * Main-thread side: wrapWorker() returns async proxy.
 * Worker side: exposeApi() registers handlers.
 */

/** @typedef {object} WorkerApi
 * @property {(code: string, filename?: string) => Promise<*>} execute
 * @property {(path: string) => Promise<*>} runFile
 * @property {() => void} clearCache */

/** @typedef {object} ComlinkWorkerConfig
 * @property {Worker|object} worker
 * @property {number} [timeout=30000]
 * @property {(method: string, args: unknown[]) => void} [onConsole] */

const MSG_CALL = 'comlink:call';
const MSG_RETURN = 'comlink:return';
const MSG_CONSOLE = 'comlink:console';

/**
 * Wrap a Worker with an async RPC proxy.
 * @param {ComlinkWorkerConfig} config
 * @returns {WorkerApi & { terminate: () => void, terminated: boolean }}
 */
export function wrapWorker(config) {
  const { worker, timeout = 30000, onConsole } = config;
  let terminated = false;
  let nextId = 1;
  const pending = new Map();

  function onMessage(e) {
    const d = e.data;
    if (!d) return;
    if (d.type === MSG_RETURN) {
      const p = pending.get(d.id);
      if (!p) return;
      clearTimeout(p.timer);
      pending.delete(d.id);
      if (d.ok) p.resolve(d.value);
      else p.reject(new Error(d.error || 'Worker call failed'));
    }
    if (d.type === MSG_CONSOLE && onConsole) {
      onConsole(d.method, d.args);
    }
  }
  worker.addEventListener('message', onMessage);

  function call(method, args) {
    if (terminated) {
      const p = Promise.reject(new Error('Worker terminated'));
      p.catch(() => {}); // prevent unhandled rejection
      return p;
    }
    const id = nextId++;
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Worker call timeout: ${method}`));
      }, timeout);
      pending.set(id, { resolve, reject, timer });
      worker.postMessage({ type: MSG_CALL, id, method, args });
    });
    // No-op catch prevents unhandled rejection when terminate() rejects pending calls.
    promise.catch(() => {});
    return promise;
  }

  return {
    execute: (code, filename) => call('execute', [code, filename]),
    runFile: (path) => call('runFile', [path]),
    clearCache: () => call('clearCache', []),
    terminate() {
      if (terminated) return;
      terminated = true;
      worker.removeEventListener('message', onMessage);
      for (const [, p] of pending) {
        clearTimeout(p.timer);
        p.reject(new Error('Worker terminated'));
      }
      pending.clear();
      if (typeof worker.terminate === 'function') worker.terminate();
    },
    get terminated() { return terminated; },
  };
}

/**
 * Expose API on the Worker side.
 * @param {Record<string, Function>} api
 * @param {object} [self=globalThis]
 */
export function exposeApi(api, self = globalThis) {
  self.addEventListener('message', async (e) => {
    const d = e.data;
    if (!d || d.type !== MSG_CALL) return;
    const { id, method, args } = d;
    if (!Object.hasOwn(api, method) || typeof api[method] !== 'function') {
      self.postMessage({ type: MSG_RETURN, id, ok: false, error: `Unknown method: ${method}` });
      return;
    }
    const fn = api[method];
    try {
      const value = await fn(...(args || []));
      self.postMessage({ type: MSG_RETURN, id, ok: true, value });
    } catch (err) {
      self.postMessage({ type: MSG_RETURN, id, ok: false, error: err.message });
    }
  });
}

export { MSG_CALL, MSG_RETURN, MSG_CONSOLE };
