/**
 * DesignBlackboard - 设计阶段的黑板机制
 *
 * 重构：支持可选 MemoryStore 集成
 * - 有 MemoryStore 时：数据同步到 L1/L2
 * - 无 MemoryStore 时：使用本地存储（向后兼容）
 * - 可选 StateEngine 集成：使用统一的状态引擎作为 SSOT（与 DeepSearch/CodeSearch 保持一致）
 *
 * 映射关系：
 * - summaries → MemoryStore.L1.stageSummaries
 * - signals → MemoryStore.L1.signals
 * - decisions → MemoryStore.recordDecision()
 */

import { toNonEmptyString, isPlainObject } from "../../../shared/index.js";
import { DisposableBase } from "../../../shared/index.js";
import {
  L1_ADD_SIGNAL,
  L1_ACKNOWLEDGE_SIGNAL,
  L1_SET_DECK,
  L2_ADD_SUMMARY,
  L2_RECORD_DECISION,
} from "../../../plugins/memory/index.js";

const DESIGN_PREFIX = "design.";

/** 危险 key，用于防止原型污染 */
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function cloneValue(value) {
  if (value === null || value === undefined) return value;
  try {
    return structuredClone(value);
  } catch {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return value;
    }
  }
}

function stripDesignPrefix(value) {
  const s = String(value || "");
  return s.startsWith(DESIGN_PREFIX) ? s.slice(DESIGN_PREFIX.length) : s;
}

export class DesignBlackboard extends DisposableBase {
  /**
   * @param {{ runId?: string, limits?: Record<string, any>, memoryStore?: any, stateEngine?: any }} [options]
   */
  constructor({ runId, limits = {}, memoryStore = null, stateEngine = null } = {}) {
    super();
    this.runId = toNonEmptyString(runId) || `design_${Date.now()}`;
    this.createdAt = new Date().toISOString();

    this.limits = {
      summariesMax: 20,
      signalsMax: 50,
      decisionsMax: 100,
      ...limits,
    };

    // 外部依赖
    this._memoryStore = memoryStore || null;
    this._stateEngine = stateEngine || null;
    this._stateEngineUnsubscribe = null;

    // 本地存储（当无 MemoryStore 时使用）
    this._summaries = new Map();
    this._signals = [];
    this._decisions = [];
    this._versions = [];
    this._deck = null;

    // Register cleanup for all subscriptions/resources
    this._registerDisposable(() => {
      if (this._stateEngineUnsubscribe) {
        try {
          this._stateEngineUnsubscribe();
        } catch { /* ignore */ }
        this._stateEngineUnsubscribe = null;
      }
      this._stateEngine = null;
      this._memoryStore = null;

      try {
        this._summaries?.clear?.();
      } catch { /* ignore */ }
      if (Array.isArray(this._signals)) this._signals.length = 0;
      if (Array.isArray(this._decisions)) this._decisions.length = 0;
      if (Array.isArray(this._versions)) this._versions.length = 0;
      this._deck = null;
    });

    if (stateEngine) this.bindStateEngine(stateEngine);
  }

  /**
   * 绑定 MemoryStore
   */
  bindMemoryStore(memoryStore) {
    this._ensureNotDisposed();
    this._memoryStore = memoryStore || null;
    if (!memoryStore) return;

    // 同步现有数据到 MemoryStore
    if (this._summaries.size > 0) {
      for (const [stage, summary] of this._summaries) {
        this._syncSummaryToMemory(stage, summary);
      }
    }

    if (this._signals.length > 0) {
      for (const signal of this._signals) {
        this._syncSignalToMemory(signal);
      }
    }

    if (this._decisions.length > 0) {
      for (const decision of this._decisions) {
        this._syncDecisionToMemory(decision);
      }
    }
  }

