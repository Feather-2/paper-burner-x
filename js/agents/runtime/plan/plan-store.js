import { StepStatus, isValidStepStatus } from "../core/agent-status.js";
import { makeSecureTimestampedId } from "../../shared/utils/secure-id.js";

import { isPlainObject, toNonEmptyString } from "../../shared/utils/value-utils.js";
function toIso(timestamp) {
  if (typeof timestamp === "string" && timestamp.trim()) return timestamp;
  const ms = typeof timestamp === "number" && Number.isFinite(timestamp) ? timestamp : Date.now();
  return new Date(ms).toISOString();
}

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

function normalizePlanLifecycleStatus(value, { fallback = PlanLifecycleStatus.DRAFT } = {}) {
  const raw = toNonEmptyString(value);
  if (!raw) return fallback;
  return isValidPlanLifecycleStatus(raw) ? raw : fallback;
}

export function canTransitionPlanLifecycle(from, to) {
  const src = normalizePlanLifecycleStatus(from);
  const dst = normalizePlanLifecycleStatus(to, { fallback: "" });
  if (!dst) return false;
  if (src === dst) return true;
  const allowed = PLAN_LIFECYCLE_TRANSITIONS[src] || [];
  return allowed.includes(dst);
}

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
