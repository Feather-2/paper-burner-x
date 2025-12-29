/**
 * search-docs skill handler
 */

import SourceManager from "../../source-manager.js";

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
  const { query, sources, limit = 10, gapId } = args;

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

  // 使用 retriever 搜索（如果提供）
  if (retriever && typeof retriever.search === "function") {
    try {
      const results = await retriever.search(query, { sources: targetSources, limit });

      // 如果指定了 gapId，自动将结果作为证据存入黑板
      if (gapId && discoveryManager) {
        for (const res of results) {
          discoveryManager.addEvidence(gapId, {
            query,
            sourceId: res.sourceId,
            snippet: res.snippet,
            confidence: res.score,
          });
        }
      }

      emit?.("deepsearch.search.completed", { query, gapId, resultCount: results.length });
      return { success: true, results };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // 简单的关键词匹配回退（分词匹配）
  const results = manager.search(query, { sources: targetSources, limit });

  emit?.("deepsearch.search.completed", { query, resultCount: results.length });
  return { success: true, results };
}

export default { definition, handler };
