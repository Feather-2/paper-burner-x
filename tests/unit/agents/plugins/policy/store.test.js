import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../../../js/agents/shared/index.js", () => ({
  safeJsonParse: vi.fn(),
}));

import PolicyRuleStoreDefault, {
  PolicyRuleStore,
} from "../../../../../js/agents/plugins/policy/store.js";
import { safeJsonParse } from "../../../../../js/agents/shared/index.js";

const makeLocalStorage = (seed = {}) => {
  const storage = new Map(
    Object.entries(seed).map(([key, value]) => [key, String(value)]),
  );

  return {
    getItem: vi.fn((key) => (storage.has(key) ? storage.get(key) : null)),
    setItem: vi.fn((key, value) => {
      storage.set(key, String(value));
    }),
    removeItem: vi.fn((key) => {
      storage.delete(key);
    }),
  };
};

const ORIGINAL_LOCAL_STORAGE = globalThis.localStorage;

const clearModuleMemoryRules = () => {
  const prev = globalThis.localStorage;
  globalThis.localStorage = undefined;
  try {
    new PolicyRuleStore({ storageKey: "__pb_test_memory_clear__" }).clear();
  } finally {
    globalThis.localStorage = prev;
  }
};

beforeEach(() => {
  vi.clearAllMocks();
  safeJsonParse.mockReset();
  safeJsonParse.mockImplementation((raw) => JSON.parse(raw));

  clearModuleMemoryRules();

  globalThis.localStorage = makeLocalStorage();
});

afterEach(() => {
  globalThis.localStorage = ORIGINAL_LOCAL_STORAGE;
});

