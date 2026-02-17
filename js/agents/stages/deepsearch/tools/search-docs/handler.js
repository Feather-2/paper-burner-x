/**
 * search-docs skill handler
 */

import SourceManager from "../../source-manager.js";
import { EmbeddingService } from "../../../../shared/index.js";
import { getGlobalCircuitBreakerRegistry } from "../../../../shared/index.js";
import { mmrSelect } from "../../../../retrieval/mmr.js";

import { isPlainObject } from "../../../../shared/index.js";

const MAX_QUERY_LENGTH = 2048;
const MAX_SOURCE_COUNT = 100;
const DEFAULT_RETRIEVER_TIMEOUT_MS = 15_000;
const MAX_RETRIEVER_TIMEOUT_MS = 60_000;

import { withTimeout } from '../../../../shared/utils/with-timeout.js';

/**
 * @typedef {object} ApplyMmrOptions
 * @property {number=} topK
 * @property {number=} lambda
 * @property {number=} maxTokens
 */

/**
 * @typedef {object} SearchHit
 * @property {string} [sourceId] - 来源文档 ID
 * @property {string} [docId] - 文档 ID（备用）
 * @property {string} [id] - 通用 ID（备用）
 * @property {string} [chunkId] - 分块 ID
 * @property {string} [chunk_id] - 分块 ID（snake_case 备用）
 * @property {string} [hitId] - 命中 ID（备用）
 * @property {string} [hit_id] - 命中 ID（snake_case 备用）
 * @property {string} [text] - 文本内容
 * @property {string} [snippet] - 摘要片段
 * @property {string} [content] - 内容（备用）
 * @property {number} [score] - 相关性分数
 * @property {number} [line] - 起始行号
 * @property {number} [startLine] - 起始行号（备用）
 */

/**
 * @typedef {object} SearchDocsResult
 * @property {boolean} success - 是否成功
 * @property {SearchHit[]} [results] - 搜索结果列表
 * @property {string} [error] - 错误信息
 * @property {string} [message] - 提示信息
 * @property {string} [fallback] - 降级模式标识
 * @property {object} [mmr] - MMR 重排元数据
 * @property {boolean} [mmr.applied] - 是否应用 MMR
 * @property {number} [mmr.pool] - 池大小
 * @property {number} [mmr.lambda] - lambda 参数
 */

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

