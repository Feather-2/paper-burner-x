/**
 * Agent Lifecycle - 统一生命周期协议
 *
 * 提供标准化的事件发射和状态转换工具，
 * 确保所有 Stages 遵循一致的生命周期协议。
 */

import { AgentStatus } from "./agent-status.js";

/**
 * @typedef {Object} EventBus
 * @property {(eventName: string, record: any) => void} [emit]
 * @property {number} [_seq]
 */

/**
 * @typedef {Object} LifecycleRecordOfInput
 * @property {string} [status]
 * @property {any} [payload]
 * @property {string} [actor]
 * @property {string} [runId]
 * @property {string} [level]
 * @property {any} [meta]
 */

/**
 * @typedef {Object} LifecycleEventRecord
 * @property {string} actor
 * @property {string} [status]
 * @property {any} [payload]
 * @property {string} [runId]
 * @property {string} [level]
 * @property {any} [meta]
 */

/**
 * @typedef {Object} LifecycleEmitOptions
 * @property {string} [status]
 * @property {string} [actor]
 * @property {string} [runId]
 * @property {string} [level]
 * @property {any} [meta]
 */

/**
 * 标准事件 payload 格式
 */
export function createEventPayload(actor, status, data = {}) {
  // NOTE: payload is nested under EventRecord.payload; actor/status live on the record.
  // Keep actor/status parameters for backward compatibility with existing callers.
  return { timestamp: Date.now(), ...data };
}

/**
 * 创建阶段转换事件 payload
 */
export function createPhaseTransitionPayload(actor, from, to, runId, extra = {}) {
  return createEventPayload(actor, "progress", { runId, from, to, ...extra });
}

/**
 * 创建 Agent 状态变更事件 payload
 */
export function createStatusChangePayload(actor, from, to, runId, extra = {}) {
  return createEventPayload(actor, "info", { runId, from, to, ...extra });
}

/**
 * 创建步骤事件 payload
 */
export function createStepPayload(actor, step, total, status, extra = {}) {
  return createEventPayload(actor, status, { step, total, ...extra });
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

function uniqStrings(values) {
  const out = [];
  const seen = new Set();
  for (const v of values) {
    if (typeof v !== "string" || !v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

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
  const directEmit = typeof emit === "function" ? emit : null;
  const busEmit = typeof eventBus?.emit === "function" ? eventBus.emit.bind(eventBus) : null;

  const emitRecord = (eventName, record) => {
    // Prefer directEmit for caller hooks/tests, but avoid double-emitting when it already forwards to EventBus.
    let forwardedToBus = false;
    const seqBefore = typeof eventBus?._seq === "number" ? eventBus._seq : null;

    if (directEmit) {
      try {
        directEmit(eventName, record);
      } catch { /* intentional */ }
    }

    const seqAfter = typeof eventBus?._seq === "number" ? eventBus._seq : null;
    if (seqBefore !== null && seqAfter !== null && seqAfter !== seqBefore) forwardedToBus = true;

    if (!forwardedToBus && busEmit) {
      try {
        busEmit(eventName, record);
      } catch { /* intentional */ }
    }
  };

  const emitMany = (eventNames, record) => {
    for (const name of uniqStrings(eventNames)) emitRecord(name, record);
  };

  /**
   * @param {LifecycleRecordOfInput} [param0]
   * @returns {LifecycleEventRecord}
   */
  const recordOf = ({ status, payload, actor: actorOverride, runId, level, meta } = {}) => {
    const out = { actor: actorOverride || actor };
    if (typeof status === "string" && status) out.status = status;
    if (payload !== undefined) out.payload = payload;
    if (typeof runId === "string" && runId) out.runId = runId;
    if (typeof level === "string" && level) out.level = level;
    if (meta !== undefined) out.meta = meta;
    return out;
  };

  const startedEventNames = uniqStrings([LifecycleEventNames.started(actor), `${actor}.agent.started`]);
  const failedEventNames = uniqStrings([LifecycleEventNames.failed(actor), `${actor}.agent.failed`]);
  const pausedEventNames = uniqStrings([LifecycleEventNames.paused(actor), `${actor}.agent.paused`]);
  const resumedEventNames = uniqStrings([LifecycleEventNames.resumed(actor), `${actor}.agent.resumed`]);

  return {
    started: (runId, extra = {}) => {
      const payload = createEventPayload(actor, "started", { runId, ...extra });
      emitMany(startedEventNames, recordOf({ status: "started", payload, runId }));
    },

    completed: (runId, extra = {}) => {
      const payload = createEventPayload(actor, "completed", { runId, ...extra });
      emitMany([LifecycleEventNames.completed(actor), `${actor}.agent.completed`], recordOf({ status: "completed", payload, runId }));

      // Design: legacy completion event is `design.ended` with status `ended` and no runId in payload.
      if (actor === "design") {
        const legacyPayload = createEventPayload(actor, "ended", { ...extra });
        emitRecord(`${actor}.ended`, recordOf({ status: "ended", payload: legacyPayload }));
      }
    },

    failed: (runId, error, extra = {}) => {
      const payload = createEventPayload(actor, "failed", { runId, error: error?.message || String(error), ...extra });
      emitMany(failedEventNames, recordOf({ status: "failed", payload, runId }));
    },

    paused: (runId, reason, extra = {}) => {
      const payload = createEventPayload(actor, "paused", { runId, reason, ...extra });
      emitMany(pausedEventNames, recordOf({ status: "info", payload, runId }));
    },

    resumed: (runId, extra = {}) => {
      const payload = createEventPayload(actor, "resumed", { runId, ...extra });
      emitMany(resumedEventNames, recordOf({ status: "info", payload, runId }));
    },

    statusChanged: (from, to, runId, extra = {}) => {
      const payload = createStatusChangePayload(actor, from, to, runId, extra);
      emitRecord(LifecycleEventNames.statusChanged(actor), recordOf({ status: "info", payload, runId }));
    },

    phaseTransition: (from, to, runId, extra = {}) => {
      const payload = createPhaseTransitionPayload(actor, from, to, runId, extra);
      emitRecord(LifecycleEventNames.phaseTransition(actor), recordOf({ status: "progress", payload, runId }));
    },

    stepStarted: (step, total, runId, extra = {}) => {
      const payload = createStepPayload(actor, step, total, "progress", { runId, ...extra });
      emitRecord(LifecycleEventNames.stepStarted(actor), recordOf({ status: "progress", payload, runId }));
    },

    stepCompleted: (step, total, runId, extra = {}) => {
      const payload = createStepPayload(actor, step, total, "completed", { runId, ...extra });
      emitRecord(LifecycleEventNames.stepCompleted(actor), recordOf({ status: "completed", payload, runId }));
    },

    stepFailed: (step, total, runId, error, extra = {}) => {
      const payload = createStepPayload(actor, step, total, "failed", { runId, error: error?.message || String(error), ...extra });
      emitRecord(LifecycleEventNames.stepFailed(actor), recordOf({ status: "failed", payload, runId }));
    },

    // 通用发射
    /**
     * @param {string} eventName
     * @param {any} payload
     * @param {LifecycleEmitOptions} [param2]
     * @returns {void}
     */
    emit: (eventName, payload, { status = "info", actor: actorOverride, runId, level, meta } = {}) => {
      emitRecord(eventName, recordOf({ actor: actorOverride, status, payload, runId, level, meta }));
    },
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
    /** @type {Error & { code?: string }} */
    const err = new Error(`Invalid ${actor} state transition: ${from} -> ${to}`);
    err.code = "INVALID_STATE_TRANSITION";
    throw err;
  }
}
