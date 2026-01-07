export {
  EventBus,
  createEventId,
  createEventRecord,
  isValidEventName,
} from "./events/event-bus.js";

/**
 * @typedef {object} RunStoreAdapter
 * @property {Function} [save]
 * @property {Function} [load]
 */

/** @type {any} */
export const RunStoreAdapter = {};

