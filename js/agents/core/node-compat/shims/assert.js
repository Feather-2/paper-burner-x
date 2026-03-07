/**
 * Node.js assert module shim
 * Provides assertion testing utilities
 */

/**
 * @typedef {Object} AssertionErrorOptions
 * @property {string} [message]
 * @property {*} [actual]
 * @property {*} [expected]
 * @property {string} [operator]
 * @property {Function} [stackStartFn]
 */

/**
 * @typedef {Error & { code?: string }} ErrorWithCode
 */

/**
 * @param {unknown} value
 * @returns {value is ErrorWithCode}
 */
function hasErrorCode(value) {
  return !!value && typeof value === 'object' && 'code' in value;
}

/**
 * AssertionError class - thrown when an assertion fails
 */
export class AssertionError extends Error {
  /**
   * @param {AssertionErrorOptions} options
   */
  constructor(options) {
    const message = options.message ||
      `${JSON.stringify(options.actual)} ${options.operator || '=='} ${JSON.stringify(options.expected)}`;
    super(message);
    this.name = 'AssertionError';
    this.actual = options.actual;
    this.expected = options.expected;
    this.operator = options.operator || '';
    this.generatedMessage = !options.message;
    this.code = 'ERR_ASSERTION';

    if (Error.captureStackTrace && options.stackStartFn) {
      Error.captureStackTrace(this, options.stackStartFn);
    }
  }
}

/**
 * Deep equality check
 * @param {*} actual
 * @param {*} expected
 * @returns {boolean}
 */
function isDeepStrictEqual(actual, expected) {
  if (actual === expected) return true;
  if (actual === null || expected === null || actual === undefined || expected === undefined) {
    return actual === expected;
  }
  if (typeof actual !== typeof expected) return false;
  if (typeof actual === 'number' && Number.isNaN(actual) && Number.isNaN(expected)) {
    return true;
  }
  if (actual instanceof Date && expected instanceof Date) {
    return actual.getTime() === expected.getTime();
  }
  if (actual instanceof RegExp && expected instanceof RegExp) {
    return actual.source === expected.source && actual.flags === expected.flags;
  }
  if (Array.isArray(actual) && Array.isArray(expected)) {
    if (actual.length !== expected.length) return false;
    for (let i = 0; i < actual.length; i++) {
      if (!isDeepStrictEqual(actual[i], expected[i])) return false;
    }
    return true;
  }
  if (actual instanceof Uint8Array && expected instanceof Uint8Array) {
    if (actual.length !== expected.length) return false;
    for (let i = 0; i < actual.length; i++) {
      if (actual[i] !== expected[i]) return false;
    }
    return true;
  }
  if (actual instanceof Map && expected instanceof Map) {
    if (actual.size !== expected.size) return false;
    const actualEntries = Array.from(actual.entries());
    for (let i = 0; i < actualEntries.length; i++) {
      const [key, value] = actualEntries[i];
      if (!expected.has(key) || !isDeepStrictEqual(value, expected.get(key))) {
        return false;
      }
    }
    return true;
  }
  if (actual instanceof Set && expected instanceof Set) {
    if (actual.size !== expected.size) return false;
    const actualValues = Array.from(actual.values());
    const expectedValues = Array.from(expected.values());
    for (let i = 0; i < actualValues.length; i++) {
      const value = actualValues[i];
      if (!expected.has(value)) {
        let found = false;
        for (let j = 0; j < expectedValues.length; j++) {
          if (isDeepStrictEqual(value, expectedValues[j])) {
            found = true;
            break;
          }
        }
        if (!found) return false;
      }
    }
    return true;
  }
  if (typeof actual === 'object' && typeof expected === 'object') {
    const actualKeys = Object.keys(actual);
    const expectedKeys = Object.keys(expected);
    if (actualKeys.length !== expectedKeys.length) return false;
    for (const key of actualKeys) {
      if (!Object.prototype.hasOwnProperty.call(expected, key)) return false;
      if (!isDeepStrictEqual(actual[key], expected[key])) return false;
    }
    return true;
  }
  return false;
}

/**
 * Main assert function - tests if value is truthy
 * @param {*} value
 * @param {string|Error} [message]
 */
