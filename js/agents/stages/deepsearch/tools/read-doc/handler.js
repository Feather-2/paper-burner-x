/**
 * read-doc skill handler
 *
 * 支持灵活的读取范围：
 * - 完整读取（默认）
 * - 按字符范围：start/end
 * - 按行范围：startLine/endLine
 * - 按块/章节：section
 */

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

  const sources = Array.isArray(state?.L0?.sources) ? state.L0.sources : [];
  const source = sources.find(s => s.sourceId === sourceId || s.name === sourceId);

  if (!source) {
    return {
      success: false,
      error: `Document not found: ${sourceId}`,
      available: sources.map(s => s.sourceId).slice(0, 10),
    };
  }

  const fullContent = source.sourceText || "";
  let content = fullContent;
  let readMode = "full";
  let rangeInfo = {};

  // preview 模式：返回标题结构 + 前 N 字预览（用于快速了解文档）
  if (args.preview) {
    readMode = "preview";
    const previewLength = typeof args.preview === "number" ? args.preview : 500;
    const tocMaxLength = 1000; // TOC 最多 1000 字符

    // 提取所有标题
    const headings = (fullContent.match(/^#{1,6}\s+.+$/gm) || []).map((h, i) => {
      const level = (h.match(/^#+/) || [""])[0].length;
      const text = h.replace(/^#+\s*/, "").trim();
      return { level, text, index: i };
    });

    // 构建目录树（限制 1000 字符）
    let toc = headings.map(h => "  ".repeat(h.level - 1) + "- " + h.text).join("\n");
    const tocTruncated = toc.length > tocMaxLength;
    if (tocTruncated) {
      toc = toc.slice(0, tocMaxLength) + "\n... (TOC 已截断)";
    }

    // 前 N 字预览
    const preview = fullContent.slice(0, previewLength);
    const previewTruncated = fullContent.length > previewLength;

    content = `## 文档结构 (${headings.length} 个章节)\n\n${toc || "(无标题结构)"}\n\n## 内容预览 (前 ${previewLength} 字)\n\n${preview}${previewTruncated ? "\n\n..." : ""}`;
    rangeInfo = {
      headingCount: headings.length,
      headings: headings.slice(0, 20), // 最多返回 20 个标题供 Agent 参考
      previewLength,
      tocTruncated,
    };
  }
  // 按章节读取
  else if (section) {
    readMode = "section";
    const lines = fullContent.split("\n");
    const targetSection = section.trim().toLowerCase();
    const targetSectionNoHash = targetSection.replace(/^#+\s*/, "");

    let startIndex = -1;
    let endIndex = -1;
    let foundHeader = "";

    // 1. 寻找匹配的标题行
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line.startsWith("#")) continue;

      const lineLower = line.toLowerCase();
      // 精确匹配 (忽略大小写) 或 模糊匹配 (包含关键词)
      if (lineLower === targetSection || lineLower.includes(targetSectionNoHash)) {
        startIndex = i;
        foundHeader = lines[i];
        break;
      }
    }

    if (startIndex !== -1) {
      // 2. 寻找下一个标题行作为结束位置
      for (let j = startIndex + 1; j < lines.length; j++) {
        if (lines[j].trim().startsWith("#")) {
          endIndex = j;
          break;
        }
      }

      const sectionLines = endIndex === -1
        ? lines.slice(startIndex)
        : lines.slice(startIndex, endIndex);

      content = sectionLines.join("\n").trim();
      // 行号使用 1-based，符合引用规范
      const lineStart = startIndex + 1;
      const lineEnd = endIndex === -1 ? lines.length : endIndex;
      rangeInfo = {
        section,
        found: true,
        foundHeader,
        isFuzzy: !foundHeader.toLowerCase().includes(targetSection),
        lineStart,
        lineEnd,
      };
    } else {
      return {
        success: false,
        error: `Section not found: ${section}`,
        hint: "可用章节：" + (fullContent.match(/^#{1,6}\s+.+$/gm) || []).slice(0, 10).join(", "),
      };
    }
  }
  // 按行范围读取
  else if (startLine !== undefined || endLine !== undefined) {
    readMode = "lines";
    const lines = fullContent.split("\n");
    const start = Math.max(1, startLine || 1) - 1; // 转为 0-based
    const end = Math.min(lines.length, endLine || lines.length);
    content = lines.slice(start, end).join("\n");
    rangeInfo = { startLine: start + 1, endLine: end, totalLines: lines.length, lineStart: start + 1, lineEnd: end };
  }
  // 按字符范围读取
  else if (start !== undefined || end !== undefined) {
    readMode = "chars";
    const s = Math.max(0, start || 0);
    const e = Math.min(fullContent.length, end || fullContent.length);
    content = fullContent.slice(s, e);
    // 计算字符范围对应的行号
    const beforeStart = fullContent.slice(0, s);
    const lineStart = (beforeStart.match(/\n/g) || []).length + 1;
    const selectedText = fullContent.slice(s, e);
    const lineEnd = lineStart + (selectedText.match(/\n/g) || []).length;
    rangeInfo = { start: s, end: e, totalLength: fullContent.length, lineStart, lineEnd };
  }
  // 完整读取
  else {
    readMode = "full";
    const lines = fullContent.split("\n");
    rangeInfo = { lineStart: 1, lineEnd: lines.length, totalLines: lines.length };
  }

  // 应用 maxLength 限制
  const truncated = content.length > maxLength;
  const text = truncated ? content.slice(0, maxLength) + "\n\n... (truncated)" : content;

  // 记录已读文档（供门槛检查使用）
  if (!state.L1) state.L1 = {};
  if (!Array.isArray(state.L1.readDocIds)) state.L1.readDocIds = [];
  if (!state.L1.readDocIds.includes(source.sourceId)) {
    state.L1.readDocIds.push(source.sourceId);
  }

  emit?.("deepsearch.doc.read", { sourceId, length: content.length, truncated, readMode });

  return {
    success: true,
    sourceId: source.sourceId,
    name: source.name || source.sourceId,
    content: text,
    totalLength: fullContent.length,
    readMode,
    ...rangeInfo,
    truncated,
  };
}

export default { definition, handler };
