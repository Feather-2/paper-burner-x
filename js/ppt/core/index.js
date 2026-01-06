/**
 * PPT core ESM entry.
 *
 * Wraps the legacy core scripts and exposes a stable ESM surface while
 * preserving global compatibility (`window.SlideSystem`, `window.SlideParser`, ...).
 */

import './slide-styles.js';
import './slide-parser.js';
import './slide-parser-pptx.js';
import '../renderers/index.js';
import './slide-system.js';
import './math-converter.js';
import './health-check.js';

export * from './slide-constants.js';

const root = (typeof window !== 'undefined') ? window : globalThis;

try {
  if (typeof globalThis !== 'undefined' && globalThis !== root) {
    const mirrorKeys = [
      'SlideStyles',
      'SlideParser',
      'PPTXSlideParser',
      'HTMLSlideRenderer',
      'PPTXSlideRenderer',
      'SlideSystem',
      'MathConverter',
      'PPTHealthCheck',
    ];
    for (const key of mirrorKeys) {
      if (root[key]) globalThis[key] = root[key];
    }
  }
} catch {
  // ignore
}

export const SlideStyles = root.SlideStyles ?? globalThis.SlideStyles;
export const SlideParser = root.SlideParser ?? globalThis.SlideParser;
export const PPTXSlideParser = root.PPTXSlideParser ?? globalThis.PPTXSlideParser;
export const HTMLSlideRenderer = root.HTMLSlideRenderer ?? globalThis.HTMLSlideRenderer;
export const PPTXSlideRenderer = root.PPTXSlideRenderer ?? globalThis.PPTXSlideRenderer;
export const SlideSystem = root.SlideSystem ?? globalThis.SlideSystem;
export const MathConverter = root.MathConverter ?? globalThis.MathConverter;
export const PPTHealthCheck = root.PPTHealthCheck ?? globalThis.PPTHealthCheck;

export default {
  SlideStyles,
  SlideParser,
  PPTXSlideParser,
  HTMLSlideRenderer,
  PPTXSlideRenderer,
  SlideSystem,
  MathConverter,
  PPTHealthCheck,
};

