/**
 * DesignState - 管理设计黑板核心状态（summaries / signals / decisions / deck）
 *
 * 支持可选 MemoryStore 与 StateEngine 同步：
 * - MemoryStore：向后兼容存储镜像
 * - StateEngine：作为统一状态源（SSOT）
 */

import { toNonEmptyString, isPlainObject, createLogger } from "../../../shared/index.js";
import { deepClone } from "../../../shared/utils/value-utils.js";
import {
  L1_ADD_SIGNAL,
  L1_ACKNOWLEDGE_SIGNAL,
  L1_SET_DECK,
  L2_ADD_SUMMARY,
  L2_RECORD_DECISION,
} from "../../../plugins/memory/index.js";

const logger = createLogger("stages/design/state");
const DESIGN_PREFIX = "design.";
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function logSilentError(context, err) {
  const message = err instanceof Error ? err.message : String(err);
  logger.debug(`[design.state] ${context} failed`, { error: message });
}

function cloneValue(value) {
  if (value === null || value === undefined) return value;
  return deepClone(value);
}

function stripDesignPrefix(value) {
  const s = String(value || "");
  return s.startsWith(DESIGN_PREFIX) ? s.slice(DESIGN_PREFIX.length) : s;
}

export class DesignState {
  /**
   * @param {{ limits?: Record<string, any>, memoryStore?: any, stateEngine?: any }} [options]
   */
  constructor({ limits = {}, memoryStore = null, stateEngine = null } = {}) {
    this.limits = {
      summariesMax: 20,
      signalsMax: 50,
      decisionsMax: 100,
      ...limits,
    };

    this._memoryStore = null;
    this._stateEngine = null;
    this._stateEngineUnsubscribe = null;

    this._summaries = new Map();
    this._signals = [];
    this._decisions = [];
    this._deck = null;

    if (memoryStore) this.bindMemoryStore(memoryStore);
    if (stateEngine) this.bindStateEngine(stateEngine);
  }

  dispose() {
    if (this._stateEngineUnsubscribe) {
      try {
        this._stateEngineUnsubscribe();
      } catch (err) {
        logSilentError("dispose.unsubscribe", err);
      }
      this._stateEngineUnsubscribe = null;
    }
    this._stateEngine = null;
    this._memoryStore = null;
    this._summaries.clear();
    this._signals.length = 0;
    this._decisions.length = 0;
    this._deck = null;
  }

  get memoryStore() {
    return this._memoryStore;
  }

  get stateEngine() {
    return this._stateEngine;
  }

  get summaries() {
    return this._summaries;
  }

  /**
   * @param {Map<string, string>|Record<string, any>|null|undefined} value
   */
  set summaries(value) {
    this._summaries = new Map();
    if (value instanceof Map) {
      for (const [stage, summary] of value.entries()) {
        const key = toNonEmptyString(stage);
        if (!key || DANGEROUS_KEYS.has(key)) continue;
        this._summaries.set(key, String(summary ?? ""));
      }
    } else if (isPlainObject(value)) {
      for (const [stage, summary] of Object.entries(value)) {
        const key = toNonEmptyString(stage);
        if (!key || DANGEROUS_KEYS.has(key)) continue;
        this._summaries.set(key, String(summary ?? ""));
      }
    }
    this._pruneMap(this._summaries, this.limits.summariesMax);
  }

  get signals() {
    return this._signals;
  }

  /**
   * @param {any} value
   */
  set signals(value) {
    this._signals = Array.isArray(value)
      ? value
          .map((signal) => {
            const raw = isPlainObject(signal) ? signal : {};
            return {
              id: toNonEmptyString(raw.id) || null,
              type: toNonEmptyString(raw.type) || "unknown",
              payload: cloneValue(isPlainObject(raw.payload) ? raw.payload : {}),
              timestamp: typeof raw.timestamp === "number" ? raw.timestamp : Date.now(),
            };
          })
          .filter(Boolean)
      : [];
    this._pruneArray(this._signals, this.limits.signalsMax);
  }

  get decisions() {
    return this._decisions;
  }

  /**
   * @param {any} value
   */
  set decisions(value) {
    this._decisions = Array.isArray(value)
      ? value
          .map((decision) => {
            const raw = isPlainObject(decision) ? decision : {};
            return {
              ...cloneValue(raw),
              action: toNonEmptyString(raw.action) || "unknown",
              reason: toNonEmptyString(raw.reason) || "",
              timestamp: typeof raw.timestamp === "number" ? raw.timestamp : Date.now(),
            };
          })
          .filter(Boolean)
      : [];
    this._pruneArray(this._decisions, this.limits.decisionsMax);
  }

