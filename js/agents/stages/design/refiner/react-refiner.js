/**
 * Design Stage - ReAct Refiner
 *
 * Iterative visual refinement loop (Reason → Act → Observe) for a generated deck.
 *
 * Tools:
 * - generation (Level 1): getSlideContent, getSlideContext, screenshot, editSlide, editElement
 * - edit (Level 2): Level 1 + addSlide, deleteSlide, reorderSlides, diff, revert, saveCheckpoint
 *
 * Finish conditions:
 * - qualityScore >= 7
 * - remainingIssues <= 3
 */

import { robustParseJson } from "../../../shared/index.js";
import { injectSystemHint } from "../../../shared/index.js";
import { extractJsonCandidate } from "../../../shared/index.js";

import {
  isPlainObject,
  toNonEmptyString,
  safeInt,
  safeNumber,
} from "../shared/design-utils.js";

function checkCancelled(stageApi) {
  if (typeof stageApi?.checkCancelled === "function") stageApi.checkCancelled();
  if (stageApi?.signal?.aborted) {
    const reason = stageApi.signal.reason;
    throw new Error(typeof reason === "string" ? reason : "Run cancelled");
  }
}

function makeStageEmitter(stageApi, actor = "design") {
  const emitFn = stageApi?.emit || stageApi?.eventBus?.emit;
  if (typeof emitFn !== "function") return null;
  return (name, payload, { status = "completed" } = {}) => emitFn.call(stageApi?.eventBus || null, name, { actor, status, payload });
}

const LEVEL_1_TOOLS = ["getSlideContent", "getSlideContext", "screenshot", "screenshotAll", "editSlide", "editElement"];
const LEVEL_2_TOOLS = [...LEVEL_1_TOOLS, "addSlide", "deleteSlide", "reorderSlides", "diff", "revert", "saveCheckpoint"];

export const TOOL_REGISTRY = {
  generation: LEVEL_1_TOOLS,
  edit: LEVEL_2_TOOLS,
};

/**
 * Determines available tools based on mode.
 * @param {"generation"|"edit"} mode
 * @returns {string[]}
 */
function getAvailableTools(mode) {
  const m = String(mode || "generation").trim().toLowerCase();
  if (m === "edit") return TOOL_REGISTRY.edit;
  return TOOL_REGISTRY.generation;
}

/**
 * Validates step schema from model output.
 * @param {any} step - Parsed JSON step
 * @returns {{valid: boolean, error?: string}}
 */
function validateStepSchema(step) {
  if (!isPlainObject(step)) return { valid: false, error: "Step must be a JSON object" };

  const hasAction = isPlainObject(step.action);
  const hasFinish = isPlainObject(step.finish);
  if (hasAction && hasFinish) return { valid: false, error: "Step cannot have both 'action' and 'finish'" };
  if (!hasAction && !hasFinish) return { valid: false, error: "Step must have either 'action' or 'finish'" };

  if (hasAction) {
    if (!toNonEmptyString(step.action.tool)) return { valid: false, error: "Action must specify 'tool' name" };
    if (!isPlainObject(step.action.params)) return { valid: false, error: "Action must provide 'params' object" };
  }

  if (hasFinish) {
    const score = safeNumber(step.finish.qualityScore);
    if (score === null || score < 1 || score > 10) return { valid: false, error: "Finish qualityScore must be 1-10" };

    const issues = safeInt(step.finish.remainingIssues);
    if (issues === null || issues < 0) return { valid: false, error: "Finish remainingIssues must be >= 0" };

    if (!Array.isArray(step.finish.refinements)) return { valid: false, error: "Finish must include refinements array" };
  }

  return { valid: true };
}

/**
 * Checks if finish conditions meet quality bar.
 * AI 自主决定何时完成，只验证数据格式有效性。
 * @param {{qualityScore: number, remainingIssues: number, confidence?: string}} finish
 * @returns {{accepted: boolean, reason?: string}}
 */
