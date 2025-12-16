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

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function toNonEmptyString(v) {
  if (v === undefined || v === null) return "";
  const s = String(v).trim();
  return s.length ? s : "";
}

function safeInt(n) {
  return typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : null;
}

function safeNumber(n) {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function stripThinkingTags(text) {
  // Remove <think>...</think> blocks (some models emit them)
  return String(text || "").replace(/<think>[\s\S]*?<\/think>/gi, "");
}

function extractJsonCandidate(text) {
  const s = stripThinkingTags(text).trim();
  if (!s) return null;

  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced && fenced[1]) return fenced[1].trim();

  const firstBrace = s.indexOf("{");
  const lastBrace = s.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) return s.slice(firstBrace, lastBrace + 1);

  const firstBracket = s.indexOf("[");
  const lastBracket = s.lastIndexOf("]");
  if (firstBracket >= 0 && lastBracket > firstBracket) return s.slice(firstBracket, lastBracket + 1);

  return s;
}

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

const LEVEL_1_TOOLS = ["getSlideContent", "getSlideContext", "screenshot", "editSlide", "editElement"];
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
 * @param {{qualityScore: number, remainingIssues: number}} finish
 * @returns {{accepted: boolean, reason?: string}}
 */
function validateFinishConditions(finish) {
  const score = safeNumber(finish?.qualityScore);
  const issues = safeInt(finish?.remainingIssues);

  if (score === null || issues === null) return { accepted: false, reason: "Invalid finish data" };
  if (score < 7) return { accepted: false, reason: `Quality score ${score} below minimum 7` };
  if (issues > 3) return { accepted: false, reason: `Remaining issues ${issues} exceeds maximum 3` };
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

function buildReactPrompt({ deckPackage, designSystem, availableTools, previousSteps, recommendedSteps, stepIndex, mode }) {
  const systemContent = `你是“视觉设计审阅专家”，使用 ReAct（Reason + Act）迭代精修幻灯片 deck。

你的职责：
- 审查每页：布局网格、对齐、留白、层级、排版（字号/行高/字重）、颜色一致性
- 检查图片/SVG 占位符：是否缺失、比例不匹配、遮罩/圆角/滤镜是否一致
- 确保 deck HTML DSL 合规：元素坐标使用 percent、不要引入未知标签/属性、避免溢出安全区

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
    "refinements": [ ... ]
  }
}

AVAILABLE TOOLS (${mode}): ${availableTools.join(", ")}

FINISH CONDITIONS：
- qualityScore >= 7
- remainingIssues <= 3

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
 * @param {object} options
 * @param {number} [options.recommendedSteps=5]
 * @param {number} [options.hardLimit=15]
 * @param {Function} options.toolExecutor - async (toolName, params) => {success, data?, error?}
 * @param {"generation"|"edit"} [options.mode="generation"]
 * @param {Function} [options.onStep]
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
    });

    const startTime = Date.now();
    let modelResp;
    try {
      modelResp = await aiApiService.chat({
        messages,
        temperature: 0.2,
        maxTokens: 2000,
      });
    } catch (err) {
      emit?.("design.refine.step", { stepIndex, error: String(err?.message || err), phase: "model_call" }, { status: "error" });
      throw err;
    }

    const rawContent = modelResp?.content || "";
    const candidate = extractJsonCandidate(rawContent);

    let parsedStep = null;
    let parseError = null;
    if (candidate) {
      try {
        parsedStep = JSON.parse(candidate);
      } catch (err) {
        parseError = `JSON parse failed: ${err.message}`;
      }
    } else {
      parseError = "No JSON candidate found in model output";
    }

    // Retry once on parse error
    if (parseError) {
      try {
        const retryResp = await aiApiService.chat({
          messages: [{ role: "system", content: "只返回严格 JSON，不要输出任何多余文本。" }, ...messages],
          temperature: 0.1,
          maxTokens: 2000,
        });
        const retryCandidate = extractJsonCandidate(retryResp?.content || "");
        if (retryCandidate) {
          parsedStep = JSON.parse(retryCandidate);
          parseError = null;
        }
      } catch (err) {
        parseError = parseError || `Retry failed: ${err.message}`;
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
      emit?.("design.refine.step", { stepIndex, observation, duration: Date.now() - startTime });
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
      emit?.("design.refine.step", { stepIndex, thought: parsedStep?.thought, observation, duration: Date.now() - startTime }, { status: "warn" });
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
        emit?.("design.refine.step", { stepIndex, thought, tool: toolName, params, result: observation, duration: Date.now() - startTime }, { status: "warn" });
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

      emit?.("design.refine.step", { stepIndex, thought, tool: toolName, params, result: toolResult, duration: Date.now() - startTime });
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
        emit?.("design.refine.step", { stepIndex, thought, finish: parsedStep.finish, observation, duration: Date.now() - startTime }, { status: "warn" });
        emit?.(
          "design.refine.finish_rejected",
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
      emit?.("design.refine.step", { stepIndex, thought, finish: finalFinish, accepted: true, duration: Date.now() - startTime });

      emit?.("design.refine.finish_accepted", {
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
    emit?.("design.refine.hard_limit", { stepCount: steps.length, hardLimit }, { status: "warn" });
    finalFinish = { qualityScore: 6, remainingIssues: 99, refinements: [] };
  }

  return {
    finalDeck: currentDeck,
    steps,
    qualityScore: finalFinish.qualityScore,
    toolCalls,
    terminationReason: finalFinish.qualityScore >= 7 && finalFinish.remainingIssues <= 3 ? "quality_met" : "hard_limit",
  };
}

export const __test = {
  getAvailableTools,
  validateStepSchema,
  validateFinishConditions,
  TOOL_REGISTRY,
};