/**
 * 对搜索结果应用 MMR 重排序。
 * @param {SearchHit[]} results - 原始搜索结果
 * @param {ApplyMmrOptions} [options] - MMR 参数
 * @returns {SearchHit[]} 重排后的结果
 */
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

  const resolvedLambda = typeof lambda === "number" && Number.isFinite(lambda) ? lambda : 0.7;
  const resolvedMaxTokens = typeof maxTokens === "number" && Number.isFinite(maxTokens) ? maxTokens : 200;
  const selected = mmrSelect(candidates, { topK: k, lambda: resolvedLambda, maxTokens: resolvedMaxTokens });
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
    } catch (e) {
      // 缓存的 embedding service 状态检查失败，将创建新实例
      ctx?.logger?.warn?.("[search-docs] cached embedding service status check failed", { error: e?.message });
    }
  }

  const svc = new EmbeddingService(cfg, { ...(typeof ctx?.fetchImpl === "function" ? { fetchImpl: ctx.fetchImpl } : {}) });
  try {
    ctx._pbEmbeddingService = svc;
  } catch (e) {
    // context 对象不可扩展，无法缓存服务实例
    ctx?.logger?.debug?.("[search-docs] cannot cache embedding service on context", { error: e?.message });
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
 * 在已加载的文档中搜索内容。
 * @param {Object} args
 * @param {string} args.query - 搜索查询
 * @param {string[]} [args.sources] - 限定的文档 ID 列表
 * @param {number} [args.limit=10] - 返回数量限制（1-100）
 * @param {string} [args.gapId] - 关联的缺口 ID
 * @param {number} [args.semanticTimeoutMs] - 语义检索超时（ms，上限 60000）
 * @param {number} [args.retrieverTimeoutMs] - 外部检索超时（ms，上限 60000）
 * @param {boolean|object} [args.mmr] - MMR 配置
 * @param {Object} context - { state, emit, retriever, discoveryManager, logger }
 * @returns {Promise<SearchDocsResult>} 搜索结果，包含 success/results/error/mmr 等字段
 */
export async function handler(args, context) {
  const { state, emit, retriever, discoveryManager } = context;
  const { sources, gapId } = args;

  // 校验 limit：必须是有限数值，范围 1-100，无效时回退默认值 10
  const rawLimit = args.limit;
  const limit = Number.isFinite(rawLimit) && rawLimit >= 1 && rawLimit <= 100
    ? Math.floor(rawLimit)
    : 10;

  // 校验 semanticTimeoutMs：必须是有限正数，上限 60000ms，无效时不设超时
  const rawTimeout = args.semanticTimeoutMs;
  const semanticTimeoutMs = Number.isFinite(rawTimeout) && rawTimeout > 0
    ? Math.min(60000, Math.floor(rawTimeout))
    : undefined;

  const rawQuery = typeof args?.query === "string" ? args.query.trim() : "";
  if (!rawQuery) {
    return { success: false, error: "query is required" };
  }
  const query = rawQuery.length > MAX_QUERY_LENGTH ? rawQuery.slice(0, MAX_QUERY_LENGTH) : rawQuery;

  const rawRetrieverTimeout = args.retrieverTimeoutMs;
  const retrieverTimeoutMs = Number.isFinite(rawRetrieverTimeout) && rawRetrieverTimeout > 0
    ? Math.min(MAX_RETRIEVER_TIMEOUT_MS, Math.floor(rawRetrieverTimeout))
    : (semanticTimeoutMs ?? DEFAULT_RETRIEVER_TIMEOUT_MS);

  const mmr = resolveMmrSettings(args, limit);
  const effectiveLimit = mmr.enabled ? mmr.poolLimit : limit;

  const manager = context?.sourceManager instanceof SourceManager ? context.sourceManager : new SourceManager(state?.L0?.sources || []);
  manager.syncSources(state?.L0?.sources);

  const requested = Array.isArray(sources) ? sources : [];
  const normalizedSources = requested
    .filter((id) => typeof id === "string")
    .map((id) => id.trim())
    .filter(Boolean);
  const limitedSources = normalizedSources.length > MAX_SOURCE_COUNT
    ? normalizedSources.slice(0, MAX_SOURCE_COUNT)
    : normalizedSources;
  const targetSources = limitedSources.length
    ? limitedSources.map((id) => manager.getSource(id)).filter(Boolean)
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
    try {
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
      emit?.("deepsearch:search_completed", {
        query,
        gapId,
        resultCount: results.length,
        fallback: "local",
        ...(mmr.enabled ? { mmr: { applied: true, pool: rawResults.length, lambda: mmr.lambda } } : {}),
      });
      return { success: true, results, fallback: "local", ...(mmr.enabled ? { mmr: { applied: true, pool: rawResults.length, lambda: mmr.lambda } } : {}) };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      emit?.("deepsearch:search_failed", { query, gapId, error, fallback: "local" });
      return { success: false, error: "Local search failed", fallback: "local" };
    }
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

      const raw = await breaker.execute(async () => {
        const searchPromise = Promise.resolve().then(() => retriever.search(query, {
          sources: targetSources,
          limit: effectiveLimit,
          ...(retrieverTimeoutMs ? { timeoutMs: retrieverTimeoutMs } : {}),
        }));
        return withTimeout(searchPromise, retrieverTimeoutMs, "retriever.search");
      });
      const results = Array.isArray(raw)
        ? raw
        : raw && typeof raw === "object" && Array.isArray(raw.results)
          ? raw.results
          : null;
      if (!results) throw new Error("retriever.search returned invalid result");

      const finalResults = mmr.enabled ? applyMmrToResults(results, { topK: limit, lambda: mmr.lambda, maxTokens: mmr.maxTokens }) : results;

      // 如果指定了 gapId，自动将结果作为证据存入黑板
      addGapEvidence(finalResults);

      emit?.("deepsearch:search_completed", {
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