describe("PolicyRuleStore", () => {
  describe("constructor", () => {
    it("defaults storageKey and accepts whitespace values", () => {
      const storeDefault = new PolicyRuleStore();
      expect(storeDefault.storageKey).toBe("paperburner_policy_rules_v1");

      const storeCustom = new PolicyRuleStore({ storageKey: "   key  " });
      expect(storeCustom.storageKey).toBe("   key  ");
    });
  });

  describe("load", () => {
    it("loads from localStorage and caches results for concurrent/rapid calls", async () => {
      const key = "policy_rules_cache";
      const rules = [{ effect: "allow", priority: 0 }];
      const raw = JSON.stringify({ rules });

      globalThis.localStorage.setItem(key, raw);
      const store = new PolicyRuleStore({ storageKey: key });

      const [first, second] = await Promise.all([
        Promise.resolve().then(() => store.load()),
        Promise.resolve().then(() => store.load()),
      ]);

      expect(first).toEqual(rules);
      expect(second).toEqual(rules);
      expect(first).not.toBe(second);
      expect(globalThis.localStorage.getItem).toHaveBeenCalledTimes(1);
      expect(safeJsonParse).toHaveBeenCalledTimes(1);
      expect(safeJsonParse).toHaveBeenCalledWith(raw, { maxChars: 500000 });
    });

    it("returns cached results even when underlying storage changes", () => {
      const key = "cache_ignores_later_storage";
      const rawA = JSON.stringify({ rules: [{ effect: "allow", id: "a" }] });
      const rawB = JSON.stringify({ rules: [{ effect: "deny", id: "b" }] });

      globalThis.localStorage.setItem(key, rawA);
      const store = new PolicyRuleStore({ storageKey: key });

      expect(store.load()).toEqual([{ effect: "allow", id: "a" }]);

      globalThis.localStorage.setItem(key, rawB);
      expect(store.load()).toEqual([{ effect: "allow", id: "a" }]);
      expect(safeJsonParse).toHaveBeenCalledTimes(1);
    });

    it("returns empty when storage is missing, empty, or whitespace-only", () => {
      const missingKey = "missing_key";
      const storeMissing = new PolicyRuleStore({ storageKey: missingKey });
      expect(storeMissing.load()).toEqual([]);

      const emptyKey = "empty_key";
      globalThis.localStorage.setItem(emptyKey, "");
      const storeEmpty = new PolicyRuleStore({ storageKey: emptyKey });
      expect(storeEmpty.load()).toEqual([]);

      const whitespaceKey = "whitespace_key";
      globalThis.localStorage.setItem(whitespaceKey, "   ");
      const storeWhitespace = new PolicyRuleStore({ storageKey: whitespaceKey });
      expect(storeWhitespace.load()).toEqual([]);

      expect(safeJsonParse).toHaveBeenCalledTimes(1);
    });

    it("accepts both { rules } wrapper and array payloads, filtering non-objects", () => {
      const keyWrapped = "wrapped_payload";
      globalThis.localStorage.setItem(keyWrapped, "{}");
      safeJsonParse.mockReturnValueOnce({
        rules: [null, undefined, 0, "bad", {}, { effect: " " }],
      });

      const storeWrapped = new PolicyRuleStore({ storageKey: keyWrapped });
      expect(storeWrapped.load()).toEqual([{}, { effect: " " }]);

      const keyArray = "array_payload";
      globalThis.localStorage.setItem(keyArray, "[]");
      safeJsonParse.mockReturnValueOnce([null, -1, Number.MAX_SAFE_INTEGER, {}, { effect: "allow" }]);

      const storeArray = new PolicyRuleStore({ storageKey: keyArray });
      expect(storeArray.load()).toEqual([{}, { effect: "allow" }]);
    });

    it("treats non-array rules field as empty and handles nullish parses", () => {
      const key = "non_array_rules_field";
      globalThis.localStorage.setItem(key, "{}");

      safeJsonParse.mockReturnValueOnce({ rules: {} });
      const storeObjectRules = new PolicyRuleStore({ storageKey: key });
      expect(storeObjectRules.load()).toEqual([]);

      const keyNullish = "nullish_parse";
      globalThis.localStorage.setItem(keyNullish, "0");

      safeJsonParse.mockReturnValueOnce(null);
      const storeNullish = new PolicyRuleStore({ storageKey: keyNullish });
      expect(storeNullish.load()).toEqual([]);
    });

    it("handles huge raw strings and deep nested rule objects", () => {
      const key = "huge_raw";
      const hugeRaw = "x".repeat(600000);
      globalThis.localStorage.setItem(key, hugeRaw);

      const deepRule = {
        effect: "allow",
        path: `p/${"y".repeat(50000)}`,
        meta: { level1: { level2: { level3: { value: 1 } } } },
      };

      safeJsonParse.mockReturnValueOnce({ rules: [deepRule] });
      const store = new PolicyRuleStore({ storageKey: key });

      const loaded = store.load();
      expect(loaded).toEqual([deepRule]);
      expect(loaded[0].path.length).toBe(50002);
      expect(loaded[0].meta.level1.level2.level3.value).toBe(1);
      expect(safeJsonParse).toHaveBeenCalledWith(hugeRaw, { maxChars: 500000 });
    });
  });

  describe("save", () => {
    it("saves sanitized rules and preserves boundary/type values", () => {
      const key = "save_boundaries";
      const store = new PolicyRuleStore({ storageKey: key });
      const rules = [
        { effect: "allow", priority: 0, path: " " },
        { effect: "deny", priority: -1, type: "tool", enabled: false },
        {
          effect: "allow",
          priority: Number.MAX_SAFE_INTEGER,
          tool: "t",
          resource: "r",
          id: "1",
        },
        { effect: "allow", priority: "0" },
        {},
      ];

      expect(store.save([...rules, null, undefined, 0, "bad"])).toBe(true);

      expect(globalThis.localStorage.setItem).toHaveBeenCalledTimes(1);
      const [storedKey, storedRaw] = globalThis.localStorage.setItem.mock.calls[0];
      expect(storedKey).toBe(key);

      const stored = JSON.parse(storedRaw);
      expect(stored.schemaVersion).toBe("0.1");
      expect(stored.rules).toEqual(rules);

      expect(store.load()).toEqual(rules);
      expect(safeJsonParse).not.toHaveBeenCalled();
    });

    it("treats nullish/non-array/array-like inputs as empty arrays", () => {
      const key = "non_array";
      const store = new PolicyRuleStore({ storageKey: key });

      expect(store.save(null)).toBe(true);
      expect(store.save(undefined)).toBe(true);
      expect(store.save("not array")).toBe(true);
      expect(store.save({})).toBe(true);
      expect(store.save({ 0: { effect: "allow" }, length: 1 })).toBe(true);
      expect(store.save([])).toBe(true);

      const stored = JSON.parse(globalThis.localStorage.getItem(key));
      expect(stored.rules).toEqual([]);
      expect(store.load()).toEqual([]);
    });

    it("keeps last write on rapid consecutive saves", () => {
      const key = "race_key";
      const store = new PolicyRuleStore({ storageKey: key });
      const first = [{ effect: "allow", id: "1" }];
      const second = [{ effect: "deny", id: "2" }];

      expect(store.save(first)).toBe(true);
      expect(store.save(second)).toBe(true);
      expect(store.load()).toEqual(second);
    });

    it("falls back to in-memory storage when localStorage is unavailable or invalid", () => {
      globalThis.localStorage = null;

      const key = "memory_key";
      const rules = [{ effect: "allow", priority: 1 }];

      const store = new PolicyRuleStore({ storageKey: key });
      expect(store.save(rules)).toBe(true);

      const second = new PolicyRuleStore({ storageKey: key });
      expect(second.load()).toEqual(rules);
      expect(second.clear()).toBe(true);

      const third = new PolicyRuleStore({ storageKey: key });
      expect(third.load()).toEqual([]);
    });

    it("falls back to in-memory storage when localStorage access throws", () => {
      globalThis.localStorage = new Proxy(
        {},
        {
          get(_target, prop) {
            if (prop === "getItem") throw new Error("boom");
            return undefined;
          },
        },
      );

      const key = "memory_proxy_key";
      const rules = [{ effect: "allow", id: "x" }];

      const store = new PolicyRuleStore({ storageKey: key });
      expect(store.save(rules)).toBe(true);

      const second = new PolicyRuleStore({ storageKey: key });
      expect(second.load()).toEqual(rules);
    });
  });

  describe("clear", () => {
    it("removes localStorage entry and resets cache", () => {
      const key = "clear_key";
      const store = new PolicyRuleStore({ storageKey: key });

      store.save([{ effect: "allow" }]);
      expect(store.load()).toHaveLength(1);

      expect(store.clear()).toBe(true);
      expect(globalThis.localStorage.removeItem).toHaveBeenCalledWith(key);
      expect(store.load()).toEqual([]);
    });
  });
});

describe("default", () => {
  it("aliases the named export", () => {
    expect(PolicyRuleStoreDefault).toBe(PolicyRuleStore);
  });

  it("can be instantiated and used", () => {
    const key = "default_key";
    const store = new PolicyRuleStoreDefault({ storageKey: key });

    store.save([{ effect: "allow" }]);
    expect(store.load()).toEqual([{ effect: "allow" }]);
  });
});
