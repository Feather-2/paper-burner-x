import './processing_deps.esm.js';
import './markdown_processor.js';

const root = globalThis;
const api = root.MarkdownProcessor;

if (root.window && !root.window.MarkdownProcessor && api) {
  root.window.MarkdownProcessor = api;
}

export const safeMarkdown = api ? api.safeMarkdown : undefined;
export const renderWithKatexFailback = api ? api.renderWithKatexFailback : undefined;
export const legacy = api ? api.legacy : undefined;

export default api;

