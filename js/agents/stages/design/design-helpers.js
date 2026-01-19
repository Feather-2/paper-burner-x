/**
 * Design Agent Loop - Helper Functions
 *
 * 从 agent-loop.js 提取的辅助函数，减少主文件体积。
 */

import { TraceContext } from "../../plugins/telemetry/index.js";
import { getErrorBoundary } from "../../runtime/index.js";
import { safeJsonParse } from "../../shared/index.js";
import { createLogger } from "../../shared/index.js";

const logger = createLogger("stages/design/design-helpers");

/**
 * @typedef {object} TraceContextLike
 * @property {(name: string, fn: (span: any) => any, options?: any) => any} withSpan
 * @property {(name: string, attrs?: any) => any} startSpan
 * @property {(span: any) => void} endSpan
 */

/**
 * @typedef {object} ErrorBoundaryLike
 * @property {(fn: Function, options?: any) => any} wrap
 */

/**
 * @typedef {object} WatchdogSettings
 * @property {number} maxRecentOutputs
 * @property {number} similarityThreshold
 * @property {number} maxConsecutiveSimilar
 * @property {number} stuckThresholdMs
 * @property {number} maxTimeMs
 */

/**
 * @typedef {object} DesignConcurrencyConfig
 * @property {number} [batchSize]
 * @property {number} [batchConcurrency]
 * @property {number} [imageConcurrency]
 */

/** @type {any} */
const process = /** @type {any} */ (globalThis).process;

// === 可配置常量 ===
export const DESIGN_LOOP_DEFAULTS = {
  batchSize: 4,
  batchConcurrency: 2,
  imageConcurrency: 4,
  maxIterations: 10,
  maxBacktrackAttempts: 3,
  signatureLength: 64,
};

/**
 * 解析 Watchdog 配置
 * @param {any} userConfig
 * @returns {WatchdogSettings}
 */
export function resolveWatchdogSettings(userConfig) {
  const raw = userConfig && typeof userConfig === "object" ? userConfig.watchdog : null;
  const cfg = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};

  const maxRecentOutputs = Number.isFinite(cfg.maxRecentOutputs) ? Math.max(2, Math.floor(cfg.maxRecentOutputs)) : 8;
  const similarityThreshold = Number.isFinite(cfg.similarityThreshold)
    ? Math.min(1, Math.max(0, cfg.similarityThreshold))
    : 0.8;
  const maxConsecutiveSimilar = Number.isFinite(cfg.maxConsecutiveSimilar)
    ? Math.max(2, Math.floor(cfg.maxConsecutiveSimilar))
    : 3;

  const stuckThresholdMs = Number.isFinite(cfg.stuckThresholdMs) ? Math.max(10_000, Math.floor(cfg.stuckThresholdMs)) : 5 * 60_000;
  const maxTimeMs = Number.isFinite(cfg.maxTimeMs) ? Math.max(30_000, Math.floor(cfg.maxTimeMs)) : 30 * 60_000;

  return { maxRecentOutputs, similarityThreshold, maxConsecutiveSimilar, stuckThresholdMs, maxTimeMs };
}

/**
 * 安全 JSON 字符串化（截断）
 * @param {any} value
 * @param {number} [maxChars=600]
 * @returns {string}
 */
export function safeJsonStringify(value, maxChars = 600) {
  try {
    const text = JSON.stringify(value);
    if (typeof text !== "string") return "";
    return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
  } catch {
    const text = String(value ?? "");
    return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
  }
}

/**
 * 解析 Stage 级别的 TraceContext
 * @param {any} stageApi
 * @returns {TraceContextLike}
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
 * 解析 ErrorBoundary
 * @param {any} stageApi
 * @param {any} [container]
 * @returns {ErrorBoundaryLike}
 */
