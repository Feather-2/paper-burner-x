// DeepSearch stage entry: S2-S7 pipeline to produce ContentPackage v0.1 (DeepSearch mode).

import { buildContentPackage } from "../textprep/build-content-package.js";
import { DeepSearchState, checkCancelled, makeStageEmitter } from "./state.js";
import { runDeepSearchScanStage } from "./scan.js";
import { runDeepSearchGapsStage } from "./gaps.js";
import { runDeepSearchRetrieveStage } from "./retrieve.js";
import { runDeepSearchUnderstandStage } from "./understand.js";
import { generateReport, runDeepSearchWriteStage } from "./write.js";
import { runDeepSearchCondenseStage } from "./condense.js";
import { TrajectoryManager } from "./trajectory.js";
import { DeepSearchError, ErrorHandler, ErrorLevel } from "../../core/error-handler.js";

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function safeInt(n) {
  return typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : null;
}

function createEmitTap(emitFn) {
  const listeners = new Map(); // name -> Set(fn)

  const on = (name, handler) => {
    if (typeof handler !== "function") throw new TypeError("createEmitTap().on(name, handler): handler must be a function");
    const key = String(name || "");
    if (!key) throw new TypeError("createEmitTap().on(name, handler): name must be a non-empty string");
    let set = listeners.get(key);
    if (!set) {
      set = new Set();
      listeners.set(key, set);
    }
    set.add(handler);
    return () => {
      const cur = listeners.get(key);
      if (!cur) return;
      cur.delete(handler);
      if (cur.size === 0) listeners.delete(key);
    };
  };

  const emit = (name, record) => {
    const result = typeof emitFn === "function" ? emitFn(name, record) : undefined;
    const key = String(name || "");
    const direct = listeners.get(key);
    if (direct) for (const fn of [...direct]) fn({ name: key, record });
    const any = listeners.get("*");
    if (any) for (const fn of [...any]) fn({ name: key, record });
    return result;
  };

  return { emit, on };
}

function ensureState(runContext, input) {
  if (input instanceof DeepSearchState) return input;
  if (input?.state instanceof DeepSearchState) return input.state;
  if (isPlainObject(input?.state)) return DeepSearchState.fromJSON(input.state);

  const sources = Array.isArray(input?.sources) ? input.sources : [];
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
  const n = safeInt(cfg.n) ?? 1;
  const mergeStrategy = typeof cfg.mergeStrategy === "string" ? cfg.mergeStrategy : "best";
  const qualityMetrics = Array.isArray(cfg.qualityMetrics) ? cfg.qualityMetrics : [];
  const divergeAt = typeof cfg.divergeAt === "string" ? cfg.divergeAt : "gap";
  const cachePolicy = typeof cfg.cachePolicy === "string" ? cfg.cachePolicy : "share";
  const cacheMaxSize = safeInt(cfg.cacheMaxSize) ?? 100;
  return { n, mergeStrategy, qualityMetrics, divergeAt, cachePolicy, cacheMaxSize };
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
  return n !== null && n >= 1 ? n : 2;
}

function signatureForRetrievedChunk(r) {
  const gapId = String(r?.gapId || "");
  const sourceId = String(r?.sourceId || "");
  const charStart = safeInt(r?.locator?.charStart) ?? -1;
  const charEnd = safeInt(r?.locator?.charEnd) ?? -1;
  return `${gapId}::${sourceId}::${charStart}-${charEnd}`;
}

