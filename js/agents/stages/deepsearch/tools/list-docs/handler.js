/**
 * list-docs skill handler
 */

import SourceManager from "../../source-manager.js";

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
 * @returns {Promise<{success: boolean, count: number, docs: Array<{sourceId: string, name: string, size: number}>}>}
 */
export async function handler(args, context) {
  const { state, emit } = context;

  const manager = context?.sourceManager instanceof SourceManager ? context.sourceManager : new SourceManager(state?.L0?.sources || []);
  manager.syncSources(state?.L0?.sources);
  const docs = manager.listSources().map((d) => ({ sourceId: d.sourceId, name: d.name, size: d.size }));

  emit?.("deepsearch.docs.listed", { count: docs.length });

  return {
    success: true,
    count: docs.length,
    docs,
  };
}

export default { definition, handler };
