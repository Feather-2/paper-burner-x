import { DeepSearchState, checkCancelled, extractJsonCandidate, makeStageEmitter } from "./state.js";
import { getModelCaller } from "./model.js";
import { buildReportSkeleton, runReviewerAgent, validateReviewerOutput } from "./review.js";
import { applyPatchPlan } from "./report-diff.js";
import { finalizeCitationsInMarkdown } from "./citations.js";
import { runReactReviewer } from "./react-reviewer.js";
import { createToolExecutor } from "./react-reviewer-tools.js";
import { runReactWriter } from "./react-writer.js";
import { deriveSlideIntentsFromReport } from "./report-to-slide-intents.js";
import { isPlainObject, toNonEmptyString } from "../../shared/value-utils.js";
import {
  emitWriteProgress,
  finalizeReportKeepingCitations,
  generateReport,
  generateReportSingleWithLLM,
  generateReportTocBasedWithLLM,
} from "./report-generator.js";
import {
  countWordsApprox,
  extractTitleFromMarkdown,
  normalizeStringArray,
  resolveMaxParallelSections,
  resolveReportLengthConfig,
  resolveReviewerConfig,
} from "./write-utils.js";

export { finalizeCitationsInMarkdown };
export { generateReport };

function normalizeGapIds(v) {
  return normalizeStringArray(v);
}

function normalizeEvidenceIds(v) {
  return normalizeStringArray(v);
}

function computeFeedbackToResearch(state, { minResolvedEvidencePerClaim = 1 } = {}) {
  const gaps = Array.isArray(state?.L1?.gaps) ? state.L1.gaps : [];
  const claims = Array.isArray(state?.L1?.claims) ? state.L1.claims : [];
  const evidenceLedger = Array.isArray(state?.L1?.evidenceLedger) ? state.L1.evidenceLedger : [];

  const evidenceById = new Map();
  for (const e of evidenceLedger) {
    const eid = toNonEmptyString(e?.evidenceId);
    if (!eid) continue;
    evidenceById.set(String(eid), e);
  }

  const claimCountByGapId = new Map();
  for (const c of claims) {
    const gapIds = normalizeGapIds(c?.gapIds);
    for (const gid of gapIds) claimCountByGapId.set(gid, (claimCountByGapId.get(gid) || 0) + 1);
  }

  const reopenGaps = [];
  const missingGapIds = [];
  for (const g of gaps) {
    const gid = toNonEmptyString(g?.gapId);
    if (!gid) continue;
    const count = claimCountByGapId.get(String(gid)) || 0;
    if (count < 1) missingGapIds.push(String(gid));
  }

  const newGaps = [];
  const insufficientEvidenceClaims = [];

  const minEvidence = Number.isFinite(minResolvedEvidencePerClaim) ? Math.max(0, Math.floor(minResolvedEvidencePerClaim)) : 1;
  for (const c of claims) {
    const claimId = toNonEmptyString(c?.claimId) || "";
    const evidenceIds = normalizeEvidenceIds(c?.evidenceIds);
    const resolved = evidenceIds.filter((eid) => evidenceById.has(String(eid)));
    if (resolved.length >= minEvidence) continue;

    if (claimId) insufficientEvidenceClaims.push(claimId);
    const gapIds = normalizeGapIds(c?.gapIds);
    if (gapIds.length) {
      for (const gid of gapIds) reopenGaps.push(String(gid));
    } else {
      const text = toNonEmptyString(c?.text);
      if (text) newGaps.push({ question: `Find evidence to support: ${String(text).slice(0, 140)}`, priority: "high" });
    }
  }

  for (const gid of missingGapIds) reopenGaps.push(String(gid));

  const normalizedReopen = Array.from(new Set(reopenGaps.map((x) => String(x || "").trim()).filter(Boolean)));
  const normalizedNew = [];
  const newKey = new Set();
  for (const g of Array.isArray(newGaps) ? newGaps : []) {
    const q = toNonEmptyString(g?.question);
    if (!q) continue;
    const key = q.toLowerCase();
    if (newKey.has(key)) continue;
    newKey.add(key);
    const priority = toNonEmptyString(g?.priority);
    normalizedNew.push({ question: String(q), ...(priority ? { priority: String(priority) } : {}) });
  }

  const needsMoreResearch = normalizedReopen.length > 0 || normalizedNew.length > 0 || (gaps.length > 0 && claims.length === 0);
  const parts = [];
  if (missingGapIds.length) parts.push(`missingClaimsForGaps=${missingGapIds.length}`);
  if (insufficientEvidenceClaims.length) parts.push(`insufficientEvidenceClaims=${insufficientEvidenceClaims.length}`);
  if (gaps.length > 0 && claims.length === 0) parts.push("noClaims");
  const reason = parts.length ? parts.join("; ") : undefined;

  return {
    needsMoreResearch,
    reopenGaps: normalizedReopen,
    newGaps: normalizedNew,
    ...(reason ? { reason } : {}),
  };
}

