/**
 * @file js/annotations/index.js
 * @description 批注模块统一导出
 */

// 核心模型
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
  deserializeAnnotation,
  isInsideFormula,
  extractTextIgnoringFormulas,
  resolveSelection,
  findParentSubBlock,
  findParentBlockIndex,
  detectFormulaType
} from './core/index.js';

// 坐标映射
export {
  mapOffsetToNode,
  getLengthExcludingFormulas,
  normalizeOffset,
  calculateGlobalOffset,
  resolveGlobalOffset,
  isElementInRange
} from './core/coordinate-mapper.js';

// 渲染器
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
} from './renderers/index.js';

// 服务
export {
  AnnotationService,
  createAnnotationService
} from './services/index.js';

// 默认导出
import AnnotationModel from './core/annotation-model.js';
import SelectionResolver from './core/selection-resolver.js';
import CoordinateMapper from './core/coordinate-mapper.js';
import HighlightRenderer from './renderers/highlight-renderer.js';
import { AnnotationService } from './services/annotation-service.js';

export default {
  Model: AnnotationModel,
  Selection: SelectionResolver,
  Coordinates: CoordinateMapper,
  Renderer: HighlightRenderer,
  Service: AnnotationService
};
