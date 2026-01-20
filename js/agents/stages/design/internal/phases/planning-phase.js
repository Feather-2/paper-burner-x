import { checkCancelled } from "../../../../runtime/index.js";
import { toNonEmptyString } from "../../../../shared/index.js";
import { DesignPhase } from "../../states.js";
import { emitStage } from "../../design-helpers.js";
import { planDeck, applyUserEdits, formatPlanForDialog } from "../deck-planner.js";
import { runWithPhaseSpan } from "./phase-utils.js";

const MAX_PLAN_EDIT_COUNT = 200;

function isValidPlanList(plans, overridePlans) {
  if (!Array.isArray(overridePlans) || overridePlans.length !== plans.length) return false;
  const knownIds = new Set(plans.map((plan) => plan.slideIntentId));
  const seen = new Set();
  for (const item of overridePlans) {
    if (!item || typeof item !== "object") return false;
    const slideIntentId = toNonEmptyString(item.slideIntentId);
    if (!slideIntentId || !knownIds.has(slideIntentId) || seen.has(slideIntentId)) return false;
    seen.add(slideIntentId);
  }
  return true;
}

function normalizePlanEdits(plans, edits) {
  if (!Array.isArray(edits)) return [];
  const knownIds = new Set(plans.map((plan) => plan.slideIntentId));
  const sanitized = [];
  for (const item of edits.slice(0, MAX_PLAN_EDIT_COUNT)) {
    if (!item || typeof item !== "object") continue;
    let slideIntentId = toNonEmptyString(item.slideIntentId);
    if (!slideIntentId || !knownIds.has(slideIntentId)) {
      const slideIndex = Number.isInteger(item.slideIndex) ? item.slideIndex : null;
      if (slideIndex == null || slideIndex < 0 || slideIndex >= plans.length) continue;
      slideIntentId = plans[slideIndex].slideIntentId;
    }

    const edit = { slideIntentId };
    const layoutHint = toNonEmptyString(item.layoutHint);
    const visualFocus = toNonEmptyString(item.visualFocus);
    const keyMessage = toNonEmptyString(item.keyMessage);
    const visualIntent = toNonEmptyString(item.visualIntent);
    const sellingPoint = toNonEmptyString(item.sellingPoint);

    if (layoutHint) edit.layoutHint = layoutHint.slice(0, 50);
    if (visualFocus) edit.visualFocus = visualFocus.slice(0, 50);
    if (keyMessage) edit.keyMessage = keyMessage.slice(0, 100);
    if (visualIntent) edit.visualIntent = visualIntent.slice(0, 200);
    if (sellingPoint) edit.sellingPoint = sellingPoint.slice(0, 200);

    if (Object.keys(edit).length > 1) sanitized.push(edit);
  }
  return sanitized;
}

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
          const sanitizedEdits = normalizePlanEdits(plans, planConfirmResult.edits);
          if (sanitizedEdits.length > 0) {
            plans = applyUserEdits(plans, sanitizedEdits);
            loop._blackboard?.logDecision("plan_edited", "User modified slide plans", {
              editCount: sanitizedEdits.length,
            });
          }
        }
        // 支持直接传入修改后的 plans
        if (Array.isArray(planConfirmResult.plans) && isValidPlanList(plans, planConfirmResult.plans)) {
          const sanitizedOverrides = normalizePlanEdits(plans, planConfirmResult.plans);
          if (sanitizedOverrides.length > 0) {
            plans = applyUserEdits(plans, sanitizedOverrides);
          }
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
