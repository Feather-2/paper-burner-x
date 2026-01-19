import { checkCancelled } from "../../../../runtime/index.js";
import { DesignPhase } from "../../states.js";
import { emitStage } from "../../design-helpers.js";
import { generateLayoutBatch } from "../../generators/layout-generator.js";
import { runWithPhaseSpan } from "./phase-utils.js";

/**
 * @typedef {(name: string, event: any) => void} EmitFn
 */

/**
 * 布局阶段：生成线框图并等待用户确认
 *
 * @param {any} loop
 * @param {{ context: any, runContext: any, emit?: EmitFn, traceContext?: any }} params
 * @returns {Promise<{ layouts: any[] }>}
 */
export async function runLayoutPhase(loop, {
  slideIntents: providedSlideIntents,
  designSystem: providedDesignSystem,
  plans: providedPlans,
  context,
  runContext,
  emit,
  traceContext,
}) {
  const runId = runContext?.runId;
  const slideIntents = Array.isArray(providedSlideIntents)
    ? providedSlideIntents
    : Array.isArray(loop.state?.slideIntents)
      ? loop.state.slideIntents
      : [];
  const designSystem = providedDesignSystem ?? loop.state?.designSystem ?? null;
  const plans = Array.isArray(providedPlans)
    ? providedPlans
    : Array.isArray(loop.state?.plans)
      ? loop.state.plans
      : [];

  const runPhase = async () => {
    loop._transitionPhase(loop.phase, DesignPhase.LAYOUT_DEVELOPING, { emit, runId });
    checkCancelled(context.signal);

    // 生成布局
    const layouts = generateLayoutBatch(slideIntents, plans);

    // 组装预览 HTML
    const previewHtml = layouts.map((l) => l.layoutHtml).join("\n");

    emitStage(emit, "design.layout.preview", "awaiting_confirm", {
      runId,
      layouts,
      previewHtml,
      slideCount: layouts.length,
    });

    loop._blackboard?.logDecision("layout_generated", `Generated ${layouts.length} layout wireframes`);

    // 等待用户确认
    loop._transitionPhase(loop.phase, DesignPhase.LAYOUT_CONFIRMING, { emit, runId });

    if (context?.interactionMode?.layoutConfirm && context.interactionMode.layoutConfirm !== "skip") {
      const layoutConfirmResult = await loop.waitForUserAction("confirm_layout", {
        eventBus: context.eventBus,
        signal: context.signal,
      });

      // 支持用户修改布局
      if (layoutConfirmResult && typeof layoutConfirmResult === "object" && Array.isArray(layoutConfirmResult.layouts)) {
        layouts.splice(0, layouts.length, ...layoutConfirmResult.layouts);
        loop._blackboard?.logDecision("layout_edited", "User modified layouts");
      }
    }

    emitStage(emit, "design.layout.confirmed", "confirmed", {
      runId,
      layouts,
      slideCount: layouts.length,
    });

    return { layouts };
  };

  const layoutOut = await runWithPhaseSpan(
    traceContext,
    "design.phase.layout",
    { runId, slideCount: slideIntents.length },
    runPhase
  );

  if (loop.state && typeof loop.state === "object") {
    loop.state.layoutData = layoutOut;
  }
  loop._blackboard?.setSummary("layout", "Wireframes generated");

  return layoutOut;
}
