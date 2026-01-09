import './ui-model-search.js';

const w = globalThis.window;

export default {
  initializeModelSearchOverlay: w?.initializeModelSearchOverlay,
  openModelSearchOverlay: w?.openModelSearchOverlay,
  closeModelSearchOverlay: w?.closeModelSearchOverlay,
  renderModelSearchResults: w?.renderModelSearchResults,
  getModelSearchCache: w?.getModelSearchCache,
  setModelSearchCache: w?.setModelSearchCache,
  registerModelSearchIntegration: w?.registerModelSearchIntegration
};

