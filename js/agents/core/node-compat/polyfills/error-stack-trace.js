/**
 * Backward-compatible stack-trace polyfill entry.
 * Keep this module thin so all callers share one implementation.
 */

import {
  setupErrorStackTracePolyfill as setupFromUnified,
  installStackTracePolyfill,
  parseStack,
  createCallSite,
  RAW_STACK,
} from "./stack-trace.js";

/**
 * @param {object} [target=globalThis]
 */
export function setupErrorStackTracePolyfill(target = globalThis) {
  setupFromUnified(target);
}

export { installStackTracePolyfill, parseStack, createCallSite, RAW_STACK };

export default {
  setupErrorStackTracePolyfill,
  installStackTracePolyfill,
  parseStack,
  createCallSite,
  RAW_STACK,
};
