/**
 * Error.captureStackTrace cross-browser polyfill.
 *
 * Provides V8-compatible captureStackTrace + prepareStackTrace for
 * Safari/Firefox environments where these APIs are absent.
 *
 * @module stack-trace
 */

/**
 * @typedef {object} CallSite
 * @property {() => string} getFileName
 * @property {() => number} getLineNumber
 * @property {() => number} getColumnNumber
 * @property {() => string|null} getFunctionName
 * @property {() => null} getTypeName
 * @property {() => null} getMethodName
 * @property {() => boolean} isNative
 * @property {() => boolean} isToplevel
 * @property {() => boolean} isConstructor
 * @property {() => string} toString
 */

const RAW_STACK = Symbol('rawStack');
const PREPARED = Symbol('prepared');

/**
 * Create a CallSite object.
 * @param {string} fnName
 * @param {string} fileName
 * @param {number} line
 * @param {number} col
 * @param {boolean} [withAtPrefix=false]
 * @returns {CallSite}
 */
function createCallSite(fnName, fileName, line, col, withAtPrefix = false) {
  return {
    getFileName: () => fileName,
    getLineNumber: () => line,
    getColumnNumber: () => col,
    getFunctionName: () => fnName || null,
    getTypeName: () => null,
    getMethodName: () => null,
    isNative: () => false,
    isToplevel: () => !fnName,
    isConstructor: () => false,
    toString: () =>
      withAtPrefix
        ? (fnName ? `    at ${fnName} (${fileName}:${line}:${col})` : `    at ${fileName}:${line}:${col}`)
        : (fnName ? `${fnName} (${fileName}:${line}:${col})` : `${fileName}:${line}:${col}`),
  };
}

/**
 * Parse a stack trace string into CallSite array.
 * Supports V8 format: "    at functionName (file:line:col)"
 * Supports Safari format: "functionName@file:line:col"
 * @param {string} stack
 * @returns {CallSite[]}
 */
function parseStack(stack) {
  const lines = stack.split('\n');
  const sites = [];

  for (const line of lines) {
    const trimmed = line.trim();
    let match;

    // V8: "at functionName (file:line:col)" or "at file:line:col"
    match = trimmed.match(/^at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/);
    if (match) {
      sites.push(createCallSite(match[1] || '', match[2], +match[3], +match[4], true));
      continue;
    }

    // Safari/Firefox: "functionName@file:line:col" or "@file:line:col"
    match = trimmed.match(/^(.*)@(.+?):(\d+):(\d+)$/);
    if (match) {
      sites.push(createCallSite(match[1] || '', match[2], +match[3], +match[4], true));
    }
  }
  return sites;
}

function formatFrame(site) {
  const rendered = site.toString();
  return /^\s*at\s+/.test(rendered) ? rendered : `    at ${rendered}`;
}

/**
 * Install the polyfill on a target object.
 * Skips installation if a native (non-polyfill) captureStackTrace exists.
 * @param {object} [target=globalThis] - Installation target
 */
function installStackTracePolyfill(target = globalThis) {
  const ErrorCtor = target.Error || Error;

  // Native implementation or an already-installed polyfill exists — skip.
  if (typeof ErrorCtor.captureStackTrace === 'function') {
    return;
  }

  if (!ErrorCtor.stackTraceLimit) {
    ErrorCtor.stackTraceLimit = 10;
  }

  ErrorCtor.captureStackTrace = function captureStackTrace(targetObj, constructorOpt) {
    const rawErr = new Error();
    const rawStack = rawErr.stack || '';
    targetObj[RAW_STACK] = rawStack;
    targetObj[PREPARED] = false;

    Object.defineProperty(targetObj, 'stack', {
      configurable: true,
      enumerable: false,
      get() {
        if (this[PREPARED]) return this._preparedStack;
        this[PREPARED] = true;
        let sites = parseStack(this[RAW_STACK]);

        // If constructorOpt provided, drop frames at and above it
        if (constructorOpt && constructorOpt.name) {
          const idx = sites.findIndex(
            (s) => s.getFunctionName() === constructorOpt.name,
          );
          if (idx !== -1) sites = sites.slice(idx + 1);
        }

        // Respect stackTraceLimit
        const limit = ErrorCtor.stackTraceLimit || 10;
        sites = sites.slice(0, limit);

        if (typeof ErrorCtor.prepareStackTrace === 'function') {
          this._preparedStack = ErrorCtor.prepareStackTrace(this, sites);
        } else {
          const name = typeof this.name === 'string' && this.name ? this.name : 'Error';
          const message = typeof this.message === 'string' ? this.message : '';
          const header = message ? `${name}: ${message}` : name;
          const frames = sites.map((site) => formatFrame(site));
          this._preparedStack = [header, ...frames].join('\n');
        }
        return this._preparedStack;
      },
      set(val) {
        this._preparedStack = val;
        this[PREPARED] = true;
      },
    });
  };
  ErrorCtor.captureStackTrace.__polyfill = true;
}

/**
 * Backward-compatible alias used by older imports.
 * @param {object} [target]
 */
function setupErrorStackTracePolyfill(target = globalThis) {
  installStackTracePolyfill(target);
}

export { parseStack, createCallSite, installStackTracePolyfill, setupErrorStackTracePolyfill, RAW_STACK };
