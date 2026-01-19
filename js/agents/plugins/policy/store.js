import { safeJsonParse } from "../../shared/utils/safe-json.js";

/**
 * @typedef {object} PolicyRule
 * @property {string} [ruleId]
 * @property {string} [id]
 * @property {string} effect
 * @property {string | string[]} [type]
 * @property {string | string[]} [types]
 * @property {string} [tool]
 * @property {string} [resource]
 * @property {string} [path]
 * @property {boolean} [enabled]
 * @property {number} [priority]
 * @property {string} [createdAt]
 * @property {string} [updatedAt]
 */

/**
 * @returns {boolean}
 */
function hasLocalStorage() {
  try {
    return typeof localStorage !== "undefined" && !!localStorage && typeof localStorage.getItem === "function";
  } catch {
    return false;
  }
}

/** @type {{ rules: PolicyRule[] }} */
const MEMORY = { rules: [] };

export class PolicyRuleStore {
  /**
   * @param {{ storageKey?: string }} [options]
   */
  constructor({ storageKey = "paperburner_policy_rules_v1" } = {}) {
    this.storageKey = storageKey;
    /** @type {PolicyRule[] | null} */
    this._cache = null;
  }

  /**
   * @returns {PolicyRule[]}
   */
  load() {
    if (this._cache) return [...this._cache];

    if (!hasLocalStorage()) {
      this._cache = [...(MEMORY.rules || [])];
      return [...this._cache];
    }

    const raw = localStorage.getItem(this.storageKey);
    if (!raw) {
      this._cache = [];
      return [];
    }

    try {
      const parsed = safeJsonParse(raw, { maxChars: 500_000 });
      const rules = Array.isArray(parsed?.rules) ? parsed.rules : Array.isArray(parsed) ? parsed : [];
      this._cache = rules.filter((r) => r && typeof r === "object");
      return [...this._cache];
    } catch {
      this._cache = [];
      return [];
    }
  }

  /**
   * @param {PolicyRule[] | null | undefined} rules
   * @returns {boolean}
   */
  save(rules) {
    const next = Array.isArray(rules) ? rules.filter((r) => r && typeof r === "object") : [];
    this._cache = [...next];

    if (!hasLocalStorage()) {
      MEMORY.rules = [...next];
      return true;
    }

    localStorage.setItem(this.storageKey, JSON.stringify({ schemaVersion: "0.1", rules: next }));
    return true;
  }

  /**
   * @returns {boolean}
   */
  clear() {
    this._cache = [];
    if (!hasLocalStorage()) {
      MEMORY.rules = [];
      return true;
    }
    localStorage.removeItem(this.storageKey);
    return true;
  }
}

export default PolicyRuleStore;
