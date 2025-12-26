import { generateDesignTokens } from "./generators/design-tokens.js";
import { generateDesignSystem } from "./generators/design-system-generator.js";
import { buildSlideHtml } from "./dsl/dsl-builder.js";
import { generateBatch } from "./generators/batch-generator.js";
import { validateSlide } from "./refiner/qa-validator.js";
import { fillImagePlaceholders } from "./generators/image-generator.js";
import { SVGGenerator, fillSvgPlaceholders } from "./generators/svg-generator.js";
import { fillAssetPlaceholders } from "./image/asset-resolver.js";
import { VisualRenderer } from "./image/visual-renderer.js";
import { getDslRules } from "./dsl/dsl-rules.js";
import { ImagePlanner } from "./image/image-planner.js";
import { normalizeRenderType } from "../../shared/utils/value-utils.js";
import { Archive, MapAdapter } from "../../shared/archive/archive.js";
import { CheckpointType, createCheckpoint, migrateCheckpoint } from "../../shared/archive/checkpoint-schema.js";
import { DesignPhase, designPhaseMachine } from "./states.js";
import { AgentStatus } from "../../runtime/core/agent-status.js";
import { BaseAgentLoop, checkCancelled, getEmitFn, resolveToolExecutor } from "../../runtime/core/agent-loop.js";
import { StagePausedError } from "../../runtime/core/stage-errors.js";
import { getRuntimeState } from "../../runtime/telemetry/loop-runtime-state.js";

const SCHEMA_VERSION = "0.1";

export const DESIGN_AGENT_TOOL_DEFINITIONS = Object.freeze([
  {
    name: "parse_outline",
    description: "Parse source content into slide intents.",
    parameters: {
      type: "object",
      properties: {
        contentPackage: { type: "object" },
      },
    },
  },
  {
    name: "extract_style",
    description: "Extract or generate design system from inputs.",
    parameters: {
      type: "object",
      properties: {
        contentPackage: { type: "object" },
        constraints: { type: "object" },
        userConfig: { type: "object" },
      },
    },
  },
  {
    name: "spawn_slide_agent",
    description: "Generate slide HTML DSL in parallel batches.",
    parameters: {
      type: "object",
      properties: {
        slideIntents: { type: "array" },
        contentPackage: { type: "object" },
        designSystem: { type: "object" },
      },
    },
  },
  {
    name: "take_screenshot",
    description: "Capture slide screenshots for review.",
    parameters: {
      type: "object",
      properties: {
        slideIndex: { type: "number" },
      },
    },
  },
  {
    name: "fix_slide",
    description: "Apply fixes to a slide based on review feedback.",
    parameters: {
      type: "object",
      properties: {
        slideIndex: { type: "number" },
        issues: { type: "array" },
      },
    },
  },
  {
    name: "fill_visual",
    description: "Fill visuals (images/SVG/assets) for slides.",
    parameters: {
      type: "object",
      properties: {
        visualSlots: { type: "array" },
      },
    },
  },
  {
    name: "chat_ask",
    description: "Ask user for feedback or confirmation.",
    parameters: {
      type: "object",
      properties: {
        message: { type: "string" },
        actionName: { type: "string" },
      },
      required: ["message"],
    },
  },
]);

function emitStage(emit, name, status, payload) {
  emit?.(name, { actor: "design", status, payload });
}

function hasImagePlanningConfig(constraints) {
  if (!constraints || typeof constraints !== "object") return false;
  return Object.prototype.hasOwnProperty.call(constraints, "imagePolicy") || Object.prototype.hasOwnProperty.call(constraints, "imageBudget");
}

function estimateSlotCostUSD(slot) {
  const style = String(slot?.style || "").toLowerCase();
  if (style.includes("3d") || style.includes("photo") || style.includes("hd") || style.includes("cinematic")) return 0.04;
  return 0.003;
}

function loadDesignConcurrencyConfig() {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem("ppt_designConcurrency") : null;
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return null;
}

export class DesignAgentLoop extends BaseAgentLoop {
  constructor({ batchSize, archive, eventBus, tools } = {}) {
    super({ actor: "design", stageName: "design", eventBus });
    const config = loadDesignConcurrencyConfig();
    const defaultBatchSize = config?.batchSize || 4;
    this.batchSize = Math.max(1, Number(batchSize) || defaultBatchSize);
    this.batchConcurrency = Math.max(1, Number(config?.batchConcurrency) || 2);
    this.imageConcurrency = Math.max(1, Number(config?.imageConcurrency) || 4);
    this._tools = {
      parse_outline: this._toolParseOutline.bind(this),
      extract_style: this._toolExtractStyle.bind(this),
      spawn_slide_agent: this._toolSpawnSlideAgent.bind(this),
      take_screenshot: this._toolTakeScreenshot.bind(this),
      fix_slide: this._toolFixSlide.bind(this),
      fill_visual: this._toolFillVisual.bind(this),
      chat_ask: this._toolChatAsk.bind(this),
    };
    this.registerTools(this._tools);
    if (tools) this.registerTools(tools);
    this.phase = { status: DesignPhase.IDLE };
    this._loopStatus = AgentStatus.IDLE;
    this._statusHistory = [];
    this.archive = archive || null;
  }

  getToolDefinitions() {
    return DESIGN_AGENT_TOOL_DEFINITIONS.slice();
  }


  _transitionPhase(state, next, { emit, runId, payload } = {}) {
    const from = state.status;
    const ok = designPhaseMachine.transition(state, next, { runId, from, to: next, ...payload });
    if (!ok) {
      throw new Error(`DesignPhase transition rejected: ${from} -> ${next}`);
    }
    emitStage(emit, "design.phase.transition", "progress", { runId, from, to: next, ...payload });
    return next;
  }

