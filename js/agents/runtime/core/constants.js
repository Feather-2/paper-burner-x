// js/agents/runtime/constants.js
// 运行时层状态和类型枚举

/**
 * 执行者类型 - 用于事件来源标识
 *
 * @typedef {"system" | "textprep" | "deepsearch" | "design" | "evaluate" | "codesearch"} ActorTypeValue
 * @typedef {"idle" | "running" | "ended" | "failed" | "cancelled"} OrchestratorStateValue
 * @typedef {"pending" | "active" | "completed" | "failed" | "skipped"} WorkflowTodoStatusValue
 * @typedef {"brief" | "standard" | "detailed" | "comprehensive"} ReportLengthValue
 * @typedef {"academic" | "business" | "casual"} ReportToneValue
 * @typedef {"general" | "expert" | "executive"} ReportAudienceValue
 * @typedef {"auto" | "zh" | "en"} ReportLanguageValue
 * @typedef {"low" | "standard" | "high"} QualityModeValue
 * @typedef {"event" | "coalesce"} EventBusItemKindValue
 *
 * @readonly
 * @enum {ActorTypeValue}
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
 * @readonly
 * @enum {OrchestratorStateValue}
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
 * @param {unknown} value
 * @returns {value is ActorTypeValue}
 */
export function isValidActorType(value) {
  return Object.values(ActorType).includes(/** @type {any} */ (value));
}

/**
 * 验证 OrchestratorState 值
 * @param {unknown} value
 * @returns {value is OrchestratorStateValue}
 */
export function isValidOrchestratorState(value) {
  return Object.values(OrchestratorState).includes(/** @type {any} */ (value));
}

/**
 * TodoItem 状态枚举 (Workflow 层面)
 * @readonly
 * @enum {WorkflowTodoStatusValue}
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
 * @enum {ReportLengthValue}
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
 * @enum {ReportToneValue}
 */
export const ReportTone = Object.freeze({
  ACADEMIC: "academic",
  BUSINESS: "business",
  CASUAL: "casual",
});

/**
 * Report 受众配置枚举
 * @readonly
 * @enum {ReportAudienceValue}
 */
export const ReportAudience = Object.freeze({
  GENERAL: "general",
  EXPERT: "expert",
  EXECUTIVE: "executive",
});

/**
 * Report 语言配置枚举
 * @readonly
 * @enum {ReportLanguageValue}
 */
export const ReportLanguage = Object.freeze({
  AUTO: "auto",
  ZH: "zh",
  EN: "en",
});

/**
 * Run 质量模式枚举
 * @readonly
 * @enum {QualityModeValue}
 */
export const QualityMode = Object.freeze({
  LOW: "low",
  STANDARD: "standard",
  HIGH: "high",
});

/**
 * EventBus 队列项类型枚举
 * @readonly
 * @enum {EventBusItemKindValue}
 */
export const EventBusItemKind = Object.freeze({
  EVENT: "event",
  COALESCE: "coalesce",
});

/**
 * 验证 ReportLength 值
 * @param {unknown} value
 * @returns {value is ReportLengthValue}
 */
export function isValidReportLength(value) {
  return Object.values(ReportLength).includes(/** @type {any} */ (value));
}

/**
 * 验证 ReportTone 值
 * @param {unknown} value
 * @returns {value is ReportToneValue}
 */
export function isValidReportTone(value) {
  return Object.values(ReportTone).includes(/** @type {any} */ (value));
}

/**
 * 验证 ReportAudience 值
 * @param {unknown} value
 * @returns {value is ReportAudienceValue}
 */
export function isValidReportAudience(value) {
  return Object.values(ReportAudience).includes(/** @type {any} */ (value));
}

/**
 * 验证 ReportLanguage 值
 * @param {unknown} value
 * @returns {value is ReportLanguageValue}
 */
export function isValidReportLanguage(value) {
  return Object.values(ReportLanguage).includes(/** @type {any} */ (value));
}

/**
 * 验证 QualityMode 值
 * @param {unknown} value
 * @returns {value is QualityModeValue}
 */
export function isValidQualityMode(value) {
  return Object.values(QualityMode).includes(/** @type {any} */ (value));
}

/**
 * 规范化 QualityMode
 * @param {unknown} value
 * @returns {QualityModeValue | undefined}
 */
export function normalizeQualityMode(value) {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  return isValidQualityMode(v) ? v : undefined;
}

/**
 * 规范化 ReportLength
 * @param {unknown} value
 * @returns {ReportLengthValue | undefined}
 */
export function normalizeReportLength(value) {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  return isValidReportLength(v) ? v : undefined;
}

/**
 * 规范化 ReportTone
 * @param {unknown} value
 * @returns {ReportToneValue | undefined}
 */
export function normalizeReportTone(value) {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  return isValidReportTone(v) ? v : undefined;
}

/**
 * 规范化 ReportAudience
 * @param {unknown} value
 * @returns {ReportAudienceValue | undefined}
 */
export function normalizeReportAudience(value) {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  return isValidReportAudience(v) ? v : undefined;
}

/**
 * 规范化 ReportLanguage
 * @param {unknown} value
 * @returns {ReportLanguageValue | undefined}
 */
export function normalizeReportLanguage(value) {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  return isValidReportLanguage(v) ? v : undefined;
}
