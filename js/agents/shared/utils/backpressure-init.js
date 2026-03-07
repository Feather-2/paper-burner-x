/**
 * @fileoverview Shared backpressure initialization for EventBus.
 */

/**
 * @typedef {{
 *   enableBackpressure?: (config: {
 *     coalescePattern?: RegExp,
 *     deferNonCoalesced?: boolean,
 *     maxQueueSize?: number,
 *     dropPolicy?: "oldest" | "newest"
 *   }) => void,
 *   _backpressure?: { enabled?: boolean }
 * }} BackpressureCapableEventBus
 */

/**
 * Enable backpressure on an EventBus instance (best-effort, no-throw).
 * @param {unknown} eventBus
 * @param {object|boolean|undefined} cfg - backpressure config or false to skip
 */
export function enableBackpressureIfNeeded(eventBus, cfg) {
  const bus = eventBus && typeof eventBus === "object"
    ? /** @type {BackpressureCapableEventBus} */ (eventBus)
    : null;
  if (!bus || typeof bus.enableBackpressure !== "function") return;
  if (bus._backpressure?.enabled) return;
  if (cfg === false) return;
  const opts = cfg && typeof cfg === "object" && !Array.isArray(cfg) ? cfg : {};
  try {
    bus.enableBackpressure({
      coalescePattern: /\.progress$/,
      deferNonCoalesced: false,
      maxQueueSize: 10000,
      ...opts,
    });
  } catch {
    // best-effort
  }
}