  async _transitionTo(newStatus, metadata = {}) {
    const oldStatus = this._loopStatus;
    if (oldStatus === newStatus) return null;

    // 简化状态机：只验证基本转换
    const validTransitions = {
      [AgentStatus.IDLE]: [AgentStatus.RUNNING],
      [AgentStatus.RUNNING]: [AgentStatus.COMPLETED, AgentStatus.FAILED, AgentStatus.PAUSED],
      [AgentStatus.PAUSED]: [AgentStatus.RUNNING, AgentStatus.FAILED],
      [AgentStatus.COMPLETED]: [],
      [AgentStatus.FAILED]: [],
    };
    const allowed = validTransitions[oldStatus] || [];
    if (!allowed.includes(newStatus)) {
      const err = new Error(`Invalid DesignLoop state transition: ${oldStatus} -> ${newStatus}`);
      err.code = "INVALID_STATE_TRANSITION";
      throw err;
    }

    const meta = metadata && typeof metadata === "object" ? metadata : {};
    const { stageApi, nodeStates, ...historyMeta } = meta;
    const timestamp = Date.now();
    const runtimeState = stageApi?.signal ? getRuntimeState(stageApi.signal) : null;
    const runtimePauseRequested = runtimeState?.status === "paused";
    let checkpointId = null;

    // 在 RUNNING 状态下检查暂停请求
    if (newStatus === AgentStatus.RUNNING && this.archive) {
      checkpointId = await this._savePreActionCheckpoint({
        ...historyMeta,
        ...(nodeStates && typeof nodeStates === "object" ? { nodeStates } : {}),
      });
      if (runtimeState && checkpointId) runtimeState.lastCheckpointId = checkpointId;
    }

    const shouldPause = this._pauseRequested || runtimePauseRequested;
    if (shouldPause && newStatus === AgentStatus.RUNNING) {
      const reason = runtimeState?.pausedReason || this._pauseReason || null;
      const resolvedCheckpointId = checkpointId ?? historyMeta.checkpointId ?? runtimeState?.lastCheckpointId ?? null;
      if (runtimeState && resolvedCheckpointId) runtimeState.lastCheckpointId = resolvedCheckpointId;

      this._loopStatus = AgentStatus.PAUSED;
      this._statusHistory.push({
        from: oldStatus,
        to: AgentStatus.PAUSED,
        timestamp,
        ...historyMeta,
        ...(resolvedCheckpointId ? { checkpointId: resolvedCheckpointId } : {}),
        pausedReason: reason,
      });

      throw new StagePausedError("Run paused", {
        checkpointId: resolvedCheckpointId,
        reason,
        timestamp,
        runId: historyMeta.runId ?? null,
      });
    }

    this._loopStatus = newStatus;
    this._statusHistory.push({
      from: oldStatus,
      to: newStatus,
      timestamp,
      ...historyMeta,
      ...(checkpointId ? { checkpointId } : {}),
    });

    return checkpointId;
  }

  async _savePreActionCheckpoint(metadata) {
    if (!this.archive) return null;
    const meta = metadata && typeof metadata === "object" ? metadata : {};
    const { nodeStates, ...metadataRest } = meta;
    const state = {
      phase: this.phase?.status,
      loopStatus: this._loopStatus,
      statusHistory: this._statusHistory.map((entry) => ({ ...entry })),
      ...(nodeStates && typeof nodeStates === "object" ? nodeStates : {}),
    };

    const checkpoint = createCheckpoint(state, {
      ...metadataRest,
      type: CheckpointType.PRE_ACTION,
    });

    return this.archive.save(meta.runId || "unknown", checkpoint);
  }

  get loopStatus() {
    return this._loopStatus;
  }

  get statusHistory() {
    return [...this._statusHistory];
  }

  async _initDesignSystem(contentPackage, context, constraints, userConfig) {
    const modelRouter =
      Object.prototype.hasOwnProperty.call(context || {}, "modelRouter") ? context.modelRouter : (context?.runContext && context.runContext.modelRouter) || null;

    let designSystem;
    try {
      designSystem = await generateDesignSystem(
        {
          contentSummary: contentPackage?.summary || "",
          tone: String(constraints?.tone || contentPackage?.constraints?.tone || "neutral"),
          extractedPalette: contentPackage?.constraints?.extractedPalette || constraints?.extractedPalette,
          userPreferences: userConfig,
        },
        { modelRouter, aiApiService: context.aiApiService, signal: context.signal, constraints }
      );
    } catch (e) {
      checkCancelled(context.signal);
      designSystem = generateDesignTokens(constraints);
    }

    if (!designSystem || !designSystem?.designTokens) {
      designSystem = generateDesignTokens(constraints);
    }

    return designSystem;
  }

  _buildVisualSlots(brainstormResult, imageSlots, imageProvider, hasModelCapability = true) {
    // If no rendering capability at all (no imageProvider and no model for SVG),
    // return empty array to skip rendering and keep placeholders intact.
    if (!imageProvider && !hasModelCapability) {
      return [];
    }

    const candidatesBySlide = Array.isArray(brainstormResult?.candidatesBySlide) ? brainstormResult.candidatesBySlide : [];
    const selectedVisualSlots = candidatesBySlide.flatMap((row) =>
      Array.isArray(row?.selectedCandidate?.visualSlots) ? row.selectedCandidate.visualSlots : []
    );

    // When imageProvider is not available but model is, fallback ai-image slots to svg
    const shouldFallbackToSvg = !imageProvider && hasModelCapability;
    const mapSlotRenderType = (slot) => {
      const rt = normalizeRenderType(slot?.renderType);
      if (shouldFallbackToSvg && rt === "ai-image") {
        return {
          ...slot,
          renderType: "svg",
          svgSpec: {
            type: slot?.purpose === "chart_fallback" ? "chart" : "diagram",
            description: slot?.imageSpec?.prompt || slot?.promptHint || slot?.purpose || "Visual element",
          },
        };
      }
      return { ...slot, renderType: rt };
    };

    return selectedVisualSlots.length
      ? selectedVisualSlots.map(mapSlotRenderType)
      : imageSlots.map((s) =>
          mapSlotRenderType({
            slotId: s.slotId,
            slideIntentId: s.slideIntentId,
            slideIndex: s.slideIndex,
            renderType: normalizeRenderType(s.renderType),
            priority: s.priority,
            aspectRatio: s.aspectRatio,
            purpose: s.purpose,
            imageSpec: { prompt: s.promptHint, style: s.style },
            ...(s.effects ? { effects: s.effects } : {}),
            ...(s.assetId ? { assetSpec: { assetId: s.assetId } } : {}),
          })
        );
  }

