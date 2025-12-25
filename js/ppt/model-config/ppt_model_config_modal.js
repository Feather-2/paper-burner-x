/**
 * Legacy entry (compat): dynamically loads split PPT model config modules.
 *
 * New recommended load order (static in HTML):
 * constants -> utils -> styles -> sources -> roles -> tabs -> table -> advanced -> core
 */
(function(global) {
  'use strict';

  global.PPTModelConfig = global.PPTModelConfig || {};
  const ns = global.PPTModelConfig;
  ns._legacyModalLoader = ns._legacyModalLoader || {};

  if (global.PPTModelConfigModal && typeof global.PPTModelConfigModal.openModal === 'function') return;
  if (ns._legacyModalLoader.loading) return;

  const current = document.currentScript;
  const base = current && current.src ? current.src.replace(/[^/]+$/, '') : 'js/ppt/model-config/';

  const files = [
    'ppt_model_config_constants.js',
    'ppt_model_config_utils.js',
    'ppt_model_config_view.js',
    'ppt_model_config_styles.js',
    'ppt_model_config_sources.js',
    'ppt_model_config_roles.js',
    'ppt_model_config_tabs.js',
    'ppt_model_config_table.js',
    'ppt_model_config_advanced.js',
    'ppt_model_config_core.js'
  ];

  const hasScript = (name) => {
    return !!document.querySelector(`script[src*="${name}"]`);
  };

  const loadScript = (src) => new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.async = false;
    el.onload = () => resolve();
    el.onerror = (e) => reject(e);
    document.head.appendChild(el);
  });

  ns._legacyModalLoader.loading = (async () => {
    for (const f of files) {
      if (hasScript(f)) continue;
      await loadScript(base + f);
    }

    if (!global.PPTModelConfigModal || typeof global.PPTModelConfigModal.openModal !== 'function') {
      console.error('[PPTModelConfig] Legacy loader finished, but PPTModelConfigModal is not available.');
    }
  })().catch((err) => {
    console.error('[PPTModelConfig] Failed to load split modules via legacy loader:', err);
  });
})(typeof window !== 'undefined' ? window : this);