  /**
   * 绑定 StateEngine
   */
  bindStateEngine(stateEngine) {
    this._ensureNotDisposed();
    if (this._stateEngineUnsubscribe) {
      try {
        this._stateEngineUnsubscribe();
      } catch { /* ignore */ }
      this._stateEngineUnsubscribe = null;
    }

    this._stateEngine = stateEngine || null;
    const engine = this._stateEngine;
    if (!engine) return;

    // Seed engine from current effective values (only when engine lacks Design entries).
    try {
      const snap = typeof engine._getStateRef === "function" ? engine._getStateRef() : engine.getState?.();
      const l1 = snap?.L1 || null;
      const l2 = snap?.L2 || null;

      const hasDesignSummaries = isPlainObject(l2?.stageSummaries)
        ? Object.keys(l2.stageSummaries).some((k) => String(k).startsWith(DESIGN_PREFIX))
        : false;
      if (!hasDesignSummaries) {
        const seed = this.getAllSummaries();
        const actions = Object.entries(seed).map(([stage, summary]) => ({
          type: L2_ADD_SUMMARY,
          payload: { summary: { stage: `${DESIGN_PREFIX}${stage}`, summary: String(summary ?? "") } },
        }));
        if (actions.length > 0) {
          if (typeof engine.dispatchBatchSync === "function") engine.dispatchBatchSync(actions);
          else if (typeof engine.dispatchSync === "function") actions.forEach((a) => engine.dispatchSync(a));
        }
      }

      const hasDeck = Object.prototype.hasOwnProperty.call(l1 || {}, "deck") && l1.deck != null;
      if (!hasDeck && this._deck != null && typeof engine.dispatchSync === "function") {
        engine.dispatchSync({ type: L1_SET_DECK, payload: { deck: cloneValue(this._deck) } });
      }

      const hasDesignSignals = Array.isArray(l1?.signals)
        ? l1.signals.some((s) => String(s?.type || "").startsWith(DESIGN_PREFIX))
        : false;
      if (!hasDesignSignals && this._signals.length > 0 && typeof engine.dispatchSync === "function") {
        for (const sig of this._signals) {
          this._syncSignalToStateEngine(sig);
        }
      }

      const hasDesignDecisions = Array.isArray(l2?.decisions)
        ? l2.decisions.some((d) => String(d?.action || "").startsWith(DESIGN_PREFIX))
        : false;
      if (!hasDesignDecisions && this._decisions.length > 0 && typeof engine.dispatchSync === "function") {
        for (const decision of this._decisions) {
          this._syncDecisionToStateEngine(decision);
        }
      }
    } catch {
      // ignore seeding errors
    }

    // 初始同步
    this._syncFromStateEngine();

    // 订阅变更
    if (typeof engine.subscribe === "function") {
      const unsubs = [];
      unsubs.push(engine.subscribe("L1", (_action, _prevL1, nextL1) => this._syncFromStateEngine(nextL1, null)));
      unsubs.push(engine.subscribe("L2", (_action, _prevL2, nextL2) => this._syncFromStateEngine(null, nextL2)));
      this._stateEngineUnsubscribe = () => {
        for (const u of unsubs) {
          try {
            u?.();
          } catch { /* ignore */ }
        }
      };
    }
  }

  _syncFromStateEngine(nextL1 = null, nextL2 = null) {
    const engine = this._stateEngine;
    if (!engine) return;

    let l1 = nextL1;
    let l2 = nextL2;

    if (!l1 || !l2) {
      try {
        const snap = typeof engine._getStateRef === "function" ? engine._getStateRef() : engine.getState?.();
        if (!l1) l1 = snap?.L1 || null;
        if (!l2) l2 = snap?.L2 || null;
      } catch {
        // ignore
      }
    }

    if (l1) {
      if (Object.prototype.hasOwnProperty.call(l1, "deck")) {
        this._deck = cloneValue(l1.deck);
      }

      if (Array.isArray(l1.signals)) {
        const nextSignals = [];
        for (const s of l1.signals) {
          const kind = String(s?.type || "");
          if (!kind.startsWith(DESIGN_PREFIX)) continue;
          if (s?.acknowledged === true) continue;

          nextSignals.push({
            id: toNonEmptyString(s?.id) || null,
            type: stripDesignPrefix(kind) || "unknown",
            payload: cloneValue(isPlainObject(s?.payload) ? s.payload : {}),
            timestamp: typeof s?.ts === "number" ? s.ts : Date.now(),
          });
        }
        this._signals = nextSignals;
        this._pruneArray(this._signals, this.limits.signalsMax);
      }
    }

    if (l2) {
      if (isPlainObject(l2.stageSummaries)) {
        const entries = Object.entries(l2.stageSummaries).filter(([k]) => String(k).startsWith(DESIGN_PREFIX));
        this._summaries = new Map(entries.map(([k, v]) => [stripDesignPrefix(k), String(v ?? "")]));
        this._pruneMap(this._summaries, this.limits.summariesMax);
      }

      if (Array.isArray(l2.decisions)) {
        const nextDecisions = l2.decisions
          .filter((d) => String(d?.action || "").startsWith(DESIGN_PREFIX))
          .map((d) => {
            const raw = isPlainObject(d) ? d : { action: String(d ?? "unknown") };
            const action = stripDesignPrefix(raw.action) || "unknown";
            return { ...cloneValue(raw), action };
          });
        this._decisions = nextDecisions;
        this._pruneArray(this._decisions, this.limits.decisionsMax);
      }
    }
  }

