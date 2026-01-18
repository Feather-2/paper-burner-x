import { isPlainObject, safeInt, safeNumber, toNonEmptyString } from "../../../shared/utils/value-utils.js";
import { normalizeTokenUsage as _normalizeTokenUsage } from "../model/usage.js";
import { stripThinkingTags as _stripThinkingTags, extractJsonCandidate as _extractJsonCandidate } from "../../../shared/utils/json-candidate.js";

/**
 * Normalize token usage from various provider formats.
 * @param {any} usage
 * @returns {import("../model/usage.js").NormalizedTokenUsage|null}
 */
export const normalizeTokenUsage = _normalizeTokenUsage;

export const EVENT_SCHEMA_VERSION = "deepsearch.event.v1";

export const EventStatus = Object.freeze({
  STARTED: "started",
  PROGRESS: "progress",
  COMPLETED: "completed",
  FAILED: "failed",
  WARNING: "warning",
  INFO: "info",
});

const DEFAULT_BUDGET_CONFIG = Object.freeze({
  maxTokens: 50_000,
  maxCostUSD: 0.5,
  warnAt: 0.8,
  action: "warn",
});

const DEFAULT_MODEL_PRICES_USD_PER_1K = Object.freeze({
  // OpenAI (placeholder defaults; override via userConfig.budget.prices for exact billing).
  "gpt-4o-mini": { input: 0.00015, output: 0.0006 },
  "gpt-4o": { input: 0.005, output: 0.015 },
  "gpt-4.1-mini": { input: 0.0003, output: 0.0012 },
  "gpt-4.1": { input: 0.003, output: 0.012 },

  // Anthropic (placeholder defaults; override via userConfig.budget.prices for exact billing).
  "claude-3-5-sonnet": { input: 0.003, output: 0.015 },
  "claude-3-5-haiku": { input: 0.0008, output: 0.004 },

  // Gemini & others: default to unknown/0 unless configured.
});

/**
 * @typedef {object} TokenUsageWithCost
 * @property {number} input
 * @property {number} output
 * @property {number} total
 * @property {number} estimatedCostUSD
 */

/**
 * Ensure a stable token-usage shape `{input, output, total, estimatedCostUSD}`.
 * @param {any} v
 * @returns {TokenUsageWithCost}
 */
export function ensureTokenUsage(v) {
  const normalized = normalizeTokenUsage(v);
  if (normalized) {
    const estimatedCostUSD = safeNumber(v?.estimatedCostUSD ?? v?.costUSD);
    return {
      input: normalized.input,
      output: normalized.output,
      total: normalized.total,
      estimatedCostUSD: estimatedCostUSD !== null ? Math.max(0, estimatedCostUSD) : 0,
    };
  }
  return { input: 0, output: 0, total: 0, estimatedCostUSD: 0 };
}

function normalizeBudgetAction(v) {
  const s = toNonEmptyString(v);
  if (s === "warn" || s === "degrade" || s === "stop") return s;
  return DEFAULT_BUDGET_CONFIG.action;
}

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function normalizeModelPrices(raw) {
  const prices = isPlainObject(raw) ? raw : {};
  const out = Object.create(null);

  for (const [modelId, entry] of Object.entries(prices)) {
    const key = toNonEmptyString(modelId);
    if (!key) continue;
    if (DANGEROUS_KEYS.has(key)) continue;
    if (!isPlainObject(entry)) continue;
    const input = safeNumber(entry.input ?? entry.inputPer1K ?? entry.inputUsdPer1K ?? entry.inputUSDPer1K);
    const output = safeNumber(entry.output ?? entry.outputPer1K ?? entry.outputUsdPer1K ?? entry.outputUSDPer1K);
    if (input === null && output === null) continue;
    out[key] = {
      ...(input !== null ? { input: Math.max(0, input) } : {}),
      ...(output !== null ? { output: Math.max(0, output) } : {}),
    };
  }

  return out;
}

/**
 * @typedef {"warn"|"degrade"|"stop"} BudgetAction
 *
 * @typedef {object} ModelPriceEntry
 * @property {number=} input
 * @property {number=} output
 *
 * @typedef {object} BudgetConfig
 * @property {number} maxTokens
 * @property {number} maxCostUSD
 * @property {number} warnAt
 * @property {BudgetAction} action
 * @property {Record<string, ModelPriceEntry>} prices
 */

/**
 * Normalize and merge the budget configuration with defaults.
 * @param {any} raw
 * @returns {BudgetConfig}
 */
export function normalizeBudgetConfig(raw) {
  const cfg = isPlainObject(raw) ? raw : {};

  const maxTokens = safeInt(cfg.maxTokens);
  const maxCostUSD = safeNumber(cfg.maxCostUSD);
  const warnAtRaw = safeNumber(cfg.warnAt);
  const warnAt = warnAtRaw === null ? DEFAULT_BUDGET_CONFIG.warnAt : Math.max(0, Math.min(1, warnAtRaw));
  const action = normalizeBudgetAction(cfg.action);

  const mergedPrices = { ...DEFAULT_MODEL_PRICES_USD_PER_1K, ...normalizeModelPrices(cfg.prices) };

  return {
    maxTokens: maxTokens !== null && maxTokens >= 0 ? maxTokens : DEFAULT_BUDGET_CONFIG.maxTokens,
    maxCostUSD: maxCostUSD !== null && maxCostUSD >= 0 ? maxCostUSD : DEFAULT_BUDGET_CONFIG.maxCostUSD,
    warnAt,
    action,
    prices: mergedPrices,
  };
}

/**
 * Strip DeepSeek-R1 style `<think>...</think>` blocks from output.
 * @param {any} text
 * @returns {string}
 */
export const stripThinkingTags = _stripThinkingTags;

/**
 * Extract a parsable JSON substring from noisy text.
 * @param {string} text
 * @param {{prefer?: "any"|"array"|"object"}} [options]
 * @returns {string|null}
 */
export const extractJsonCandidate = _extractJsonCandidate;
