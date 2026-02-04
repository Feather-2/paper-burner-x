import { isPlainObject } from "../../../shared/index.js";
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
    return /** @type {SerializationMethodsThis["constructor"]} */ (this.constructor).fromJSON(snapshotObj);
  },
};

/** Maximum allowed length for serialized state input (1MB). */
const MAX_DESERIALIZE_LENGTH = 1024 * 1024;

const SNAPSHOT_KEYS = new Set([
  "schemaVersion",
  "runId",
  "createdAt",
  "taskGoal",
  "userConfig",
  "planningTree",
  "trajectoryId",
  "trajectoryConfig",
  "iteration",
  "maxIterations",
  "checkpoints",
  "writeBacktrackCount",
  "writeSnapshots",
  "L0",
  "L1",
  "L2",
  "todos",
  "timeline",
]);

const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function sanitizeValue(value) {
  if (Array.isArray(value)) return value.map((entry) => sanitizeValue(entry));
  if (!isPlainObject(value)) return value;

  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (DANGEROUS_KEYS.has(key)) continue;
    out[key] = sanitizeValue(entry);
  }
  return out;
}

function sanitizeSnapshot(input) {
  const out = {};
  for (const key of SNAPSHOT_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
    out[key] = sanitizeValue(input[key]);
  }
  return out;
}

function assertStringField(snapshot, key) {
  if (key in snapshot && typeof snapshot[key] !== "string") {
    throw new TypeError(`deserialize: ${key} must be a string`);
  }
}

function assertNumberField(snapshot, key) {
  if (key in snapshot && (typeof snapshot[key] !== "number" || !Number.isFinite(snapshot[key]))) {
    throw new TypeError(`deserialize: ${key} must be a finite number`);
  }
}

function assertArrayField(snapshot, key) {
  if (key in snapshot && !Array.isArray(snapshot[key])) {
    throw new TypeError(`deserialize: ${key} must be an array`);
  }
}

function assertObjectField(snapshot, key, { allowNull = false } = {}) {
  if (!(key in snapshot)) return;
  const value = snapshot[key];
  if (value === null && allowNull) return;
  if (!isPlainObject(value)) {
    throw new TypeError(`deserialize: ${key} must be an object`);
  }
}

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

  if (!isPlainObject(parsed)) {
    throw new TypeError("deserialize: parsed value must be a plain object");
  }

  const sanitized = sanitizeSnapshot(parsed);
  assertStringField(sanitized, "schemaVersion");
  assertStringField(sanitized, "runId");
  assertStringField(sanitized, "createdAt");
  assertStringField(sanitized, "taskGoal");
  assertStringField(sanitized, "trajectoryId");
  assertNumberField(sanitized, "iteration");
  assertNumberField(sanitized, "maxIterations");
  assertNumberField(sanitized, "writeBacktrackCount");
  assertArrayField(sanitized, "checkpoints");
  assertArrayField(sanitized, "writeSnapshots");
  assertArrayField(sanitized, "todos");
  assertArrayField(sanitized, "timeline");
  assertObjectField(sanitized, "userConfig");
  assertObjectField(sanitized, "planningTree", { allowNull: true });
  assertObjectField(sanitized, "trajectoryConfig");
  assertObjectField(sanitized, "L0");
  assertObjectField(sanitized, "L1");
  assertObjectField(sanitized, "L2");

  return this.fromJSON(sanitized);
}
