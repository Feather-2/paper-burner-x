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
 * Image generation task lifecycle statuses.
 * @readonly
 * @enum {string}
 */
export const ImageTaskStatus = Object.freeze({
  PENDING: "pending",
  RUNNING: "running",
  SUCCESS: "success",
  FAILED: "failed",
  SKIPPED: "skipped",
});

/**
 * Visual renderer output types.
 * @readonly
 * @enum {string}
 */
export const RenderType = Object.freeze({
  AI_IMAGE: "ai-image",
  SVG: "svg",
  ASSET: "asset",
});

/**
 * Visual content type.
 * @readonly
 * @enum {string}
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
 * User interaction checkpoints for the design flow.
 * @readonly
 * @enum {string}
 */
export const InteractionCheckpoint = Object.freeze({
  OUTLINE_CONFIRM: "outline_confirm",
  STYLE_CONFIRM: "style_confirm",
  MIDWAY_FEEDBACK: "midway_feedback",
  SLIDE_REVIEW: "slide_review",
  FINAL_CONFIRM: "final_confirm",
});

/**
 * Edit operation types for edit mode.
 * @readonly
 * @enum {string}
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
 * Review issue severities.
 * @readonly
 * @enum {string}
 */
export const ReviewIssueSeverity = Object.freeze({
  CRITICAL: "critical",
  MAJOR: "major",
  MINOR: "minor",
  INFO: "info",
});

/**
 * Review issue categories.
 * @readonly
 * @enum {string}
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
 * Standard emit status values for agent events.
 * @readonly
 * @enum {string}
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
 * Slot priority levels for layout/asset selection.
 * @readonly
 * @enum {string}
 */
export const SlotPriority = Object.freeze({
  CRITICAL: "critical",
  IMPORTANT: "important",
  OPTIONAL: "optional",
});

/**
 * Intended purpose of an image/asset slot within a slide.
 * @readonly
 * @enum {string}
 */
export const SlotPurpose = Object.freeze({
  HERO: "hero",
  ICON: "icon",
  BACKGROUND: "background",
  CHART_FALLBACK: "chart_fallback",
  ILLUSTRATION: "illustration",
});

/**
 * Visual slot data-status values used in DSL/HTML.
 * @readonly
 * @enum {string}
 */
export const VisualDataStatus = Object.freeze({
  PENDING: "pending",
  FILLED: "filled",
});

/**
 * Slot selection status values.
 * @readonly
 * @enum {string}
 */
export const SlotSelectionStatus = Object.freeze({
  AUTO_SELECTED: "auto_selected",
});

/**
 * Brainstorm 状态枚举
 * @readonly
 * @enum {string}
 */
export const BrainstormStatus = Object.freeze({
  PENDING: "pending",
  GENERATING: "generating",
  REVIEWING: "reviewing",
  COMPLETED: "completed",
  FAILED: "failed",
});

/**
 * Idea 类型枚举
 * @readonly
 * @enum {string}
 */
export const IdeaType = Object.freeze({
  THEME: "theme",
  LAYOUT: "layout",
  CONTENT: "content",
  VISUAL: "visual",
});

/**
 * DSL 动效类型枚举
 * @readonly
 * @enum {string}
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
 * @readonly
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
});

/**
 * 验证 BrainstormStatus 值
 */
export function isValidBrainstormStatus(value) {
  return Object.values(BrainstormStatus).includes(value);
}

export function isValidDesignPhase(value) {
  return Object.values(DesignPhase).includes(value);
}

export function isValidDesignLoopStatus(value) {
  return Object.values(DesignLoopStatus).includes(value);
}

export function isValidSlideStatus(value) {
  return Object.values(SlideStatus).includes(value);
}

export function isValidVisualSlotStatus(value) {
  return Object.values(VisualSlotStatus).includes(value);
}

export function isValidEditSessionStatus(value) {
  return Object.values(EditSessionStatus).includes(value);
}

export function isValidSubAgentStatus(value) {
  return Object.values(SubAgentStatus).includes(value);
}

export function isValidReviewStatus(value) {
  return Object.values(ReviewStatus).includes(value);
}

export function isValidVisualType(value) {
  return Object.values(VisualType).includes(value);
}

export function isValidInteractionCheckpoint(value) {
  return Object.values(InteractionCheckpoint).includes(value);
}

export function isValidEditOperationType(value) {
  return Object.values(EditOperationType).includes(value);
}

export function isValidReviewIssueSeverity(value) {
  return Object.values(ReviewIssueSeverity).includes(value);
}

export function isValidReviewIssueType(value) {
  return Object.values(ReviewIssueType).includes(value);
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
