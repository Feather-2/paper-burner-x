import { makeStageEmitter, normalizeBudgetConfig } from "./state.js";

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function toNonEmptyString(v) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

function collapseWhitespace(s) {
  return String(s || "")
    .replaceAll(/\s+/g, " ")
    .trim();
}

function truncate(s, maxLen = 220) {
  const t = collapseWhitespace(s);
  if (t.length <= maxLen) return t;
  return t.slice(0, maxLen);
}

function safeParseJson(s) {
  try {
    return JSON.parse(String(s || ""));
  } catch {
    return null;
  }
}

function normalizeTrajectoryCacheInputs(stageName, messages) {
  const stage = String(stageName || "");
  const userMsg = Array.isArray(messages) ? messages.find((m) => m && m.role === "user" && typeof m.content === "string") : null;
  const parsed = userMsg ? safeParseJson(userMsg.content) : null;

  if (stage === "gaps") {
    if (!parsed) return { rawPrompt: truncate(userMsg?.content || "", 900) };
    const taskGoal = truncate(parsed?.taskGoal || "");
    const scanSummarySummaryText = truncate(parsed?.scanSummary?.summaryText || "");
    const existingGaps = (Array.isArray(parsed?.existingGaps) ? parsed.existingGaps : [])
      .map((g) => ({
        type: truncate(g?.type || "unknown", 60),
        question: truncate(g?.question || "", 240),
        status: truncate(g?.status || "open", 24),
        missCount: typeof g?.missCount === "number" && Number.isFinite(g.missCount) ? Math.max(0, Math.floor(g.missCount)) : 0,
      }))
      .sort((a, b) => `${a.type}::${a.question}`.localeCompare(`${b.type}::${b.question}`));

    return { taskGoal, scanSummarySummaryText, existingGaps };
  }

  if (stage === "understand") {
    if (!parsed) return { rawPrompt: truncate(userMsg?.content || "", 900) };
    const taskGoal = truncate(parsed?.taskGoal || "");
    const rows = Array.isArray(parsed?.draftClaims) ? parsed.draftClaims : [];
    const draftClaims = rows.map((c) => ({
      text: truncate(c?.text || "", 320),
      importance: truncate(c?.importance || "", 24),
    }));

    const evidenceQuotes = [];
    for (const c of rows) {
      const ev = Array.isArray(c?.evidence) ? c.evidence : [];
      for (const e of ev) {
        const q = toNonEmptyString(e?.quote);
        if (!q) continue;
        evidenceQuotes.push(truncate(q, 220));
      }
    }
    evidenceQuotes.sort();

    return { taskGoal, draftClaims, evidenceQuotes };
  }

  if (parsed && isPlainObject(parsed)) return parsed;
  return { messages: Array.isArray(messages) ? messages : [] };
}

function safeInt(n) {
  return typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : null;
}

