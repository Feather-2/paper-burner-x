/**
 * @file js/annotations/core/index.js
 * @description 批注核心模块导出
 */

export {
  AnnotationType,
  AnnotationColors,
  createAnnotation,
  validateAnnotation,
  updateAnnotation,
  markAsDeleted,
  compareAnnotations,
  filterValidAnnotations,
  groupByDocId,
  serializeAnnotation,
  deserializeAnnotation
} from './annotation-model.js';

export {
  isInsideFormula,
  extractTextIgnoringFormulas,
  collectTextNodes,
  mapLogicalToDOM,
  findTextInDOMRange,
  resolveSelection,
  findParentSubBlock,
  findParentBlockIndex,
  calculateOffsetInSubBlock,
  detectFormulaType
} from './selection-resolver.js';

export {
  mapOffsetToNode,
  getLengthExcludingFormulas,
  normalizeOffset,
  calculateGlobalOffset,
  resolveGlobalOffset,
  buildNormalizedText,
  recalibrateWithExact,
  isElementInRange
} from './coordinate-mapper.js';
