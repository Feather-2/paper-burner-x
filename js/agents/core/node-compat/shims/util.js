/**
 * @fileoverview Node.js `util` module shim for browser sandbox.
 */

/**
 * Inspect a value, returning a human-readable string.
 * @param {*} obj
 * @param {object} [options]
 * @returns {string}
 */
export function inspect(obj, options) {
  try { return JSON.stringify(obj, null, 2); }
  catch (_) { return String(obj); }
}

/**
 * Printf-style string formatting.
 * @param {string} fmt
 * @param {...*} args
 * @returns {string}
 */
export function format(fmt, ...args) {
  if (typeof fmt !== 'string') return [fmt, ...args].map(a => inspect(a)).join(' ');
  let i = 0;
  return fmt.replace(/%[sdjifoO%]/g, (match) => {
    if (match === '%%') return '%';
    if (i >= args.length) return match;
    const arg = args[i++];
    switch (match) {
      case '%s': return String(arg);
      case '%d': case '%i': return String(parseInt(String(arg), 10));
      case '%f': return String(parseFloat(String(arg)));
      case '%j': return JSON.stringify(arg);
      case '%o': case '%O': return inspect(arg);
      default: return match;
    }
  });
}

/**
 * Convert a callback-style function to one returning a Promise.
 * @param {Function} fn
 * @returns {Function}
 */
export function promisify(fn) {
  return function (...args) {
    return new Promise((resolve, reject) => {
      fn(...args, (err, result) => err ? reject(err) : resolve(result));
    });
  };
}

/**
 * Convert an async function to callback-style.
 * @param {Function} fn
 * @returns {Function}
 */
export function callbackify(fn) {
  return function (...args) {
    const callback = args.pop();
    fn(...args).then(r => callback(null, r), e => callback(e)).catch(() => {});
  };
}

/**
 * Set up prototypal inheritance (legacy).
 * @param {Function} ctor
 * @param {Function} superCtor
 */
export function inherits(ctor, superCtor) {
  Object.setPrototypeOf(ctor.prototype, superCtor.prototype);
  /** @type {Function & { super_?: Function }} */ (ctor).super_ = superCtor;
}

/**
 * Wrap a function with a deprecation warning on first call.
 * @param {Function} fn
 * @param {string} msg
 * @returns {Function}
 */
export function deprecate(fn, msg) {
  let warned = false;
  return function (...args) {
    if (!warned) { console.warn('DeprecationWarning:', msg); warned = true; }
    return fn.apply(this, args);
  };
}

export const types = {
  isArray: Array.isArray,
  isDate: (v) => v instanceof Date,
  isRegExp: (v) => v instanceof RegExp,
  isFunction: (v) => typeof v === 'function',
  isObject: (v) => v !== null && typeof v === 'object',
  isString: (v) => typeof v === 'string',
  isNumber: (v) => typeof v === 'number',
  isBoolean: (v) => typeof v === 'boolean',
  isUndefined: (v) => v === undefined,
  isNull: (v) => v === null,
  isNullOrUndefined: (v) => v == null,
  isPromise: (v) => v instanceof Promise,
};

export default { inspect, format, promisify, callbackify, inherits, deprecate, types };
