/**
 * @file Comlink-style Worker RPC layer (zero dependencies).
 * Main-thread side: wrapWorker() returns async proxy.
 * Worker side: exposeApi() registers handlers.
 */

/** @typedef {object} WorkerApi
 * @property {(code: string, filename?: string) => Promise<*>} execute
 * @property {(path: string) => Promise<*>} runFile
 * @property {() => Promise<*>} clearCache */

/** @typedef {object} ComlinkWorkerConfig
 * @property {Worker|object} worker
 * @property {number} [timeout=30000]
 * @property {Record<string, number>} [methodTimeouts]
 * @property {(method: string, args: unknown[]) => void} [onConsole] */

const MSG_CALL = 'comlink:call';
const MSG_RETURN = 'comlink:return';
const MSG_CONSOLE = 'comlink:console';

/**
 * @param {any} value
 * @param {string} fallback
 * @returns {string}
 */
function toErrorMessage(value, fallback) {
  if (value instanceof Error && typeof value.message === 'string' && value.message) {
    return value.message;
  }
  if (typeof value === 'string' && value) return value;
  if (value && typeof value.message === 'string' && value.message) return value.message;
  try {
    const text = String(value);
    if (text && text !== '[object Object]') return text;
  } catch {
    // ignore
  }
  return fallback;
}

/**
 * Wrap a Worker with an async RPC proxy.
 * @param {ComlinkWorkerConfig} config
 * @returns {WorkerApi & { terminate: () => void, terminated: boolean }}
 */
export function wrapWorker(config) {
  const { worker, timeout = 30000, methodTimeouts = {}, onConsole } = config;
  let terminated = false;
  let nextId = 1;
  const pending = new Map();

  function rejectPending(reason) {
    for (const [, p] of pending) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
    }
    pending.clear();
  }

  function detachListeners() {
    worker.removeEventListener('message', onMessage);
    worker.removeEventListener('error', onError);
    worker.removeEventListener('exit', onExit);
  }

  function failWorker(reason) {
    if (terminated) return;
    terminated = true;
    detachListeners();
    rejectPending(reason);
  }

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

  function onError(e) {
    const errorLike = e?.error ?? e?.message ?? e;
    const fallback = typeof e?.message === 'string' && e.message ? e.message : 'Worker error';
    failWorker(toErrorMessage(errorLike, fallback));
  }

  function onExit(e) {
    const rawCode = e?.code;
    const parsedCode = typeof rawCode === 'number' ? rawCode : Number(rawCode);
    const code = Number.isFinite(parsedCode) ? parsedCode : 0;
    if (code === 0 && pending.size === 0) {
      if (terminated) return;
      terminated = true;
      detachListeners();
      return;
    }
    failWorker(`Worker exited with code ${code}`);
  }

  worker.addEventListener('message', onMessage);
  worker.addEventListener('error', onError);
  worker.addEventListener('exit', onExit);

  function call(method, args) {
    if (terminated) {
      const p = Promise.reject(new Error('Worker terminated'));
      p.catch(() => {}); // prevent unhandled rejection
      return p;
    }
    const methodTimeout = Number.isFinite(methodTimeouts?.[method])
      ? Math.max(1, Number(methodTimeouts[method]))
      : timeout;

    const id = nextId++;
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Worker call timeout: ${method}`));
      }, methodTimeout);
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
      detachListeners();
      rejectPending('Worker terminated');
      if (typeof worker.terminate === 'function') worker.terminate();
    },
    get terminated() { return terminated; },
  };
}

/**
 * Expose API on the Worker side.
 * @param {Record<string, Function>} api
 * @param {object} [self=globalThis]
 * @returns {() => void} dispose listener
 */
export function exposeApi(api, self = globalThis) {
  const messageHandler = async (e) => {
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
      const errorMessage = err instanceof Error ? err.message : String(err);
      self.postMessage({ type: MSG_RETURN, id, ok: false, error: errorMessage });
    }
  };

  self.addEventListener('message', messageHandler);
  return () => {
    self.removeEventListener?.('message', messageHandler);
  };
}

export { MSG_CALL, MSG_RETURN, MSG_CONSOLE };
