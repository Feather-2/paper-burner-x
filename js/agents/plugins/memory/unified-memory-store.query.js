import { isPlainObject, toNonEmptyString } from "../../shared/index.js";
import { deepClone } from "../../shared/utils/value-utils.js";
import { normalizeTodoStatus } from "./todo-normalize.js";
import { estimateTokensValue, truncate } from "./unified-memory-store.utils.js";

export function applyQueryMethods(UnifiedMemoryStore) {
  Object.defineProperties(UnifiedMemoryStore.prototype, {
    L0: {
      get() {
        const s = this._getStateRef();
        const shallow = {
          systemPrompt: s.L0.systemPrompt,
          taskGoal: s.L0.taskGoal,
          todos: Object.freeze([...(Array.isArray(s.L0.todos) ? s.L0.todos : [])]),
        };
        return Object.freeze(shallow);
      },
    },
    L1: {
      get() {
        const s = this._getStateRef();
        const L1 = s.L1 || {};
        const shallow = {
          messages: Object.freeze([...(Array.isArray(L1.messages) ? L1.messages : [])]),
          signals: Object.freeze([...(Array.isArray(L1.signals) ? L1.signals : [])]),
          decisions: Object.freeze([...(Array.isArray(L1.decisions) ? L1.decisions : [])]),
          deck: Object.prototype.hasOwnProperty.call(L1, "deck") ? L1.deck : null,
          syncTable: Object.freeze({
            discoveries: L1.syncTable?.discoveries || {},
            subagents: L1.syncTable?.subagents || {},
          }),
          scratchpad: Object.freeze({ ...(isPlainObject(L1.scratchpad) ? L1.scratchpad : {}) }),
          flags: Object.freeze({ ...(isPlainObject(L1.flags) ? L1.flags : {}) }),
        };
        return Object.freeze(shallow);
      },
    },
    L2: {
      get() {
        const s = this._getStateRef();
        const L2 = s.L2 || {};
        const shallow = {
          historySummary: toNonEmptyString(L2.historySummary) || "",
          stageSummaries: L2.stageSummaries || {},
          decisions: Object.freeze([...(Array.isArray(L2.decisions) ? L2.decisions : [])]),
          claims: Object.freeze([...(Array.isArray(L2.claims) ? L2.claims : [])]),
        };
        return Object.freeze(shallow);
      },
    },
    L3: {
      get() {
        const s = this._getStateRef();
        const L3 = s.L3 || {};
        const shallow = {
          snapshots: L3.snapshots || {},
          index: Object.freeze({
            keywords: L3.index?.keywords || {},
            stages: L3.index?.stages || {},
            timeline: Object.freeze([...(Array.isArray(L3.index?.timeline) ? L3.index.timeline : [])]),
          }),
          checkpoints: Object.freeze([...(Array.isArray(L3.checkpoints) ? L3.checkpoints : [])]),
        };
        return Object.freeze(shallow);
      },
    },
  });

  UnifiedMemoryStore.prototype.cloneL0 = function cloneL0() {
    return deepClone(this._getStateRef().L0);
  };

  UnifiedMemoryStore.prototype.cloneL1 = function cloneL1() {
    return deepClone(this._getStateRef().L1);
  };

  UnifiedMemoryStore.prototype.cloneL2 = function cloneL2() {
    return deepClone(this._getStateRef().L2);
  };

  UnifiedMemoryStore.prototype.cloneL3 = function cloneL3() {
    return deepClone(this._getStateRef().L3);
  };

  UnifiedMemoryStore.prototype.getTaskGoal = function getTaskGoal() {
    return toNonEmptyString(this._getStateRef().L0?.taskGoal) || "";
  };

  /**
   * @param {undefined|string|((todo: any) => boolean)|{status?:string,filter?:((todo: any) => boolean)}} [filter]
   */
  UnifiedMemoryStore.prototype.getTodos = function getTodos(filter) {
    const todos = Array.isArray(this._getStateRef().L0?.todos) ? this._getStateRef().L0.todos : [];

    if (typeof filter === "function") {
      return todos.filter(filter);
    }
    if (typeof filter === "string") {
      const wanted = normalizeTodoStatus(filter);
      return todos.filter((t) => normalizeTodoStatus(t?.status) === wanted);
    }
    if (isPlainObject(filter)) {
      const wanted = typeof filter.status === "string" ? normalizeTodoStatus(filter.status) : null;
      const pred = typeof filter.filter === "function" ? filter.filter : null;
      return todos.filter((t) => {
        if (wanted && normalizeTodoStatus(t?.status) !== wanted) return false;
        if (pred && !pred(t)) return false;
        return true;
      });
    }
    return [...todos];
  };

  UnifiedMemoryStore.prototype.getMessages = function getMessages() {
    const messages = Array.isArray(this._getStateRef().L1?.messages) ? this._getStateRef().L1.messages : [];
    return [...messages];
  };

  UnifiedMemoryStore.prototype.getSignals = function getSignals(filter) {
    const signals = Array.isArray(this._getStateRef().L1?.signals) ? this._getStateRef().L1.signals : [];
    if (typeof filter === "function") return signals.filter(filter);
    if (filter === "pending") return signals.filter((s) => !s?.acknowledged);
    return [...signals];
  };

  UnifiedMemoryStore.prototype.getDecisions = function getDecisions(limit = 10) {
    const decisions = Array.isArray(this._getStateRef().L1?.decisions) ? this._getStateRef().L1.decisions : [];
    const n = typeof limit === "number" && Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 10;
    return decisions.slice(-n);
  };

  UnifiedMemoryStore.prototype.getScratchpad = function getScratchpad(key) {
    const scratchpad = isPlainObject(this._getStateRef().L1?.scratchpad) ? this._getStateRef().L1.scratchpad : {};
    if (key === undefined) return { ...scratchpad };
    return scratchpad[key];
  };

  UnifiedMemoryStore.prototype.getFlags = function getFlags() {
    const flags = isPlainObject(this._getStateRef().L1?.flags) ? this._getStateRef().L1.flags : {};
    return { ...flags };
  };

  UnifiedMemoryStore.prototype.getDiscovery = function getDiscovery(id) {
    const key = toNonEmptyString(id);
    if (!key) return null;
    const table = this._getStateRef().L1?.syncTable?.discoveries;
    return (table && typeof table === "object" ? table[key] : null) || null;
  };

  UnifiedMemoryStore.prototype.getAllDiscoveries = function getAllDiscoveries() {
    const table = this._getStateRef().L1?.syncTable?.discoveries;
    if (!table || typeof table !== "object") return [];
    return Object.values(table);
  };

  UnifiedMemoryStore.prototype.getSubagent = function getSubagent(id) {
    const key = toNonEmptyString(id);
    if (!key) return null;
    const table = this._getStateRef().L1?.syncTable?.subagents;
    return (table && typeof table === "object" ? table[key] : null) || null;
  };

  UnifiedMemoryStore.prototype.getAllSubagents = function getAllSubagents() {
    const table = this._getStateRef().L1?.syncTable?.subagents;
    if (!table || typeof table !== "object") return [];
    return Object.values(table);
  };

  UnifiedMemoryStore.prototype.getStageSummary = function getStageSummary(stage) {
    const s = toNonEmptyString(stage);
    if (!s) return "";
    const obj = this._getStateRef().L2?.stageSummaries;
    return (obj && typeof obj === "object" ? obj[s] : null) || "";
  };

  UnifiedMemoryStore.prototype.getAllStageSummaries = function getAllStageSummaries() {
    const obj = this._getStateRef().L2?.stageSummaries;
    return obj && typeof obj === "object" ? { ...obj } : {};
  };

  UnifiedMemoryStore.prototype.getClaims = function getClaims(filter) {
    const claims = Array.isArray(this._getStateRef().L2?.claims) ? this._getStateRef().L2.claims : [];
    if (typeof filter === "function") return claims.filter(filter);
    return [...claims];
  };

  UnifiedMemoryStore.prototype.listArchives = function listArchives(limit = 10) {
    const timeline = Array.isArray(this._getStateRef().L3?.index?.timeline) ? this._getStateRef().L3.index.timeline : [];
    const n = typeof limit === "number" && Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 10;
    return timeline.slice(-n).reverse();
  };

  UnifiedMemoryStore.prototype.buildPromptContext = function buildPromptContext() {
    const s = this._getStateRef();
    const sections = [];

    if (toNonEmptyString(s.L0?.taskGoal)) {
      sections.push(`## 目标\n${s.L0.taskGoal}`);
    }

    const todos = Array.isArray(s.L0?.todos) ? s.L0.todos : [];
    if (todos.length > 0) {
      const isClosed = (t) => {
        const st = normalizeTodoStatus(t?.status);
        return st === "completed" || st === "cancelled" || st === "done";
      };
      const todoLines = todos.map((t) => {
        const st = normalizeTodoStatus(t?.status);
        const status = st === "completed" || st === "done" ? "✓" : st === "in_progress" ? "→" : "○";
        const text = t?.text || t?.content || t?.title || "(无描述)";
        return `${status} ${text}`;
      });
      const openCount = todos.filter((t) => !isClosed(t)).length;
      sections.push(`## 待办 (${openCount}/${todos.length})\n${todoLines.join("\n")}`);
    }

    if (toNonEmptyString(s.L2?.historySummary)) {
      sections.push(`## 历史摘要\n${truncate(s.L2.historySummary, 500)}`);
    }

    const summaries = this.getAllStageSummaries();
    if (Object.keys(summaries).length > 0) {
      const lines = Object.entries(summaries).map(([k, v]) => `[${k}] ${truncate(v, 100)}`);
      sections.push(`## 阶段发现\n${lines.join("\n")}`);
    }

    const discoveries = this.getAllDiscoveries();
    const pendingDiscoveries = discoveries.filter((d) => d?.status !== "satisfied");
    if (pendingDiscoveries.length > 0) {
      const lines = pendingDiscoveries
        .slice(-5)
        .map((d) => `- ${d.id}: ${d.status}${Array.isArray(d.keywords) && d.keywords.length ? ` [${d.keywords.join(",")}]` : ""}`);
      sections.push(`## 待验证 (${pendingDiscoveries.length})\n${lines.join("\n")}`);
    }

    const subagents = this.getAllSubagents();
    const activeSubagents = subagents.filter((x) => x?.status !== "completed" && x?.status !== "failed");
    if (activeSubagents.length > 0) {
      const lines = activeSubagents.map((x) => `- ${x.id}: ${x.status} (${x.progress || 0}%)`);
      sections.push(`## SubAgents (${activeSubagents.length})\n${lines.join("\n")}`);
    }

    const pendingSignals = this.getSignals("pending");
    if (pendingSignals.length > 0) {
      const lines = pendingSignals
        .slice(-5)
        .map((sig) => `- [${sig.type}] ${sig.message || JSON.stringify(sig.payload)}`);
      sections.push(`## 待处理信号\n${lines.join("\n")}`);
    }

    const recentDecisions = this.getDecisions(3);
    if (recentDecisions.length > 0) {
      const lines = recentDecisions.map((d) => `- ${d.action}${d.reason ? `: ${d.reason}` : ""}`);
      sections.push(`## 最近决策\n${lines.join("\n")}`);
    }

    return sections.length > 0 ? sections.join("\n\n") : "";
  };

  UnifiedMemoryStore.prototype.getLatestCheckpoint = function getLatestCheckpoint() {
    const checkpoints = Array.isArray(this._getStateRef().L3?.checkpoints) ? this._getStateRef().L3.checkpoints : [];
    return checkpoints[checkpoints.length - 1] || null;
  };

  UnifiedMemoryStore.prototype.estimateTokens = function estimateTokens(content) {
    return estimateTokensValue(content, this._tokenCounter);
  };

  UnifiedMemoryStore.prototype.getStats = function getStats() {
    this._updateTokenUsage();
    const s = this._getStateRef();
    const discoveries = s.L1?.syncTable?.discoveries;
    const subagents = s.L1?.syncTable?.subagents;
    const snapshots = s.L3?.snapshots;
    const checkpoints = s.L3?.checkpoints;
    return {
      runId: this.runId,
      tokenUsage: this._stats.tokenUsage,
      messageCount: Array.isArray(s.L1?.messages) ? s.L1.messages.length : 0,
      todoCount: Array.isArray(s.L0?.todos) ? s.L0.todos.length : 0,
      signalCount: Array.isArray(s.L1?.signals) ? s.L1.signals.length : 0,
      decisionCount: Array.isArray(s.L1?.decisions) ? s.L1.decisions.length : 0,
      discoveryCount: discoveries && typeof discoveries === "object" ? Object.keys(discoveries).length : 0,
      subagentCount: subagents && typeof subagents === "object" ? Object.keys(subagents).length : 0,
      claimCount: Array.isArray(s.L2?.claims) ? s.L2.claims.length : 0,
      archiveCount: snapshots && typeof snapshots === "object" ? Object.keys(snapshots).length : 0,
      checkpointCount: Array.isArray(checkpoints) ? checkpoints.length : 0,
      compressionCount: this._stats.compressionCount,
      recallCount: this._stats.recallCount,
    };
  };
}
