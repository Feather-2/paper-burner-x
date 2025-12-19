// js/agents/runtime/events.js
// 运行时事件名枚举

/**
 * 运行时核心事件
 */
export const RuntimeEvents = Object.freeze({
  // Run 生命周期
  RUN_STARTED: "run.started",
  RUN_ENDED: "run.ended",
  RUN_FAILED: "run.failed",
  RUN_CANCELLED: "run.cancelled",

  // Stage 生命周期
  STAGE_STARTED: "stage.started",
  STAGE_PROGRESS: "stage.progress",
  STAGE_ENDED: "stage.ended",
  STAGE_FAILED: "stage.failed",
});

/**
 * DeepSearch 事件
 */
export const DeepSearchEvents = Object.freeze({
  // Phase 事件
  PHASE_STARTED: "deepsearch.phase.started",
  PHASE_ENDED: "deepsearch.phase.ended",

  // Scan
  SCAN_STARTED: "deepsearch.scan.started",
  SCAN_PROGRESS: "deepsearch.scan.progress",
  SCAN_ENDED: "deepsearch.scan.ended",

  // Gaps
  GAPS_STARTED: "deepsearch.gaps.started",
  GAPS_PROGRESS: "deepsearch.gaps.progress",
  GAPS_ENDED: "deepsearch.gaps.ended",

  // Retrieve
  RETRIEVE_STARTED: "deepsearch.retrieve.started",
  RETRIEVE_PROGRESS: "deepsearch.retrieve.progress",
  RETRIEVE_ENDED: "deepsearch.retrieve.ended",

  // Understand
  UNDERSTAND_STARTED: "deepsearch.understand.started",
  UNDERSTAND_PROGRESS: "deepsearch.understand.progress",
  UNDERSTAND_ENDED: "deepsearch.understand.ended",

  // External
  EXTERNAL_STARTED: "deepsearch.external.started",
  EXTERNAL_PROGRESS: "deepsearch.external.progress",
  EXTERNAL_ENDED: "deepsearch.external.ended",

  // Write
  WRITE_STARTED: "deepsearch.write.started",
  WRITE_PROGRESS: "deepsearch.write.progress",
  WRITE_ENDED: "deepsearch.write.ended",

  // Condense
  CONDENSE_STARTED: "deepsearch.condense.started",
  CONDENSE_PROGRESS: "deepsearch.condense.progress",
  CONDENSE_ENDED: "deepsearch.condense.ended",

  // Review
  REVIEW_STARTED: "deepsearch.review.started",
  REVIEW_PROGRESS: "deepsearch.review.progress",
  REVIEW_ENDED: "deepsearch.review.ended",

  // Checkpoint
  CHECKPOINT_SAVED: "deepsearch.checkpoint.saved",
  CHECKPOINT_RESTORED: "deepsearch.checkpoint.restored",
});

/**
 * Design 事件
 */
export const DesignEvents = Object.freeze({
  BRAINSTORM_STARTED: "design.brainstorm.started",
  BRAINSTORM_PROGRESS: "design.brainstorm.progress",
  BRAINSTORM_ENDED: "design.brainstorm.ended",

  GENERATE_STARTED: "design.generate.started",
  GENERATE_PROGRESS: "design.generate.progress",
  GENERATE_ENDED: "design.generate.ended",

  IMAGE_STARTED: "design.image.started",
  IMAGE_PROGRESS: "design.image.progress",
  IMAGE_ENDED: "design.image.ended",
});

/**
 * 根据事件名获取事件类别前缀
 */
export function getEventPrefix(eventName) {
  if (typeof eventName !== "string") return null;
  const parts = eventName.split(".");
  return parts.length > 1 ? parts[0] : null;
}

/**
 * 检查事件名是否匹配通配符模式
 * @param {string} pattern - 通配符模式，如 "deepsearch.*"
 * @param {string} eventName - 事件名
 */
export function matchEventPattern(pattern, eventName) {
  if (typeof pattern !== "string" || typeof eventName !== "string") return false;
  if (pattern === "*") return true;
  if (!pattern.includes("*")) return pattern === eventName;

  // 支持 "prefix.*" 模式
  if (pattern.endsWith(".*")) {
    const prefix = pattern.slice(0, -2);
    return eventName === prefix || eventName.startsWith(prefix + ".");
  }

  // 转为正则
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp("^" + escaped + "$").test(eventName);
}
