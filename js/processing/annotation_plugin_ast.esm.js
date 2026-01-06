import './annotation_plugin_ast.js';

const root = globalThis;
const api = root.createAnnotationPluginAST;

if (root.window && !root.window.createAnnotationPluginAST && api) {
  root.window.createAnnotationPluginAST = api;
}

export default api;