export function resolveErrorBoundary(stageApi, container) {
  const direct = stageApi?.errorBoundary;
  if (direct && typeof direct === "object" && typeof direct.wrap === "function") return direct;

  const c = container || stageApi?.container;
  if (c && typeof c === "object") {
    const tryGet = typeof c.tryGet === "function" ? c.tryGet.bind(c) : null;
    if (tryGet) {
      const candidate = tryGet("errorBoundary");
      if (candidate && typeof candidate === "object" && typeof candidate.wrap === "function") return candidate;
    }
    const get = typeof c.get === "function" ? c.get.bind(c) : null;
    if (get) {
      try {
        const candidate = get("errorBoundary");
        if (candidate && typeof candidate === "object" && typeof candidate.wrap === "function") return candidate;
      } catch {
        /* intentional: DI container may throw if service not registered */
      }
    }
  }

  return getErrorBoundary();
}

/**
 * 创建带 Tracing 的 AiApiService 代理
 * @template T
 * @param {T} aiApiService
 * @param {TraceContextLike} traceContext
 * @returns {T}
 */
export function createTracedAiApiService(aiApiService, traceContext) {
  const svc = /** @type {any} */ (aiApiService);
  if (!svc || typeof svc !== "object" || typeof svc.chat !== "function") return aiApiService;

  return new Proxy(svc, {
    get(target, prop) {
      if (prop === "chat") {
        return async (opts = {}) => {
          const model = typeof opts?.model === "string" ? opts.model : "auto";
          const maxTokens = typeof opts?.maxTokens === "number" ? opts.maxTokens : undefined;
          const temperature = typeof opts?.temperature === "number" ? opts.temperature : undefined;
          const usage = typeof opts?.usage === "string" ? opts.usage : undefined;
          return await traceContext.withSpan("design.llm.chat", async (span) => {
            span.setAttributes({
              ...(model ? { model } : {}),
              ...(usage ? { usage } : {}),
              ...(maxTokens !== undefined ? { maxTokens } : {}),
              ...(temperature !== undefined ? { temperature } : {}),
            });
            return await target.chat.call(target, opts);
          });
        };
      }
      const value = target[prop];
      if (typeof value === "function") return value.bind(target);
      return value;
    },
  });
}

/**
 * 创建带 Tracing 的 ModelRouter 代理
 * @template T
 * @param {T} modelRouter
 * @param {TraceContextLike} traceContext
 * @returns {T}
 */
export function createTracedModelRouter(modelRouter, traceContext) {
  const router = /** @type {any} */ (modelRouter);
  if (!router || typeof router !== "object" || typeof router.call !== "function") return modelRouter;

  return new Proxy(router, {
    get(target, prop) {
      if (prop === "call") {
        return async (...args) => {
          let usage = undefined;
          let model = undefined;
          try {
            if (args.length >= 2 && args[1] && typeof args[1] === "object") {
              usage = typeof args[1].usage === "string" ? args[1].usage : undefined;
              model = typeof args[1].model === "string" ? args[1].model : undefined;
            } else if (args.length >= 1 && args[0] && typeof args[0] === "object" && !Array.isArray(args[0])) {
              usage = typeof args[0].usage === "string" ? args[0].usage : undefined;
              model = typeof args[0].model === "string" ? args[0].model : undefined;
            }
          } catch {
            /* intentional: ignore arg inspection failures */
          }
          return await traceContext.withSpan("design.llm.call", async (span) => {
            span.setAttributes({
              ...(usage ? { usage } : {}),
              ...(model ? { model } : {}),
            });
            return await target.call.apply(target, args);
          });
        };
      }
      const value = target[prop];
      if (typeof value === "function") return value.bind(target);
      return value;
    },
  });
}

/**
 * 构建 Watchdog 干预建议
 * @param {Array<{type?:string}>} issues
 * @returns {string}
 */
export function buildDesignWatchdogAdvice(issues) {
  const rows = Array.isArray(issues) ? issues : [];
  const types = new Set(rows.map((x) => String(x?.type || "")));

  const tips = [];
  if (types.has("oscillation")) {
    tips.push("检测到输出高度相似/可能震荡；建议改变策略（调整布局/约束/提示词），或回溯到上一个稳定 checkpoint 后重试。");
    tips.push("Refine 阶段可减少 recommendedSteps/hardLimit，或先 screenshotAll 再集中修 1-2 个关键问题。");
  }
  if (types.has("timeout")) tips.push("总耗时过长；建议跳过非关键步骤（如 final review）或缩减图片/渲染工作量。");
  if (types.has("stuck")) tips.push("长时间无明显进展；建议切分问题、减少单步工作量，或回溯并换一种修复路径。");
  if (types.has("max_iterations")) tips.push("迭代次数过多；建议尽快收敛到可交付版本，剩余问题留待编辑模式处理。");

  if (!tips.length) tips.push("检测到潜在卡死；建议改变策略或回溯到稳定状态。");
  return tips.join(" ");
}

