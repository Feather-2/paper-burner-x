/**
 * Shadow Agent - 轻量级验证代理
 *
 * 用于灰色地带的精准判断：
 * - 主 agent 保持轻量上下文
 * - 影子 agent 深入阅读特定内容
 * - 返回结构化结论后销毁
 */

import { extractJsonCandidate } from "./state.js";
import { getModelCaller } from "./model.js";
import { createLogger } from "./logger.js";
import { extractServices } from "./stage-api.js";
import { toNonEmptyString } from "../../shared/value-utils.js";
import { CONCURRENCY_CONFIG, GAP_CONFIG } from "./constants.js";
import { loadPrompt } from "../../prompts/prompt-loader.js";

// 缓存的提示词
let _relevancePrompt = null;
let _evidencePrompt = null;

/**
 * 异步获取 relevance prompt
 */
export async function getRelevancePrompt() {
  if (_relevancePrompt) return _relevancePrompt;
  try {
    _relevancePrompt = await loadPrompt("deepsearch/shadow-relevance");
    return _relevancePrompt;
  } catch (e) {
    console.warn("[shadow-agent] Failed to load shadow-relevance.md:", e.message);
    return RELEVANCE_PROMPT;
  }
}

/**
 * 异步获取 evidence prompt
 */
export async function getEvidencePrompt() {
  if (_evidencePrompt) return _evidencePrompt;
  try {
    _evidencePrompt = await loadPrompt("deepsearch/shadow-evidence");
    return _evidencePrompt;
  } catch (e) {
    console.warn("[shadow-agent] Failed to load shadow-evidence.md:", e.message);
    return EVIDENCE_PROMPT;
  }
}

// 默认配置
const DEFAULT_CONFIG = {
  maxTokens: 400,
  timeoutMs: 10000,
  temperature: 0.1,
  // 预算控制
  maxCallsPerRound: CONCURRENCY_CONFIG.DEFAULT_PARALLEL,
  maxCallsPerGap: GAP_CONFIG.MIN_EVIDENCE_TO_FILL,
  maxCallsTotal: CONCURRENCY_CONFIG.DEFAULT_PARALLEL * 4,
  // 为高优先级 gap 预留部分预算，避免被同轮其他 gap 挤占
  priorityReserve: { high: 0.3, medium: 0.1, low: 0 },
  // 添加优先级队列支持：队列需要并发上限才有意义
  maxConcurrentCalls: CONCURRENCY_CONFIG.DEFAULT_PARALLEL,
};

// 相关性验证 prompt
const RELEVANCE_PROMPT = `判断这段内容是否回答了问题。

## 问题
{question}

## 内容
{content}

## 输出格式（严格 JSON）
{
  "relevant": true/false,
  "confidence": 0.0-1.0,
  "reason": "简短理由（20字内）",
  "keyInfo": "如果相关，提取关键信息（50字内）"
}

只返回 JSON。`;

// 证据强度验证 prompt
const EVIDENCE_PROMPT = `评估这段内容作为证据的质量。

## 论点
{claim}

## 证据内容
{content}

## 输出格式（严格 JSON）
{
  "supports": true/false,
  "strength": "strong|moderate|weak|none",
  "confidence": 0.0-1.0,
  "reason": "简短理由（20字内）",
  "betterQuote": "如果有更好的引用，提取出来"
}

只返回 JSON。`;

/**
 * Shadow Agent 统计追踪
 */
class ShadowStats {
  constructor() {
    this.totalCalls = 0;
    this.inflightCalls = 0;
    this.callsByRound = new Map(); // round → count
    this.inflightByRound = new Map(); // round → count
    this.callsByGap = new Map();   // gapId → count
    this.inflightByGap = new Map(); // gapId → count
    this.callsByPriority = new Map(); // priority → count
    this.inflightByPriority = new Map(); // priority → count
    this.callsByRoundByPriority = new Map(); // round → (priority → count)
    this.inflightByRoundByPriority = new Map(); // round → (priority → count)
    this.results = [];
  }

  static normalizePriority(priority) {
    if (priority === "high" || priority === "medium" || priority === "low") return priority;
    return "medium";
  }

