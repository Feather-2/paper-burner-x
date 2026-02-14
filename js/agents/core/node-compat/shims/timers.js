/**
 * timers shim - Wraps browser timer functions
 * Provides Node.js-compatible timer API with proper event loop semantics
 */

export const setTimeout = globalThis.setTimeout;
export const clearTimeout = globalThis.clearTimeout;
export const setInterval = globalThis.setInterval;
export const clearInterval = globalThis.clearInterval;

// setImmediate implementation using MessageChannel for proper priority
// Runs in check phase (after I/O, before next timer phase)
const immediateQueue = [];
let immediateIdCounter = 1;
let isProcessingImmediate = false;

// Use MessageChannel for better timing than setTimeout(0)
const channel = typeof MessageChannel !== 'undefined' ? new MessageChannel() : null;
if (channel) {
  channel.port1.onmessage = () => {
    if (isProcessingImmediate) return;
    isProcessingImmediate = true;
    const queue = immediateQueue.splice(0);
    for (const item of queue) {
      if (item && item.fn) {
        try { item.fn(...item.args); } catch (err) { console.error('setImmediate error:', err); }
      }
    }
    isProcessingImmediate = false;
  };
}

export function setImmediate(fn, ...args) {
  const id = immediateIdCounter++;
  immediateQueue.push({ id, fn, args });

  if (channel) {
    channel.port2.postMessage(null);
  } else {
    // Fallback to setTimeout(0) if MessageChannel unavailable
    setTimeout(() => {
      const idx = immediateQueue.findIndex(item => item && item.id === id);
      if (idx !== -1) {
        const item = immediateQueue.splice(idx, 1)[0];
        try { item.fn(...item.args); } catch (err) { console.error('setImmediate error:', err); }
      }
    }, 0);
  }

  return id;
}

export function clearImmediate(id) {
  const idx = immediateQueue.findIndex(item => item && item.id === id);
  if (idx !== -1) immediateQueue.splice(idx, 1);
}

export default {
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  setImmediate,
  clearImmediate,
};
