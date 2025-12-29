/**
 * Design States - 简化版
 *
 * 移除硬编码状态机，保留领域枚举
 */

import {
  AgentStatus,
  StepStatus,
  isValidAgentStatus,
  isValidStepStatus,
} from "../../runtime/core/agent-status.js";

// === Design Phase ===
export const DesignPhase = Object.freeze({
  IDLE: "idle",
  OUTLINE_PARSING: "outline_parsing",
  OUTLINE_CONFIRMING: "outline_confirming",
  STYLE_EXTRACTING: "style_extracting",
  STYLE_CONFIRMING: "style_confirming",
  DECK_PLANNING: "deck_planning",
  GENERATING: "generating",
  GENERATING_PAUSED: "generating_paused",
  REVIEWING: "reviewing",
  FIXING: "fixing",
  REPAIR: "repair",
  VISUAL_FILLING: "visual_filling",
  COMPLETED: "completed",
  FAILED: "failed",
  EDITING: "editing",
});

// === Slide Status ===
export const SlideStatus = Object.freeze({
  PENDING: "pending",
  ASSIGNED: "assigned",
  GENERATING: "generating",
  GENERATED: "generated",
  REVIEWING: "reviewing",
  REVIEW_PASSED: "review_passed",
  REVIEW_FAILED: "review_failed",
  FIXING: "fixing",
  FIXED: "fixed",
  VISUAL_PENDING: "visual_pending",
  VISUAL_FILLING: "visual_filling",
  COMPLETED: "completed",
  FAILED: "failed",
  SKIPPED: "skipped",
});

// === Visual Slot Status ===
export const VisualSlotStatus = Object.freeze({
  PENDING: "pending",
  QUEUED: "queued",
  GENERATING: "generating",
  FILLED: "filled",
  FAILED: "failed",
  SKIPPED: "skipped",
  PLACEHOLDER: "placeholder",
});

// === Edit Session Status ===
export const EditSessionStatus = Object.freeze({
  IDLE: "idle",
  AWAITING_INPUT: "awaiting_input",
  PROCESSING: "processing",
  AWAITING_CONFIRM: "awaiting_confirm",
  EXECUTING: "executing",
  PAUSED: "paused",
});

// === SubAgent Status ===
export const SubAgentStatus = Object.freeze({
  IDLE: "idle",
  CREATED: "created",
  RUNNING: "running",
  AWAITING_MERGE: "awaiting_merge",
  MERGED: "merged",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

// === Review Status ===
export const ReviewStatus = Object.freeze({
  PENDING: "pending",
  CAPTURING: "capturing",
  ANALYZING: "analyzing",
  AWAITING_DECISION: "awaiting_decision",
  PASSED: "passed",
  FAILED: "failed",
  SKIPPED: "skipped",
});

// === 验证函数 ===
export function isValidDesignPhase(value) {
  return Object.values(DesignPhase).includes(value);
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

// === Re-export AgentStatus ===
export {
  AgentStatus,
  StepStatus,
  isValidAgentStatus,
  isValidStepStatus,
};

// 兼容旧代码
export const DesignLoopStatus = AgentStatus;

// === 简化状态机 ===
// 允许任意有效状态转换（移除硬编码转换规则）
function createSimpleMachine(validStates) {
  const stateSet = new Set(Object.values(validStates));
  return {
    canTransition: (from, to) => stateSet.has(to),
    transition: (state, next, meta) => {
      if (!stateSet.has(next)) return false;
      if (state && typeof state === "object") {
        state.status = next;
      }
      return true;
    },
  };
}

export const designPhaseMachine = createSimpleMachine(DesignPhase);
export const designLoopMachine = createSimpleMachine(AgentStatus);
export const slideStatusMachine = createSimpleMachine(SlideStatus);
export const slideMachine = slideStatusMachine; // alias
export const visualSlotMachine = createSimpleMachine(VisualSlotStatus);
export const editSessionMachine = createSimpleMachine(EditSessionStatus);
export const subAgentMachine = createSimpleMachine(SubAgentStatus);
export const reviewMachine = createSimpleMachine(ReviewStatus);

// 兼容旧测试
export const DESIGN_PHASE_TRANSITIONS = Object.freeze({});
export const DESIGN_LOOP_TRANSITIONS = Object.freeze({});
export const SLIDE_STATUS_TRANSITIONS = Object.freeze({});
export const SLIDE_TRANSITIONS = Object.freeze({});
export const VISUAL_SLOT_STATUS_TRANSITIONS = Object.freeze({});
export const VISUAL_SLOT_TRANSITIONS = Object.freeze({});
export const EDIT_SESSION_STATUS_TRANSITIONS = Object.freeze({});
export const EDIT_SESSION_TRANSITIONS = Object.freeze({});
export const SUBAGENT_STATUS_TRANSITIONS = Object.freeze({});
export const SUBAGENT_TRANSITIONS = Object.freeze({});
export const SUB_AGENT_TRANSITIONS = Object.freeze({});
export const REVIEW_STATUS_TRANSITIONS = Object.freeze({});
export const REVIEW_TRANSITIONS = Object.freeze({});
