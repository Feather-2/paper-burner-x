import { Archive, MapAdapter } from "../../shared/archive/archive.js";
import { CheckpointType, createCheckpoint, migrateCheckpoint } from "../../shared/archive/checkpoint-schema.js";
import { DesignPhase, designPhaseMachine } from "./states.js";
import { AgentStatus } from "../../runtime/core/agent-status.js";
import { BaseAgentLoop, checkCancelled, getEmitFn, resolveToolExecutor } from "../../runtime/core/agent-loop.js";
import { StagePausedError } from "../../runtime/core/stage-errors.js";
import { getRuntimeState } from "../../runtime/telemetry/loop-runtime-state.js";
import { DESIGN_AGENT_TOOL_DEFINITIONS, createDesignToolHandlers } from "./design-tools.js";
import { VisualHandler } from "./runtime/visual-handler.js";
import { runPreparationPhase, runGeneratingPhase, runVisualPhase } from "./runtime/design-phases.js";
import { DesignBlackboard } from "./runtime/design-blackboard.js";

const SCHEMA_VERSION = "0.1";

// Re-export for backward compatibility
export { DESIGN_AGENT_TOOL_DEFINITIONS };

function emitStage(emit, name, status, payload) {
  emit?.(name, { actor: "design", status, payload });
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
    // Inject VisualHandler
    this._visualHandler = new VisualHandler({ imageConcurrency: this.imageConcurrency });
    this._tools = createDesignToolHandlers(this);
    this.registerTools(this._tools);
    if (tools) this.registerTools(tools);
    this.phase = { status: DesignPhase.IDLE };
    this._loopStatus = AgentStatus.IDLE;
    this._statusHistory = [];
    this.archive = archive || null;
    // Blackboard for cross-phase communication
    this._blackboard = new DesignBlackboard();
    // Loop control
    this._maxIterations = 10;
    this._iteration = 0;
    // Expose tool methods for backward compatibility (tests)
    this._toolParseOutline = this._tools.parse_outline;
    this._toolExtractStyle = this._tools.extract_style;
    this._toolSpawnSlideAgent = this._tools.spawn_slide_agent;
    this._toolTakeScreenshot = this._tools.take_screenshot;
    this._toolFixSlide = this._tools.fix_slide;
    this._toolFillVisual = this._tools.fill_visual;
    this._toolChatAsk = this._tools.chat_ask;
  }

  get blackboard() {
    return this._blackboard;
  }

  // === Version Management ===

  saveVersion(label) {
    if (!this._blackboard) return null;
    const snapshot = {
      phase: this.phase?.status,
      loopStatus: this._loopStatus,
      timestamp: Date.now(),
    };
    return this._blackboard.saveVersion(label, snapshot);
  }

  getVersion(label) {
    return this._blackboard?.getVersion(label) || null;
  }

  listVersions() {
    return this._blackboard?.listVersions() || [];
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

      // 发出暂停状态变更事件
      this._emitAgentStatusChanged({ from: oldStatus, to: AgentStatus.PAUSED, timestamp, pausedReason: reason });

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

    // 发出状态变更事件，供 UI/Workflow 层监听
    this._emitAgentStatusChanged({ from: oldStatus, to: newStatus, timestamp, ...historyMeta });

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

  // Delegate to VisualHandler
  async _initDesignSystem(contentPackage, context, constraints, userConfig) {
    return this._visualHandler.initDesignSystem(contentPackage, context, constraints, userConfig);
  }

  _buildVisualSlots(brainstormResult, imageSlots, imageProvider, hasModelCapability = true) {
    return this._visualHandler.buildVisualSlots(brainstormResult, imageSlots, imageProvider, hasModelCapability);
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
    return this._visualHandler.renderVisuals(
      visualSlotsForRender,
      contentPackage,
      designSystem,
      slideHtmls,
      context,
      runContext,
      constraints,
      imageSlots,
      aiImageSlotIds
    );
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
    // Reset blackboard for new run
    this._blackboard = new DesignBlackboard({ runId });
    this._iteration = 0;

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

      // Preparation phase: outline parsing + style extraction
      const prepResult = await runPreparationPhase(this, {
        contentPackage,
        context,
        runContext,
        emit,
        startExecution,
        finishExecution,
      });
      const { parsedContentPackage, slideIntents, designSystem, constraints } = prepResult;
      let { userConfig } = prepResult;

      // Update blackboard with preparation results
      this._blackboard.setSummary("outline", `${slideIntents.length} slides parsed`);
      this._blackboard.setSummary("style", designSystem?.theme || "default");
      this._blackboard.logDecision("preparation_complete", `Parsed ${slideIntents.length} slides with theme: ${designSystem?.theme || "default"}`);

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
        // Run generating phase
        const genPhaseResult = await runGeneratingPhase(this, {
          slideIntents,
          contentPackage: parsedContentPackage,
          designSystem,
          constraints,
          userConfig,
          context,
          runContext,
          emit,
          startExecution,
          finishExecution,
          emitDeckUpdate,
          skipReview,
        });

        userConfig = this.applyUserInputsToConfig(userConfig);

        // Run visual phase
        const visualPhaseResult = await runVisualPhase(this, {
          contentPackage: parsedContentPackage,
          slideIntents,
          designSystem,
          generated: genPhaseResult.generated,
          slideHtmls: genPhaseResult.slideHtmls,
          slidesMeta: genPhaseResult.slidesMeta,
          imageSlots: genPhaseResult.imageSlots,
          baseDeckHtmlDsl: genPhaseResult.baseDeckHtmlDsl,
          pendingImages: genPhaseResult.pendingImages,
          brainstormResult: genPhaseResult.brainstormResult,
          constraints,
          userConfig,
          context,
          runContext,
          emit,
          startExecution,
          finishExecution,
          emitDeckUpdate,
        });

        this._transitionPhase(this.phase, DesignPhase.COMPLETED, { emit, runId: runContext.runId });
        await this._transitionTo(AgentStatus.COMPLETED, {
          runId,
          iteration,
          stageApi,
          state: buildLoopState("completed"),
        });

        const degradedCount = genPhaseResult.degradedCount;
        // Update blackboard with final results
        this._blackboard.setSummary("generation", `${genPhaseResult.slideHtmls.length} slides generated, ${degradedCount} degraded`);
        this._blackboard.logDecision("generation_complete", `Generated ${genPhaseResult.slideHtmls.length} slides`);

        // Save version snapshot
        this._blackboard.saveVersion("final", {
          deckHtmlDsl: visualPhaseResult.deckHtmlDsl,
          designSystem,
          slidesMeta: visualPhaseResult.slidesMeta,
        });

        emitStage(emit, "design.ended", "ended", { slides: genPhaseResult.slideHtmls.length, degradedCount });

        return {
          schemaVersion: SCHEMA_VERSION,
          runId: runContext.runId,
          designSystem,
          deckHtmlDsl: visualPhaseResult.deckHtmlDsl,
          slidesMeta: visualPhaseResult.slidesMeta,
          editHints: { degradedCount },
          imageSlots: visualPhaseResult.imageSlots,
          imageReport: visualPhaseResult.imageReport,
          visualReport: visualPhaseResult.visualReport,
          pendingImages: visualPhaseResult.pendingImages,
          refineReport: visualPhaseResult.refineResult || null,
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
