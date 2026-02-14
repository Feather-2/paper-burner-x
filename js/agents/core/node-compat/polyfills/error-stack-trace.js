/**
 * Error.captureStackTrace polyfill for Safari/Firefox.
 * Ported from almostnode runtime.ts:976-1108.
 *
 * @module error-stack-trace
 */

/**
 * @typedef {object} CallSite
 * @property {() => string|null} getFileName
 * @property {() => number|null} getLineNumber
 * @property {() => number|null} getColumnNumber
 * @property {() => string|null} getFunctionName
 * @property {() => string|null} getTypeName
 * @property {() => string|null} getMethodName
 * @property {() => boolean} isNative
 * @property {() => boolean} isToplevel
 * @property {() => boolean} isConstructor
 * @property {() => string} toString
 */

/**
 * Parse Safari format: functionName@file:line:col or @file:line:col
 * @param {string} line
 * @returns {CallSite|null}
 */
function parseSafariStackLine(line) {
  const match = line.match(/^(.*)@(.+?):(\d+):(\d+)$/);
  if (!match) return null;

  const [, fnName, fileName, lineNum, colNum] = match;
  return createCallSite(fnName || null, fileName, +lineNum, +colNum);
}

/**
 * Parse Chrome format: at functionName (file:line:col) or at file:line:col
 * @param {string} line
 * @returns {CallSite|null}
 */
function parseChromeStackLine(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('at ')) return null;

  // at functionName (file:line:col)
  let match = trimmed.match(/^at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)$/);
  if (match) {
    const [, fnName, fileName, lineNum, colNum] = match;
    return createCallSite(fnName, fileName, +lineNum, +colNum);
  }

  // at file:line:col
  match = trimmed.match(/^at\s+(.+?):(\d+):(\d+)$/);
  if (match) {
    const [, fileName, lineNum, colNum] = match;
    return createCallSite(null, fileName, +lineNum, +colNum);
  }

  return null;
}

/**
 * Create a CallSite object.
 * @param {string|null} fnName
 * @param {string} fileName
 * @param {number} line
 * @param {number} col
 * @returns {CallSite}
 */
function createCallSite(fnName, fileName, line, col) {
  return {
    getFileName: () => fileName,
    getLineNumber: () => line,
    getColumnNumber: () => col,
    getFunctionName: () => fnName,
    getTypeName: () => null,
    getMethodName: () => null,
    isNative: () => false,
    isToplevel: () => !fnName,
    isConstructor: () => false,
    toString: () =>
      fnName ? `    at ${fnName} (${fileName}:${line}:${col})` : `    at ${fileName}:${line}:${col}`,
  };
}

/**
 * Parse stack trace string into CallSite array.
 * @param {string} stack
 * @returns {CallSite[]}
 */
function parseStackTrace(stack) {
  const lines = stack.split('\n');
  const sites = [];

  for (const line of lines) {
    if (!line.trim()) continue;

    // Try Chrome format first
    let site = parseChromeStackLine(line);
    if (site) {
      sites.push(site);
      continue;
    }

    // Try Safari format
    site = parseSafariStackLine(line);
    if (site) {
      sites.push(site);
    }
  }

  return sites;
}

/**
 * Setup Error.captureStackTrace polyfill.
 * @param {object} [target=globalThis] - Target object (usually globalThis or Error)
 */
export function setupErrorStackTracePolyfill(target = globalThis) {
  const ErrorCtor = target.Error || Error;

  // Skip if native implementation exists
  if (typeof ErrorCtor.captureStackTrace === 'function') {
    return;
  }

  // Set default stackTraceLimit
  if (!ErrorCtor.stackTraceLimit) {
    ErrorCtor.stackTraceLimit = 10;
  }

  /**
   * Capture stack trace and attach to target object.
   * @param {object} targetObject - Object to attach stack to
   * @param {Function} [constructorOpt] - Constructor to hide frames above
   */
  ErrorCtor.captureStackTrace = function captureStackTrace(targetObject, constructorOpt) {
    // Capture raw stack
    const err = new Error();
    const rawStack = err.stack || '';

    // Parse into CallSite array
    let callSites = parseStackTrace(rawStack);

    // Remove frames at and above constructorOpt
    if (constructorOpt && constructorOpt.name) {
      const idx = callSites.findIndex(site => site.getFunctionName() === constructorOpt.name);
      if (idx !== -1) {
        callSites = callSites.slice(idx + 1);
      }
    }

    // Apply stackTraceLimit
    const limit = ErrorCtor.stackTraceLimit || 10;
    callSites = callSites.slice(0, limit);

    // Define stack property with custom formatter support
    Object.defineProperty(targetObject, 'stack', {
      configurable: true,
      enumerable: false,
      get() {
        if (typeof ErrorCtor.prepareStackTrace === 'function') {
          return ErrorCtor.prepareStackTrace(this, callSites);
        }

        // Default formatting
        const name = this.name || 'Error';
        const message = this.message || '';
        const header = message ? `${name}: ${message}` : name;
        const frames = callSites.map(site => site.toString()).join('\n');
        return frames ? `${header}\n${frames}` : header;
      },
      set(value) {
        Object.defineProperty(this, 'stack', {
          configurable: true,
          enumerable: false,
          writable: true,
          value,
        });
      },
    });
  };
}
