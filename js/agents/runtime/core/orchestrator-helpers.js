/**
 * Orchestrator — helper functions (extracted from orchestrator.js)
 */

import { toNonEmptyString } from "../../shared/index.js";
import { ActorType, isValidActorType } from "./constants.js";
import { CommonSchemas } from "./config-validator.js";

/**
 * @param {unknown} v
 * @param {number|null} fallback
 * @returns {number|null}
 */
export function normalizeTimeoutMs(v, fallback) {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

export const DEFAULT_USER_CONFIG_SCHEMA = Object.freeze({
  mode: { type: "string" },
  maxIterations: CommonSchemas.positiveInt,
  contextWindow: CommonSchemas.positiveInt,
  compressThreshold: CommonSchemas.ratio,
  reportTargetWords: CommonSchemas.positiveInt,
  reportLength: { type: "string" },
  eventBusBackpressure: {
    type: "object",
    properties: {
      batchWindowMs: CommonSchemas.nonNegativeInt,
      maxQueueSize: CommonSchemas.positiveInt,
      deferNonCoalesced: { type: "boolean" },
    },
  },
  backpressure: {
    type: "object",
    properties: {
      batchWindowMs: CommonSchemas.nonNegativeInt,
      maxQueueSize: CommonSchemas.positiveInt,
      deferNonCoalesced: { type: "boolean" },
    },
  },
  watchdog: {
    type: "object",
    properties: {
      maxRecentOutputs: CommonSchemas.positiveInt,
      similarityThreshold: CommonSchemas.ratio,
    },
  },
  budget: { type: "object" },
  memory: { type: "object" },
  toolCallGuard: { type: "object" },
  behaviorFingerprint: { type: "object" },
  errorBoundary: {
    type: "object",
    properties: { degrade: { type: "boolean" } },
  },
  degradeOnError: { type: "boolean" },
});

/**
 * @param {Array<{ path?: string, message?: string }>} errors
 * @param {{ maxItems?: number } | undefined} [options]
 * @returns {string}
 */
export function formatValidationErrors(errors, { maxItems = 10 } = {}) {
  const list = Array.isArray(errors) ? errors : [];
  if (list.length === 0) return "";
  const head = list.slice(0, Math.max(0, Math.floor(maxItems)));
  const lines = head.map((e) => `- ${e.path || "root"}: ${e.message || "Invalid"}`);
  const suffix = list.length > head.length ? `\n...and ${list.length - head.length} more` : "";
  return `${lines.join("\n")}${suffix}`;
}

export function isPromiseLike(value) {
  return value !== null && typeof value === "object" && typeof value.then === "function";
}

export async function maybeAwait(value) {
  return isPromiseLike(value) ? await value : value;
}

export function isDegradationMatrixLike(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof value.recordRequest === "function" &&
    typeof value.getStatus === "function" &&
    typeof value.getRecommendations === "function" &&
    typeof value.isFeatureEnabled === "function"
  );
}

/** @typedef {{ heapUsed?: number, heapTotal?: number, rss?: number }} MemoryUsageLike */
/** @typedef {{ memoryUsage?: () => MemoryUsageLike }} ProcessWithMemoryUsage */
/** @typedef {{ usedJSHeapSize?: number, jsHeapSizeLimit?: number }} PerformanceMemoryLike */

export function defaultMemoryUsageRatio() {
  try {
    const proc = (/** @type {{ process?: ProcessWithMemoryUsage }} */ (globalThis)).process;
    if (proc && typeof proc.memoryUsage === "function") {
      const mem = proc.memoryUsage();
      const used = typeof mem.heapUsed === "number" ? mem.heapUsed : mem.rss;
      const total = typeof mem.heapTotal === "number" ? mem.heapTotal : mem.rss;
      if (typeof used === "number" && typeof total === "number" && total > 0) return used / total;
    }
  } catch { /* ignore */ }
  try {
    const perf = globalThis?.performance;
    const perfMem = perf ? (/** @type {Performance & { memory?: PerformanceMemoryLike }} */ (perf)).memory : null;
    if (perfMem && typeof perfMem.usedJSHeapSize === "number" && typeof perfMem.jsHeapSizeLimit === "number" && perfMem.jsHeapSizeLimit > 0) {
      return perfMem.usedJSHeapSize / perfMem.jsHeapSizeLimit;
    }
  } catch { /* ignore */ }
  return 0;
}

export function buildRunContext({ runId, mode, scenario, constraints } = {}) {
  return {
    schemaVersion: "0.1",
    runId: toNonEmptyString(runId) || `run_${Date.now()}`,
    mode: toNonEmptyString(mode) || "deepsearch",
    scenario: toNonEmptyString(scenario) || "business",
    constraints: constraints && typeof constraints === "object" ? constraints : {},
    createdAt: new Date().toISOString(),
  };
}

export function deriveActorFromStageName(stageName, fallbackActor = ActorType.SYSTEM) {
  const name = toNonEmptyString(stageName);
  const head = name.split(".")[0];
  const candidate = head && isValidActorType(head) ? head : fallbackActor;
  return candidate;
}

export function createStageAbortSignal(parentSignal, timeoutMs) {
  const controller = new AbortController();
  const { signal } = controller;
  let timerId = null;
  const cleanup = () => {
    if (timerId) clearTimeout(timerId);
    timerId = null;
    if (parentSignal && typeof parentSignal.removeEventListener === "function") {
      parentSignal.removeEventListener("abort", onParentAbort);
    }
  };
  const onParentAbort = () => {
    try { controller.abort(parentSignal.reason || "run_cancelled"); }
    finally { cleanup(); }
  };
  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort(parentSignal.reason || "run_cancelled");
      cleanup();
    } else if (typeof parentSignal.addEventListener === "function") {
      parentSignal.addEventListener("abort", onParentAbort, { once: true });
    }
  }
  if (Number.isFinite(timeoutMs) && timeoutMs > 0 && !signal.aborted) {
    timerId = setTimeout(() => { controller.abort("stage_timeout"); cleanup(); }, timeoutMs);
  }
  return { signal, cleanup };
}
