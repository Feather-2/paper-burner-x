/**
 * Agent Lifecycle - 统一生命周期协议
 *
 * 提供标准化的事件发射和状态转换工具，
 * 确保所有 Stages 遵循一致的生命周期协议。
 */

import { AgentStatus } from "./agent-status.js";

/**
 * 标准事件 payload 格式
 */
export function createEventPayload(actor, status, data = {}) {
  return {
    actor,
    status,
    timestamp: Date.now(),
    ...data,
  };
}

/**
 * 创建阶段转换事件 payload
 */
export function createPhaseTransitionPayload(actor, from, to, runId, extra = {}) {
  return createEventPayload(actor, "progress", {
    type: "phase.transition",
    runId,
    from,
    to,
    ...extra,
  });
}

/**
 * 创建 Agent 状态变更事件 payload
 */
export function createStatusChangePayload(actor, from, to, runId, extra = {}) {
  return createEventPayload(actor, "info", {
    type: "status.changed",
    runId,
    from,
    to,
    ...extra,
  });
}

/**
 * 创建步骤事件 payload
 */
export function createStepPayload(actor, step, total, status, extra = {}) {
  return createEventPayload(actor, status, {
    type: "step",
    step,
    total,
    ...extra,
  });
}

/**
 * 生命周期事件名生成器
 */
export function lifecycleEvent(actor, event) {
  return `${actor}.${event}`;
}

/**
 * 标准生命周期事件名
 */
export const LifecycleEventNames = {
  started: (actor) => `${actor}.started`,
  completed: (actor) => `${actor}.completed`,
  failed: (actor) => `${actor}.failed`,
  paused: (actor) => `${actor}.paused`,
  resumed: (actor) => `${actor}.resumed`,
  statusChanged: (actor) => `${actor}.agent.status.changed`,
  phaseTransition: (actor) => `${actor}.phase.transition`,
  stepStarted: (actor) => `${actor}.step.started`,
  stepCompleted: (actor) => `${actor}.step.completed`,
  stepFailed: (actor) => `${actor}.step.failed`,
};

/**
 * 创建统一的生命周期发射器
 *
 * @param {Object} options
 * @param {string} options.actor - Actor 名称（如 "codesearch", "design"）
 * @param {Function} options.emit - 发射函数
 * @param {EventBus} [options.eventBus] - 可选的 EventBus
 * @returns {Object} 生命周期发射器对象
 */
export function createLifecycleEmitter({ actor, emit, eventBus }) {
  const doEmit = (eventName, payload) => {
    const fullPayload = { actor, ...payload };

    // 通过 EventBus 发射
    if (eventBus?.emit) {
      try {
        eventBus.emit(eventName, fullPayload);
      } catch { /* intentional */ }
    }

    // 直接发射
    if (emit && emit !== eventBus?.emit) {
      try {
        emit(eventName, fullPayload);
      } catch { /* intentional */ }
    }
  };

  return {
    started: (runId, extra = {}) => {
      doEmit(LifecycleEventNames.started(actor), createEventPayload(actor, "started", { runId, ...extra }));
    },

    completed: (runId, extra = {}) => {
      doEmit(LifecycleEventNames.completed(actor), createEventPayload(actor, "completed", { runId, ...extra }));
    },

    failed: (runId, error, extra = {}) => {
      doEmit(LifecycleEventNames.failed(actor), createEventPayload(actor, "failed", { runId, error: error?.message || String(error), ...extra }));
    },

    paused: (runId, reason, extra = {}) => {
      doEmit(LifecycleEventNames.paused(actor), createEventPayload(actor, "paused", { runId, reason, ...extra }));
    },

    statusChanged: (from, to, runId, extra = {}) => {
      doEmit(LifecycleEventNames.statusChanged(actor), createStatusChangePayload(actor, from, to, runId, extra));
    },

    phaseTransition: (from, to, runId, extra = {}) => {
      doEmit(LifecycleEventNames.phaseTransition(actor), createPhaseTransitionPayload(actor, from, to, runId, extra));
    },

    stepStarted: (step, total, runId, extra = {}) => {
      doEmit(LifecycleEventNames.stepStarted(actor), createStepPayload(actor, step, total, "progress", { runId, ...extra }));
    },

    stepCompleted: (step, total, runId, extra = {}) => {
      doEmit(LifecycleEventNames.stepCompleted(actor), createStepPayload(actor, step, total, "completed", { runId, ...extra }));
    },

    stepFailed: (step, total, runId, error, extra = {}) => {
      doEmit(LifecycleEventNames.stepFailed(actor), createStepPayload(actor, step, total, "failed", { runId, error: error?.message || String(error), ...extra }));
    },

    // 通用发射
    emit: (eventName, payload) => doEmit(eventName, payload),
  };
}

/**
 * 检查是否可以进行状态转换
 */
export function canTransitionStatus(from, to) {
  const validTransitions = {
    [AgentStatus.IDLE]: [AgentStatus.RUNNING],
    [AgentStatus.RUNNING]: [AgentStatus.COMPLETED, AgentStatus.FAILED, AgentStatus.PAUSED],
    [AgentStatus.PAUSED]: [AgentStatus.RUNNING, AgentStatus.FAILED],
    [AgentStatus.COMPLETED]: [],
    [AgentStatus.FAILED]: [],
  };

  const allowed = validTransitions[from] || [];
  return allowed.includes(to);
}

/**
 * 断言状态转换有效
 */
export function assertValidTransition(from, to, actor = "unknown") {
  if (!canTransitionStatus(from, to)) {
    const err = new Error(`Invalid ${actor} state transition: ${from} -> ${to}`);
    err.code = "INVALID_STATE_TRANSITION";
    throw err;
  }
}