  static normalizeReserveConfig(priorityReserve) {
    const defaults = { high: 0.3, medium: 0.1, low: 0 };
    const r = priorityReserve && typeof priorityReserve === "object" ? priorityReserve : {};
    const clamp01 = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);
    return {
      high: clamp01(r.high ?? defaults.high),
      medium: clamp01(r.medium ?? defaults.medium),
      low: clamp01(r.low ?? defaults.low),
    };
  }

  static gapMeta(gapOrId) {
    if (gapOrId && typeof gapOrId === "object") {
      const gapId = toNonEmptyString(gapOrId?.gapId) || "unknown";
      const priority = ShadowStats.normalizePriority(gapOrId?.priority);
      return { gapId, priority };
    }
    return { gapId: toNonEmptyString(gapOrId) || "unknown", priority: "medium" };
  }

  static safeLimit(n) {
    if (typeof n !== "number" || !Number.isFinite(n)) return 0;
    return Math.max(0, Math.floor(n));
  }

  getTotalCallsInFlight() {
    return this.totalCalls + this.inflightCalls;
  }

  getRoundCallsInFlight(round) {
    return (this.callsByRound.get(round) || 0) + (this.inflightByRound.get(round) || 0);
  }

  getGapCallsInFlight(gapId) {
    return (this.callsByGap.get(gapId) || 0) + (this.inflightByGap.get(gapId) || 0);
  }

  getPriorityCallsInFlight(priority) {
    return (this.callsByPriority.get(priority) || 0) + (this.inflightByPriority.get(priority) || 0);
  }

  getRoundPriorityCallsInFlight(round, priority) {
    const byRound = this.callsByRoundByPriority.get(round);
    const inflightByRound = this.inflightByRoundByPriority.get(round);
    return (byRound?.get(priority) || 0) + (inflightByRound?.get(priority) || 0);
  }

  static computeReservedRemaining(max, reserveRatio, usedByPriority) {
    const m = ShadowStats.safeLimit(max);
    const ratio = ShadowStats.normalizeReserveConfig(reserveRatio);
    const reservedHigh = Math.floor(m * ratio.high);
    const reservedMedium = Math.floor(m * ratio.medium);
    const highUsed = usedByPriority?.high || 0;
    const mediumUsed = usedByPriority?.medium || 0;
    return {
      reservedHighRemaining: Math.max(0, reservedHigh - highUsed),
      reservedMediumRemaining: Math.max(0, reservedMedium - mediumUsed),
    };
  }

  canCall(round, gapOrId, config) {
    const { gapId, priority } = ShadowStats.gapMeta(gapOrId);
    const maxCallsTotal = ShadowStats.safeLimit(config?.maxCallsTotal);
    const maxCallsPerRound = ShadowStats.safeLimit(config?.maxCallsPerRound);
    const maxCallsPerGap = ShadowStats.safeLimit(config?.maxCallsPerGap);

    const totalCalls = this.getTotalCallsInFlight();
    const roundCalls = this.getRoundCallsInFlight(round);
    const gapCalls = this.getGapCallsInFlight(gapId);

    if (maxCallsPerGap > 0 && gapCalls >= maxCallsPerGap) return false;

    const reserve = ShadowStats.normalizeReserveConfig(config?.priorityReserve);

    const reservedTotal = ShadowStats.computeReservedRemaining(maxCallsTotal, reserve, {
      high: this.getPriorityCallsInFlight("high"),
      medium: this.getPriorityCallsInFlight("medium"),
    });

    const reservedRound = ShadowStats.computeReservedRemaining(maxCallsPerRound, reserve, {
      high: this.getRoundPriorityCallsInFlight(round, "high"),
      medium: this.getRoundPriorityCallsInFlight(round, "medium"),
    });

    const effectiveTotalLimit =
      priority === "high"
        ? maxCallsTotal
        : priority === "medium"
          ? Math.max(0, maxCallsTotal - reservedTotal.reservedHighRemaining)
          : Math.max(0, maxCallsTotal - reservedTotal.reservedHighRemaining - reservedTotal.reservedMediumRemaining);

    const effectiveRoundLimit =
      priority === "high"
        ? maxCallsPerRound
        : priority === "medium"
          ? Math.max(0, maxCallsPerRound - reservedRound.reservedHighRemaining)
          : Math.max(0, maxCallsPerRound - reservedRound.reservedHighRemaining - reservedRound.reservedMediumRemaining);

    if (maxCallsTotal > 0 && totalCalls >= effectiveTotalLimit) return false;
    if (maxCallsPerRound > 0 && roundCalls >= effectiveRoundLimit) return false;

    return true;
  }

  reserveCall(round, gapOrId, config) {
    if (!this.canCall(round, gapOrId, config)) return null;
    const { gapId, priority } = ShadowStats.gapMeta(gapOrId);

    this.inflightCalls++;
    this.inflightByRound.set(round, (this.inflightByRound.get(round) || 0) + 1);
    this.inflightByGap.set(gapId, (this.inflightByGap.get(gapId) || 0) + 1);
    this.inflightByPriority.set(priority, (this.inflightByPriority.get(priority) || 0) + 1);

    if (!this.inflightByRoundByPriority.has(round)) this.inflightByRoundByPriority.set(round, new Map());
    const inflightByRound = this.inflightByRoundByPriority.get(round);
    inflightByRound.set(priority, (inflightByRound.get(priority) || 0) + 1);

    return { round, gapId, priority };
  }

  finishCall(reservation, result) {
    const round = reservation?.round ?? 0;
    const gapId = toNonEmptyString(reservation?.gapId) || "unknown";
    const priority = ShadowStats.normalizePriority(reservation?.priority);

    this.totalCalls++;
    this.inflightCalls = Math.max(0, this.inflightCalls - 1);
    this.callsByRound.set(round, (this.callsByRound.get(round) || 0) + 1);
    this.callsByGap.set(gapId, (this.callsByGap.get(gapId) || 0) + 1);
    this.callsByPriority.set(priority, (this.callsByPriority.get(priority) || 0) + 1);

    this.inflightByRound.set(round, Math.max(0, (this.inflightByRound.get(round) || 0) - 1));
    this.inflightByGap.set(gapId, Math.max(0, (this.inflightByGap.get(gapId) || 0) - 1));
    this.inflightByPriority.set(priority, Math.max(0, (this.inflightByPriority.get(priority) || 0) - 1));

    if (!this.callsByRoundByPriority.has(round)) this.callsByRoundByPriority.set(round, new Map());
    const completedByRound = this.callsByRoundByPriority.get(round);
    completedByRound.set(priority, (completedByRound.get(priority) || 0) + 1);

    const inflightByRound = this.inflightByRoundByPriority.get(round);
    if (inflightByRound) inflightByRound.set(priority, Math.max(0, (inflightByRound.get(priority) || 0) - 1));

    this.results.push({ round, gapId, result, ts: Date.now() });
  }

  getStats() {
    return {
      totalCalls: this.totalCalls,
      inflightCalls: this.inflightCalls,
      callsByRound: Object.fromEntries(this.callsByRound),
      callsByGap: Object.fromEntries(this.callsByGap),
      successRate: this.results.filter(r => r.result?.success).length / Math.max(1, this.results.length),
    };
  }
}

