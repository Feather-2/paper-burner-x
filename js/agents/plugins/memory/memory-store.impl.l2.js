import { deepClone, toNonEmptyString } from "../../shared/index.js";
import { defineGetter, defineMethod, genId } from "./memory-store.impl.utils.js";

export function defineL2Layer() {
  return {
    L2: defineGetter(function () {
      const shallow = {
        historySummary: this._L2.historySummary,
        stageSummaries: this._L2.stageSummaries, // Map 引用
        claims: Object.freeze([...this._L2.claims]),
      };
      return Object.freeze(shallow);
    }),

    cloneL2: defineMethod(function () {
      return deepClone(this._L2);
    }),

    setStageSummary: defineMethod(function (stage, summary) {
      const s = toNonEmptyString(stage);
      if (s) {
        this._L2.stageSummaries.set(s, toNonEmptyString(summary) || "");
        this._markDirty("L2");
      }
    }),

    getStageSummary: defineMethod(function (stage) {
      return this._L2.stageSummaries.get(stage) || "";
    }),

    getAllStageSummaries: defineMethod(function () {
      return Object.fromEntries(this._L2.stageSummaries);
    }),

    addClaim: defineMethod(function (claim) {
      const entry = {
        id: genId("claim"),
        content: claim.content || String(claim),
        source: claim.source || null,
        confidence: claim.confidence || 1.0,
        verified: claim.verified || false,
        ts: Date.now(),
      };
      this._L2.claims.push(entry);
      this._markDirty("L2");
      return entry;
    }),

    getClaims: defineMethod(function (filter) {
      if (typeof filter === "function") return this._L2.claims.filter(filter);
      return [...this._L2.claims];
    }),

    /**
     * Replace the entire claim list (avoids external mutation of L2).
     * @param {any[]} claims
     * @returns {any[]}
     */
    replaceClaims: defineMethod(function (claims) {
      this._L2.claims = Array.isArray(claims) ? deepClone(claims) : [];
      this._markDirty("L2");
      return [...this._L2.claims];
    }),
  };
}
