/**
 * JS Sandbox Worker - Node.js 版本
 *
 * 使用 worker_threads 在隔离环境中执行不可信 JS 代码。
 * 与 js-sandbox-worker.js (浏览器版) 保持相同的消息协议。
 */

// @ts-ignore
import { parentPort, workerData } from 'node:worker_threads';
// @ts-ignore
import * as vm from 'node:vm';

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

const DEFAULT_MAX_ARRAY_BUFFER_BYTES = 64 * 1024 * 1024;
const GUARDED_TYPED_ARRAYS = [
  'Int8Array',
  'Uint8Array',
  'Uint8ClampedArray',
  'Int16Array',
  'Uint16Array',
  'Int32Array',
  'Uint32Array',
  'Float32Array',
  'Float64Array',
];

/**
 * @param {unknown} value
 * @returns {number}
 */
function normalizeNonNegativeInteger(value) {
  if (typeof value === 'bigint') {
    if (value <= 0n) return 0;
    const bounded = value > BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(Number.MAX_SAFE_INTEGER) : value;
    return Number(bounded);
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.floor(n));
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function normalizeByteLimit(value, fallback) {
  const normalized = normalizeNonNegativeInteger(value);
  return normalized > 0 ? normalized : fallback;
}

/**
 * @param {number} value
 * @returns {number}
 */
function safeByteFloor(value) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= Number.MAX_SAFE_INTEGER) return Number.MAX_SAFE_INTEGER;
  return Math.floor(value);
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function estimateArrayLikeLength(value) {
  if (!value || typeof value !== 'object') return 0;
  if (!Object.prototype.hasOwnProperty.call(value, 'length') && !('length' in value)) return 0;
  return normalizeNonNegativeInteger(value.length);
}

/**
 * @param {any[]} args
 * @param {number} bytesPerElement
 * @returns {number}
 */
function estimateTypedArrayAllocationBytes(args, bytesPerElement) {
  if (!Array.isArray(args) || args.length === 0) return 0;
  const source = args[0];

  if (source instanceof ArrayBuffer) return 0;
  if (typeof SharedArrayBuffer !== 'undefined' && source instanceof SharedArrayBuffer) return 0;
  if (ArrayBuffer.isView(source)) {
    const arrayLikeLength = estimateArrayLikeLength(source);
    if (arrayLikeLength > 0) return safeByteFloor(arrayLikeLength * bytesPerElement);
    return safeByteFloor(source.byteLength);
  }

  if (typeof source === 'number' || typeof source === 'bigint') {
    return safeByteFloor(normalizeNonNegativeInteger(source) * bytesPerElement);
  }

  if (source && typeof source === 'object') {
    return safeByteFloor(estimateArrayLikeLength(source) * bytesPerElement);
  }

  return 0;
}

/**
 * @param {{ maxArrayBufferBytes: number, maxTotalArrayBufferBytes: number }} limits
 * @param {{ blockedAllocations: Array<{ kind: string, requestedBytes: number, message: string }>, totalArrayBufferBytes: number }} audit
 */
function createAllocationGuard(limits, audit) {
  let totalAllocatedBytes = 0;

  /**
   * @param {number} requestedBytes
   * @param {string} kind
   */
  const assertAllocation = (requestedBytes, kind) => {
    const bytes = normalizeNonNegativeInteger(requestedBytes);
    if (bytes === 0) return;

    if (bytes > limits.maxArrayBufferBytes) {
      const message = `${kind} allocation (${bytes} bytes) exceeds sandbox limit (${limits.maxArrayBufferBytes} bytes)`;
      if (audit.blockedAllocations.length < 16) {
        audit.blockedAllocations.push({ kind, requestedBytes: bytes, message });
      }
      throw new RangeError(message);
    }

    if (totalAllocatedBytes + bytes > limits.maxTotalArrayBufferBytes) {
      const attempted = totalAllocatedBytes + bytes;
      const message = `${kind} cumulative allocation (${attempted} bytes) exceeds sandbox total limit (${limits.maxTotalArrayBufferBytes} bytes)`;
      if (audit.blockedAllocations.length < 16) {
        audit.blockedAllocations.push({ kind, requestedBytes: bytes, message });
      }
      throw new RangeError(message);
    }

    totalAllocatedBytes += bytes;
    audit.totalArrayBufferBytes = totalAllocatedBytes;
  };

  return {
    /**
     * @param {unknown} size
     */
    assertArrayBuffer(size) {
      assertAllocation(size, 'ArrayBuffer');
    },

    /**
     * @param {any[]} args
     * @param {number} bytesPerElement
     * @param {string} name
     */
    assertTypedArray(args, bytesPerElement, name) {
      const estimatedBytes = estimateTypedArrayAllocationBytes(args, bytesPerElement);
      assertAllocation(estimatedBytes, name);
    },
  };
}

