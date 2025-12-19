/**
 * DeepSearch 事件枚举
 * 统一所有 emit 事件名称，便于可视化层订阅
 */

export const DeepSearchEvents = Object.freeze({
  // 生命周期事件
  STARTED: "deepsearch.started",
  COMPLETED: "deepsearch.completed",
  ABORTED: "deepsearch.aborted",

  // 节点事件
  NODE_STARTED: "deepsearch.node.started",
  NODE_COMPLETED: "deepsearch.node.completed",
  NODE_FAILED: "deepsearch.node.failed",

  // 迭代事件
  ITERATION_STARTED: "deepsearch.iteration.started",
  ITERATION_COMPLETED: "deepsearch.iteration.completed",

  // 检查点事件
  CHECKPOINT_SAVED: "deepsearch.checkpoint.saved",

  // 预算事件
  BUDGET_ESTIMATED: "deepsearch.budget.estimated",
  BUDGET_EXCEEDED: "deepsearch.budget.exceeded",
  BUDGET_DEGRADED: "deepsearch.budget.degraded",
  BUDGET_STOP: "deepsearch.budget.stop",

  // Gap 事件
  GAP_STATUS_CHANGED: "deepsearch.gap.status.changed",

  // 直通模式事件
  DIRECT_TRIGGERED: "deepsearch.direct.triggered",

  // Trajectory 事件
  TRAJECTORY_FORKED: "deepsearch.trajectory.forked",
  TRAJECTORY_MERGED: "deepsearch.trajectory.merged",
  TRAJECTORY_STARTED: "deepsearch.trajectory.started",
  TRAJECTORY_COMPLETED: "deepsearch.trajectory.completed",
  TRAJECTORY_MERGE_STARTED: "deepsearch.trajectory.merge.started",
  TRAJECTORY_MERGE_COMPLETED: "deepsearch.trajectory.merge.completed",

  // 外搜事件
  EXTERNAL_TRIGGERED: "deepsearch.external.triggered",
  EXTERNAL_REFLECT_TRIGGERED: "deepsearch.external.reflecttriggered",
  EXTERNAL_ERROR: "deepsearch.external.error",
  EXTERNAL_SKIPPED: "deepsearch.external.skipped",

  // 写作事件
  WRITE_MODE: "deepsearch.write.mode",
  WRITE_COMPLETED: "deepsearch.write.completed",
  WRITE_BACKTRACK_REQUESTED: "deepsearch.write.backtrack.requested",
  WRITE_REACT_STEP: "deepsearch.write.react.step",
  WRITE_REACT_FAILED: "deepsearch.write.react.failed",
  WRITE_PARTIAL_RECOVERED: "deepsearch.write.partial.recovered",
  WRITE_REVIEW_STARTED: "deepsearch.write.review.started",
  WRITE_REVIEW_COMPLETED: "deepsearch.write.review.completed",
  WRITE_PATCH_APPLIED: "deepsearch.write.patch.applied",
  WRITE_REACT_FALLBACK: "deepsearch.write.react.fallback",

  // Token 使用事件
  TOKEN_USAGE: "deepsearch.token.usage",

  // Phase 状态转换事件
  PHASE_TRANSITION: "deepsearch.phase.transition",
});

// 事件状态常量
export const EventStatus = Object.freeze({
  STARTED: "started",
  PROGRESS: "progress",
  COMPLETED: "completed",
  FAILED: "failed",
  WARNING: "warning",
  INFO: "info",
});
