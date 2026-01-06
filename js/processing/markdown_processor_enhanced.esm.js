import './processing_deps.esm.js';
import './markdown_processor_enhanced.js';

const root = globalThis;
const api = root.MarkdownProcessorEnhanced;

if (root.window && !root.window.MarkdownProcessorEnhanced && api) {
  root.window.MarkdownProcessorEnhanced = api;
}

export const safeMarkdown = api ? api.safeMarkdown : undefined;
export const renderWithKatexFailback = api ? api.renderWithKatexFailback : undefined;
export const getMetrics = api ? api.getMetrics : undefined;
export const clearCache = api ? api.clearCache : undefined;
export const testFormula = api ? api.testFormula : undefined;

export default api;

