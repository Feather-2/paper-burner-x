/**
 * search-docs skill handler
 */

import { isPlainObject } from "../../../../shared/value-utils.js";

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
 * @param {Object} context - { state, emit, retriever }
 */
export async function handler(args, context) {
  const { state, emit, retriever } = context;
  const { query, sources, limit = 10 } = args;

  if (!query || typeof query !== "string") {
    return { success: false, error: "query is required" };
  }

  // 获取可搜索的文档
  const allSources = Array.isArray(state?.L0?.sources) ? state.L0.sources : [];
  const targetSources = sources?.length
    ? allSources.filter(s => sources.includes(s.sourceId))
    : allSources;

  if (!targetSources.length) {
    return { success: true, results: [], message: "No sources available" };
  }

  // 使用 retriever 搜索（如果提供）
  if (retriever && typeof retriever.search === "function") {
    try {
      const results = await retriever.search(query, { sources: targetSources, limit });
      emit?.("deepsearch.search.completed", { query, resultCount: results.length });
      return { success: true, results };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // 简单的关键词匹配回退
  const results = [];
  const queryLower = query.toLowerCase();

  for (const source of targetSources) {
    const text = source.sourceTextNormalized || source.sourceText || "";
    const lines = text.split("\n");

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(queryLower)) {
        const start = Math.max(0, i - 1);
        const end = Math.min(lines.length, i + 2);
        results.push({
          sourceId: source.sourceId,
          sourceName: source.name || source.sourceId,
          line: i + 1,
          snippet: lines.slice(start, end).join("\n"),
          score: 1.0,
        });

        if (results.length >= limit) break;
      }
    }
    if (results.length >= limit) break;
  }

  emit?.("deepsearch.search.completed", { query, resultCount: results.length });
  return { success: true, results };
}

export default { definition, handler };
