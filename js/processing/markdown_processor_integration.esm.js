import './markdown_processor_integration.js';

const root = globalThis;
const api = root.MarkdownIntegration;

if (root.window && !root.window.MarkdownIntegration && api) {
  root.window.MarkdownIntegration = api;
}

export default api;

