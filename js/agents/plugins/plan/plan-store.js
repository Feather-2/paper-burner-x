import { StepStatus, isValidStepStatus } from "../core/agent-status.js";
import { makeSecureTimestampedId } from "../../shared/index.js";

import { isPlainObject, toNonEmptyString } from "../../shared/index.js";

/**
 * @typedef {Object} PlanStep
 * @property {string} stepId
 * @property {string} title
 * @property {string} status
 * @property {string} [createdAt]
 * @property {string} [updatedAt]
 * @property {Record<string, unknown>} [meta] - 步骤元数据 (扩展字段)
 */

/**
 * @typedef {Object} Plan
 * @property {string} schemaVersion
 * @property {string} kind
 * @property {string} planId
 * @property {string} runId
 * @property {string} title
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {string} lifecycleStatus
 * @property {string} [status] - legacy alias of lifecycleStatus
 * @property {number} selectedStepIndex
 * @property {PlanStep[]} steps
 * @property {Record<string, unknown>} [meta] - 计划元数据 (扩展字段)
 */

/**
 * @typedef {'draft' | 'approved' | 'in_progress' | 'completed' | 'failed' | 'cancelled'} PlanLifecycleStatusValue
 */

/**
 * @typedef {Object} PlanArtifactStore
 * @property {(runId: string, type: string, payload: Record<string, unknown>, options?: { artifactId?: string, mime?: string }) => Promise<unknown>} saveArtifact - Persist plan artifacts.
 */

/**
 * 将时间戳转换为 ISO 8601 字符串。
 * @private
 * @param {string | number | Date | null} [timestamp] - 输入时间戳，支持字符串/毫秒/Date 对象
 * @returns {string} ISO 8601 格式时间字符串
 */
function toIso(timestamp) {
  if (typeof timestamp === "string" && timestamp.trim()) return timestamp;
  const ms = typeof timestamp === "number" && Number.isFinite(timestamp) ? timestamp : Date.now();
  return new Date(ms).toISOString();
}

/**
 * 生成唯一的计划 ID。
 * @private
 * @returns {string} 带 plan_ 前缀的唯一 ID
 */
function generatePlanId() {
  return makeSecureTimestampedId("plan");
}

export const PLAN_SCHEMA_VERSION = "0.1";
export const PLAN_ARTIFACT_TYPE = "plan.json";

