import './react_engine.js';

const root = globalThis;
const api = root.ReActEngine;

if (root.window && !root.window.ReActEngine && api) {
  root.window.ReActEngine = api;
}

export default api;

