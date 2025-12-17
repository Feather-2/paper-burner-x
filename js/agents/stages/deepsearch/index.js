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
import { logEvent, setLogContext, setEventBus } from "./logger.js";
import { SharedContext } from "./shared-context.js";
import { shouldUseDirectMode, runDirectAnalysis } from "./direct-analysis.js";
import { isPlainObject, safeInt } from "../../shared/value-utils.js";

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
  // 默认值从 5 调整为 3，减少无效空转
  return n !== null && n >= 1 ? n : 3;
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

  // noNewHitsRounds 阈值：连续 2 轮无高质量 hit 则停止（现在只计算 score >= threshold 的 hit）
  const noNewHitsRounds = safeInt(roundResult?.noNewHitsRounds);
  if (noNewHitsRounds !== null && noNewHitsRounds >= 2) return false;

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

    // 设置日志上下文和 EventBus
    setLogContext({ runId: state.runId, iteration: state.iteration || 0 });
    if (stageApi?.eventBus) {
      setEventBus(stageApi.eventBus);
    }

    // 记录 DeepSearch 流程开始
    logEvent({
      stage: 'deepsearch',
      message: 'DeepSearch pipeline started',
      data: {
        runId: state.runId,
        maxIterations: state.maxIterations,
        sourceCount: Array.isArray(state?.L0?.sources) ? state.L0.sources.length : 0,
      },
    });

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
      const runId = String(stageState?.runId || state?.runId || runContext?.runId || "run");
      const stageName = String(stage || "stage");
      const stageLabel = stageName.startsWith("deepsearch.") ? stageName.slice("deepsearch.".length) : stageName;
      const iteration = typeof stageState?.iteration === "number" ? stageState.iteration : typeof state?.iteration === "number" ? state.iteration : undefined;
      const trajectoryId = stageState?.trajectoryId || state?.trajectoryId;
      const nodeId = generateNodeId(runId, "stage", { stage: stageLabel, iteration, trajectoryId });
      const parentNodeId = trajectoryId ? `${runId}_${trajectoryId}` : runId;

      emit?.("deepsearch.node.started", {
        runId,
        nodeId,
        parentNodeId,
        kind: "stage",
        label: stageLabel,
        stage: stageLabel,
        iteration,
        trajectoryId,
      });

      try {
        const value = await errorHandler.withRetry(fn, {
          onRetry: ({ attempt, delay, error }) => {
            const retryErr = normalizeError(error, { stage });
            emit?.("deepsearch.node.failed", {
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
        emit?.("deepsearch.node.completed", { runId, nodeId, outcome: "success", summary: value?.summary });
        return { ok: true, value };
      } catch (err) {
        const dsErr = normalizeError(err, { stage });
        const recovered =
          dsErr.level === ErrorLevel.RECOVERABLE || dsErr.level === ErrorLevel.DEGRADABLE || dsErr.level === ErrorLevel.RETRYABLE;
        emit?.("deepsearch.node.failed", {
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

    emit?.("deepsearch.started", { runId: state.runId });

    try {
      checkCancelled(stageApiWithTap);

      // 小文档直通模式检测
      const directModeCheck = shouldUseDirectMode(state);
      if (directModeCheck.shouldUse) {
        logEvent({
          stage: "deepsearch",
          message: "Using direct analysis mode for small document",
          data: directModeCheck,
        });
        emit?.("deepsearch.direct.triggered", directModeCheck);

        const pkg = await runDirectAnalysis(runContext, { state }, stageApiWithTap);
        emit?.("deepsearch.completed", { runId: state.runId, mode: "direct" });
        return pkg;
      }

      await callStage("deepsearch.scan", () => runDeepSearchScanStage(runContext, { state }, stageApiWithTap), { stageState: state });
      updateTaskProgress();

      // SharedContext: 记录 scan 阶段摘要
      const scanSources = Array.isArray(state?.L0?.sources) ? state.L0.sources : [];
      const totalChars = scanSources.reduce((sum, s) => sum + (s?.sourceTextNormalized?.length || 0), 0);
      sharedCtx.commit("scan", {
        summary: `${scanSources.length} 个来源，共 ${totalChars} 字符，主题：${String(state.taskGoal || "").slice(0, 60)}`,
        keywords: [state.taskGoal, ...(state?.L1?.scanSummary?.keyTopics || [])].filter(Boolean).slice(0, 10),
      });

      if (budgetStopRequested) {
        emit?.("deepsearch.budget.stop", { iteration: state.iteration });
      }

      const seenHitSignatures = new Set();
      let noNewHitsRounds = 0;
      let lastRoundResult = null;
      const maxWriteBacktrack = 3;

      const trajectoryCfg = getTrajectoryConfig(state);
      const useTrajectories = (safeInt(trajectoryCfg.n) ?? 1) > 1;

      if (useTrajectories) {
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
                runExternalSearch,
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
      }

      let phase = useTrajectories ? "write" : "gaps";
      while (!stageApiWithTap?.signal?.aborted && !budgetStopRequested) {
        checkCancelled(stageApiWithTap);

        if (phase === "gaps") {
          if (state.iteration >= state.maxIterations) {
            phase = "write";
            continue;
          }
          await callStage("deepsearch.gaps", () => runDeepSearchGapsStage(runContext, { state }, stageApiWithTap), {
            stageState: state,
            fallbackValue: { state, gaps: Array.isArray(state?.L1?.gaps) ? state.L1.gaps : [], todos: [] },
          });
          updateTaskProgress();

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
            phase = "write";
            continue;
          }

          phase = "round";
          continue;
        }

        if (phase === "round") {
          if (state.iteration >= state.maxIterations) {
            phase = "write";
            continue;
          }
          if (openGaps(state).length === 0) {
            phase = "write";
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

          emit?.("deepsearch.iteration.started", {
            runId: state.runId,
            iteration: state.iteration,
            openGapCount: openGaps(state).length,
            trajectoryId: state.trajectoryId,
          });

          // 记录迭代开始
          logEvent({
            stage: 'deepsearch',
            message: `Iteration ${state.iteration} started`,
            data: {
              iteration: state.iteration,
              openGaps: openGaps(state).length,
              trajectoryId: state.trajectoryId,
            },
          });

          const { value: retrieveOut } = await callStage("deepsearch.retrieve", () => runDeepSearchRetrieveStage(runContext, { state }, stageApiWithTap), {
            stageState: state,
            fallbackValue: { state, retrievedChunks: [] },
          });
          const retrievedChunks = retrieveOut?.retrievedChunks;
          updateTaskProgress();

          // 只计算高质量 hit（score >= 阈值），低质量匹配不算有效 hit
          const qualityThreshold = safeInt(state?.userConfig?.retrieval?.qualityThreshold) ?? 0.3;
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

          await callStage("deepsearch.understand", () => runDeepSearchUnderstandStage(runContext, { state }, stageApiWithTap), {
            stageState: state,
            fallbackValue: { state },
          });
          updateTaskProgress();

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
                () => runExternalSearch(searchGaps, externalCfg, { emit, state, stageApi: stageApiWithTap }),
                { stageState: state, fallbackValue: { chunks: [], documents: [], evidences: [] } }
              );

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

              await callStage("deepsearch.understand", () => runDeepSearchUnderstandStage(runContext, { state }, stageApiWithTap), {
                stageState: state,
                fallbackValue: { state },
              });
              updateTaskProgress();
            }
          }

          const blockAfterMisses = getGapBlockAfterMisses(state);
          const roundHits = computeRoundHitsByGapId(retrievedChunks, 0.5);
          const validateOut = validateIteration(state, { roundHits, blockAfterMisses, emit });

          const completedIteration = state.iteration;
          const checkpoint = state.saveCheckpoint();
          emit?.("deepsearch.checkpoint.saved", { checkpointId: checkpoint.checkpointId, iteration: checkpoint.iteration, metrics: checkpoint.metrics });
          state.addTimeline({ name: "deepsearch.checkpoint.saved", status: "info", payload: { checkpointId: checkpoint.checkpointId, iteration: checkpoint.iteration } });

          emit?.("iteration.completed", {
            runId: state.runId,
            iteration: completedIteration,
            hitCount,
            qualityHitCount,
            noNewHitsRounds,
            ...(validateOut && typeof validateOut === "object" ? validateOut : {}),
            openGapCount: openGaps(state).length,
          });

          // 记录迭代完成
          logEvent({
            stage: 'deepsearch',
            message: `Iteration ${completedIteration} completed`,
            data: {
              iteration: completedIteration,
              hitCount,
              qualityHitCount,
              noNewHitsRounds,
              openGaps: openGaps(state).length,
              decision: shouldContinue(state, lastRoundResult) ? 'continue' : 'stop',
            },
          });

          state.iteration += 1;

          lastRoundResult = { hitCount, qualityHitCount, noNewHitsRounds, openGapCount: openGaps(state).length };
          phase = shouldContinue(state, lastRoundResult) ? "gaps" : "write";
          continue;
        }

        if (phase === "write") {
          const { value: writeOut } = await callStage("deepsearch.write", () => runDeepSearchWriteStage(runContext, { state }, stageApiWithTap), { stageState: state });
          updateTaskProgress();

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
            phase = "condense";
            continue;
          }

          state.saveWriteSnapshot();
          state.writeBacktrackCount = (safeInt(state.writeBacktrackCount) ?? 0) + 1;
          state.reopenGaps(reopenGaps, { reason: feedbackToResearch?.reason }, emit);
          state.addNewGaps(newGaps, {}, emit);
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

          phase = openGaps(state).length > 0 ? "round" : "write";
          continue;
        }

        if (phase === "condense") {
          await callStage("deepsearch.condense", () => runDeepSearchCondenseStage(runContext, { state }, stageApiWithTap), { stageState: state });
          updateTaskProgress();
          break;
        }

        // Safety: unknown phase means exit.
        break;
      }

      if (stageApiWithTap?.signal?.aborted || budgetStopRequested) {
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

    // 记录 DeepSearch 流程完成
    logEvent({
      stage: 'deepsearch',
      message: 'DeepSearch pipeline completed',
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