function ensureState(_runContext, input) {
  if (input instanceof DeepSearchState) return input;
  if (input?.state instanceof DeepSearchState) return input.state;
  if (isPlainObject(input?.state)) return DeepSearchState.fromJSON(input.state);
  throw new TypeError("DeepSearch write: input.state is required");
}

function ensureCoreSlides({ title, claimIds }) {
  const ids = Array.isArray(claimIds) ? claimIds : [];
  return [
    { slideIntentId: "s_cover", pageType: "cover", title: title || "Presentation", objective: "Set the context", claimIds: [] },
    { slideIntentId: "s_agenda", pageType: "agenda", title: "Agenda", objective: "Outline the flow", keyPoints: ["Background", "Findings", "Implications"], claimIds: [] },
    { slideIntentId: "s_overview", pageType: "overview", title: "Key Findings", objective: "Summarize the core findings", claimIds: ids.slice(0, 5) },
    { slideIntentId: "s_summary", pageType: "summary", title: "Summary", objective: "Wrap up with takeaways", claimIds: ids.slice(Math.max(0, ids.length - 5)) },
  ];
}

function normalizeSlideIntent(v, i) {
  if (!isPlainObject(v)) return null;
  const pageType = toNonEmptyString(v?.pageType) || "overview";
  const slideIntentId = toNonEmptyString(v?.slideIntentId) || `s_${i + 1}`;
  const title = toNonEmptyString(v?.title) || "";
  const objective = toNonEmptyString(v?.objective) || undefined;
  const keyPoints = Array.isArray(v?.keyPoints) ? v.keyPoints.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 8) : undefined;
  const claimIds = Array.isArray(v?.claimIds) ? v.claimIds.map((x) => String(x || "").trim()).filter(Boolean) : [];
  return { slideIntentId, pageType, title, ...(objective ? { objective } : {}), ...(keyPoints ? { keyPoints } : {}), claimIds };
}

function ensureCoreSlidesMerged(slideIntents, { title, claimIds }) {
  const out = (Array.isArray(slideIntents) ? slideIntents : []).map(normalizeSlideIntent).filter(Boolean);
  const core = ensureCoreSlides({ title, claimIds });

  const has = new Set(out.map((s) => s.pageType).filter(Boolean));
  if (!has.has("cover")) out.unshift(core.find((s) => s.pageType === "cover"));
  if (!has.has("agenda")) out.splice(1, 0, core.find((s) => s.pageType === "agenda"));
  if (!has.has("overview")) out.splice(2, 0, core.find((s) => s.pageType === "overview"));
  if (!has.has("summary")) out.push(core.find((s) => s.pageType === "summary"));

  const seen = new Set();
  for (let i = 0; i < out.length; i++) {
    const s = out[i];
    let id = toNonEmptyString(s?.slideIntentId);
    if (!id || seen.has(id)) id = `s_${i + 1}`;
    seen.add(id);
    out[i] = { ...s, slideIntentId: id };
  }
  return out.filter(Boolean);
}