function validateFinishConditions(finish) {
  const score = safeNumber(finish?.qualityScore);
  const issues = safeInt(finish?.remainingIssues);

  if (score === null || issues === null) return { accepted: false, reason: "Invalid finish data" };
  // AI 自主决定质量是否达标，不再硬编码阈值
  // 只要 AI 认为可以结束（提供了有效的 finish），就接受
  return { accepted: true };
}

function summarizeDesignSystem(designSystem) {
  const tokens = isPlainObject(designSystem?.designTokens) ? designSystem.designTokens : {};
  const colors = isPlainObject(tokens.colors) ? tokens.colors : {};
  const typography = isPlainObject(tokens.typography) ? tokens.typography : {};

  const theme = toNonEmptyString(designSystem?.theme);
  const colorSummary = {
    background: isPlainObject(colors.background) ? colors.background : undefined,
    text: isPlainObject(colors.text) ? colors.text : undefined,
    accent: isPlainObject(colors.accent) ? colors.accent : undefined,
    border: colors.border,
  };

  const typoSummary = {
    fontFamily: typography.fontFamily,
    scale: isPlainObject(typography.scale) ? typography.scale : undefined,
    lineHeight: typography.lineHeight,
  };

  const constraints = isPlainObject(tokens.constraints) ? tokens.constraints : isPlainObject(designSystem?.constraints) ? designSystem.constraints : undefined;

  return {
    ...(theme ? { theme } : {}),
    colors: colorSummary,
    typography: typoSummary,
    ...(constraints ? { constraints } : {}),
  };
}

function summarizeDeck(deckPackage) {
  const slidesMeta = Array.isArray(deckPackage?.slidesMeta) ? deckPackage.slidesMeta : [];
  const imageSlots = Array.isArray(deckPackage?.imageSlots) ? deckPackage.imageSlots : [];

  const types = new Map();
  for (const m of slidesMeta) {
    const t = toNonEmptyString(m?.pageType) || "unknown";
    types.set(t, (types.get(t) || 0) + 1);
  }

  const imagesBySlide = new Map();
  for (const s of imageSlots) {
    const idx = Number.isFinite(s?.slideIndex) ? s.slideIndex : null;
    if (idx === null) continue;
    imagesBySlide.set(idx, (imagesBySlide.get(idx) || 0) + 1);
  }

  const slides = slidesMeta.map((m) => ({
    slideNo: Number.isFinite(m?.slideNo) ? m.slideNo : undefined,
    slideIntentId: toNonEmptyString(m?.slideIntentId) || undefined,
    pageType: toNonEmptyString(m?.pageType) || undefined,
    title: toNonEmptyString(m?.title) || undefined,
    degraded: !!m?.degraded,
    imageSlots: imagesBySlide.get((Number.isFinite(m?.slideNo) ? m.slideNo - 1 : -1)) || 0,
  }));

  return {
    slideCount: slidesMeta.length,
    types: Object.fromEntries([...types.entries()].sort((a, b) => b[1] - a[1])),
    imageSlotCount: imageSlots.length,
    slides,
  };
}

