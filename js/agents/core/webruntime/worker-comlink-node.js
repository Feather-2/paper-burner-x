/**
 * @file Node.js adapter for worker-comlink RPC layer.
 *
 * Bridges node:worker_threads Worker to a browser-like Worker interface so
 * wrapWorker() can be reused across runtimes.
 */

import { MSG_CALL, MSG_CONSOLE, MSG_RETURN, wrapWorker } from './worker-comlink.js';

/**
 * Translate comlink call payload to legacy js-sandbox worker execute payload.
 * @param {any} message
 * @returns {any}
 */
function translateOutgoingMessage(message) {
  if (!message || message.type !== MSG_CALL) return message;
  if (message.method !== 'execute') return message;

  const args = Array.isArray(message.args) ? message.args : [];
  const firstArg = args[0];

  if (firstArg && typeof firstArg === 'object' && !Array.isArray(firstArg)) {
    const { code = '', filename, state, globals, timeout } = firstArg;
    return {
      type: 'execute',
      id: message.id,
      code,
      ...(typeof filename === 'string' ? { filename } : {}),
      state,
      globals,
      timeout,
    };
  }

  const [code = '', filename, state, globals, timeout] = args;
  return {
    type: 'execute',
    id: message.id,
    code,
    ...(typeof filename === 'string' ? { filename } : {}),
    state,
    globals,
    timeout,
  };
}

/**
 * Translate legacy js-sandbox worker events to comlink events.
 * @param {any} message
 * @returns {any}
 */
function translateIncomingMessage(message) {
  if (!message || typeof message !== 'object') return null;

  // Already comlink-compatible.
  if (message.type === MSG_RETURN || message.type === MSG_CONSOLE) return message;

  if (message.type === 'result') {
    return {
      type: MSG_RETURN,
      id: message.id,
      ok: Boolean(message.success),
      value: message.data,
      error: message.error,
    };
  }

  if (message.type === 'log') {
    return {
      type: MSG_CONSOLE,
      method: 'log',
      args: [message.level, Array.isArray(message.args) ? message.args : []],
    };
  }

  if (message.type === 'emit') {
    return {
      type: MSG_CONSOLE,
      method: 'emit',
      args: [message.name, message.payload],
    };
  }

  if (message.type === 'audit') {
    return {
      type: MSG_CONSOLE,
      method: 'audit',
      args: [message.event, message.payload],
    };
  }

  return null;
}

/**
 * Wrap node:worker_threads Worker with addEventListener/removeEventListener.
 * @param {import('node:worker_threads').Worker} nodeWorker
 * @returns {{
 *   postMessage: (data: any) => void,
 *   terminate: () => Promise<number>,
 *   addEventListener: (event: string, handler: Function) => void,
 *   removeEventListener: (event: string, handler: Function) => void
 * }}
 */
function createWorkerAdapter(nodeWorker) {
  const messageListeners = new Map();
  const errorListeners = new Map();
  const exitListeners = new Map();

  const removeListener = typeof nodeWorker.off === 'function'
    ? (event, handler) => nodeWorker.off(event, handler)
    : typeof nodeWorker.removeListener === 'function'
      ? (event, handler) => nodeWorker.removeListener(event, handler)
      : () => {};

  return {
    postMessage(data) {
      nodeWorker.postMessage(translateOutgoingMessage(data));
    },
    terminate() {
      return nodeWorker.terminate();
    },
    addEventListener(event, handler) {
      if (typeof handler !== 'function') return;

      if (event === 'message') {
        const wrapped = (data) => {
          const translated = translateIncomingMessage(data);
          if (!translated) return;
          handler({ data: translated });
        };
        messageListeners.set(handler, wrapped);
        nodeWorker.on('message', wrapped);
        return;
      }

      if (event === 'error') {
        const wrapped = (error) => {
          handler({ error });
        };
        errorListeners.set(handler, wrapped);
        nodeWorker.on('error', wrapped);
        return;
      }

      if (event === 'exit') {
        const wrapped = (code) => {
          handler({ code });
        };
        exitListeners.set(handler, wrapped);
        nodeWorker.on('exit', wrapped);
      }
    },
    removeEventListener(event, handler) {
      if (event === 'message') {
        const wrapped = messageListeners.get(handler);
        if (!wrapped) return;
        removeListener('message', wrapped);
        messageListeners.delete(handler);
        return;
      }

      if (event === 'error') {
        const wrapped = errorListeners.get(handler);
        if (!wrapped) return;
        removeListener('error', wrapped);
        errorListeners.delete(handler);
        return;
      }

      if (event === 'exit') {
        const wrapped = exitListeners.get(handler);
        if (!wrapped) return;
        removeListener('exit', wrapped);
        exitListeners.delete(handler);
      }
    },
  };
}

/**
 * Wrap a Node worker_threads worker with the shared Comlink-style RPC layer.
 * @param {import('node:worker_threads').Worker} nodeWorker
 * @param {Record<string, any>} [config]
 */
export function wrapNodeWorker(nodeWorker, config = {}) {
  const worker = createWorkerAdapter(nodeWorker);
  return wrapWorker({ ...config, worker });
}

export { createWorkerAdapter };
