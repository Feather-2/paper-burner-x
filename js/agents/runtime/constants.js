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
