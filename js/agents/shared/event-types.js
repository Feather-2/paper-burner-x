// js/agents/shared/event-types.js
// Event payload typedefs (JSDoc)

/**
 * @typedef {Object} ReviewEventPayload
 * @property {string} stageId
 * @property {boolean} pass
 * @property {'error'|'warning'|'info'} severity
 * @property {string} reason
 */

/**
 * @typedef {Object} CompressionEventPayload
 * @property {string} stageId
 * @property {'scheduled'|'applied'|'failed'} status
 * @property {number} [priority]
 */

/**
 * @typedef {Object} ArchiveEventPayload
 * @property {string} runId
 * @property {string} checkpointId
 * @property {string} timestamp
 * @property {Object} [nodeStates]
 */

export {};
