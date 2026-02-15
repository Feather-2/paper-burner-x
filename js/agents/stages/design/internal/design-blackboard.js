/**
 * DesignBlackboard - 设计阶段黑板（Facade）
 *
 * 通过组合拆分职责：
 * - DesignState: summaries/signals/decisions/deck
 * - DesignCheckpoints: versions
 */

import { toNonEmptyString, isPlainObject, createLogger, DisposableBase } from "../../../shared/index.js";
import { deepClone } from "../../../shared/utils/value-utils.js";
import { DesignState } from "./design-state.js";
import { DesignCheckpoints } from "./design-checkpoints.js";

const logger = createLogger("stages/design/blackboard");

/**
 * @typedef {object} ArchiveLike
 * @property {(runId: string, data: Record<string, any>) => Promise<string>|string} [save]
 * @property {(key: string) => Promise<any>|any} [load]
 * @property {(checkpointId: string) => Promise<any>|any} [restore]
 * @property {(key: string) => Promise<any>|any} [get]
 * @property {(key: string, value: any) => Promise<any>|any} [set]
 */

function logSilentError(context, err) {
  const message = err instanceof Error ? err.message : String(err);
  logger.debug(`[design.blackboard] ${context} failed`, { error: message });
}

function logSilentWarning(context, err) {
  const message = err instanceof Error ? err.message : String(err);
  if (typeof logger.warn === "function") {
    logger.warn(`[design.blackboard] ${context} failed`, { error: message });
    return;
  }
  logger.debug(`[design.blackboard] ${context} failed`, { error: message });
}

function cloneValue(value) {
  if (value === null || value === undefined) return value;
  return deepClone(value);
}

export class DesignBlackboard extends DisposableBase {
  /**
   * @param {{ runId?: string, limits?: Record<string, any>, memoryStore?: any, stateEngine?: any, archive?: ArchiveLike|null }} [options]
   */
  constructor({ runId, limits = {}, memoryStore = null, stateEngine = null, archive = null } = {}) {
    super();
    this.runId = toNonEmptyString(runId) || `design_${Date.now()}`;
    this.createdAt = new Date().toISOString();
    this.limits = {
      summariesMax: 20,
      signalsMax: 50,
      decisionsMax: 100,
      ...limits,
    };

    this._archive = archive || null;
    this._lastCheckpointId = null;
    this._lastCheckpointSnapshot = null;
    this._checkpointPending = null;
    this._currentVersion = null;

    this._state = new DesignState({
      limits: this.limits,
      memoryStore,
      stateEngine,
    });
    this._checkpoints = new DesignCheckpoints({ designState: this._state });

    this._installLegacyAliases();

    this._registerDisposable(() => {
      this._archive = null;
      this._lastCheckpointId = null;
      this._lastCheckpointSnapshot = null;
      this._checkpointPending = null;
      this._currentVersion = null;

      try {
        this._checkpoints.versions = [];
      } catch (err) {
        logSilentError("dispose.clearVersions", err);
      }
      try {
        this._state.dispose();
      } catch (err) {
        logSilentError("dispose.state", err);
      }
    });
  }

  _installLegacyAliases() {
    const defineAlias = (name, getter, setter) => {
      Object.defineProperty(this, name, {
        configurable: true,
        enumerable: false,
        get: getter,
        set: setter,
      });
    };

    defineAlias("_summaries", () => this._state.summaries, (value) => {
      this._state.summaries = value;
    });
    defineAlias("_signals", () => this._state.signals, (value) => {
      this._state.signals = value;
    });
    defineAlias("_decisions", () => this._state.decisions, (value) => {
      this._state.decisions = value;
    });
    defineAlias("_deck", () => this._state.deck, (value) => {
      this._state.deck = value;
    });
    defineAlias("_versions", () => this._checkpoints.versions, (value) => {
      this._checkpoints.versions = value;
    });
    defineAlias("_memoryStore", () => this._state.memoryStore, (value) => {
      this._state.bindMemoryStore(value);
    });
    defineAlias("_stateEngine", () => this._state.stateEngine, (value) => {
      this._state._stateEngine = value || null;
    });
    defineAlias("_stateEngineUnsubscribe", () => this._state._stateEngineUnsubscribe, (value) => {
      this._state._stateEngineUnsubscribe = typeof value === "function" ? value : null;
    });
  }

  // ===== Dependencies =====

  /**
   * @param {any} memoryStore
   */
  bindMemoryStore(memoryStore) {
    this._ensureNotDisposed();
    this._state.bindMemoryStore(memoryStore);
  }

  /**
   * @param {any} stateEngine
   */
  bindStateEngine(stateEngine) {
    this._ensureNotDisposed();
    this._state.bindStateEngine(stateEngine);
  }

  // ===== Deck =====

  setDeck(deck) {
    this._ensureNotDisposed();
    return this._state.setDeck(deck);
  }

  getDeck() {
    return this._state.getDeck();
  }

  // ===== Summaries =====

