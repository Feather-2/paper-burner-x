import { toSnapshot } from "./serializer.js";

/**
 * @typedef {object} SnapshotOptions
 * @property {boolean=} includeCheckpoints
 */

/**
 * @typedef {object} SerializeOptions
 * @property {boolean=} pretty
 */

/**
 * @typedef {object} SerializationMethodsThis
 * @property {(options?: { includeCheckpoints?: boolean }) => any} toJSON
 * @property {(options?: SnapshotOptions) => any} toSnapshot
 * @property {{ fromJSON: (json: any) => any }} constructor
 */

export const serializationMethods = {
  /**
   * Build a clone-safe snapshot object for persistence.
   *
   * @this {SerializationMethodsThis}
   * @param {SnapshotOptions=} options
   * @returns {any}
   */
  toSnapshot({ includeCheckpoints = true } = {}) {
    return toSnapshot(this, { includeCheckpoints });
  },

  /**
   * @this {SerializationMethodsThis}
   * @param {SerializeOptions=} options
   * @returns {string}
   */
  serialize({ pretty = false } = {}) {
    return JSON.stringify(this.toJSON(), null, pretty ? 2 : 0);
  },

  /**
   * Clone via `toSnapshot()` + static `fromJSON()`.
   *
   * @this {SerializationMethodsThis}
   * @param {SnapshotOptions=} options
   * @returns {any}
   */
  clone({ includeCheckpoints = true } = {}) {
    const snapshotObj = this.toSnapshot({ includeCheckpoints });
    return /** @type {any} */ (this.constructor).fromJSON(snapshotObj);
  },
};

/**
 * Parse a serialized JSON string and delegate to the receiver's `fromJSON`.
 *
 * Intended to be used as a static method, e.g. `DeepSearchState.deserialize(text)`.
 *
 * @this {{ fromJSON: (json: any) => any }}
 * @param {any} text
 * @returns {any}
 */
export function deserialize(text) {
  const parsed = JSON.parse(String(text || ""));
  return this.fromJSON(parsed);
}