function assert(value, message) {
  if (!value) {
    if (message instanceof Error) throw message;
    throw new AssertionError({
      message: message || 'The expression evaluated to a falsy value',
      actual: value,
      expected: true,
      operator: '==',
      stackStartFn: assert,
    });
  }
}

/**
 * Alias for assert()
 * @param {*} value
 * @param {string|Error} [message]
 */
assert.ok = function ok(value, message) {
  if (!value) {
    if (message instanceof Error) throw message;
    throw new AssertionError({
      message: message || 'The expression evaluated to a falsy value',
      actual: value,
      expected: true,
      operator: '==',
      stackStartFn: ok,
    });
  }
};

/**
 * Tests strict equality (===)
 * @param {*} actual
 * @param {*} expected
 * @param {string|Error} [message]
 */
assert.strictEqual = function strictEqual(actual, expected, message) {
  if (actual !== expected) {
    if (message instanceof Error) throw message;
    throw new AssertionError({
      message,
      actual,
      expected,
      operator: '===',
      stackStartFn: strictEqual,
    });
  }
};

/**
 * Tests strict inequality (!==)
 * @param {*} actual
 * @param {*} expected
 * @param {string|Error} [message]
 */
assert.notStrictEqual = function notStrictEqual(actual, expected, message) {
  if (actual === expected) {
    if (message instanceof Error) throw message;
    throw new AssertionError({
      message,
      actual,
      expected,
      operator: '!==',
      stackStartFn: notStrictEqual,
    });
  }
};

/**
 * Tests deep strict equality
 * @param {*} actual
 * @param {*} expected
 * @param {string|Error} [message]
 */
assert.deepStrictEqual = function deepStrictEqual(actual, expected, message) {
  if (!isDeepStrictEqual(actual, expected)) {
    if (message instanceof Error) throw message;
    throw new AssertionError({
      message,
      actual,
      expected,
      operator: 'deepStrictEqual',
      stackStartFn: deepStrictEqual,
    });
  }
};

/**
 * Tests deep strict inequality
 * @param {*} actual
 * @param {*} expected
 * @param {string|Error} [message]
 */
assert.notDeepStrictEqual = function notDeepStrictEqual(actual, expected, message) {
  if (isDeepStrictEqual(actual, expected)) {
    if (message instanceof Error) throw message;
    throw new AssertionError({
      message,
      actual,
      expected,
      operator: 'notDeepStrictEqual',
      stackStartFn: notDeepStrictEqual,
    });
  }
};

/**
 * Expects function to throw an error
 * @param {Function} fn
 * @param {RegExp|Function|Error|{message?: RegExp|string, code?: string}|string} [errorOrMessage]
 * @param {string} [message]
 */
assert.throws = function throws(fn, errorOrMessage, message) {
  let threw = false;
  let thrownError;

  try {
    fn();
  } catch (err) {
    threw = true;
    thrownError = err;
  }

  if (!threw) {
    throw new AssertionError({
      message: typeof errorOrMessage === 'string' ? errorOrMessage : (message || 'Expected function to throw'),
      actual: undefined,
      expected: errorOrMessage,
      operator: 'throws',
      stackStartFn: throws,
    });
  }

  if (errorOrMessage !== undefined && typeof errorOrMessage !== 'string') {
    if (errorOrMessage instanceof RegExp) {
      const errMessage = thrownError instanceof Error ? thrownError.message : String(thrownError);
      if (!errorOrMessage.test(errMessage)) {
        throw new AssertionError({
          message: message || 'The error message did not match the regular expression',
          actual: thrownError,
          expected: errorOrMessage,
          operator: 'throws',
          stackStartFn: throws,
        });
      }
    } else if (typeof errorOrMessage === 'function') {
      if (!(thrownError instanceof errorOrMessage)) {
        throw new AssertionError({
          message: message || 'The error is not an instance of the expected type',
          actual: thrownError,
          expected: errorOrMessage,
          operator: 'throws',
          stackStartFn: throws,
        });
      }
    } else if (typeof errorOrMessage === 'object') {
      /** @type {{ message?: string | RegExp, code?: string }} */
      const expected = errorOrMessage || {};
      const err = thrownError;

      if (expected.message !== undefined) {
        const errMsg = err.message || String(thrownError);
        if (expected.message instanceof RegExp) {
          if (!expected.message.test(errMsg)) {
            throw new AssertionError({
              message: message || 'The error message did not match',
              actual: errMsg,
              expected: expected.message,
              operator: 'throws',
              stackStartFn: throws,
            });
          }
        } else if (errMsg !== expected.message) {
          throw new AssertionError({
            message: message || 'The error message did not match',
            actual: errMsg,
            expected: expected.message,
            operator: 'throws',
            stackStartFn: throws,
          });
        }
      }

      if (expected.code !== undefined && (!hasErrorCode(err) || err.code !== expected.code)) {
        throw new AssertionError({
          message: message || 'The error code did not match',
          actual: hasErrorCode(err) ? err.code : undefined,
          expected: expected.code,
          operator: 'throws',
          stackStartFn: throws,
        });
      }
    }
  }
};

