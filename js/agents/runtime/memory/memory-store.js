/**
 * Compatibility entrypoint.
 *
 * The implementation lives in `memory-store.impl.js` with retrieval logic
 * extracted into `retrieval-engine.js`.
 */

/**
 * MemoryStore class re-export.
 * @param {ConstructorParameters<typeof import("./memory-store.impl.js").MemoryStore>[0]} [options]
 * @returns {import("./memory-store.impl.js").MemoryStore}
 */
export { MemoryStore, default } from "./memory-store.impl.js";
