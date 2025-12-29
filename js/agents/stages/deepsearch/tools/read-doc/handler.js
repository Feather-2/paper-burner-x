/**
 * read-doc skill handler
 *
 * 支持灵活的读取范围：
 * - 完整读取（默认）
 * - 按字符范围：start/end
 * - 按行范围：startLine/endLine
 * - 按块/章节：section
 */

import SourceManager from "../../source-manager.js";

export const definition = {
  name: "read-doc",
  description: `读取指定文档内容。支持多种读取模式：
- 预览模式：read-doc { sourceId, preview: true } 返回标题结构+前500字（推荐首次阅读）
- 完整读取：read-doc { sourceId }
- 字符范围：read-doc { sourceId, start: 0, end: 1000 }
- 行范围：read-doc { sourceId, startLine: 1, endLine: 100 }
- 章节读取：read-doc { sourceId, section: "## 摘要" }`,
  layer: 0,
  activation: {
    keywords: ["读取", "查看", "read", "view", "preview", "预览"],
    phases: ["exploring", "researching"],
  },
  parameters: {
    sourceId: "文档 ID（必需）",
    preview: "预览模式：true 或字数（如 500），返回标题结构+前N字",
    maxLength: "最大返回长度（默认 5000）",
    start: "起始字符位置（0-based）",
    end: "结束字符位置",
    startLine: "起始行号（1-based）",
    endLine: "结束行号",
    section: "章节标题（如 '## 摘要'），返回该章节内容",
  },
};

/**
 * @param {Object} args
 * @param {string} args.sourceId - 文档 ID
 * @param {number} [args.maxLength=5000] - 最大返回长度
 * @param {number} [args.start] - 起始字符位置
 * @param {number} [args.end] - 结束字符位置
 * @param {number} [args.startLine] - 起始行号（1-based）
 * @param {number} [args.endLine] - 结束行号
 * @param {string} [args.section] - 章节标题
 * @param {Object} context - { state, emit }
 */
export async function handler(args, context) {
  const { state, emit } = context;
  const { sourceId, maxLength = 5000, start, end, startLine, endLine, section } = args;

  if (!sourceId) {
    return { success: false, error: "sourceId is required" };
  }

  const manager = context?.sourceManager instanceof SourceManager ? context.sourceManager : new SourceManager(state?.L0?.sources || []);
  manager.syncSources(state?.L0?.sources);

  const result = manager.read(sourceId, { ...args, maxLength, start, end, startLine, endLine, section });
  if (!result?.success) return result;

  // 记录已读文档（供门槛检查使用）
  if (!state.L1) state.L1 = {};
  if (!Array.isArray(state.L1.readDocIds)) state.L1.readDocIds = [];
  if (!state.L1.readDocIds.includes(result.sourceId)) {
    state.L1.readDocIds.push(result.sourceId);
  }

  emit?.("deepsearch.doc.read", {
    sourceId: result.sourceId,
    length: Number.isFinite(result.contentLength) ? result.contentLength : String(result.content || "").length,
    truncated: Boolean(result.truncated),
    readMode: result.readMode,
  });

  return result;
}

export default { definition, handler };
