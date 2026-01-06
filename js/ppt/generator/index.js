/**
 * PPT generator ESM entry.
 *
 * Loads legacy generator modules (prototype mixins) and exposes a stable ESM API.
 * Keeps the runtime-global instance contract: `window.PPTGenerator`.
 */

import './ppt_generator_core.js';
import './ppt_generator_navigation.js';
import './ppt_generator_workflow.js';
import './ppt_generator_presentation.js';
import './ppt_generator_utilities.js';
import './ppt_generator_deletion.js';

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

