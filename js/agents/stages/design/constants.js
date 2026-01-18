import {
  DesignPhase,
  DesignLoopStatus,
  SlideStatus,
  VisualSlotStatus,
  EditSessionStatus,
  SubAgentStatus,
  ReviewStatus,
} from "./states.js";

/**
 * @typedef {'pending'|'running'|'success'|'failed'|'skipped'} ImageTaskStatusValue
 */

/**
 * Image generation task lifecycle statuses.
 * @type {Readonly<Record<string, ImageTaskStatusValue>>}
 */
export const ImageTaskStatus = Object.freeze({
  PENDING: "pending",
  RUNNING: "running",
  SUCCESS: "success",
  FAILED: "failed",
  SKIPPED: "skipped",
});

/**
 * @typedef {'ai-image'|'svg'|'asset'} RenderTypeValue
 */

/**
 * Visual renderer output types.
 * @type {Readonly<Record<string, RenderTypeValue>>}
 */
export const RenderType = Object.freeze({
  AI_IMAGE: "ai-image",
  SVG: "svg",
  ASSET: "asset",
});

/**
 * @typedef {'illustration'|'photo'|'icon'|'bg-image'|'bg-gradient'|'bg-pattern'|'chart'|'diagram'|'infographic'|'decoration'|'divider'|'svg'} VisualTypeValue
 */

/**
 * Visual content type.
 * @type {Readonly<Record<string, VisualTypeValue>>}
 */
export const VisualType = Object.freeze({
  ILLUSTRATION: "illustration",
  PHOTO: "photo",
  ICON: "icon",
  BACKGROUND_IMAGE: "bg-image",
  BACKGROUND_GRADIENT: "bg-gradient",
  BACKGROUND_PATTERN: "bg-pattern",
  CHART: "chart",
  DIAGRAM: "diagram",
  INFOGRAPHIC: "infographic",
  DECORATION: "decoration",
  DIVIDER: "divider",
  SVG: "svg",
});

/**
 * @typedef {'outline_confirm'|'style_confirm'|'midway_feedback'|'slide_review'|'final_confirm'} InteractionCheckpointValue
 */

/**
 * User interaction checkpoints for the design flow.
 * @type {Readonly<Record<string, InteractionCheckpointValue>>}
 */
export const InteractionCheckpoint = Object.freeze({
  OUTLINE_CONFIRM: "outline_confirm",
  STYLE_CONFIRM: "style_confirm",
  MIDWAY_FEEDBACK: "midway_feedback",
  SLIDE_REVIEW: "slide_review",
  FINAL_CONFIRM: "final_confirm",
});

/**
 * @typedef {'add_slide'|'delete_slide'|'reorder_slides'|'duplicate_slide'|'change_color_scheme'|'change_font'|'apply_theme'|'edit_element'|'delete_element'|'add_element'|'move_element'|'resize_element'|'undo'|'redo'} EditOperationTypeValue
 */

/**
 * Edit operation types for edit mode.
 * @type {Readonly<Record<string, EditOperationTypeValue>>}
 */
export const EditOperationType = Object.freeze({
  ADD_SLIDE: "add_slide",
  DELETE_SLIDE: "delete_slide",
  REORDER_SLIDES: "reorder_slides",
  DUPLICATE_SLIDE: "duplicate_slide",
  CHANGE_COLOR_SCHEME: "change_color_scheme",
  CHANGE_FONT: "change_font",
  APPLY_THEME: "apply_theme",
  EDIT_ELEMENT: "edit_element",
  DELETE_ELEMENT: "delete_element",
  ADD_ELEMENT: "add_element",
  MOVE_ELEMENT: "move_element",
  RESIZE_ELEMENT: "resize_element",
  UNDO: "undo",
  REDO: "redo",
});

/**
 * @typedef {'critical'|'major'|'minor'|'info'} ReviewIssueSeverityValue
 */

/**
 * Review issue severities.
 * @type {Readonly<Record<string, ReviewIssueSeverityValue>>}
 */
export const ReviewIssueSeverity = Object.freeze({
  CRITICAL: "critical",
  MAJOR: "major",
  MINOR: "minor",
  INFO: "info",
});

/**
 * @typedef {'layout'|'text'|'color'|'visual'|'alignment'|'overflow'|'accessibility'} ReviewIssueTypeValue
 */