function buildReactPrompt({ deckPackage, designSystem, availableTools, previousSteps, recommendedSteps, stepIndex, mode, systemPromptOverride }) {
  const systemContent = systemPromptOverride || `你是"视觉设计审阅专家"，使用 ReAct（Reason + Act）迭代精修幻灯片 deck。

你的职责：
1. **首先调用 screenshotAll** 获取所有页面缩略图，整体评估视觉质量和风格一致性
2. 审查每页：布局网格、对齐、留白、层级、排版（字号/行高/字重）、颜色一致性
3. 检查 SVG 图表：数据是否正确显示、样式是否与整体风格统一、是否有渲染错误
4. 检查图片：位置是否合适、大小比例是否协调、是否需要微调
5. 确保 deck HTML DSL 合规：元素坐标使用 percent、不要引入未知标签/属性、避免溢出安全区

修复能力：
- 使用 editElement 修改 SVG 内容（通过 html 参数）、调整元素位置/大小（通过 style 参数）
- 使用 editSlide 修改整页布局或背景
- 使用 screenshot 查看单页详细效果

STEP SCHEMA（只返回严格 JSON，不要输出任何额外文本）：
{
  "thought": "...",
  "action": { "tool": "...", "params": { ... } }
}
或：
{
  "thought": "...",
  "finish": {
    "qualityScore": 8.5,
    "remainingIssues": 1,
    "confidence": "high",
    "refinements": [ ... ]
  }
}

AVAILABLE TOOLS (${mode}): ${availableTools.join(", ")}

FINISH CONDITIONS：
- 你自主判断何时质量达标，无硬编码阈值
- 当所有页面美观、风格统一、无明显问题时即可 finish
- qualityScore 反映你的主观评分（1-10），remainingIssues 是剩余问题数

GUIDANCE：建议 ${recommendedSteps} 步，你现在是第 ${stepIndex} 步；达标就尽快 finish，否则继续修。`;

  const deckSummary = summarizeDeck(deckPackage);
  const designSummary = summarizeDesignSystem(designSystem);
  const history = (Array.isArray(previousSteps) ? previousSteps : []).map((s) => ({
    step: safeInt(s?.stepIndex) ?? undefined,
    thought: s?.thought,
    action: s?.action || null,
    finish: s?.finish || null,
    observation: s?.observation || null,
  }));

  const userContent = JSON.stringify(
    {
      deck: deckSummary,
      designSystem: designSummary,
      history,
      availableTools,
    },
    null,
    2
  );

  return [
    { role: "system", content: systemContent },
    { role: "user", content: userContent },
  ];
}

function normalizeToolResultToDeck(deckPackage, toolResult) {
  if (!toolResult || !toolResult.success) return { deckPackage, changed: false };

  // Common patterns: {data: deckPackage} | {data:{deckPackage}} | {deckPackage} | {data:{finalDeck}}
  const candidates = [
    toolResult?.data,
    toolResult?.data?.deckPackage,
    toolResult?.deckPackage,
    toolResult?.data?.finalDeck,
    toolResult?.finalDeck,
  ].filter(Boolean);

  for (const c of candidates) {
    if (isPlainObject(c) && (typeof c.deckHtmlDsl === "string" || Array.isArray(c.slidesMeta) || Array.isArray(c.imageSlots))) {
      return { deckPackage: c, changed: true };
    }
  }

  // Some tools may return a partial update
  const next = isPlainObject(toolResult?.data) ? toolResult.data : null;
  if (next && typeof next.deckHtmlDsl === "string") {
    return { deckPackage: { ...(deckPackage || {}), deckHtmlDsl: next.deckHtmlDsl }, changed: true };
  }

  return { deckPackage, changed: false };
}

/**
 * Main ReAct refiner loop.
 *
 * @param {object} deckPackage - { deckHtmlDsl, slidesMeta, designSystem, imageSlots }
 * @param {object} context - { contentPackage, runContext, stageApi }
 * @param {object} [options]
 * @param {number} [options.recommendedSteps=5]
 * @param {number} [options.hardLimit=15]
 * @param {Function} [options.toolExecutor] - async (toolName, params) => {success, data?, error?}
 * @param {"generation"|"edit"} [options.mode="generation"]
 * @param {Function} [options.onStep]
 * @param {string} [options.systemPromptOverride]
 * @returns {Promise<{finalDeck: object, steps: object[], qualityScore: number, toolCalls: object[], terminationReason: string}>}
 */
