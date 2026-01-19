/**
 * DeepSearch States - 简化版
 *
 * 移除硬编码状态机，改用 todos + events 做进度追踪
 */

import {
  AgentStatus,
  StepStatus,
  isValidAgentStatus,
  isValidStepStatus,
  isAgentActive,
  isAgentTerminal,
} from "../../runtime/index.js";

/**
 * @typedef {'scan'|'gaps'|'round'|'write'|'condense'|'completed'} PhaseStatusValue
 */

// === Phase 状态（保留枚举，移除状态机）===
/** @type {Readonly<Record<string, PhaseStatusValue>>} */
export const PhaseStatus = Object.freeze({
  SCAN: "scan",
  GAPS: "gaps",
  ROUND: "round",
  WRITE: "write",
  CONDENSE: "condense",
  COMPLETED: "completed",
});

/**
 * @typedef {'open'|'searching'|'understanding'|'filled'|'blocked'|'stale'} GapStatusValue
 */

// === Gap 状态 ===
/** @type {Readonly<Record<string, GapStatusValue>>} */
export const GapStatus = Object.freeze({
  OPEN: "open",
  SEARCHING: "searching",
  UNDERSTANDING: "understanding",
  FILLED: "filled",
  BLOCKED: "blocked",
  STALE: "stale",
});

/**
 * @typedef {'high'|'medium'|'low'} GapPriorityValue
 */

// === Gap 优先级 ===
/** @type {Readonly<Record<string, GapPriorityValue>>} */
export const GapPriority = Object.freeze({
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
});

// === Todo 状态（对齐 StepStatus）===
export const TodoStatus = Object.freeze({
  OPEN: "open",
  PENDING: "pending",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
});

// === PlanNode 状态 ===
export const PlanNodeStatus = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  COMPLETED: "completed",
  FAILED: "failed",
  BLOCKED: "blocked",
});

// === PlanNode 类型 ===
export const PlanNodeType = Object.freeze({
  GOAL: "goal",
  SUBGOAL: "subgoal",
  QUERY: "query",
});

// === Decision 结果 ===
export const DecisionOutcome = Object.freeze({
  SUCCESS: "success",
  FAIL: "fail",
  PARTIAL: "partial",
  UNKNOWN: "unknown",
});

// === Decision 阶段 ===
export const DecisionStage = Object.freeze({
  SCAN: "scan",
  GAPS: "gaps",
  RETRIEVE: "retrieve",
  UNDERSTAND: "understand",
  WRITE: "write",
  CONDENSE: "condense",
  UNKNOWN: "unknown",
});

// === 验证函数 ===
export function isValidGapPriority(value) {
  return Object.values(GapPriority).includes(value);
}

export function isValidGapStatus(value) {
  return Object.values(GapStatus).includes(value);
}

export function isValidTodoStatus(value) {
  return Object.values(TodoStatus).includes(value);
}

export function isValidPlanNodeStatus(value) {
  return Object.values(PlanNodeStatus).includes(value);
}

export function isValidPlanNodeType(value) {
  return Object.values(PlanNodeType).includes(value);
}

export function isValidDecisionOutcome(value) {
  return Object.values(DecisionOutcome).includes(value);
}

export function isValidDecisionStage(value) {
  return Object.values(DecisionStage).includes(value);
}

export function isValidPhaseStatus(value) {
  return Object.values(PhaseStatus).includes(value);
}

// === Re-export AgentStatus ===
export {
  AgentStatus,
  StepStatus,
  isValidAgentStatus,
  isValidStepStatus,
  isAgentActive,
  isAgentTerminal,
};

// 兼容旧代码
export const AgentLoopStatus = AgentStatus;
export function isValidAgentLoopStatus(value) {
  return isValidAgentStatus(value);
}
