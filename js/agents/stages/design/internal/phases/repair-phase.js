import { emitStage } from "../../design-helpers.js";
import { DesignPhase } from "../../states.js";
import { runWithPhaseSpan } from "./phase-utils.js";

/**
 * @typedef {(name: string, event: any) => void} EmitFn
 */

/**
 * 批量编排修复阶段 - 整合 QA 与风格对齐
 *
 * @param {any} loop
 * @param {any} stateOrParams
 * @param {{ context: any, runContext: any, emit?: EmitFn, traceContext?: any } | undefined} [maybeParams]
 * @returns {Promise<{ deckHtmlDsl: string, slidesMeta: any[] }>}
 */
export async function runBatchRepairPhase(loop, stateOrParams, maybeParams) {
  const isLegacyCall = !!(maybeParams && typeof maybeParams === "object");
  const params = isLegacyCall ? maybeParams : stateOrParams || {};
  const context = params.context;
  const runContext = params.runContext;
  const emit = params.emit;
  const traceContext = params.traceContext;
  const runId = runContext?.runId;
  const stateSource = isLegacyCall ? stateOrParams : loop.state;
  const state = stateSource && typeof stateSource === "object" ? stateSource : {};
  const slideHtmls = Array.isArray(state.slideHtmls) ? state.slideHtmls : [];
  const slidesMeta = Array.isArray(state.slidesMeta) ? state.slidesMeta : [];
  const designSystem = state.designSystem;
  const contentPackage = state.contentPackage;
  const baseDeckHtmlDsl = typeof state.baseDeckHtmlDsl === "string"
    ? state.baseDeckHtmlDsl
    : slideHtmls.join("\n\n");

  const runPhase = async () => {
    loop._transitionPhase(loop.phase, DesignPhase.REPAIR, { emit, runId });

    // 1. 运行全局风格审计
    const { runAutoReview } = await import("../../reviewer/auto-reviewer.js");
    const reviewResult = await runAutoReview({ deckHtmlDsl: baseDeckHtmlDsl, slidesMeta }, designSystem, { signal: context.signal });

    // 2. 收集 QA 报错
    const qaIssues = slidesMeta.filter((m) => !m.qa?.pass).map((m) => ({
      slideIndex: m.slideNo - 1,
      issues: m.qa.issues,
    }));

    // 3. 判断是否需要修复
    const hasDegradedSlides = slidesMeta.some((m) => m?.degraded === true);
    if (qaIssues.length === 0 && reviewResult.pass && !hasDegradedSlides) {
      emitStage(emit, "design.repair.skipped", "progress", { reason: "healthy" });
      return { deckHtmlDsl: baseDeckHtmlDsl, slidesMeta };
    }

    // 4. 调用批量编排工具 (BatchRepairAgent)
    emitStage(emit, "design.repair.started", "progress", {
      qaIssueCount: qaIssues.length,
      styleIssueCount: reviewResult.issues?.length || 0,
      consistencyScore: reviewResult.score,
    });

    const repairResult = await loop._callTool(
      "orchestrate_batch_repair",
      {
        deckPackage: { deckHtmlDsl: baseDeckHtmlDsl, slidesMeta },
        qaIssues,
        styleIssues: reviewResult.issues,
        designSystem,
      },
      context
    );

    if (!repairResult.ok) {
      emitStage(emit, "design.repair.failed", "warn", { error: repairResult.error });
      return { deckHtmlDsl: baseDeckHtmlDsl, slidesMeta };
    }

    const finalDeck = repairResult.data?.finalDeck || repairResult.data || {};
    const finalHtmls = finalDeck.deckHtmlDsl || baseDeckHtmlDsl;
    const finalMeta = finalDeck.slidesMeta || slidesMeta;

    emitStage(emit, "design.repair.ended", "ended", {
      finalScore: repairResult.data?.qualityScore,
      steps: repairResult.data?.steps?.length,
    });

    return {
      deckHtmlDsl: finalHtmls,
      slidesMeta: finalMeta,
    };
  };

  const repairOut = await runWithPhaseSpan(
    traceContext,
    "design.phase.repair",
    { runId, slideCount: slideHtmls.length },
    runPhase
  );

  state.deckHtmlDsl = repairOut.deckHtmlDsl;
  state.slidesMeta = repairOut.slidesMeta;
  state.baseDeckHtmlDsl = repairOut.deckHtmlDsl;

  return repairOut;
}
