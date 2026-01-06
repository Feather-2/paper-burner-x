import './ui-model-panels.js';

const w = globalThis.window;

export default {
  DEEPLX_DEFAULT_ENDPOINT_TEMPLATE: w?.DEEPLX_DEFAULT_ENDPOINT_TEMPLATE,
  getDeeplxEndpointTemplate: w?.getDeeplxEndpointTemplate,
  setupDeeplxEndpointInput: w?.setupDeeplxEndpointInput,
  renderGeminiInfoPanel: w?.renderGeminiInfoPanel,
  renderDeepseekInfoPanel: w?.renderDeepseekInfoPanel,
  renderDeeplxInfoPanel: w?.renderDeeplxInfoPanel,
  renderTongyiInfoPanel: w?.renderTongyiInfoPanel,
  renderVolcanoInfoPanel: w?.renderVolcanoInfoPanel
};

