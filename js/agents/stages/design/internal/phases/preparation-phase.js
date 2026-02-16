import { checkCancelled } from "../../../../runtime/index.js";
import { DesignPhase } from "../../states.js";
import { emitStage } from "../../design-helpers.js";
import { runWithPhaseSpan } from "./phase-utils.js";

const ALLOWED_THEMES = new Set(["light", "dark", "colorful", "auto"]);
const MAX_FONT_FAMILY_LENGTH = 100;
const MAX_COLOR_SCHEME_LENGTH = 40;

function normalizeTheme(theme, fallback) {
  const t = typeof theme === "string" ? theme.toLowerCase().trim() : "";
  return ALLOWED_THEMES.has(t) ? t : fallback;
}

function isHexColor(s) {
  return typeof s === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s.trim());
}

function isRgbaColor(s) {
  if (typeof s !== "string") return false;
  const t = s.trim();
  const m = t.match(/^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(0|1|0?\.\d+)\s*\)$/i);
  if (!m) return false;
  const r = Number(m[1]);
  const g = Number(m[2]);
  const b = Number(m[3]);
  const a = Number(m[4]);
  return r >= 0 && r <= 255 && g >= 0 && g <= 255 && b >= 0 && b <= 255 && a >= 0 && a <= 1;
}

function isColorToken(s) {
  return isHexColor(s) || isRgbaColor(s);
}

function normalizeColorScheme(value, fallback) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim().slice(0, MAX_COLOR_SCHEME_LENGTH);
  if (!trimmed) return fallback;
  if (isColorToken(trimmed)) return trimmed;
  if (/^[a-z0-9\- ]+$/i.test(trimmed)) return trimmed;
  return fallback;
}

function normalizeAccentColor(value, fallback) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return isColorToken(trimmed) ? trimmed : fallback;
}

function normalizeFontFamily(value, fallback) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim().slice(0, MAX_FONT_FAMILY_LENGTH);
  if (!trimmed) return fallback;
  return /^[a-z0-9 ,"'\\-]+$/i.test(trimmed) ? trimmed : fallback;
}

/**
 * @typedef {(name: string, event: any) => void} EmitFn
 */

/**
 * @typedef {(stepName: string, input: any) => Promise<{ loopIteration: any, stepInfo: { context: any } }>} StartExecutionFn
 */

/**
 * @typedef {(stepName: string, loopIteration: any, stepInfo: any) => Promise<void>} FinishExecutionFn
 */

/**
 * 准备阶段：解析大纲 + 提取样式
 *
 * @param {any} loop
 * @param {{ contentPackage?: any, context: any, runContext: any, emit?: EmitFn, startExecution: StartExecutionFn, finishExecution: FinishExecutionFn, traceContext?: any }} params
 * @returns {Promise<{ parsedContentPackage: any, slideIntents: any[], designSystem: any, constraints: any, userConfig: any }>}
 */