/**
 * Review issue categories.
 * @type {Readonly<Record<string, ReviewIssueTypeValue>>}
 */
export const ReviewIssueType = Object.freeze({
  LAYOUT: "layout",
  TEXT: "text",
  COLOR: "color",
  VISUAL: "visual",
  ALIGNMENT: "alignment",
  OVERFLOW: "overflow",
  ACCESSIBILITY: "accessibility",
});

/**
 * @typedef {'started'|'progress'|'data'|'completed'|'failed'|'error'|'generated'|'skipped'|'succeeded'} EventStatusValue
 */

/**
 * Standard emit status values for agent events.
 * @type {Readonly<Record<string, EventStatusValue>>}
 */
export const EventStatus = Object.freeze({
  STARTED: "started",
  PROGRESS: "progress",
  DATA: "data",
  COMPLETED: "completed",
  FAILED: "failed",
  ERROR: "error",
  GENERATED: "generated",
  SKIPPED: "skipped",
  SUCCEEDED: "succeeded",
});

/**
 * @typedef {'critical'|'important'|'optional'} SlotPriorityValue
 */

/**
 * Slot priority levels for layout/asset selection.
 * @type {Readonly<Record<string, SlotPriorityValue>>}
 */
export const SlotPriority = Object.freeze({
  CRITICAL: "critical",
  IMPORTANT: "important",
  OPTIONAL: "optional",
});

/**
 * @typedef {'hero'|'icon'|'background'|'chart_fallback'|'illustration'} SlotPurposeValue
 */

/**
 * Intended purpose of an image/asset slot within a slide.
 * @type {Readonly<Record<string, SlotPurposeValue>>}
 */
export const SlotPurpose = Object.freeze({
  HERO: "hero",
  ICON: "icon",
  BACKGROUND: "background",
  CHART_FALLBACK: "chart_fallback",
  ILLUSTRATION: "illustration",
});

/**
 * @typedef {'pending'|'filled'} VisualDataStatusValue
 */

/**
 * Visual slot data-status values used in DSL/HTML.
 * @type {Readonly<Record<string, VisualDataStatusValue>>}
 */
export const VisualDataStatus = Object.freeze({
  PENDING: "pending",
  FILLED: "filled",
});

/**
 * @typedef {'auto_selected'} SlotSelectionStatusValue
 */

/**
 * Slot selection status values.
 * @type {Readonly<Record<string, SlotSelectionStatusValue>>}
 */
export const SlotSelectionStatus = Object.freeze({
  AUTO_SELECTED: "auto_selected",
});

/**
 * @typedef {'pending'|'generating'|'reviewing'|'completed'|'failed'} BrainstormStatusValue
 */

/**
 * Brainstorm 状态枚举
 * @type {Readonly<Record<string, BrainstormStatusValue>>}
 */
export const BrainstormStatus = Object.freeze({
  PENDING: "pending",
  GENERATING: "generating",
  REVIEWING: "reviewing",
  COMPLETED: "completed",
  FAILED: "failed",
});

/**
 * @typedef {'theme'|'layout'|'content'|'visual'} IdeaTypeValue
 */

/**
 * Idea 类型枚举
 * @type {Readonly<Record<string, IdeaTypeValue>>}
 */
export const IdeaType = Object.freeze({
  THEME: "theme",
  LAYOUT: "layout",
  CONTENT: "content",
  VISUAL: "visual",
});

/**
 * @typedef {'none'|'fade'|'slide'|'zoom'|'bounce'} DslEffectValue
 */

/**
 * DSL 动效类型枚举
 * @type {Readonly<Record<string, DslEffectValue>>}
 */
export const DslEffect = Object.freeze({
  NONE: "none",
  FADE: "fade",
  SLIDE: "slide",
  ZOOM: "zoom",
  BOUNCE: "bounce",
});

