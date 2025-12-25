/**
 * ReactReviewer 工具适配层 - 连接 ReAct 驱动器与 DeepSearch 底层能力
 *
 * 所有工具返回统一格式：{success: boolean, data?: any, error?: string}
 */

import { buildIndex, search as bm25Search } from "../../retrieval/bm25.js";
import { applyPatchPlan } from "./report-diff.js";
import { finalizeCitationsInMarkdown } from "./citations.js";
import { isPlainObject, toNonEmptyString, safeInt, safeNumber } from "../../shared/value-utils.js";

/**
 * 统计字数（中英文混合）
 * 复用 report-diff.js 的逻辑
 */
function countWordsApprox(text) {
  if (typeof text !== "string" || !text.length) return 0;
  const latin = text.match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/g) || [];
  const cjk = text.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/g) || [];
  return latin.length + cjk.length;
}

/**
 * 从 Markdown 解析章节（复用 report-diff.js 逻辑）
 */
function parseSectionsFromMarkdown(markdown) {
  const src = typeof markdown === "string" ? markdown : "";
  const lines = src.split(/\r?\n/);
  const sections = [];
  let current = null;

  const flush = () => {
    if (!current) return;
    const content = current.lines.join("\n").trim();
    sections.push({ title: current.title, content });
    current = null;
  };

  for (const line of lines) {
    const m = line.match(/^\s*##\s+(.+?)\s*$/);
    if (m) {
      const heading = toNonEmptyString(m[1]);
      const isReferences = heading && heading.toLowerCase() === "references";
      flush();
      if (isReferences) break;
      current = { title: heading || "Section", lines: [] };
      continue;
    }
    if (current) current.lines.push(line);
  }
  flush();
  return sections;
}

/**
 * 1. searchEvidence - 使用 BM25 检索 evidenceLedger
 */
async function searchEvidence(context, params) {
  try {
    const query = toNonEmptyString(params?.query);
    if (!query) {
      return { success: false, error: "searchEvidence: query is required" };
    }

    const evidenceLedger = Array.isArray(context?.evidenceLedger) ? context.evidenceLedger : [];
    if (!evidenceLedger.length) {
      return { success: true, data: [] };
    }

    // 懒构建索引并缓存
    if (!context._evidenceIndex) {
      const chunks = evidenceLedger.map((e, idx) => ({
        chunkId: toNonEmptyString(e?.evidenceId) || `evidence_${idx}`,
        text: String(e?.quote || ""),
      }));
      context._evidenceIndex = buildIndex(chunks);
    }

    const options = isPlainObject(params?.options) ? params.options : {};
    const topK = safeInt(options?.topK) ?? 8;
    const results = bm25Search(context._evidenceIndex, query, topK);

    const data = results.map((r) => ({
      evidenceId: r.chunkId,
      score: r.score,
      quote: evidenceLedger.find((e) => toNonEmptyString(e?.evidenceId) === r.chunkId)?.quote || "",
    }));

    return { success: true, data };
  } catch (err) {
    return { success: false, error: `searchEvidence failed: ${err.message}` };
  }
}

/**
 * 2. getEvidence - 获取单条证据详情
 */
async function getEvidence(context, params) {
  try {
    const evidenceId = toNonEmptyString(params?.evidenceId);
    if (!evidenceId) {
      return { success: false, error: "getEvidence: evidenceId is required" };
    }

    const evidenceLedger = Array.isArray(context?.evidenceLedger) ? context.evidenceLedger : [];
    const evidence = evidenceLedger.find((e) => toNonEmptyString(e?.evidenceId) === evidenceId);

    if (!evidence) {
      return { success: false, error: `Evidence not found: ${evidenceId}` };
    }

    const data = {
      evidenceId: String(evidenceId),
      quote: toNonEmptyString(evidence?.quote) || "",
      sourceId: toNonEmptyString(evidence?.sourceId),
      locator: evidence?.locator,
      verifiedAt: toNonEmptyString(evidence?.verifiedAt),
      chunkId: toNonEmptyString(evidence?.chunkId),
    };

    return { success: true, data };
  } catch (err) {
    return { success: false, error: `getEvidence failed: ${err.message}` };
  }
}

/**
 * 3. getSourceChunk - 获取源文档指定范围文本（带边界检查）
 */
async function getSourceChunk(context, params) {
  try {
    const sourceId = toNonEmptyString(params?.sourceId);
    if (!sourceId) {
      return { success: false, error: "getSourceChunk: sourceId is required" };
    }

    const charStart = safeInt(params?.charStart);
    const charEnd = safeInt(params?.charEnd);
    if (charStart === null || charEnd === null) {
      return { success: false, error: "getSourceChunk: charStart and charEnd must be valid integers" };
    }

    const sources = Array.isArray(context?.sources) ? context.sources : [];
    const source = sources.find((s) => toNonEmptyString(s?.sourceId) === sourceId);

    if (!source) {
      return { success: false, error: `Source not found: ${sourceId}` };
    }

    const fullText = String(source?.content || source?.text || "");
    const docLength = fullText.length;

    // 边界检查：截断到文档实际长度
    const actualStart = Math.max(0, Math.min(charStart, docLength));
    const actualEnd = Math.max(actualStart, Math.min(charEnd, docLength));

    const text = fullText.slice(actualStart, actualEnd);

    return {
      success: true,
      data: {
        text,
        actualStart,
        actualEnd,
        docLength,
      },
    };
  } catch (err) {
    return { success: false, error: `getSourceChunk failed: ${err.message}` };
  }
}

/**
 * 4. getSectionFull - 获取报告完整章节内容
 */
async function getSectionFull(context, params) {
  try {
    const sectionPath = toNonEmptyString(params?.sectionPath);
    if (!sectionPath) {
      return { success: false, error: "getSectionFull: sectionPath is required" };
    }

    const report = context?.report;
    const markdown = typeof report?.draftMarkdown === "string" ? report.draftMarkdown : typeof report?.markdown === "string" ? report.markdown : "";

    if (!markdown) {
      return { success: false, error: "getSectionFull: report markdown is empty" };
    }

    const sections = parseSectionsFromMarkdown(markdown);

    // sectionPath 格式：'## 章节标题'
    const targetTitle = sectionPath.replace(/^##\s*/, "").trim();
    const section = sections.find((s) => String(s?.title || "").trim().toLowerCase() === targetTitle.toLowerCase());

    if (!section) {
      return { success: false, error: `Section not found: ${sectionPath}` };
    }

    const data = {
      title: section.title,
      content: section.content,
      wordCount: countWordsApprox(section.content),
    };

    return { success: true, data };
  } catch (err) {
    return { success: false, error: `getSectionFull failed: ${err.message}` };
  }
}

/**
 * 5. getWordCount - 统计当前报告字数（中英文混合，按章节拆分）
 */
async function getWordCount(context, params) {
  try {
    const report = context?.report;
    const markdown = typeof report?.draftMarkdown === "string" ? report.draftMarkdown : typeof report?.markdown === "string" ? report.markdown : "";

    if (!markdown) {
      return { success: true, data: { total: 0, bySection: {} } };
    }

    const sections = parseSectionsFromMarkdown(markdown);
    const bySection = {};
    let total = 0;

    for (const s of sections) {
      const sectionPath = `## ${s.title}`;
      const count = countWordsApprox(s.content);
      bySection[sectionPath] = count;
      total += count;
    }

    return { success: true, data: { total, bySection } };
  } catch (err) {
    return { success: false, error: `getWordCount failed: ${err.message}` };
  }
}

/**
 * 6. applyPatch - 应用修改计划（调用 report-diff.js 和 citations.js）
 */
async function applyPatch(context, params) {
  try {
    const patchPlan = params?.patchPlan;
    if (!Array.isArray(patchPlan)) {
      return { success: false, error: "applyPatch: patchPlan must be an array" };
    }

    const report = context?.report;
    if (!isPlainObject(report)) {
      return { success: false, error: "applyPatch: report is required in context" };
    }

    const evidenceLedger = Array.isArray(context?.evidenceLedger) ? context.evidenceLedger : [];
    const sources = Array.isArray(context?.sources) ? context.sources : [];

    // 应用 patch（内部调用 finalizeCitationsInMarkdown）
    const updatedReport = applyPatchPlan(report, patchPlan, evidenceLedger, sources);

    const newWordCount = countWordsApprox(updatedReport.markdown || "");

    // 统计应用的操作数
    const appliedOps = patchPlan.filter((step) => isPlainObject(step) && toNonEmptyString(step?.op)).length;

    // 更新 context 中的 report
    context.report = updatedReport;

    return {
      success: true,
      data: {
        newMarkdown: updatedReport.markdown || updatedReport.draftMarkdown || "",
        newWordCount,
        appliedOps,
      },
    };
  } catch (err) {
    return { success: false, error: `Patch failed: ${err.message}` };
  }
}

/**
 * 7. externalSearch - 外部搜索（Level 3 工具，调用 MCP）
 */
async function externalSearch(context, params) {
  try {
    const query = toNonEmptyString(params?.query);
    if (!query) {
      return { success: false, error: "externalSearch: query is required" };
    }

    const stageApi = context?.stageApi;
    if (!stageApi || typeof stageApi?.externalSearchProvider?.search !== "function") {
      return { success: false, error: "externalSearch: provider not available" };
    }

    const options = isPlainObject(params?.options) ? params.options : {};
    const maxResults = safeInt(options?.maxResults) ?? 5;

    // 调用外部搜索提供者
    const results = await stageApi.externalSearchProvider.search(query, { maxResults });

    const data = Array.isArray(results) ? results : [];

    return { success: true, data };
  } catch (err) {
    return { success: false, error: `externalSearch failed: ${err.message}` };
  }
}

/**
 * 工具映射表
 */
const TOOL_HANDLERS = {
  searchEvidence,
  getEvidence,
  getSourceChunk,
  getSectionFull,
  getWordCount,
  applyPatch,
  externalSearch,
};

/**
 * 工具 Schema 定义（供 ReAct 驱动器使用）
 */
export const TOOL_SCHEMAS = {
  searchEvidence: {
    params: ["query", "options?"],
    description: "Search evidence ledger using BM25, returns {evidenceId, quote, score}[]",
  },
  getEvidence: {
    params: ["evidenceId"],
    description: "Get single evidence detail by evidenceId, returns {evidenceId, quote, sourceId, locator, verifiedAt}",
  },
  getSourceChunk: {
    params: ["sourceId", "charStart", "charEnd"],
    description: "Get source document text within character range (with boundary check)",
  },
  getSectionFull: {
    params: ["sectionPath"],
    description: "Get full section content from report, sectionPath format: '## Section Title'",
  },
  getWordCount: {
    params: [],
    description: "Count words in report (mixed Chinese/English), returns {total, bySection}",
  },
  applyPatch: {
    params: ["patchPlan"],
    description: "Apply patch plan to report, returns {newMarkdown, newWordCount, appliedOps}",
  },
  externalSearch: {
    params: ["query", "options?"],
    description: "Search external sources via MCP provider, returns array of search results",
  },
};

/**
 * 创建工具执行器
 * @param {object} context - 运行时上下文 {report, state, evidenceLedger, claims, sources}
 * @returns {function} async executor(toolName, params) => {success, data?, error?}
 */
export function createToolExecutor(context) {
  if (!isPlainObject(context)) {
    throw new TypeError("createToolExecutor(context): context must be an object");
  }

  return async function executeToolCall(toolName, params) {
    const name = toNonEmptyString(toolName);
    if (!name) {
      return { success: false, error: "Tool name is required" };
    }

    const handler = TOOL_HANDLERS[name];
    if (!handler) {
      return { success: false, error: `Unknown tool: ${name}` };
    }

    try {
      return await handler(context, params || {});
    } catch (err) {
      return { success: false, error: `Tool execution failed: ${err.message}` };
    }
  };
}
