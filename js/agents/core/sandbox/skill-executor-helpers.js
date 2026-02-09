import { SandboxCapability } from './constants.js';

// Skill metadata 中允许声明的能力（白名单，声明 != 授权）
// 注意：这里的 key 为 Skill 声明用的字符串，value 为实际沙箱能力常量。
export const ALLOWED_CAPABILITIES = Object.freeze({
  // Network
  network: SandboxCapability.FETCH,
  fetch: SandboxCapability.FETCH,
});

/**
 * @param {Iterable<string> | null | undefined} value
 * @returns {Set<string> | null}
 */
export function normalizeFallbackAllowlist(value) {
  if (!value) return null;
  if (value instanceof Set) return value;
  if (Array.isArray(value)) {
    const entries = value.filter(item => typeof item === 'string' && item.trim().length > 0);
    return entries.length > 0 ? new Set(entries) : null;
  }
  return null;
}

/**
 * @param {Set<string> | null} allowlist
 * @param {any} skill
 * @returns {boolean}
 */
export function isAllowlistedSkill(allowlist, skill) {
  if (!allowlist) return false;
  const id = skill?.id || skill?.metadata?.name;
  if (!id || typeof id !== 'string') return false;
  return allowlist.has(id);
}

// Fallback eval 的基础防护（best-effort；不是强安全边界）
/** @type {RegExp[]} */
export const FALLBACK_BLOCK_PATTERNS = [
  /[\s\S]/, // SECURITY: deny-all — non-empty code is always blocked (effectively disables fallback eval)
];

/** @type {Set<string>} */
export const FALLBACK_ALLOWED_GLOBALS = new Set([
  'Array', 'ArrayBuffer', 'Boolean', 'DataView', 'Date', 'Error',
  'Float32Array', 'Float64Array', 'Int8Array', 'Int16Array', 'Int32Array',
  'JSON', 'Map', 'Math', 'Number', 'Object', 'Promise', 'Proxy',
  'Reflect', 'RegExp', 'Set', 'String', 'Symbol', 'TypeError',
  'Uint8Array', 'Uint16Array', 'Uint32Array', 'Uint8ClampedArray',
  'WeakMap', 'WeakSet', 'console', 'isNaN', 'isFinite', 'parseFloat', 'parseInt',
  'decodeURI', 'decodeURIComponent', 'encodeURI', 'encodeURIComponent',
  'undefined', 'NaN', 'Infinity'
]);

// Fallback sandbox blocked bindings/APIs (best-effort; Proxy prevents fallback to real globals).
/** @type {Set<string>} */
export const FALLBACK_BLOCKED_GLOBALS = new Set([
  // Dynamic code execution
  'eval',
  'Function',
  'AsyncFunction',
  'GeneratorFunction',

  // Module/require
  'require',
  'module',
  'exports',

  // Network / IO
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'importScripts',

  // Escape hatches
  'postMessage',
  'onmessage',
  'addEventListener',
  'removeEventListener',
  'dispatchEvent',
  'close',

  // Prototype / constructor escape patterns
  '__proto__',
  'prototype',
  'constructor',
]);

/**
 * Create a Proxy suitable for `with (...)` that prevents identifier lookup from falling back to real globals.
 *
 * SECURITY NOTICE: This proxy fallback is compatibility-only and NOT a security boundary.
 * It is vulnerable to known JavaScript sandbox-escape techniques.
 * Keep `fallbackMode: 'none'` as the default; only enable proxy fallback for trusted code.
 * For untrusted execution, use the QuickJS WASM sandbox for real isolation.
 *
 * @param {Record<string, any>} base
 * @param {{ blockedAccesses?: Set<string> } | null | undefined} audit
 * @returns {any}
 */
