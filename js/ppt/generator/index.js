/**
 * PPT generator ESM entry.
 *
 * Loads legacy generator modules (prototype mixins) and exposes a stable ESM API.
 * Keeps the runtime-global instance contract: `window.PPTGenerator`.
 */

// 1. 首先加载核心类（会设置 globalThis.PPTGeneratorCtor）
import PPTGeneratorClass from './ppt_generator_core.js';

// 确保全局变量已设置（供 mixin 使用）
if (typeof globalThis !== 'undefined' && !globalThis.PPTGeneratorCtor) {
  globalThis.PPTGeneratorCtor = PPTGeneratorClass;
}
if (typeof window !== 'undefined' && !window.PPTGeneratorCtor) {
  window.PPTGeneratorCtor = PPTGeneratorClass;
}

// 2. 然后加载 mixin 文件（它们会扩展 PPTGeneratorCtor.prototype）
import './ppt_generator_navigation.js';
import './ppt_generator_workflow.js';
import './ppt_generator_presentation.js';
import './ppt_generator_utilities.js';
import './ppt_generator_deletion.js';
import './ppt_generator_editor.js';

// Export pipeline (historically loaded in ppt.html).
import './export/ppt_generator_export_image.js';
import './export/ppt_generator_export_baking.js';
import './export/ppt_generator_export_formats.js';
import './export/ppt_generator_export_core.js';

const root = (typeof window !== 'undefined') ? window : globalThis;

export function getPptGeneratorCtor() {
  return globalThis.PPTGeneratorCtor ?? root.PPTGeneratorCtor ?? null;
}

export function ensurePptGenerator() {
  const ctor = getPptGeneratorCtor();
  if (!ctor) throw new Error('PPTGeneratorCtor not available');

  if (!root.PPTGenerator) {
    root.PPTGenerator = new ctor();
  }

  // Mirror onto globalThis for Node/test shims where `window` is detached.
  try {
    if (typeof globalThis !== 'undefined' && globalThis !== root) {
      globalThis.PPTGenerator = root.PPTGenerator;
    }
  } catch {
    // ignore
  }

  return root.PPTGenerator;
}

export function startPptGenerator() {
  const gen = ensurePptGenerator();
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('DOMContentLoaded', () => gen?.init?.());
  }
  return gen;
}

export async function loadEditorIntegration() {
  // Editor integration depends on editor modules and a created instance.
  ensurePptGenerator();
  await import('./ppt_generator_editor.js');
  return root.PPTGenerator;
}

export const PPTGenerator = getPptGeneratorCtor();
export const pptGenerator = root.PPTGenerator ?? globalThis.PPTGenerator;

export default {
  PPTGenerator,
  pptGenerator,
  ensurePptGenerator,
  startPptGenerator,
  loadEditorIntegration,
};

