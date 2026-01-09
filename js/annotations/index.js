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

// DOM 集成（旧版批注系统 / 过渡期 API）
export {
  applyBlockAnnotations,
  highlightBlockOrSubBlock,
  removeHighlightFromBlockOrSubBlock,
  applyCrossBlockAnnotation,
  applyCrossBlockHighlightStyle,
  bindCrossBlockAnnotationEvents,
  applyFormulaAnnotation
} from './annotation_highlighter.js';

export {
  AnnotationDOMCache,
  _page_generateUUID,
  initAnnotationSystem,
  initializeGlobalAnnotationVariables,
  detectCrossBlockSelection,
  handleCrossBlockAnnotation,
  checkIfTargetIsHighlighted,
  checkIfTargetHasNote,
  updateContextMenuOptions,
  showContextMenu
} from './annotation_logic.js';

export { createCustomMarkdownRenderer } from './custom_markdown_renderer.js';

export {
  initAnnotationsSummaryModal,
  openAnnotationsSummaryModal,
  closeAnnotationsSummaryModal,
  populateAnnotationsSummaryTable
} from './annotations_summary_modal.js';

// 默认导出
import AnnotationModel from './core/annotation-model.js';
import SelectionResolver from './core/selection-resolver.js';
import CoordinateMapper from './core/coordinate-mapper.js';
import HighlightRenderer from './renderers/highlight-renderer.js';
import { AnnotationService } from './services/annotation-service.js';

import * as AnnotationLogic from './annotation_logic.js';
import * as AnnotationHighlighter from './annotation_highlighter.js';
import * as AnnotationsSummaryModal from './annotations_summary_modal.js';
import * as CustomMarkdownRenderer from './custom_markdown_renderer.js';

export default {
  Model: AnnotationModel,
  Selection: SelectionResolver,
  Coordinates: CoordinateMapper,
  Renderer: HighlightRenderer,
  Service: AnnotationService,
  Logic: AnnotationLogic,
  Highlighter: AnnotationHighlighter,
  SummaryModal: AnnotationsSummaryModal,
  Markdown: CustomMarkdownRenderer
};

// 兼容层：提供 window.AnnotationLogic / window.AnnotationHighlighter 等 facade
if (typeof window !== 'undefined') {
  window.AnnotationLogic = AnnotationLogic;
  window.AnnotationHighlighter = AnnotationHighlighter;
  window.AnnotationsSummaryModal = AnnotationsSummaryModal;
  window.CustomMarkdownRenderer = CustomMarkdownRenderer;
}