class ShadowPriorityQueue {
  constructor({ maxConcurrent = CONCURRENCY_CONFIG.DEFAULT_PARALLEL } = {}) {
    this.maxConcurrent = typeof maxConcurrent === "number" && Number.isFinite(maxConcurrent) ? Math.max(1, Math.floor(maxConcurrent)) : CONCURRENCY_CONFIG.DEFAULT_PARALLEL;
    this.inflight = 0;
    this.drainScheduled = false;
    this.queues = { high: [], medium: [], low: [] };
  }

  enqueue(priority, fn) {
    const p = ShadowStats.normalizePriority(priority);
    return new Promise((resolve, reject) => {
      this.queues[p].push({ fn, resolve, reject });
      this.scheduleDrain();
    });
  }

  nextTask() {
    if (this.queues.high.length) return this.queues.high.shift();
    if (this.queues.medium.length) return this.queues.medium.shift();
    if (this.queues.low.length) return this.queues.low.shift();
    return null;
  }

  drain() {
    while (this.inflight < this.maxConcurrent) {
      const task = this.nextTask();
      if (!task) return;
      this.inflight++;
      Promise.resolve()
        .then(task.fn)
        .then(task.resolve, task.reject)
        .finally(() => {
          this.inflight = Math.max(0, this.inflight - 1);
          this.scheduleDrain();
        });
    }
  }

