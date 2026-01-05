/**
 * search-docs skill handler
 */

import SourceManager from "../../source-manager.js";
import { EmbeddingService } from "../../../../shared/embeddings/embedding-service.js";
import { getGlobalCircuitBreakerRegistry } from "../../../../shared/utils/circuit-breaker.js";

import { isPlainObject } from "../../../../shared/utils/value-utils.js";
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
    const results =
      embeddingService && typeof manager.semanticSearch === "function"
        ? await manager.semanticSearch(query, {
            sources: targetSources,
            limit,
            embeddingService,
            ...(semanticTimeoutMs ? { timeoutMs: semanticTimeoutMs } : {}),
          })
        : manager.search(query, { sources: targetSources, limit });

    addGapEvidence(results);
    emit?.("deepsearch.search.completed", { query, gapId, resultCount: results.length, fallback: "local" });
    return { success: true, results, fallback: "local" };
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

      const raw = await breaker.execute(async () => retriever.search(query, { sources: targetSources, limit }));
      const results = Array.isArray(raw)
        ? raw
        : raw && typeof raw === "object" && Array.isArray(raw.results)
          ? raw.results
          : null;
      if (!results) throw new Error("retriever.search returned invalid result");

      // 如果指定了 gapId，自动将结果作为证据存入黑板
      addGapEvidence(results);

      emit?.("deepsearch.search.completed", { query, gapId, resultCount: results.length });
      return { success: true, results };
    } catch (err) {
      // 熔断 / 外部检索失败时降级为本地检索（不让整个 stage 因为搜索抖动而失败）
      return await runLocalSearch();
    }
  }

  return await runLocalSearch();
}

export default { definition, handler };
