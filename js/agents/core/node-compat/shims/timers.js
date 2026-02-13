/**
 * timers shim - Wraps browser timer functions
 * Provides Node.js-compatible timer API
 */

export const setTimeout = globalThis.setTimeout;
export const clearTimeout = globalThis.clearTimeout;
export const setInterval = globalThis.setInterval;
export const clearInterval = globalThis.clearInterval;

export function setImmediate(fn, ...args) {
  return setTimeout(fn, 0, ...args);
}

export const clearImmediate = clearTimeout;

export default {
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  setImmediate,
  clearImmediate,
};
