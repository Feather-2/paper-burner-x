import { Archive, FallbackAdapter, MapAdapter } from "../../../shared/index.js";
import { CheckpointType, createCheckpoint, migrateCheckpoint } from "../../../shared/index.js";
import { deepClone } from "../../../shared/utils/value-utils.js";
import { AgentStatus, StagePausedError, createLifecycleEmitter } from "../../../runtime/index.js";
import { getRuntimeState } from "../../../plugins/telemetry/index.js";
import { DesignPhase, designPhaseMachine } from "../states.js";
import { BacktrackError } from "../design-helpers.js";
import { createResumeToolExecutor } from "./tool-handler.js";

/**
 * @returns {import("./design-loop-types.js").DesignLoopState}
 */
export function createEmptyDesignLoopState() {
  return {
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
}

const stateManagerMethods = {
  /**
   * @param {string} label
   * @returns {any}
   */
  saveVersion(label) {
    if (!this._blackboard) return null;
    const snapshot = {
      phase: this.phase?.status,
      loopStatus: this._loopStatus,
      state: deepClone(this.state),
      timestamp: Date.now(),
    };
    return this._blackboard.saveVersion(label, snapshot);
  },

  /**
   * @param {string} label
   * @returns {any}
   */
  getVersion(label) {
    return this._blackboard?.getVersion(label) || null;
  },

  /**
   * @returns {any[]}
   */
  listVersions() {
    return this._blackboard?.listVersions() || [];
  },

  /**
   * Backtrack to a specific version (throws BacktrackError to restart the loop).
   * @param {string} label - version label
   * @param {string} [reason] - backtrack reason
   * @throws {BacktrackError} triggers the main loop to restart from the target phase
   */
  backtrackTo(label, reason = "user_requested") {
    if (!this._blackboard) throw new Error("Cannot backtrack: no blackboard");
    const version = this._blackboard.getVersion(label);
    if (!version) throw new Error(`Cannot backtrack: version "${label}" not found`);
    const targetPhase = version.snapshot?.phase || DesignPhase.IDLE;
    if (version.snapshot?.phase) this.phase.status = version.snapshot.phase;
    if (version.snapshot?.loopStatus) this._loopStatus = version.snapshot.loopStatus;

    if (version.snapshot?.state) {
      this.state = deepClone(version.snapshot.state);
    }

    this._blackboard.restoreVersion(label);
    this._emit?.("design.backtrack", { label, targetPhase, reason, timestamp: Date.now() });

    this._isBacktracking = true;
    throw new BacktrackError(targetPhase, label, reason);
  },

  /**
   * Backtrack to the most recent checkpoint.
   * @param {string} [reason] - backtrack reason
   * @throws {BacktrackError} triggers the main loop to restart from the target phase
   */
  backtrackToLastCheckpoint(reason = "auto_recovery") {
    const versions = this.listVersions();
    if (versions.length === 0) throw new Error("Cannot backtrack: no versions available");
    const latest = versions[versions.length - 1];
    this.backtrackTo(latest.label, reason);
  },

  /**
   * @returns {Record<string, any>}
   */
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
  },

  /**
   * @param {any} nodeStates
   * @returns {void}
   */
  hydrateFromNodeStates(nodeStates) {
    const source = nodeStates && typeof nodeStates === "object" ? nodeStates : {};
    if (!this.state || typeof this.state !== "object") this.state = createEmptyDesignLoopState();

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
  },

  /**
   * @param {import("./design-loop-types.js").DesignPhaseState} state
   * @param {string} next
   * @param {{ emit?: Function, runId?: string, payload?: any, lifecycle?: any }} [context]
   * @returns {string}
   */
  _transitionPhase(state, next, { emit, runId, payload, lifecycle } = {}) {
    const from = state.status;
    const ok = designPhaseMachine.transition(state, next, { runId, from, to: next, ...payload });
    if (!ok) {
      throw new Error(`DesignPhase transition rejected: ${from} -> ${next}`);
    }
    const phaseLifecycle =
      lifecycle ||
      this._lifecycle ||
      createLifecycleEmitter({
        actor: "design",
        emit,
        eventBus: this.eventBus,
      });
    const traceContext = this._traceContext;
    if (traceContext && typeof traceContext.startSpan === "function" && typeof traceContext.endSpan === "function") {
      const span = traceContext.startSpan("design.phase.transition", {
        attributes: { from, to: next, runId },
      });
      try {
        phaseLifecycle.phaseTransition(from, next, runId, payload);
      } finally {
        traceContext.endSpan(span);
      }
    } else {
      phaseLifecycle.phaseTransition(from, next, runId, payload);
    }
    return next;
  },

  /**
   * @param {string} newStatus
   * @param {Record<string, any>} [metadata]
   * @returns {Promise<string|null>}
   */
  async _transitionTo(newStatus, metadata = {}) {
    const oldStatus = this._loopStatus;
    if (oldStatus === newStatus) return null;

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
      /** @type {import("./design-loop-types.js").ErrorWithCode} */ (err).code = "INVALID_STATE_TRANSITION";
      throw err;
    }

    const meta = metadata && typeof metadata === "object" ? metadata : {};
    const { stageApi, nodeStates, ...historyMeta } = meta;
    const timestamp = Date.now();
    const runtimeState = stageApi?.signal ? getRuntimeState(stageApi.signal) : null;
    const runtimePauseRequested = runtimeState?.status === "paused";
    let checkpointId = null;

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

    this._emitAgentStatusChanged({ from: oldStatus, to: newStatus, timestamp, ...historyMeta });

    return checkpointId;
  },

  /**
   * @param {any} payload
   * @returns {void}
   */
  _emitAgentStatusChanged(payload) {
    const emit = this.emit || this.eventBus?.emit;
    if (typeof emit !== "function") return;
    emit("design.agent.status.changed", { actor: "design", status: "info", payload });
  },

  /**
   * @param {Record<string, any>} metadata
   * @returns {Promise<string|null>}
   */
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
  },
};

