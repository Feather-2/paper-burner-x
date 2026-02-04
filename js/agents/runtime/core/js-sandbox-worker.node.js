/**
 * JS Sandbox Worker - Node.js 版本
 *
 * 使用 worker_threads 在隔离环境中执行不可信 JS 代码。
 * 与 js-sandbox-worker.js (浏览器版) 保持相同的消息协议。
 */

// @ts-ignore
import { parentPort, workerData } from 'node:worker_threads';

// eslint-disable-next-line no-new-func
const UnsafeFunction = Function;

/** @type {Set<string>} */
const ALLOWED_GLOBALS = new Set([
  'Array', 'ArrayBuffer', 'Boolean', 'DataView', 'Date', 'Error',
  'Float32Array', 'Float64Array', 'Int8Array', 'Int16Array', 'Int32Array',
  'JSON', 'Map', 'Math', 'Number', 'Object', 'Promise', 'Proxy',
  'Reflect', 'RegExp', 'Set', 'String', 'Symbol', 'TypeError',
  'Uint8Array', 'Uint16Array', 'Uint32Array', 'Uint8ClampedArray',
  'WeakMap', 'WeakSet', 'console', 'isNaN', 'isFinite', 'parseFloat', 'parseInt',
  'decodeURI', 'decodeURIComponent', 'encodeURI', 'encodeURIComponent',
  'undefined', 'NaN', 'Infinity'
]);

/** @type {Set<string>} */
const BLOCKED_GLOBALS = new Set([
  // Dynamic code execution
  'eval', 'Function', 'AsyncFunction', 'GeneratorFunction',
  // Module/require
  'require', 'module', 'exports', '__dirname', '__filename',
  // Network / IO
  'fetch', 'XMLHttpRequest', 'WebSocket',
  // Node.js specific
  'process', 'Buffer', 'setImmediate', 'clearImmediate',
  // Worker escape hatches
  'postMessage', 'parentPort', 'workerData',
  // Host globals
  'window', 'document', 'global', 'globalThis',
  // Prototype / constructor escape patterns
  '__proto__', 'prototype', 'constructor',
]);

