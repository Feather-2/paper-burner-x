import './processing_deps.esm.js';
import './annotation_plugin_ast.esm.js';
import './markdown_processor_ast.js';

const root = globalThis;
const api = root.MarkdownProcessorAST;

if (root.window && !root.window.MarkdownProcessorAST && api) {
  root.window.MarkdownProcessorAST = api;
}

export const render = api ? api.render : undefined;
export const safeMarkdown = api ? api.safeMarkdown : undefined;
export const renderWithKatexFailback = api ? api.renderWithKatexFailback : undefined;
export const renderWithAnnotations = api ? api.renderWithAnnotations : undefined;
export const getMetrics = api ? api.getMetrics : undefined;
export const clearCache = api ? api.clearCache : undefined;
export const setDebug = api ? api.setDebug : undefined;
export const config = api ? api.config : undefined;
export const version = api ? api.version : undefined;

export default api;

