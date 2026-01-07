/**
 * EventBus - 兼容层
 *
 * 重新导出 core/event-bus，保持旧代码兼容
 */

/**
 * @typedef {Parameters<typeof import("../../core/event-bus.js").createEventRecord>[0]} CreateEventRecordOptions
 * @typedef {ReturnType<typeof import("../../core/event-bus.js").createEventRecord>} EventRecord
 */

// 重新导出统一的 EventBus
/**
 * @param {ConstructorParameters<typeof import("../../core/event-bus.js").EventBus>[0]} [options]
 * @returns {import("../../core/event-bus.js").EventBus}
 */
export { EventBus } from "../../core/event-bus.js";
export { LamportClock } from "../../core/event-bus.js";

/**
 * @param {CreateEventRecordOptions} [options]
 * @returns {EventRecord}
 */
export { createEventRecord } from "../../core/event-bus.js";

/**
 * @param {unknown} name
 * @returns {boolean}
 */
export { isValidEventName } from "../../core/event-bus.js";

/**
 * @param {string} pattern
 * @param {string} eventName
 * @returns {boolean}
 */
export { matchPattern } from "../../core/event-bus.js";

/**
 * @param {ConstructorParameters<typeof import("../../core/event-bus.js").EventBus>[0]} [options]
 * @returns {import("../../core/event-bus.js").EventBus}
 */
export { EventBus as default } from "../../core/event-bus.js";

// 兼容旧的 createEventId
/**
 * @param {CreateEventRecordOptions} [options]
 * @returns {EventRecord}
 */
export { createEventRecord as createEventId } from "../../core/event-bus.js";

// 重新导出 matchEventPattern（兼容旧名称）
/**
 * @param {string} pattern
 * @param {string} eventName
 * @returns {boolean}
 */
export { matchPattern as matchEventPattern } from "../../core/event-bus.js";
