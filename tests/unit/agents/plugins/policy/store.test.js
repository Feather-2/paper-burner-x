// Unit tests for PolicyRuleStore load/save/clear behavior.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../../../js/agents/shared/index.js", () => ({
  safeJsonParse: vi.fn(),
}));

import PolicyRuleStore, { PolicyRuleStore as PolicyRuleStoreNamed } from "../../../../../js/agents/plugins/policy/store.js";
import { safeJsonParse } from "../../../../../js/agents/shared/index.js";

const makeLocalStorage = (seed = {}) => {
  const storage = new Map(Object.entries(seed).map(([key, value]) => [key, String(value)]));
  return {
    getItem: vi.fn((key) => (storage.has(key) ? storage.get(key) : null)),
    setItem: vi.fn((key, value) => {
      storage.set(key, String(value));
    }),
    removeItem: vi.fn((key) => {
      storage.delete(key);
    }),
    clear: vi.fn(() => {
      storage.clear();
    }),
    key: vi.fn((index) => [...storage.keys()][index] ?? null),
    get length() {
      return storage.size;
    },
  };
};

const ORIGINAL_LOCAL_STORAGE = globalThis.localStorage;

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.localStorage = makeLocalStorage();
  safeJsonParse.mockImplementation((raw) => JSON.parse(raw));
});

afterEach(() => {
  globalThis.localStorage = ORIGINAL_LOCAL_STORAGE;
});

describe("PolicyRuleStore", () => {
  it("loads from localStorage and caches results for rapid calls", async () => {
    const key = "policy_rules_cache";
    const rules = [{ effect: "allow", priority: 0 }];
    const raw = JSON.stringify({ rules });

    globalThis.localStorage.setItem(key, raw);
    const store = new PolicyRuleStoreNamed({ storageKey: key });

    const [first, second] = await Promise.all([
      Promise.resolve().then(() => store.load()),
      Promise.resolve().then(() => store.load()),
    ]);

    expect(first).toEqual(rules);
    expect(second).toEqual(rules);
    expect(first).not.toBe(second);
    expect(safeJsonParse).toHaveBeenCalledTimes(1);
    expect(safeJsonParse).toHaveBeenCalledWith(raw, { maxChars: 500000 });
  });

  it("returns empty when storage is missing or empty string", () => {
    const storeMissing = new PolicyRuleStoreNamed({ storageKey: "missing_key" });
    expect(storeMissing.load()).toEqual([]);

    const storeEmpty = new PolicyRuleStoreNamed({ storageKey: "empty_key" });
    globalThis.localStorage.setItem("empty_key", "");
    expect(storeEmpty.load()).toEqual([]);

    expect(safeJsonParse).not.toHaveBeenCalled();
  });

  it("handles safeJsonParse errors by returning empty list", () => {
    const key = "bad_json";
    globalThis.localStorage.setItem(key, "{bad");

    safeJsonParse.mockImplementationOnce(() => {
      throw new Error("bad json");
    });

    const store = new PolicyRuleStoreNamed({ storageKey: key });
    expect(store.load()).toEqual([]);
    expect(safeJsonParse).toHaveBeenCalledTimes(1);
  });

  it("filters invalid items and accepts array payloads", () => {
    const key = "array_payload";
    const payload = [null, undefined, 0, "bad", {}, { effect: " " }];

    safeJsonParse.mockReturnValueOnce(payload);
    globalThis.localStorage.setItem(key, "[]");

    const store = new PolicyRuleStoreNamed({ storageKey: key });
    expect(store.load()).toEqual([{}, { effect: " " }]);
  });

  it("handles large payloads and deep nested rules", () => {
    const key = "large_payload";
    const huge = "x".repeat(600000);
    const deepRule = { effect: "allow", meta: { level1: { level2: { level3: { value: 1 } } } } };
    const raw = JSON.stringify({ rules: [{ effect: "deny", path: huge }, deepRule] });

    globalThis.localStorage.setItem(key, raw);
    const store = new PolicyRuleStoreNamed({ storageKey: key });

    const loaded = store.load();
    expect(loaded).toHaveLength(2);
    expect(loaded[0].path.length).toBe(huge.length);
    expect(loaded[1].meta.level1.level2.level3.value).toBe(1);
    expect(safeJsonParse).toHaveBeenCalledWith(raw, { maxChars: 500000 });
  });

  it("saves sanitized rules and preserves boundary values", () => {
    const key = "save_boundaries";
    const store = new PolicyRuleStoreNamed({ storageKey: key });
    const rules = [
      { effect: "allow", priority: 0, path: " " },
      { effect: "deny", priority: -1, type: "tool", enabled: false },
      { effect: "allow", priority: Number.MAX_SAFE_INTEGER, tool: "t", resource: "r", id: "1" },
      { effect: "allow", priority: "0" },
      {},
    ];

    expect(store.save([...rules, null, undefined, 0, "bad"])).toBe(true);

    const stored = JSON.parse(globalThis.localStorage.getItem(key));
    expect(stored.schemaVersion).toBe("0.1");
    expect(stored.rules).toEqual(rules);
    expect(store.load()).toEqual(rules);
  });

  it("treats non-array inputs as empty and supports empty array", () => {
    const key = "non_array";
    const store = new PolicyRuleStoreNamed({ storageKey: key });

    expect(store.save(null)).toBe(true);
    expect(JSON.parse(globalThis.localStorage.getItem(key)).rules).toEqual([]);

    expect(store.save(undefined)).toBe(true);
    expect(store.save("not array")).toBe(true);
    expect(store.save({})).toBe(true);
    expect(store.save([])).toBe(true);

    const stored = JSON.parse(globalThis.localStorage.getItem(key));
    expect(stored.rules).toEqual([]);
    expect(store.load()).toEqual([]);
  });

  it("keeps last write on quick consecutive saves", () => {
    const key = "race_key";
    const store = new PolicyRuleStoreNamed({ storageKey: key });
    const first = [{ effect: "allow", id: "1" }];
    const second = [{ effect: "deny", id: "2" }];

    const results = [store.save(first), store.save(second)];
    expect(results).toEqual([true, true]);
    expect(store.load()).toEqual(second);
  });

  it("clear removes storage and resets cache", () => {
    const key = "clear_key";
    const store = new PolicyRuleStoreNamed({ storageKey: key });

    store.save([{ effect: "allow" }]);
    expect(store.load()).toHaveLength(1);

    expect(store.clear()).toBe(true);
    expect(globalThis.localStorage.removeItem).toHaveBeenCalledWith(key);
    expect(store.load()).toEqual([]);
  });

  it("falls back to in-memory storage when localStorage is unavailable", () => {
    globalThis.localStorage = undefined;

    const key = "memory_key";
    const rules = [{ effect: "allow", priority: 1 }];

    const store = new PolicyRuleStoreNamed({ storageKey: key });
    expect(store.save(rules)).toBe(true);

    const second = new PolicyRuleStoreNamed({ storageKey: key });
    expect(second.load()).toEqual(rules);

    expect(second.clear()).toBe(true);
    const third = new PolicyRuleStoreNamed({ storageKey: key });
    expect(third.load()).toEqual([]);
  });
});

describe("default", () => {
  it("exports PolicyRuleStore", () => {
    expect(PolicyRuleStore).toBe(PolicyRuleStoreNamed);
  });

  it("can be instantiated and used", () => {
    const key = "default_key";
    const store = new PolicyRuleStore({ storageKey: key });

    store.save([{ effect: "allow" }]);
    expect(store.load()).toEqual([{ effect: "allow" }]);
  });
});