  // ===== Deck =====

  setDeck(deck) {
    this._ensureNotDisposed();
    this._deck = deck ?? null;
    this._syncDeckToStateEngine(this._deck);
    return this._deck;
  }

  getDeck() {
    // 优先从 StateEngine 读取
    if (this._stateEngine) {
      try {
        const snap = this._stateEngine.getState?.() || this._stateEngine._getStateRef?.();
        if (snap && snap.L1 && Object.prototype.hasOwnProperty.call(snap.L1, "deck")) {
          return snap.L1.deck;
        }
      } catch { /* fallback */ }
    }
    return this._deck;
  }

  // ===== L1: Summaries =====

  setSummary(stage, summary) {
    this._ensureNotDisposed();
    const s = toNonEmptyString(stage);
    if (!s) return;
    const text = String(summary || "");

    this._summaries.set(s, text);
    this._pruneMap(this._summaries, this.limits.summariesMax);

    this._syncSummaryToMemory(s, text);
    this._syncSummaryToStateEngine(s, text);
  }

  _syncSummaryToMemory(stage, summary) {
    if (!this._memoryStore) return;

    try {
      // 使用 L2 stageSummary（更合适的层级）
      if (typeof this._memoryStore.setStageSummary === "function") {
        this._memoryStore.setStageSummary(`design.${stage}`, summary);
      } else if (this._memoryStore.L2) {
        if (!isPlainObject(this._memoryStore.L2.stageSummaries)) {
          this._memoryStore.L2.stageSummaries = {};
        }
        this._memoryStore.L2.stageSummaries[`design.${stage}`] = summary;
      }
    } catch { /* intentional */ }
  }

  getSummary(stage) {
    const key = String(stage || "");

    // 优先从 StateEngine 读取
    if (this._stateEngine) {
      try {
        const snap = this._stateEngine.getState?.() || this._stateEngine._getStateRef?.();
        const summaries = snap?.L2?.stageSummaries;
        const fullKey = `${DESIGN_PREFIX}${key}`;
        if (isPlainObject(summaries) && Object.prototype.hasOwnProperty.call(summaries, fullKey)) {
          return summaries[fullKey];
        }
      } catch { /* fallback */ }
    }

    // 优先从 MemoryStore 读取
    if (this._memoryStore) {
      try {
        const memSummaries = this._memoryStore.L2?.stageSummaries;
        const fullKey = `${DESIGN_PREFIX}${key}`;
        if (isPlainObject(memSummaries) && Object.prototype.hasOwnProperty.call(memSummaries, fullKey)) {
          return memSummaries[fullKey];
        }
      } catch { /* fallback */ }
    }

    return this._summaries.get(key) || null;
  }

  getAllSummaries() {
    /** @type {Record<string, string>} */
    const out = Object.create(null);

    // 合并 StateEngine 和 MemoryStore 和本地
    if (this._stateEngine) {
      try {
        const snap = this._stateEngine.getState?.() || this._stateEngine._getStateRef?.();
        const stageSummaries = snap?.L2?.stageSummaries;
        if (isPlainObject(stageSummaries)) {
          for (const [k, v] of Object.entries(stageSummaries)) {
            const key = String(k).slice(DESIGN_PREFIX.length);
            if (String(k).startsWith(DESIGN_PREFIX) && !DANGEROUS_KEYS.has(key)) {
              out[key] = v;
            }
          }
        }
      } catch { /* fallback */ }
    }

    // 合并 MemoryStore 和本地
    if (this._memoryStore?.L2?.stageSummaries) {
      for (const [k, v] of Object.entries(this._memoryStore.L2.stageSummaries)) {
        const key = String(k).slice(DESIGN_PREFIX.length);
        if (String(k).startsWith(DESIGN_PREFIX) && !DANGEROUS_KEYS.has(key)) {
          if (!Object.prototype.hasOwnProperty.call(out, key)) out[key] = v;
        }
      }
    }

    for (const [k, v] of this._summaries) {
      if (!DANGEROUS_KEYS.has(k) && !out[k]) out[k] = v;
    }

    return out;
  }

