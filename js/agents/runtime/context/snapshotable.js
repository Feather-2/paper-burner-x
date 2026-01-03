/**
 * Snapshotable - protocol for components that can be snapshotted/restored.
 *
 * This interface is intentionally agnostic to any internal state layout (e.g. L0/L1/L2).
 * Consumers should treat the returned snapshot as an opaque, versioned object owned
 * by the implementing component.
 *
 * @typedef {object} Snapshotable
 * @property {(options?: any) => object} toSnapshot
 * @property {(snapshot: object) => void} fromSnapshot
 */

/**
 * Runtime guard for Snapshotable.
 *
 * @param {any} value
 * @returns {value is Snapshotable}
 */
export function isSnapshotable(value) {
  return Boolean(value) && typeof value.toSnapshot === "function" && typeof value.fromSnapshot === "function";
}

/**
 * Runtime assertion for Snapshotable.
 *
 * @param {any} value
 * @param {string} [label]
 * @returns {Snapshotable}
 */
export function assertSnapshotable(value, label = "value") {
  if (!value) throw new TypeError(`${label} is required`);
  if (typeof value.toSnapshot !== "function") throw new TypeError(`${label}.toSnapshot must be a function`);
  if (typeof value.fromSnapshot !== "function") throw new TypeError(`${label}.fromSnapshot must be a function`);
  return value;
}

