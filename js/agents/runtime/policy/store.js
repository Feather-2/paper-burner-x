function hasLocalStorage() {
  try {
    return typeof localStorage !== "undefined" && !!localStorage && typeof localStorage.getItem === "function";
  } catch {
    return false;
  }
}

const MEMORY = { rules: [] };

export class PolicyRuleStore {
  constructor({ storageKey = "paperburner_policy_rules_v1" } = {}) {
    this.storageKey = storageKey;
    this._cache = null;
  }

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
      const parsed = JSON.parse(raw);
      const rules = Array.isArray(parsed?.rules) ? parsed.rules : Array.isArray(parsed) ? parsed : [];
      this._cache = rules.filter((r) => r && typeof r === "object");
      return [...this._cache];
    } catch {
      this._cache = [];
      return [];
    }
  }

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