  // ===== Signals =====

  pushSignal(type, payload = {}) {
    this._ensureNotDisposed();
    const signal = {
      type: toNonEmptyString(type) || "unknown",
      payload,
      timestamp: Date.now(),
    };
    this._signals.push(signal);
    this._pruneArray(this._signals, this.limits.signalsMax);

    this._syncSignalToMemory(signal);
    this._syncSignalToStateEngine(signal);
    return signal;
  }

  _syncSignalToMemory(signal) {
    if (!this._memoryStore) return;

    try {
      if (typeof this._memoryStore.addSignal === "function") {
        this._memoryStore.addSignal({
          kind: `design.${signal.type}`,
          message: signal.payload?.message || JSON.stringify(signal.payload),
          ts: signal.timestamp,
          source: "design-blackboard",
        });
      }
    } catch { /* intentional */ }
  }

  popSignal() {
    const signal = this._signals.shift() || null;

    // 同步到 StateEngine（acknowledge）
    const engine = this._stateEngine;
    const id = toNonEmptyString(signal?.id);
    if (engine && id && typeof engine.dispatchSync === "function") {
      try {
        engine.dispatchSync({ type: L1_ACKNOWLEDGE_SIGNAL, payload: { id } });
      } catch { /* intentional */ }
    }

    return signal;
  }

  peekSignals(count = 5) {
    return this._signals.slice(0, count);
  }

  hasSignal(type) {
    return this._signals.some((s) => s.type === type);
  }

  clearSignals(type) {
    const engine = this._stateEngine;
    const toClear = type ? this._signals.filter((s) => s.type === type) : [...this._signals];

    if (type) this._signals = this._signals.filter((s) => s.type !== type);
    else this._signals = [];

    // 同步到 StateEngine（acknowledge all cleared）
    if (engine && toClear.length > 0) {
      const ids = toClear.map((s) => toNonEmptyString(s?.id)).filter(Boolean);
      if (ids.length > 0) {
        const actions = ids.map((id) => ({ type: L1_ACKNOWLEDGE_SIGNAL, payload: { id } }));
        try {
          if (typeof engine.dispatchBatchSync === "function") engine.dispatchBatchSync(actions);
          else if (typeof engine.dispatchSync === "function") actions.forEach((a) => engine.dispatchSync(a));
        } catch { /* intentional */ }
      }
    }
  }

  // ===== Decisions =====

  logDecision(action, reason, meta = {}) {
    this._ensureNotDisposed();
    const decision = {
      action: toNonEmptyString(action) || "unknown",
      reason: toNonEmptyString(reason) || "",
      ...meta,
      timestamp: Date.now(),
    };
    this._decisions.push(decision);
    this._pruneArray(this._decisions, this.limits.decisionsMax);

    this._syncDecisionToMemory(decision);
    this._syncDecisionToStateEngine(decision);
    return decision;
  }

  _syncDecisionToMemory(decision) {
    if (!this._memoryStore) return;

    try {
      if (typeof this._memoryStore.recordDecision === "function") {
        this._memoryStore.recordDecision({
          action: `design.${decision.action}`,
          reason: decision.reason,
          meta: decision,
        });
      }
    } catch { /* intentional */ }
  }

  getRecentDecisions(count = 5) {
    return this._decisions.slice(-count);
  }

  // ===== StateEngine Sync Helpers =====

  _syncDeckToStateEngine(deck) {
    const engine = this._stateEngine;
    if (!engine || typeof engine.dispatchSync !== "function") return;

    try {
      engine.dispatchSync({ type: L1_SET_DECK, payload: { deck: cloneValue(deck) } });
    } catch { /* intentional */ }
  }

  _syncSummaryToStateEngine(stage, summary) {
    const engine = this._stateEngine;
    if (!engine || typeof engine.dispatchSync !== "function") return;

    try {
      engine.dispatchSync({
        type: L2_ADD_SUMMARY,
        payload: { summary: { stage: `${DESIGN_PREFIX}${stage}`, summary: String(summary ?? "") } },
      });
    } catch { /* intentional */ }
  }

