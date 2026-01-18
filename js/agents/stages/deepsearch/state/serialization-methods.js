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

/** Maximum allowed length for serialized state input (1MB). */
const MAX_DESERIALIZE_LENGTH = 1024 * 1024;

/**
 * Parse a serialized JSON string and delegate to the receiver's `fromJSON`.
 *
 * Intended to be used as a static method, e.g. `DeepSearchState.deserialize(text)`.
 *
 * @this {{ fromJSON: (json: object) => object }}
 * @param {string} text - Serialized JSON string to parse.
 * @returns {object} Deserialized state object.
 * @throws {TypeError} If text is not a non-empty string or exceeds size limit.
 * @throws {SyntaxError} If text is not valid JSON.
 */
export function deserialize(text) {
  if (typeof text !== "string" || text.length === 0) {
    throw new TypeError("deserialize: input must be a non-empty string");
  }
  if (text.length > MAX_DESERIALIZE_LENGTH) {
    throw new TypeError(`deserialize: input exceeds maximum length (${MAX_DESERIALIZE_LENGTH} bytes)`);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new SyntaxError(`deserialize: invalid JSON - ${err instanceof Error ? err.message : String(err)}`);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new TypeError("deserialize: parsed value must be an object");
  }
  return this.fromJSON(parsed);
}