  scheduleDrain() {
    if (this.drainScheduled) return;
    this.drainScheduled = true;
    queueMicrotask(() => {
      this.drainScheduled = false;
      this.drain();
    });
  }
}

/**
 * Shadow Agent 类
 */
export class ShadowAgent {
  constructor(stageApi, state, config = {}) {
    const { emit: rawEmit, logger: injectedLogger } = extractServices(stageApi);
    this.stageApi = stageApi;
    this.state = state;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.stats = new ShadowStats();
    this.callModel = getModelCaller(stageApi, { usage: "shadow", state });
    this.logger =
      injectedLogger && typeof injectedLogger.info === "function"
        ? injectedLogger
        : createLogger({
            emit: rawEmit,
            getContext: () => ({
              runId: state?.runId,
              iteration: state?.iteration || 0,
              trajectoryId: state?.trajectoryId,
              stage: "shadow",
            }),
          });
    const maxConcurrentCalls = ShadowStats.safeLimit(this.config.maxConcurrentCalls) || ShadowStats.safeLimit(this.config.maxCallsPerRound) || CONCURRENCY_CONFIG.DEFAULT_PARALLEL;
    this.queue = new ShadowPriorityQueue({ maxConcurrent: maxConcurrentCalls });
  }

  /**
   * 验证 chunk 与 gap 的相关性
   */
  async validateRelevance(chunk, gap, { round = 0 } = {}) {
    const gapId = toNonEmptyString(gap?.gapId) || "unknown";
    const priority = ShadowStats.normalizePriority(gap?.priority);
    const question = toNonEmptyString(gap?.question) || toNonEmptyString(gap?.text) || "";
    const content = toNonEmptyString(chunk?.text) || "";

    // 内容太短，用启发式
    if (content.length < 100) {
      const hasKeyword = gap?.queryHints?.some(h => content.toLowerCase().includes(String(h).toLowerCase()));
      return {
        relevant: hasKeyword,
        confidence: 0.5,
        reason: "content_too_short",
        heuristic: true,
      };
    }

    if (!this.callModel) {
      return { skipped: true, reason: "no_model" };
    }

    return this.queue.enqueue(priority, async () => {
      const reservation = this.stats.reserveCall(round, gap, this.config);
      if (!reservation) {
        this.logger.warn("Shadow budget exceeded", { stage: "shadow", data: { round, gapId, priority, stats: this.stats.getStats() } });
        return { skipped: true, reason: "budget_exceeded" };
      }

      const prompt = RELEVANCE_PROMPT
        .replace("{question}", question)
        .replace("{content}", content.slice(0, 1500));

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort("timeout"), this.config.timeoutMs);

      try {
        const result = await this.callModel([{ role: "user", content: prompt }], {
          temperature: this.config.temperature,
          maxTokens: this.config.maxTokens,
          signal: controller.signal,
        });

        const candidate = extractJsonCandidate(result?.content);
        if (!candidate) {
          this.stats.finishCall(reservation, { success: false, reason: "parse_failed" });
          return { skipped: true, reason: "parse_failed" };
        }

        const parsed = JSON.parse(candidate);
        const verdict = {
          relevant: Boolean(parsed.relevant),
          confidence: typeof parsed.confidence === "number" ? Math.min(1, Math.max(0, parsed.confidence)) : 0.5,
          reason: toNonEmptyString(parsed.reason) || "",
          keyInfo: toNonEmptyString(parsed.keyInfo),
          success: true,
        };

        this.stats.finishCall(reservation, { success: true, relevant: verdict.relevant });

        this.logger.info("Relevance validation completed", { stage: "shadow", data: { gapId, chunkId: chunk?.chunkId, verdict } });

        return verdict;
      } catch (err) {
        this.stats.finishCall(reservation, { success: false, error: err?.message });
        return { skipped: true, reason: String(err?.message || err) };
      } finally {
        clearTimeout(timeoutId);
      }
    });
  }

  /**
   * 验证证据强度
   */
  async validateEvidence(claim, evidence, { round = 0 } = {}) {
    const gapId = claim?.gapIds?.[0] || "unknown";
    const priority = ShadowStats.normalizePriority(claim?.priority);
    const claimText = toNonEmptyString(claim?.text) || "";
    const content = toNonEmptyString(evidence?.text) || toNonEmptyString(evidence?.quote) || "";

    if (!this.callModel) {
      return { skipped: true, reason: "no_model" };
    }

    return this.queue.enqueue(priority, async () => {
      const reservation = this.stats.reserveCall(round, { gapId, priority }, this.config);
      if (!reservation) return { skipped: true, reason: "budget_exceeded" };

      const prompt = EVIDENCE_PROMPT
        .replace("{claim}", claimText)
        .replace("{content}", content.slice(0, 1500));

      try {
        const result = await this.callModel(
          [{ role: "user", content: prompt }],
          {
            temperature: this.config.temperature,
            maxTokens: this.config.maxTokens,
          }
        );

        const candidate = extractJsonCandidate(result?.content);
        if (!candidate) {
          this.stats.finishCall(reservation, { success: false, reason: "parse_failed" });
          return { skipped: true, reason: "parse_failed" };
        }

        const parsed = JSON.parse(candidate);
        const verdict = {
          supports: Boolean(parsed.supports),
          strength: ["strong", "moderate", "weak", "none"].includes(parsed.strength) ? parsed.strength : "weak",
          confidence: typeof parsed.confidence === "number" ? Math.min(1, Math.max(0, parsed.confidence)) : 0.5,
          reason: toNonEmptyString(parsed.reason) || "",
          betterQuote: toNonEmptyString(parsed.betterQuote),
          success: true,
        };

        this.stats.finishCall(reservation, { success: true, supports: verdict.supports });
        return verdict;
      } catch (err) {
        this.stats.finishCall(reservation, { success: false, error: err?.message });
        return { skipped: true, reason: String(err?.message || err) };
      }
    });
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return this.stats.getStats();
  }
}

