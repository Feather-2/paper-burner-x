/**
 * Snapshotable - protocol for components that can be snapshotted/restored.
 *
 * This interface is intentionally agnostic to any internal state layout (e.g. L0/L1/L2).
 * Consumers should treat the returned snapshot as an opaque, versioned object owned
 * by the implementing component.
 *
 * @typedef {object} SnapshotOptions
 * @property {boolean} [includeCheckpoints] - 是否包含检查点历史
 * @property {boolean} [incremental] - 是否使用增量快照
 */

/**
 * @typedef {object} Snapshotable
 * @property {(options?: SnapshotOptions) => object} toSnapshot - 生成快照
 * @property {(snapshot: object) => void} fromSnapshot - 从快照恢复
 */

/**
 * Runtime guard for Snapshotable.
 *
 * @param {unknown} value - 待检测的值
 * @returns {value is Snapshotable}
 */
export function isSnapshotable(value) {
  return Boolean(value) && typeof value.toSnapshot === "function" && typeof value.fromSnapshot === "function";
}

/**
 * Runtime assertion for Snapshotable.
 *
 * @param {unknown} value - 待断言的值
 * @param {string} [label] - 标签（用于错误消息）
 * @returns {Snapshotable}
 * @throws {TypeError} 如果值不符合 Snapshotable 协议
 */
export function assertSnapshotable(value, label = "value") {
  if (!value) throw new TypeError(`${label} is required`);
  if (typeof value.toSnapshot !== "function") throw new TypeError(`${label}.toSnapshot must be a function`);
  if (typeof value.fromSnapshot !== "function") throw new TypeError(`${label}.fromSnapshot must be a function`);
  return value;
}

