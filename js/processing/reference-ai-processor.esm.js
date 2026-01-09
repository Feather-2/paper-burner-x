import './reference-ai-processor.js';

const root = globalThis;
const api = root.ReferenceAIProcessor;

if (root.window && !root.window.ReferenceAIProcessor && api) {
  root.window.ReferenceAIProcessor = api;
}

export default api;

