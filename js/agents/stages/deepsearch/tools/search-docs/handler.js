/**
 * search-docs skill handler
 */

import SourceManager from "../../source-manager.js";
import { EmbeddingService } from "../../../../shared/embeddings/embedding-service.js";
import { getGlobalCircuitBreakerRegistry } from "../../../../shared/utils/circuit-breaker.js";
import { mmrSelect } from "../../../../retrieval/mmr.js";

import { isPlainObject } from "../../../../shared/utils/value-utils.js";

function resolveMmrSettings(args, limit) {
  const mmrCfg = args?.mmr;
  if (mmrCfg === false) return { enabled: false };

  const enabled = mmrCfg === undefined ? true : mmrCfg === true || isPlainObject(mmrCfg);
  if (!enabled) return { enabled: false };

  const cfg = isPlainObject(mmrCfg) ? mmrCfg : {};
  const lambda = typeof cfg.lambda === "number" && Number.isFinite(cfg.lambda) ? cfg.lambda : 0.7;
  const maxTokens = typeof cfg.maxTokens === "number" && Number.isFinite(cfg.maxTokens) ? cfg.maxTokens : 200;
  const poolFactor = typeof cfg.poolFactor === "number" && Number.isFinite(cfg.poolFactor) ? cfg.poolFactor : 3;
  const poolLimitRaw = typeof cfg.poolLimit === "number" && Number.isFinite(cfg.poolLimit) ? cfg.poolLimit : Math.ceil(limit * poolFactor);
  const poolLimit = Math.max(limit, Math.min(100, Math.max(1, Math.floor(poolLimitRaw))));

  return { enabled: true, lambda, maxTokens, poolLimit };
}

function applyMmrToResults(results, { topK, lambda, maxTokens } = {}) {
  const rows = Array.isArray(results) ? results : [];
  const k = Number.isFinite(topK) ? Math.max(1, Math.floor(topK)) : rows.length;
  if (rows.length <= 1 || k >= rows.length) return rows.slice(0, k);

  const candidates = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || typeof row !== "object") continue;
    const sourceId = String(row.sourceId || row.docId || row.id || "").trim() || "source";
    const line = Number.isFinite(Number(row.line ?? row.startLine)) ? Math.max(1, Math.floor(Number(row.line ?? row.startLine))) : null;
    const chunkId = String(row.chunkId || row.chunk_id || row.hitId || row.hit_id || `${sourceId}:${line ?? i}`);
    const text = String(row.text || row.snippet || row.content || "");
    const score = typeof row.score === "number" && Number.isFinite(row.score) ? row.score : 0;
    candidates.push({ chunkId, text, score, _row: row });
  }

  const selected = mmrSelect(candidates, { topK: k, lambda, maxTokens });
  const out = [];
  for (const s of selected) {
    if (s && s._row) out.push(s._row);
  }
  return out.length ? out : rows.slice(0, k);
}
function resolveEmbeddingService(context) {
  const ctx = context && typeof context === "object" ? context : null;
  const direct = ctx?.embeddingService;
  if (direct && typeof direct.embed === "function") return direct;

  const cfg = ctx?.embedding || ctx?.globalConfig?.embedding || null;
  if (!isPlainObject(cfg)) return null;

  const cached = ctx?._pbEmbeddingService;
  if (cached && typeof cached.embed === "function" && typeof cached.getStatus === "function") {
    try {
      const st = cached.getStatus();
      if (st?.endpoint && (st.endpoint === cfg.endpoint || st.endpoint === cfg.url)) return cached;
    } catch {
      // ignore
    }
  }

  const svc = new EmbeddingService(cfg, { ...(typeof ctx?.fetchImpl === "function" ? { fetchImpl: ctx.fetchImpl } : {}) });
  try {
    ctx._pbEmbeddingService = svc;
  } catch {
    // ignore non-extensible contexts
  }
  return svc;
}

function resolveCircuitBreakerRegistry(context) {
  const ctx = context && typeof context === "object" ? context : null;
  const direct = ctx?.circuitBreakerRegistry;
  if (direct && typeof direct.get === "function") return direct;
  const stageApiRegistry = ctx?.stageApi?.circuitBreakerRegistry;
  if (stageApiRegistry && typeof stageApiRegistry.get === "function") return stageApiRegistry;
  return getGlobalCircuitBreakerRegistry();
}

export const definition = {
  name: "search-docs",
  description: "在已加载的文档中搜索内容。支持关键词搜索和语义查询。",
  layer: 0,
  activation: {
    keywords: ["搜索", "查找", "search", "find", "grep"],
    phases: ["researching"],
  },
};

