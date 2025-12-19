// DeepSearch stage entry: S2-S7 pipeline to produce ContentPackage v0.1 (DeepSearch mode).

import { buildContentPackage } from "../textprep/build-content-package.js";
import { DeepSearchState, checkCancelled, computeRoundHitsByGapId, generateNodeId, makeStageEmitter, validateIteration } from "./state.js";
import { runDeepSearchScanStage } from "./scan.js";
import { runDeepSearchGapsStage } from "./gaps.js";
import { parseExternalSearchConfig, runDeepSearchRetrieveStage, runExternalSearch } from "./retrieve.js";
import { runDeepSearchUnderstandStage } from "./understand.js";
import { generateReport, runDeepSearchWriteStage } from "./write.js";
import { runDeepSearchCondenseStage } from "./condense.js";
import { TrajectoryManager } from "./trajectory.js";
import { DeepSearchError, ErrorHandler, ErrorLevel } from "../../core/error-handler.js";
import { createLogger } from "./logger.js";
import { SharedContext } from "./shared-context.js";
import { shouldUseDirectMode, runDirectAnalysis } from "./direct-analysis.js";
import { isPlainObject, safeInt } from "../../shared/value-utils.js";
import { mapConcurrent } from "../../shared/concurrency.js";
import { CONCURRENCY_CONFIG, GAP_CONFIG, PhaseStatus, PHASE_TRANSITIONS } from "./constants.js";
import { DeepSearchEvents } from "./events.js";
import { BudgetAction, createBudgetManager } from "./budget.js";
import { validateUserConfig } from "./config-schema.js";
import { extractServices } from "./stage-api.js";

function validateSourceChunksOrThrow(sources) {
  for (const s of Array.isArray(sources) ? sources : []) {
    if (!s || typeof s !== "object") continue;
    const sourceText = typeof s.sourceTextNormalized === "string" ? s.sourceTextNormalized : "";
    const chunks = Array.isArray(s.chunks) ? s.chunks : [];
    if (!chunks.length) continue;

    for (const c of chunks) {
      const charStart = safeInt(c?.locator?.charStart);
      const charEnd = safeInt(c?.locator?.charEnd);
      if (charStart === null || charEnd === null) throw new Error("Hard gate H2 failed: chunk locator must include charStart/charEnd");
      if (!(charStart < charEnd)) throw new Error("Hard gate H2 failed: chunk locator.charStart must be < charEnd");
      if (charStart < 0 || charEnd > sourceText.length) throw new Error("Hard gate H2 failed: chunk locator out of bounds");
    }
  }
}

function createEmitTap(emitFn, { maxListeners } = {}) {
  const listeners = new Map(); // name -> Set(fn)
  let destroyed = false;

  const on = (name, handler) => {
    if (typeof handler !== "function") throw new TypeError("createEmitTap().on(name, handler): handler must be a function");
    const key = String(name || "");
    if (!key) throw new TypeError("createEmitTap().on(name, handler): name must be a non-empty string");
    if (destroyed) return () => {};
    let set = listeners.get(key);
    if (!set) {
      set = new Set();
      listeners.set(key, set);
    }
    if (typeof maxListeners === "number" && Number.isFinite(maxListeners) && maxListeners > 0) {
      if (!set.has(handler) && set.size >= maxListeners) {
        throw new RangeError(`createEmitTap().on(name, handler): maxListeners (${maxListeners}) exceeded for "${key}"`);
      }
    }
    set.add(handler);
    return () => {
      const cur = listeners.get(key);
      if (!cur) return;
      cur.delete(handler);
      if (cur.size === 0) listeners.delete(key);
    };
  };

  const destroy = () => {
    destroyed = true;
    listeners.clear();
  };

  const emit = (name, record) => {
    const result = typeof emitFn === "function" ? emitFn(name, record) : undefined;
    if (destroyed) return result;
    const key = String(name || "");
    const direct = listeners.get(key);
    if (direct) for (const fn of [...direct]) fn({ name: key, record });
    const any = listeners.get("*");
    if (any) for (const fn of [...any]) fn({ name: key, record });
    return result;
  };

  return { emit, on, destroy };
}

