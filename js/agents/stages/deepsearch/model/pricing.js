/**
 * DeepSearch pricing helpers.
 *
 * Resolves per-model price entries and estimates incremental USD cost from token usage.
 */
import { isPlainObject, safeInt, safeNumber } from "../../../shared/index.js";

const TOKENS_PER_1K = 1000;

/**
 * @typedef {object} PricingEntry
 * @property {number} [input] - Input USD per 1K tokens
 * @property {number} [inputPer1K] - Input USD per 1K tokens
 * @property {number} [inputUsdPer1K] - Input USD per 1K tokens
 * @property {number} [inputUSDPer1K] - Input USD per 1K tokens
 * @property {number} [output] - Output USD per 1K tokens
 * @property {number} [outputPer1K] - Output USD per 1K tokens
 * @property {number} [outputUsdPer1K] - Output USD per 1K tokens
 * @property {number} [outputUSDPer1K] - Output USD per 1K tokens
 */

/**
 * @typedef {Record<string, PricingEntry>} PricingTable
 */

/**
 * @typedef {object} ResolveModelPricingResult
 * @property {string} modelKey - Resolved pricing key
 * @property {PricingEntry} entry - Pricing entry for the model
 */

/**
 * @typedef {object} UsageTotals
 * @property {number} [input] - Input token count
 * @property {number} [output] - Output token count
 */

/**
 * @typedef {object} EstimateCostParams
 * @property {string} [model] - Model identifier
 * @property {UsageTotals} [usage] - Normalized token usage
 * @property {PricingTable} [prices] - Pricing table keyed by model/prefix
 */

/**
 * Resolve a pricing entry for a model id.
 * @param {string} modelId - Model identifier to resolve
 * @param {PricingTable} prices - Pricing table keyed by model id or prefix
 * @returns {ResolveModelPricingResult|null} Resolved pricing info or null if not found
 */
export function resolveModelPricing(modelId, prices) {
  if (!isPlainObject(prices)) return null;
  const id = typeof modelId === "string" ? modelId : "";
  if (!id) return null;

  if (isPlainObject(prices[id])) return { modelKey: id, entry: prices[id] };

  let best = null;
  for (const [key, entry] of Object.entries(prices)) {
    if (!isPlainObject(entry)) continue;
    if (!key || key === "*") continue;
    if (!id.startsWith(key)) continue;
    if (!best || key.length > best.modelKey.length) best = { modelKey: key, entry };
  }
  if (best) return best;

  if (isPlainObject(prices["*"])) return { modelKey: "*", entry: prices["*"] };
  return null;
}

/**
 * Estimates cost delta in USD for a single model call.
 * @param {EstimateCostParams} [params] - Pricing resolution inputs
 * @returns {number} Estimated USD cost delta
 */
export function estimateCostUSDDelta({ model, usage, prices } = {}) {
  const resolved = resolveModelPricing(model, prices);
  if (!resolved) return 0;
  const entry = resolved.entry;

  const inputPer1K = safeNumber(entry.input ?? entry.inputPer1K ?? entry.inputUsdPer1K ?? entry.inputUSDPer1K);
  const outputPer1K = safeNumber(entry.output ?? entry.outputPer1K ?? entry.outputUsdPer1K ?? entry.outputUSDPer1K);

  const inputTokens = safeInt(usage?.input) ?? 0;
  const outputTokens = safeInt(usage?.output) ?? 0;

  const cost =
    (inputPer1K !== null ? (Math.max(0, inputTokens) / TOKENS_PER_1K) * Math.max(0, inputPer1K) : 0) +
    (outputPer1K !== null ? (Math.max(0, outputTokens) / TOKENS_PER_1K) * Math.max(0, outputPer1K) : 0);

  return Number.isFinite(cost) ? cost : 0;
}

export const __test = {
  isPlainObject,
  safeInt,
  safeNumber,
};
