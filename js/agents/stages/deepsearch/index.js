// DeepSearch stage entry: S2-S7 pipeline to produce ContentPackage v0.1 (DeepSearch mode).

import { buildContentPackage } from "../textprep/build-content-package.js";
import { DeepSearchState, checkCancelled, makeStageEmitter } from "./state.js";
import { runDeepSearchScanStage } from "./scan.js";
import { runDeepSearchGapsStage } from "./gaps.js";
import { runDeepSearchRetrieveStage } from "./retrieve.js";
import { runDeepSearchUnderstandStage } from "./understand.js";
import { runDeepSearchWriteStage } from "./write.js";
import { runDeepSearchCondenseStage } from "./condense.js";

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function safeInt(n) {
  return typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : null;
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
    const gid = String(r?.gapId || "");
    if (!gid) continue;
    hitCountByGapId.set(gid, (hitCountByGapId.get(gid) || 0) + 1);
  }

  const filledGapIds = new Set();
  for (const e of evidenceLedger) {
    const chunkId = String(e?.chunkId || "");
    const r = retrievedByChunkId.get(chunkId);
    if (!r) continue;
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
   * @param {{emit?:Function,eventBus?:object,signal?:AbortSignal,checkCancelled?:Function,aiApiService?:object}=} stageApi
   * @returns {Promise<object>} ContentPackage v0.1
   */
  async execute(runContext, input, stageApi = {}) {
    const emit = makeStageEmitter(stageApi, "deepsearch");
    const state = ensureState(runContext, input);
    if (runContext?.runId) state.runId = String(runContext.runId);

    emit?.("deepsearch.started", { runId: state.runId });

    checkCancelled(stageApi);
    await runDeepSearchScanStage(runContext, { state }, stageApi);

    const seenHitSignatures = new Set();
    let noNewHitsRounds = 0;

    while (state.iteration < state.maxIterations && !stageApi?.signal?.aborted) {
      checkCancelled(stageApi);
      await runDeepSearchGapsStage(runContext, { state }, stageApi);

      const gaps = openGaps(state);
      if (gaps.length === 0) break;

      checkCancelled(stageApi);
      const { retrievedChunks } = await runDeepSearchRetrieveStage(runContext, { state }, stageApi);

      let newHitCount = 0;
      for (const r of Array.isArray(retrievedChunks) ? retrievedChunks : []) {
        const sig = signatureForRetrievedChunk(r);
        if (!seenHitSignatures.has(sig)) {
          seenHitSignatures.add(sig);
          newHitCount++;
        }
      }
      noNewHitsRounds = newHitCount === 0 ? noNewHitsRounds + 1 : 0;

      checkCancelled(stageApi);
      await runDeepSearchUnderstandStage(runContext, { state }, stageApi);

      validateIteration(state, { blockAfterMisses: getGapBlockAfterMisses(state) });

      const checkpoint = state.saveCheckpoint();
      emit?.("deepsearch.checkpoint.saved", { checkpointId: checkpoint.checkpointId, iteration: checkpoint.iteration, metrics: checkpoint.metrics });
      state.addTimeline({ name: "deepsearch.checkpoint.saved", status: "info", payload: { checkpointId: checkpoint.checkpointId, iteration: checkpoint.iteration } });

      state.iteration += 1;

      if (openGaps(state).length === 0) break;
      if (noNewHitsRounds >= 2) break;
    }

    if (!stageApi?.signal?.aborted) {
      checkCancelled(stageApi);
      await runDeepSearchWriteStage(runContext, { state }, stageApi);

      checkCancelled(stageApi);
      await runDeepSearchCondenseStage(runContext, { state }, stageApi);
    } else {
      state.addTimeline({ name: "deepsearch.aborted", status: "warning", payload: { iteration: state.iteration } });
      emit?.("deepsearch.aborted", { iteration: state.iteration });
    }

    const sources = Array.isArray(state?.L0?.sources) ? state.L0.sources : [];
    const slideIntents = Array.isArray(state?.L1?.slideIntents) ? state.L1.slideIntents : [];
    const claims = Array.isArray(state?.L1?.claims) ? state.L1.claims : [];
    const evidenceLedger = Array.isArray(state?.L1?.evidenceLedger) ? state.L1.evidenceLedger : [];
    const dataTables = Array.isArray(state?.L1?.dataTables) ? state.L1.dataTables : [];

    const pkg = buildContentPackage(runContext || { runId: state.runId, mode: "deepsearch", constraints: {} }, sources, slideIntents, claims, evidenceLedger, dataTables, {
      mode: "deepsearch",
      scanSummary: state?.L1?.scanSummary || null,
      gaps: Array.isArray(state?.L1?.gaps) ? state.L1.gaps : [],
      condensedMemory: state?.L1?.condensedMemory || null,
      openQuestions: Array.isArray(state?.L1?.openQuestions) ? state.L1.openQuestions : [],
      outlineCandidates: Array.isArray(state?.L1?.outlineCandidates) ? state.L1.outlineCandidates : [],
    });

    if (pkg?.metrics) {
      const gaps = Array.isArray(state?.L1?.gaps) ? state.L1.gaps : [];
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
      };
    }

    emit?.("deepsearch.completed", { runId: state.runId, slideCount: slideIntents.length, claimCount: claims.length });
    return pkg;
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
  isOpenGap,
  openGaps,
  getGapBlockAfterMisses,
  signatureForRetrievedChunk,
  validateIteration,
};