/** @type {RegExp[]} */
const BLOCK_PATTERNS = [
  /\bimport\s*\(/,
  /\bconstructor\s*\.\s*constructor\b/,
  /\brequire\s*\(/,
  /\bprocess\b/,
];

/**
 * @param {string} code
 * @returns {{ valid: boolean, reason?: string }}
 */
function validateSandboxCode(code) {
  for (const pattern of BLOCK_PATTERNS) {
    if (pattern.test(code)) {
      return { valid: false, reason: `Blocked pattern: ${pattern.source}` };
    }
  }
  return { valid: true };
}

/**
 * @param {any} msg
 */
function postToHost(msg) {
  try {
    parentPort?.postMessage(msg);
  } catch {
    // ignore
  }
}

/**
 * @param {Record<string, any>} base
 * @param {{ blockedAccesses: Set<string> }} audit
 * @returns {any}
 */
function createSandboxProxy(base, audit) {
  const target = Object.create(null);

  /** @type {any} */
  const proxy = new Proxy(target, {
    has() {
      return true;
    },
    get(t, prop) {
      if (prop === Symbol.unscopables) return undefined;
      if (typeof prop !== 'string') return undefined;

      if (prop === 'globalThis' || prop === 'self' || prop === 'global') return proxy;

      if (BLOCKED_GLOBALS.has(prop)) {
        if (audit.blockedAccesses.size < 32) audit.blockedAccesses.add(prop);
        return undefined;
      }

      if (Object.prototype.hasOwnProperty.call(t, prop)) return t[prop];
      if (Object.prototype.hasOwnProperty.call(base, prop)) return base[prop];

      return undefined;
    },
    set(t, prop, value) {
      if (typeof prop !== 'string') return false;
      if (BLOCKED_GLOBALS.has(prop)) {
        if (audit.blockedAccesses.size < 32) audit.blockedAccesses.add(prop);
        return true;
      }
      t[prop] = value;
      return true;
    },
    defineProperty(t, prop, descriptor) {
      if (typeof prop !== 'string') return false;
      if (BLOCKED_GLOBALS.has(prop)) {
        if (audit.blockedAccesses.size < 32) audit.blockedAccesses.add(prop);
        return false;
      }
      return Reflect.defineProperty(t, prop, descriptor);
    },
    getPrototypeOf() {
      return null;
    },
    setPrototypeOf() {
      return false;
    },
  });

  return proxy;
}

/**
 * @param {unknown} state
 * @param {{ blockedAccesses: Set<string> }} audit
 * @param {unknown} [globals]
 * @returns {any}
 */
function createRestrictedGlobals(state, audit, globals) {
  const restricted = Object.create(null);

  for (const key of ALLOWED_GLOBALS) {
    if (key in globalThis) {
      restricted[key] = globalThis[key];
    }
  }

  // 注入上下文
  const normalizedState = state && typeof state === 'object' ? state : {};
  restricted.state = Object.freeze(normalizedState);
  restricted.emit = (name, payload) => {
    postToHost({ type: 'emit', name, payload });
  };

  // 安全的 console
  restricted.console = {
    log: (...args) => postToHost({ type: 'log', level: 'log', args: args.map(String) }),
    warn: (...args) => postToHost({ type: 'log', level: 'warn', args: args.map(String) }),
    error: (...args) => postToHost({ type: 'log', level: 'error', args: args.map(String) }),
    info: (...args) => postToHost({ type: 'log', level: 'info', args: args.map(String) }),
    debug: (...args) => postToHost({ type: 'log', level: 'debug', args: args.map(String) }),
  };

  // 注入额外 globals
  const normalizedGlobals = globals && typeof globals === 'object' ? globals : null;
  if (normalizedGlobals) {
    for (const [k, v] of Object.entries(normalizedGlobals)) {
      if (k in restricted) continue;
      if (BLOCKED_GLOBALS.has(k)) continue;
      restricted[k] = v;
    }
  }

  return createSandboxProxy(restricted, audit);
}

/**
 * @param {Object} data
 */
async function handleExecute(data) {
  const { id, code, state, globals, timeout = 30000 } = data;

  const startTime = Date.now();
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timeoutId = null;
  const audit = { blockedAccesses: new Set() };

  try {
    postToHost({
      type: 'audit',
      id,
      event: 'start',
      payload: {
        codeLength: typeof code === 'string' ? code.length : 0,
        timeoutMs: timeout,
      },
    });

    const validation = validateSandboxCode(String(code || ''));
    if (!validation.valid) {
      postToHost({
        type: 'audit',
        id,
        event: 'blocked',
        payload: { reason: validation.reason },
      });
      postToHost({
        type: 'result',
        id,
        success: false,
        error: `Security: ${validation.reason}`,
        metrics: { duration: Date.now() - startTime, blocked: true },
      });
      return;
    }

    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Execution timeout')), timeout);
    });

    const sandbox = createRestrictedGlobals(state, audit, globals);

    const wrappedCode = `
      with (sandbox) {
        return (async function () {
          ${code}
        }).call(this);
      }
    `;

    // eslint-disable-next-line no-new-func
    const fn = new UnsafeFunction('sandbox', wrappedCode);
    const execPromise = fn.call(sandbox, sandbox);

    const result = await Promise.race([execPromise, timeoutPromise]);

    clearTimeout(timeoutId);

    postToHost({
      type: 'result',
      id,
      success: true,
      data: result,
      metrics: { duration: Date.now() - startTime },
    });
  } catch (err) {
    if (timeoutId) clearTimeout(timeoutId);

    postToHost({
      type: 'result',
      id,
      success: false,
      error: err.message,
      metrics: { duration: Date.now() - startTime },
    });
  } finally {
    postToHost({
      type: 'audit',
      id,
      event: 'end',
      payload: {
        duration: Date.now() - startTime,
        blockedGlobals: Array.from(audit.blockedAccesses),
      },
    });
  }
}

// 监听来自主线程的消息
parentPort?.on('message', async (data) => {
  if (data?.type === 'execute') {
    await handleExecute(data);
  }
});

// 发送就绪信号
postToHost({ type: 'ready' });
