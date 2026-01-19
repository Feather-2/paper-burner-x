/**
 * Compatibility entrypoint.
 *
 * The implementation lives in `memory-store.impl.js` with retrieval logic
 * extracted into `retrieval-engine.js`.
 */

/**
 * @typedef {object} MemoryStoreOptions
 * @property {string} [runId] - Run ID
 * @property {object} [config] - Configuration overrides
 * @property {object} [eventBus] - EventBus instance
 * @property {object} [archiveAdapter] - Archive adapter
 * @property {object} [tokenCounter] - Token counter (null to disable)
 * @property {object} [embeddingService] - Embedding service
 * @property {object} [vectorIndex] - Vector index
 * @property {object} [retrievalEngine] - Retrieval engine
 * @property {object} [sharedContext] - Shared context
 * @property {object} [discoveryManager] - Discovery manager
 * @property {object} [l3Storage] - L3 storage instance
 * @property {object} [vfs] - Virtual file system
 */

/**
 * MemoryStore class re-export.
 * @param {MemoryStoreOptions} [options]
 * @returns {import("./memory-store.impl.js").MemoryStore}
 */
export { MemoryStore, default } from "./memory-store.impl.js";