/**
 * 判断是否应该对 chunk 派影子验证
 */
export function shouldValidateWithShadow(chunk, gap, config = {}) {
  const score = typeof chunk?.score === "number" ? chunk.score : 0;
  const minScore = config.shadowMinScore ?? 0.2;
  const maxScore = config.shadowMaxScore ?? 0.7;

  // 分数太低，直接跳过
  if (score < minScore) {
    return { shouldValidate: false, reason: "score_too_low" };
  }

  // 分数够高，直接信任
  if (score >= maxScore) {
    return { shouldValidate: false, reason: "score_high_enough" };
  }

  // 高优先级 gap，值得验证
  if (gap?.priority === "high") {
    return { shouldValidate: true, reason: "high_priority_gap" };
  }

  // 灰色地带（0.3-0.5），验证
  if (score >= 0.3 && score < GAP_CONFIG.QUALITY_THRESHOLD) {
    return { shouldValidate: true, reason: "gray_zone" };
  }

  return { shouldValidate: false, reason: "default" };
}

/**
 * 创建 ShadowAgent 实例
 */
export function createShadowAgent(stageApi, state, config = {}) {
  return new ShadowAgent(stageApi, state, config);
}

/**
 * 批量验证 claims
 * @param {Array} claims - 论点数组
 * @param {Array} evidenceLedger - 证据数组
 * @param {object} options - 选项 { gapId, round }
 * @returns {Promise<Array>} 验证结果数组
 */