async function tryLLMSlidePlan(state, { title, claimIds, claims }, stageApi) {
  const callModel = getModelCaller(stageApi, { usage: "writer", state });
  if (!callModel) return null;

  const claimCount = Array.isArray(claims) ? claims.length : 0;
  // 建议的幻灯片数量：基于 claims 数量，每 2-3 个 claims 一页，加上核心页面
  const suggestedSlideCount = Math.max(8, Math.min(20, 4 + Math.ceil(claimCount / 2.5)));

  const messages = [
    {
      role: "system",
      content:
        "You are a PPT slide planner. Create a comprehensive presentation structure.\n\n" +
        "IMPORTANT: Generate " + suggestedSlideCount + " slides (can be more if content requires).\n\n" +
        "Required slide types:\n" +
        "- cover: title slide (1)\n" +
        "- agenda: outline of presentation (1)\n" +
        "- overview: executive summary (1)\n" +
        "- content: main content slides (multiple, group related claims)\n" +
        "- comparison: if comparing alternatives\n" +
        "- process: if explaining workflows\n" +
        "- data: for statistics and metrics\n" +
        "- summary: key takeaways (1)\n\n" +
        "Each content slide should have 2-4 claims assigned via claimIds.\n\n" +
        "Return ONLY JSON: {slideIntents:[{slideIntentId,pageType,title,objective,keyPoints,claimIds}],outlineCandidates:[{outlineId,title,bullets}]}.\n" +
        "Do not invent facts. Use only the provided claims.",
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          taskGoal: String(state?.taskGoal || ""),
          title: String(title || ""),
          targetSlideCount: suggestedSlideCount,
          claimIds: Array.isArray(claimIds) ? claimIds : [],
          claims: (Array.isArray(claims) ? claims : []).slice(0, 30).map((c) => ({ claimId: c?.claimId, text: c?.text, importance: c?.importance, gapIds: c?.gapIds })),
        },
        null,
        2
      ),
    },
  ];

  try {
    const result = await callModel(messages, { model: "auto", temperature: 0.3, maxTokens: 2000 });
    const candidate = extractJsonCandidate(result?.content);
    if (!candidate) return null;
    const parsed = JSON.parse(candidate);
    if (!isPlainObject(parsed) || !Array.isArray(parsed.slideIntents)) return null;
    return {
      slideIntents: parsed.slideIntents,
      outlineCandidates: Array.isArray(parsed.outlineCandidates) ? parsed.outlineCandidates : null,
    };
  } catch {
    return null;
  }
}

/**
 * S6 PPT Writing: produce slideIntents[] from claims (placeholder).
 * @param {object} runContext
 * @param {DeepSearchState|{state:DeepSearchState|object}} input
 * @param {{emit?:Function,eventBus?:object,signal?:AbortSignal,checkCancelled?:Function}=} stageApi
 */