  setSummary(stage, summary) {
    this._ensureNotDisposed();
    this._state.setSummary(stage, summary);
  }

  getSummary(stage) {
    return this._state.getSummary(stage);
  }

  getAllSummaries() {
    return this._state.getAllSummaries();
  }

  // ===== Signals =====

  pushSignal(type, payload = {}) {
    this._ensureNotDisposed();
    return this._state.addSignal(type, payload);
  }

  popSignal() {
    return this._state.popSignal();
  }

  peekSignals(count = 5) {
    return this._state.peekSignals(count);
  }

  hasSignal(type) {
    return this._state.hasSignal(type);
  }

  clearSignals(type) {
    this._state.clearSignals(type);
  }

  // ===== Decisions =====

  logDecision(action, reason, meta = {}) {
    this._ensureNotDisposed();
    return this._state.logDecision(action, reason, meta);
  }

  getRecentDecisions(count = 5) {
    return this._state.getRecentDecisions(count);
  }

  // ===== Versions =====

  saveVersion(label, snapshot) {
    return this._checkpoints.saveVersion(this._state, label, snapshot);
  }

  getVersion(label) {
    return this._checkpoints.getVersion(label);
  }

  listVersions() {
    return this._checkpoints.listVersions();
  }

  restoreVersion(versionId) {
    const label = toNonEmptyString(versionId);
    if (!label) return null;
    const version = this.getVersion(label);
    if (!version) return null;
    this._currentVersion = version.label;
    return this._checkpoints.restoreVersion(label, null);
  }

  // ===== Blackboard Prompt =====

  buildBlackboardPrompt({ maxSignals = 5, maxDecisions = 3 } = {}) {
    const sections = [];

    const allSummaries = this.getAllSummaries();
    const summaryLines = Object.entries(allSummaries)
      .filter(([, value]) => value)
      .map(([stage, summary]) => `[${stage}] ${summary}`);
    if (summaryLines.length > 0) {
      sections.push(`## 设计摘要\n${summaryLines.join("\n")}`);
    }

    const pendingSignals = this._state.getSignals().slice(0, maxSignals);
    if (pendingSignals.length > 0) {
      const signalLines = pendingSignals.map((signal) => {
        const msg = signal.payload?.message || signal.payload?.reason || JSON.stringify(signal.payload);
        return `- [${signal.type}] ${msg}`;
      });
      sections.push(`## 待处理信号\n${signalLines.join("\n")}`);
    }

    const recentDecisions = this._state.getDecisions().slice(-maxDecisions);
    if (recentDecisions.length > 0) {
      const decisionLines = recentDecisions.map((decision) => `- ${decision.action}${decision.reason ? `: ${decision.reason}` : ""}`);
      sections.push(`## 最近决策\n${decisionLines.join("\n")}`);
    }

    return sections.join("\n\n");
  }

  _beginCheckpointTransaction(snapshot) {
    const previous = {
      lastCheckpointId: this._lastCheckpointId,
      lastCheckpointSnapshot: cloneValue(this._lastCheckpointSnapshot),
      checkpointPending: cloneValue(this._checkpointPending),
    };
    this._lastCheckpointSnapshot = cloneValue(snapshot);
    this._checkpointPending = {
      runId: this.runId,
      startedAt: Date.now(),
    };
    return previous;
  }

  _rollbackCheckpointTransaction(previous) {
    const prev = isPlainObject(previous) ? previous : {};
    this._lastCheckpointId = toNonEmptyString(prev.lastCheckpointId) || null;
    this._lastCheckpointSnapshot = cloneValue(prev.lastCheckpointSnapshot);
    this._checkpointPending = cloneValue(prev.checkpointPending);
  }

  _finishCheckpointTransaction(checkpointId) {
    const normalized = toNonEmptyString(checkpointId) || null;
    if (normalized) this._lastCheckpointId = normalized;
    this._checkpointPending = null;
    return normalized;
  }

  /**
   * 保存当前黑板状态到 Archive（best-effort）。
   * @returns {Promise<string|null>}
   */
  async checkpoint() {
    if (this.disposed) return null;
    if (!this._archive) return null;

    const snapshot = this._createArchiveSnapshot();
    let txState = null;

    try {
      txState = this._beginCheckpointTransaction(snapshot);
    } catch (err) {
      logSilentWarning("checkpoint.prepareMemory", err);
      return null;
    }

    try {
      if (typeof this._archive.save === "function") {
        const checkpointId = await this._archive.save(this.runId, {
          nodeStates: snapshot,
          timestamp: new Date().toISOString(),
          metadata: { kind: "design.blackboard", runId: this.runId },
        });
        return this._finishCheckpointTransaction(checkpointId);
      }

      if (typeof this._archive.set === "function") {
        const key = `design.blackboard.${this.runId}`;
        await this._archive.set(key, snapshot);
        return this._finishCheckpointTransaction(key);
      }
    } catch (err) {
      if (txState) {
        try {
          this._rollbackCheckpointTransaction(txState);
        } catch (rollbackErr) {
          logSilentWarning("checkpoint.rollback", rollbackErr);
        }
      }
      logSilentWarning("checkpoint.archive", err);
      return null;
    }

    if (txState) {
      try {
        this._rollbackCheckpointTransaction(txState);
      } catch (rollbackErr) {
        logSilentWarning("checkpoint.rollback.noop", rollbackErr);
      }
    }
    return null;
  }

