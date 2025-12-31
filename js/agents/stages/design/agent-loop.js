import { Archive, FallbackAdapter, MapAdapter } from "../../shared/archive/archive.js";
import { deepClone } from "../../shared/utils/value-utils.js";
import { CheckpointType, createCheckpoint, migrateCheckpoint } from "../../shared/archive/checkpoint-schema.js";
import { DesignPhase, designPhaseMachine } from "./states.js";
import { AgentStatus } from "../../runtime/core/agent-status.js";
import { BaseAgentLoop, checkCancelled, getEmitFn, resolveToolExecutor } from "../../runtime/core/agent-loop.js";
import { StagePausedError } from "../../runtime/core/stage-errors.js";
import { getRuntimeState } from "../../runtime/telemetry/loop-runtime-state.js";
import { DESIGN_AGENT_TOOL_DEFINITIONS, createDesignToolHandlers } from "./design-tools.js";
import { VisualHandler } from "./runtime/visual-handler.js";
import { runPreparationPhase, runGeneratingPhase, runBatchRepairPhase, runVisualPhase, runReviewPhase, runPlanningPhase, runLayoutPhase } from "./runtime/design-phases.js";
import { DesignBlackboard } from "./runtime/design-blackboard.js";

const SCHEMA_VERSION = "0.1";

// === 可配置常量 ===
const DESIGN_LOOP_DEFAULTS = {
  batchSize: 4,
  batchConcurrency: 2,
  imageConcurrency: 4,
  maxIterations: 10,
  maxBacktrackAttempts: 3,
  signatureLength: 64, // deck 签名截取长度
};

/**
 * BacktrackError - 回溯信号异常
 * 抛出此异常触发主循环从目标阶段重启
 */
export class BacktrackError extends Error {
  constructor(targetPhase, label, reason) {
    super(`Backtrack to ${targetPhase} (${label}): ${reason}`);
    this.name = "BacktrackError";
    this.targetPhase = targetPhase;
    this.label = label;
    this.reason = reason;
  }
}

// Re-export for backward compatibility
export { DESIGN_AGENT_TOOL_DEFINITIONS };

function emitStage(emit, name, status, payload) {
  emit?.(name, { actor: "design", status, payload });
}

