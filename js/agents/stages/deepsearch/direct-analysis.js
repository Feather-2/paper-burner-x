/**
 * Direct Analysis - 小文档直通模式
 *
 * 当文档总字符数 < 阈值时，跳过复杂的检索流程，
 * 一次 LLM 调用完成：gaps 识别 + claims 提取 + evidence 标注 + report 生成
 */

import { DeepSearchState, extractJsonCandidate, makeStageEmitter } from "./state.js";
import { getModelCaller } from "./model.js";
import { buildContentPackage } from "../textprep/build-content-package.js";
import { logEvent } from "./logger.js";
import { isPlainObject, toNonEmptyString, safeInt } from "../../shared/value-utils.js";
import { SMALL_DOC_THRESHOLD } from "./constants.js";

const DIRECT_ANALYSIS_PROMPT = `你是一个文档分析专家。请仔细阅读以下文档，并根据用户目标完成分析。

## 用户目标
{taskGoal}

## 文档内容
{fullText}

## 任务
1. 识别需要回答的知识缺口（gaps）
2. 从文档中提取关键论点（claims）
3. 为每个论点标注证据位置（quote 必须是文档中的原文）
4. 生成一份简要报告

## 输出格式（严格 JSON）
{
  "gaps": [
    {
      "gapId": "gap_1",
      "type": "definition|data|mechanism|application|comparison|trend",
      "question": "问题描述",
      "status": "filled|open"
    }
  ],
  "claims": [
    {
      "claimId": "clm_1",
      "text": "论点陈述",
      "importance": "core|support",
      "gapIds": ["gap_1"],
      "evidenceIds": ["evi_1"]
    }
  ],
  "evidenceLedger": [
    {
      "evidenceId": "evi_1",
      "sourceId": "{sourceId}",
      "quote": "原文引用（必须是文档中的原文）",
      "charStart": 起始位置,
      "charEnd": 结束位置
    }
  ],
  "report": {
    "title": "报告标题",
    "summary": "100字以内的摘要",
    "sections": [
      {
        "sectionId": "sec_1",
        "title": "章节标题",
        "markdown": "章节内容（使用 [1] 格式引用证据）"
      }
    ]
  }
}

注意：
- quote 必须是文档中的原文，charStart/charEnd 是字符位置
- 每个 claim 必须有至少一个 evidenceId
- report.sections 中使用 [数字] 格式引用 evidenceLedger 中的证据`;

/**
 * 检查是否应该使用直通模式
 * 默认禁用，需要显式启用：userConfig.directAnalysis.enabled = true
 */
export function shouldUseDirectMode(state, { threshold } = {}) {
  const sources = Array.isArray(state?.L0?.sources) ? state.L0.sources : [];
  const totalChars = sources.reduce((sum, s) => sum + (s?.sourceTextNormalized?.length || 0), 0);
  const th = safeInt(threshold) ?? safeInt(state?.userConfig?.directAnalysis?.threshold) ?? SMALL_DOC_THRESHOLD;

  // 默认禁用，需要显式启用
  if (state?.userConfig?.directAnalysis?.enabled !== true) {
    return { shouldUse: false, reason: "not_explicitly_enabled", totalChars, threshold: th };
  }

  if (totalChars <= th) {
    return { shouldUse: true, reason: "small_document", totalChars, threshold: th };
  }

  return { shouldUse: false, reason: "document_too_large", totalChars, threshold: th };
}

/**
 * 合并所有源文档文本
 */
function mergeSourceTexts(sources) {
  const parts = [];
  for (const s of Array.isArray(sources) ? sources : []) {
    const text = s?.sourceTextNormalized;
    if (typeof text === "string" && text.trim()) {
      const title = toNonEmptyString(s?.title);
      if (title) {
        parts.push(`## ${title}\n\n${text}`);
      } else {
        parts.push(text);
      }
    }
  }
  return parts.join("\n\n---\n\n");
}

/**
 * 验证并修复 evidence 的 charStart/charEnd
 */
function validateAndFixEvidence(evidence, fullText, sourceId) {
  const quote = toNonEmptyString(evidence?.quote);
  if (!quote) return null;

  let charStart = safeInt(evidence?.charStart);
  let charEnd = safeInt(evidence?.charEnd);

  // 尝试在全文中查找 quote
  if (charStart === null || charEnd === null || charStart >= charEnd) {
    const idx = fullText.indexOf(quote);
    if (idx >= 0) {
      charStart = idx;
      charEnd = idx + quote.length;
    } else {
      // 尝试模糊匹配（去除空白差异）
      const normalizedQuote = quote.replace(/\s+/g, " ").trim();
      const normalizedText = fullText.replace(/\s+/g, " ");
      const fuzzyIdx = normalizedText.indexOf(normalizedQuote);
      if (fuzzyIdx >= 0) {
        // 粗略估算原始位置
        charStart = Math.max(0, fuzzyIdx - 50);
        charEnd = Math.min(fullText.length, fuzzyIdx + normalizedQuote.length + 50);
      } else {
        // 找不到，使用整个文档
        charStart = 0;
        charEnd = Math.min(fullText.length, quote.length + 100);
      }
    }
  }

  return {
    evidenceId: evidence.evidenceId,
    sourceId: sourceId,
    quote: quote,
    locator: { charStart, charEnd },
  };
}