/**
 * @param {Function} ctor
 * @param {{ assertArrayBuffer: (size: unknown) => void, assertTypedArray: (args: any[], bytesPerElement: number, name: string) => void }} guard
 * @returns {Function}
 */
function wrapArrayBufferConstructor(ctor, guard) {
  /** @type {Function} */
  let proxy;
  proxy = new Proxy(ctor, {
    construct(target, args, newTarget) {
      guard.assertArrayBuffer(args?.[0]);
      return Reflect.construct(target, args, newTarget === proxy ? target : newTarget);
    },
  });
  return proxy;
}

/**
 * @param {Function} ctor
 * @param {{ assertArrayBuffer: (size: unknown) => void, assertTypedArray: (args: any[], bytesPerElement: number, name: string) => void }} guard
 * @returns {Function}
 */
function wrapTypedArrayConstructor(ctor, guard) {
  const bytesPerElement = normalizeNonNegativeInteger(ctor?.BYTES_PER_ELEMENT) || 1;
  const ctorName = String(ctor?.name || 'TypedArray');

  /** @type {Function} */
  let proxy;
  proxy = new Proxy(ctor, {
    construct(target, args, newTarget) {
      guard.assertTypedArray(Array.isArray(args) ? args : [], bytesPerElement, ctorName);
      return Reflect.construct(target, args, newTarget === proxy ? target : newTarget);
    },
  });
  return proxy;
}

const WORKER_SANDBOX_LIMITS = (() => {
  const defaults = {
    maxArrayBufferBytes: DEFAULT_MAX_ARRAY_BUFFER_BYTES,
    maxTotalArrayBufferBytes: DEFAULT_MAX_ARRAY_BUFFER_BYTES,
  };

  const configured = workerData && typeof workerData === 'object' && workerData.sandboxLimits && typeof workerData.sandboxLimits === 'object'
    ? workerData.sandboxLimits
    : null;
  if (!configured) return defaults;

  const maxArrayBufferBytes = normalizeByteLimit(configured.maxArrayBufferBytes, defaults.maxArrayBufferBytes);
  const maxTotalArrayBufferBytes = normalizeByteLimit(configured.maxTotalArrayBufferBytes, maxArrayBufferBytes);

  return { maxArrayBufferBytes, maxTotalArrayBufferBytes };
})();

/**
 * @param {unknown} requestLimits
 * @returns {{ maxArrayBufferBytes: number, maxTotalArrayBufferBytes: number }}
 */
function resolveExecutionLimits(requestLimits) {
  if (!requestLimits || typeof requestLimits !== 'object') return WORKER_SANDBOX_LIMITS;

  const maxArrayBufferBytes = normalizeByteLimit(
    requestLimits.maxArrayBufferBytes,
    WORKER_SANDBOX_LIMITS.maxArrayBufferBytes
  );
  const maxTotalArrayBufferBytes = normalizeByteLimit(
    requestLimits.maxTotalArrayBufferBytes,
    maxArrayBufferBytes
  );

  return { maxArrayBufferBytes, maxTotalArrayBufferBytes };
}

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

  /** @type {Record<string, unknown>} */
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
 * @param {{ maxArrayBufferBytes: number, maxTotalArrayBufferBytes: number }} limits
 * @returns {any}
 */
