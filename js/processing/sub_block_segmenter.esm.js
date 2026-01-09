import './sub_block_segmenter.js';

const root = globalThis;
const api = root.SubBlockSegmenter;

if (root.window && !root.window.SubBlockSegmenter && api) {
  root.window.SubBlockSegmenter = api;
}

export const segment = api ? api.segment : undefined;
export const checkForFormulas = api ? api.checkForFormulas : undefined;
export const analyzeFormulas = api ? api.analyzeFormulas : undefined;

export default api;