  /**
   * 从 Archive 恢复状态（best-effort）。
   * @returns {Promise<boolean>}
   */
  async init() {
    if (this.disposed) return false;
    if (!this._archive) return false;

    /** @type {any} */
    let restored = null;

    if (!restored && typeof this._archive.load === "function") {
      try {
        restored = await this._archive.load(this.runId);
      } catch (err) {
        logSilentWarning("init.archive.load", err);
      }
    }

    if (!restored && this._lastCheckpointId && typeof this._archive.restore === "function") {
      try {
        restored = await this._archive.restore(this._lastCheckpointId);
      } catch (err) {
        logSilentWarning("init.archive.restoreLast", err);
      }
    }

    if (!restored && typeof this._archive.get === "function") {
      try {
        restored = await this._archive.get(`design.blackboard.${this.runId}`);
        if (!restored) restored = await this._archive.get(this.runId);
      } catch (err) {
        logSilentWarning("init.archive.get", err);
      }
    }

    if (!restored && typeof this._archive.restore === "function") {
      try {
        restored = await this._archive.restore(this.runId);
      } catch (err) {
        logSilentWarning("init.archive.restore", err);
      }
    }

    const snapshot = this._extractArchiveSnapshot(restored);
    if (!snapshot) return false;

    try {
      this._applyArchiveSnapshot(snapshot);
    } catch (err) {
      logSilentWarning("init.applySnapshot", err);
      return false;
    }

    return true;
  }

  _createArchiveSnapshot() {
    const stateJson = this._state.toJSON();
    return {
      runId: this.runId,
      createdAt: this.createdAt,
      summaries: stateJson.summaries,
      signals: stateJson.signals,
      decisions: stateJson.decisions,
      versions: cloneValue(this._checkpoints.toJSON().versions) || [],
      deck: stateJson.deck,
    };
  }

  /**
   * @param {any} raw
   * @returns {any}
   */
  _extractArchiveSnapshot(raw) {
    if (!raw || typeof raw !== "object") return null;
    if (isPlainObject(raw.nodeStates)) return raw.nodeStates;
    if (isPlainObject(raw.snapshot)) return raw.snapshot;
    if (isPlainObject(raw.state)) return raw.state;
    return isPlainObject(raw) ? raw : null;
  }

  /**
   * @param {any} snapshot
   */
  _applyArchiveSnapshot(snapshot) {
    const data = isPlainObject(snapshot) ? snapshot : {};

    const restoredRunId = toNonEmptyString(data.runId);
    if (restoredRunId) this.runId = restoredRunId;
    const restoredCreatedAt = toNonEmptyString(data.createdAt);
    if (restoredCreatedAt) this.createdAt = restoredCreatedAt;

    this._state.fromJSON(data);
    this._checkpoints.fromJSON({ versions: data.versions });

    const metadata = isPlainObject(data.metadata) ? data.metadata : null;
    const restoredCheckpointId = toNonEmptyString(data.checkpointId) || toNonEmptyString(metadata?.checkpointId) || null;
    if (restoredCheckpointId) this._lastCheckpointId = restoredCheckpointId;
    this._lastCheckpointSnapshot = cloneValue(this._createArchiveSnapshot());
    this._checkpointPending = null;
  }

  // ===== Serialization =====

  toJSON() {
    const stateJson = this._state.toJSON();
    return {
      runId: this.runId,
      createdAt: this.createdAt,
      summaries: stateJson.summaries,
      signals: cloneValue(stateJson.signals) || [],
      decisions: cloneValue(stateJson.decisions) || [],
      versions: this._checkpoints.listVersions(),
    };
  }

  /**
   * 从 JSON 恢复黑板状态（实例方法）。
   * @param {any} data
   * @returns {DesignBlackboard}
   */
  fromJSON(data) {
    const source = isPlainObject(data) ? data : {};
    const restoredRunId = toNonEmptyString(source.runId);
    if (restoredRunId) this.runId = restoredRunId;
    const restoredCreatedAt = toNonEmptyString(source.createdAt);
    if (restoredCreatedAt) this.createdAt = restoredCreatedAt;
    this._state.fromJSON(source);
    this._checkpoints.fromJSON({ versions: source.versions });
    return this;
  }

  /**
   * @param {any} data
   * @param {{ memoryStore?: any, stateEngine?: any, archive?: ArchiveLike|null }} [options]
   * @returns {DesignBlackboard}
   */
  static fromJSON(data, { memoryStore = null, stateEngine = null, archive = null } = {}) {
    return new DesignBlackboard({
      runId: data?.runId,
      memoryStore,
      stateEngine,
      archive,
    }).fromJSON(data);
  }
}

