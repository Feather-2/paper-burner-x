/**
 * PPT model-config ESM entry.
 *
 * Loads the legacy IIFE modules (which populate `window.PPTModelConfig` /
 * `window.PPTModelConfigModal`) and re-exports the public API for ESM consumers.
 */

import './ppt_model_config_constants.js';
import './ppt_model_config_utils.js';
import './ppt_model_config_view.js';
import './ppt_model_config_styles.js';
import './ppt_model_config_sources.js';
import './ppt_model_config_roles.js';
import './ppt_model_config_tabs.js';
import './ppt_model_config_table.js';
import './ppt_model_config_advanced.js';
import './ppt_model_config_core.js';

const root = (typeof window !== 'undefined') ? window : globalThis;

try {
  if (typeof globalThis !== 'undefined' && globalThis !== root) {
    if (root.PPTModelConfig) globalThis.PPTModelConfig = root.PPTModelConfig;
    if (root.PPTModelConfigCore) globalThis.PPTModelConfigCore = root.PPTModelConfigCore;
    if (root.PPTModelConfigModal) globalThis.PPTModelConfigModal = root.PPTModelConfigModal;
  }
} catch {
  // ignore
}

export const PPTModelConfig = root.PPTModelConfig ?? globalThis.PPTModelConfig;
export const PPTModelConfigCore = root.PPTModelConfigCore ?? globalThis.PPTModelConfigCore ?? PPTModelConfig?.core;
export const PPTModelConfigModal = root.PPTModelConfigModal ?? globalThis.PPTModelConfigModal;

export default {
  PPTModelConfig,
  PPTModelConfigCore,
  PPTModelConfigModal,
};

