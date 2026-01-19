/**
 * DeepSearch pricing helpers.
 *
 * Resolves per-model price entries and estimates incremental USD cost from token usage.
 */
import { isPlainObject, safeInt, safeNumber } from "../../../shared/index.js";

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
 * @param {{model?:string, usage?:{input?:number,output?:number}, prices?:object}=} params
 * @returns {number}
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
    (inputPer1K !== null ? (Math.max(0, inputTokens) / 1000) * Math.max(0, inputPer1K) : 0) +
    (outputPer1K !== null ? (Math.max(0, outputTokens) / 1000) * Math.max(0, outputPer1K) : 0);

  return Number.isFinite(cost) ? cost : 0;
}

export const __test = {
  isPlainObject,
  safeInt,
  safeNumber,
};
