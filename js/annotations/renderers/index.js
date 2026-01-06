/**
 * @file js/annotations/renderers/index.js
 * @description 批注渲染器模块导出
 */

export {
  getHighlightColor,
  createHighlightElement,
  applyStandardHighlight,
  applyFormulaHighlight,
  clearHighlightStyles,
  removeHighlight,
  wrapTextRange,
  applyPartialHighlight,
  scrollToAnnotation,
  scrollToAnnotationAsync
} from './highlight-renderer.js';