  _syncSignalToStateEngine(signal) {
    const engine = this._stateEngine;
    if (!engine || typeof engine.dispatchSync !== "function") return;

    try {
      const payload = isPlainObject(signal?.payload) ? signal.payload : {};
      const message = toNonEmptyString(payload.message) || toNonEmptyString(payload.reason) || "";

      engine.dispatchSync({
        type: L1_ADD_SIGNAL,
        payload: {
          signal: {
            type: `${DESIGN_PREFIX}${signal?.type || "unknown"}`,
            message,
            payload: cloneValue(payload),
          },
        },
      });
    } catch { /* intentional */ }
  }

  _syncDecisionToStateEngine(decision) {
    const engine = this._stateEngine;
    if (!engine || typeof engine.dispatchSync !== "function") return;

    try {
      engine.dispatchSync({
        type: L2_RECORD_DECISION,
        payload: { decision: { ...cloneValue(decision), action: `${DESIGN_PREFIX}${decision?.action || "unknown"}` } },
      });
    } catch { /* intentional */ }
  }

  // ===== Versions =====

  saveVersion(label, snapshot) {
    const version = {
      label: toNonEmptyString(label) || `v${this._versions.length + 1}`,
      snapshot,
      timestamp: Date.now(),
    };
    this._versions.push(version);
    return version;
  }

  getVersion(label) {
    return this._versions.find((v) => v.label === label) || null;
  }

  listVersions() {
    return this._versions.map((v) => ({ label: v.label, timestamp: v.timestamp }));
  }

  restoreVersion(versionId) {
    const label = toNonEmptyString(versionId);
    if (!label) return null;
    const version = this.getVersion(label);
    if (!version) return null;
    this._currentVersion = version.label;
    return version.snapshot ?? null;
  }

  // ===== Blackboard Prompt =====

  buildBlackboardPrompt({ maxSignals = 5, maxDecisions = 3 } = {}) {
    const sections = [];

    // L1 摘要
    const allSummaries = this.getAllSummaries();
    const summaryLines = Object.entries(allSummaries)
      .filter(([_, v]) => v)
      .map(([stage, summary]) => `[${stage}] ${summary}`);

    if (summaryLines.length > 0) {
      sections.push(`## 设计摘要\n${summaryLines.join("\n")}`);
    }

    // 待处理信号
    const pendingSignals = this._signals.slice(0, maxSignals);
    if (pendingSignals.length > 0) {
      const signalLines = pendingSignals.map((s) => {
        const msg = s.payload?.message || s.payload?.reason || JSON.stringify(s.payload);
        return `- [${s.type}] ${msg}`;
      });
      sections.push(`## 待处理信号\n${signalLines.join("\n")}`);
    }

    // 最近决策
    const recentDecisions = this._decisions.slice(-maxDecisions);
    if (recentDecisions.length > 0) {
      const decisionLines = recentDecisions.map((d) => {
        return `- ${d.action}${d.reason ? `: ${d.reason}` : ""}`;
      });
      sections.push(`## 最近决策\n${decisionLines.join("\n")}`);
    }

    return sections.join("\n\n");
  }

  // ===== Helpers =====

  _pruneArray(arr, max) {
    const cap = Number.isFinite(max) ? Math.max(0, Math.floor(max)) : 0;
    while (arr.length > cap) arr.shift();
  }

  _pruneMap(map, max) {
    const cap = Number.isFinite(max) ? Math.max(0, Math.floor(max)) : 0;
    while (map.size > cap) {
      const firstKey = map.keys().next().value;
      map.delete(firstKey);
    }
  }

  // ===== Serialization =====

  toJSON() {
    return {
      runId: this.runId,
      createdAt: this.createdAt,
      summaries: this.getAllSummaries(),
      signals: [...this._signals],
      decisions: [...this._decisions],
      versions: this._versions.map((v) => ({ label: v.label, timestamp: v.timestamp })),
    };
  }

  static fromJSON(data, { memoryStore = null } = {}) {
    const bb = new DesignBlackboard({ runId: data?.runId, memoryStore });
    if (data?.summaries) {
      for (const [k, v] of Object.entries(data.summaries)) {
        bb._summaries.set(k, v);
      }
    }
    if (Array.isArray(data?.signals)) {
      bb._signals = data.signals;
    }
    if (Array.isArray(data?.decisions)) {
      bb._decisions = data.decisions;
    }
    return bb;
  }
}