  async _renderVisuals(
    visualSlotsForRender,
    contentPackage,
    designSystem,
    slideHtmls,
    context,
    runContext,
    constraints,
    imageSlots,
    aiImageSlotIds
  ) {
    const emit = getEmitFn(context);
    const modelRouter =
      Object.prototype.hasOwnProperty.call(context || {}, "modelRouter") ? context.modelRouter : (context?.runContext && context.runContext.modelRouter) || null;

    let imageReport = null;
    let visualReport = null;
    let finalImageSlots = imageSlots;
    let deckHtmlDsl = slideHtmls.join("\n\n");
    let pendingImages = aiImageSlotIds.slice();

    if (!visualSlotsForRender.length) {
      return { visualReport, imageReport, finalImageSlots, deckHtmlDsl, pendingImages };
    }

    const imageProvider = context.imageProvider || context.imageService;

    try {
      // Build slideHtmlBySlotId map for SVG generator context
      const slideHtmlBySlotId = new Map();
      for (const slot of visualSlotsForRender) {
        const slotId = String(slot?.slotId || "").trim();
        const slideIdx = Number.isFinite(slot?.slideIndex) ? slot.slideIndex : -1;
        if (slotId && slideIdx >= 0 && slideIdx < slideHtmls.length) {
          slideHtmlBySlotId.set(slotId, slideHtmls[slideIdx]);
        }
      }

      const svgGenerator = Object.prototype.hasOwnProperty.call(context || {}, "svgGenerator") ? context.svgGenerator : new SVGGenerator();
      const renderer = new VisualRenderer({
        imageProvider: imageProvider || null,
        svgGenerator,
        assets: Array.isArray(context?.assets) ? context.assets : Array.isArray(contentPackage?.assets) ? contentPackage.assets : null,
      });

      const res = await renderer.render(visualSlotsForRender, contentPackage, designSystem, {
        emit,
        runId: runContext.runId,
        policy: constraints?.imagePolicy,
        budget: constraints?.imageBudget,
        concurrency: this.imageConcurrency,
        svgConcurrency: this.imageConcurrency,
        aiApiService: context.aiApiService,
        modelRouter,
        signal: context.signal,
        slideHtmlBySlotId,
        imageProvider: imageProvider || null,
      });

      if (res?.report?.errors?.length) {
        emitStage(emit, "design.visual.errors", "warn", {
          errors: res.report.errors,
          hasFatalError: res.report.hasFatalError || false,
          svgReport: res.report.svgReport || null,
        });
      }

      visualReport = res?.report ? { ...res.report, errors: Array.isArray(res.report.errors) ? res.report.errors : [] } : null;
      imageReport = res?.imageResults?.report || visualReport?.imageReport || null;

      const filledById = new Map(
        (Array.isArray(res?.imageResults?.filledSlots) ? res.imageResults.filledSlots : []).map((s) => [String(s?.slotId || ""), s])
      );
      if (filledById.size) {
        finalImageSlots = imageSlots.map((s) => (filledById.has(String(s?.slotId || "")) ? filledById.get(String(s?.slotId || "")) : s));
      }

      // Apply fills (ai-image/svg/asset) independently.
      if (Array.isArray(res?.imageResults?.filledSlots) && res.imageResults.filledSlots.length) {
        const filled = fillImagePlaceholders(deckHtmlDsl, res.imageResults.filledSlots);
        deckHtmlDsl = filled.deckHtmlDsl;
        pendingImages = aiImageSlotIds.filter((slotId) => !filled.filledSlotIds.includes(slotId));
      }

      if (Array.isArray(res?.svgResults) && res.svgResults.length) {
        const filledSvg = fillSvgPlaceholders(deckHtmlDsl, res.svgResults);
        deckHtmlDsl = filledSvg.html;
      }

      if (Array.isArray(res?.assetResults) && res.assetResults.length) {
        const filledAssets = fillAssetPlaceholders(deckHtmlDsl, res.assetResults);
        deckHtmlDsl = filledAssets.html;
      }
    } catch (e) {
      checkCancelled(context.signal);
      const errorMessage = e instanceof Error ? e.message : String(e);
      const errors = [{ renderer: "design.visual", error: errorMessage }];

      emitStage(emit, "design.visual.errors", "warn", {
        errors,
        hasFatalError: true,
        svgReport: null,
      });

      imageReport = {
        schemaVersion: "0.1",
        runId: runContext.runId,
        policy: String(constraints?.imagePolicy || "balanced"),
        budget: constraints?.imageBudget || null,
        slots: imageSlots,
        tasks: [],
        summary: { planned: imageSlots.length, attempted: 0, succeeded: 0, failed: imageSlots.length, skipped: 0, totalCostUSD: 0, totalDurationMs: 0 },
        error: errorMessage,
      };

      const planned = { total: visualSlotsForRender.length, "ai-image": 0, svg: 0, asset: 0 };
      for (const slot of visualSlotsForRender) {
        const t = normalizeRenderType(slot?.renderType);
        if (t === "svg") planned.svg += 1;
        else if (t === "asset") planned.asset += 1;
        else planned["ai-image"] += 1;
      }

      visualReport = {
        schemaVersion: "0.1",
        runId: runContext.runId,
        planned,
        completed: { "ai-image": 0, svg: 0, asset: 0 },
        durationMs: 0,
        errors,
        imageReport,
        svgReport: null,
        hasFatalError: true,
      };
    }

    return { visualReport, imageReport, finalImageSlots, deckHtmlDsl, pendingImages };
  }