export const PlanLifecycleStatus = Object.freeze({
  DRAFT: "draft",
  APPROVED: "approved",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

/**
 * Check whether a value is a valid plan lifecycle status.
 * @param {PlanLifecycleStatusValue | string} value - Candidate lifecycle status.
 * @returns {boolean} True when the value matches a known lifecycle status.
 */
export function isValidPlanLifecycleStatus(value) {
  return Object.values(PlanLifecycleStatus).includes(value);
}

const PLAN_LIFECYCLE_TRANSITIONS = Object.freeze({
  [PlanLifecycleStatus.DRAFT]: [PlanLifecycleStatus.APPROVED, PlanLifecycleStatus.CANCELLED],
  [PlanLifecycleStatus.APPROVED]: [PlanLifecycleStatus.IN_PROGRESS, PlanLifecycleStatus.CANCELLED],
  [PlanLifecycleStatus.IN_PROGRESS]: [PlanLifecycleStatus.COMPLETED, PlanLifecycleStatus.FAILED, PlanLifecycleStatus.CANCELLED],
  [PlanLifecycleStatus.COMPLETED]: [],
  [PlanLifecycleStatus.FAILED]: [],
  [PlanLifecycleStatus.CANCELLED]: [],
});

/**
 * Normalize a lifecycle status value.
 * @param {PlanLifecycleStatusValue | string | null | undefined} value - Raw lifecycle status.
 * @param {{ fallback?: PlanLifecycleStatusValue | string } | undefined} [options] - Fallback status.
 * @returns {string} Normalized lifecycle status.
 */
function normalizePlanLifecycleStatus(value, { fallback = PlanLifecycleStatus.DRAFT } = {}) {
  const raw = toNonEmptyString(value);
  if (!raw) return fallback;
  return isValidPlanLifecycleStatus(raw) ? raw : fallback;
}

/**
 * Check whether a plan can transition between lifecycle states.
 * @param {PlanLifecycleStatusValue | string} from - Current lifecycle status.
 * @param {PlanLifecycleStatusValue | string} to - Target lifecycle status.
 * @returns {boolean} True when the transition is allowed.
 */
export function canTransitionPlanLifecycle(from, to) {
  const src = normalizePlanLifecycleStatus(from);
  const dst = normalizePlanLifecycleStatus(to, { fallback: "" });
  if (!dst) return false;
  if (src === dst) return true;
  const allowed = PLAN_LIFECYCLE_TRANSITIONS[src] || [];
  return allowed.includes(dst);
}

/**
 * Update a plan lifecycle status.
 * @param {Plan} plan - Plan to update.
 * @param {PlanLifecycleStatusValue | string} status - Desired lifecycle status.
 * @param {{ updatedAt?: string | number | Date | null, force?: boolean } | undefined} [options] - Update options.
 * @returns {Plan} Updated plan.
 */
export function setPlanLifecycleStatus(plan, status, { updatedAt, force = false } = {}) {
  if (!plan || typeof plan !== "object") throw new TypeError("setPlanLifecycleStatus(plan,...): plan must be an object");
  const prev = normalizePlanLifecycleStatus(plan.lifecycleStatus ?? plan.status);
  const next = normalizePlanLifecycleStatus(status, { fallback: "" });
  if (!next) throw new Error(`setPlanLifecycleStatus(plan,...): invalid status: ${toNonEmptyString(status)}`);

  if (!force && !canTransitionPlanLifecycle(prev, next)) {
    throw new Error(`setPlanLifecycleStatus(plan,...): invalid transition: ${prev} -> ${next}`);
  }

  const ts = toIso(updatedAt);
  return {
    ...plan,
    lifecycleStatus: next,
    updatedAt: ts,
  };
}

/**
 * Create a normalized plan object.
 * @param {{
 *   runId?: string,
 *   planId?: string,
 *   title?: string,
 *   kind?: string,
 *   steps?: Array<Partial<PlanStep>>,
 *   selectedStepIndex?: number,
 *   meta?: Record<string, unknown>,
 *   lifecycleStatus?: PlanLifecycleStatusValue | string
 * } | undefined} [input] - Plan creation input.
 * @returns {Plan} Normalized plan.
 */
export function createPlan({ runId, planId, title, kind, steps, selectedStepIndex, meta, lifecycleStatus } = {}) {
  const now = toIso();
  const normalizedSteps = Array.isArray(steps) ? steps : [];

  const out = {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: toNonEmptyString(kind) || "plan",
    planId: toNonEmptyString(planId) || generatePlanId(),
    runId: toNonEmptyString(runId) || "run_unknown",
    title: toNonEmptyString(title) || "Plan",
    createdAt: now,
    updatedAt: now,
    lifecycleStatus: normalizePlanLifecycleStatus(lifecycleStatus),
    selectedStepIndex: Number.isFinite(selectedStepIndex) ? Math.max(0, Math.floor(selectedStepIndex)) : 0,
    steps: normalizedSteps.map((s, i) => normalizePlanStep(s, { fallbackIndex: i })),
    ...(isPlainObject(meta) ? { meta } : {}),
  };

  // Clamp selectedStepIndex to available steps (or 0 when empty).
  if (out.steps.length === 0) out.selectedStepIndex = 0;
  else if (out.selectedStepIndex >= out.steps.length) out.selectedStepIndex = out.steps.length - 1;

  return out;
}

/**
 * Normalize a plan step input.
 * @param {Partial<PlanStep> | Record<string, unknown> | null | undefined} step - Raw step input.
 * @param {{ fallbackIndex?: number } | undefined} [options] - Fallback options.
 * @returns {PlanStep} Normalized plan step.
 */
export function normalizePlanStep(step, { fallbackIndex = 0 } = {}) {
  const s = isPlainObject(step) ? step : {};
  const stepId = toNonEmptyString(s.stepId) || `step_${fallbackIndex + 1}`;
  const title = toNonEmptyString(s.title) || toNonEmptyString(s.text) || stepId;
  const statusRaw = toNonEmptyString(s.status) || StepStatus.PENDING;
  const status = isValidStepStatus(statusRaw) ? statusRaw : StepStatus.PENDING;

  return {
    stepId,
    title,
    status,
    ...(toNonEmptyString(s.updatedAt) ? { updatedAt: toIso(s.updatedAt) } : {}),
    ...(toNonEmptyString(s.createdAt) ? { createdAt: toIso(s.createdAt) } : {}),
    ...(isPlainObject(s.meta) ? { meta: s.meta } : {}),
  };
}

/**
 * Find the index of a step by ID or index.
 * @param {Plan | Record<string, unknown> | null | undefined} plan - Plan to search.
 * @param {string | number} stepIdOrIndex - Step ID or numeric index.
 * @returns {number} Step index, or -1 when not found.
 */
export function findPlanStepIndex(plan, stepIdOrIndex) {
  if (!plan || typeof plan !== "object") return -1;
  if (!Array.isArray(plan.steps)) return -1;
  if (typeof stepIdOrIndex === "number" && Number.isFinite(stepIdOrIndex)) {
    const idx = Math.floor(stepIdOrIndex);
    return idx >= 0 && idx < plan.steps.length ? idx : -1;
  }
  const id = toNonEmptyString(stepIdOrIndex);
  if (!id) return -1;
  return plan.steps.findIndex((s) => toNonEmptyString(s?.stepId) === id);
}

/**
 * @param {Plan} plan
 * @param {string | number} stepIdOrIndex
 * @param {string} status
 * @param {{ updatedAt?: string | number | Date | null, select?: boolean } | undefined} [options]
 * @returns {Plan}
 */
export function setPlanStepStatus(plan, stepIdOrIndex, status, { updatedAt, select = true } = {}) {
  if (!plan || typeof plan !== "object") throw new TypeError("setPlanStepStatus(plan,...): plan must be an object");
  if (!Array.isArray(plan.steps)) throw new TypeError("setPlanStepStatus(plan,...): plan.steps must be an array");

  const idx = findPlanStepIndex(plan, stepIdOrIndex);
  if (idx < 0) return plan;

  const nextStatus = toNonEmptyString(status);
  if (!isValidStepStatus(nextStatus)) {
    throw new Error(`setPlanStepStatus(plan,...): invalid status: ${nextStatus}`);
  }

  const ts = toIso(updatedAt);
  const nextSteps = plan.steps.map((s, i) => {
    if (i !== idx) return s;
    return {
      ...s,
      status: nextStatus,
      updatedAt: ts,
      ...(toNonEmptyString(s.createdAt) ? {} : { createdAt: ts }),
    };
  });

  return {
    ...plan,
    steps: nextSteps,
    updatedAt: ts,
    ...(select ? { selectedStepIndex: idx } : {}),
  };
}

/**
 * Save a plan artifact to the run store.
 * @param {{
 *   runStore?: PlanArtifactStore,
 *   runId?: string,
 *   plan?: Plan | Record<string, unknown>,
 *   type?: string,
 *   artifactId?: string
 * } | undefined} [input] - Save plan input.
 * @returns {Promise<unknown>} Result from runStore.saveArtifact.
 */
export async function savePlan({ runStore, runId, plan, type = PLAN_ARTIFACT_TYPE, artifactId } = {}) {
  if (!runStore || typeof runStore.saveArtifact !== "function") {
    throw new TypeError("savePlan({ runStore }): runStore.saveArtifact is required");
  }
  const id = toNonEmptyString(runId) || toNonEmptyString(plan?.runId);
  if (!id) throw new Error("savePlan({ runId }): runId is required");

  const payload = plan && typeof plan.toJSON === "function" ? plan.toJSON() : plan;
  if (!payload || typeof payload !== "object") throw new Error("savePlan({ plan }): plan must be an object");

  return await runStore.saveArtifact(id, type, payload, {
    ...(toNonEmptyString(artifactId) ? { artifactId: toNonEmptyString(artifactId) } : {}),
    mime: "application/json",
  });
}

export default {
  PLAN_SCHEMA_VERSION,
  PLAN_ARTIFACT_TYPE,
  PlanLifecycleStatus,
  isValidPlanLifecycleStatus,
  canTransitionPlanLifecycle,
  setPlanLifecycleStatus,
  createPlan,
  normalizePlanStep,
  findPlanStepIndex,
  setPlanStepStatus,
  savePlan,
};