export async function runReactRefiner(deckPackage, context, options = {}) {
  if (!isPlainObject(deckPackage)) throw new TypeError("runReactRefiner: deckPackage must be an object");
  if (!isPlainObject(context)) throw new TypeError("runReactRefiner: context must be an object");
  if (typeof options.toolExecutor !== "function") throw new TypeError("runReactRefiner: options.toolExecutor must be a function");

  const recommendedSteps = safeInt(options.recommendedSteps) ?? 5;
  const hardLimit = safeInt(options.hardLimit) ?? 15;
  const toolExecutor = options.toolExecutor;
  const onStep = typeof options.onStep === "function" ? options.onStep : null;
  const mode = String(options.mode || "generation").trim().toLowerCase() === "edit" ? "edit" : "generation";

  const stageApi = context.stageApi || {};
  const emit = makeStageEmitter(stageApi, "design");
  const aiApiService = stageApi?.aiApiService || context?.runContext?.aiApiService || context?.aiApiService;
  const systemHint = stageApi?.runtimeHints?.system || context?.runtimeHints?.system;
  if (!aiApiService || typeof aiApiService.chat !== "function") {
    throw new Error("runReactRefiner: stageApi.aiApiService.chat is required");
  }

  let currentDeck = deckPackage;
  const steps = [];
  const toolCalls = [];
  let finalFinish = null;

  for (let stepIndex = 1; stepIndex <= hardLimit; stepIndex++) {
    checkCancelled(stageApi);

    const availableTools = getAvailableTools(mode);
    const messages = buildReactPrompt({
      deckPackage: currentDeck,
      designSystem: currentDeck?.designSystem,
      availableTools,
      previousSteps: steps,
      recommendedSteps,
      stepIndex,
      mode,
      systemPromptOverride: options.systemPromptOverride,
    });
    const hintedMessages = injectSystemHint(messages, systemHint);

    const startTime = Date.now();
    let modelResp;
    try {
      modelResp = await aiApiService.chat({
        messages: hintedMessages,
        temperature: 0.2,
        maxTokens: 8000,
      });
    } catch (err) {
      emit?.("design:refine.step", { stepIndex, error: String(err?.message || err), phase: "model_call" }, { status: "error" });
      throw err;
    }

    const rawContent = modelResp?.content || "";
    const candidate = extractJsonCandidate(rawContent, { prefer: "object" });

    let parsedStep = null;
    let parseError = null;
    if (candidate) {
      try {
        parsedStep = robustParseJson(candidate);
        if (!isPlainObject(parsedStep)) parseError = "JSON parse failed";
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        parseError = `JSON parse failed: ${msg}`;
      }
    } else {
      parseError = "No JSON candidate found in model output";
    }

    // Retry once on parse error
    if (parseError) {
      try {
        const retryResp = await aiApiService.chat({
          messages: [...hintedMessages, { role: "user", content: "上一次输出不是有效 JSON。只返回严格 JSON，不要输出任何多余文本。" }],
          temperature: 0.1,
          maxTokens: 8000,
        });
        const retryCandidate = extractJsonCandidate(retryResp?.content || "", { prefer: "object" });
        if (retryCandidate) {
          try {
            parsedStep = robustParseJson(retryCandidate);
            if (!isPlainObject(parsedStep)) parseError = "Retry JSON parse failed";
            else parseError = null;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            parseError = `Retry JSON parse failed: ${msg}`;
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        parseError = parseError || `Retry failed: ${msg}`;
      }
    }

    if (parseError || !parsedStep) {
      const observation = {
        success: false,
        error: parseError || "Unknown parse error",
        rawOutput: String(rawContent || "").slice(0, 400),
        availableTools,
        mode,
      };
      steps.push({ stepIndex, thought: undefined, observation, duration: Date.now() - startTime });
      emit?.("design:refine.step", { stepIndex, observation, duration: Date.now() - startTime });
      onStep?.({ stepIndex, observation });
      continue;
    }

    const validation = validateStepSchema(parsedStep);
    if (!validation.valid) {
      const observation = {
        success: false,
        error: `Validation failed: ${validation.error}`,
        step: parsedStep,
        availableTools,
        mode,
      };
      steps.push({ stepIndex, thought: parsedStep?.thought, observation, duration: Date.now() - startTime });
      emit?.("design:refine.step", { stepIndex, thought: parsedStep?.thought, observation, duration: Date.now() - startTime }, { status: "warn" });
      onStep?.({ stepIndex, thought: parsedStep?.thought, observation });
      continue;
    }

    const thought = parsedStep.thought;
    const hasAction = isPlainObject(parsedStep.action);
    const hasFinish = isPlainObject(parsedStep.finish);

    if (hasAction) {
      const toolName = parsedStep.action.tool;
      const params = parsedStep.action.params;

      if (!availableTools.includes(toolName)) {
        const observation = {
          success: false,
          error: `Tool '${toolName}' not available in mode '${mode}'. Available: ${availableTools.join(", ")}`,
          availableTools,
          mode,
        };
        steps.push({
          stepIndex,
          thought,
          action: { tool: toolName, params },
          observation,
          duration: Date.now() - startTime,
        });
        emit?.("design:refine.step", { stepIndex, thought, tool: toolName, params, result: observation, duration: Date.now() - startTime }, { status: "warn" });
        onStep?.({ stepIndex, thought, action: parsedStep.action, observation });
        continue;
      }

      let toolResult;
      try {
        toolResult = await toolExecutor(toolName, params);
      } catch (err) {
        toolResult = { success: false, error: `Tool execution failed: ${err.message}` };
      }

      toolCalls.push({
        stepIndex,
        tool: toolName,
        params,
        result: toolResult,
        timestamp: new Date().toISOString(),
      });

      const normalized = normalizeToolResultToDeck(currentDeck, toolResult);
      if (normalized.changed) currentDeck = normalized.deckPackage;

      const observation = { ...toolResult, availableTools, mode };
      steps.push({
        stepIndex,
        thought,
        action: { tool: toolName, params },
        observation,
        duration: Date.now() - startTime,
      });

      emit?.("design:refine.step", { stepIndex, thought, tool: toolName, params, result: toolResult, duration: Date.now() - startTime });
      onStep?.({ stepIndex, thought, action: parsedStep.action, observation });
    }

    if (hasFinish) {
      const finishValidation = validateFinishConditions(parsedStep.finish);
      if (!finishValidation.accepted) {
        const observation = {
          success: false,
          error: `Finish rejected: ${finishValidation.reason}. Continue refining.`,
          availableTools,
          mode,
        };
        steps.push({
          stepIndex,
          thought,
          finish: parsedStep.finish,
          observation,
          duration: Date.now() - startTime,
        });
        emit?.("design:refine.step", { stepIndex, thought, finish: parsedStep.finish, observation, duration: Date.now() - startTime }, { status: "warn" });
        emit?.(
          "design:refine.finish_rejected",
          { stepIndex, thought, finish: parsedStep.finish, reason: finishValidation.reason, duration: Date.now() - startTime },
          { status: "warn" }
        );
        onStep?.({ stepIndex, thought, finish: parsedStep.finish, observation });
        continue;
      }

      finalFinish = parsedStep.finish;
      steps.push({
        stepIndex,
        thought,
        finish: finalFinish,
        accepted: true,
        duration: Date.now() - startTime,
      });
      emit?.("design:refine.step", { stepIndex, thought, finish: finalFinish, accepted: true, duration: Date.now() - startTime });

      emit?.("design:refine.finish_accepted", {
        stepIndex,
        thought,
        qualityScore: finalFinish.qualityScore,
        remainingIssues: finalFinish.remainingIssues,
        refinementsCount: Array.isArray(finalFinish.refinements) ? finalFinish.refinements.length : 0,
        duration: Date.now() - startTime,
      });
      onStep?.({ stepIndex, thought, finish: finalFinish, accepted: true });
      break;
    }
  }

  if (!finalFinish) {
    emit?.("design:refine.hard_limit", { stepCount: steps.length, hardLimit }, { status: "warn" });
    finalFinish = { qualityScore: 6, remainingIssues: 99, refinements: [], aiDecided: false };
  }

  return {
    finalDeck: currentDeck,
    steps,
    qualityScore: finalFinish.qualityScore,
    toolCalls,
    // AI 主动 finish 就是 quality_met，达到 hardLimit 才是 hard_limit
    terminationReason: finalFinish.aiDecided !== false ? "quality_met" : "hard_limit",
  };
}

export const __test = {
  getAvailableTools,
  validateStepSchema,
  validateFinishConditions,
  TOOL_REGISTRY,
};