function safeNumber(n) {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function normalizeTokenUsage(usage) {
  if (!isPlainObject(usage)) return null;

  const promptTokens = safeInt(
    usage.prompt_tokens ?? usage.promptTokens ?? usage.input_tokens ?? usage.inputTokens ?? usage.input ?? usage.prompt ?? usage.promptTokensUsed
  );
  const completionTokens = safeInt(
    usage.completion_tokens ??
      usage.completionTokens ??
      usage.output_tokens ??
      usage.outputTokens ??
      usage.output ??
      usage.completion ??
      usage.completionTokensUsed
  );
  const totalTokens = safeInt(usage.total_tokens ?? usage.totalTokens ?? usage.total);

  const hasAny = promptTokens !== null || completionTokens !== null || totalTokens !== null;
  if (!hasAny) return null;

  const input = Math.max(0, promptTokens ?? 0);
  const output = Math.max(0, completionTokens ?? 0);
  const total = Math.max(0, totalTokens ?? input + output);
  return { input, output, total };
}

function resolveModelPricing(modelId, prices) {
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

function estimateCostUSDDelta({ model, usage, prices } = {}) {
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

function ensureBudgetState(state) {
  if (!state || typeof state !== "object") return null;
  if (!isPlainObject(state.L2)) state.L2 = {};
  if (!isPlainObject(state.L2.budgetState)) {
    state.L2.budgetState = {
      warnedTokens: false,
      warnedCost: false,
      exceededTokens: false,
      exceededCost: false,
    };
  }
  return state.L2.budgetState;
}

// Shared helper to resolve modelRouter vs aiApiService, with optional token-usage tracking.
export function getModelCaller(stageApi, { usage = "worker", state } = {}) {
  const emit = makeStageEmitter(stageApi, "deepsearch");

  const base =
    stageApi?.modelRouter?.call && typeof stageApi.modelRouter.call === "function"
      ? (() => {
          const legacySignature = stageApi.modelRouter.call.length >= 2;
          return legacySignature
            ? (messages, opts = {}) => stageApi.modelRouter.call(messages, { usage, ...opts })
            : (messages, opts = {}) => stageApi.modelRouter.call({ usage, messages, ...opts });
        })()
      : stageApi?.aiApiService?.chat && typeof stageApi.aiApiService.chat === "function"
        ? (messages, opts = {}) => stageApi.aiApiService.chat({ messages, usage, ...opts })
        : null;

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

            const budgetState = ensureBudgetState(state);
            const maxTokens = safeInt(budget?.maxTokens);
            const maxCostUSD = safeNumber(budget?.maxCostUSD);
            const warnAt = safeNumber(budget?.warnAt) ?? 0.8;

            const totalTokens = safeInt(total?.total) ?? 0;
            const ratioTokens = maxTokens !== null && maxTokens > 0 ? totalTokens / maxTokens : null;
            const ratioCost = maxCostUSD !== null && maxCostUSD > 0 ? totalCostUSD / maxCostUSD : null;

            const warningReasons = [];
            if (budgetState && ratioTokens !== null && ratioTokens >= warnAt && !budgetState.warnedTokens) {
              budgetState.warnedTokens = true;
              warningReasons.push("tokens");
            }
            if (budgetState && ratioCost !== null && ratioCost >= warnAt && !budgetState.warnedCost) {
              budgetState.warnedCost = true;
              warningReasons.push("cost");
            }
            if (warningReasons.length) {
              emit?.("deepsearch.budget.warning", {
                reasons: warningReasons,
                budget: { maxTokens: maxTokens ?? null, maxCostUSD: maxCostUSD ?? null, warnAt, action: budget?.action ?? "warn" },
                total: { tokens: totalTokens, estimatedCostUSD: totalCostUSD },
                ratios: { tokens: ratioTokens, cost: ratioCost },
              });
            }

            const exceededReasons = [];
            if (budgetState && maxTokens !== null && totalTokens > maxTokens && !budgetState.exceededTokens) {
              budgetState.exceededTokens = true;
              exceededReasons.push("tokens");
            }
            if (budgetState && maxCostUSD !== null && totalCostUSD > maxCostUSD && !budgetState.exceededCost) {
              budgetState.exceededCost = true;
              exceededReasons.push("cost");
            }
            if (exceededReasons.length) {
              emit?.("deepsearch.budget.exceeded", {
                reasons: exceededReasons,
                budget: { maxTokens: maxTokens ?? null, maxCostUSD: maxCostUSD ?? null, warnAt, action: budget?.action ?? "warn" },
                total: { tokens: totalTokens, estimatedCostUSD: totalCostUSD },
                ratios: { tokens: ratioTokens, cost: ratioCost },
              });
            }
          }
          return result;
        };

  const cache = stageApi?.trajectoryCache;
  const cachePolicy = typeof stageApi?.trajectoryCachePolicy === "string" ? stageApi.trajectoryCachePolicy : "off";
  const cacheStageName = typeof stageApi?.trajectoryCacheStageName === "string" ? stageApi.trajectoryCacheStageName : "";

  if (!cache || cachePolicy !== "share" || !cacheStageName || typeof cache.getOrCompute !== "function" || typeof cache.computeKey !== "function") {
    return withTokenUsage;
  }

  return async (messages, opts = {}) => {
    const inputs = normalizeTrajectoryCacheInputs(cacheStageName, messages);
    const key = cache.computeKey(cacheStageName, inputs, { model: opts?.model, temperature: opts?.temperature });
    return cache.getOrCompute(key, () => withTokenUsage(messages, opts));
  };
}