function loadDesignConcurrencyConfig() {
  // 优先级: localStorage > 环境变量 > 进程参数 > 默认值
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem("ppt_designConcurrency") : null;
    if (raw) return JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[design] Failed to parse localStorage "ppt_designConcurrency": ${message}`);
  }
  // 环境变量回退
  const env = typeof process !== "undefined" ? process.env : {};
  const batchSize = parseInt(env.DESIGN_BATCH_SIZE, 10);
  const batchConcurrency = parseInt(env.DESIGN_BATCH_CONCURRENCY, 10);
  const imageConcurrency = parseInt(env.DESIGN_IMAGE_CONCURRENCY, 10);
  if (batchSize > 0 || batchConcurrency > 0 || imageConcurrency > 0) {
    return {
      ...(batchSize > 0 ? { batchSize } : {}),
      ...(batchConcurrency > 0 ? { batchConcurrency } : {}),
      ...(imageConcurrency > 0 ? { imageConcurrency } : {}),
    };
  }
  return null;
}

export class DesignAgentLoop extends BaseAgentLoop {
  constructor({ batchSize, archive, eventBus, tools } = {}) {
    super({ actor: "design", stageName: "design", eventBus });
    const config = loadDesignConcurrencyConfig();
    const defaultBatchSize = config?.batchSize || DESIGN_LOOP_DEFAULTS.batchSize;
    this.batchSize = Math.max(1, Number(batchSize) || defaultBatchSize);
    this.batchConcurrency = Math.max(1, Number(config?.batchConcurrency) || DESIGN_LOOP_DEFAULTS.batchConcurrency);
    this.imageConcurrency = Math.max(1, Number(config?.imageConcurrency) || DESIGN_LOOP_DEFAULTS.imageConcurrency);
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
    this._maxIterations = DESIGN_LOOP_DEFAULTS.maxIterations;
    this._iteration = 0;

    // Runtime state (春秋蝉模式)
    this.state = {
      contentPackage: null,
      slideIntents: [],
      designSystem: null,
      constraints: {},
      userConfig: {},
      plans: null,
      generated: [],
      slideHtmls: [],
      slidesMeta: [],
      imageSlots: [],
      visualSlots: [],
      deckHtmlDsl: "",
      pendingImages: [],
      brainstormResult: null,
    };

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
      state: deepClone(this.state), // 保存当前执行快照
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

  /**
   * 回溯到指定版本（抛出 BacktrackError 触发主循环重启）
   * @param {string} label - 版本标签
   * @param {string} [reason] - 回溯原因
   * @throws {BacktrackError} 触发主循环从目标阶段重启
   */
  backtrackTo(label, reason = "user_requested") {
    if (!this._blackboard) throw new Error("Cannot backtrack: no blackboard");
    const version = this._blackboard.getVersion(label);
    if (!version) throw new Error(`Cannot backtrack: version "${label}" not found`);
    // 恢复状态
    const targetPhase = version.snapshot?.phase || DesignPhase.IDLE;
    if (version.snapshot?.phase) this.phase.status = version.snapshot.phase;
    if (version.snapshot?.loopStatus) this._loopStatus = version.snapshot.loopStatus;

    // 深度恢复 state (对照 BacktrackManager)
    if (version.snapshot?.state) {
      this.state = deepClone(version.snapshot.state);
    }

    this._blackboard.restoreVersion(label);
    this._emit?.("design.backtrack", { label, targetPhase, reason, timestamp: Date.now() });

    // 标记正在回溯，防止 _runCore 重置状态
    this._isBacktracking = true;
    // 抛出 BacktrackError 触发主循环重启
    throw new BacktrackError(targetPhase, label, reason);
  }

  /**
   * 回溯到最近的 checkpoint
   * @param {string} [reason] - 回溯原因
   * @throws {BacktrackError} 触发主循环从目标阶段重启
   */
  backtrackToLastCheckpoint(reason = "auto_recovery") {
    const versions = this.listVersions();
    if (versions.length === 0) throw new Error("Cannot backtrack: no versions available");
    const latest = versions[versions.length - 1];
    this.backtrackTo(latest.label, reason);
  }

  getToolDefinitions() {
    return DESIGN_AGENT_TOOL_DEFINITIONS.slice();
  }

  serializeNodeStates() {
    const state = this.state && typeof this.state === "object" ? this.state : {};
    const out = {
      contentPackage: state.contentPackage ?? null,
      slideIntents: Array.isArray(state.slideIntents) ? state.slideIntents : [],
      designSystem: state.designSystem ?? null,
      slideHtmls: Array.isArray(state.slideHtmls) ? state.slideHtmls : [],
      deckHtmlDsl: typeof state.deckHtmlDsl === "string" ? state.deckHtmlDsl : "",
      imageSlots: Array.isArray(state.imageSlots) ? state.imageSlots : [],
      visualSlots: Array.isArray(state.visualSlots) ? state.visualSlots : [],
    };
    return deepClone(out);
  }

  hydrateFromNodeStates(nodeStates) {
    const source = nodeStates && typeof nodeStates === "object" ? nodeStates : {};
    if (!this.state || typeof this.state !== "object") this.state = {};

    const contentPackage = source.contentPackage || source.parsedContentPackage || null;
    if (contentPackage && typeof contentPackage === "object") {
      this.state.contentPackage = deepClone(contentPackage);
    }

    if (Array.isArray(source.slideIntents)) {
      this.state.slideIntents = deepClone(source.slideIntents);
    }

    if (source.designSystem && typeof source.designSystem === "object") {
      this.state.designSystem = deepClone(source.designSystem);
    }

    if (Array.isArray(source.slideHtmls)) {
      this.state.slideHtmls = deepClone(source.slideHtmls);
    }

    if (typeof source.deckHtmlDsl === "string") {
      this.state.deckHtmlDsl = source.deckHtmlDsl;
    }

    if (Array.isArray(source.imageSlots)) {
      this.state.imageSlots = deepClone(source.imageSlots);
    }

    if (Array.isArray(source.visualSlots)) {
      this.state.visualSlots = deepClone(source.visualSlots);
    }
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
    const serialized = this.serializeNodeStates();
    const mergedNodeStates = {
      ...(serialized && typeof serialized === "object" ? serialized : {}),
      ...(nodeStates && typeof nodeStates === "object" ? nodeStates : {}),
    };
    const state = {
      phase: this.phase?.status,
      loopStatus: this._loopStatus,
      statusHistory: this._statusHistory.map((entry) => ({ ...entry })),
      ...mergedNodeStates,
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
    if (this.state && typeof this.state === "object") {
      this.state.visualSlots = Array.isArray(visualSlotsForRender) ? deepClone(visualSlotsForRender) : [];
    }
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
   * 支持 BacktrackError 自动重启机制
   * @param {object} contentPackage
   * @param {{runContext?:object,emit?:Function,eventBus?:object,signal?:AbortSignal,aiApiService?:object,imageService?:any,imageProvider?:any}=} context
   */
  async run(contentPackage, context = {}) {
    let backtrackAttempts = 0;
    const maxAttempts = DESIGN_LOOP_DEFAULTS.maxBacktrackAttempts;

    // BacktrackError 重启循环
    while (backtrackAttempts <= maxAttempts) {
      try {
        return await this._runCore(contentPackage, context);
      } catch (err) {
        if (err instanceof BacktrackError && backtrackAttempts < maxAttempts) {
          backtrackAttempts++;
          this._emit?.("design.backtrack.restart", {
            attempt: backtrackAttempts,
            maxAttempts,
            targetPhase: err.targetPhase,
            reason: err.reason,
          });
          // 继续循环，从恢复的状态重新执行
          continue;
        }
        throw err;
      }
    }
    throw new Error(`Max backtrack attempts (${maxAttempts}) exceeded`);
  }

  /**
   * 核心执行逻辑（从 run 提取）
   * @private
   */
  async _runCore(contentPackage, context = {}) {
    const runContext = context.runContext || { runId: contentPackage?.runId || "run_unknown", constraints: contentPackage?.constraints || {} };
    const runId = runContext.runId || contentPackage?.runId || "run_unknown";
    this.eventBus = context.eventBus || this.eventBus || null;
    let emit = getEmitFn(context);
    if ((!emit || emit === this.eventBus?.emit) && this.eventBus?.emit) {
      emit = this.eventBus.emit.bind(this.eventBus);
    }
    this.emit = emit || this.emit || null;

    // 仅在初始运行时初始化状态，回溯重启时保留已恢复的状态
    if (!context.resumed && !this._isBacktracking) {
      this.phase = { status: DesignPhase.IDLE };
      this._blackboard = new DesignBlackboard({ runId });
      this._iteration = 0;
      this.state.contentPackage = contentPackage;
    }
    this._isBacktracking = false;

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
      const sigLen = DESIGN_LOOP_DEFAULTS.signatureLength;
      const head = deckHtmlDsl.slice(0, sigLen);
      const tail = deckHtmlDsl.slice(-sigLen);
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
        slideCount: Array.isArray(this.state.contentPackage?.slideIntents) ? this.state.contentPackage.slideIntents.length : 0,
      });

      // --- 1. Preparation Phase (Outline + Style) ---
      if (!this.phase.status || this.phase.status === DesignPhase.IDLE || this.phase.status === DesignPhase.OUTLINE_PARSING) {
        const prepResult = await runPreparationPhase(this, {
          contentPackage: this.state.contentPackage,
          context,
          runContext,
          emit,
          startExecution,
          finishExecution,
        });
        // 更新持久化状态
        this.state.contentPackage = prepResult.parsedContentPackage;
        this.state.slideIntents = prepResult.slideIntents;
        this.state.designSystem = prepResult.designSystem;
        this.state.constraints = prepResult.constraints;
        this.state.userConfig = prepResult.userConfig;

        this._blackboard.setSummary("outline", `${this.state.slideIntents.length} slides parsed`);
        this._blackboard.setSummary("style", this.state.designSystem?.theme || "default");
        this._blackboard.logDecision("preparation_complete", `Parsed ${this.state.slideIntents.length} slides`);
      }

      // --- 2. Planning Phase ---
      if (context?.enablePlanning !== false && (!this.state.plans || this.phase.status === DesignPhase.DECK_PLANNING)) {
        const planningResult = await runPlanningPhase(this, {
          slideIntents: this.state.slideIntents,
          designSystem: this.state.designSystem,
          context,
          runContext,
          emit,
        });
        this.state.plans = planningResult.plans;
        this._blackboard.setSummary("plan", `${this.state.plans.length} slides planned`);
      }

      // --- 3. Layout Phase (New!) ---
      if (context?.enableLayout !== false && (!this.state.layoutData || this.phase.status === DesignPhase.LAYOUT_DEVELOPING)) {
        const layoutResult = await runLayoutPhase(this, {
          slideIntents: this.state.slideIntents,
          designSystem: this.state.designSystem,
          plans: this.state.plans,
          context,
          runContext,
          emit,
          startExecution,
          finishExecution,
        });
        this.state.layoutData = layoutResult;
        this._blackboard.setSummary("layout", "Wireframes generated");
      }

      this._transitionPhase(this.phase, DesignPhase.GENERATING, { emit, runId: runContext.runId });
      this.state.userConfig = this.applyUserInputsToConfig(this.state.userConfig);

      // --- 4. Generating Phase ---
      if (this.phase.status === DesignPhase.GENERATING) {
        const genPhaseResult = await runGeneratingPhase(this, {
          slideIntents: this.state.slideIntents,
          contentPackage: this.state.contentPackage,
          designSystem: this.state.designSystem,
          constraints: this.state.constraints,
          userConfig: this.state.userConfig,
          context,
          runContext,
          emit,
          startExecution,
          finishExecution,
          emitDeckUpdate,
          plans: this.state.plans,
          layoutData: this.state.layoutData,
        });

        this.state.generated = genPhaseResult.generated;
        this.state.slideHtmls = genPhaseResult.slideHtmls;
        this.state.slidesMeta = genPhaseResult.slidesMeta;
        this.state.imageSlots = genPhaseResult.imageSlots;
        this.state.baseDeckHtmlDsl = genPhaseResult.baseDeckHtmlDsl;
        this.state.pendingImages = genPhaseResult.pendingImages;
        this.state.brainstormResult = genPhaseResult.brainstormResult;
        this.state.degradedCount = genPhaseResult.degradedCount;

        this.state.userConfig = this.applyUserInputsToConfig(this.state.userConfig);

        // --- 5. Batch Repair Phase (Orchestrated Health Check & Fix) ---
        const repairResult = await runBatchRepairPhase(this, {
          slideHtmls: this.state.slideHtmls,
          slidesMeta: this.state.slidesMeta,
          designSystem: this.state.designSystem,
          contentPackage: this.state.contentPackage,
          baseDeckHtmlDsl: this.state.baseDeckHtmlDsl
        }, { context, runContext, emit });

        this.state.deckHtmlDsl = repairResult.deckHtmlDsl;
        this.state.slidesMeta = repairResult.slidesMeta;
        this.state.baseDeckHtmlDsl = repairResult.deckHtmlDsl; // Update base for next steps

        // --- 5. Visual Filling Phase ---
        const visualPhaseResult = await runVisualPhase(this, {
          contentPackage: this.state.contentPackage,
          slideIntents: this.state.slideIntents,
          designSystem: this.state.designSystem,
          generated: this.state.generated,
          slideHtmls: this.state.slideHtmls,
          slidesMeta: this.state.slidesMeta,
          imageSlots: this.state.imageSlots,
          baseDeckHtmlDsl: this.state.baseDeckHtmlDsl,
          pendingImages: this.state.pendingImages,
          brainstormResult: this.state.brainstormResult,
          constraints: this.state.constraints,
          userConfig: this.state.userConfig,
          context,
          runContext,
          emit,
          startExecution,
          finishExecution,
          emitDeckUpdate,
        });

        this.state.deckHtmlDsl = visualPhaseResult.deckHtmlDsl;
        this.state.slidesMeta = visualPhaseResult.slidesMeta;
        this.state.finalImageSlots = visualPhaseResult.imageSlots;
        this.state.visualReport = visualPhaseResult.visualReport;
        this.state.imageReport = visualPhaseResult.imageReport;
        this.state.refineResult = visualPhaseResult.refineResult;
        if (Array.isArray(visualPhaseResult.pendingImages)) {
          this.state.pendingImages = visualPhaseResult.pendingImages;
        }

        // --- 7. Final Review Phase (Optional final audit) ---
        const skipReview = context?.skipReview === true || context?.interactionMode?.finalReview === "skip";
        if (context?.enableFinalReview === true && !skipReview) {
          this._transitionPhase(this.phase, DesignPhase.REVIEWING, { emit, runId: runId });
          const finalReviewResult = await runReviewPhase(this, {
            deckHtmlDsl: this.state.deckHtmlDsl,
            slidesMeta: this.state.slidesMeta,
            designSystem: this.state.designSystem,
            context,
            runContext,
            emit,
          });
          this.state.reviewResult = finalReviewResult.reviewResult;
        }

        this._transitionPhase(this.phase, DesignPhase.COMPLETED, { emit, runId: runContext.runId });
        await this._transitionTo(AgentStatus.COMPLETED, {
          runId,
          iteration,
          stageApi,
          state: buildLoopState("completed"),
        });

        this._blackboard.setSummary("generation", `${this.state.slideHtmls.length} slides generated`);
        this._blackboard.saveVersion("final", {
          deckHtmlDsl: this.state.deckHtmlDsl,
          designSystem: this.state.designSystem,
          slidesMeta: this.state.slidesMeta,
        });

        emitStage(emit, "design.ended", "ended", { slides: this.state.slideHtmls.length, degradedCount: this.state.degradedCount });

        return {
          schemaVersion: SCHEMA_VERSION,
          runId: runContext.runId,
          designSystem: this.state.designSystem,
          deckHtmlDsl: this.state.deckHtmlDsl,
          slidesMeta: this.state.slidesMeta,
          editHints: { degradedCount: this.state.degradedCount },
          imageSlots: this.state.finalImageSlots,
          imageReport: this.state.imageReport,
          visualReport: this.state.visualReport,
          pendingImages: this.state.pendingImages,
          refineReport: this.state.refineResult || null,
          reviewReport: this.state.reviewResult || null,
        };
      }

      await this._transitionTo(AgentStatus.COMPLETED, {
        runId,
        iteration,
        stageApi,
        state: buildLoopState("completed"),
      });

      return {
        schemaVersion: SCHEMA_VERSION,
        runId: runContext.runId,
        designSystem: null,
        deckHtmlDsl: "",
        slidesMeta: [],
      };
    } catch (err) {
      // BacktrackError: 重新抛出让外层 while 循环处理
      if (err instanceof BacktrackError) {
        throw err;
      }
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
  const archive =
    stageApi?.archive ||
    new Archive(typeof indexedDB !== "undefined" ? new FallbackAdapter("PPTArchiveDB", "checkpoints") : new MapAdapter());

  const snapshot = migrateCheckpoint(await archive.restore(checkpointId));
  if (!snapshot?.nodeStates) {
    throw new Error(`Checkpoint not found: ${checkpointId}`);
  }

  const nodeStates = snapshot.nodeStates || {};

  const agentLoop = new DesignAgentLoop({ ...stageApi, archive });
  const restoredLoopStatus = nodeStates.loopStatus || AgentStatus.IDLE;
  const restoredPhase = nodeStates.phase || DesignPhase.IDLE;

  agentLoop._loopStatus = AgentStatus.IDLE;
  // Start from a valid "forward" phase to avoid illegal transitions when resuming.
  agentLoop.phase = { status: DesignPhase.IDLE };
  if (Array.isArray(nodeStates.statusHistory)) {
    agentLoop._statusHistory = nodeStates.statusHistory.map((entry) => ({ ...entry }));
  }

  agentLoop._pauseRequested = false;
  agentLoop._pauseReason = null;

  agentLoop.hydrateFromNodeStates(nodeStates);

  const resumeState = {
    phase: restoredPhase,
    loopStatus: restoredLoopStatus,
    contentPackage: agentLoop.state?.contentPackage || null,
    parsedContentPackage: nodeStates.parsedContentPackage || null,
    slideIntents: Array.isArray(agentLoop.state?.slideIntents) ? agentLoop.state.slideIntents : null,
    designSystem: agentLoop.state?.designSystem || null,
    generated: Array.isArray(nodeStates.generated) ? nodeStates.generated : null,
    slideHtmls: Array.isArray(agentLoop.state?.slideHtmls) ? agentLoop.state.slideHtmls : null,
    deckHtmlDsl: typeof agentLoop.state?.deckHtmlDsl === "string" ? agentLoop.state.deckHtmlDsl : "",
    slidesMeta: Array.isArray(nodeStates.slidesMeta) ? nodeStates.slidesMeta : null,
    imageSlots: Array.isArray(agentLoop.state?.imageSlots) ? agentLoop.state.imageSlots : null,
    visualSlots: Array.isArray(agentLoop.state?.visualSlots) ? agentLoop.state.visualSlots : null,
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
  if (agentLoop.state && typeof agentLoop.state === "object" && !agentLoop.state.contentPackage) {
    agentLoop.state.contentPackage = deepClone(contentPackage);
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
    [DesignPhase.OUTLINE_CONFIRMING]: 1,
    [DesignPhase.STYLE_EXTRACTING]: 1,
    [DesignPhase.STYLE_CONFIRMING]: 2,
    [DesignPhase.DECK_PLANNING]: 2,
    [DesignPhase.PLAN_CONFIRMING]: 2,
    [DesignPhase.LAYOUT_ANALYZING]: 3,
    [DesignPhase.LAYOUT_GENERATING]: 4,
    [DesignPhase.LAYOUT_DEVELOPING]: 4,
    [DesignPhase.LAYOUT_CONFIRMING]: 4,
    [DesignPhase.GENERATING]: 5,
    [DesignPhase.GENERATING_PAUSED]: 5,
    [DesignPhase.REVIEWING]: 6,
    [DesignPhase.FIXING]: 6,
    [DesignPhase.REPAIR]: 6,
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
