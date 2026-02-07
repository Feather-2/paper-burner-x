import { isPlainObject, toNonEmptyString } from "../../shared/index.js";
import { deepClone } from "../../shared/utils/value-utils.js";
import { defineAccessor, defineGetter, defineMethod, estimateTokens, genId, isFiniteNumber } from "./memory-store.impl.utils.js";

const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function defineL1Layer() {
  return {
    L1: defineGetter(function () {
      const shallow = {
        messages: Object.freeze([...this._L1.messages]),
        signals: Object.freeze([...this._L1.signals]),
        decisions: Object.freeze([...this._L1.decisions]),
        syncTable: Object.freeze({
          discoveries: this._L1.syncTable.discoveries, // Map 引用，外部不应修改
          subagents: this._L1.syncTable.subagents,
        }),
        scratchpad: Object.freeze({ ...this._L1.scratchpad }),
        flags: Object.freeze({ ...this._L1.flags }),
      };
      return Object.freeze(shallow);
    }),

    cloneL1: defineMethod(function () {
      return deepClone(this._L1);
    }),

    addMessage: defineMethod(function (msg) {
      const message = isPlainObject(msg) ? msg : { role: "user", content: String(msg) };
      this._L1.messages.push(message);
      const addedTokens = estimateTokens(message?.content, this._tokenCounter);
      this._stats.l1Tokens += addedTokens;
      this._stats.tokenUsage += addedTokens;
      this._markDirty("L1");
      this._emit("memory:l1:add", { type: "message", role: message.role, tokenEstimate: addedTokens });
      this._checkCompress();
      return message;
    }),

    /**
     * Batch add messages efficiently (avoids external mutation of L1).
     * @param {any[]} messages
     * @returns {any[]}
     */
    addMessages: defineMethod(function (messages) {
      const list = Array.isArray(messages) ? messages : [];
      if (list.length === 0) return [];

      const added = [];
      let addedTokens = 0;
      for (const msg of list) {
        const message = isPlainObject(msg) ? msg : { role: "user", content: String(msg) };
        this._L1.messages.push(message);
        addedTokens += estimateTokens(message?.content, this._tokenCounter);
        added.push(message);
      }
      this._stats.l1Tokens += addedTokens;
      this._stats.tokenUsage += addedTokens;
      this._markDirty("L1");
      this._checkCompress();
      return added;
    }),

    getMessages: defineMethod(function () {
      return [...this._L1.messages];
    }),

    addSignal: defineMethod(function (signal) {
      const entry = {
        id: genId("sig"),
        type: signal.type || "info",
        message: signal.message || "",
        payload: signal.payload || {},
        acknowledged: false,
        ts: Date.now(),
      };
      this._L1.signals.push(entry);
      this._pruneArray(this._L1.signals, this.config.maxSignals);
      this._markDirty("L1");
      this._emit("memory:l1:add", { type: "signal", signalType: entry.type, id: entry.id });
      return entry;
    }),

    acknowledgeSignal: defineMethod(function (id) {
      const sig = this._L1.signals.find((s) => s.id === id);
      if (sig) {
        sig.acknowledged = true;
        this._markDirty("L1");
      }
      return sig;
    }),

    getSignals: defineMethod(function (filter) {
      const signals = this._L1.signals;
      if (typeof filter === "function") return signals.filter(filter);
      if (filter === "pending") return signals.filter((s) => !s.acknowledged);
      return [...signals];
    }),

    recordDecision: defineMethod(function (decision) {
      const entry = {
        id: genId("dec"),
        action: decision.action || decision.type || "unknown",
        reason: decision.reason || "",
        result: decision.result || null,
        ts: Date.now(),
      };
      this._L1.decisions.push(entry);
      this._pruneArray(this._L1.decisions, this.config.maxDecisions);
      this._markDirty("L1");
      this._emit("memory:l1:add", { type: "decision", action: entry.action, id: entry.id });
      return entry;
    }),

    getDecisions: defineMethod(function (limit = 10) {
      return this._L1.decisions.slice(-limit);
    }),

    getScratchpad: defineMethod(function (key) {
      if (key === undefined) return { ...this._L1.scratchpad };
      return this._L1.scratchpad[key];
    }),

    setScratchpad: defineMethod(function (key, value) {
      if (isPlainObject(key) && value === undefined) {
        const entries = Object.entries(key).filter(([entryKey]) => !UNSAFE_KEYS.has(entryKey));
        if (entries.length === 0) return;
        Object.assign(this._L1.scratchpad, Object.fromEntries(entries));
      } else {
        const safeKey = toNonEmptyString(key);
        if (!safeKey || UNSAFE_KEYS.has(safeKey)) return;
        this._L1.scratchpad[safeKey] = value;
      }
      this._markDirty("L1");
      this._emitUpdate("scratchpad", { key, value });
    }),

    clearScratchpad: defineMethod(function () {
      this._L1.scratchpad = {};
      this._markDirty("L1");
      this._emitUpdate("scratchpad", { cleared: true });
    }),

    getFlags: defineMethod(function () {
      return { ...this._L1.flags };
    }),

    setFlag: defineMethod(function (name, value) {
      if (name in this._L1.flags) {
        this._L1.flags[name] = Boolean(value);
        this._markDirty("L1");
        this._emitUpdate("flags", { [name]: value });
      }
    }),

    awaitUserFeedback: defineAccessor(
      function () {
        return this._L1.flags.awaitUserFeedback;
      },
      function (value) {
        this.setFlag("awaitUserFeedback", value);
      }
    ),

    taskImpossible: defineAccessor(
      function () {
        return this._L1.flags.taskImpossible;
      },
      function (value) {
        this.setFlag("taskImpossible", value);
      }
    ),

    syncDiscovery: defineMethod(function (id, data) {
      const existing = this._L1.syncTable.discoveries.get(id);
      const payload = isPlainObject(data) ? data : {};
      const prev = isPlainObject(existing) ? existing : null;
      const entry = {
        ...(prev || {}),
        ...payload,
        id,
        ts: Date.now(),
      };

      if (!toNonEmptyString(entry.status)) {
        entry.status = toNonEmptyString(prev?.status) || "open";
      }
      if (!Array.isArray(entry.keywords)) {
        entry.keywords = Array.isArray(prev?.keywords) ? prev.keywords : [];
      }
      if (!("by" in entry)) {
        entry.by = prev?.by ?? null;
      }
      this._L1.syncTable.discoveries.set(id, entry);
      this._markDirty("L1");
      return entry;
    }),

    getDiscovery: defineMethod(function (id) {
      return this._L1.syncTable.discoveries.get(id) || null;
    }),

    getAllDiscoveries: defineMethod(function () {
      return Array.from(this._L1.syncTable.discoveries.values());
    }),

    syncSubagent: defineMethod(function (id, data) {
      const existing = this._L1.syncTable.subagents.get(id);
      const payload = isPlainObject(data) ? data : {};
      const prev = isPlainObject(existing) ? existing : null;
      const entry = {
        ...(prev || {}),
        ...payload,
        id,
        ts: Date.now(),
      };

      if (!toNonEmptyString(entry.status)) {
        entry.status = toNonEmptyString(prev?.status) || "pending";
      }
      if (!isFiniteNumber(entry.progress)) {
        entry.progress = isFiniteNumber(prev?.progress) ? prev.progress : 0;
      }
      if (!("result" in entry)) {
        entry.result = prev?.result ?? null;
      }
      this._L1.syncTable.subagents.set(id, entry);
      this._markDirty("L1");
      return entry;
    }),

    getSubagent: defineMethod(function (id) {
      return this._L1.syncTable.subagents.get(id) || null;
    }),

    getAllSubagents: defineMethod(function () {
      return Array.from(this._L1.syncTable.subagents.values());
    }),
  };
}
