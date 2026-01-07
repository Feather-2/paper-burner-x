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

/**
 * @typedef {'idle'|'outline_parsing'|'outline_confirming'|'style_extracting'|'style_confirming'|'deck_planning'|'plan_confirming'|'layout_analyzing'|'layout_generating'|'layout_developing'|'layout_confirming'|'generating'|'generating_paused'|'reviewing'|'fixing'|'repair'|'visual_filling'|'completed'|'failed'|'editing'} DesignPhaseValue
 */

// === Design Phase ===
/** @type {Readonly<Record<string, DesignPhaseValue>>} */
export const DesignPhase = Object.freeze({
  IDLE: "idle",
  OUTLINE_PARSING: "outline_parsing",
  OUTLINE_CONFIRMING: "outline_confirming",
  STYLE_EXTRACTING: "style_extracting",
  STYLE_CONFIRMING: "style_confirming",
  DECK_PLANNING: "deck_planning",
  PLAN_CONFIRMING: "plan_confirming",
  LAYOUT_ANALYZING: "layout_analyzing",    // 布局分析
  LAYOUT_GENERATING: "layout_generating",  // 布局生成
  LAYOUT_DEVELOPING: "layout_developing",  // 布局/原型生成
  LAYOUT_CONFIRMING: "layout_confirming",  // 布局确认
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
// 支持严格转换验证（可选）
function createSimpleMachine(validStates, transitions = null) {
  const stateSet = new Set(Object.values(validStates));
  const transitionMap = transitions ? new Map(Object.entries(transitions)) : null;
  return {
    canTransition(from, to) {
      if (!stateSet.has(to)) return false;
      if (from === to) return true;
      // 如果定义了转换规则，则严格验证
      if (transitionMap && from) {
        const allowed = transitionMap.get(from);
        return Array.isArray(allowed) && allowed.includes(to);
      }
      return true; // 无规则时允许任意转换
    },
    transition(state, next, meta) {
      const from =
        meta && typeof meta === "object" && typeof meta.from === "string"
          ? meta.from
          : (state && typeof state === "object" && typeof state.status === "string" ? state.status : null);
      if (!this.canTransition(from, next)) {
        throw new Error(`Invalid state transition: ${from || "null"} -> ${next}`);
      }
      if (state && typeof state === "object") {
        state.status = next;
      }
      return true;
    },
  };
}

// DesignPhase 有效转换路径
const DESIGN_PHASE_VALID_TRANSITIONS = {
  [DesignPhase.IDLE]: [DesignPhase.OUTLINE_PARSING, DesignPhase.FAILED],
  [DesignPhase.OUTLINE_PARSING]: [DesignPhase.OUTLINE_CONFIRMING, DesignPhase.FAILED],
  [DesignPhase.OUTLINE_CONFIRMING]: [DesignPhase.STYLE_EXTRACTING, DesignPhase.OUTLINE_PARSING, DesignPhase.FAILED],
  [DesignPhase.STYLE_EXTRACTING]: [DesignPhase.STYLE_CONFIRMING, DesignPhase.FAILED],
  [DesignPhase.STYLE_CONFIRMING]: [DesignPhase.DECK_PLANNING, DesignPhase.GENERATING, DesignPhase.STYLE_EXTRACTING, DesignPhase.FAILED],
  [DesignPhase.DECK_PLANNING]: [DesignPhase.PLAN_CONFIRMING, DesignPhase.FAILED],
  [DesignPhase.PLAN_CONFIRMING]: [
    DesignPhase.LAYOUT_ANALYZING,
    DesignPhase.LAYOUT_GENERATING,
    DesignPhase.LAYOUT_DEVELOPING,
    DesignPhase.GENERATING,
    DesignPhase.DECK_PLANNING,
    DesignPhase.FAILED,
  ],
  [DesignPhase.LAYOUT_ANALYZING]: [DesignPhase.LAYOUT_GENERATING, DesignPhase.LAYOUT_CONFIRMING, DesignPhase.FAILED],
  [DesignPhase.LAYOUT_GENERATING]: [DesignPhase.LAYOUT_CONFIRMING, DesignPhase.FAILED],
  [DesignPhase.LAYOUT_DEVELOPING]: [DesignPhase.LAYOUT_CONFIRMING, DesignPhase.FAILED],
  [DesignPhase.LAYOUT_CONFIRMING]: [
    DesignPhase.GENERATING,
    DesignPhase.LAYOUT_ANALYZING,
    DesignPhase.LAYOUT_GENERATING,
    DesignPhase.LAYOUT_DEVELOPING,
    DesignPhase.FAILED,
  ],
  [DesignPhase.GENERATING]: [
    DesignPhase.GENERATING_PAUSED,
    DesignPhase.REPAIR,
    DesignPhase.REVIEWING,
    DesignPhase.VISUAL_FILLING,
    DesignPhase.COMPLETED,
    DesignPhase.FAILED,
  ],
  [DesignPhase.GENERATING_PAUSED]: [DesignPhase.GENERATING, DesignPhase.FAILED],
  [DesignPhase.REVIEWING]: [DesignPhase.FIXING, DesignPhase.REPAIR, DesignPhase.VISUAL_FILLING, DesignPhase.COMPLETED, DesignPhase.FAILED],
  [DesignPhase.FIXING]: [DesignPhase.REVIEWING, DesignPhase.REPAIR, DesignPhase.FAILED],
  [DesignPhase.REPAIR]: [DesignPhase.VISUAL_FILLING, DesignPhase.REVIEWING, DesignPhase.FAILED],
  [DesignPhase.VISUAL_FILLING]: [DesignPhase.REVIEWING, DesignPhase.COMPLETED, DesignPhase.FAILED],
  [DesignPhase.COMPLETED]: [DesignPhase.EDITING],
  [DesignPhase.FAILED]: [DesignPhase.IDLE],
  [DesignPhase.EDITING]: [DesignPhase.COMPLETED, DesignPhase.FAILED],
};

export const designPhaseMachine = createSimpleMachine(DesignPhase, DESIGN_PHASE_VALID_TRANSITIONS);
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
