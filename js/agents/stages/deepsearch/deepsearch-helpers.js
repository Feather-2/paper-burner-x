/**
 * DeepSearch Agent Loop - Helper Functions
 *
 * 从 deepsearch-agent-loop.js 提取的辅助函数，减少主文件体积。
 */

import { isPlainObject, sanitizeForJson, toPositiveInt } from "../../shared/utils/value-utils.js";
import { TraceContext } from "../../plugins/telemetry/trace-context.js";
import { getErrorBoundary } from "../../runtime/core/error-boundary.js";

// 分析模式配置（默认值）
export const DEFAULT_MODE_CONFIG = {
  quick: { maxIterations: 15, writeIterations: 5, maxToolCalls: 50, subagentIterations: 5, description: "快速概览" },
  wider: { maxIterations: 30, writeIterations: 10, maxToolCalls: 100, subagentIterations: 10, description: "广度优先，覆盖所有文档" },
  deeper: { maxIterations: 50, writeIterations: 15, maxToolCalls: 200, subagentIterations: 15, description: "深度优先，逐个分析" },
};

/**
 * Deep sort for stable JSON output.
 * Recursively sorts object keys and handles circular references.
 * @param {any} value - The value to sort
 * @param {WeakSet} [seen] - WeakSet to track seen objects for circular reference detection
 * @returns {any} - The sorted value
 */
export function deepSortForStableJson(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => deepSortForStableJson(v, seen));
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = deepSortForStableJson(value[key], seen);
  return out;
}

/**
 * Stable stringify with sorting and truncation.
 * @param {any} value - The value to stringify
 * @param {{ maxChars?: number }} [options] - Options for truncation
 * @returns {string} - The stringified value
 */
export function stableStringify(value, { maxChars = 2000 } = {}) {
  const cleaned = sanitizeForJson(value);
  let s = "";
  try {
    s = JSON.stringify(deepSortForStableJson(cleaned));
  } catch {
    try {
      s = JSON.stringify(cleaned);
    } catch {
      s = String(value ?? "");
    }
  }
  const limit = Number.isFinite(Number(maxChars)) ? Math.max(0, Math.floor(Number(maxChars))) : 0;
  if (!limit || s.length <= limit) return s;
  return s.slice(0, limit) + "...";
}

/**
 * Clamp a value to the [0, 1] interval.
 * @param {any} value - The value to clamp
 * @param {number} fallback - Fallback value if parsing fails
 * @returns {number} - The clamped value
 */
export function toClamped01Float(value, fallback) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

/**
 * Normalize report convergence configuration.
 * @param {object} [config] - Raw convergence configuration
 * @returns {{ enabled: boolean, stopOnConvergence: boolean, windowSize: number, minIterations: number, minReportChars: number, sampleMaxChars: number, entropyThreshold?: number, similarityThreshold?: number }}
 */
export function normalizeReportConvergenceConfig(config) {
  const cfg = isPlainObject(config) ? config : {};
  const enabled = cfg.enabled === true;
  const stopOnConvergence = cfg.stopOnConvergence !== false;
  const windowSize = toPositiveInt(cfg.windowSize ?? cfg.window, 5);
  const minIterations = toPositiveInt(cfg.minIterations ?? cfg.minIters, 4);
  const minReportChars = toPositiveInt(cfg.minReportChars ?? cfg.minChars, 1200);
  const sampleMaxChars = toPositiveInt(cfg.sampleMaxChars ?? cfg.maxChars, 6000);
  const entropyThreshold =
    cfg.entropyThreshold === undefined ? undefined : toClamped01Float(cfg.entropyThreshold, undefined);
  const similarityThreshold =
    cfg.similarityThreshold === undefined ? undefined : toClamped01Float(cfg.similarityThreshold, undefined);

  return {
    enabled,
    stopOnConvergence,
    windowSize,
    minIterations,
    minReportChars,
    sampleMaxChars,
    entropyThreshold,
    similarityThreshold,
  };
}

/**
 * Normalize newlines (CRLF and CR to LF).
 * @param {string} text - The text to normalize
 * @returns {string} - The normalized text
 */
