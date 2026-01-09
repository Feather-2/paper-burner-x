import './processing_deps.esm.js';
import './formula_post_processor_async.js';

const root = globalThis;
const api = root.FormulaPostProcessorAsync;

if (root.window && !root.window.FormulaPostProcessorAsync && api) {
  root.window.FormulaPostProcessorAsync = api;
}

export default api;