ShadowAgent.prototype.validateBatch = async function (claims, evidenceLedger, { gapId, round = 0 } = {}) {
  const results = [];
  const maxClaims = this.config.maxCallsPerRound || 5;
  const maxEvidencePerClaim = this.config.maxCallsPerGap || 3;

  for (const claim of (claims || []).slice(0, maxClaims)) {
    const claimEvidenceIds = Array.isArray(claim?.evidenceIds) ? claim.evidenceIds : [];
    const matchedEvidence = (evidenceLedger || []).filter(
      e => claimEvidenceIds.includes(e?.evidenceId)
    );

    for (const ev of matchedEvidence.slice(0, maxEvidencePerClaim)) {
      try {
        const result = await this.validateEvidence(claim, ev, { round });
        results.push({
          claimId: claim?.claimId,
          evidenceId: ev?.evidenceId,
          valid: Boolean(result?.supports),
          ...result,
        });
      } catch (err) {
        results.push({
          claimId: claim?.claimId,
          evidenceId: ev?.evidenceId,
          valid: false,
          skipped: true,
          reason: String(err?.message || err),
        });
      }
    }
  }

  return results;
};

/**
 * 创建 Shadow Agent 订阅者
 * 订阅 UNDERSTAND_COMPLETED，异步验证 claims/evidence
 * @param {object} eventBus - 事件总线 { subscribe, emit }
 * @param {object} stageApi - Stage API
 * @param {object} config - 配置 { enabled, onValidated }
 * @returns {Function} 取消订阅函数
 */
export function createShadowSubscriber(eventBus, stageApi, config = {}) {
  const { enabled = true, onValidated, state } = config;

  // 如果禁用，返回空的取消订阅函数
  if (!enabled) return () => {};

  // 验证 eventBus
  if (!eventBus || typeof eventBus.subscribe !== "function") {
    console.warn("[ShadowAgent] Invalid eventBus, subscriber not registered");
    return () => {};
  }

  // 延迟创建 ShadowAgent 实例（在收到事件时创建）
  let shadowAgent = null;

  const unsub = eventBus.subscribe(
    "deepsearch.understand.completed",
    async ({ record }) => {
      const payload = record?.payload ?? record;
      const claims = Array.isArray(payload?.claims)
        ? payload.claims
        : (Array.isArray(state?.L1?.claims) ? state.L1.claims : []);
      const evidenceLedger = Array.isArray(payload?.evidenceLedger)
        ? payload.evidenceLedger
        : (Array.isArray(state?.L1?.evidenceLedger) ? state.L1.evidenceLedger : []);
      const gapId = payload?.gapId;
      const iteration = payload?.iteration ?? state?.iteration ?? 0;

      // 没有 claims 则跳过
      if (!claims.length) return;

      // 延迟初始化 ShadowAgent
      if (!shadowAgent) {
        shadowAgent = new ShadowAgent(stageApi, state, config);
      }

      // 异步批量验证，不阻塞主流程
      try {
        const results = await shadowAgent.validateBatch(claims, evidenceLedger, { gapId, round: iteration });

        const validCount = results.filter(r => r.valid).length;
        const totalCount = results.length;

        // 发送验证完成事件
        if (eventBus && typeof eventBus.emit === "function") {
          eventBus.emit("deepsearch.shadow.completed", {
            gapId,
            iteration,
            results,
            validCount,
            totalCount,
          });
        }

        // 回调通知
        if (typeof onValidated === "function") {
          onValidated(results, { gapId, iteration });
        }
      } catch (err) {
        console.warn(`[ShadowAgent] Validation failed for gap ${gapId}:`, err?.message || err);
      }
    }
  );

  return unsub;
}

/**
 * 可选：等待 Shadow 验证结果的同步模式
 * @param {object} eventBus - 事件总线
 * @param {string} gapId - Gap ID
 * @param {number} timeoutMs - 超时时间（毫秒）
 * @returns {Promise<Array|null>} 验证结果或 null（超时）
 */
export function waitForShadowValidation(eventBus, gapId, timeoutMs = 10000) {
  if (!eventBus || typeof eventBus.once !== "function") {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      unsub?.();
      resolve(null); // 超时返回 null，不阻塞主流程
    }, timeoutMs);

    const unsub = eventBus.once("deepsearch.shadow.completed", ({ record }) => {
      const payload = record?.payload ?? record;
      if (payload?.gapId === gapId || !gapId) {
        clearTimeout(timer);
        resolve(payload?.results ?? []);
      }
    });
  });
}

export default ShadowAgent;

export const __test = {
  ShadowStats,
  ShadowPriorityQueue,
};
