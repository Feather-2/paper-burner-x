/**
 * Unified PPT ESM entry.
 *
 * Re-exports the major PPT submodules and preserves legacy globals:
 * - window.PPTDashboard
 * - window.PPTGenerator
 * - window.PPTModelConfig / window.PPTModelConfigModal
 */

import * as Core from './core/index.js';
import * as Renderers from './renderers/index.js';
import * as Generator from './generator/index.js';
import * as Dashboard from './dashboard/index.js';
import * as ModelConfig from './model-config/index.js';

export { Core, Renderers, Generator, Dashboard, ModelConfig };

export default {
  Core,
  Renderers,
  Generator,
  Dashboard,
  ModelConfig,
};

if (typeof window !== 'undefined') {
  window.PPT = Object.assign(window.PPT || {}, {
    Core,
    Renderers,
    Generator,
    Dashboard,
    ModelConfig,
  });

  // Legacy globals (some are already set by the underlying modules).
  if (Dashboard.PPTDashboard) window.PPTDashboard = Dashboard.PPTDashboard;
  if (ModelConfig.PPTModelConfig) window.PPTModelConfig = ModelConfig.PPTModelConfig;
  if (ModelConfig.PPTModelConfigModal) window.PPTModelConfigModal = ModelConfig.PPTModelConfigModal;

  // Keep `window.PPTGenerator` available by default when running in a browser-like env.
  try {
    if (!window.PPTGenerator && typeof Generator.ensurePptGenerator === 'function') {
      Generator.ensurePptGenerator();
    }
  } catch {
    // ignore
  }
}

