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
 * 验证 BrainstormStatus 值
 */
export function isValidBrainstormStatus(value) {
  return Object.values(BrainstormStatus).includes(value);
}

// Re-export from states.js
export { SlideStatus, SLIDE_TRANSITIONS, slideMachine, DesignPhase } from "./states.js";
