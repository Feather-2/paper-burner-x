import './processing_deps.esm.js';
import './formula_post_processor.js';

const root = globalThis;
const api = root.FormulaPostProcessor;

if (root.window && !root.window.FormulaPostProcessor && api) {
  root.window.FormulaPostProcessor = api;
}

export const processFormulasInElement = api ? api.processFormulasInElement : undefined;
export const version = api ? api.version : undefined;

export default api;

