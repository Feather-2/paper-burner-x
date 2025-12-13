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

function ensureState(runContext, input) {
  if (input instanceof DeepSearchState) return input;
  if (input?.state instanceof DeepSearchState) return input.state;
  if (isPlainObject(input?.state)) return DeepSearchState.fromJSON(input.state);

  const sources = Array.isArray(input?.sources) ? input.sources : [];
  const taskGoal = typeof input?.taskGoal === "string" ? input.taskGoal : "";
  const userConfig = isPlainObject(input?.userConfig) ? input.userConfig : {};
  return new DeepSearchState({ runId: runContext?.runId, taskGoal, userConfig, L0: { sources } });
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

    checkCancelled(stageApi);
    await runDeepSearchGapsStage(runContext, { state }, stageApi);

    checkCancelled(stageApi);
    await runDeepSearchRetrieveStage(runContext, { state }, stageApi);

    checkCancelled(stageApi);
    await runDeepSearchUnderstandStage(runContext, { state }, stageApi);

    checkCancelled(stageApi);
    await runDeepSearchWriteStage(runContext, { state }, stageApi);

    checkCancelled(stageApi);
    await runDeepSearchCondenseStage(runContext, { state }, stageApi);

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
      pkg.metrics.deepsearch = {
        sourceCount: Array.isArray(sources) ? sources.length : 0,
        gapCount: Array.isArray(state?.L1?.gaps) ? state.L1.gaps.length : 0,
        retrievedCount: Array.isArray(state?.L2?.retrievedChunks) ? state.L2.retrievedChunks.length : 0,
        claimCount: claims.length,
        evidenceCount: evidenceLedger.length,
        slideCount: slideIntents.length,
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

