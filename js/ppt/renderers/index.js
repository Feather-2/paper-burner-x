/**
 * PPT renderers ESM entry.
 *
 * Provides a stable ESM import surface while keeping legacy globals
 * (`window.HTMLSlideRenderer`, `window.PPTXSlideRenderer`) working.
 */

// Ensure shared globals exist (SlideStyles is consumed by both renderers).
import '../core/slide-styles.js';

// Load mixins before the main PPTX renderer.
import './slide-renderer-pptx-freeform.js';
import './slide-renderer-pptx.js';
import './slide-renderer-html.js';

const root = (typeof window !== 'undefined') ? window : globalThis;

try {
  if (typeof globalThis !== 'undefined' && globalThis !== root) {
    if (root.HTMLSlideRenderer) globalThis.HTMLSlideRenderer = root.HTMLSlideRenderer;
    if (root.PPTXSlideRenderer) globalThis.PPTXSlideRenderer = root.PPTXSlideRenderer;
    if (root.PPTXFreeformMixin) globalThis.PPTXFreeformMixin = root.PPTXFreeformMixin;
  }
} catch {
  // ignore
}

export const HTMLSlideRenderer = root.HTMLSlideRenderer ?? globalThis.HTMLSlideRenderer;
export const PPTXSlideRenderer = root.PPTXSlideRenderer ?? globalThis.PPTXSlideRenderer;
export const PPTXFreeformMixin = root.PPTXFreeformMixin ?? globalThis.PPTXFreeformMixin;

export default {
  HTMLSlideRenderer,
  PPTXSlideRenderer,
  PPTXFreeformMixin,
};

