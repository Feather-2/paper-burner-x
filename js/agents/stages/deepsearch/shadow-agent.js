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
import { logEvent } from "./logger.js";
import { toNonEmptyString } from "../../shared/value-utils.js";

// 默认配置
const DEFAULT_CONFIG = {
  maxTokens: 400,
  timeoutMs: 10000,
  temperature: 0.1,
  // 预算控制
  maxCallsPerRound: 5,
  maxCallsPerGap: 2,
  maxCallsTotal: 20,
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
    this.callsByRound = new Map(); // round → count
    this.callsByGap = new Map();   // gapId → count
    this.results = [];
  }

  canCall(round, gapId, config) {
    const roundCalls = this.callsByRound.get(round) || 0;
    const gapCalls = this.callsByGap.get(gapId) || 0;

    if (this.totalCalls >= config.maxCallsTotal) return false;
    if (roundCalls >= config.maxCallsPerRound) return false;
    if (gapCalls >= config.maxCallsPerGap) return false;

    return true;
  }

  recordCall(round, gapId, result) {
    this.totalCalls++;
    this.callsByRound.set(round, (this.callsByRound.get(round) || 0) + 1);
    this.callsByGap.set(gapId, (this.callsByGap.get(gapId) || 0) + 1);
    this.results.push({ round, gapId, result, ts: Date.now() });
  }

  getStats() {
    return {
      totalCalls: this.totalCalls,
      callsByRound: Object.fromEntries(this.callsByRound),
      callsByGap: Object.fromEntries(this.callsByGap),
      successRate: this.results.filter(r => r.result?.success).length / Math.max(1, this.results.length),
    };
  }
}

/**
 * Shadow Agent 类
 */
export class ShadowAgent {
  constructor(stageApi, state, config = {}) {
    this.stageApi = stageApi;
    this.state = state;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.stats = new ShadowStats();
    this.callModel = getModelCaller(stageApi, { usage: "shadow", state });
  }

  /**
   * 验证 chunk 与 gap 的相关性
   */
  async validateRelevance(chunk, gap, { round = 0 } = {}) {
    const gapId = toNonEmptyString(gap?.gapId) || "unknown";
    const question = toNonEmptyString(gap?.question) || toNonEmptyString(gap?.text) || "";
    const content = toNonEmptyString(chunk?.text) || "";

    // 预算检查
    if (!this.stats.canCall(round, gapId, this.config)) {
      logEvent({
        stage: "shadow",
        message: "Shadow budget exceeded",
        data: { round, gapId, stats: this.stats.getStats() },
      });
      return { skipped: true, reason: "budget_exceeded" };
    }

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

    const prompt = RELEVANCE_PROMPT
      .replace("{question}", question)
      .replace("{content}", content.slice(0, 1500));

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

      const result = await this.callModel(
        [{ role: "user", content: prompt }],
        {
          temperature: this.config.temperature,
          maxTokens: this.config.maxTokens,
        }
      );

      clearTimeout(timeoutId);

      const candidate = extractJsonCandidate(result?.content);
      if (!candidate) {
        this.stats.recordCall(round, gapId, { success: false, reason: "parse_failed" });
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

      this.stats.recordCall(round, gapId, { success: true, relevant: verdict.relevant });

      logEvent({
        stage: "shadow",
        message: "Relevance validation completed",
        data: { gapId, chunkId: chunk?.chunkId, verdict },
      });

      return verdict;
    } catch (err) {
      this.stats.recordCall(round, gapId, { success: false, error: err?.message });
      return { skipped: true, reason: String(err?.message || err) };
    }
  }

  /**
   * 验证证据强度
   */
  async validateEvidence(claim, evidence, { round = 0 } = {}) {
    const gapId = claim?.gapIds?.[0] || "unknown";
    const claimText = toNonEmptyString(claim?.text) || "";
    const content = toNonEmptyString(evidence?.text) || toNonEmptyString(evidence?.quote) || "";

    if (!this.stats.canCall(round, gapId, this.config)) {
      return { skipped: true, reason: "budget_exceeded" };
    }

    if (!this.callModel) {
      return { skipped: true, reason: "no_model" };
    }

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
        this.stats.recordCall(round, gapId, { success: false, reason: "parse_failed" });
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

      this.stats.recordCall(round, gapId, { success: true, supports: verdict.supports });
      return verdict;
    } catch (err) {
      this.stats.recordCall(round, gapId, { success: false, error: err?.message });
      return { skipped: true, reason: String(err?.message || err) };
    }
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
  if (score >= 0.3 && score < 0.5) {
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

export default ShadowAgent;