  async _runRefine(deckPackage, contentPackage, runContext, context, userConfig, emit) {
    const { runReactRefiner } = await import("./refiner/react-refiner.js");
    const { createToolExecutor } = await import("./refiner/react-refiner-tools.js");

    const toolContext = {
      deckPackage,
      contentPackage,
      stageApi: context,
    };
    const toolExecutor = createToolExecutor(toolContext);

    const refineResult = await runReactRefiner(
      toolContext.deckPackage,
      { contentPackage, runContext, stageApi: context },
      {
        recommendedSteps: userConfig.refine.recommendedSteps || 5,
        hardLimit: userConfig.refine.hardLimit || 15,
        toolExecutor,
        mode: "generation", // generation stage only enables base tools
        onStep: (step) => emit?.("design.refine.step", { actor: "design", status: "step", payload: step }),
      }
    );

    const deckHtmlDsl = refineResult.finalDeck?.deckHtmlDsl || toolContext.deckPackage.deckHtmlDsl;
    const slidesMeta = refineResult.finalDeck?.slidesMeta || toolContext.deckPackage.slidesMeta;

    emitStage(emit, "design.refine.ended", "ended", {
      qualityScore: refineResult.qualityScore,
      stepCount: refineResult.steps?.length || 0,
      terminationReason: refineResult.terminationReason,
    });

    return { deckHtmlDsl, slidesMeta, refineResult };
  }

  async _toolParseOutline(params = {}) {
    const pkg = params.contentPackage || null;
    const slideIntents = Array.isArray(pkg?.slideIntents) ? pkg.slideIntents : [];
    return { slideIntents, contentPackage: pkg };
  }

  async _toolExtractStyle(params = {}, context = {}) {
    const contentPackage = params.contentPackage || null;
    const constraints = params.constraints || {};
    const userConfig = params.userConfig || {};
    const designSystem = await this._initDesignSystem(contentPackage, context, constraints, userConfig);
    return { designSystem };
  }

  async _toolSpawnSlideAgent(params = {}, context = {}) {
    const slideIntents = Array.isArray(params.slideIntents) ? params.slideIntents : [];
    const contentPackage = params.contentPackage || null;
    const designSystem = params.designSystem || null;
    const generated = await generateBatch(slideIntents, contentPackage, designSystem, {
      batchSize: params.batchSize || this.batchSize,
      batchConcurrency: params.batchConcurrency || this.batchConcurrency,
      modelRouter: params.modelRouter || null,
      aiApiService: params.aiApiService || context.aiApiService,
      imageSlots: Array.isArray(params.imageSlots) ? params.imageSlots : [],
      selectedIdeas: Array.isArray(params.selectedIdeas) ? params.selectedIdeas : [],
      emit: params.emit || null,
      signal: params.signal || context.signal,
      dslRules: params.dslRules || null,
    });
    return { generated };
  }

  async _toolTakeScreenshot() {
    return { screenshots: [] };
  }

  async _toolFixSlide() {
    return { fixed: false };
  }

  async _toolFillVisual(params = {}, context = {}) {
    return this._renderVisuals(
      Array.isArray(params.visualSlotsForRender) ? params.visualSlotsForRender : [],
      params.contentPackage || null,
      params.designSystem || null,
      Array.isArray(params.slideHtmls) ? params.slideHtmls : [],
      context,
      params.runContext || {},
      params.constraints || {},
      Array.isArray(params.imageSlots) ? params.imageSlots : [],
      Array.isArray(params.aiImageSlotIds) ? params.aiImageSlotIds : []
    );
  }

  async _toolChatAsk(params = {}, context = {}) {
    const emit = getEmitFn(context);
    emitStage(emit, "design.chat.ask", "progress", {
      message: params.message || "",
      actionName: params.actionName || "chat_reply",
    });
    if (!params.actionName) return { actionName: "chat_reply" };
    const payload = await this.waitForUserAction(params.actionName, { eventBus: context.eventBus, signal: context.signal });
    return { actionName: params.actionName, payload };
  }

  /**
   * Stage interface (Runtime): execute(runContext, contentPackage) -> DeckPackage.
   * @param {object} runContext
   * @param {object} contentPackage ContentPackage v0.1
   * @param {{emit?:Function,eventBus?:object,signal?:AbortSignal,aiApiService?:object,imageService?:any,imageProvider?:any}=} stageApi
   */
  async execute(runContext, contentPackage, stageApi = {}) {
    return super.execute(runContext, contentPackage, stageApi);
  }

