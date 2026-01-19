import { checkCancelled } from "../../../../runtime/index.js";
import { DesignPhase } from "../../states.js";
import { emitStage } from "../../design-helpers.js";
import { planDeck, applyUserEdits, formatPlanForDialog } from "../deck-planner.js";
import { runWithPhaseSpan } from "./phase-utils.js";

/**
 * @typedef {(name: string, event: any) => void} EmitFn
 */

/**
 * 规划阶段：生成预案并等待用户确认
 *
 * @param {any} loop
 * @param {{ context: any, runContext: any, emit?: EmitFn, traceContext?: any }} params
 * @returns {Promise<{ plans: any[], planResult: any }>}
 */
export async function runPlanningPhase(loop, {
  slideIntents: providedSlideIntents,
  designSystem: providedDesignSystem,
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

  const runPhase = async () => {
    loop._transitionPhase(loop.phase, DesignPhase.DECK_PLANNING, { emit, runId });
    checkCancelled(context.signal);

    // 生成规划
    const planResult = planDeck(slideIntents, designSystem);
    let plans = planResult.plans;

    // Emit 规划预览
    const dialogFormat = formatPlanForDialog(plans);
    emitStage(emit, "design.plan.preview", "awaiting_confirm", {
      runId,
      plans,
      dialogFormat,
      slideCount: plans.length,
      summary: planResult.summary,
    });

    // Log to blackboard
    loop._blackboard?.logDecision("plan_generated", `Generated ${plans.length} slide plans`, {
      summary: planResult.summary,
    });

    // 等待用户确认/调整
    loop._transitionPhase(loop.phase, DesignPhase.PLAN_CONFIRMING, { emit, runId });

    if (context?.interactionMode?.planConfirm && context.interactionMode.planConfirm !== "skip") {
      const planConfirmResult = await loop.waitForUserAction("confirm_plan", {
        eventBus: context.eventBus,
        signal: context.signal,
      });

      // 应用用户修改
      if (planConfirmResult && typeof planConfirmResult === "object") {
        if (Array.isArray(planConfirmResult.edits)) {
          plans = applyUserEdits(plans, planConfirmResult.edits);
          loop._blackboard?.logDecision("plan_edited", "User modified slide plans", {
            editCount: planConfirmResult.edits.length,
          });
        }
        // 支持直接传入修改后的 plans
        if (Array.isArray(planConfirmResult.plans)) {
          plans = planConfirmResult.plans;
        }
      }
    }

    emitStage(emit, "design.plan.confirmed", "confirmed", {
      runId,
      plans,
      slideCount: plans.length,
    });

    return {
      plans,
      planResult,
    };
  };

  const planOut = await runWithPhaseSpan(
    traceContext,
    "design.phase.planning",
    { runId, slideCount: slideIntents.length },
    runPhase
  );

  if (loop.state && typeof loop.state === "object") {
    loop.state.plans = planOut.plans;
  }
  loop._blackboard?.setSummary("plan", `${planOut.plans.length} slides planned`);

  return planOut;
}