/**
 * 直通模式分析
 */
export async function runDirectAnalysis(runContext, input, stageApi = {}) {
  const emit = makeStageEmitter(stageApi, "deepsearch");
  const state = input?.state instanceof DeepSearchState ? input.state : DeepSearchState.fromJSON(input?.state || {});

  const sources = Array.isArray(state?.L0?.sources) ? state.L0.sources : [];
  const primarySource = sources[0];
  const sourceId = toNonEmptyString(primarySource?.sourceId) || "source_1";
  const fullText = mergeSourceTexts(sources);

  logEvent({
    stage: "direct_analysis",
    message: "Direct analysis started",
    data: { sourceCount: sources.length, totalChars: fullText.length },
  });

  emit?.("deepsearch.direct.started", {
    runId: state.runId,
    sourceCount: sources.length,
    totalChars: fullText.length,
  });

  const callModel = getModelCaller(stageApi, { usage: "analyst", state });
  if (!callModel) {
    throw new Error("Direct analysis requires LLM model");
  }

  const prompt = DIRECT_ANALYSIS_PROMPT
    .replace("{taskGoal}", String(state.taskGoal || "分析文档内容"))
    .replace("{fullText}", fullText.slice(0, 50000)) // 限制长度
    .replace("{sourceId}", sourceId);

  const result = await callModel(
    [{ role: "user", content: prompt }],
    { temperature: 0.3, maxTokens: 4000 }
  );

  const candidate = extractJsonCandidate(result?.content);
  if (!candidate) {
    throw new Error("Direct analysis: failed to parse LLM response");
  }

  const parsed = JSON.parse(candidate);

  // 处理 gaps
  const gaps = (Array.isArray(parsed?.gaps) ? parsed.gaps : []).map((g, i) => ({
    gapId: toNonEmptyString(g?.gapId) || `gap_${i + 1}`,
    type: toNonEmptyString(g?.type) || "unknown",
    question: toNonEmptyString(g?.question) || "",
    status: g?.status === "open" ? "open" : "filled",
    priority: "high",
  }));

  // 处理 evidence（验证 locator）
  const evidenceLedger = (Array.isArray(parsed?.evidenceLedger) ? parsed.evidenceLedger : [])
    .map((e, i) => {
      const fixed = validateAndFixEvidence(
        { ...e, evidenceId: toNonEmptyString(e?.evidenceId) || `evi_${i + 1}` },
        fullText,
        sourceId
      );
      return fixed;
    })
    .filter(Boolean);

  // 处理 claims
  const claims = (Array.isArray(parsed?.claims) ? parsed.claims : []).map((c, i) => ({
    claimId: toNonEmptyString(c?.claimId) || `clm_${i + 1}`,
    text: toNonEmptyString(c?.text) || "",
    importance: c?.importance === "core" ? "core" : "support",
    gapIds: Array.isArray(c?.gapIds) ? c.gapIds : [],
    evidenceIds: Array.isArray(c?.evidenceIds) ? c.evidenceIds : [],
  }));

  // 处理 report
  const report = isPlainObject(parsed?.report) ? {
    title: toNonEmptyString(parsed.report.title) || state.taskGoal || "分析报告",
    markdown: toNonEmptyString(parsed.report.summary) || "",
    sections: Array.isArray(parsed.report.sections) ? parsed.report.sections.map((s, i) => ({
      sectionId: toNonEmptyString(s?.sectionId) || `sec_${i + 1}`,
      title: toNonEmptyString(s?.title) || `章节 ${i + 1}`,
      markdown: toNonEmptyString(s?.markdown) || "",
    })) : [],
    citations: evidenceLedger.map((e, i) => ({
      citationId: `cite_${i + 1}`,
      evidenceId: e.evidenceId,
    })),
  } : null;

  // 更新 state
  state.L1.gaps = gaps;
  state.L1.claims = claims;
  state.L1.evidenceLedger = evidenceLedger;
  state.L1.report = report;
  state.L1.scanSummary = {
    summaryText: `直通模式分析：${sources.length} 个来源，${fullText.length} 字符`,
    keyTopics: gaps.map(g => g.question).slice(0, 5),
  };

  logEvent({
    stage: "direct_analysis",
    message: "Direct analysis completed",
    data: {
      gapCount: gaps.length,
      claimCount: claims.length,
      evidenceCount: evidenceLedger.length,
    },
  });

  emit?.("deepsearch.direct.completed", {
    runId: state.runId,
    gapCount: gaps.length,
    claimCount: claims.length,
    evidenceCount: evidenceLedger.length,
  });

  // 构建 ContentPackage
  const assets = Array.isArray(state?.L0?.assets) ? state.L0.assets : [];
  const pkg = buildContentPackage(
    runContext,
    sources,
    [], // slideIntents
    claims,
    evidenceLedger,
    [], // dataTables
    {
      mode: "deepsearch",
      scanSummary: state.L1.scanSummary,
      gaps,
      report,
      openQuestions: [],
      assets,
    }
  );

  return pkg;
}

export default runDirectAnalysis;
