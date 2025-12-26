/**
 * AgentStatus - 简化的 Agent 执行状态
 *
 * 参考 Codex 的设计：状态机是任务驱动的动态异步流，
 * 进度追踪通过 todos + events 实现。
 */

export const AgentStatus = Object.freeze({
  IDLE: "idle",
  RUNNING: "running",
  PAUSED: "paused",
  COMPLETED: "completed",
  FAILED: "failed",
});

/**
 * StepStatus - 步骤/任务状态（对应 Codex 的 plan_tool.rs）
 */
export const StepStatus = Object.freeze({
  PENDING: "pending",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

export function isValidAgentStatus(value) {
  return Object.values(AgentStatus).includes(value);
}

export function isValidStepStatus(value) {
  return Object.values(StepStatus).includes(value);
}

/**
 * 判断 Agent 是否处于活跃状态
 */
export function isAgentActive(status) {
  return status === AgentStatus.RUNNING || status === AgentStatus.PAUSED;
}

/**
 * 判断 Agent 是否已终止
 */
export function isAgentTerminal(status) {
  return status === AgentStatus.COMPLETED || status === AgentStatus.FAILED;
}

export default AgentStatus;
