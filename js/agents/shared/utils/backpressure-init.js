/**
 * @fileoverview Shared backpressure initialization for EventBus.
 */

/**
 * Enable backpressure on an EventBus instance (best-effort, no-throw).
 * @param {import('../../core/event-bus.js').EventBus} eventBus
 * @param {object|boolean|undefined} cfg - backpressure config or false to skip
 */
export function enableBackpressureIfNeeded(eventBus, cfg) {
  if (!eventBus || typeof eventBus.enableBackpressure !== "function") return;
  if (eventBus._backpressure?.enabled) return;
  if (cfg === false) return;
  const opts = cfg && typeof cfg === "object" && !Array.isArray(cfg) ? cfg : {};
  try {
    eventBus.enableBackpressure({
      coalescePattern: /\.progress$/,
      deferNonCoalesced: false,
      maxQueueSize: 10000,
      ...opts,
    });
  } catch {
    // best-effort
  }
}
