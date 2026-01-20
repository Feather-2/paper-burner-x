import { checkCancelled } from "../../../../runtime/index.js";
import { DesignPhase } from "../../states.js";
import { emitStage } from "../../design-helpers.js";
import { generateLayoutBatch } from "../../generators/layout-generator.js";
import { runWithPhaseSpan } from "./phase-utils.js";

const SAFE_LAYOUT_TAGS = new Set(["section", "div", "span", "ul", "li"]);
const SAFE_LAYOUT_ATTRS = new Set(["class", "data-type", "data-slide-id", "data-placeholder-type"]);
const MAX_LAYOUT_HTML_LENGTH = 20000;

function isSafeLayoutHtml(layoutHtml) {
  if (typeof layoutHtml !== "string") return false;
  const trimmed = layoutHtml.trim();
  if (!trimmed || trimmed.length > MAX_LAYOUT_HTML_LENGTH) return false;
  if (/<\s*(script|style|iframe|object|embed|link|meta)\b/i.test(trimmed)) return false;

  const tagRegex = /<\/?([a-zA-Z0-9-]+)(\s[^>]*)?>/g;
  let match = tagRegex.exec(trimmed);
  while (match) {
    const tag = match[1].toLowerCase();
    if (!SAFE_LAYOUT_TAGS.has(tag)) return false;
    const attrs = match[2];
    if (attrs) {
      const attrRegex = /([^\s=/>]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g;
      let attrMatch = attrRegex.exec(attrs);
      while (attrMatch) {
        const name = attrMatch[1].toLowerCase();
        if (!SAFE_LAYOUT_ATTRS.has(name)) return false;
        attrMatch = attrRegex.exec(attrs);
      }
    }
    match = tagRegex.exec(trimmed);
  }

  return true;
}

function sanitizeLayoutOverrides(currentLayouts, overrides) {
  if (!Array.isArray(overrides)) return null;
  const byId = new Map(currentLayouts.map((layout) => [layout?.slideIntentId, layout]));
  const seen = new Set();
  const sanitized = [];
  for (const item of overrides) {
    if (!item || typeof item !== "object") return null;
    const slideIntentId = typeof item.slideIntentId === "string" ? item.slideIntentId : "";
    if (!slideIntentId || !byId.has(slideIntentId) || seen.has(slideIntentId)) return null;
    const layoutHtml = typeof item.layoutHtml === "string" ? item.layoutHtml : "";
    if (!layoutHtml || !isSafeLayoutHtml(layoutHtml)) return null;
    sanitized.push({ ...byId.get(slideIntentId), layoutHtml });
    seen.add(slideIntentId);
  }
  if (sanitized.length !== currentLayouts.length) return null;
  return sanitized;
}

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
        const sanitizedLayouts = sanitizeLayoutOverrides(layouts, layoutConfirmResult.layouts);
        if (sanitizedLayouts) {
          layouts.splice(0, layouts.length, ...sanitizedLayouts);
          loop._blackboard?.logDecision("layout_edited", "User modified layouts");
        }
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