  get deck() {
    return this._deck;
  }

  /**
   * @param {any} value
   */
  set deck(value) {
    this._deck = cloneValue(value ?? null);
  }

  /**
   * 绑定 MemoryStore
   * @param {any} memoryStore
   */
  bindMemoryStore(memoryStore) {
    this._memoryStore = memoryStore || null;
    if (!memoryStore) return;

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
   * @param {any} stateEngine
   */
  bindStateEngine(stateEngine) {
    const oldUnsubscribe = this._stateEngineUnsubscribe;
    this._stateEngineUnsubscribe = null;
    if (oldUnsubscribe) {
      try {
        oldUnsubscribe();
      } catch (err) {
        logSilentError("bindStateEngine.unsubscribe", err);
      }
    }

    this._stateEngine = stateEngine || null;
    const engine = this._stateEngine;
    if (!engine) return;

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
        for (const signal of this._signals) {
          this._syncSignalToStateEngine(signal);
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
    } catch (err) {
      logSilentError("bindStateEngine.seed", err);
    }

    this._syncFromStateEngine();

    if (typeof engine.subscribe === "function") {
      const unsubL1 = engine.subscribe("L1", (_action, _prevL1, nextL1) => this._syncFromStateEngine(nextL1, null));
      const unsubL2 = engine.subscribe("L2", (_action, _prevL2, nextL2) => this._syncFromStateEngine(null, nextL2));

      this._stateEngineUnsubscribe = () => {
        try {
          unsubL1?.();
        } catch (err) {
          logSilentError("bindStateEngine.unsubscribeL1", err);
        }
        try {
          unsubL2?.();
        } catch (err) {
          logSilentError("bindStateEngine.unsubscribeL2", err);
        }
      };
    }
  }

  /**
   * @param {any} nextL1
   * @param {any} nextL2
   */
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
      } catch (err) {
        logSilentError("syncFromStateEngine.read", err);
      }
    }

    if (l1) {
      if (Object.prototype.hasOwnProperty.call(l1, "deck")) {
        this._deck = cloneValue(l1.deck);
      }

      if (Array.isArray(l1.signals)) {
        const nextSignals = [];
        for (const signal of l1.signals) {
          const kind = String(signal?.type || "");
          if (!kind.startsWith(DESIGN_PREFIX)) continue;
          if (signal?.acknowledged === true) continue;
          nextSignals.push({
            id: toNonEmptyString(signal?.id) || null,
            type: stripDesignPrefix(kind) || "unknown",
            payload: cloneValue(isPlainObject(signal?.payload) ? signal.payload : {}),
            timestamp: typeof signal?.ts === "number" ? signal.ts : Date.now(),
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
          .filter((decision) => String(decision?.action || "").startsWith(DESIGN_PREFIX))
          .map((decision) => {
            const raw = isPlainObject(decision) ? decision : { action: String(decision ?? "unknown") };
            const action = stripDesignPrefix(raw.action) || "unknown";
            return { ...cloneValue(raw), action };
          });
        this._decisions = nextDecisions;
        this._pruneArray(this._decisions, this.limits.decisionsMax);
      }
    }
  }

  /**
   * @param {any} deck
   * @returns {any}
   */
  setDeck(deck) {
    this._deck = deck ?? null;
    this._syncDeckToStateEngine(this._deck);
    return this._deck;
  }

  getDeck() {
    if (this._stateEngine) {
      try {
        const snap = this._stateEngine.getState?.() || this._stateEngine._getStateRef?.();
        if (snap && snap.L1 && Object.prototype.hasOwnProperty.call(snap.L1, "deck")) {
          return snap.L1.deck;
        }
      } catch (err) {
        logSilentError("getDeck.stateEngine", err);
      }
    }
    return this._deck;
  }

  /**
   * @param {any} stage
   * @param {any} summary
   */
  setSummary(stage, summary) {
    const key = toNonEmptyString(stage);
    if (!key) return;
    const text = String(summary || "");

    this._summaries.set(key, text);
    this._pruneMap(this._summaries, this.limits.summariesMax);

    this._syncSummaryToMemory(key, text);
    this._syncSummaryToStateEngine(key, text);
  }

  /**
   * @param {any} stage
   * @returns {any}
   */
  getSummary(stage) {
    const key = String(stage || "");

    if (this._stateEngine) {
      try {
        const snap = this._stateEngine.getState?.() || this._stateEngine._getStateRef?.();
        const summaries = snap?.L2?.stageSummaries;
        const fullKey = `${DESIGN_PREFIX}${key}`;
        if (isPlainObject(summaries) && Object.prototype.hasOwnProperty.call(summaries, fullKey)) {
          return summaries[fullKey];
        }
      } catch (err) {
        logSilentError("getSummary.stateEngine", err);
      }
    }

    if (this._memoryStore) {
      try {
        const memSummaries = this._memoryStore.L2?.stageSummaries;
        const fullKey = `${DESIGN_PREFIX}${key}`;
        if (isPlainObject(memSummaries) && Object.prototype.hasOwnProperty.call(memSummaries, fullKey)) {
          return memSummaries[fullKey];
        }
      } catch (err) {
        logSilentError("getSummary.memoryStore", err);
      }
    }

    return this._summaries.get(key) || null;
  }

  /**
   * @returns {Record<string, string>}
   */
  getAllSummaries() {
    /** @type {Record<string, string>} */
    const out = Object.create(null);

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
      } catch (err) {
        logSilentError("getAllSummaries.stateEngine", err);
      }
    }

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

  /**
   * @param {any} type
   * @param {any} payload
   * @returns {{type: string, payload: any, timestamp: number}|null}
   */
  addSignal(type, payload = {}) {
    const signal = {
      type: toNonEmptyString(type) || "unknown",
      payload,
      timestamp: Date.now(),
    };
    this._signals.push(signal);
    this._pruneArray(this._signals, this.limits.signalsMax);
    if (!this._signals.includes(signal)) return null;

    this._syncSignalToMemory(signal);
    this._syncSignalToStateEngine(signal);
    return signal;
  }

  /**
   * @returns {any[]}
   */
  getSignals() {
    return this._signals;
  }

  /**
   * @returns {any|null}
   */
  popSignal() {
    const signal = this._signals.shift() || null;
    const id = toNonEmptyString(signal?.id);
    if (id) this._acknowledgeSignalIds([id]);
    return signal;
  }

  /**
   * @param {any} count
   * @returns {any[]}
   */
  peekSignals(count = 5) {
    return this._signals.slice(0, count);
  }

  /**
   * @param {string} type
   * @returns {boolean}
   */
  hasSignal(type) {
    return this._signals.some((signal) => signal.type === type);
  }

  /**
   * @param {string} [type]
   */
  clearSignals(type) {
    const toClear = type ? this._signals.filter((signal) => signal.type === type) : [...this._signals];
    if (type) this._signals = this._signals.filter((signal) => signal.type !== type);
    else this._signals = [];
    const ids = toClear.map((signal) => toNonEmptyString(signal?.id)).filter(Boolean);
    this._acknowledgeSignalIds(ids);
  }

  /**
   * @param {any} action
   * @param {any} reason
   * @param {Record<string, any>} [meta]
   * @returns {Record<string, any>}
   */
  logDecision(action, reason, meta = {}) {
    const decision = {
      action: toNonEmptyString(action) || "unknown",
      reason: toNonEmptyString(reason) || "",
      ...meta,
      timestamp: Date.now(),
    };
    this._decisions.push(decision);
    this._pruneArray(this._decisions, this.limits.decisionsMax);
    if (!this._decisions.includes(decision)) return decision;

    this._syncDecisionToMemory(decision);
    this._syncDecisionToStateEngine(decision);
    return decision;
  }

  /**
   * @returns {any[]}
   */
  getDecisions() {
    return this._decisions;
  }

  /**
   * @param {any} count
   * @returns {any[]}
   */
  getRecentDecisions(count = 5) {
    return this._decisions.slice(-count);
  }

  /**
   * @param {string[]} ids
   */
  _acknowledgeSignalIds(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return;
    const engine = this._stateEngine;
    if (!engine) return;
    const actions = ids.map((id) => ({ type: L1_ACKNOWLEDGE_SIGNAL, payload: { id } }));
    try {
      if (typeof engine.dispatchBatchSync === "function") engine.dispatchBatchSync(actions);
      else if (typeof engine.dispatchSync === "function") actions.forEach((action) => engine.dispatchSync(action));
    } catch (err) {
      logSilentError("acknowledgeSignalIds", err);
    }
  }

  /**
   * @param {string} stage
   * @param {string} summary
   */
  _syncSummaryToMemory(stage, summary) {
    if (!this._memoryStore) return;
    try {
      if (typeof this._memoryStore.setStageSummary === "function") {
        this._memoryStore.setStageSummary(`${DESIGN_PREFIX}${stage}`, summary);
      } else if (this._memoryStore.L2) {
        if (!isPlainObject(this._memoryStore.L2.stageSummaries)) this._memoryStore.L2.stageSummaries = {};
        this._memoryStore.L2.stageSummaries[`${DESIGN_PREFIX}${stage}`] = summary;
      }
    } catch (err) {
      logSilentError("syncSummaryToMemory", err);
    }
  }

  /**
   * @param {Record<string, any>} signal
   */
  _syncSignalToMemory(signal) {
    if (!this._memoryStore) return;
    try {
      if (typeof this._memoryStore.addSignal === "function") {
        this._memoryStore.addSignal({
          kind: `${DESIGN_PREFIX}${signal.type}`,
          message: signal.payload?.message || JSON.stringify(signal.payload),
          ts: signal.timestamp,
          source: "design-blackboard",
        });
      }
    } catch (err) {
      logSilentError("syncSignalToMemory", err);
    }
  }

  /**
   * @param {Record<string, any>} decision
   */
  _syncDecisionToMemory(decision) {
    if (!this._memoryStore) return;
    try {
      if (typeof this._memoryStore.recordDecision === "function") {
        this._memoryStore.recordDecision({
          action: `${DESIGN_PREFIX}${decision.action}`,
          reason: decision.reason,
          meta: decision,
        });
      }
    } catch (err) {
      logSilentError("syncDecisionToMemory", err);
    }
  }

  /**
   * @param {any} deck
   */
  _syncDeckToStateEngine(deck) {
    const engine = this._stateEngine;
    if (!engine || typeof engine.dispatchSync !== "function") return;
    try {
      engine.dispatchSync({ type: L1_SET_DECK, payload: { deck: cloneValue(deck) } });
    } catch (err) {
      logSilentError("syncDeckToStateEngine", err);
    }
  }

  /**
   * @param {string} stage
   * @param {string} summary
   */
  _syncSummaryToStateEngine(stage, summary) {
    const engine = this._stateEngine;
    if (!engine || typeof engine.dispatchSync !== "function") return;
    try {
      engine.dispatchSync({
        type: L2_ADD_SUMMARY,
        payload: { summary: { stage: `${DESIGN_PREFIX}${stage}`, summary: String(summary ?? "") } },
      });
    } catch (err) {
      logSilentError("syncSummaryToStateEngine", err);
    }
  }

  /**
   * @param {Record<string, any>} signal
   */
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
    } catch (err) {
      logSilentError("syncSignalToStateEngine", err);
    }
  }

  /**
   * @param {Record<string, any>} decision
   */
  _syncDecisionToStateEngine(decision) {
    const engine = this._stateEngine;
    if (!engine || typeof engine.dispatchSync !== "function") return;
    try {
      engine.dispatchSync({
        type: L2_RECORD_DECISION,
        payload: { decision: { ...cloneValue(decision), action: `${DESIGN_PREFIX}${decision?.action || "unknown"}` } },
      });
    } catch (err) {
      logSilentError("syncDecisionToStateEngine", err);
    }
  }

  /**
   * @returns {{ summaries: Record<string, string>, signals: any[], decisions: any[], deck: any }}
   */
  toJSON() {
    return {
      summaries: this.getAllSummaries(),
      signals: cloneValue(this._signals) || [],
      decisions: cloneValue(this._decisions) || [],
      deck: cloneValue(this.getDeck()),
    };
  }

  /**
   * @param {any} data
   * @returns {DesignState}
   */
  fromJSON(data) {
    const source = isPlainObject(data) ? data : {};

    this.summaries = source.summaries;
    this.signals = source.signals;
    this.decisions = source.decisions;
    if (Object.prototype.hasOwnProperty.call(source, "deck")) this.deck = source.deck;

    if (this._memoryStore) {
      try {
        this.bindMemoryStore(this._memoryStore);
      } catch (err) {
        logSilentError("fromJSON.bindMemoryStore", err);
      }
    }
    if (this._stateEngine) {
      try {
        this.bindStateEngine(this._stateEngine);
      } catch (err) {
        logSilentError("fromJSON.bindStateEngine", err);
      }
    }

    return this;
  }

  /**
   * @param {any[]} arr
   * @param {any} max
   */
  _pruneArray(arr, max) {
    const cap = Number.isFinite(max) ? Math.max(0, Math.floor(max)) : 0;
    while (arr.length > cap) arr.shift();
  }

  /**
   * @param {Map<string, string>} map
   * @param {any} max
   */
  _pruneMap(map, max) {
    const cap = Number.isFinite(max) ? Math.max(0, Math.floor(max)) : 0;
    while (map.size > cap) {
      const firstKey = map.keys().next().value;
      map.delete(firstKey);
    }
  }
}