/**
 * @param {Object} args
 * @param {string} args.query - 搜索查询
 * @param {string[]} [args.sources] - 限定的文档 ID 列表
 * @param {number} [args.limit=10] - 返回数量限制
 * @param {string} [args.gapId] - 关联的缺口 ID
 * @param {Object} context - { state, emit, retriever, discoveryManager }
 */
export async function handler(args, context) {
  const { state, emit, retriever, discoveryManager } = context;
  const { query, sources, limit = 10, gapId, semanticTimeoutMs } = args;

  if (!query || typeof query !== "string") {
    return { success: false, error: "query is required" };
  }

  const mmr = resolveMmrSettings(args, limit);
  const effectiveLimit = mmr.enabled ? mmr.poolLimit : limit;

  const manager = context?.sourceManager instanceof SourceManager ? context.sourceManager : new SourceManager(state?.L0?.sources || []);
  manager.syncSources(state?.L0?.sources);

  const requested = Array.isArray(sources) ? sources : [];
  const targetSources = requested.length
    ? requested.map((id) => manager.getSource(id)).filter(Boolean)
    : Array.isArray(state?.L0?.sources)
      ? state.L0.sources
      : [];

  if (!targetSources.length) {
    return { success: true, results: [], message: "No sources available" };
  }

  const addGapEvidence = (results) => {
    if (!gapId || !discoveryManager) return;
    for (const res of Array.isArray(results) ? results : []) {
      discoveryManager.addEvidence(gapId, {
        query,
        sourceId: res.sourceId,
        snippet: res.snippet,
        confidence: res.score,
      });
    }
  };

  const runLocalSearch = async () => {
    // 简单的关键词匹配回退（分词匹配）
    const embeddingService = resolveEmbeddingService(context);
    const rawResults =
      embeddingService && typeof manager.semanticSearch === "function"
        ? await manager.semanticSearch(query, {
            sources: targetSources,
            limit: effectiveLimit,
            embeddingService,
            ...(semanticTimeoutMs ? { timeoutMs: semanticTimeoutMs } : {}),
          })
        : manager.search(query, { sources: targetSources, limit: effectiveLimit });

    const results = mmr.enabled ? applyMmrToResults(rawResults, { topK: limit, lambda: mmr.lambda, maxTokens: mmr.maxTokens }) : rawResults;

    addGapEvidence(results);
    emit?.("deepsearch.search.completed", {
      query,
      gapId,
      resultCount: results.length,
      fallback: "local",
      ...(mmr.enabled ? { mmr: { applied: true, pool: rawResults.length, lambda: mmr.lambda } } : {}),
    });
    return { success: true, results, fallback: "local", ...(mmr.enabled ? { mmr: { applied: true, pool: rawResults.length, lambda: mmr.lambda } } : {}) };
  };

  // 使用 retriever 搜索（如果提供）
  if (retriever && typeof retriever.search === "function") {
    const registry = resolveCircuitBreakerRegistry(context);
    const breaker = registry.get("deepsearch:search-docs:external", {
      failureThreshold: 3,
      successThreshold: 1,
      openDurationMs: 15_000,
      halfOpenMaxCalls: 1,
      isFailure: (err) => {
        if (err?.name === "AbortError") return false;
        if (err?.code === "TIMEOUT") return true;
        return true;
      },
    });

    try {
      if (!breaker.canExecute()) {
        return await runLocalSearch();
      }

      const raw = await breaker.execute(async () => retriever.search(query, { sources: targetSources, limit: effectiveLimit }));
      const results = Array.isArray(raw)
        ? raw
        : raw && typeof raw === "object" && Array.isArray(raw.results)
          ? raw.results
          : null;
      if (!results) throw new Error("retriever.search returned invalid result");

      const finalResults = mmr.enabled ? applyMmrToResults(results, { topK: limit, lambda: mmr.lambda, maxTokens: mmr.maxTokens }) : results;

      // 如果指定了 gapId，自动将结果作为证据存入黑板
      addGapEvidence(finalResults);

      emit?.("deepsearch.search.completed", {
        query,
        gapId,
        resultCount: finalResults.length,
        ...(mmr.enabled ? { mmr: { applied: true, pool: results.length, lambda: mmr.lambda } } : {}),
      });
      return { success: true, results: finalResults, ...(mmr.enabled ? { mmr: { applied: true, pool: results.length, lambda: mmr.lambda } } : {}) };
    } catch (err) {
      // 熔断 / 外部检索失败时降级为本地检索（不让整个 stage 因为搜索抖动而失败）
      return await runLocalSearch();
    }
  }

  return await runLocalSearch();
}

export default { definition, handler };