export async function runDeepSearchWriteStage(runContext, input, stageApi = {}) {
  const emit = makeStageEmitter(stageApi, "deepsearch");
  const state = ensureState(runContext, input);

  checkCancelled(stageApi);
  const claims = Array.isArray(state?.L1?.claims) ? state.L1.claims : [];
  const claimIds = claims.map((c) => toNonEmptyString(c?.claimId)).filter(Boolean);
  const title = toNonEmptyString(state?.userConfig?.title) || toNonEmptyString(state?.L1?.scanSummary?.title) || "";

  // 诊断日志：检查 write 阶段获取的数据
  const evidenceLedger = Array.isArray(state?.L1?.evidenceLedger) ? state.L1.evidenceLedger : [];
  const gaps = Array.isArray(state?.L1?.gaps) ? state.L1.gaps : [];
  const sources = Array.isArray(state?.L0?.sources) ? state.L0.sources : [];
  console.log("[DeepSearch] write stage data check:", {
    claimCount: claims.length,
    claimIds: claimIds.slice(0, 5),
    evidenceCount: evidenceLedger.length,
    gapCount: gaps.length,
    sourceCount: sources.length,
    iteration: state?.iteration,
    hasL1: !!state?.L1,
    L1Keys: state?.L1 ? Object.keys(state.L1) : [],
  });

  // 如果 claims 为空，记录警告
  if (claims.length === 0) {
    console.warn("[DeepSearch] write stage WARNING: claims is empty!", {
      hasState: !!state,
      stateType: state?.constructor?.name,
      L1Type: typeof state?.L1,
      L1ClaimsType: typeof state?.L1?.claims,
      L1ClaimsIsArray: Array.isArray(state?.L1?.claims),
    });
  }

  emitWriteProgress(emit, {
    current: 1,
    total: 4,
    step: "plan_slides",
    msg: "正在规划幻灯片",
    detail: { claimCount: claimIds.length, title: title || undefined },
  });

  const llm = await tryLLMSlidePlan(state, { title, claimIds, claims }, stageApi);

  emitWriteProgress(emit, {
    current: 2,
    total: 4,
    step: "finalize_slides",
    msg: llm?.slideIntents ? "正在确定幻灯片意图 (AI)" : "正在确定幻灯片意图 (启发式)",
    detail: { usedLLM: Boolean(llm?.slideIntents) },
  });

  let slideIntents = llm?.slideIntents ? ensureCoreSlidesMerged(llm.slideIntents, { title, claimIds }) : ensureCoreSlides({ title, claimIds });
  const outlineCandidates =
    llm?.outlineCandidates && Array.isArray(llm.outlineCandidates) && llm.outlineCandidates.length
      ? llm.outlineCandidates
      : [
          {
            outlineId: "o_1",
            title: "Default Outline",
            bullets: ["Background", "Evidence-backed findings", "Implications & recommendations"],
          },
        ];

  state.L1.slideIntents = slideIntents;
  state.L1.outlineCandidates = outlineCandidates;

  emitWriteProgress(emit, {
    current: 3,
    total: 4,
    step: "generate_report",
    msg: "正在生成报告",
    detail: { slideCount: slideIntents.length, outlineCount: outlineCandidates.length },
  });

  const reportConfig = resolveReportLengthConfig(state?.userConfig);
  const claimsForReport = Array.isArray(state?.L1?.claims) ? state.L1.claims : [];
  const evidenceForReport = Array.isArray(state?.L1?.evidenceLedger) ? state.L1.evidenceLedger : [];
  const gapsForReport = Array.isArray(state?.L1?.gaps) ? state.L1.gaps : [];
  const sourcesForReport = Array.isArray(state?.L0?.sources) ? state.L0.sources : [];

  // 检查写作模式：react（问题驱动）或 legacy（JSON dump）
  // 默认使用 react 模式（问题驱动写作），可通过 userConfig.write.writerMode 配置
  const writerMode = toNonEmptyString(state?.userConfig?.write?.writerMode) || "react";

  let report = null;
  let reportStrategy = "single";

  if (writerMode === "react" && claimsForReport.length > 0) {
    // ReAct Writer 模式：问题驱动的渐进式写作
    emit?.("deepsearch.write.mode", { mode: "react", reason: "问题驱动写作，逐步检索证据" });

    // 用于保存中间结果
    let partialSections = [];
    let lastStepNumber = 0;

    try {
      const reactWriterResult = await runReactWriter(
        {
          state,
          claims: claimsForReport,
          evidenceLedger: evidenceForReport,
          sources: sourcesForReport,
          stageApi,
        },
        {
          targetWords: reportConfig.targetWords,
          minWords: reportConfig.minWords,
          maxWords: reportConfig.maxWords,
          hardLimit: 30,
          tone: toNonEmptyString(state?.userConfig?.write?.tone),
          audience: toNonEmptyString(state?.userConfig?.write?.audience),
          language: toNonEmptyString(state?.userConfig?.write?.language),
          onStep: (step) => {
            lastStepNumber = step.stepNumber || lastStepNumber;

            // 获取写作内容预览（如果是 writeSection）
            const params = step.action?.params || {};
            const markdownPreview = params.markdown
              ? String(params.markdown).slice(0, 200) + (params.markdown.length > 200 ? '...' : '')
              : null;

            // 保存中间结果（writeSection 时）
            if (step.action?.tool === 'writeSection' && params.markdown) {
              partialSections.push({
                sectionId: params.sectionId || `sec_${partialSections.length + 1}`,
                title: params.title || '未命名章节',
                markdown: params.markdown,
              });
              // 保存到 state 以便恢复
              state.L1.partialReport = {
                sections: partialSections,
                lastStepNumber,
                timestamp: Date.now(),
              };
            }

            emit?.("deepsearch.write.react.step", {
              stepNumber: step.stepNumber,
              thought: step.thought,
              tool: step.action?.tool,
              toolParams: {
                sectionId: params.sectionId,
                title: params.title,
                gapId: params.gapId,
              },
              markdownPreview,
              hasObservation: !!step.observation,
              observationPreview: step.observation?.error
                ? `错误: ${step.observation.error}`
                : step.observation?.sectionId
                  ? `已写入章节: ${step.observation.sectionId}`
                  : null,
              // 添加进度信息
              sectionsWritten: partialSections.length,
            });
          },
        }
      );

      if (reactWriterResult && reactWriterResult.markdown) {
        report = {
          title: reactWriterResult.title,
          draftMarkdown: reactWriterResult.draftMarkdown,
          markdown: reactWriterResult.markdown,
          sections: reactWriterResult.sections,
          citations: reactWriterResult.citations,
        };
        reportStrategy = "react";
        console.log("[DeepSearch] ReAct Writer completed:", {
          stepCount: reactWriterResult.stepCount,
          sectionsCount: reactWriterResult.sections?.length,
          wordCount: countWordsApprox(reactWriterResult.markdown),
        });
      }
    } catch (err) {
      console.warn("[DeepSearch] ReAct Writer failed:", err);
      emit?.("deepsearch.write.react.failed", { error: String(err?.message || err), sectionsWritten: partialSections.length });

      // 尝试使用已写的部分内容
      if (partialSections.length > 0) {
        console.log("[DeepSearch] Recovering partial report with", partialSections.length, "sections");
        const sectionsMarkdown = partialSections
          .map(s => `## ${s.title}\n\n${s.markdown}`)
          .join("\n\n");
        const partialMarkdown = `# Research Report (Partial)\n\n> ⚠️ 报告未完成，以下是已写入的 ${partialSections.length} 个章节\n\n${sectionsMarkdown}`;
        const finalized = finalizeCitationsInMarkdown(partialMarkdown, evidenceForReport, sourcesForReport);

        report = {
          title: "Research Report (Partial)",
          draftMarkdown: partialMarkdown,
          markdown: finalized.markdown,
          sections: partialSections,
          citations: finalized.citations,
          partial: true,
          error: String(err?.message || err),
        };
        reportStrategy = "react-partial";
        emit?.("deepsearch.write.partial.recovered", { sectionsCount: partialSections.length });
      } else {
        report = null;
      }
    }
  }

  // Legacy 模式或 ReAct 失败时的回退
  if (!report) {
    if (reportConfig.strategy === "toc-based") {
      report = await generateReportTocBasedWithLLM(
        state,
        { claims: claimsForReport, evidenceLedger: evidenceForReport, gaps: gapsForReport, sources: sourcesForReport, config: reportConfig },
        stageApi,
        emit
      );
      if (report) reportStrategy = "toc-based";
    }
    if (!report) {
      report =
        (await generateReportSingleWithLLM(
          state,
          { claims: claimsForReport, evidenceLedger: evidenceForReport, gaps: gapsForReport, sources: sourcesForReport, config: reportConfig },
          stageApi
        )) || generateReport(claimsForReport, evidenceForReport, gapsForReport, sourcesForReport, String(state?.taskGoal || ""));
    }
  }

  report = {
    ...(isPlainObject(report) ? report : {}),
    title: extractTitleFromMarkdown(report?.draftMarkdown || report?.markdown) || toNonEmptyString(report?.title) || "Research Report",
    targetWords: reportConfig.targetWords,
    strategy: reportStrategy,
  };

  report = finalizeReportKeepingCitations(report, evidenceForReport, sourcesForReport);

  const reviewerConfig = resolveReviewerConfig(state?.userConfig);
  let reviewFeedback = { reviewed: false, rounds: 0, finalScore: 1, appliedPatches: 0 };

  if (reviewerConfig.enableReviewer) {
    const reviewerMode = toNonEmptyString(state?.userConfig?.write?.reviewerMode) || "legacy";

    if (reviewerMode === "react") {
      // ReAct Reviewer 模式
      try {
        const toolExecutor = createToolExecutor({
          report,
          state,
          evidenceLedger: evidenceForReport,
          claims: claimsForReport,
          sources: sourcesForReport,
        });

        emit?.("deepsearch.write.review.started", {
          mode: "react",
          recommendedSteps: 5,
          hardLimit: 15,
          wordCount: countWordsApprox(report?.markdown),
        });

        const reactResult = await runReactReviewer(
          report,
          {
            state,
            evidenceLedger: evidenceForReport,
            claims: claimsForReport,
            sources: sourcesForReport,
            stageApi,
          },
          {
            recommendedSteps: 5,
            hardLimit: 15,
            toolExecutor,
            onStep: (step) => {
              emit?.("deepsearch.write.react.step", {
                actor: "write",
                status: "progress",
                payload: {
                  ...step,
                  wordCount: countWordsApprox(report?.markdown),
                },
              });
            },
          }
        );

        report = reactResult.finalReport;
        reviewFeedback = {
          reviewed: true,
          rounds: reactResult.steps.length,
          finalScore: reactResult.qualityScore / 10, // 转换为 0-1 范围
          appliedPatches: reactResult.toolCalls.filter((t) => t.tool === "applyPatch" && t.result?.success).length,
          mode: "react",
          terminationReason: reactResult.terminationReason,
        };

        emit?.("deepsearch.write.review.completed", {
          mode: "react",
          qualityScore: reactResult.qualityScore,
          remainingIssues: reactResult.remainingIssues,
          totalSteps: reactResult.steps.length,
          toolCalls: reactResult.toolCalls.length,
          wordCount: countWordsApprox(report?.markdown),
        });
      } catch (err) {
        // ReAct Reviewer 失败，降级到 legacy 模式
        console.warn("[write] ReAct reviewer failed, falling back to legacy:", err);
        emit?.("deepsearch.write.react.fallback", {
          error: String(err.message || err),
          fallbackMode: "legacy",
        });

        // 继续执行 legacy 逻辑（下面的代码）
        let current = report;
        let rounds = 0;
        let appliedPatches = 0;
        let finalScore = 1;

        for (let round = 1; round <= reviewerConfig.maxReviewRounds; round++) {
          rounds = round;
          const reportSkeleton = buildReportSkeleton(current, { targetWords: reportConfig.targetWords });
          const constraints = {
            tone: toNonEmptyString(state?.userConfig?.write?.tone) || toNonEmptyString(state?.userConfig?.tone) || "neutral",
            audience: toNonEmptyString(state?.userConfig?.write?.audience) || toNonEmptyString(state?.userConfig?.audience) || "general",
            reportLength: String(reportConfig.reportLength || ""),
          };

          emit?.("deepsearch.write.review.started", {
            mode: "legacy",
            round,
            maxRounds: reviewerConfig.maxReviewRounds,
            sectionCount: reportSkeleton.sections.length,
            citationCount: reportSkeleton.globalStats.citationCount,
            wordCount: countWordsApprox(current?.markdown),
          });

          checkCancelled(stageApi);
          const reviewerOverride = stageApi?.reviewer && typeof stageApi.reviewer.review === "function" ? stageApi.reviewer.review : null;
          const raw = reviewerOverride
            ? await reviewerOverride({ reportSkeleton, constraints, report: current, state })
            : await runReviewerAgent(runContext, { reportSkeleton, constraints, state }, stageApi);

          const out = validateReviewerOutput(raw);

          emit?.("deepsearch.write.review.completed", {
            mode: "legacy",
            round,
            overallScore: out.overallScore,
            issueCount: out.issues.length,
            patchCount: out.patchPlan.length,
            wordCount: countWordsApprox(current?.markdown),
          });

          finalScore = out.overallScore;
          if (!out.patchPlan.length) break;

          current = applyPatchPlan(current, out.patchPlan, evidenceForReport, sourcesForReport);
          appliedPatches += out.patchPlan.length;
          emit?.("deepsearch.write.patch.applied", {
            mode: "legacy",
            round,
            patchCount: out.patchPlan.length,
            appliedPatches,
            wordCount: countWordsApprox(current?.markdown),
          });
        }

        report = current;
        reviewFeedback = { reviewed: true, rounds, finalScore, appliedPatches, mode: "legacy", fallbackFrom: "react" };
      }
    } else {
      // Legacy 模式（默认）
      let current = report;
      let rounds = 0;
      let appliedPatches = 0;
      let finalScore = 1;

      for (let round = 1; round <= reviewerConfig.maxReviewRounds; round++) {
        rounds = round;
        const reportSkeleton = buildReportSkeleton(current, { targetWords: reportConfig.targetWords });
        const constraints = {
          tone: toNonEmptyString(state?.userConfig?.write?.tone) || toNonEmptyString(state?.userConfig?.tone) || "neutral",
          audience: toNonEmptyString(state?.userConfig?.write?.audience) || toNonEmptyString(state?.userConfig?.audience) || "general",
          reportLength: String(reportConfig.reportLength || ""),
        };

        emit?.("deepsearch.write.review.started", {
          mode: "legacy",
          round,
          maxRounds: reviewerConfig.maxReviewRounds,
          sectionCount: reportSkeleton.sections.length,
          citationCount: reportSkeleton.globalStats.citationCount,
          wordCount: countWordsApprox(current?.markdown),
        });

        checkCancelled(stageApi);
        const reviewerOverride = stageApi?.reviewer && typeof stageApi.reviewer.review === "function" ? stageApi.reviewer.review : null;
        const raw = reviewerOverride
          ? await reviewerOverride({ reportSkeleton, constraints, report: current, state })
          : await runReviewerAgent(runContext, { reportSkeleton, constraints, state }, stageApi);

        const out = validateReviewerOutput(raw);

        emit?.("deepsearch.write.review.completed", {
          mode: "legacy",
          round,
          overallScore: out.overallScore,
          issueCount: out.issues.length,
          patchCount: out.patchPlan.length,
          wordCount: countWordsApprox(current?.markdown),
        });

        finalScore = out.overallScore;
        if (!out.patchPlan.length) break;

        current = applyPatchPlan(current, out.patchPlan, evidenceForReport, sourcesForReport);
        appliedPatches += out.patchPlan.length;
        emit?.("deepsearch.write.patch.applied", {
          mode: "legacy",
          round,
          patchCount: out.patchPlan.length,
          appliedPatches,
          wordCount: countWordsApprox(current?.markdown),
        });
      }

      report = current;
      reviewFeedback = { reviewed: true, rounds, finalScore, appliedPatches, mode: "legacy" };
    }
  }

  report.reviewFeedback = reviewFeedback;
  report.actualWords = countWordsApprox(report?.markdown);
  state.L1.report = report;

  // Design Stage v2: derive slideIntents from report.sections to keep content consistent.
  slideIntents = deriveSlideIntentsFromReport(report, {
    includeCore: true,
    idPrefix: "s_",
    keepClaimIds: true,
    keepContentString: true,
    targetSlides: state?.userConfig?.targetSlides,
  });
  state.L1.slideIntents = slideIntents;

  const feedbackToResearch = computeFeedbackToResearch(state, { minResolvedEvidencePerClaim: 1 });

  emitWriteProgress(emit, {
    current: 4,
    total: 4,
    step: "finalize",
    msg: "正在完成写作输出",
    detail: { citationCount: Array.isArray(report?.citations) ? report.citations.length : 0, sectionCount: Array.isArray(report?.sections) ? report.sections.length : 0 },
  });

  state.addTimeline({ name: "deepsearch.write", status: "completed", payload: { slideCount: slideIntents.length, citationCount: report.citations.length, wordCount: countWordsApprox(report?.markdown) } });

  emit?.("deepsearch.write.completed", { slideCount: slideIntents.length, claimCount: claimIds.length, wordCount: countWordsApprox(report?.markdown) });
  return { state, slideIntents, outlineCandidates, report, feedbackToResearch };
}

export const __test = {
  computeFeedbackToResearch,
  resolveReportLengthConfig,
  countWordsApprox,
  resolveMaxParallelSections,
};