function safeMergeConfig(base, override) {
  const baseObj = isPlainObject(base) ? base : {};
  const overrideObj = isPlainObject(override) ? override : null;
  if (!overrideObj) return { ...baseObj };

  const out = { ...baseObj };
  for (const [k, v] of Object.entries(overrideObj)) {
    if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
    const existing = out[k];
    if (isPlainObject(existing) && isPlainObject(v)) {
      out[k] = safeMergeConfig(existing, v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function isResumedInput(input) {
  if (input instanceof DeepSearchState) return true;
  if (input?.state instanceof DeepSearchState) return true;
  if (isPlainObject(input?.state)) return true;
  return false;
}

function ensureState(runContext, input) {
  if (input instanceof DeepSearchState) return input;
  if (input?.state instanceof DeepSearchState) return input.state;
  if (isPlainObject(input?.state)) return DeepSearchState.fromJSON(input.state);

  const sources = Array.isArray(input?.sources) ? input.sources : [];
  validateSourceChunksOrThrow(sources);
  const taskGoal = typeof input?.taskGoal === "string" ? input.taskGoal : "";
  const userConfig = isPlainObject(input?.userConfig) ? input.userConfig : {};
  const s = new DeepSearchState({ runId: runContext?.runId, taskGoal, userConfig, L0: { sources } });
  const maxIt = safeInt(userConfig?.maxIterations);
  if (maxIt !== null && maxIt >= 1) s.maxIterations = maxIt;
  return s;
}

function applyMergedState(target, merged) {
  if (!(target instanceof DeepSearchState)) throw new TypeError("applyMergedState(target, merged): target must be a DeepSearchState");
  if (!(merged instanceof DeepSearchState)) throw new TypeError("applyMergedState(target, merged): merged must be a DeepSearchState");

  target.schemaVersion = merged.schemaVersion;
  target.runId = merged.runId;
  target.createdAt = merged.createdAt;
  target.taskGoal = merged.taskGoal;
  target.userConfig = merged.userConfig;
  target.trajectoryId = merged.trajectoryId;
  target.trajectoryConfig = merged.trajectoryConfig;
  target.planningTree = merged.planningTree;
  target.iteration = merged.iteration;
  target.maxIterations = merged.maxIterations;
  target.checkpoints = merged.checkpoints;
  target.L0 = merged.L0;
  target.L1 = merged.L1;
  target.L2 = merged.L2;
  target.todos = merged.todos;
  target.timeline = merged.timeline;
}

function getTrajectoryConfig(state) {
  const cfg = isPlainObject(state?.userConfig?.trajectory) ? state.userConfig.trajectory : {};
  const rawN = safeInt(cfg.n) ?? 1;
  const enabled = cfg.enabled === true || rawN > 1;
  const n = enabled ? Math.max(2, rawN) : 1;
  const mergeStrategy = enabled && typeof cfg.mergeStrategy === "string" ? cfg.mergeStrategy : "best";
  const qualityMetrics = Array.isArray(cfg.qualityMetrics) ? cfg.qualityMetrics : [];
  const divergeAt = typeof cfg.divergeAt === "string" ? cfg.divergeAt : "gap";
  const cachePolicy = typeof cfg.cachePolicy === "string" ? cfg.cachePolicy : "share";
  const cacheMaxSize = safeInt(cfg.cacheMaxSize) ?? 100;
  return { enabled, n, mergeStrategy, qualityMetrics, divergeAt, cachePolicy, cacheMaxSize };
}

function isOpenGap(g) {
  return String(g?.status || "open") === "open";
}

function openGaps(state) {
  const gaps = Array.isArray(state?.L1?.gaps) ? state.L1.gaps : [];
  return gaps.filter(isOpenGap);
}

function getGapBlockAfterMisses(state) {
  const cfg = isPlainObject(state?.userConfig?.gaps) ? state.userConfig.gaps : {};
  const n = safeInt(cfg.blockAfterMisses);
  // 默认值从 5 调整为 3，减少无效空转
  return n !== null && n >= 1 ? n : GAP_CONFIG.BLOCK_AFTER_MISSES;
}

function normalizeQualityThreshold(v) {
  if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, Math.min(1, v));
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.max(0, Math.min(1, n));
  }
  return null;
}

function getQualityThreshold(state) {
  const gapsCfg = isPlainObject(state?.userConfig?.gaps) ? state.userConfig.gaps : {};
  const retrievalCfg = isPlainObject(state?.userConfig?.retrieval) ? state.userConfig.retrieval : {};
  return (
    normalizeQualityThreshold(gapsCfg.qualityThreshold) ??
    normalizeQualityThreshold(retrievalCfg.qualityThreshold) ??
    GAP_CONFIG.QUALITY_THRESHOLD
  );
}

function getNoNewHitsRoundsStopThreshold(state) {
  const gapsCfg = isPlainObject(state?.userConfig?.gaps) ? state.userConfig.gaps : {};
  const n = safeInt(gapsCfg.noNewHitsRounds);
  if (n !== null && n >= 1) return Math.min(10, n);
  return GAP_CONFIG.NO_NEW_HITS_ROUNDS;
}

function getTrajectoryParallel(state) {
  const cfg = isPlainObject(state?.userConfig?.concurrency) ? state.userConfig.concurrency : {};
  const n = safeInt(cfg.maxTrajectoryParallel);
  return n !== null && n >= 1 ? n : CONCURRENCY_CONFIG.MAX_TRAJECTORY_PARALLEL;
}

/**
 * Phase 状态转换函数，带日志追踪
 */
function transitionPhase(from, to, { emit, logger, runId, iteration, trajectoryId } = {}) {
  const allowed = PHASE_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    logger?.warn(`Invalid phase transition: ${from} → ${to}`, {
      stage: "deepsearch",
      data: { from, to, allowed, runId, iteration, trajectoryId },
    });
    return false;
  }

  logger?.info(`Phase transition: ${from} → ${to}`, {
    stage: "deepsearch",
    data: { from, to, runId, iteration, trajectoryId },
  });

  emit?.(DeepSearchEvents.PHASE_TRANSITION, {
    runId,
    from,
    to,
    iteration,
    trajectoryId,
  });

  return true;
}

function signatureForRetrievedChunk(r) {
  const gapId = String(r?.gapId || "");
  const sourceId = String(r?.sourceId || "");
  const charStart = safeInt(r?.locator?.charStart) ?? -1;
  const charEnd = safeInt(r?.locator?.charEnd) ?? -1;
  return `${gapId}::${sourceId}::${charStart}-${charEnd}`;
}

export function shouldContinue(state, roundResult) {
  if (!state || typeof state !== "object") return false;
  const it = safeInt(state?.iteration) ?? 0;
  const maxIt = safeInt(state?.maxIterations) ?? 0;
  if (maxIt >= 1 && it >= maxIt) return false;

  if (openGaps(state).length === 0) return false;

  // noNewHitsRounds 阈值：连续 N 轮无高质量 hit 则停止（现在只计算 score >= threshold 的 hit）
  const noNewHitsRounds = safeInt(roundResult?.noNewHitsRounds);
  const stopAfterRounds = getNoNewHitsRoundsStopThreshold(state);
  if (noNewHitsRounds !== null && noNewHitsRounds >= stopAfterRounds) return false;

  if (roundResult?.aborted) return false;
  if (roundResult?.budgetStopRequested) return false;

  return true;
}

export class DeepSearchStage {
  /**
   * Stage interface (Runtime): execute(runContext, input) -> ContentPackage.
   * @param {object} runContext
   * @param {DeepSearchState|{state?:DeepSearchState|object,sources?:Array<object>,taskGoal?:string,userConfig?:object}} input
   * @param {{emit?:Function,eventBus?:object,signal?:AbortSignal,checkCancelled?:Function,aiApiService?:object,taskManager?:object}=} stageApi
   * @returns {Promise<object>} ContentPackage v0.1
   */
  async execute(runContext, input, stageApi = {}) {
    const state = ensureState(runContext, input);
    if (runContext?.runId) state.runId = String(runContext.runId);

    // 创建 SharedContext 用于阶段间通信和分层记忆
    const sharedCtx = new SharedContext({ runId: state.runId });

    const baseEmitFn = typeof stageApi?.emit === "function" ? stageApi.emit.bind(stageApi) : null;
    const tap = createEmitTap(baseEmitFn);
    const stageApiWithTap = { ...(isPlainObject(stageApi) ? stageApi : {}), emit: tap.emit };

    let currentStage = "deepsearch";
    const logger = createLogger({
      emit: stageApiWithTap?.emit,
      getContext: () => ({
        runId: state.runId,
        iteration: state.iteration,
        trajectoryId: state.trajectoryId,
        stage: currentStage,
      }),
    });
    stageApiWithTap.logger = logger;

    // Validate + normalize DeepSearch config early to avoid runtime errors.
    const { config: normalizedUserConfig } = validateUserConfig(state?.userConfig, { emit: stageApiWithTap?.emit, logger });
    state.userConfig = safeMergeConfig(state?.userConfig, normalizedUserConfig);
    if (!isResumedInput(input)) {
      const maxIt = safeInt(state?.userConfig?.maxIterations);
      if (maxIt !== null && maxIt >= 1) state.maxIterations = maxIt;
    }

    const stageApiWithContext = {
      ...stageApiWithTap,
      sharedContext: sharedCtx,
      getContextSummary: () => sharedCtx.buildSummaryText(),
    };

    const emit = makeStageEmitter(stageApiWithContext, "deepsearch");

    logger.info("DeepSearch pipeline started", {
      stage: "deepsearch",
      data: {
        runId: state.runId,
        maxIterations: state.maxIterations,
        sourceCount: Array.isArray(state?.L0?.sources) ? state.L0.sources.length : 0,
      },
    });

    const taskManager = stageApi?.taskManager;
    const taskId = state.runId;
    const updateTaskProgress = () => {
      if (!taskManager || !taskId) return;
      const claims = Array.isArray(state?.L1?.claims) ? state.L1.claims : [];
      taskManager.updateProgress(taskId, {
        iteration: state.iteration,
        gapCount: openGaps(state).length,
        claimCount: claims.length,
      });
    };

    if (taskManager && taskId) {
      let task = taskManager.get(taskId);
      if (!task) task = (await taskManager.load(taskId)) || taskManager.create({ runId: taskId, type: "deepsearch", metadata: {} });
      updateTaskProgress();
    }

    const errorHandler = new ErrorHandler();

    const budgetConfig = typeof state?.getBudgetConfig === "function" ? state.getBudgetConfig() : null;
    let budgetStopRequested = false;

    const budgetManager = createBudgetManager(state?.userConfig);
    stageApiWithContext.budgetManager = budgetManager;
    stageApiWithContext.getBudgetStats = () => budgetManager.getStats();

    let budgetDegradeApplied = false;
    const applyBudgetDegrade = ({ ratio, reason } = {}) => {
      if (budgetDegradeApplied) return;
      budgetDegradeApplied = true;

      // Prefer "skip expensive optional ops" over terminating immediately.
      if (!isPlainObject(state.userConfig)) state.userConfig = {};
      if (!isPlainObject(state.userConfig.retrieval)) state.userConfig.retrieval = {};

      if (!isPlainObject(state.userConfig.retrieval.rerank)) state.userConfig.retrieval.rerank = {};
      state.userConfig.retrieval.rerank.enabled = false;

      if (!isPlainObject(state.userConfig.retrieval.shadow)) state.userConfig.retrieval.shadow = {};
      state.userConfig.retrieval.shadow.enabled = false;

      if (!isPlainObject(state.userConfig.externalSearch)) state.userConfig.externalSearch = {};
      state.userConfig.externalSearch.autoTrigger = false;

      const curIt = safeInt(state.iteration) ?? 0;
      const nextMax = curIt + 1;
      const prevMax = safeInt(state.maxIterations) ?? nextMax;
      state.maxIterations = Math.min(prevMax, nextMax);

      state.addTimeline?.({
        name: "deepsearch.budget.degraded.runtime",
        status: "warning",
        payload: {
          maxIterations: state.maxIterations,
          iteration: state.iteration,
          ...(typeof ratio === "number" && Number.isFinite(ratio) ? { ratio } : {}),
          ...(reason ? { reason: String(reason) } : {}),
        },
      });

      emit?.(
        DeepSearchEvents.BUDGET_DEGRADED,
        {
          usage: budgetManager.usage,
          limits: budgetManager.limits,
          degraded: true,
          ...(typeof ratio === "number" && Number.isFinite(ratio) ? { ratio } : {}),
          ...(reason ? { reason: String(reason) } : {}),
        },
        { status: "info", throttle: false }
      );
    };

    budgetManager.onThresholdReached = ({ action, usage, limits, ratio }) => {
      if (action === BudgetAction.DEGRADE) {
        applyBudgetDegrade({ ratio, reason: "threshold" });
        return;
      }

      if (action === BudgetAction.STOP) {
        budgetStopRequested = true;
        state.addTimeline?.({
          name: "deepsearch.budget.stop",
          status: "warning",
          payload: { usage, limits, ratio },
        });
        emit?.(DeepSearchEvents.BUDGET_STOP, { usage, limits, ratio }, { status: "warning", throttle: false });
      }
    };

    const baseCheckCancelled =
      typeof stageApiWithContext?.checkCancelled === "function" ? stageApiWithContext.checkCancelled.bind(stageApiWithContext) : null;
    stageApiWithContext.checkCancelled = () => {
      baseCheckCancelled?.();
      if (budgetStopRequested || budgetManager?.stopped) {
        throw new DeepSearchError("Budget stop requested", { level: ErrorLevel.DEGRADABLE, context: { stage: currentStage } });
      }
    };

    // Preflight estimate: rough token budget forecast for the full run.
    const preflightGapCount = Math.max(1, safeInt(state?.userConfig?.budget?.estimateGapCount) ?? 5);
    const preflightSourceCount = Array.isArray(state?.L0?.sources) ? state.L0.sources.length : 0;
    const enableRerank = Boolean(state?.userConfig?.retrieval?.rerank?.enabled);
    const enableShadow = Boolean(state?.userConfig?.retrieval?.shadow?.enabled);
    const externalCfgForEstimate = parseExternalSearchConfig(state?.userConfig);
    const enableExternal = Boolean(externalCfgForEstimate?.enabled) && Boolean(externalCfgForEstimate?.autoTrigger);
    const preflightEstimate = budgetManager.estimateIteration({
      maxIterations: safeInt(state?.maxIterations) ?? 5,
      gapCount: preflightGapCount,
      sourceCount: preflightSourceCount,
      enableRerank,
      enableShadow,
      enableExternal,
    });
    const preflightRatio = {
      input: preflightEstimate.input / budgetManager.limits.input,
      output: preflightEstimate.output / budgetManager.limits.output,
      total: preflightEstimate.total / budgetManager.limits.total,
    };
    const preflightMaxRatio = Math.max(preflightRatio.input, preflightRatio.output, preflightRatio.total);
    state.addTimeline?.({
      name: "deepsearch.budget.estimated",
      status: preflightMaxRatio >= 1 ? "warning" : "info",
      payload: { estimate: preflightEstimate, limits: budgetManager.limits, ratio: preflightRatio, config: { preflightGapCount } },
    });
    emit?.(
      DeepSearchEvents.BUDGET_ESTIMATED,
      { estimate: preflightEstimate, limits: budgetManager.limits, ratio: preflightRatio },
      { status: "info", throttle: false }
    );
    if (preflightMaxRatio >= 1) {
      budgetManager.stopped = true;
      budgetStopRequested = true;
      state.addTimeline?.({
        name: "deepsearch.budget.preflight.stop",
        status: "warning",
        payload: { ratio: preflightMaxRatio, estimate: preflightEstimate, limits: budgetManager.limits },
      });
      emit?.(
        DeepSearchEvents.BUDGET_STOP,
        { reason: "preflight", ratio: preflightMaxRatio, estimate: preflightEstimate, limits: budgetManager.limits },
        { status: "warning", throttle: false }
      );
    } else if (preflightMaxRatio >= budgetManager.degradeThreshold) {
      budgetManager.degraded = true;
      budgetManager.onThresholdReached?.({ action: BudgetAction.DEGRADE, usage: budgetManager.usage, limits: budgetManager.limits, ratio: preflightMaxRatio });
    }

    tap.on("deepsearch.budget.exceeded", ({ record }) => {
      const payload = isPlainObject(record) && "payload" in record ? record.payload : record;
      const action = typeof budgetConfig?.action === "string" ? budgetConfig.action : "warn";

      state.addTimeline?.({
        name: "deepsearch.budget.exceeded",
        status: action === "warn" ? "warning" : "info",
        payload: { ...(payload && typeof payload === "object" ? payload : {}), action },
      });

      if (action === "degrade") {
        const curIt = safeInt(state.iteration) ?? 0;
        const nextMax = curIt + 1;
        const prevMax = safeInt(state.maxIterations) ?? nextMax;
        state.maxIterations = Math.min(prevMax, nextMax);
        state.addTimeline?.({ name: "deepsearch.budget.degraded", status: "warning", payload: { maxIterations: state.maxIterations, iteration: state.iteration } });
        return;
      }

      if (action === "stop") {
        budgetStopRequested = true;
        state.addTimeline?.({ name: "deepsearch.budget.stop", status: "warning", payload: { iteration: state.iteration } });
      }
    });

    tap.on("deepsearch.token.usage", ({ record }) => {
      const payload = isPlainObject(record) && "payload" in record ? record.payload : record;
      const usage = isPlainObject(payload?.usage) ? payload.usage : null;
      const input = safeInt(usage?.input) ?? 0;
      const output = safeInt(usage?.output) ?? 0;
      const action = budgetManager.recordUsage({ input, output });
      if (action === BudgetAction.STOP) {
        budgetStopRequested = true;
      } else if (action === BudgetAction.DEGRADE) {
        applyBudgetDegrade({ ratio: Math.max(...Object.values(budgetManager.getUsageRatio())), reason: "token_usage" });
      }
    });

    const normalizeError = (err, { stage } = {}) => {
      if (err instanceof DeepSearchError) return err;
      const message = String(err?.message || err || "Unknown error");
      const level = errorHandler.isRetryable(err) ? ErrorLevel.RETRYABLE : ErrorLevel.FATAL;
      return new DeepSearchError(message, { level, cause: err, context: { stage } });
    };

    const saveErrorCheckpoint = (checkpointState, { stage, error } = {}) => {
      const checkpoint = checkpointState?.saveCheckpoint?.();
      if (!checkpoint) return null;
      emit?.(DeepSearchEvents.CHECKPOINT_SAVED, {
        checkpointId: checkpoint.checkpointId,
        iteration: checkpoint.iteration,
        ...(checkpoint.metrics ? { metrics: checkpoint.metrics } : {}),
        ...(stage ? { stage } : {}),
        ...(error?.level ? { level: error.level } : {}),
      });
      checkpointState?.addTimeline?.({
        name: "deepsearch.checkpoint.saved",
        status: "info",
        payload: { checkpointId: checkpoint.checkpointId, iteration: checkpoint.iteration, ...(stage ? { stage } : {}), ...(error?.level ? { level: error.level } : {}) },
      });
      return checkpoint;
    };

    const callStage = async (stage, fn, { stageState = state, fallbackValue } = {}) => {
      const runId = String(stageState?.runId || state?.runId || runContext?.runId || "run");
      const stageName = String(stage || "stage");
      const stageLabel = stageName.startsWith("deepsearch.") ? stageName.slice("deepsearch.".length) : stageName;
      currentStage = stageLabel;
      const iteration = typeof stageState?.iteration === "number" ? stageState.iteration : typeof state?.iteration === "number" ? state.iteration : undefined;
      const trajectoryId = stageState?.trajectoryId || state?.trajectoryId;
      const nodeId = generateNodeId(runId, "stage", { stage: stageLabel, iteration, trajectoryId });
      const parentNodeId = trajectoryId ? `${runId}_${trajectoryId}` : runId;

      emit?.(DeepSearchEvents.NODE_STARTED, {
        runId,
        nodeId,
        parentNodeId,
        kind: "stage",
        label: stageLabel,
        stage: stageLabel,
        iteration,
        trajectoryId,
      });

      const budgetOp =
        stageLabel === "scan"
          ? "scan"
          : stageLabel === "gaps"
            ? "gaps"
            : stageLabel === "retrieve"
              ? "retrieve"
              : stageLabel === "understand"
                ? "understand"
                : stageLabel === "write"
                  ? "write"
                  : stageLabel === "external"
                    ? "external"
                    : null;
      if (budgetOp) {
        const probe = budgetManager.canExecute(budgetOp);
        if (probe.action === BudgetAction.DEGRADE) applyBudgetDegrade({ reason: `precheck:${budgetOp}` });
        if (!probe.canExecute || probe.action === BudgetAction.STOP) {
          budgetStopRequested = true;
          budgetManager.stopped = true;
          const dsErr = new DeepSearchError("Budget stop requested", { level: ErrorLevel.DEGRADABLE, context: { stage: stageLabel } });
          const value = typeof fallbackValue === "function" ? fallbackValue(dsErr) : fallbackValue;
          emit?.(DeepSearchEvents.NODE_FAILED, {
            runId,
            nodeId,
            error: { message: dsErr.message, level: dsErr.level },
            recovered: true,
            retrying: false,
          });
          stageState?.addTimeline?.({
            name: "deepsearch.budget.stop",
            status: "warning",
            payload: { stage: stageLabel, operation: budgetOp, estimated: probe.estimated, stats: budgetManager.getStats() },
          });
          return { ok: false, recovered: true, error: dsErr, value };
        }
      }

	      try {
	        const value = await errorHandler.withRetry(fn, {
	          signal: stageApiWithContext?.signal,
	          onRetry: ({ attempt, delay, error }) => {
	            const retryErr = normalizeError(error, { stage });
          emit?.(DeepSearchEvents.NODE_FAILED, {
            runId,
            nodeId,
            error: { message: String(retryErr?.message || ""), level: retryErr?.level },
            recovered: false,
            retrying: true,
          });
            stageState?.addTimeline?.({
              name: "deepsearch.retry",
              status: "warning",
              payload: { stage, attempt: attempt + 1, delay, message: String(error?.message || "") },
            });
          },
        });
        emit?.(DeepSearchEvents.NODE_COMPLETED, { runId, nodeId, outcome: "success", summary: value?.summary });
        return { ok: true, value };
      } catch (err) {
        const dsErr = normalizeError(err, { stage });
        const recovered =
          dsErr.level === ErrorLevel.RECOVERABLE || dsErr.level === ErrorLevel.DEGRADABLE || dsErr.level === ErrorLevel.RETRYABLE;
        emit?.(DeepSearchEvents.NODE_FAILED, {
          runId,
          nodeId,
          error: { message: dsErr.message, level: dsErr.level },
          recovered,
          retrying: false,
        });
        errorHandler.recordError(stageState, dsErr, { stage });
        saveErrorCheckpoint(stageState, { stage, error: dsErr });

        if (dsErr.level === ErrorLevel.RECOVERABLE || dsErr.level === ErrorLevel.DEGRADABLE || dsErr.level === ErrorLevel.RETRYABLE) {
          if (dsErr.level === ErrorLevel.DEGRADABLE) {
            stageState?.addTimeline?.({ name: "deepsearch.degraded", status: "warning", payload: { stage, message: dsErr.message } });
          }
          return { ok: false, recovered: true, error: dsErr, value: typeof fallbackValue === "function" ? fallbackValue(dsErr) : fallbackValue };
        }

        throw dsErr;
      }
    };

    const wrapStageFn =
      (stage, stageFn, { fallbackValue } = {}) =>
      async (rc, inp, api) => {
        const stageState = inp?.state || inp;
        const fallback = typeof fallbackValue === "function" ? fallbackValue(stageState) : fallbackValue;
        const { value } = await callStage(stage, () => stageFn(rc, inp, api), { stageState, fallbackValue: fallback });
        return value;
      };

    emit?.(DeepSearchEvents.STARTED, { runId: state.runId });

    try {
      if (!budgetStopRequested) checkCancelled(stageApiWithContext);

      // 小文档直通模式检测
      const directModeCheck = shouldUseDirectMode(state);
      if (directModeCheck.shouldUse) {
        if (budgetStopRequested) {
          emit?.(DeepSearchEvents.ABORTED, { iteration: state.iteration, reason: "budget_preflight" });
          state.addTimeline?.({ name: "deepsearch.aborted", status: "warning", payload: { iteration: state.iteration, reason: "budget_preflight" } });
          // Skip direct mode when budget is already exhausted by preflight.
        } else {
        currentStage = "deepsearch";
        logger.info("Using direct analysis mode for small document", { stage: "deepsearch", data: directModeCheck });
        emit?.(DeepSearchEvents.DIRECT_TRIGGERED, directModeCheck);

        currentStage = "direct";
        const pkg = await runDirectAnalysis(runContext, { state }, stageApiWithContext);
        emit?.(DeepSearchEvents.COMPLETED, { runId: state.runId, mode: "direct" });
        return pkg;
        }
      }

      if (!budgetStopRequested) {
        await callStage("deepsearch.scan", () => runDeepSearchScanStage(runContext, { state }, stageApiWithContext), { stageState: state });
        updateTaskProgress();
      }

      // SharedContext: 记录 scan 阶段摘要
      const scanSources = Array.isArray(state?.L0?.sources) ? state.L0.sources : [];
      const totalChars = scanSources.reduce((sum, s) => sum + (s?.sourceTextNormalized?.length || 0), 0);
      sharedCtx.commit("scan", {
        summary: `${scanSources.length} 个来源，共 ${totalChars} 字符，主题：${String(state.taskGoal || "").slice(0, 60)}`,
        keywords: [state.taskGoal, ...(state?.L1?.scanSummary?.keyTopics || [])].filter(Boolean).slice(0, 10),
      });

      if (budgetStopRequested) {
        emit?.(DeepSearchEvents.BUDGET_STOP, { iteration: state.iteration });
      }

      if (!budgetStopRequested) {
        const seenHitSignatures = new Set();
        let noNewHitsRounds = 0;
        let lastRoundResult = null;
        const maxWriteBacktrack = 3;

        const trajectoryCfg = getTrajectoryConfig(state);
        const useTrajectories = (safeInt(trajectoryCfg.n) ?? 1) > 1;

        if (useTrajectories) {
          const manager = new TrajectoryManager(trajectoryCfg);
          state.trajectoryConfig = { ...manager.config };

          emit?.(DeepSearchEvents.TRAJECTORY_FORKED, { n: manager.config.n, mergeStrategy: manager.config.mergeStrategy });

          const trajectories = manager.fork(state);
          await mapConcurrent(
            trajectories,
            async (trajectory) => {
              try {
                await manager.runTrajectory(
                  trajectory,
                  {
                    runContext,
                    runGapsStage: wrapStageFn("deepsearch.gaps", runDeepSearchGapsStage, {
                      fallbackValue: (s) => ({ state: s, gaps: Array.isArray(s?.L1?.gaps) ? s.L1.gaps : [], todos: [] }),
                    }),
                    runRetrieveStage: wrapStageFn("deepsearch.retrieve", runDeepSearchRetrieveStage, {
                      fallbackValue: (s) => ({ state: s, retrievedChunks: [] }),
                    }),
                    runUnderstandStage: wrapStageFn("deepsearch.understand", runDeepSearchUnderstandStage, {
                      fallbackValue: (s) => ({ state: s }),
                    }),
                    runExternalSearch,
                    emit: emit ? (name, payload) => emit(name, payload) : null,
                  },
                  stageApiWithContext
                );
              } catch {
                // keep all-settled semantics: trajectory failures should not abort merging others
              }
            },
            getTrajectoryParallel(state)
          );

          const merged = manager.merge();
          if (merged) applyMergedState(state, merged);

          emit?.(DeepSearchEvents.TRAJECTORY_MERGED, { mergeStrategy: manager.config.mergeStrategy });
          updateTaskProgress();
        }

        let phase = useTrajectories ? PhaseStatus.WRITE : PhaseStatus.GAPS;
        transitionPhase(useTrajectories ? PhaseStatus.ROUND : PhaseStatus.SCAN, phase, {
          emit,
          logger,
          runId: state.runId,
          iteration: state.iteration,
          trajectoryId: state.trajectoryId,
        });
        while (!stageApiWithContext?.signal?.aborted && !budgetStopRequested) {
          checkCancelled(stageApiWithContext);

        if (phase === PhaseStatus.GAPS) {
          if (state.iteration >= state.maxIterations) {
            transitionPhase(phase, PhaseStatus.WRITE, { emit, logger, runId: state.runId, iteration: state.iteration, trajectoryId: state.trajectoryId });
            phase = PhaseStatus.WRITE;
            continue;
          }
          await callStage("deepsearch.gaps", () => runDeepSearchGapsStage(runContext, { state }, stageApiWithContext), {
            stageState: state,
            fallbackValue: { state, gaps: Array.isArray(state?.L1?.gaps) ? state.L1.gaps : [], todos: [] },
          });
          updateTaskProgress();
          if (budgetStopRequested) break;

          // SharedContext: 记录 gaps 阶段摘要
          const allGaps = Array.isArray(state?.L1?.gaps) ? state.L1.gaps : [];
          const openGapsList = allGaps.filter(g => g?.status === "open" || !g?.status);
          const gapTypes = [...new Set(openGapsList.map(g => g?.type).filter(Boolean))];
          sharedCtx.commit("gaps", {
            summary: `${openGapsList.length}/${allGaps.length} 个开放缺口，类型：${gapTypes.join(", ")}`,
            keywords: [...gapTypes, ...openGapsList.map(g => g?.question).filter(Boolean).slice(0, 5)],
            full: openGapsList,
          });

          if (openGaps(state).length === 0) {
            transitionPhase(phase, PhaseStatus.WRITE, { emit, logger, runId: state.runId, iteration: state.iteration, trajectoryId: state.trajectoryId });
            phase = PhaseStatus.WRITE;
            continue;
          }

          transitionPhase(phase, PhaseStatus.ROUND, { emit, logger, runId: state.runId, iteration: state.iteration, trajectoryId: state.trajectoryId });
          phase = PhaseStatus.ROUND;
          continue;
        }

        if (phase === PhaseStatus.ROUND) {
          if (state.iteration >= state.maxIterations) {
            transitionPhase(phase, PhaseStatus.WRITE, { emit, logger, runId: state.runId, iteration: state.iteration, trajectoryId: state.trajectoryId });
            phase = PhaseStatus.WRITE;
            continue;
          }
          if (openGaps(state).length === 0) {
            transitionPhase(phase, PhaseStatus.WRITE, { emit, logger, runId: state.runId, iteration: state.iteration, trajectoryId: state.trajectoryId });
            phase = PhaseStatus.WRITE;
            continue;
          }

          // Re-sort open gaps by priority at the start of each iteration
          if (state?.planningTree && state?.L1?.gaps) {
            const currentOpenGaps = state.L1.gaps.filter(isOpenGap);
            const currentClosedGaps = state.L1.gaps.filter(g => !isOpenGap(g));
            if (currentOpenGaps.length > 0) {
              const sortedOpenGaps = state.planningTree.sortGapsByPriority(currentOpenGaps);
              state.L1.gaps = [...sortedOpenGaps, ...currentClosedGaps];
            }
          }

          emit?.(DeepSearchEvents.ITERATION_STARTED, {
            runId: state.runId,
            iteration: state.iteration,
            openGapCount: openGaps(state).length,
            trajectoryId: state.trajectoryId,
          });

          // 记录迭代开始
          logger.info(`Iteration ${state.iteration} started`, {
            stage: "deepsearch",
            data: { iteration: state.iteration, openGaps: openGaps(state).length, trajectoryId: state.trajectoryId },
          });

          const { value: retrieveOut } = await callStage("deepsearch.retrieve", () => runDeepSearchRetrieveStage(runContext, { state }, stageApiWithContext), {
            stageState: state,
            fallbackValue: { state, retrievedChunks: [] },
          });
          const retrievedChunks = retrieveOut?.retrievedChunks;
          updateTaskProgress();
          if (budgetStopRequested) break;

          // 只计算高质量 hit（score >= 阈值），低质量匹配不算有效 hit
          const qualityThreshold = getQualityThreshold(state);
          let hitCount = 0;
          let qualityHitCount = 0;
          for (const r of Array.isArray(retrievedChunks) ? retrievedChunks : []) {
            const sig = signatureForRetrievedChunk(r);
            if (!seenHitSignatures.has(sig)) {
              seenHitSignatures.add(sig);
              hitCount++;
              // 只有高质量 hit 才计入有效 hit
              const score = typeof r?.score === "number" && Number.isFinite(r.score) ? r.score : 0;
              if (score >= qualityThreshold) {
                qualityHitCount++;
              }
            }
          }
          // 使用 qualityHitCount 而非 hitCount 判断是否有新发现
          noNewHitsRounds = qualityHitCount === 0 ? noNewHitsRounds + 1 : 0;

          // SharedContext: 记录 retrieve 阶段摘要
          const totalRetrieved = Array.isArray(state?.L2?.retrievedChunks) ? state.L2.retrievedChunks.length : 0;
          sharedCtx.commit("retrieve", {
            summary: `检索 ${hitCount} 个 chunk（高质量 ${qualityHitCount} 个），累计 ${totalRetrieved} 个`,
            keywords: retrievedChunks?.slice(0, 5).flatMap(r => r?.matchedGapIds || []).filter(Boolean) || [],
          });
          // 发送信号：如果高质量 hit 为 0，可能需要外搜
          if (qualityHitCount === 0) {
            sharedCtx.signal("retrieve", { type: "NO_QUALITY_HITS", iteration: state.iteration, noNewHitsRounds });
          }

          await callStage("deepsearch.understand", () => runDeepSearchUnderstandStage(runContext, { state }, stageApiWithContext), {
            stageState: state,
            fallbackValue: { state },
          });
          updateTaskProgress();
          if (budgetStopRequested) break;

          // SharedContext: 记录 understand 阶段摘要
          const claims = Array.isArray(state?.L1?.claims) ? state.L1.claims : [];
          const evidenceCount = Array.isArray(state?.L1?.evidenceLedger) ? state.L1.evidenceLedger.length : 0;
          const filledGapsCount = (Array.isArray(state?.L1?.gaps) ? state.L1.gaps : []).filter(g => g?.status === "filled").length;
          sharedCtx.commit("understand", {
            summary: `提取 ${claims.length} 个论点，${evidenceCount} 条证据，${filledGapsCount} 个缺口已填充`,
            keywords: claims.slice(0, 5).map(c => c?.text?.slice(0, 30)).filter(Boolean),
          });

          // Reflect-driven 外搜（单轨迹主流程）
          // 显式开启（userConfig.externalSearch.enabled=true && autoTrigger=true）才会触发。
          const reflectResult = state?.L1?.reflectResult;
          const externalCfg = parseExternalSearchConfig(state?.userConfig);
          const externalEnabled = Boolean(externalCfg?.enabled) && Boolean(externalCfg?.autoTrigger);
          const externalAlreadyTriggered = Boolean(state?.L2?.externalSearchTriggered);

          if (reflectResult && !reflectResult.sufficient && externalEnabled && !externalAlreadyTriggered) {
            const currentGaps = openGaps(state);
            const defaultGapId = typeof currentGaps?.[0]?.gapId === "string" && currentGaps[0].gapId ? currentGaps[0].gapId : null;
            const suggested = Array.isArray(reflectResult?.suggestedQueries) ? reflectResult.suggestedQueries.map(String).filter(Boolean) : [];

            const searchGaps = suggested.length
              ? suggested.slice(0, 3).map((q, i) => ({ gapId: defaultGapId || `ext_${i}`, query: q, question: q, type: "external" }))
              : currentGaps
                  .map((g) => ({
                    gapId: String(g?.gapId || ""),
                    query: String(g?.question || g?.text || ""),
                    question: String(g?.question || g?.text || ""),
                    type: String(g?.type || "external"),
                  }))
                  .filter((g) => g.query);

            if (searchGaps.length) {
              const { value: externalOut } = await callStage(
                "deepsearch.external",
                () => runExternalSearch(searchGaps, externalCfg, { emit, state, stageApi: stageApiWithContext }),
                { stageState: state, fallbackValue: { chunks: [], documents: [], evidences: [] } }
              );
              if (budgetStopRequested) break;

              if (!state.L2 || typeof state.L2 !== "object") state.L2 = {};
              state.L2.externalSearchTriggered = true;
              state.addTimeline?.({
                name: "deepsearch.external.triggered",
                status: "info",
                payload: {
                  reason: String(reflectResult?.reason || ""),
                  suggestedQueries: suggested.slice(0, 3),
                  addedChunks: Array.isArray(externalOut?.chunks) ? externalOut.chunks.length : 0,
                },
              });

              if (Array.isArray(externalOut?.chunks) && externalOut.chunks.length) {
                noNewHitsRounds = 0;
                for (const r of externalOut.chunks) {
                  const sig = signatureForRetrievedChunk(r);
                  if (!seenHitSignatures.has(sig)) seenHitSignatures.add(sig);
                }
              }

              await callStage("deepsearch.understand", () => runDeepSearchUnderstandStage(runContext, { state }, stageApiWithContext), {
                stageState: state,
                fallbackValue: { state },
              });
              updateTaskProgress();
              if (budgetStopRequested) break;
            }
          }

          const blockAfterMisses = getGapBlockAfterMisses(state);
          const roundHits = computeRoundHitsByGapId(retrievedChunks, qualityThreshold);
          const validateOut = validateIteration(state, { roundHits, blockAfterMisses, emit });

          const completedIteration = state.iteration;
          const checkpoint = state.saveCheckpoint();
          // 添加丰富的上下文信息便于回溯调试
          const openGapList = openGaps(state);
          const checkpointContext = {
            openGapIds: openGapList.map(g => g.gapId),
            openGapCount: openGapList.length,
            activeTrajectoryId: state.trajectoryId || state.currentTrajectoryId,
            claimCount: state.claims?.length || 0,
            evidenceCount: state.evidence?.length || 0,
            phase: phase,
          };

          emit?.(DeepSearchEvents.CHECKPOINT_SAVED, {
            checkpointId: checkpoint.checkpointId,
            iteration: checkpoint.iteration,
            metrics: checkpoint.metrics,
            context: checkpointContext,
          });

          state.addTimeline({
            name: "deepsearch.checkpoint.saved",
            status: "info",
            payload: {
              checkpointId: checkpoint.checkpointId,
              iteration: checkpoint.iteration,
              context: checkpointContext,
            },
          });

          emit?.(DeepSearchEvents.ITERATION_COMPLETED, {
            runId: state.runId,
            iteration: completedIteration,
            hitCount,
            qualityHitCount,
            noNewHitsRounds,
            ...(validateOut && typeof validateOut === "object" ? validateOut : {}),
            openGapCount: openGaps(state).length,
          });

          // 记录迭代完成
          logger.info(`Iteration ${completedIteration} completed`, {
            stage: "deepsearch",
            data: {
              iteration: completedIteration,
              hitCount,
              qualityHitCount,
              noNewHitsRounds,
              openGaps: openGaps(state).length,
              decision: shouldContinue(state, lastRoundResult) ? "continue" : "stop",
            },
          });

          state.iteration += 1;

          lastRoundResult = { hitCount, qualityHitCount, noNewHitsRounds, openGapCount: openGaps(state).length };
          const nextPhase = shouldContinue(state, lastRoundResult) ? PhaseStatus.GAPS : PhaseStatus.WRITE;
          transitionPhase(phase, nextPhase, { emit, logger, runId: state.runId, iteration: state.iteration, trajectoryId: state.trajectoryId });
          phase = nextPhase;
          continue;
        }

        if (phase === PhaseStatus.WRITE) {
          const { value: writeOut } = await callStage("deepsearch.write", () => runDeepSearchWriteStage(runContext, { state }, stageApiWithContext), { stageState: state });
          updateTaskProgress();
          if (budgetStopRequested) break;

          const feedbackToResearch = writeOut?.feedbackToResearch;
          const needsMoreResearch = Boolean(feedbackToResearch?.needsMoreResearch);
          const reopenGaps = Array.isArray(feedbackToResearch?.reopenGaps) ? feedbackToResearch.reopenGaps : [];
          const newGaps = Array.isArray(feedbackToResearch?.newGaps) ? feedbackToResearch.newGaps : [];

          const canBacktrack =
            needsMoreResearch &&
            state.iteration < state.maxIterations &&
            (safeInt(state.writeBacktrackCount) ?? 0) < maxWriteBacktrack &&
            (reopenGaps.length > 0 || newGaps.length > 0);

          if (!canBacktrack) {
            transitionPhase(phase, PhaseStatus.CONDENSE, { emit, logger, runId: state.runId, iteration: state.iteration, trajectoryId: state.trajectoryId });
            phase = PhaseStatus.CONDENSE;
            continue;
          }

          state.saveWriteSnapshot();
          state.writeBacktrackCount = (safeInt(state.writeBacktrackCount) ?? 0) + 1;
          state.reopenGaps(reopenGaps, { reason: feedbackToResearch?.reason }, emit);
          state.addNewGaps(newGaps, {}, emit);
          noNewHitsRounds = 0;

          emit?.(
            "deepsearch.write.backtrack.requested",
            {
              writeBacktrackCount: state.writeBacktrackCount,
              maxWriteBacktrack,
              feedbackToResearch,
            },
            { status: "info", throttle: false }
          );
          state.addTimeline({
            name: "deepsearch.write.backtrack.requested",
            status: "info",
            payload: { writeBacktrackCount: state.writeBacktrackCount, maxWriteBacktrack, ...(feedbackToResearch ? { feedbackToResearch } : {}) },
          });

          const nextPhase = openGaps(state).length > 0 ? PhaseStatus.ROUND : PhaseStatus.WRITE;
          transitionPhase(phase, nextPhase, { emit, logger, runId: state.runId, iteration: state.iteration, trajectoryId: state.trajectoryId });
          phase = nextPhase;
          continue;
        }

        if (phase === PhaseStatus.CONDENSE) {
          await callStage("deepsearch.condense", () => runDeepSearchCondenseStage(runContext, { state }, stageApiWithContext), { stageState: state });
          updateTaskProgress();
          break;
        }

        // Safety: unknown phase means exit.
        break;
        }
      }

      if (stageApiWithContext?.signal?.aborted || budgetStopRequested) {
        state.addTimeline({ name: "deepsearch.aborted", status: "warning", payload: { iteration: state.iteration } });
        emit?.(DeepSearchEvents.ABORTED, { iteration: state.iteration });
      }

    const sources = Array.isArray(state?.L0?.sources) ? state.L0.sources : [];
    const assets = Array.isArray(state?.L0?.assets) ? state.L0.assets : [];
    const slideIntents = Array.isArray(state?.L1?.slideIntents) ? state.L1.slideIntents : [];
    const claims = Array.isArray(state?.L1?.claims) ? state.L1.claims : [];
    const evidenceLedger = Array.isArray(state?.L1?.evidenceLedger) ? state.L1.evidenceLedger : [];
    const dataTables = Array.isArray(state?.L1?.dataTables) ? state.L1.dataTables : [];

    if (!isPlainObject(state?.L1?.report)) {
      state.L1.report = generateReport(claims, evidenceLedger, Array.isArray(state?.L1?.gaps) ? state.L1.gaps : [], sources, String(state?.taskGoal || ""));
    }

    const pkg = buildContentPackage(runContext || { runId: state.runId, mode: "deepsearch", constraints: {} }, sources, slideIntents, claims, evidenceLedger, dataTables, {
      mode: "deepsearch",
      scanSummary: state?.L1?.scanSummary || null,
      gaps: Array.isArray(state?.L1?.gaps) ? state.L1.gaps : [],
      condensedMemory: state?.L1?.condensedMemory || null,
      openQuestions: Array.isArray(state?.L1?.openQuestions) ? state.L1.openQuestions : [],
      outlineCandidates: Array.isArray(state?.L1?.outlineCandidates) ? state.L1.outlineCandidates : [],
      report: state?.L1?.report || null,
      assets,
    });

    if (pkg?.metrics) {
      const gaps = Array.isArray(state?.L1?.gaps) ? state.L1.gaps : [];
      const tokenUsageRaw = state?.L2?.tokenUsage;
      const tokenUsage =
        tokenUsageRaw && typeof tokenUsageRaw === "object"
          ? {
              input: typeof tokenUsageRaw.input === "number" && Number.isFinite(tokenUsageRaw.input) ? tokenUsageRaw.input : 0,
              output: typeof tokenUsageRaw.output === "number" && Number.isFinite(tokenUsageRaw.output) ? tokenUsageRaw.output : 0,
              total: typeof tokenUsageRaw.total === "number" && Number.isFinite(tokenUsageRaw.total) ? tokenUsageRaw.total : 0,
              estimatedCostUSD:
                typeof tokenUsageRaw.estimatedCostUSD === "number" && Number.isFinite(tokenUsageRaw.estimatedCostUSD) ? tokenUsageRaw.estimatedCostUSD : 0,
            }
          : { input: 0, output: 0, total: 0, estimatedCostUSD: 0 };
      pkg.metrics.deepsearch = {
        sourceCount: Array.isArray(sources) ? sources.length : 0,
        gapCount: gaps.filter(isOpenGap).length,
        totalGaps: gaps.length,
        retrievedCount: Array.isArray(state?.L2?.retrievedChunks) ? state.L2.retrievedChunks.length : 0,
        claimCount: claims.length,
        evidenceCount: evidenceLedger.length,
        slideCount: slideIntents.length,
        iteration: state.iteration,
        checkpointCount: Array.isArray(state?.checkpoints) ? state.checkpoints.length : 0,
        tokenUsage,
      };
    }

    emit?.(DeepSearchEvents.COMPLETED, { runId: state.runId, slideCount: slideIntents.length, claimCount: claims.length });

    // 记录 DeepSearch 流程完成
    currentStage = "deepsearch";
    logger.info("DeepSearch pipeline completed", {
      stage: "deepsearch",
      data: {
        runId: state.runId,
        finalIteration: state.iteration,
        slideCount: slideIntents.length,
        claimCount: claims.length,
        evidenceCount: evidenceLedger.length,
        gapCount: Array.isArray(state?.L1?.gaps) ? state.L1.gaps.length : 0,
      },
    });

    if (taskManager && taskId) {
      const { signal } = extractServices(stageApi);
      if (signal?.aborted && typeof taskManager.cancel === "function") {
        taskManager.cancel(taskId, "aborted");
      } else {
        taskManager.complete(taskId, { runId: state.runId, metrics: pkg?.metrics?.deepsearch || null });
      }
    }
    return pkg;
    } catch (err) {
      if (taskManager && taskId) taskManager.fail(taskId, err);
      throw err;
    } finally {
      tap.destroy();
    }
  }

  // Convenience adapter: run(input, context) -> ContentPackage.
  async run(input, context = {}) {
    return this.execute(context.runContext || { runId: "run_unknown", mode: "deepsearch", constraints: {} }, input, context);
  }
}

// Convenience adapter to register with AgentOrchestrator.registerStage(name, fn).
export async function runDeepSearchStage(runContext, input, stageApi = {}) {
  const stage = new DeepSearchStage();
  return stage.execute(runContext, input, stageApi);
}

export function registerDeepSearchStages(orchestrator, { timeoutMs = 30_000 } = {}) {
  orchestrator.registerStage("deepsearch.scan", runDeepSearchScanStage, { actor: "deepsearch", timeoutMs });
  orchestrator.registerStage("deepsearch.gaps", runDeepSearchGapsStage, { actor: "deepsearch", timeoutMs });
  orchestrator.registerStage("deepsearch.retrieve", runDeepSearchRetrieveStage, { actor: "deepsearch", timeoutMs });
  orchestrator.registerStage("deepsearch.understand", runDeepSearchUnderstandStage, { actor: "deepsearch", timeoutMs });
  orchestrator.registerStage("deepsearch.write", runDeepSearchWriteStage, { actor: "deepsearch", timeoutMs });
  orchestrator.registerStage("deepsearch.condense", runDeepSearchCondenseStage, { actor: "deepsearch", timeoutMs });
  orchestrator.registerStage("deepsearch.pipeline", runDeepSearchStage, { actor: "deepsearch", timeoutMs });
}

export const __test = {
  ensureState,
  applyMergedState,
  getTrajectoryConfig,
  isOpenGap,
  openGaps,
  getGapBlockAfterMisses,
  signatureForRetrievedChunk,
  validateIteration,
};
