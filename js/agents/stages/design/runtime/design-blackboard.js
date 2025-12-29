/**
 * DesignBlackboard - 设计阶段的黑板机制
 *
 * 简化版三层架构（借鉴 DeepSearch SharedContext）:
 * - L1 摘要：designTokens、outlineDigest、styleDecisions
 * - 信号队列：阶段间通信
 * - 决策日志：用户确认和自动决策
 */

import { toNonEmptyString } from "../../../shared/utils/value-utils.js";

export class DesignBlackboard {
  constructor({ runId, limits = {} } = {}) {
    this.runId = toNonEmptyString(runId) || `design_${Date.now()}`;
    this.createdAt = new Date().toISOString();

    this.limits = {
      summariesMax: 20,
      signalsMax: 50,
      decisionsMax: 100,
      ...limits,
    };

    // L1: 阶段摘要 (stage → summary string)
    this._summaries = new Map();

    // 信号队列 (阶段间通信)
    this._signals = [];

    // 决策日志
    this._decisions = [];

    // 版本快照
    this._versions = [];
  }

  // ===== L1: Summaries =====

  setSummary(stage, summary) {
    const s = toNonEmptyString(stage);
    if (!s) return;
    this._summaries.set(s, String(summary || ""));
    this._pruneMap(this._summaries, this.limits.summariesMax);
  }

  getSummary(stage) {
    return this._summaries.get(String(stage || "")) || null;
  }

  getAllSummaries() {
    const out = {};
    for (const [k, v] of this._summaries) {
      out[k] = v;
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
    return signal;
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
    return decision;
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
    const summaryLines = [];
    for (const [stage, summary] of this._summaries) {
      if (summary) {
        summaryLines.push(`[${stage}] ${summary}`);
      }
    }
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

  static fromJSON(data) {
    const bb = new DesignBlackboard({ runId: data?.runId });
    if (data?.summaries) {
      for (const [k, v] of Object.entries(data.summaries)) {
        bb.setSummary(k, v);
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