function createRestrictedGlobals(state, audit, globals, limits) {
  const restricted = Object.create(null);
  const allocationGuard = createAllocationGuard(limits, audit);

  for (const key of ALLOWED_GLOBALS) {
    if (key in globalThis) {
      restricted[key] = globalThis[key];
    }
  }

  if (typeof restricted.ArrayBuffer === 'function') {
    restricted.ArrayBuffer = wrapArrayBufferConstructor(restricted.ArrayBuffer, allocationGuard);
  }
  for (const ctorName of GUARDED_TYPED_ARRAYS) {
    const ctor = restricted[ctorName];
    if (typeof ctor !== 'function') continue;
    restricted[ctorName] = wrapTypedArrayConstructor(ctor, allocationGuard);
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
 * Execute sandbox code with Node VM timeout for synchronous hard-stop.
 * @param {string} code
 * @param {any} sandbox
 * @param {number} timeout
 * @returns {Promise<any>}
 */
async function executeWithVmTimeout(code, sandbox, timeout) {
  const wrappedCode = `
    (function () {
      with (sandbox) {
        return (async function () {
          ${code}
        }).call(sandbox);
      }
    })()
  `;

  const script = new vm.Script(wrappedCode, {
    filename: "js-sandbox-worker.node.js",
  });

  const context = vm.createContext({ sandbox });
  const exec = script.runInContext(context, {
    timeout: Math.max(1, timeout),
    microtaskMode: 'afterEvaluate',
  });

  return await Promise.resolve(exec);
}

/**
 * @param {Object} data
 */
async function handleExecute(data) {
  const { id, code, state, globals, timeout = 30000 } = data;

  const startTime = Date.now();
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timeoutId = null;
  const executionLimits = resolveExecutionLimits(data?.limits);
  const audit = {
    blockedAccesses: new Set(),
    blockedAllocations: [],
    totalArrayBufferBytes: 0,
  };

  try {
    postToHost({
      type: 'audit',
      id,
      event: 'start',
      payload: {
        codeLength: typeof code === 'string' ? code.length : 0,
        timeoutMs: timeout,
        limits: executionLimits,
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

    const timeoutMs = Math.max(0, Number(timeout) || 0);
    const sandbox = createRestrictedGlobals(state, audit, globals, executionLimits);
    const timeoutPromise = timeoutMs > 0
      ? new Promise((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(new Error(`Execution timeout after ${timeoutMs}ms`));
          }, timeoutMs);
        })
      : null;

    const execPromise = executeWithVmTimeout(String(code || ''), sandbox, timeoutMs || 1);
    const result = timeoutPromise ? await Promise.race([execPromise, timeoutPromise]) : await execPromise;

    if (timeoutId) clearTimeout(timeoutId);

    postToHost({
      type: 'result',
      id,
      success: true,
      data: result,
      metrics: {
        duration: Date.now() - startTime,
        timeoutMs,
        arrayBufferBytes: audit.totalArrayBufferBytes,
      },
    });
  } catch (err) {
    if (timeoutId) clearTimeout(timeoutId);
    const message = err instanceof Error ? err.message : String(err);
    const timedOut = /timed?\s*out|execution timeout/i.test(message);
    const blocked = /sandbox (?:total )?limit/i.test(message);
    if (blocked) {
      postToHost({
        type: 'audit',
        id,
        event: 'blocked',
        payload: { reason: message },
      });
    }

    postToHost({
      type: 'result',
      id,
      success: false,
      error: timedOut ? message : message,
      metrics: {
        duration: Date.now() - startTime,
        timedOut,
        blocked,
        arrayBufferBytes: audit.totalArrayBufferBytes,
      },
    });
  } finally {
    postToHost({
      type: 'audit',
      id,
      event: 'end',
      payload: {
        duration: Date.now() - startTime,
        blockedGlobals: Array.from(audit.blockedAccesses),
        arrayBufferBytes: audit.totalArrayBufferBytes,
        blockedAllocations: audit.blockedAllocations,
        limits: executionLimits,
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