/**
 * Expects function to not throw an error
 * @param {Function} fn
 * @param {RegExp|Function|string} [errorOrMessage]
 * @param {string} [message]
 */
assert.doesNotThrow = function doesNotThrow(fn, errorOrMessage, message) {
  try {
    fn();
  } catch (err) {
    if (errorOrMessage === undefined || typeof errorOrMessage === 'string') {
      throw new AssertionError({
        message: typeof errorOrMessage === 'string' ? errorOrMessage : (message || 'Expected function not to throw'),
        actual: err,
        expected: undefined,
        operator: 'doesNotThrow',
        stackStartFn: doesNotThrow,
      });
    }

    if (errorOrMessage instanceof RegExp) {
      const errMessage = err instanceof Error ? err.message : String(err);
      if (errorOrMessage.test(errMessage)) {
        throw new AssertionError({
          message: message || 'Expected function not to throw matching error',
          actual: err,
          expected: errorOrMessage,
          operator: 'doesNotThrow',
          stackStartFn: doesNotThrow,
        });
      }
    } else if (typeof errorOrMessage === 'function') {
      if (err instanceof errorOrMessage) {
        throw new AssertionError({
          message: message || 'Expected function not to throw error of this type',
          actual: err,
          expected: errorOrMessage,
          operator: 'doesNotThrow',
          stackStartFn: doesNotThrow,
        });
      }
    }
  }
};

/**
 * Expects promise to reject
 * @param {Promise<*>|Function} asyncFn
 * @param {RegExp|Function|Error|{message?: RegExp|string, code?: string}|string} [errorOrMessage]
 * @param {string} [message]
 * @returns {Promise<void>}
 */
assert.rejects = async function rejects(asyncFn, errorOrMessage, message) {
  const promise = typeof asyncFn === 'function' ? asyncFn() : asyncFn;

  let rejected = false;
  let rejectionReason;

  try {
    await promise;
  } catch (err) {
    rejected = true;
    rejectionReason = err;
  }

  if (!rejected) {
    throw new AssertionError({
      message: typeof errorOrMessage === 'string' ? errorOrMessage : (message || 'Expected promise to reject'),
      actual: undefined,
      expected: errorOrMessage,
      operator: 'rejects',
      stackStartFn: rejects,
    });
  }

  if (errorOrMessage !== undefined && typeof errorOrMessage !== 'string') {
    if (errorOrMessage instanceof RegExp) {
      const errMessage = rejectionReason instanceof Error ? rejectionReason.message : String(rejectionReason);
      if (!errorOrMessage.test(errMessage)) {
        throw new AssertionError({
          message: message || 'The rejection message did not match the regular expression',
          actual: rejectionReason,
          expected: errorOrMessage,
          operator: 'rejects',
          stackStartFn: rejects,
        });
      }
    } else if (typeof errorOrMessage === 'function') {
      if (!(rejectionReason instanceof errorOrMessage)) {
        throw new AssertionError({
          message: message || 'The rejection is not an instance of the expected type',
          actual: rejectionReason,
          expected: errorOrMessage,
          operator: 'rejects',
          stackStartFn: rejects,
        });
      }
    } else if (typeof errorOrMessage === 'object') {
      /** @type {{ message?: string | RegExp, code?: string }} */
      const expected = errorOrMessage || {};
      const err = rejectionReason;

      if (expected.message !== undefined) {
        const errMsg = err.message || String(rejectionReason);
        if (expected.message instanceof RegExp) {
          if (!expected.message.test(errMsg)) {
            throw new AssertionError({
              message: message || 'The rejection message did not match',
              actual: errMsg,
              expected: expected.message,
              operator: 'rejects',
              stackStartFn: rejects,
            });
          }
        } else if (errMsg !== expected.message) {
          throw new AssertionError({
            message: message || 'The rejection message did not match',
            actual: errMsg,
            expected: expected.message,
            operator: 'rejects',
            stackStartFn: rejects,
          });
        }
      }

      if (expected.code !== undefined && (!hasErrorCode(err) || err.code !== expected.code)) {
        throw new AssertionError({
          message: message || 'The rejection code did not match',
          actual: hasErrorCode(err) ? err.code : undefined,
          expected: expected.code,
          operator: 'rejects',
          stackStartFn: rejects,
        });
      }
    }
  }
};