export function createFallbackProxyGlobals(base, audit) {
  const target = Object.create(null);

  /** @type {Record<string, unknown>} */
  const proxy = new Proxy(target, {
    has() {
      return true;
    },
    get(t, prop) {
      if (prop === Symbol.unscopables) return undefined;
      if (typeof prop !== 'string') return undefined;

      // Provide a sandboxed "global" reference (does not expose the host globalThis).
      if (prop === 'globalThis' || prop === 'self') return proxy;

      if (FALLBACK_BLOCKED_GLOBALS.has(prop)) {
        if (audit?.blockedAccesses && audit.blockedAccesses.size < 32) audit.blockedAccesses.add(prop);
        return undefined;
      }

      if (Object.prototype.hasOwnProperty.call(t, prop)) return t[prop];
      if (Object.prototype.hasOwnProperty.call(base, prop)) return base[prop];
      return undefined;
    },
    set(t, prop, value) {
      if (typeof prop !== 'string') return false;
      if (FALLBACK_BLOCKED_GLOBALS.has(prop)) {
        if (audit?.blockedAccesses && audit.blockedAccesses.size < 32) audit.blockedAccesses.add(prop);
        return true;
      }
      t[prop] = value;
      return true;
    },
    defineProperty(t, prop, descriptor) {
      if (typeof prop !== 'string') return false;
      if (FALLBACK_BLOCKED_GLOBALS.has(prop)) {
        if (audit?.blockedAccesses && audit.blockedAccesses.size < 32) audit.blockedAccesses.add(prop);
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

export function normalizeCapabilityName(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function normalizeCapabilityList(value) {
  if (Array.isArray(value)) return value.map(normalizeCapabilityName).filter(Boolean);
  if (typeof value === 'string') {
    return value
      .split(',')
      .map(normalizeCapabilityName)
      .filter(Boolean);
  }
  return [];
}

export function normalizeFallbackMode(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  const v = raw.toLowerCase();
  return v === 'none' ? 'none' : 'eval';
}

/**
 * @param {string} code
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateFallbackCode(code) {
  for (const pattern of FALLBACK_BLOCK_PATTERNS) {
    if (pattern.test(code)) {
      return { valid: false, reason: `Blocked pattern: ${pattern.source}` };
    }
  }
  return { valid: true };
}

/**
 * 创建受限 globals（用于 fallback eval）。
 *
 * 注意：这是 best-effort 方案；无法提供 WASM 沙箱同等的内存隔离与强安全边界。
 *
 * @param {object} options
 * @param {object} [options.state]
 * @param {object} [options.args]
 * @param {(level: string, args: any[]) => void} options.onLog
 * @param {(name: string, payload: any) => void} options.onEmit
 * @returns {Record<string, any>}
 */
export function createFallbackGlobals({ state, args, onLog, onEmit }) {
  const globals = Object.create(null);
  const root = typeof globalThis !== 'undefined' ? globalThis : undefined;

  for (const key of FALLBACK_ALLOWED_GLOBALS) {
    if (root && key in root) {
      globals[key] = root[key];
    }
  }

  // 注入上下文（只读）
  const normalizedState = state && typeof state === 'object' ? state : {};
  globals.state = Object.freeze(normalizedState);
  globals.emit = (name, payload) => {
    onEmit(String(name), payload);
  };

  // 安全的 console
  globals.console = {
    log: (...a) => onLog('log', a),
    warn: (...a) => onLog('warn', a),
    error: (...a) => onLog('error', a),
    info: (...a) => onLog('info', a),
    debug: (...a) => onLog('debug', a),
  };

  // Shadow common escape hatches (best-effort; not a complete security boundary).
  globals.self = undefined;
  globals.globalThis = globals;
  globals.window = undefined;
  globals.document = undefined;
  globals.fetch = undefined;
  globals.XMLHttpRequest = undefined;
  globals.WebSocket = undefined;
  globals.importScripts = undefined;
  globals.postMessage = undefined;

  // 注入 args（兼容 WASM 直接注入变量的行为）
  const normalizedArgs = args && typeof args === 'object' ? args : {};
  for (const [k, v] of Object.entries(normalizedArgs)) {
    if (FALLBACK_BLOCKED_GLOBALS.has(k)) continue;
    if (!(k in globals)) globals[k] = v;
  }

  return globals;
}

/**
 * 检测当前环境是否支持 WASM（QuickJS WASM 运行所需）。
 * 某些旧环境（例如旧版 iOS Safari）可能不支持 WebAssembly。
 *
 * @returns {Promise<boolean>}
 */
export async function isWasmSupported() {
  try {
    if (typeof WebAssembly === 'undefined') return false;
    // 尝试编译一个最小模块
    const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
    await WebAssembly.compile(bytes);
    return true;
  } catch {
    return false;
  }
}