function validateIteration(state, { blockAfterMisses = 2 } = {}) {
  const gaps = Array.isArray(state?.L1?.gaps) ? state.L1.gaps : [];
  const retrieved = Array.isArray(state?.L2?.retrievedChunks) ? state.L2.retrievedChunks : [];
  const evidenceLedger = Array.isArray(state?.L1?.evidenceLedger) ? state.L1.evidenceLedger : [];

  const retrievedByChunkId = new Map();
  const hitCountByGapId = new Map();
  for (const r of retrieved) {
    const chunkId = String(r?.chunkId || "");
    if (chunkId) retrievedByChunkId.set(chunkId, r);
    const matched = Array.isArray(r?.matchedGapIds) ? r.matchedGapIds.map(String).filter(Boolean) : [];
    if (matched.length) {
      for (const gid of matched) hitCountByGapId.set(gid, (hitCountByGapId.get(gid) || 0) + 1);
      continue;
    }
    const gid = String(r?.gapId || "");
    if (gid) hitCountByGapId.set(gid, (hitCountByGapId.get(gid) || 0) + 1);
  }

  const filledGapIds = new Set();
  for (const e of evidenceLedger) {
    const gapIds = Array.isArray(e?.gapIds) ? e.gapIds.map(String).filter(Boolean) : [];
    if (gapIds.length) {
      for (const gid of gapIds) filledGapIds.add(gid);
      continue;
    }
    const chunkId = String(e?.chunkId || "");
    const r = retrievedByChunkId.get(chunkId);
    if (!r) continue;
    const matched = Array.isArray(r?.matchedGapIds) ? r.matchedGapIds.map(String).filter(Boolean) : [];
    if (matched.length) {
      for (const gid of matched) filledGapIds.add(gid);
      continue;
    }
    const gid = String(r?.gapId || "");
    if (gid) filledGapIds.add(gid);
  }

  let filledCount = 0;
  let blockedCount = 0;
  let stillOpenCount = 0;
  const now = new Date().toISOString();

  for (const g of gaps) {
    const gid = String(g?.gapId || "");
    if (!gid) continue;
    const status = String(g?.status || "open");
    if (status === "filled" || status === "blocked") continue;

    if (filledGapIds.has(gid)) {
      g.status = "filled";
      g.filledAt = now;
      g.filledIteration = state.iteration;
      filledCount++;
      continue;
    }

    const hits = hitCountByGapId.get(gid) || 0;
    if (hits > 0) {
      g.missCount = 0;
      stillOpenCount++;
      continue;
    }

    const priorMisses = safeInt(g?.missCount) ?? 0;
    const misses = Math.max(0, priorMisses) + 1;
    g.missCount = misses;

    if (misses >= blockAfterMisses) {
      g.status = "blocked";
      g.blockedAt = now;
      g.blockedReason = String(g.blockedReason || "no_retrieval_hits");
      blockedCount++;
    } else {
      stillOpenCount++;
    }
  }

  const todos = Array.isArray(state?.todos) ? state.todos : [];
  const todoByGapId = new Map();
  for (const t of todos) {
    const rgid = String(t?.relatedGapId || "");
    if (!rgid) continue;
    todoByGapId.set(rgid, t);
  }
  for (const g of gaps) {
    const gid = String(g?.gapId || "");
    if (!gid) continue;
    const t = todoByGapId.get(gid);
    if (!t) continue;
    if (g.status === "filled") t.status = "done";
    if (g.status === "blocked") t.status = "blocked";
  }

  const tree = state?.planningTree;
  if (typeof tree?.getNodesForGap === "function" && typeof tree?.updateStatus === "function") {
    for (const g of gaps) {
      const gid = String(g?.gapId || "");
      if (!gid) continue;
      if (g.status !== "filled" && g.status !== "blocked") continue;
      const next = g.status === "filled" ? "completed" : "blocked";
      for (const n of tree.getNodesForGap(gid)) tree.updateStatus(n.nodeId, next);
    }
  }

  state.addTimeline({
    name: "deepsearch.validate",
    status: "completed",
    payload: { filledCount, blockedCount, openCount: openGaps(state).length },
  });

  return { filledCount, blockedCount, openCount: openGaps(state).length };
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

    const baseEmitFn = typeof stageApi?.emit === "function" ? stageApi.emit.bind(stageApi) : null;
    const tap = createEmitTap(baseEmitFn);
    const stageApiWithTap = { ...(isPlainObject(stageApi) ? stageApi : {}), emit: tap.emit };

    const emit = makeStageEmitter(stageApiWithTap, "deepsearch");

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

    const normalizeError = (err, { stage } = {}) => {
      if (err instanceof DeepSearchError) return err;
      const message = String(err?.message || err || "Unknown error");
      const level = errorHandler.isRetryable(err) ? ErrorLevel.RETRYABLE : ErrorLevel.FATAL;
      return new DeepSearchError(message, { level, cause: err, context: { stage } });
    };

    const saveErrorCheckpoint = (checkpointState, { stage, error } = {}) => {
      const checkpoint = checkpointState?.saveCheckpoint?.();
      if (!checkpoint) return null;
      emit?.("deepsearch.checkpoint.saved", {
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
      try {
        const value = await errorHandler.withRetry(fn, {
          onRetry: ({ attempt, delay, error }) => {
            stageState?.addTimeline?.({
              name: "deepsearch.retry",
              status: "warning",
              payload: { stage, attempt: attempt + 1, delay, message: String(error?.message || "") },
            });
          },
        });
        return { ok: true, value };
      } catch (err) {
        const dsErr = normalizeError(err, { stage });
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

    emit?.("deepsearch.started", { runId: state.runId });

    try {
      checkCancelled(stageApiWithTap);
      await callStage("deepsearch.scan", () => runDeepSearchScanStage(runContext, { state }, stageApiWithTap), { stageState: state });
      updateTaskProgress();

      if (budgetStopRequested) {
        emit?.("deepsearch.budget.stop", { iteration: state.iteration });
      }

    const seenHitSignatures = new Set();
    let noNewHitsRounds = 0;
    const runRetrieveUnderstandRound = async () => {
      if (budgetStopRequested) return { retrievedChunks: [], newHitCount: 0 };
      checkCancelled(stageApiWithTap);
      const { value: retrieveOut } = await callStage("deepsearch.retrieve", () => runDeepSearchRetrieveStage(runContext, { state }, stageApiWithTap), {
        stageState: state,
        fallbackValue: { state, retrievedChunks: [] },
      });
      const retrievedChunks = retrieveOut?.retrievedChunks;
      updateTaskProgress();

      let newHitCount = 0;
      for (const r of Array.isArray(retrievedChunks) ? retrievedChunks : []) {
        const sig = signatureForRetrievedChunk(r);
        if (!seenHitSignatures.has(sig)) {
          seenHitSignatures.add(sig);
          newHitCount++;
        }
      }
      noNewHitsRounds = newHitCount === 0 ? noNewHitsRounds + 1 : 0;

      if (budgetStopRequested) return { retrievedChunks, newHitCount };
      checkCancelled(stageApiWithTap);
      await callStage("deepsearch.understand", () => runDeepSearchUnderstandStage(runContext, { state }, stageApiWithTap), {
        stageState: state,
        fallbackValue: { state },
      });
      updateTaskProgress();

      validateIteration(state, { blockAfterMisses: getGapBlockAfterMisses(state) });

      const checkpoint = state.saveCheckpoint();
      emit?.("deepsearch.checkpoint.saved", { checkpointId: checkpoint.checkpointId, iteration: checkpoint.iteration, metrics: checkpoint.metrics });
      state.addTimeline({ name: "deepsearch.checkpoint.saved", status: "info", payload: { checkpointId: checkpoint.checkpointId, iteration: checkpoint.iteration } });

      state.iteration += 1;

      return { retrievedChunks, newHitCount };
    };

    const trajectoryCfg = getTrajectoryConfig(state);
    if ((safeInt(trajectoryCfg.n) ?? 1) > 1) {
      const manager = new TrajectoryManager(trajectoryCfg);
      state.trajectoryConfig = { ...manager.config };

      emit?.("deepsearch.trajectory.forked", { n: manager.config.n, mergeStrategy: manager.config.mergeStrategy });

      const trajectories = manager.fork(state);
      await Promise.allSettled(
        trajectories.map((trajectory) =>
          manager.runTrajectory(
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
              emit: emit ? (name, payload) => emit(name, payload) : null,
            },
            stageApiWithTap
          )
        )
      );

      const merged = manager.merge();
      if (merged) applyMergedState(state, merged);

      emit?.("deepsearch.trajectory.merged", { mergeStrategy: manager.config.mergeStrategy });
      updateTaskProgress();
    } else {
    while (state.iteration < state.maxIterations && !stageApiWithTap?.signal?.aborted && !budgetStopRequested) {
      checkCancelled(stageApiWithTap);
      await callStage("deepsearch.gaps", () => runDeepSearchGapsStage(runContext, { state }, stageApiWithTap), {
        stageState: state,
        fallbackValue: { state, gaps: Array.isArray(state?.L1?.gaps) ? state.L1.gaps : [], todos: [] },
      });
      updateTaskProgress();

      const gaps = openGaps(state);
      if (gaps.length === 0) break;

      await runRetrieveUnderstandRound();

      if (openGaps(state).length === 0) break;
      if (noNewHitsRounds >= 2) break;
    }
    }

    if (!stageApiWithTap?.signal?.aborted && !budgetStopRequested) {
      const maxWriteBacktrack = 3;
      while (!stageApiWithTap?.signal?.aborted && !budgetStopRequested) {
        checkCancelled(stageApiWithTap);
        const { value: writeOut } = await callStage("deepsearch.write", () => runDeepSearchWriteStage(runContext, { state }, stageApiWithTap), { stageState: state });
        updateTaskProgress();

        const feedbackToResearch = writeOut?.feedbackToResearch;
        const needsMoreResearch = Boolean(feedbackToResearch?.needsMoreResearch);
        const reopenGaps = Array.isArray(feedbackToResearch?.reopenGaps) ? feedbackToResearch.reopenGaps : [];
        const newGaps = Array.isArray(feedbackToResearch?.newGaps) ? feedbackToResearch.newGaps : [];

        if (!needsMoreResearch) break;
        if (state.iteration >= state.maxIterations) break;
        if ((safeInt(state.writeBacktrackCount) ?? 0) >= maxWriteBacktrack) break;
        if (reopenGaps.length === 0 && newGaps.length === 0) break;

        state.saveWriteSnapshot();
        state.writeBacktrackCount = (safeInt(state.writeBacktrackCount) ?? 0) + 1;
        state.reopenGaps(reopenGaps, { reason: feedbackToResearch?.reason });
        state.addNewGaps(newGaps);
        noNewHitsRounds = 0;

        emit?.("deepsearch.write.backtrack.requested", {
          writeBacktrackCount: state.writeBacktrackCount,
          maxWriteBacktrack,
          feedbackToResearch,
        });
        state.addTimeline({
          name: "deepsearch.write.backtrack.requested",
          status: "info",
          payload: { writeBacktrackCount: state.writeBacktrackCount, maxWriteBacktrack, ...(feedbackToResearch ? { feedbackToResearch } : {}) },
        });

        while (state.iteration < state.maxIterations && openGaps(state).length > 0 && !stageApiWithTap?.signal?.aborted && !budgetStopRequested) {
          if (noNewHitsRounds >= 2) break;
          await runRetrieveUnderstandRound();
          if (openGaps(state).length === 0) break;
          if (noNewHitsRounds >= 2) break;
        }
      }

      if (!budgetStopRequested) {
        checkCancelled(stageApiWithTap);
        await callStage("deepsearch.condense", () => runDeepSearchCondenseStage(runContext, { state }, stageApiWithTap), { stageState: state });
      }
      updateTaskProgress();
    } else {
      state.addTimeline({ name: "deepsearch.aborted", status: "warning", payload: { iteration: state.iteration } });
      emit?.("deepsearch.aborted", { iteration: state.iteration });
    }

    const sources = Array.isArray(state?.L0?.sources) ? state.L0.sources : [];
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

    emit?.("deepsearch.completed", { runId: state.runId, slideCount: slideIntents.length, claimCount: claims.length });
    if (taskManager && taskId) {
      if (stageApi?.signal?.aborted && typeof taskManager.cancel === "function") {
        taskManager.cancel(taskId, "aborted");
      } else {
        taskManager.complete(taskId, { runId: state.runId, metrics: pkg?.metrics?.deepsearch || null });
      }
    }
    return pkg;
    } catch (err) {
      if (taskManager && taskId) taskManager.fail(taskId, err);
      throw err;
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
