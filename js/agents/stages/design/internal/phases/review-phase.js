import { emitStage } from "../../design-helpers.js";
import { runWithPhaseSpan } from "./phase-utils.js";

/**
 * @typedef {(name: string, event: any) => void} EmitFn
 */

/**
 * Review 阶段处理 - 全局风格检查
 *
 * @param {any} loop
 * @param {{ context: any, runContext: any, emit?: EmitFn, traceContext?: any }} params
 * @returns {Promise<{ reviewResult: any, fixedDeckHtmlDsl: string, fixes: any[] }>}
 */
export async function runReviewPhase(loop, {
  deckHtmlDsl: providedDeckHtmlDsl,
  slidesMeta: providedSlidesMeta,
  designSystem: providedDesignSystem,
  context,
  runContext,
  emit,
  traceContext,
}) {
  const runId = runContext?.runId;
  const state = loop.state && typeof loop.state === "object" ? loop.state : {};
  const deckHtmlDsl = providedDeckHtmlDsl ?? state.deckHtmlDsl ?? "";
  const slidesMeta = Array.isArray(providedSlidesMeta)
    ? providedSlidesMeta
    : Array.isArray(state.slidesMeta)
      ? state.slidesMeta
      : [];
  const designSystem = providedDesignSystem ?? state.designSystem;

  const runPhase = async () => {
    const { runAutoReview } = await import("../../reviewer/auto-reviewer.js");

    emitStage(emit, "design.review.started", "started", {
      runId,
      slideCount: slidesMeta?.length || 0,
    });

    const deckPackage = { deckHtmlDsl, slidesMeta };
    const reviewResult = await runAutoReview(deckPackage, designSystem, {
      signal: context?.signal,
    });

    // Log to blackboard
    loop._blackboard?.logDecision("review_complete", `Score: ${reviewResult.score}, Issues: ${reviewResult.issues?.length || 0}`);

    emitStage(emit, "design.review.ended", "ended", {
      runId,
      score: reviewResult.score,
      pass: reviewResult.pass,
      issueCount: reviewResult.issues?.length || 0,
      summary: reviewResult.summary,
    });

    return {
      reviewResult,
      fixedDeckHtmlDsl: deckHtmlDsl, // 暂不自动修复，返回原始 DSL
      fixes: reviewResult.fixes || [],
    };
  };

  const reviewOut = await runWithPhaseSpan(
    traceContext,
    "design.phase.review",
    { runId, slideCount: slidesMeta.length },
    runPhase
  );

  state.reviewResult = reviewOut.reviewResult;

  return reviewOut;
}
