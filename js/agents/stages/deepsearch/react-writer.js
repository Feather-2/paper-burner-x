/**
 * ReAct Writer - 问题驱动的渐进式报告生成
 *
 * 核心理念：让 AI 按问题（gap）逐个检索证据并写作，而不是一次性 dump 所有数据
 *
 * 工具集：
 * - getGaps(): 获取待回答的问题列表
 * - getGapDetail(gapId): 获取问题详情及关联的论点
 * - getClaimsForGap(gapId): 获取问题关联的所有论点
 * - getEvidence(evidenceId): 获取证据详情（含原文引用）
 * - getSourceChunk(sourceId, start, end): 读取更多原文上下文
 * - searchEvidence(query): 语义搜索证据库
 * - writeSection(gapId, markdown): 写入一个章节
 * - finishReport(title, summary): 完成报告
 *
 * 流程：
 * 1. AI 调用 getGaps() 了解需要回答的问题
 * 2. 对每个问题，调用 getGapDetail/getClaimsForGap 获取关联论点
 * 3. 对每个论点，调用 getEvidence 获取支撑证据
 * 4. 如需更多上下文，调用 getSourceChunk 读取原文
 * 5. 调用 writeSection 写入该问题的章节
 * 6. 循环直到所有问题处理完毕
 * 7. 调用 finishReport 生成标题和摘要
 */

import { extractJsonCandidate, checkCancelled } from "./state.js";
import { getModelCaller } from "./model.js";
import { countWordsApprox } from "./report-diff.js";
import { finalizeCitationsInMarkdown } from "./citations.js";

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function toNonEmptyString(v) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

function safeInt(n) {
  return typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : null;
}

// ===== 工具实现 =====

/**
 * 创建 ReAct Writer 的工具执行器
 */