export async function runPreparationPhase(loop, {
  contentPackage,
  context,
  runContext,
  emit,
  startExecution,
  finishExecution,
  traceContext,
}) {
  const resolvedContentPackage = contentPackage || loop.state?.contentPackage || context?.contentPackage || null;
  const runId = runContext?.runId;
  const slideCount = Array.isArray(resolvedContentPackage?.slideIntents)
    ? resolvedContentPackage.slideIntents.length
    : 0;

  const runPhase = async () => {
    // Outline parsing
    loop.phaseRunner._transitionPhase(loop.phase, DesignPhase.OUTLINE_PARSING, { emit, runId });
    checkCancelled(context.signal);

    const outlineResult = await loop.toolDispatch._callTool("parse_outline", { contentPackage: resolvedContentPackage }, context);
    if (!outlineResult.ok) throw new Error(outlineResult.error || "parse_outline failed");
    const outlineData = outlineResult.data || {};
    const parsedContentPackage = outlineData.contentPackage || resolvedContentPackage;
    let slideIntents = Array.isArray(outlineData.slideIntents)
      ? outlineData.slideIntents
      : Array.isArray(parsedContentPackage?.slideIntents)
        ? parsedContentPackage.slideIntents
        : [];

    // Outline confirmation
    loop.phaseRunner._transitionPhase(loop.phase, DesignPhase.OUTLINE_CONFIRMING, { emit, runId });
    if (context?.interactionMode?.outlineConfirm && context.interactionMode.outlineConfirm !== "skip") {
      const outlineConfirm = await loop.userActionHandler.waitForUserAction("confirm_outline", { eventBus: context.eventBus, signal: context.signal });
      if (Array.isArray(outlineConfirm?.slideIntents)) slideIntents = outlineConfirm.slideIntents;
    }

    if (slideIntents.length === 0) throw new Error("DesignAgentLoop: contentPackage.slideIntents is required");

    // Style extraction
    loop.phaseRunner._transitionPhase(loop.phase, DesignPhase.STYLE_EXTRACTING, { emit, runId });
    checkCancelled(context.signal);

    const constraints = runContext?.constraints || {};
    let userConfig =
      (runContext && typeof runContext === "object" ? runContext.userConfig : undefined) ||
      (resolvedContentPackage && typeof resolvedContentPackage === "object" ? resolvedContentPackage.userConfig : undefined) ||
      (context && typeof context === "object" ? context.userConfig : undefined) ||
      {};
    if (typeof loop.messageHandling?.applyUserInputsToConfig === "function") {
      userConfig = loop.messageHandling.applyUserInputsToConfig(userConfig);
    }

    const { loopIteration: styleIteration, stepInfo: styleStep } = await startExecution("style_extracting", {
      contentPackage: parsedContentPackage,
      slideIntents,
      constraints,
      userConfig,
    });
    const styleContext = styleStep.context;
    const styleResult = await loop.toolDispatch._callTool("extract_style", { contentPackage: parsedContentPackage, constraints, userConfig }, styleContext);
    if (!styleResult.ok) throw new Error(styleResult.error || "extract_style failed");
    const designSystem = styleResult.data?.designSystem || styleResult.data;

    emitStage(emit, "design.tokens.ended", "ended", { theme: designSystem?.theme });
    checkCancelled(styleContext.signal);

    await finishExecution("style_extracting", styleIteration, styleStep);

    // Style confirmation with full designTokens preview
    loop.phaseRunner._transitionPhase(loop.phase, DesignPhase.STYLE_CONFIRMING, { emit, runId });

    // Emit style preview for UI
    emitStage(emit, "design.style.preview", "awaiting_confirm", {
      runId,
      designSystem,
      designTokens: {
        theme: designSystem?.theme,
        colorScheme: designSystem?.colorScheme,
        fontFamily: designSystem?.fontFamily,
        accentColor: designSystem?.accentColor,
      },
      slideCount: slideIntents.length,
    });

    if (context?.interactionMode?.styleConfirm && context.interactionMode.styleConfirm !== "skip") {
      const styleConfirmResult = await loop.userActionHandler.waitForUserAction("confirm_style", { eventBus: context.eventBus, signal: context.signal });

      // Apply user overrides if provided
      if (styleConfirmResult && typeof styleConfirmResult === "object") {
        const overrides = {};
        const nextTheme = normalizeTheme(styleConfirmResult.theme, designSystem.theme);
        const nextColorScheme = normalizeColorScheme(styleConfirmResult.colorScheme, designSystem.colorScheme);
        const nextFontFamily = normalizeFontFamily(styleConfirmResult.fontFamily, designSystem.fontFamily);
        const nextAccentColor = normalizeAccentColor(styleConfirmResult.accentColor, designSystem.accentColor);

        if (nextColorScheme && nextColorScheme !== designSystem.colorScheme) {
          designSystem.colorScheme = nextColorScheme;
          overrides.colorScheme = nextColorScheme;
        }
        if (nextFontFamily && nextFontFamily !== designSystem.fontFamily) {
          designSystem.fontFamily = nextFontFamily;
          overrides.fontFamily = nextFontFamily;
        }
        if (nextAccentColor && nextAccentColor !== designSystem.accentColor) {
          designSystem.accentColor = nextAccentColor;
          overrides.accentColor = nextAccentColor;
        }
        if (nextTheme && nextTheme !== designSystem.theme) {
          designSystem.theme = nextTheme;
          overrides.theme = nextTheme;
        }

        // Log override to blackboard
        if (Object.keys(overrides).length > 0) {
          loop._blackboard?.logDecision("style_override", "User modified design tokens", { overrides });
        }
      }
    }

    return {
      parsedContentPackage,
      slideIntents,
      designSystem,
      constraints,
      userConfig,
    };
  };

  const prepResult = await runWithPhaseSpan(
    traceContext,
    "design.phase.preparation",
    { runId, slideCount },
    runPhase
  );

  if (loop.state && typeof loop.state === "object") {
    loop.state.contentPackage = prepResult.parsedContentPackage;
    loop.state.slideIntents = prepResult.slideIntents;
    loop.state.designSystem = prepResult.designSystem;
    loop.state.constraints = prepResult.constraints;
    loop.state.userConfig = prepResult.userConfig;
  }

  loop._blackboard?.setSummary("outline", `${prepResult.slideIntents.length} slides parsed`);
  loop._blackboard?.setSummary("style", prepResult.designSystem?.theme || "default");
  loop._blackboard?.logDecision("preparation_complete", `Parsed ${prepResult.slideIntents.length} slides`);

  return prepResult;
}
