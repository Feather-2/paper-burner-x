// js/agents/runtime/constants.js
// 运行时层状态和类型枚举

/**
 * 执行者类型 - 用于事件来源标识
 */
export const ActorType = Object.freeze({
  SYSTEM: "system",
  TEXTPREP: "textprep",
  DEEPSEARCH: "deepsearch",
  DESIGN: "design",
  EVALUATE: "evaluate",
  CODESEARCH: "codesearch",
});

/**
 * Orchestrator 状态
 */
export const OrchestratorState = Object.freeze({
  IDLE: "idle",
  RUNNING: "running",
  ENDED: "ended",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

/**
 * 验证 ActorType 值
 */
export function isValidActorType(value) {
  return Object.values(ActorType).includes(value);
}

/**
 * 验证 OrchestratorState 值
 */
export function isValidOrchestratorState(value) {
  return Object.values(OrchestratorState).includes(value);
}

/**
 * TodoItem 状态枚举 (Workflow 层面)
 * @readonly
 * @enum {string}
 */
export const WorkflowTodoStatus = Object.freeze({
  PENDING: "pending",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  FAILED: "failed",
  SKIPPED: "skipped",
});

/**
 * Report 长度配置枚举
 * @readonly
 * @enum {string}
 */
export const ReportLength = Object.freeze({
  BRIEF: "brief",
  STANDARD: "standard",
  DETAILED: "detailed",
  COMPREHENSIVE: "comprehensive",
});

/**
 * Report 语气配置枚举
 * @readonly
 * @enum {string}
 */
export const ReportTone = Object.freeze({
  FORMAL: "formal",
  NEUTRAL: "neutral",
  CASUAL: "casual",
  TECHNICAL: "technical",
});

/**
 * Report 受众配置枚举
 * @readonly
 * @enum {string}
 */
export const ReportAudience = Object.freeze({
  GENERAL: "general",
  TECHNICAL: "technical",
  EXECUTIVE: "executive",
  ACADEMIC: "academic",
});

/**
 * Report 语言配置枚举
 * @readonly
 * @enum {string}
 */
export const ReportLanguage = Object.freeze({
  ZH_CN: "zh-CN",
  EN_US: "en-US",
  JA_JP: "ja-JP",
  AUTO: "auto",
});

/**
 * 验证 ReportLength 值
 */
export function isValidReportLength(value) {
  return Object.values(ReportLength).includes(value);
}
