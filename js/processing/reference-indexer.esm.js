import './reference-indexer.js';

const root = globalThis;
const instance = root.ReferenceIndexer;

if (root.window && !root.window.ReferenceIndexer && instance) {
  root.window.ReferenceIndexer = instance;
}

export const ReferenceIndexer = instance ? instance.constructor : undefined;
export default instance;