/**
 * Expects promise to not reject
 * @param {Promise<*>|Function} asyncFn
 * @param {RegExp|Function|string} [errorOrMessage]
 * @param {string} [message]
 * @returns {Promise<void>}
 */
assert.doesNotReject = async function doesNotReject(asyncFn, errorOrMessage, message) {
  const promise = typeof asyncFn === 'function' ? asyncFn() : asyncFn;

  try {
    await promise;
  } catch (err) {
    if (errorOrMessage === undefined || typeof errorOrMessage === 'string') {
      throw new AssertionError({
        message: typeof errorOrMessage === 'string' ? errorOrMessage : (message || 'Expected promise not to reject'),
        actual: err,
        expected: undefined,
        operator: 'doesNotReject',
        stackStartFn: doesNotReject,
      });
    }

    if (errorOrMessage instanceof RegExp) {
      const errMessage = err instanceof Error ? err.message : String(err);
      if (errorOrMessage.test(errMessage)) {
        throw new AssertionError({
          message: message || 'Expected promise not to reject with matching error',
          actual: err,
          expected: errorOrMessage,
          operator: 'doesNotReject',
          stackStartFn: doesNotReject,
        });
      }
    } else if (typeof errorOrMessage === 'function') {
      if (err instanceof errorOrMessage) {
        throw new AssertionError({
          message: message || 'Expected promise not to reject with error of this type',
          actual: err,
          expected: errorOrMessage,
          operator: 'doesNotReject',
          stackStartFn: doesNotReject,
        });
      }
    }
  }
};

/**
 * Throws an AssertionError
 * @param {string|*} [messageOrActual]
 * @param {*} [expected]
 * @param {string} [message]
 * @param {string} [operator]
 */
assert.fail = function fail(messageOrActual, expected, message, operator) {
  if (arguments.length === 0 || arguments.length === 1) {
    throw new AssertionError({
      message: typeof messageOrActual === 'string' ? messageOrActual : 'Failed',
      stackStartFn: fail,
    });
  }

  throw new AssertionError({
    message,
    actual: messageOrActual,
    expected,
    operator: operator || 'fail',
    stackStartFn: fail,
  });
};

/**
 * Tests if string matches regular expression
 * @param {string} string
 * @param {RegExp} regexp
 * @param {string|Error} [message]
 */
assert.match = function match(string, regexp, message) {
  if (!regexp.test(string)) {
    if (message instanceof Error) throw message;
    throw new AssertionError({
      message: message || 'The input did not match the regular expression',
      actual: string,
      expected: regexp,
      operator: 'match',
      stackStartFn: match,
    });
  }
};

/**
 * Tests if string does not match regular expression
 * @param {string} string
 * @param {RegExp} regexp
 * @param {string|Error} [message]
 */
assert.doesNotMatch = function doesNotMatch(string, regexp, message) {
  if (regexp.test(string)) {
    if (message instanceof Error) throw message;
    throw new AssertionError({
      message: message || 'The input was expected not to match the regular expression',
      actual: string,
      expected: regexp,
      operator: 'doesNotMatch',
      stackStartFn: doesNotMatch,
    });
  }
};

/**
 * Throws if value is truthy (used for error-first callback patterns)
 * @param {*} value
 */
assert.ifError = function ifError(value) {
  if (value !== null && value !== undefined) {
    if (value instanceof Error) throw value;
    throw new AssertionError({
      message: `ifError got unwanted exception: ${value}`,
      actual: value,
      expected: null,
      operator: 'ifError',
      stackStartFn: ifError,
    });
  }
};

assert.AssertionError = AssertionError;
assert.strict = assert;

export default assert;
export { assert };
