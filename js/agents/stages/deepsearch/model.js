import { makeStageEmitter, normalizeBudgetConfig } from "./state.js";
import { buildBaseCaller } from "./model/caller.js";
import { emitBudgetEvents, ensureBudgetState } from "./model/budget.js";
import { estimateCostUSDDelta, resolveModelPricing } from "./model/pricing.js";
import { normalizeTokenUsage } from "./model/usage.js";
import { isPlainObject, toNonEmptyString, safeInt, safeNumber } from "../../shared/value-utils.js";

export { buildBaseCaller, emitBudgetEvents, ensureBudgetState, estimateCostUSDDelta, normalizeTokenUsage, resolveModelPricing };

// Shared helper to resolve modelRouter vs aiApiService, with optional token-usage tracking.
export function getModelCaller(stageApi, { usage = "worker", state } = {}) {
  const emit = makeStageEmitter(stageApi, "deepsearch");
  const base = buildBaseCaller(stageApi, { usage });
  if (!base) return null;

  const withTokenUsage =
    !state || typeof state.addTokenUsage !== "function"
      ? base
      : async (messages, opts = {}) => {
          const result = await base(messages, opts);
          const normalized = normalizeTokenUsage(result?.usage);
          if (normalized) {
            const budget = typeof state?.getBudgetConfig === "function" ? state.getBudgetConfig() : normalizeBudgetConfig(state?.userConfig?.budget);
            const estimatedCostUSDDelta = estimateCostUSDDelta({
              model: typeof result?.model === "string" ? result.model : typeof opts?.model === "string" ? opts.model : "",
              usage: normalized,
              prices: budget?.prices,
            });

            const total = state.addTokenUsage({ ...normalized, estimatedCostUSD: estimatedCostUSDDelta });
            const totalCostUSD = safeNumber(total?.estimatedCostUSD) ?? 0;

            emit?.("deepsearch.token.usage", {
              usage: { ...normalized, estimatedCostUSD: estimatedCostUSDDelta },
              total: {
                input: typeof total?.input === "number" && Number.isFinite(total.input) ? total.input : 0,
                output: typeof total?.output === "number" && Number.isFinite(total.output) ? total.output : 0,
                total: typeof total?.total === "number" && Number.isFinite(total.total) ? total.total : 0,
                estimatedCostUSD: totalCostUSD,
              },
              ...(typeof result?.model === "string" ? { model: result.model } : {}),
              ...(typeof result?.provider === "string" ? { provider: result.provider } : {}),
            });
            const totalTokens = safeInt(total?.total) ?? 0;
            emitBudgetEvents({ emit, state, budget, totalTokens, totalCostUSD });
          }
          return result;
        };

  const cache = stageApi?.trajectoryCache;
  const cachePolicy = typeof stageApi?.trajectoryCachePolicy === "string" ? stageApi.trajectoryCachePolicy : "off";
  const cacheStageName = typeof stageApi?.trajectoryCacheStageName === "string" ? stageApi.trajectoryCacheStageName : "";

  if (!cache || cachePolicy !== "share" || !cacheStageName || typeof cache.getOrCompute !== "function" || typeof cache.computeKey !== "function") {
    return async (messages, opts = {}) => {
      const { cacheKeyInputs: _cacheKeyInputs, ...forwardOpts } = opts && typeof opts === "object" ? opts : {};
      return withTokenUsage(messages, forwardOpts);
    };
  }

  return async (messages, opts = {}) => {
    const { cacheKeyInputs, ...forwardOpts } = opts && typeof opts === "object" ? opts : {};

    const stageKeyInputs = stageApi?.trajectoryCacheKeyInputs;
    const inputs =
      typeof cacheKeyInputs === "function"
        ? cacheKeyInputs(messages, forwardOpts)
        : cacheKeyInputs !== undefined
          ? cacheKeyInputs
          : typeof stageKeyInputs === "function"
            ? stageKeyInputs(messages, forwardOpts)
            : stageKeyInputs !== undefined
              ? stageKeyInputs
              : { messages: Array.isArray(messages) ? messages : [] };

    const key = cache.computeKey(cacheStageName, inputs, { model: forwardOpts?.model, temperature: forwardOpts?.temperature });
    return cache.getOrCompute(key, () => withTokenUsage(messages, forwardOpts));
  };
}
