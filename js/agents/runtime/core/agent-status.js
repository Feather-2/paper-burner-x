/**
 * AgentStatus - 简化的 Agent 执行状态
 *
 * 状态机是任务驱动的动态异步流，
 * 进度追踪通过 todos + events 实现。
 */

/**
 * @typedef {"idle" | "running" | "paused" | "completed" | "failed"} AgentStatusValue
 * @typedef {"pending" | "in_progress" | "completed" | "failed" | "cancelled"} StepStatusValue
 */

/**
 * Agent 执行状态枚举
 * @readonly
 * @enum {AgentStatusValue}
 */
export const AgentStatus = Object.freeze({
  IDLE: "idle",
  RUNNING: "running",
  PAUSED: "paused",
  COMPLETED: "completed",
  FAILED: "failed",
});

/**
 * StepStatus - 步骤/任务状态
 * @readonly
 * @enum {StepStatusValue}
 */
export const StepStatus = Object.freeze({
  PENDING: "pending",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

/**
 * @param {unknown} value
 * @returns {value is AgentStatusValue}
 */
export function isValidAgentStatus(value) {
  return Object.values(AgentStatus).includes(/** @type {AgentStatusValue} */ (value));
}

/**
 * @param {unknown} value
 * @returns {value is StepStatusValue}
 */
export function isValidStepStatus(value) {
  return Object.values(StepStatus).includes(/** @type {StepStatusValue} */ (value));
}

/**
 * 判断 Agent 是否处于活跃状态
 * @param {unknown} status
 * @returns {boolean}
 */
export function isAgentActive(status) {
  return status === AgentStatus.RUNNING || status === AgentStatus.PAUSED;
}

/**
 * 判断 Agent 是否已终止
 * @param {unknown} status
 * @returns {boolean}
 */
export function isAgentTerminal(status) {
  return status === AgentStatus.COMPLETED || status === AgentStatus.FAILED;
}

export default AgentStatus;
