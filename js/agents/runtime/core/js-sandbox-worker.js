/**
 * JS Sandbox Worker
 *
 * 在隔离的 Worker 中执行不可信 JS 代码。
 * 通过限制 globals 和 postMessage 边界提供基础隔离。
 */

// Capture references to host capabilities before hardening globals.
/** @type {(msg: any) => void} */
const hostPostMessage = (() => {
  try {
    if (typeof self !== "undefined" && typeof self.postMessage === "function") {
      return self.postMessage.bind(self);
    }
  } catch {
    // ignore
  }
  return () => {};
})();

// eslint-disable-next-line no-new-func
const UnsafeFunction = Function;

// Best-effort hardening: remove direct access to high-risk APIs from the Worker global.
// We keep a bound `hostPostMessage` for internal communication.
(() => {
  /** @type {string[]} */
  const blocked = ["fetch", "XMLHttpRequest", "WebSocket", "importScripts", "postMessage"];
  for (const key of blocked) {
    try {
      // @ts-ignore - Worker globals are untyped here
      self[key] = undefined;
    } catch {
      // ignore
    }
  }
})();

/**
 * Post a message to the host, never exposing the real `postMessage` to sandboxed code.
 * @param {any} msg
 */
function postToHost(msg) {
  try {
    hostPostMessage(msg);
  } catch {
    // ignore
  }
}

// 受限的全局对象
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

// Blocked bindings and APIs (best-effort; Proxy `has` trap prevents fallback to real globals).
/** @type {Set<string>} */
const BLOCKED_GLOBALS = new Set([
  // Dynamic code execution
  "eval",
  "Function",
  "AsyncFunction",
  "GeneratorFunction",

  // Module/require
  "require",
  "module",
  "exports",

  // Network / IO
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "importScripts",

  // Worker escape hatches
  "postMessage",
  "onmessage",
  "addEventListener",
  "removeEventListener",
  "dispatchEvent",
  "close",

  // Host globals
  "window",
  "document",
  "process",

  // Prototype / constructor escape patterns
  "__proto__",
  "prototype",
  "constructor",
]);

// Static validation (blocks syntax-level capabilities like dynamic import()).
/** @type {RegExp[]} */
const BLOCK_PATTERNS = [
  /\bimport\s*\(/, // dynamic import() cannot be trapped by Proxy
  /\bconstructor\s*\.\s*constructor\b/, // common Function-constructor escape chain
];

/**
 * @param {string} code
 * @returns {{ valid: boolean, reason?: string }}
 */
function validateSandboxCode(code) {
  for (const pattern of BLOCK_PATTERNS) {
    if (pattern.test(code)) return { valid: false, reason: `Blocked pattern: ${pattern.source}` };
  }
  return { valid: true };
}

/**
 * Create a Proxy for `with (...)` that prevents identifier lookups from falling back to real globals.
 *
 * Note: This is a best-effort sandbox; use a real VM (e.g. QuickJS WASM) for a strong security boundary.
 *
 * @param {Record<string, any>} base
 * @param {{ blockedAccesses: Set<string> }} audit
 * @returns {any}
 */
function createSandboxProxy(base, audit) {
  const target = Object.create(null);

  /** @type {any} */
  const proxy = new Proxy(target, {
    // Critical: always report bindings as present, so `with` never falls back to outer scopes.
    has() {
      return true;
    },

    get(t, prop) {
      if (prop === Symbol.unscopables) return undefined;
      if (typeof prop !== "string") return undefined;

      // Provide a sandboxed "global" reference for compatibility (does not expose the real Worker global).
      if (prop === "globalThis" || prop === "self") return proxy;

      if (BLOCKED_GLOBALS.has(prop)) {
        if (audit.blockedAccesses.size < 32) audit.blockedAccesses.add(prop);
        return undefined;
      }

      if (Object.prototype.hasOwnProperty.call(t, prop)) return t[prop];
      if (Object.prototype.hasOwnProperty.call(base, prop)) return base[prop];

      // Unknown identifiers resolve to undefined (instead of leaking the Worker global).
      return undefined;
    },

    set(t, prop, value) {
      if (typeof prop !== "string") return false;
      if (BLOCKED_GLOBALS.has(prop)) {
        if (audit.blockedAccesses.size < 32) audit.blockedAccesses.add(prop);
        return true;
      }
      t[prop] = value;
      return true;
    },

    defineProperty(t, prop, descriptor) {
      if (typeof prop !== "string") return false;
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

// 创建受限执行环境
/**
 * @param {unknown} state
 * @param {unknown} [globals]
 * @param {{ blockedAccesses: Set<string> }} audit
 * @returns {any}
 */
function createRestrictedGlobals(state, globals, audit) {
  const restricted = Object.create(null);
  const root = typeof globalThis !== "undefined" ? globalThis : self;

  for (const key of ALLOWED_GLOBALS) {
    if (root && key in root) {
      restricted[key] = root[key];
    }
  }

  // 注入上下文
  const normalizedState = state && typeof state === "object" ? state : {};
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

  // 注入额外 globals（兼容 SkillExecutor 注入 args 变量的行为）
  const normalizedGlobals = globals && typeof globals === "object" ? globals : null;
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
 * @param {MessageEvent} evt
 * @returns {Promise<void>}
 */
self.onmessage = async (evt) => {
  const { type, id, code, state, globals, timeout = 30000 } = evt.data;

  if (type !== 'execute') return;

  const startTime = Date.now();
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timeoutId = null;
  const audit = { blockedAccesses: new Set() };

  try {
    postToHost({
      type: "audit",
      id,
      event: "start",
      payload: {
        codeLength: typeof code === "string" ? code.length : 0,
        timeoutMs: timeout,
      },
    });

    // Validation for syntax-level escapes (e.g. dynamic import()).
    const validation = validateSandboxCode(String(code || ""));
    if (!validation.valid) {
      postToHost({
        type: "audit",
        id,
        event: "blocked",
        payload: { reason: validation.reason },
      });
      postToHost({
        type: "result",
        id,
        success: false,
        error: `Security: ${validation.reason}`,
        metrics: { duration: Date.now() - startTime, blocked: true },
      });
      return;
    }

    // 超时保护
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Execution timeout')), timeout);
    });

    const sandbox = createRestrictedGlobals(state, globals, audit);

    // 构建受限执行函数
    const wrappedCode = `
      return (async function () {
        with (sandbox) {
          ${code}
        }
      }).call(sandbox);
    `;

    // eslint-disable-next-line no-new-func
    const fn = new UnsafeFunction("sandbox", wrappedCode);
    const execPromise = fn(sandbox);

    const result = await Promise.race([execPromise, timeoutPromise]);

    clearTimeout(timeoutId);

    postToHost({
      type: 'result',
      id,
      success: true,
      data: result,
      metrics: { duration: Date.now() - startTime }
    });

  } catch (err) {
    if (timeoutId) clearTimeout(timeoutId);

    postToHost({
      type: 'result',
      id,
      success: false,
      error: err.message,
      metrics: { duration: Date.now() - startTime }
    });
  } finally {
    postToHost({
      type: "audit",
      id,
      event: "end",
      payload: {
        duration: Date.now() - startTime,
        blockedGlobals: Array.from(audit.blockedAccesses),
      },
    });
  }
};
