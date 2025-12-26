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
  ACTIVE: "active",
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
  ACADEMIC: "academic",
  BUSINESS: "business",
  CASUAL: "casual",
});

/**
 * Report 受众配置枚举
 * @readonly
 * @enum {string}
 */
export const ReportAudience = Object.freeze({
  GENERAL: "general",
  EXPERT: "expert",
  EXECUTIVE: "executive",
});

/**
 * Report 语言配置枚举
 * @readonly
 * @enum {string}
 */
export const ReportLanguage = Object.freeze({
  AUTO: "auto",
  ZH: "zh",
  EN: "en",
});

/**
 * Run 质量模式枚举
 * @readonly
 * @enum {string}
 */
export const QualityMode = Object.freeze({
  LOW: "low",
  STANDARD: "standard",
  HIGH: "high",
});

/**
 * EventBus 队列项类型枚举
 * @readonly
 * @enum {string}
 */
export const EventBusItemKind = Object.freeze({
  EVENT: "event",
  COALESCE: "coalesce",
});

/**
 * 验证 ReportLength 值
 */
export function isValidReportLength(value) {
  return Object.values(ReportLength).includes(value);
}

/**
 * 验证 ReportTone 值
 */
export function isValidReportTone(value) {
  return Object.values(ReportTone).includes(value);
}

/**
 * 验证 ReportAudience 值
 */
export function isValidReportAudience(value) {
  return Object.values(ReportAudience).includes(value);
}

/**
 * 验证 ReportLanguage 值
 */
export function isValidReportLanguage(value) {
  return Object.values(ReportLanguage).includes(value);
}

/**
 * 验证 QualityMode 值
 */
export function isValidQualityMode(value) {
  return Object.values(QualityMode).includes(value);
}

/**
 * 规范化 QualityMode
 */
export function normalizeQualityMode(value) {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  return isValidQualityMode(v) ? v : undefined;
}

/**
 * 规范化 ReportLength
 */
export function normalizeReportLength(value) {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  return isValidReportLength(v) ? v : undefined;
}

/**
 * 规范化 ReportTone
 */
export function normalizeReportTone(value) {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  return isValidReportTone(v) ? v : undefined;
}

/**
 * 规范化 ReportAudience
 */
export function normalizeReportAudience(value) {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  return isValidReportAudience(v) ? v : undefined;
}

/**
 * 规范化 ReportLanguage
 */
export function normalizeReportLanguage(value) {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  return isValidReportLanguage(v) ? v : undefined;
}