  /**
   * Convenience adapter: run(contentPackage, context) -> DeckPackage.
   * @param {object} contentPackage
   * @param {{runContext?:object,emit?:Function,eventBus?:object,signal?:AbortSignal,aiApiService?:object,imageService?:any,imageProvider?:any}=} context
   */
  async run(contentPackage, context = {}) {
    const runContext = context.runContext || { runId: contentPackage?.runId || "run_unknown", constraints: contentPackage?.constraints || {} };
    const runId = runContext.runId || contentPackage?.runId || "run_unknown";
    this.eventBus = context.eventBus || this.eventBus || null;
    let emit = getEmitFn(context);
    if ((!emit || emit === this.eventBus?.emit) && this.eventBus?.emit) {
      emit = this.eventBus.emit.bind(this.eventBus);
    }
    this.emit = emit || this.emit || null;
    this.phase = { status: DesignPhase.IDLE };

    const stageApi = { signal: context.signal };
    let iteration = 0;
    const buildLoopState = (step) => ({
      phase: this.phase?.status,
      step,
    });
    const buildLoopMeta = (step, loopIteration) => ({
      runId,
      iteration: loopIteration,
      state: buildLoopState(step),
      stageApi,
    });
    const startExecution = async (step, nodeStates) => {
      const loopIteration = ++iteration;
      // 用事件替代复杂状态转换
      emitStage(emit, "design.step.started", "progress", { runId, step, iteration: loopIteration });
      const stepInfo = this._beginStep({
        name: step,
        runId,
        iteration: loopIteration,
        meta: nodeStates,
      }, context);
      return { loopIteration, stepInfo };
    };
    const finishExecution = async (step, loopIteration, stepInfo) => {
      emitStage(emit, "design.step.completed", "progress", { runId, step, iteration: loopIteration });
      this._endStep(stepInfo, { status: "completed" });
    };
    const buildDeckSignature = (deckHtmlDsl) => {
      if (typeof deckHtmlDsl !== "string") return null;
      const head = deckHtmlDsl.slice(0, 64);
      const tail = deckHtmlDsl.slice(-64);
      return `${deckHtmlDsl.length}:${head}:${tail}`;
    };
    let lastDeckSignature = null;
    const emitDeckUpdate = (deckHtmlDsl, slidesMeta, { source } = {}) => {
      if (!emit || typeof deckHtmlDsl !== "string") return;
      if (!deckHtmlDsl.includes("<section")) return;
      const signature = buildDeckSignature(deckHtmlDsl);
      if (signature && signature === lastDeckSignature) return;
      lastDeckSignature = signature;
      emitStage(emit, "design.deck.updated", "progress", {
        runId,
        source: source || "update",
        phase: this.phase?.status,
        slides: Array.isArray(slidesMeta) ? slidesMeta.length : undefined,
        deckHtmlDsl,
        slidesMeta: Array.isArray(slidesMeta) ? slidesMeta : undefined,
      });
    };

    try {
      await this._transitionTo(AgentStatus.RUNNING, {
        runId,
        stageApi,
        state: buildLoopState("run_start"),
      });

      emitStage(emit, "design.started", "started", {
        runId: runContext.runId,
        slideCount: Array.isArray(contentPackage?.slideIntents) ? contentPackage.slideIntents.length : 0,
      });

      this._transitionPhase(this.phase, DesignPhase.OUTLINE_PARSING, { emit, runId: runContext.runId });
      checkCancelled(context.signal);

      const outlineResult = await this._callTool("parse_outline", { contentPackage }, context);
      if (!outlineResult.ok) throw new Error(outlineResult.error || "parse_outline failed");
      const outlineData = outlineResult.data || {};
      const parsedContentPackage = outlineData.contentPackage || contentPackage;
      let slideIntents = Array.isArray(outlineData.slideIntents) ? outlineData.slideIntents : Array.isArray(parsedContentPackage?.slideIntents) ? parsedContentPackage.slideIntents : [];

      this._transitionPhase(this.phase, DesignPhase.OUTLINE_CONFIRMING, { emit, runId: runContext.runId });
      if (context?.interactionMode?.outlineConfirm && context.interactionMode.outlineConfirm !== "skip") {
        const outlineConfirm = await this.waitForUserAction("confirm_outline", { eventBus: context.eventBus, signal: context.signal });
        if (Array.isArray(outlineConfirm?.slideIntents)) slideIntents = outlineConfirm.slideIntents;
      }

      if (slideIntents.length === 0) throw new Error("DesignAgentLoop: contentPackage.slideIntents is required");

      this._transitionPhase(this.phase, DesignPhase.STYLE_EXTRACTING, { emit, runId: runContext.runId });
      checkCancelled(context.signal);

      const constraints = runContext.constraints || {};
      let userConfig =
        (runContext && typeof runContext === "object" ? runContext.userConfig : undefined) ||
        (contentPackage && typeof contentPackage === "object" ? contentPackage.userConfig : undefined) ||
        (context && typeof context === "object" ? context.userConfig : undefined) ||
        {};
      userConfig = this.applyUserInputsToConfig(userConfig);

      const { loopIteration: styleIteration, stepInfo: styleStep } = await startExecution("style_extracting", {
        contentPackage: parsedContentPackage,
        slideIntents,
        constraints,
        userConfig,
      });
      const styleContext = styleStep.context;
      const styleResult = await this._callTool("extract_style", { contentPackage: parsedContentPackage, constraints, userConfig }, styleContext);
      if (!styleResult.ok) throw new Error(styleResult.error || "extract_style failed");
      const designSystem = styleResult.data?.designSystem || styleResult.data;

      emitStage(emit, "design.tokens.ended", "ended", { theme: designSystem?.theme });
      checkCancelled(styleContext.signal);

      await finishExecution("style_extracting", styleIteration, styleStep);

      this._transitionPhase(this.phase, DesignPhase.STYLE_CONFIRMING, { emit, runId: runContext.runId });
      if (context?.interactionMode?.styleConfirm && context.interactionMode.styleConfirm !== "skip") {
        await this.waitForUserAction("confirm_style", { eventBus: context.eventBus, signal: context.signal });
      }
      this._transitionPhase(this.phase, DesignPhase.GENERATING, { emit, runId: runContext.runId });
      userConfig = this.applyUserInputsToConfig(userConfig);

      const modelRouter =
        Object.prototype.hasOwnProperty.call(context || {}, "modelRouter") ? context.modelRouter : (context?.runContext && context.runContext.modelRouter) || null;

      let skipReview = false;
      if (context?.pauseOnPhase === DesignPhase.GENERATING || context?.pauseGenerating) {
        this._transitionPhase(this.phase, DesignPhase.GENERATING_PAUSED, { emit, runId: runContext.runId });
        const resume = await this.waitForUserAction("resume_generating", { eventBus: context.eventBus, signal: context.signal });
        skipReview = resume && typeof resume === "object" && resume.action === "skip_review";
        this._transitionPhase(this.phase, DesignPhase.GENERATING, { emit, runId: runContext.runId });
      }

      if (this.phase.status === DesignPhase.GENERATING) {
        const { loopIteration: generatingIteration, stepInfo: generatingStep } = await startExecution("generating", {
          contentPackage: parsedContentPackage,
          slideIntents,
          designSystem,
          constraints,
          userConfig,
        });
        const generatingContext = generatingStep.context;
        // Use provided brainstormResult or plan imageSlots via ImagePlanner
        const brainstormResult = context?.brainstormResult || {
          ideaPool: [],
          selectedIdeas: [],
          imageSlots: ImagePlanner.plan(slideIntents, designSystem, constraints),
          candidatesBySlide: [],
        };
        const { imageSlots } = brainstormResult;
        const selectedIdeasForPrompt = Array.isArray(brainstormResult?.candidatesBySlide)
          ? brainstormResult.candidatesBySlide
              .map((row) => ({
                slideIntentId: String(row?.slideIntentId || "").trim(),
                slideIndex: Number.isFinite(row?.slideIndex) ? row.slideIndex : undefined,
                atmosphere: row?.selectedCandidate?.atmosphere,
                elementsMarkdown: row?.selectedCandidate?.elementsMarkdown,
                visualSlots: row?.selectedCandidate?.visualSlots,
              }))
              .filter((x) => x.slideIntentId)
          : [];

        let pendingImages = imageSlots.map((s) => s.slotId);
        const estimatedCostUSD = imageSlots.reduce((sum, s) => sum + estimateSlotCostUSD(s), 0);
        if (hasImagePlanningConfig(constraints)) {
          emitStage(emit, "design.image.planning.completed", "completed", {
            policy: String(constraints?.imagePolicy || "balanced"),
            planned: imageSlots.length,
            pendingImages,
            estimatedCostUSD: Number(estimatedCostUSD.toFixed(4)),
          });
          checkCancelled(generatingContext.signal);
        }

        const dslRules = await getDslRules();
        checkCancelled(generatingContext.signal);

        const genResult = await this._callTool(
          "spawn_slide_agent",
          {
            slideIntents,
            contentPackage: parsedContentPackage,
            designSystem,
            batchSize: this.batchSize,
            batchConcurrency: this.batchConcurrency,
            modelRouter,
            aiApiService: context.aiApiService,
            imageSlots,
            selectedIdeas: selectedIdeasForPrompt,
            emit,
            signal: generatingContext.signal,
            dslRules,
          },
          generatingContext
        );

        if (!genResult.ok) throw new Error(genResult.error || "spawn_slide_agent failed");
        const generated = Array.isArray(genResult.data?.generated) ? genResult.data.generated : Array.isArray(genResult.data) ? genResult.data : [];

        emitStage(emit, "design.generate.ended", "ended", { slides: generated.length });
        checkCancelled(generatingContext.signal);

        if (!skipReview) {
          this._transitionPhase(this.phase, DesignPhase.REVIEWING, { emit, runId: runContext.runId });
        }
        await finishExecution("generating", generatingIteration, generatingStep);

        let slidesMeta = [];
        let slideHtmls = [];
        let degradedCount = 0;

        for (let i = 0; i < slideIntents.length; i++) {
          const slideIntent = slideIntents[i];
          const slideNo = i + 1;
          const imageSlotsForSlide = imageSlots.filter((s) => s.slideIndex === i);

          let slideHtml = generated[i]?.slideHtml;
          let qa = validateSlide(slideHtml);
          let degraded = false;

          if (!qa.pass) {
            degraded = true;
            degradedCount++;
            emit?.("design.degraded", { actor: "design", status: "warn", payload: { slideNo, slideIntentId: slideIntent.slideIntentId } });
            slideHtml = buildSlideHtml(slideIntent, designSystem, parsedContentPackage, { safeMode: true, slideNo, imageSlotsForSlide });
            qa = validateSlide(slideHtml);
          }

          if (!qa.pass) {
            // Last-last resort: title-only safe slide.
            degraded = true;
            degradedCount++;
            emit?.("design.degraded", {
              actor: "design",
              status: "warn",
              payload: { slideNo, slideIntentId: slideIntent.slideIntentId, reason: "qa_failed_after_safe" },
            });
            slideHtml = buildSlideHtml({ ...slideIntent, keyPoints: [], claimIds: [] }, designSystem, parsedContentPackage, {
              safeMode: true,
              slideNo,
              imageSlotsForSlide,
            });
            qa = validateSlide(slideHtml);
          }

          slideHtmls.push(slideHtml);
          slidesMeta.push({
            slideNo,
            slideIntentId: slideIntent?.slideIntentId,
            pageType: slideIntent?.pageType,
            title: slideIntent?.title,
            degraded,
            source: generated[i]?.source || "fallback",
            qa,
          });
        }

        if (degradedCount > 0) emitStage(emit, "design.degraded", "warn", { degradedCount });
        emitStage(emit, "design.qa.ended", "ended", { slides: slideHtmls.length, degradedCount });

        const baseDeckHtmlDsl = slideHtmls.join("\n\n");
        emitDeckUpdate(baseDeckHtmlDsl, slidesMeta, { source: "qa" });

        userConfig = this.applyUserInputsToConfig(userConfig);
        this._transitionPhase(this.phase, DesignPhase.VISUAL_FILLING, { emit, runId: runContext.runId });
        const { loopIteration: visualIteration, stepInfo: visualStep } = await startExecution("visual_filling", {
          contentPackage: parsedContentPackage,
          slideIntents,
          designSystem,
          generated,
          slideHtmls,
          slidesMeta,
          imageSlots,
          deckHtmlDsl: baseDeckHtmlDsl,
          pendingImages,
        });
        const visualContext = visualStep.context;

        let imageReport = null;
        let visualReport = null;
        let refineResult = null;
        let finalImageSlots = imageSlots;
        let deckHtmlDsl = baseDeckHtmlDsl;

        const imageProvider = context.imageProvider || context.imageService;
        const hasModelCapability = !!(context.modelRouter || context.aiApiService);
        const visualSlotsForRender = this._buildVisualSlots(brainstormResult, imageSlots, imageProvider, hasModelCapability);
        // Slots without explicit renderType default to ai-image for pending tracking
        const aiImageSlotIds = imageSlots
          .filter((s) => {
            const rt = normalizeRenderType(s.renderType);
            return rt === "ai-image" || rt === "";
          })
          .map((s) => s.slotId);

        const fillResult = await this._callTool(
          "fill_visual",
          {
            visualSlotsForRender,
            contentPackage: parsedContentPackage,
            designSystem,
            slideHtmls,
            runContext,
            constraints,
            imageSlots,
            aiImageSlotIds,
          },
          visualContext
        );

        if (!fillResult.ok) throw new Error(fillResult.error || "fill_visual failed");
        const fillData = fillResult.data || {};
        visualReport = fillData.visualReport ?? visualReport;
        imageReport = fillData.imageReport ?? imageReport;
        finalImageSlots = fillData.finalImageSlots ?? finalImageSlots;
        deckHtmlDsl = fillData.deckHtmlDsl ?? deckHtmlDsl;
        pendingImages = fillData.pendingImages ?? pendingImages;
        emitDeckUpdate(deckHtmlDsl, slidesMeta, { source: "visual_fill" });

        // If refine is enabled (userConfig.refine?.enabled), run ReAct loop after VisualRenderer.
        if (userConfig?.refine?.enabled) {
          const deckPackage = { deckHtmlDsl, slidesMeta, designSystem, imageSlots: finalImageSlots };
          const refineOut = await this._runRefine(deckPackage, parsedContentPackage, runContext, visualContext, userConfig, emit);
          deckHtmlDsl = refineOut.deckHtmlDsl;
          slidesMeta = refineOut.slidesMeta;
          refineResult = refineOut.refineResult;
          emitDeckUpdate(deckHtmlDsl, slidesMeta, { source: "refine" });
        }

        await finishExecution("visual_filling", visualIteration, visualStep);
        this._transitionPhase(this.phase, DesignPhase.COMPLETED, { emit, runId: runContext.runId });
        await this._transitionTo(AgentStatus.COMPLETED, {
          runId,
          iteration,
          stageApi,
          state: buildLoopState("completed"),
        });
        emitStage(emit, "design.ended", "ended", { slides: slideHtmls.length, degradedCount });

        return {
          schemaVersion: SCHEMA_VERSION,
          runId: runContext.runId,
          designSystem,
          deckHtmlDsl,
          slidesMeta,
          editHints: { degradedCount },
          imageSlots: finalImageSlots,
          imageReport,
          visualReport,
          pendingImages,
          refineReport: refineResult || null,
        };
      }

      if (this.phase.status !== DesignPhase.COMPLETED) {
        this._transitionPhase(this.phase, DesignPhase.COMPLETED, { emit, runId: runContext.runId });
      }

      await this._transitionTo(AgentStatus.COMPLETED, {
        runId,
        iteration,
        stageApi,
        state: buildLoopState("completed"),
      });

      emitStage(emit, "design.ended", "ended", { slides: 0, degradedCount: 0 });

      return {
        schemaVersion: SCHEMA_VERSION,
        runId: runContext.runId,
        designSystem: null,
        deckHtmlDsl: "",
        slidesMeta: [],
        editHints: { degradedCount: 0 },
        imageSlots: [],
        imageReport: null,
        visualReport: null,
        pendingImages: [],
        refineReport: null,
      };
    } catch (err) {
      const pauseLike = this._shouldPauseFromError(err, context.signal);
      if (this._activeStep) {
        const message = err instanceof Error ? err.message : String(err);
        this._endStep(null, { status: pauseLike ? "paused" : "failed", error: message });
      }
      if (err instanceof StagePausedError) {
        throw err;
      }
      if (pauseLike) {
        throw this._createPauseError({ signal: context.signal, runId });
      }

      try {
        await this._transitionTo(AgentStatus.FAILED, {
          runId,
          stageApi,
          state: buildLoopState("failed"),
          error: err?.message,
        });
      } catch {
        // ignore secondary transition failures
      }

      throw err;
    }
  }
}