/**
 * 提取 Refine 事件摘要（用于 Watchdog 指纹）
 * @param {any} evt
 * @returns {string}
 */
export function summarizeRefineEventForWatchdog(evt) {
  const payload = evt?.payload && typeof evt.payload === "object" ? evt.payload : {};
  const stepIndex = Number.isFinite(payload.stepIndex) ? payload.stepIndex : null;
  const tool = payload.tool || payload?.action?.tool || "";
  const ok =
    typeof payload?.result?.success === "boolean"
      ? payload.result.success
      : typeof payload?.observation?.success === "boolean"
        ? payload.observation.success
        : null;
  const err =
    (typeof payload?.result?.error === "string" && payload.result.error) ||
    (typeof payload?.observation?.error === "string" && payload.observation.error) ||
    "";
  const finish = payload.finish && typeof payload.finish === "object" ? payload.finish : null;

  const parts = ["refine_step"];
  if (stepIndex !== null) parts.push(`step=${stepIndex}`);
  if (tool) parts.push(`tool=${String(tool)}`);
  if (ok !== null) parts.push(`ok=${ok}`);
  if (finish) {
    if (Number.isFinite(finish.qualityScore)) parts.push(`quality=${finish.qualityScore}`);
    if (Number.isFinite(finish.remainingIssues)) parts.push(`remaining=${finish.remainingIssues}`);
  }
  if (payload?.params) parts.push(`params=${safeJsonStringify(payload.params, 260)}`);
  if (err) parts.push(`error=${String(err).slice(0, 160)}`);

  return parts.join(" | ");
}

/**
 * 发射 Stage 事件（统一格式）
 * @param {((name: string, event: any) => void) | null | undefined} emit
 * @param {string} name
 * @param {string} status
 * @param {any} payload
 * @returns {void}
 */
export function emitStage(emit, name, status, payload) {
  emit?.(name, { actor: "design", status, payload });
}

/**
 * 加载设计并发配置
 * @returns {DesignConcurrencyConfig | null}
 */
export function loadDesignConcurrencyConfig() {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem("ppt_designConcurrency") : null;
    if (raw) {
      const parsed = safeJsonParse(raw, { maxChars: 200_000 });
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
      logger.warn('[design] Invalid localStorage "ppt_designConcurrency" JSON; ignoring');
    }
  } catch {
    /* intentional: ignore localStorage access failures */
  }
  const env = typeof process !== "undefined" ? process.env : {};
  const batchSize = parseInt(env.DESIGN_BATCH_SIZE, 10);
  const batchConcurrency = parseInt(env.DESIGN_BATCH_CONCURRENCY, 10);
  const imageConcurrency = parseInt(env.DESIGN_IMAGE_CONCURRENCY, 10);
  if (batchSize > 0 || batchConcurrency > 0 || imageConcurrency > 0) {
    return {
      ...(batchSize > 0 ? { batchSize } : {}),
      ...(batchConcurrency > 0 ? { batchConcurrency } : {}),
      ...(imageConcurrency > 0 ? { imageConcurrency } : {}),
    };
  }
  return null;
}

/**
 * BacktrackError - 回溯信号异常
 */
export class BacktrackError extends Error {
  /**
   * @param {string} targetPhase
   * @param {string} label
   * @param {string} reason
   */
  constructor(targetPhase, label, reason) {
    super(`Backtrack to ${targetPhase} (${label}): ${reason}`);
    this.name = "BacktrackError";
    this.targetPhase = targetPhase;
    this.label = label;
    this.reason = reason;
  }
}
