/**
 * JS Sandbox Worker
 *
 * 在隔离的 Worker 中执行不可信 JS 代码。
 * 通过限制 globals 和 postMessage 边界提供基础隔离。
 */

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

// 创建受限执行环境
/**
 * @param {unknown} state
 * @param {unknown} [emit]
 * @returns {Record<string, any>}
 */
function createRestrictedGlobals(state, emit) {
  const restricted = Object.create(null);

  for (const key of ALLOWED_GLOBALS) {
    if (key in self) {
      restricted[key] = self[key];
    }
  }

  // 注入上下文
  const normalizedState = state && typeof state === "object" ? state : {};
  restricted.state = Object.freeze(normalizedState);
  restricted.emit = (name, payload) => {
    self.postMessage({ type: 'emit', name, payload });
  };

  // 安全的 console
  restricted.console = {
    log: (...args) => self.postMessage({ type: 'log', level: 'log', args: args.map(String) }),
    warn: (...args) => self.postMessage({ type: 'log', level: 'warn', args: args.map(String) }),
    error: (...args) => self.postMessage({ type: 'log', level: 'error', args: args.map(String) }),
    info: (...args) => self.postMessage({ type: 'log', level: 'info', args: args.map(String) }),
  };

  // Shadow common escape hatches (best-effort; not a complete security boundary).
  restricted.self = undefined;
  restricted.globalThis = undefined;
  restricted.fetch = undefined;
  restricted.XMLHttpRequest = undefined;
  restricted.WebSocket = undefined;
  restricted.importScripts = undefined;
  restricted.postMessage = undefined;

  return restricted;
}

/**
 * @param {MessageEvent} evt
 * @returns {Promise<void>}
 */
self.onmessage = async (evt) => {
  const { type, id, code, state, timeout = 30000 } = evt.data;

  if (type !== 'execute') return;

  const startTime = Date.now();
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timeoutId = null;

  try {
    // 超时保护
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Execution timeout')), timeout);
    });

    const restricted = createRestrictedGlobals(state);

    // 构建受限执行函数
    const wrappedCode = `
      return (async function(globals) {
        with (globals) {
          ${code}
        }
      }).call(globals, globals);
    `;

    const fn = new Function(wrappedCode);
    const execPromise = fn.call(restricted);

    const result = await Promise.race([execPromise, timeoutPromise]);

    clearTimeout(timeoutId);

    self.postMessage({
      type: 'result',
      id,
      success: true,
      data: result,
      metrics: { duration: Date.now() - startTime }
    });

  } catch (err) {
    if (timeoutId) clearTimeout(timeoutId);

    self.postMessage({
      type: 'result',
      id,
      success: false,
      error: err.message,
      metrics: { duration: Date.now() - startTime }
    });
  }
};
