import { isPlainObject, safeInt, safeNumber, toNonEmptyString } from "../../../shared/utils/value-utils.js";
import { normalizeTokenUsage } from "../model/usage.js";

export { normalizeTokenUsage };

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

function normalizeModelPrices(raw) {
  const prices = isPlainObject(raw) ? raw : {};
  const out = {};

  for (const [modelId, entry] of Object.entries(prices)) {
    if (!toNonEmptyString(modelId)) continue;
    if (!isPlainObject(entry)) continue;
    const input = safeNumber(entry.input ?? entry.inputPer1K ?? entry.inputUsdPer1K ?? entry.inputUSDPer1K);
    const output = safeNumber(entry.output ?? entry.outputPer1K ?? entry.outputUsdPer1K ?? entry.outputUSDPer1K);
    if (input === null && output === null) continue;
    out[String(modelId)] = {
      ...(input !== null ? { input: Math.max(0, input) } : {}),
      ...(output !== null ? { output: Math.max(0, output) } : {}),
    };
  }

  return out;
}

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
 * Strip DeepSeek-R1 style <think>...</think> reasoning blocks from LLM output.
 * These blocks contain chain-of-thought reasoning that should not be part of the final output.
 */
export function stripThinkingTags(text) {
  const s = String(text || "");
  // Remove <think>...</think> blocks (non-greedy, handles nested content)
  return s.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

export function extractJsonCandidate(text) {
  // First strip any <think> reasoning blocks from R1 models
  const stripped = stripThinkingTags(text);
  const s = stripped.trim();
  if (!s) return null;

  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced && fenced[1]) return fenced[1].trim();

  // Try to extract a valid JSON value (supports {} and []), even when the text
  // contains multiple brace/bracket pairs or trailing noise.
  //
  // Performance note: the previous implementation scanned backwards from the end
  // and attempted JSON.parse many times (O(n²) on long outputs). Here we use a
  // bracket stack to locate balanced candidates in a forward scan, then only
  // attempt JSON.parse on those candidates.
  const findBalancedEnd = (startIdx) => {
    const openCh = s[startIdx];
    if (openCh !== "{" && openCh !== "[") return -1;

    const stack = [openCh];
    let inString = false;
    let escape = false;

    for (let i = startIdx + 1; i < s.length; i++) {
      const ch = s[i];

      if (inString) {
        if (escape) {
          escape = false;
          continue;
        }
        if (ch === "\\") {
          escape = true;
          continue;
        }
        if (ch === '"') inString = false;
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }

      if (ch === "{" || ch === "[") {
        stack.push(ch);
        continue;
      }

      if (ch === "}" || ch === "]") {
        const top = stack[stack.length - 1];
        const matches = (ch === "}" && top === "{") || (ch === "]" && top === "[");
        if (!matches) continue;

        stack.pop();
        if (!stack.length) return i;
      }
    }

    return -1;
  };

  const starts = [s.indexOf("{"), s.indexOf("[")].filter((idx) => idx >= 0).sort((a, b) => a - b);

  for (const startIdx of starts) {
    const endIdx = findBalancedEnd(startIdx);
    if (endIdx < 0) continue;

    const candidate = s.slice(startIdx, endIdx + 1);
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {}
  }

  return s;
}