export function createWriterToolExecutor(context) {
  const { state, claims, evidenceLedger, sources, gaps } = context;

  // 索引构建
  const claimById = new Map();
  for (const c of Array.isArray(claims) ? claims : []) {
    const cid = toNonEmptyString(c?.claimId);
    if (cid) claimById.set(cid, c);
  }

  const evidenceById = new Map();
  for (const e of Array.isArray(evidenceLedger) ? evidenceLedger : []) {
    const eid = toNonEmptyString(e?.evidenceId);
    if (eid) evidenceById.set(eid, e);
  }

  const sourceById = new Map();
  const sourceTextById = new Map();
  for (const s of Array.isArray(sources) ? sources : []) {
    const sid = toNonEmptyString(s?.sourceId);
    if (sid) {
      sourceById.set(sid, s);
      if (typeof s.sourceTextNormalized === "string") {
        sourceTextById.set(sid, s.sourceTextNormalized);
      }
    }
  }

  const gapById = new Map();
  for (const g of Array.isArray(gaps) ? gaps : []) {
    const gid = toNonEmptyString(g?.gapId);
    if (gid) gapById.set(gid, g);
  }

  // 按 gapId 分组 claims
  const claimsByGapId = new Map();
  for (const c of Array.isArray(claims) ? claims : []) {
    const gapIds = Array.isArray(c?.gapIds) ? c.gapIds : [];
    for (const gid of gapIds) {
      const key = String(gid);
      if (!claimsByGapId.has(key)) claimsByGapId.set(key, []);
      claimsByGapId.get(key).push(c);
    }
  }

  // 收集写入的章节
  const writtenSections = [];
  let reportFinished = false;
  let reportTitle = "";
  let reportSummary = "";

  const tools = {
    /**
     * 获取所有待回答的问题（按优先级排序）
     */
    getGaps: async () => {
      const gapList = Array.isArray(gaps) ? gaps : [];
      const openGaps = gapList.filter(g => {
        const status = toNonEmptyString(g?.status) || "open";
        return status === "open" || status === "filled"; // filled 也需要写
      });

      return {
        totalGaps: openGaps.length,
        gaps: openGaps.map(g => ({
          gapId: g.gapId,
          question: g.question,
          type: g.type,
          priority: g.priority,
          status: g.status,
          claimCount: (claimsByGapId.get(String(g.gapId)) || []).length,
        })),
      };
    },

    /**
     * 获取问题详情及关联的论点概要
     */
    getGapDetail: async ({ gapId }) => {
      const gid = toNonEmptyString(gapId);
      if (!gid) return { error: "gapId is required" };

      const gap = gapById.get(gid);
      if (!gap) return { error: `Gap not found: ${gid}` };

      const relatedClaims = claimsByGapId.get(gid) || [];

      return {
        gapId: gap.gapId,
        question: gap.question,
        type: gap.type,
        priority: gap.priority,
        status: gap.status,
        claims: relatedClaims.map(c => ({
          claimId: c.claimId,
          text: c.text,
          importance: c.importance,
          evidenceCount: Array.isArray(c.evidenceIds) ? c.evidenceIds.length : 0,
          evidenceIds: c.evidenceIds,
        })),
      };
    },

    /**
     * 获取问题关联的所有论点（完整信息）
     */
    getClaimsForGap: async ({ gapId }) => {
      const gid = toNonEmptyString(gapId);
      if (!gid) return { error: "gapId is required" };

      const relatedClaims = claimsByGapId.get(gid) || [];
      if (!relatedClaims.length) {
        return { claims: [], message: `No claims found for gap: ${gid}` };
      }

      return {
        gapId: gid,
        claims: relatedClaims.map(c => ({
          claimId: c.claimId,
          text: c.text,
          importance: c.importance,
          evidenceIds: c.evidenceIds,
          // 预览每个 evidence 的引用
          evidencePreviews: (Array.isArray(c.evidenceIds) ? c.evidenceIds : []).slice(0, 5).map(eid => {
            const e = evidenceById.get(String(eid));
            if (!e) return { evidenceId: eid, error: "not found" };
            return {
              evidenceId: e.evidenceId,
              sourceId: e.sourceId,
              sourceTitle: sourceById.get(String(e.sourceId))?.title || "Unknown",
              quotePreview: typeof e.quote === "string" ? e.quote.slice(0, 150) + (e.quote.length > 150 ? "..." : "") : "",
            };
          }),
        })),
      };
    },

    /**
     * 获取证据详情（完整原文引用）
     */
    getEvidence: async ({ evidenceId }) => {
      const eid = toNonEmptyString(evidenceId);
      if (!eid) return { error: "evidenceId is required" };

      const e = evidenceById.get(eid);
      if (!e) return { error: `Evidence not found: ${eid}` };

      const source = sourceById.get(String(e.sourceId));

      return {
        evidenceId: e.evidenceId,
        sourceId: e.sourceId,
        sourceTitle: source?.title || "Unknown Source",
        sourceUri: source?.uri,
        quote: e.quote,
        locator: e.locator,
        gapIds: e.gapIds,
        // 提示：可以用 getSourceChunk 获取更多上下文
        hint: e.locator ? "Use getSourceChunk to read more context around this quote" : null,
      };
    },

    /**
     * 读取原文片段（扩展上下文）
     */
    getSourceChunk: async ({ sourceId, start, end }) => {
      const sid = toNonEmptyString(sourceId);
      if (!sid) return { error: "sourceId is required" };

      const sourceText = sourceTextById.get(sid);
      if (typeof sourceText !== "string") {
        return { error: `Source text not available for: ${sid}` };
      }

      const s = safeInt(start) ?? 0;
      const e = safeInt(end) ?? Math.min(s + 1000, sourceText.length);
      const clampedStart = Math.max(0, Math.min(s, sourceText.length));
      const clampedEnd = Math.max(clampedStart, Math.min(e, sourceText.length));

      const source = sourceById.get(sid);

      return {
        sourceId: sid,
        sourceTitle: source?.title || "Unknown",
        charStart: clampedStart,
        charEnd: clampedEnd,
        totalLength: sourceText.length,
        text: sourceText.slice(clampedStart, clampedEnd),
      };
    },

    /**
     * 语义搜索证据库
     */
    searchEvidence: async ({ query, limit = 10 }) => {
      const q = toNonEmptyString(query);
      if (!q) return { error: "query is required" };

      const queryLower = q.toLowerCase();
      const results = [];

      for (const e of Array.isArray(evidenceLedger) ? evidenceLedger : []) {
        const quote = typeof e?.quote === "string" ? e.quote : "";
        const score = quote.toLowerCase().includes(queryLower) ? 1 : 0;
        if (score > 0 || results.length < 3) { // 保证至少返回一些结果
          const source = sourceById.get(String(e.sourceId));
          results.push({
            evidenceId: e.evidenceId,
            sourceId: e.sourceId,
            sourceTitle: source?.title || "Unknown",
            quotePreview: quote.slice(0, 200) + (quote.length > 200 ? "..." : ""),
            relevanceScore: score,
            gapIds: e.gapIds,
          });
        }
      }

      // 按相关性排序
      results.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));

      return {
        query: q,
        totalResults: results.length,
        results: results.slice(0, safeInt(limit) || 10),
      };
    },

    /**
     * 写入一个章节（问题驱动）
     */
    writeSection: async ({ gapId, title, markdown }) => {
      const gid = toNonEmptyString(gapId);
      const md = toNonEmptyString(markdown);

      if (!md) return { error: "markdown content is required" };

      const gap = gid ? gapById.get(gid) : null;
      const sectionTitle = toNonEmptyString(title) || (gap ? gap.question : `Section ${writtenSections.length + 1}`);

      writtenSections.push({
        sectionId: `sec_${writtenSections.length + 1}`,
        gapId: gid || null,
        title: sectionTitle,
        markdown: md,
        wordCount: countWordsApprox(md),
      });

      return {
        success: true,
        sectionId: `sec_${writtenSections.length}`,
        gapId: gid || null,
        title: sectionTitle,
        wordCount: countWordsApprox(md),
        totalSectionsWritten: writtenSections.length,
      };
    },

    /**
     * 完成报告
     */
    finishReport: async ({ title, summary }) => {
      reportTitle = toNonEmptyString(title) || "Research Report";
      reportSummary = toNonEmptyString(summary) || "";
      reportFinished = true;

      const totalWords = writtenSections.reduce((sum, s) => sum + (s.wordCount || 0), 0);

      return {
        success: true,
        title: reportTitle,
        sectionsCount: writtenSections.length,
        totalWords,
        message: "Report completed successfully",
      };
    },
  };

  // 返回执行器和结果获取函数
  return {
    execute: async (toolName, params) => {
      const tool = tools[toolName];
      if (!tool) {
        return { error: `Unknown tool: ${toolName}` };
      }
      try {
        return await tool(params || {});
      } catch (err) {
        return { error: String(err?.message || err) };
      }
    },

    getResult: () => ({
      finished: reportFinished,
      title: reportTitle,
      summary: reportSummary,
      sections: writtenSections,
    }),

    getAvailableTools: () => Object.keys(tools),
  };
}