/**
 * 图片/视觉渲染的启发式阈值配置
 * @typedef {Object} VisualHeuristicsConfig
 * @property {number} ASPECT_RATIO_16_9
 * @property {number} ASPECT_RATIO_4_3
 * @property {number} ASPECT_RATIO_SQUARE_MIN
 * @property {number} ASPECT_RATIO_SQUARE_MAX
 * @property {number} COST_HD_IMAGE
 * @property {number} COST_STANDARD_IMAGE
 * @property {number} OPACITY_IMAGE
 * @property {number} OPACITY_SHAPE
 * @property {number} DEFAULT_MAX_IMAGES
 * @property {number} DEFAULT_MAX_COST_USD
 * @property {number} LARGE_IMAGE_AREA_THRESHOLD
 * @property {number} MIN_READABLE_FONT_SIZE
 */

/**
 * 图片/视觉渲染的启发式阈值配置
 * @type {Readonly<VisualHeuristicsConfig>}
 */
export const VisualHeuristics = Object.freeze({
  // 宽高比阈值 (visual-renderer.js)
  ASPECT_RATIO_16_9: 1.55, // > 此值判定为 16:9
  ASPECT_RATIO_4_3: 1.15, // > 此值判定为 4:3，否则 1:1
  ASPECT_RATIO_SQUARE_MIN: 0.85, // 接近正方形的下限
  ASPECT_RATIO_SQUARE_MAX: 1.15, // 接近正方形的上限

  // 成本估算 (image-planner.js)
  COST_HD_IMAGE: 0.04, // 3D/photo/HD/cinematic 风格
  COST_STANDARD_IMAGE: 0.003, // 标准图片

  // 透明度 (image-planner.js)
  OPACITY_IMAGE: 0.95,
  OPACITY_SHAPE: 0.98,

  // 预算默认值 (image-planner.js)
  DEFAULT_MAX_IMAGES: 5, // 默认最大图片数
  DEFAULT_MAX_COST_USD: 1.0, // 默认最大成本（美元）

  // 面积与字号阈值 (image-planner.js)
  LARGE_IMAGE_AREA_THRESHOLD: 4500, // ~67% x 67% 的面积阈值
  MIN_READABLE_FONT_SIZE: 12, // 最小可读字号
});

/**
 * 验证 BrainstormStatus 值
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidBrainstormStatus(value) {
  return Object.values(BrainstormStatus).includes(/** @type {any} */ (value));
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidDesignPhase(value) {
  return Object.values(DesignPhase).includes(/** @type {any} */ (value));
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidDesignLoopStatus(value) {
  return Object.values(DesignLoopStatus).includes(/** @type {any} */ (value));
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidSlideStatus(value) {
  return Object.values(SlideStatus).includes(/** @type {any} */ (value));
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidVisualSlotStatus(value) {
  return Object.values(VisualSlotStatus).includes(/** @type {any} */ (value));
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidEditSessionStatus(value) {
  return Object.values(EditSessionStatus).includes(/** @type {any} */ (value));
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidSubAgentStatus(value) {
  return Object.values(SubAgentStatus).includes(/** @type {any} */ (value));
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidReviewStatus(value) {
  return Object.values(ReviewStatus).includes(/** @type {any} */ (value));
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidVisualType(value) {
  return Object.values(VisualType).includes(/** @type {any} */ (value));
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidInteractionCheckpoint(value) {
  return Object.values(InteractionCheckpoint).includes(/** @type {any} */ (value));
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidEditOperationType(value) {
  return Object.values(EditOperationType).includes(/** @type {any} */ (value));
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidReviewIssueSeverity(value) {
  return Object.values(ReviewIssueSeverity).includes(/** @type {any} */ (value));
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidReviewIssueType(value) {
  return Object.values(ReviewIssueType).includes(/** @type {any} */ (value));
}

// Re-export from states.js
export {
  DesignPhase,
  DESIGN_PHASE_TRANSITIONS,
  designPhaseMachine,
  DesignLoopStatus,
  DESIGN_LOOP_TRANSITIONS,
  designLoopMachine,
  SlideStatus,
  SLIDE_STATUS_TRANSITIONS,
  SLIDE_TRANSITIONS,
  slideStatusMachine,
  slideMachine,
  VisualSlotStatus,
  VISUAL_SLOT_TRANSITIONS,
  visualSlotMachine,
  EditSessionStatus,
  EDIT_SESSION_TRANSITIONS,
  editSessionMachine,
  SubAgentStatus,
  SUB_AGENT_TRANSITIONS,
  subAgentMachine,
  ReviewStatus,
  REVIEW_TRANSITIONS,
  reviewMachine,
} from "./states.js";
