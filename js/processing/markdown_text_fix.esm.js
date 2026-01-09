import './processing_deps.esm.js';
import './markdown_text_fix.js';

const root = globalThis;
const api = root.MarkdownTextFix;

if (root.window && !root.window.MarkdownTextFix && api) {
  root.window.MarkdownTextFix = api;
}

export default api;