// ===== ReAct Writer 主循环 =====

const WRITER_SYSTEM_PROMPT = `You are a research report writer using a ReAct (Reason-Act) approach.

Your task is to write a comprehensive research report by:
1. Understanding the research questions (gaps)
2. Gathering evidence for each question
3. Writing sections that answer each question with proper citations

## Available Tools

- getGaps(): Get all research questions to answer
- getGapDetail({gapId}): Get question details and related claims
- getClaimsForGap({gapId}): Get all claims for a question with evidence previews
- getEvidence({evidenceId}): Get full evidence details including quote
- getSourceChunk({sourceId, start, end}): Read more context from source document
- searchEvidence({query, limit?}): Search evidence by keyword
- writeSection({gapId?, title?, markdown}): Write a report section (use {{cite:EVIDENCE_ID}} for citations)
- finishReport({title, summary}): Complete the report

## Response Format

Respond with JSON only:
{
  "thought": "Your reasoning about what to do next",
  "action": {
    "tool": "toolName",
    "params": { ... }
  }
}

OR when all sections are written:
{
  "thought": "All questions answered, finishing report",
  "finish": {
    "tool": "finishReport",
    "params": { "title": "Report Title", "summary": "Brief summary" }
  }
}

## Writing Guidelines

1. Process ONE question at a time
2. For each question:
   - First call getGapDetail or getClaimsForGap to understand what claims support it
   - Call getEvidence for important claims to see the full quotes
   - Use getSourceChunk if you need more context
   - Write the section with proper citations using {{cite:EVIDENCE_ID}}
3. Use markdown formatting (## for section titles, bullet points, etc.)
4. Every factual claim must have a citation
5. Do not invent facts - only use information from the evidence`;

const WRITER_INITIAL_PROMPT = `Task Goal: {taskGoal}

Target word count: {targetWords} words (minimum: {minWords}, maximum: {maxWords})

Begin by calling getGaps() to see all research questions you need to answer.`;

/**
 * 运行 ReAct Writer
 */
