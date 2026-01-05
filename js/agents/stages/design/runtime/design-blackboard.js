/**
 * DesignBlackboard - 设计阶段的黑板机制
 *
 * 重构：支持可选 MemoryStore 集成
 * - 有 MemoryStore 时：数据同步到 L1/L2
 * - 无 MemoryStore 时：使用本地存储（向后兼容）
 *
 * 映射关系：
 * - summaries → MemoryStore.L1.stageSummaries
 * - signals → MemoryStore.L1.signals
 * - decisions → MemoryStore.recordDecision()
 */

import { toNonEmptyString, isPlainObject } from "../../../shared/utils/value-utils.js";

export class DesignBlackboard {
  constructor({ runId, limits = {}, memoryStore = null } = {}) {
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

    // 本地存储（当无 MemoryStore 时使用）
    this._summaries = new Map();
    this._signals = [];
    this._decisions = [];
    this._versions = [];
  }

  /**
   * 绑定 MemoryStore
   */
  bindMemoryStore(memoryStore) {
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

  // ===== L1: Summaries =====

  setSummary(stage, summary) {
    const s = toNonEmptyString(stage);
    if (!s) return;
    const text = String(summary || "");

    this._summaries.set(s, text);
    this._pruneMap(this._summaries, this.limits.summariesMax);

    this._syncSummaryToMemory(s, text);
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

    // 优先从 MemoryStore 读取
    if (this._memoryStore) {
      try {
        const memSummary = this._memoryStore.L2?.stageSummaries?.[`design.${key}`];
        if (memSummary) return memSummary;
      } catch { /* fallback */ }
    }

    return this._summaries.get(key) || null;
  }

  getAllSummaries() {
    const out = {};

    // 合并 MemoryStore 和本地
    if (this._memoryStore?.L2?.stageSummaries) {
      for (const [k, v] of Object.entries(this._memoryStore.L2.stageSummaries)) {
        if (k.startsWith("design.")) {
          out[k.slice(7)] = v;
        }
      }
    }

    for (const [k, v] of this._summaries) {
      if (!out[k]) out[k] = v;
    }

    return out;
  }

  // ===== Signals =====

  pushSignal(type, payload = {}) {
    const signal = {
      type: toNonEmptyString(type) || "unknown",
      payload,
      timestamp: Date.now(),
    };
    this._signals.push(signal);
    this._pruneArray(this._signals, this.limits.signalsMax);

    this._syncSignalToMemory(signal);
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
    return this._signals.shift() || null;
  }

  peekSignals(count = 5) {
    return this._signals.slice(0, count);
  }

  hasSignal(type) {
    return this._signals.some((s) => s.type === type);
  }

  clearSignals(type) {
    if (type) {
      this._signals = this._signals.filter((s) => s.type !== type);
    } else {
      this._signals = [];
    }
  }

  // ===== Decisions =====

  logDecision(action, reason, meta = {}) {
    const decision = {
      action: toNonEmptyString(action) || "unknown",
      reason: toNonEmptyString(reason) || "",
      ...meta,
      timestamp: Date.now(),
    };
    this._decisions.push(decision);
    this._pruneArray(this._decisions, this.limits.decisionsMax);

    this._syncDecisionToMemory(decision);
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