const stateManagerAccessors = {
  loopStatus: {
    get() {
      return this._loopStatus;
    },
  },
  statusHistory: {
    get() {
      return [...this._statusHistory];
    },
  },
};

export function installStateManager(ctor) {
  Object.assign(ctor.prototype, stateManagerMethods);
  Object.defineProperties(ctor.prototype, stateManagerAccessors);
}

export async function resumeDesignAgentLoop(
  checkpointId,
  stageApi = {},
  { DesignAgentLoopCtor } = /** @type {{ DesignAgentLoopCtor?: new (...args: any[]) => any }} */ ({})
) {
  if (typeof DesignAgentLoopCtor !== "function") {
    throw new Error("resumeDesignAgentLoop: missing DesignAgentLoopCtor");
  }
  const archive =
    stageApi?.archive ||
    new Archive(typeof indexedDB !== "undefined" ? new FallbackAdapter("PPTArchiveDB", "checkpoints") : new MapAdapter());

  const snapshot = migrateCheckpoint(await archive.restore(checkpointId));
  if (!snapshot?.nodeStates) {
    throw new Error(`Checkpoint not found: ${checkpointId}`);
  }

  const nodeStates = snapshot.nodeStates || {};

  const agentLoop = new DesignAgentLoopCtor({ ...stageApi, archive });
  const restoredLoopStatus = nodeStates.loopStatus || AgentStatus.IDLE;
  const restoredPhase = nodeStates.phase || DesignPhase.IDLE;

  agentLoop._loopStatus = AgentStatus.IDLE;
  agentLoop.phase = { status: DesignPhase.IDLE };
  if (Array.isArray(nodeStates.statusHistory)) {
    agentLoop._statusHistory.length = 0;
    for (const entry of nodeStates.statusHistory) agentLoop._statusHistory.push({ ...entry });
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

  const toolExecutor = createResumeToolExecutor({ agentLoop, stageApi, resumeState, contentPackage });

  return agentLoop.run(contentPackage, {
    ...stageApi,
    runContext,
    resumed: true,
    resumeState,
    toolExecutor,
  });
}