export async function runReactWriter(context, options = {}) {
  const { state, claims, evidenceLedger, sources, stageApi } = context;
  const gaps = Array.isArray(state?.L1?.gaps) ? state.L1.gaps : [];

  const {
    targetWords = 2000,
    minWords = 1500,
    maxWords = 3000,
    hardLimit = 30,
    onStep,
  } = options;

  const callModel = getModelCaller(stageApi, { usage: "writer", state });
  if (!callModel) {
    throw new Error("No model caller available for writer");
  }

  const toolExecutor = createWriterToolExecutor({
    state,
    claims,
    evidenceLedger,
    sources,
    gaps,
  });

  const taskGoal = toNonEmptyString(state?.taskGoal) || "Generate research report";

  const messages = [
    { role: "system", content: WRITER_SYSTEM_PROMPT },
    {
      role: "user",
      content: WRITER_INITIAL_PROMPT
        .replace("{taskGoal}", taskGoal)
        .replace("{targetWords}", String(targetWords))
        .replace("{minWords}", String(minWords))
        .replace("{maxWords}", String(maxWords)),
    },
  ];

  const steps = [];
  let stepCount = 0;

  while (stepCount < hardLimit) {
    checkCancelled(stageApi);
    stepCount++;

    // 调用模型
    const response = await callModel(messages, {
      model: "auto",
      temperature: 0.3,
      maxTokens: 1500,
    });

    const content = response?.content || "";
    const jsonCandidate = extractJsonCandidate(content);

    let parsed = null;
    try {
      parsed = jsonCandidate ? JSON.parse(jsonCandidate) : null;
    } catch {
      parsed = null;
    }

    if (!parsed || !isPlainObject(parsed)) {
      // 模型输出无效，记录并继续
      messages.push({ role: "assistant", content });
      messages.push({
        role: "user",
        content: "Invalid response format. Please respond with valid JSON containing 'thought' and 'action' or 'finish'.",
      });
      continue;
    }

    const thought = toNonEmptyString(parsed.thought) || "";
    const action = parsed.action;
    const finish = parsed.finish;

    // 记录步骤
    const step = {
      stepNumber: stepCount,
      thought,
      action: action || finish,
      observation: null,
    };

    // 添加到消息历史
    messages.push({ role: "assistant", content });

    // 处理 finish
    if (finish && isPlainObject(finish)) {
      const toolName = finish.tool || "finishReport";
      const params = finish.params || {};

      const result = await toolExecutor.execute(toolName, params);
      step.observation = result;
      steps.push(step);

      onStep?.(step);
      break;
    }

    // 处理 action
    if (action && isPlainObject(action)) {
      const toolName = toNonEmptyString(action.tool);
      const params = action.params || {};

      if (!toolName) {
        messages.push({
          role: "user",
          content: "Action must specify a 'tool' name. Available tools: " + toolExecutor.getAvailableTools().join(", "),
        });
        continue;
      }

      const result = await toolExecutor.execute(toolName, params);
      step.observation = result;
      steps.push(step);

      onStep?.(step);

      // 将观察结果返回给模型
      messages.push({
        role: "user",
        content: `Observation:\n${JSON.stringify(result, null, 2)}\n\nContinue with next action or finish if all questions are answered.`,
      });
      continue;
    }

    // 无效的响应结构
    messages.push({
      role: "user",
      content: "Please respond with either 'action' (to use a tool) or 'finish' (to complete the report).",
    });
  }

  // 获取最终结果
  const writerResult = toolExecutor.getResult();

  // 组装报告
  const sectionsMarkdown = writerResult.sections
    .map(s => `## ${s.title}\n\n${s.markdown}`)
    .join("\n\n");

  const fullMarkdown = `# ${writerResult.title || "Research Report"}\n\n${writerResult.summary ? writerResult.summary + "\n\n" : ""}${sectionsMarkdown}`;

  // 处理引用
  const finalized = finalizeCitationsInMarkdown(fullMarkdown, evidenceLedger, sources);

  return {
    title: writerResult.title,
    summary: writerResult.summary,
    sections: writerResult.sections,
    draftMarkdown: fullMarkdown,
    markdown: finalized.markdown,
    citations: finalized.citations,
    steps,
    stepCount,
    finished: writerResult.finished,
  };
}

export default { createWriterToolExecutor, runReactWriter };
