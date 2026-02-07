import { isPlainObject, toNonEmptyString } from "../../shared/index.js";
import { deepClone } from "../../shared/utils/value-utils.js";
import {
  L2_SET_HISTORY_SUMMARY,
  L2_APPEND_HISTORY_SUMMARY,
  L1_SET_MESSAGES,
  L3_ARCHIVE,
  L3_ADD_CHECKPOINT,
} from "./action-types.js";
import { L3Storage } from "./l3-storage.js";
import { DEFAULT_CONFIG, estimateBytes, estimateTokensValue, genId, truncate } from "./unified-memory-store.utils.js";

export function applyLifecycleMethods(UnifiedMemoryStore) {
  UnifiedMemoryStore.prototype.dispose = function dispose() {
    if (this._unsubscribeEngine) {
      try {
        this._unsubscribeEngine();
      } catch {
        // ignore
      }
      this._unsubscribeEngine = null;
    }
    if (this._retrievalEngine?.dispose) {
      try {
        this._retrievalEngine.dispose();
      } catch {
        // ignore
      }
    }
  };

  UnifiedMemoryStore.prototype.archive = async function archive(stageKey, data, keywords = []) {
    const l3Storage = await this._getL3Storage();
    if (l3Storage) {
      const id = await l3Storage.archive(stageKey, data, keywords);
      const entry = await l3Storage.getSnapshot(id);
      if (entry) {
        this._emit("memory:archived", { id, stageKey: entry.stageKey, summary: entry.summary, ts: entry.ts });
      } else {
        this._emit("memory:archived", { id, stageKey, ts: Date.now() });
      }
      return id;
    }

    const entry = {
      stageKey,
      data,
      summary: data?.summary || (typeof data === "object" ? JSON.stringify(data).slice(0, 200) : String(data).slice(0, 200)),
      ts: Date.now(),
    };
    const entryBytes = estimateBytes(entry);
    this._ensureL3Capacity(entryBytes);

    const prevLen = Array.isArray(this._getStateRef().L3?.index?.timeline) ? this._getStateRef().L3.index.timeline.length : 0;
    this.dispatchSync({ type: L3_ARCHIVE, payload: { stageKey, data, keywords } });
    const timeline = Array.isArray(this._getStateRef().L3?.index?.timeline) ? this._getStateRef().L3.index.timeline : [];
    const last = timeline[timeline.length - 1];
    const id = toNonEmptyString(last?.id);
    if (id) {
      const snap = this._getStateRef().L3?.snapshots?.[id] || null;
      this._l3BytesUsed += estimateBytes(snap || entry);
      this._emit("memory:archived", { id, stageKey: last?.stageKey || stageKey || null, summary: snap?.summary || last?.summary, ts: last?.ts });
    }
    return id || (timeline.length > prevLen ? timeline[timeline.length - 1]?.id : null);
  };

  UnifiedMemoryStore.prototype.checkpoint = async function checkpoint(options) {
    const opts = isPlainObject(options) ? options : {};
    const incremental = opts.incremental ?? true;
    const fullSnapshotEvery = opts.fullSnapshotEvery ?? 5;

    const l3Storage = await this._getL3Storage();
    if (l3Storage) {
      this._updateTokenUsage();
      const id = genId("ckpt");
      const ts = Date.now();

      const checkpointIndex = await l3Storage.listCheckpoints();
      const checkpointCount = Array.isArray(checkpointIndex) ? checkpointIndex.length : 0;
      const shouldFull = !incremental || checkpointCount % fullSnapshotEvery === 0;

      let snapshot;
      if (shouldFull || !this._hasAnyDirty()) {
        snapshot = {
          id,
          runId: this.runId,
          ts,
          encoding: "full",
          L0: this.cloneL0(),
          L1: this.cloneL1(),
          L2: this.cloneL2(),
        };
      } else {
        snapshot = {
          id,
          runId: this.runId,
          ts,
          encoding: "incremental",
          dirtyLayers: { ...this._dirty },
          L0: /** @type {unknown} */ (undefined),
          L1: /** @type {unknown} */ (undefined),
          L2: /** @type {unknown} */ (undefined),
          baseId: /** @type {unknown} */ (undefined),
        };
        if (this._dirty.L0) snapshot.L0 = this.cloneL0();
        if (this._dirty.L1) snapshot.L1 = this.cloneL1();
        if (this._dirty.L2) snapshot.L2 = this.cloneL2();

        const lastMeta = checkpointCount > 0 ? checkpointIndex[checkpointCount - 1] : null;
        const baseId = toNonEmptyString(lastMeta?.id);
        if (baseId) snapshot.baseId = baseId;
      }

      await l3Storage.checkpoint(snapshot);
      this._clearDirty();
      return id;
    }

    this._updateTokenUsage();
    const id = genId("ckpt");
    const ts = Date.now();

    const checkpoints = Array.isArray(this._getStateRef().L3?.checkpoints) ? this._getStateRef().L3.checkpoints : [];
    const checkpointCount = checkpoints.length;
    const shouldFull = !incremental || checkpointCount % fullSnapshotEvery === 0;

    let snapshot;
    if (shouldFull || !this._hasAnyDirty()) {
      snapshot = {
        id,
        runId: this.runId,
        ts,
        encoding: "full",
        L0: this.cloneL0(),
        L1: this.cloneL1(),
        L2: this.cloneL2(),
      };
    } else {
      snapshot = {
        id,
        runId: this.runId,
        ts,
        encoding: "incremental",
        dirtyLayers: { ...this._dirty },
        L0: /** @type {unknown} */ (undefined),
        L1: /** @type {unknown} */ (undefined),
        L2: /** @type {unknown} */ (undefined),
        baseId: /** @type {unknown} */ (undefined),
      };
      if (this._dirty.L0) snapshot.L0 = this.cloneL0();
      if (this._dirty.L1) snapshot.L1 = this.cloneL1();
      if (this._dirty.L2) snapshot.L2 = this.cloneL2();

      const last = checkpoints[checkpointCount - 1];
      if (last?.id) snapshot.baseId = last.id;
    }

    const snapshotBytes = estimateBytes(snapshot);
    this._ensureL3Capacity(snapshotBytes);

    this.dispatchSync({ type: L3_ADD_CHECKPOINT, payload: { checkpoint: deepClone(snapshot) } });
    this._l3BytesUsed += snapshotBytes;
    this._clearDirty();
    return id;
  };

  UnifiedMemoryStore.prototype.restore = function restore(checkpointId) {
    const id = toNonEmptyString(checkpointId);
    if (!id) return false;

    const checkpoints = Array.isArray(this._getStateRef().L3?.checkpoints) ? this._getStateRef().L3.checkpoints : [];
    const ckpt = checkpoints.find((c) => c?.id === id) || null;
    if (!ckpt) return false;

    const restored = this._restoreCheckpointLayers(ckpt, checkpoints);
    if (!restored) return false;

    const prev = this._getStateRef();
    const nextState = {
      ...prev,
      L0: restored.L0,
      L1: restored.L1,
      L2: restored.L2,
    };

    this._engine.restoreSnapshot({ state: nextState, clock: this.getClockValue(), ts: Date.now() });
    this._updateTokenUsage();
    this._clearDirty();
    return true;
  };

  UnifiedMemoryStore.prototype._restoreCheckpointLayers = function _restoreCheckpointLayers(ckpt, checkpoints) {
    if (ckpt.encoding === "incremental" && ckpt.baseId) {
      let baseId = ckpt.baseId;
      const chain = [ckpt];
      while (baseId) {
        const base = checkpoints.find((c) => c?.id === baseId);
        if (!base) break;
        chain.unshift(base);
        if (base.encoding === "full") break;
        baseId = base.baseId;
      }
      const full = chain.find((c) => c?.encoding === "full");
      if (!full) return null;

      let L0 = deepClone(full.L0 || {});
      let L1 = deepClone(full.L1 || {});
      let L2 = deepClone(full.L2 || {});

      for (const node of chain) {
        if (node.L0) L0 = deepClone(node.L0);
        if (node.L1) L1 = deepClone(node.L1);
        if (node.L2) L2 = deepClone(node.L2);
      }
      return { L0, L1, L2 };
    }

    const L0 = deepClone(ckpt.L0 || {});
    const L1 = deepClone(ckpt.L1 || {});
    const L2 = deepClone(ckpt.L2 || {});
    return { L0, L1, L2 };
  };

  UnifiedMemoryStore.prototype.compress = function compress({ force = false } = {}) {
    const { keepLastTurns, contextWindow, compressThreshold } = this.config;
    const messages = Array.isArray(this._getStateRef().L1?.messages) ? this._getStateRef().L1.messages : [];
    if (messages.length === 0) return false;

    this._updateTokenUsage();
    const thresholdRaw = Number.isFinite(contextWindow) && Number.isFinite(compressThreshold) ? contextWindow * compressThreshold : NaN;
    const threshold = Number.isFinite(thresholdRaw) ? Math.max(1, Math.floor(thresholdRaw)) : 0;
    const overBudget = force || (threshold > 0 && this._stats.tokenUsage >= threshold);
    if (!overBudget && messages.length <= keepLastTurns * 2) return false;

    const splitByTurns = (turnsToKeep) => {
      const kept = [];
      const toCompress = [];
      let turnCount = 0;

      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (turnCount < turnsToKeep) {
          kept.unshift(msg);
          if (msg?.role === "assistant") turnCount++;
        } else {
          toCompress.unshift(msg);
        }
      }
      return { kept, toCompress };
    };

    let turnsToKeep = typeof keepLastTurns === "number" && Number.isFinite(keepLastTurns) ? Math.max(1, Math.floor(keepLastTurns)) : 1;
    let { kept, toCompress } = splitByTurns(turnsToKeep);

    if (overBudget) {
      while (toCompress.length === 0 && turnsToKeep > 1) {
        turnsToKeep -= 1;
        ({ kept, toCompress } = splitByTurns(turnsToKeep));
      }
      if (toCompress.length === 0 && messages.length > 2) {
        kept = messages.slice(-2);
        toCompress = messages.slice(0, -2);
      }
    }

    if (toCompress.length === 0) return false;

    const hadHistorySummary = Boolean(this._getStateRef().L2?.historySummary);
    const summary = this._summarizeMessages(toCompress);

    const actions = [];
    actions.push(
      hadHistorySummary
        ? { type: L2_APPEND_HISTORY_SUMMARY, payload: { summary } }
        : { type: L2_SET_HISTORY_SUMMARY, payload: { summary } }
    );
    actions.push({ type: L1_SET_MESSAGES, payload: { messages: kept } });

    this.dispatchBatchSync(actions);
    this._stats.compressionCount += 1;
    this._emit("memory:compressed", { compressedCount: toCompress.length, keptCount: kept.length });
    this._updateTokenUsage();
    return true;
  };

  UnifiedMemoryStore.prototype._checkCompress = function _checkCompress() {
    const { contextWindow, compressThreshold } = this.config;
    if (!Number.isFinite(contextWindow) || !Number.isFinite(compressThreshold)) return;
    this._updateTokenUsage();
    if (this._stats.tokenUsage >= contextWindow * compressThreshold) {
      this.compress();
    }
  };

  UnifiedMemoryStore.prototype._summarizeMessages = function _summarizeMessages(messages) {
    const list = Array.isArray(messages) ? messages : [];
    const lines = [];
    for (const msg of list) {
      const role = toNonEmptyString(msg?.role) || "unknown";
      const content = truncate(String(msg?.content || "").replace(/\s+/g, " "), 100);
      if (content) lines.push(`[${role}] ${content}`);
    }
    return lines.join("\n");
  };

  /**
   * Serialize state for checkpoints/backtrack.
   * Schema matches MemoryStore.toSnapshot() for compatibility.
   */
  UnifiedMemoryStore.prototype.toSnapshot = function toSnapshot({ includeL3 = false, incremental = false } = {}) {
    const withL3 = includeL3 === true;
    this._updateTokenUsage();

    const s = this._getStateRef();
    const snapshot = {
      schemaVersion: "0.1",
      runId: this.runId,
      ts: new Date().toISOString(),
      config: deepClone(this.config),
      stats: { ...this._stats },
      _dirtyLayers: incremental ? { ...this._dirty } : null,
    };

    if (!incremental || this._dirty.L0) {
      snapshot.L0 = deepClone(s.L0);
    }

    if (!incremental || this._dirty.L1) {
      const sync = s.L1?.syncTable || {};
      snapshot.L1 = {
        messages: deepClone(s.L1?.messages || []),
        signals: deepClone(s.L1?.signals || []),
        decisions: deepClone(s.L1?.decisions || []),
        deck: Object.prototype.hasOwnProperty.call(s.L1 || {}, "deck") ? deepClone(s.L1.deck) : null,
        syncTable: {
          discoveries: Object.entries(sync.discoveries || {}),
          subagents: Object.entries(sync.subagents || {}),
        },
        scratchpad: deepClone(s.L1?.scratchpad || {}),
        flags: { ...(s.L1?.flags || {}) },
      };
    }

    if (!incremental || this._dirty.L2) {
      snapshot.L2 = {
        historySummary: toNonEmptyString(s.L2?.historySummary) || "",
        stageSummaries: Object.entries(s.L2?.stageSummaries || {}),
        claims: deepClone(s.L2?.claims || []),
      };
    }

    if (withL3 && (!incremental || this._dirty.L3)) {
      const idx = s.L3?.index || {};
      snapshot.L3 = {
        snapshots: Object.entries(s.L3?.snapshots || {}),
        index: {
          keywords: Object.entries(idx.keywords || {}),
          stages: Object.entries(idx.stages || {}),
          timeline: deepClone(idx.timeline || []),
        },
        checkpoints: deepClone(s.L3?.checkpoints || []),
      };
    }

    if (incremental) {
      this._clearDirty();
    }
    this._lastSnapshotTs = Date.now();
    return snapshot;
  };

  UnifiedMemoryStore.prototype.fromSnapshot = function fromSnapshot(snapshot) {
    const s = snapshot && typeof snapshot === "object" ? snapshot : null;
    if (!s) return false;

    if (typeof s.runId === "string" && s.runId) this.runId = s.runId;
    if (s.config && typeof s.config === "object") this.config = { ...DEFAULT_CONFIG, ...s.config };

    const prev = this._getStateRef();
    const nextState = {
      ...prev,
      runId: this.runId,
    };

    if (s.L0 && typeof s.L0 === "object") {
      nextState.L0 = deepClone(s.L0);
    }

    if (s.L1 && typeof s.L1 === "object") {
      const l1 = s.L1;
      const sync = l1.syncTable && typeof l1.syncTable === "object" ? l1.syncTable : {};
      nextState.L1 = {
        ...prev.L1,
        messages: Array.isArray(l1.messages) ? deepClone(l1.messages) : [],
        signals: Array.isArray(l1.signals) ? deepClone(l1.signals) : [],
        decisions: Array.isArray(l1.decisions) ? deepClone(l1.decisions) : [],
        ...(Object.prototype.hasOwnProperty.call(l1, "deck") ? { deck: deepClone(l1.deck) } : {}),
        syncTable: {
          discoveries: Object.fromEntries(Array.isArray(sync.discoveries) ? sync.discoveries : []),
          subagents: Object.fromEntries(Array.isArray(sync.subagents) ? sync.subagents : []),
        },
        scratchpad: isPlainObject(l1.scratchpad) ? deepClone(l1.scratchpad) : {},
        flags: isPlainObject(l1.flags) ? { ...(prev.L1?.flags || {}), ...l1.flags } : { ...(prev.L1?.flags || {}) },
      };
    }

    if (s.L2 && typeof s.L2 === "object") {
      const l2 = s.L2;
      nextState.L2 = {
        ...prev.L2,
        historySummary: typeof l2.historySummary === "string" ? l2.historySummary : "",
        stageSummaries: Object.fromEntries(Array.isArray(l2.stageSummaries) ? l2.stageSummaries : []),
        claims: Array.isArray(l2.claims) ? deepClone(l2.claims) : [],
      };
    }

    if (s.L3 && typeof s.L3 === "object") {
      const l3 = s.L3;
      const idx = l3.index && typeof l3.index === "object" ? l3.index : {};
      nextState.L3 = {
        ...prev.L3,
        snapshots: Object.fromEntries(Array.isArray(l3.snapshots) ? l3.snapshots : []),
        index: {
          keywords: Object.fromEntries(Array.isArray(idx.keywords) ? idx.keywords : []),
          stages: Object.fromEntries(Array.isArray(idx.stages) ? idx.stages : []),
          timeline: Array.isArray(idx.timeline) ? deepClone(idx.timeline) : [],
        },
        checkpoints: Array.isArray(l3.checkpoints) ? deepClone(l3.checkpoints) : [],
      };
    }

    if (s.stats && typeof s.stats === "object") {
      this._stats = { ...this._stats, ...s.stats };
    }

    this._engine.restoreSnapshot({ state: nextState, clock: this.getClockValue(), ts: Date.now() });

    this._recalculateL3Bytes();

    this._clearDirty();
    this._updateTokenUsage();
    return true;
  };

  UnifiedMemoryStore.prototype._recalculateL3Bytes = function _recalculateL3Bytes() {
    const s = this._getStateRef();
    let total = 0;
    const snapshots = s.L3?.snapshots || {};
    for (const entry of Object.values(snapshots)) {
      total += estimateBytes(entry);
    }
    const checkpoints = Array.isArray(s.L3?.checkpoints) ? s.L3.checkpoints : [];
    for (const ckpt of checkpoints) {
      total += estimateBytes(ckpt);
    }
    this._l3BytesUsed = total;
  };

  UnifiedMemoryStore.prototype._updateTokenUsage = function _updateTokenUsage() {
    const s = this._getStateRef();
    let l0Tokens = 0;
    l0Tokens += estimateTokensValue(s.L0?.systemPrompt, this._tokenCounter);
    const todos = Array.isArray(s.L0?.todos) ? s.L0.todos : [];
    for (const todo of todos) {
      l0Tokens += estimateTokensValue(todo?.content, this._tokenCounter);
    }

    let l1Tokens = 0;
    const messages = Array.isArray(s.L1?.messages) ? s.L1.messages : [];
    for (const msg of messages) {
      l1Tokens += estimateTokensValue(msg?.content, this._tokenCounter);
    }

    const l2Tokens = estimateTokensValue(s.L2?.historySummary, this._tokenCounter);

    this._stats.l0Tokens = l0Tokens;
    this._stats.l1Tokens = l1Tokens;
    this._stats.l2Tokens = l2Tokens;
    this._stats.tokenUsage = (l0Tokens || 0) + (l1Tokens || 0) + (l2Tokens || 0);
    return this._stats.tokenUsage;
  };

  UnifiedMemoryStore.prototype._getL3Storage = async function _getL3Storage() {
    const existing = this._l3Storage;
    if (existing) return existing;
    const vfs = this._vfs;
    if (!vfs) return null;

    const inFlight = this._l3StoragePromise;
    if (inFlight) return await inFlight;

    this._l3StoragePromise = (async () => {
      const created = new L3Storage({ vfs, runId: this.runId });
      this._l3Storage = created;
      return created;
    })();

    return await this._l3StoragePromise;
  };

  UnifiedMemoryStore.prototype._markDirty = function _markDirty(layer) {
    if (layer in this._dirty) this._dirty[layer] = true;
  };

  UnifiedMemoryStore.prototype._clearDirty = function _clearDirty(layer) {
    if (layer !== undefined) {
      if (layer in this._dirty) this._dirty[layer] = false;
    } else {
      this._dirty.L0 = false;
      this._dirty.L1 = false;
      this._dirty.L2 = false;
      this._dirty.L3 = false;
    }
  };

  UnifiedMemoryStore.prototype._hasAnyDirty = function _hasAnyDirty() {
    return Boolean(this._dirty.L0 || this._dirty.L1 || this._dirty.L2 || this._dirty.L3);
  };

  UnifiedMemoryStore.prototype._evictOldestSnapshot = function _evictOldestSnapshot() {
    const s = this._getStateRef();
    const timeline = Array.isArray(s.L3?.index?.timeline) ? s.L3.index.timeline : [];
    if (timeline.length === 0) return;

    const oldest = timeline[0];
    if (!oldest?.id) return;

    const snapshots = s.L3?.snapshots || {};
    const entry = snapshots[oldest.id];
    if (entry) {
      this._l3BytesUsed -= estimateBytes(entry);
    }

    const newSnapshots = { ...snapshots };
    delete newSnapshots[oldest.id];

    const newTimeline = timeline.slice(1);

    const newKeywords = {};
    const oldKeywords = s.L3?.index?.keywords || {};
    for (const [kw, ids] of Object.entries(oldKeywords)) {
      const filtered = Array.isArray(ids) ? ids.filter((id) => id !== oldest.id) : [];
      if (filtered.length > 0) newKeywords[kw] = filtered;
    }

    const prev = this._getStateRef();
    const nextState = {
      ...prev,
      L3: {
        ...prev.L3,
        snapshots: newSnapshots,
        index: {
          ...prev.L3?.index,
          keywords: newKeywords,
          timeline: newTimeline,
        },
      },
    };
    this._engine.restoreSnapshot({ state: nextState, clock: this.getClockValue(), ts: Date.now() });
  };

  UnifiedMemoryStore.prototype._evictOldestCheckpoint = function _evictOldestCheckpoint() {
    const s = this._getStateRef();
    const checkpoints = Array.isArray(s.L3?.checkpoints) ? s.L3.checkpoints : [];
    if (checkpoints.length === 0) return;

    const oldest = checkpoints[0];
    if (oldest) {
      this._l3BytesUsed -= estimateBytes(oldest);
    }

    const prev = this._getStateRef();
    const nextState = {
      ...prev,
      L3: {
        ...prev.L3,
        checkpoints: checkpoints.slice(1),
      },
    };
    this._engine.restoreSnapshot({ state: nextState, clock: this.getClockValue(), ts: Date.now() });
  };

  UnifiedMemoryStore.prototype._ensureL3Capacity = function _ensureL3Capacity(incomingBytes) {
    const maxBytes = this.config.maxL3Bytes;
    if (!Number.isFinite(maxBytes) || maxBytes <= 0) return;

    const s = this._getStateRef();

    let timeline = Array.isArray(s.L3?.index?.timeline) ? s.L3.index.timeline : [];
    while (this._l3BytesUsed + incomingBytes > maxBytes && timeline.length > 0) {
      this._evictOldestSnapshot();
      timeline = Array.isArray(this._getStateRef().L3?.index?.timeline) ? this._getStateRef().L3.index.timeline : [];
    }

    let checkpoints = Array.isArray(this._getStateRef().L3?.checkpoints) ? this._getStateRef().L3.checkpoints : [];
    while (this._l3BytesUsed + incomingBytes > maxBytes && checkpoints.length > 1) {
      this._evictOldestCheckpoint();
      checkpoints = Array.isArray(this._getStateRef().L3?.checkpoints) ? this._getStateRef().L3.checkpoints : [];
    }
  };

  UnifiedMemoryStore.prototype._emit = function _emit(name, payload) {
    if (this.eventBus?.emit) {
      this.eventBus.emit(name, { actor: "memory", payload });
    }
  };

  UnifiedMemoryStore.prototype._emitUpdate = function _emitUpdate(field, delta) {
    this._emit("memory:updated", { field, delta, ts: Date.now() });
  };
}
