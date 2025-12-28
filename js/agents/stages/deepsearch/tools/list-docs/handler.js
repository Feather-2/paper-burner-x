/**
 * list-docs skill handler
 */

export const definition = {
  name: "list-docs",
  description: "列出所有可用文档的名称和 ID",
  layer: 0,
  activation: {
    keywords: ["列出", "文档列表", "list", "docs"],
    phases: ["exploring"],
  },
};

/**
 * @param {Object} args - 无参数
 * @param {Object} context - { state, emit }
 */
export async function handler(args, context) {
  const { state, emit } = context;

  const sources = Array.isArray(state?.L0?.sources) ? state.L0.sources : [];

  const docs = sources.map(s => ({
    sourceId: s.sourceId,
    name: s.name || s.sourceId,
    size: (s.sourceText || "").length,
  }));

  emit?.("deepsearch.docs.listed", { count: docs.length });

  return {
    success: true,
    count: docs.length,
    docs,
  };
}

export default { definition, handler };