export function normalizeNewlines(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

/**
 * Slice text from the tail.
 * @param {string} text - The text to slice
 * @param {number} maxChars - Maximum characters to keep from the tail
 * @returns {string} - The sliced text
 */
export function sliceTail(text, maxChars) {
  const s = String(text || "");
  const limit = Number.isFinite(maxChars) ? Math.max(0, Math.floor(maxChars)) : 0;
  if (!limit || s.length <= limit) return s;
  return s.slice(Math.max(0, s.length - limit));
}

/**
 * 构建收敛检测样本
 */
/**
 * @param {{ reportMarkdown?: string, gaps?: any[], maxChars?: number }=} sample
 * @returns {string}
 */
export function buildConvergenceSample({ reportMarkdown, gaps, maxChars } = {}) {
  const md = sliceTail(normalizeNewlines(reportMarkdown), maxChars);
  const gapLines = [];
  for (const gap of Array.isArray(gaps) ? gaps : []) {
    if (!gap || typeof gap !== "object") continue;
    const id = gap.gapId || gap.id || "";
    const status = gap.status || "open";
    const title = gap.title || gap.question || gap.text || gap.description || "";
    gapLines.push(`${String(id).slice(0, 64)}|${String(status).slice(0, 32)}|${String(title).slice(0, 240)}`.trim());
    if (gapLines.length >= 30) break;
  }

  return `REPORT:\n${md}\n\nGAPS:\n${gapLines.join("\n")}`;
}

/**
 * Resolve ErrorBoundary from stageApi or container.
 * @param {object} [stageApi] - Stage API object
 * @returns {object} - The resolved ErrorBoundary
 */
export function resolveErrorBoundary(stageApi) {
  const direct = stageApi?.errorBoundary;
  if (direct && typeof direct === "object" && typeof direct.wrap === "function") return direct;

  const container = stageApi?.container;
  if (container && typeof container === "object") {
    const tryGet = typeof container.tryGet === "function" ? container.tryGet.bind(container) : null;
    if (tryGet) {
      const candidate = tryGet("errorBoundary");
      if (candidate && typeof candidate === "object" && typeof candidate.wrap === "function") return candidate;
    }
    const get = typeof container.get === "function" ? container.get.bind(container) : null;
    if (get) {
      try {
        const candidate = get("errorBoundary");
        if (candidate && typeof candidate === "object" && typeof candidate.wrap === "function") return candidate;
      } catch {
        /* intentional: DI may throw if not registered */
      }
    }
  }

  return getErrorBoundary();
}

/**
 * Normalize tool call guard configuration.
 * @param {object} [config] - Raw guard configuration
 * @returns {{ enabled: boolean, maxConsecutive: number, warnAt: number, maxSigChars: number, ignoreTools: Set<string> }}
 */
export function normalizeToolCallGuard(config) {
  const cfg = isPlainObject(config) ? config : {};
  const enabled = cfg.enabled === true;
  const maxConsecutive = toPositiveInt(cfg.maxConsecutive, 6);
  const warnAt = toPositiveInt(cfg.warnAt, Math.max(2, maxConsecutive - 1));
  const maxSigChars = toPositiveInt(cfg.maxSignatureChars, 2000);
  const ignoreTools = new Set(Array.isArray(cfg.ignoreTools) ? cfg.ignoreTools.map(String).filter(Boolean) : []);
  return { enabled, maxConsecutive, warnAt, maxSigChars, ignoreTools };
}

/**
 * Normalize behavior fingerprint configuration.
 * @param {object|boolean} [config] - Raw fingerprint configuration or false to disable
 * @returns {{ enabled: boolean, historySize?: number, minPatternLength?: number, maxPatternLength?: number, loopThreshold?: number }}
 */
export function normalizeBehaviorFingerprintConfig(config) {
  if (config === false) return { enabled: false };
  const cfg = isPlainObject(config) ? config : {};
  const enabled = cfg.enabled === false ? false : true;
  const historySize = toPositiveInt(cfg.historySize, 100);
  const minPatternLength = toPositiveInt(cfg.minPatternLength, 2);
  const maxPatternLength = toPositiveInt(cfg.maxPatternLength, 10);
  const loopThreshold = toPositiveInt(cfg.loopThreshold, 3);
  return { enabled, historySize, minPatternLength, maxPatternLength, loopThreshold };
}

/**
 * Resolve stage-level TraceContext from stageApi.
 * @param {object} [stageApi] - Stage API object
 * @returns {TraceContext} - The resolved TraceContext
 */
export function resolveStageTraceContext(stageApi) {
  const candidate = stageApi?.traceContext;
  if (
    candidate &&
    typeof candidate === "object" &&
    typeof candidate.startSpan === "function" &&
    typeof candidate.endSpan === "function" &&
    typeof candidate.withSpan === "function"
  ) {
    return candidate;
  }

  const traceparent = typeof stageApi?.traceparent === "string" ? stageApi.traceparent.trim() : "";
  if (traceparent) {
    const parsed = TraceContext.parseTraceparent(traceparent);
    if (parsed?.traceId && parsed?.spanId) {
      return new TraceContext({ traceId: parsed.traceId, parentSpanId: parsed.spanId });
    }
  }

  return new TraceContext();
}

/**
 * Get mode configuration with defaults and overrides.
 * @param {string} mode - The analysis mode (quick/wider/deeper)
 * @param {object} [globalConfig] - Global configuration object
 * @returns {{ maxIterations: number, writeIterations: number, maxToolCalls: number, subagentIterations: number, description: string }}
 */
export function getModeConfig(mode, globalConfig) {
  const defaults = DEFAULT_MODE_CONFIG[mode] || DEFAULT_MODE_CONFIG.wider;
  const override = globalConfig?.agent?.[mode] || {};
  return {
    ...defaults,
    ...override,
    description: defaults.description,
    subagentIterations: override.subagentIterations || defaults.subagentIterations,
  };
}