export async function resumeDesignAgentLoop(checkpointId, stageApi = {}) {
  const archive = stageApi?.archive || new Archive(new MapAdapter());

  const snapshot = migrateCheckpoint(await archive.restore(checkpointId));
  if (!snapshot?.nodeStates) {
    throw new Error(`Checkpoint not found: ${checkpointId}`);
  }

  const nodeStates = snapshot.nodeStates || {};

  const agentLoop = new DesignAgentLoop({ ...stageApi, archive });
  const restoredLoopStatus = nodeStates.loopStatus || AgentStatus.IDLE;
  const restoredPhase = nodeStates.phase || DesignPhase.IDLE;

  agentLoop._loopStatus = AgentStatus.IDLE;
  agentLoop.phase = { status: restoredPhase };
  if (Array.isArray(nodeStates.statusHistory)) {
    agentLoop._statusHistory = nodeStates.statusHistory.map((entry) => ({ ...entry }));
  }

  agentLoop._pauseRequested = false;
  agentLoop._pauseReason = null;

  const resumeState = {
    phase: restoredPhase,
    loopStatus: restoredLoopStatus,
    contentPackage: nodeStates.contentPackage || nodeStates.parsedContentPackage || null,
    parsedContentPackage: nodeStates.parsedContentPackage || null,
    slideIntents: Array.isArray(nodeStates.slideIntents) ? nodeStates.slideIntents : null,
    designSystem: nodeStates.designSystem || null,
    generated: Array.isArray(nodeStates.generated) ? nodeStates.generated : null,
    slideHtmls: Array.isArray(nodeStates.slideHtmls) ? nodeStates.slideHtmls : null,
    deckHtmlDsl: typeof nodeStates.deckHtmlDsl === "string" ? nodeStates.deckHtmlDsl : "",
    slidesMeta: Array.isArray(nodeStates.slidesMeta) ? nodeStates.slidesMeta : null,
    imageSlots: Array.isArray(nodeStates.imageSlots) ? nodeStates.imageSlots : null,
    imageReport: nodeStates.imageReport || null,
    visualReport: nodeStates.visualReport || null,
    pendingImages: Array.isArray(nodeStates.pendingImages) ? nodeStates.pendingImages : null,
    refineReport: nodeStates.refineReport || null,
    constraints: nodeStates.constraints || null,
    userConfig: nodeStates.userConfig || null,
  };

  agentLoop._resumeState = resumeState;

  const fallbackContentPackage = stageApi?.contentPackage || stageApi?.input || null;
  const contentPackage = resumeState.contentPackage || fallbackContentPackage;
  if (!contentPackage || typeof contentPackage !== "object") {
    throw new Error(`Checkpoint missing contentPackage: ${checkpointId}`);
  }

  const runIdFromMeta = snapshot?.metadata?.runId;
  const resolvedRunId =
    (stageApi?.runContext && stageApi.runContext.runId) || nodeStates.runId || runIdFromMeta || contentPackage.runId || "run_unknown";
  const resolvedConstraints =
    (stageApi?.runContext && stageApi.runContext.constraints) || contentPackage.constraints || resumeState.constraints || {};
  const runContext = stageApi?.runContext
    ? { ...stageApi.runContext, runId: resolvedRunId, constraints: stageApi.runContext.constraints || resolvedConstraints }
    : { runId: resolvedRunId, constraints: resolvedConstraints };

  const phaseRank = {
    [DesignPhase.IDLE]: 0,
    [DesignPhase.OUTLINE_PARSING]: 1,
    [DesignPhase.OUTLINE_CONFIRMING]: 2,
    [DesignPhase.STYLE_EXTRACTING]: 3,
    [DesignPhase.STYLE_CONFIRMING]: 4,
    [DesignPhase.GENERATING]: 5,
    [DesignPhase.GENERATING_PAUSED]: 5,
    [DesignPhase.REVIEWING]: 6,
    [DesignPhase.FIXING]: 6,
    [DesignPhase.VISUAL_FILLING]: 7,
    [DesignPhase.COMPLETED]: 8,
    [DesignPhase.EDITING]: 8,
    [DesignPhase.FAILED]: 0,
  };

  const resumePhase = resumeState.phase || DesignPhase.IDLE;
  const resumeIndex = phaseRank[resumePhase] ?? 0;
  const canUseOutline = resumeIndex >= phaseRank[DesignPhase.STYLE_EXTRACTING];
  const canUseDesign = resumeIndex >= phaseRank[DesignPhase.STYLE_CONFIRMING];
  const canUseGenerated = resumeIndex >= phaseRank[DesignPhase.VISUAL_FILLING];

  const baseExecutor = resolveToolExecutor(stageApi);
  const outlineContentPackage = resumeState.parsedContentPackage || resumeState.contentPackage || contentPackage;
  const outlineSlideIntents =
    resumeState.slideIntents ||
    (Array.isArray(outlineContentPackage?.slideIntents) ? outlineContentPackage.slideIntents : null);
  let cachedGenerated = resumeState.generated;
  if (!cachedGenerated && Array.isArray(resumeState.slideHtmls)) {
    const sources = Array.isArray(resumeState.slidesMeta) ? resumeState.slidesMeta : [];
    cachedGenerated = resumeState.slideHtmls.map((slideHtml, index) => ({
      slideHtml,
      source: sources[index]?.source || "resume",
    }));
  }

  const toolExecutor = async (name, params, context) => {
    if (name === "parse_outline" && canUseOutline && Array.isArray(outlineSlideIntents)) {
      return { contentPackage: outlineContentPackage, slideIntents: outlineSlideIntents };
    }
    if (name === "extract_style" && canUseDesign && resumeState.designSystem) {
      return { designSystem: resumeState.designSystem };
    }
    if (name === "spawn_slide_agent" && canUseGenerated && Array.isArray(cachedGenerated)) {
      return { generated: cachedGenerated };
    }
    if (typeof baseExecutor === "function") {
      return baseExecutor(name, params, context);
    }
    const tool = agentLoop._tools?.[name];
    if (typeof tool === "function") {
      return tool(params, context);
    }
    return { ok: false, error: `Unknown tool: ${name}` };
  };

  return agentLoop.run(contentPackage, {
    ...stageApi,
    runContext,
    resumed: true,
    resumeState,
    toolExecutor,
  });
}
