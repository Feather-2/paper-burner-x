import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const warnMock = vi.hoisted(() => vi.fn());

vi.mock("../../../../../js/agents/shared/index.js", () => ({
  safeJsonParse: vi.fn(),
  createLogger: vi.fn(() => ({ warn: warnMock })),
}));

const STORE_MODULE_PATH = "../../../../../js/agents/plugins/policy/store.js";
const SHARED_MODULE_PATH = "../../../../../js/agents/shared/index.js";

const originalLocalStorageDescriptor = (() => {
  try {
    return Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  } catch {
    return undefined;
  }
})();

const hadOwnLocalStorage = (() => {
  try {
    return Object.prototype.hasOwnProperty.call(globalThis, "localStorage");
  } catch {
    return false;
  }
})();

function restoreLocalStorage() {
  if (typeof vi.unstubAllGlobals === "function") {
    try {
      vi.unstubAllGlobals();
    } catch {
      // ignore
    }
  }

  try {
    if (hadOwnLocalStorage) {
      if (originalLocalStorageDescriptor) {
        Object.defineProperty(globalThis, "localStorage", originalLocalStorageDescriptor);
      }
      return;
    }
    delete globalThis.localStorage;
  } catch {
    // ignore
  }
}

function installLocalStorage(value) {
  if (typeof vi.stubGlobal === "function") {
    try {
      vi.stubGlobal("localStorage", value);
      return;
    } catch {
      // fall through
    }
  }

  try {
    Object.defineProperty(globalThis, "localStorage", {
      value,
      configurable: true,
      writable: true,
    });
  } catch {
    try {
      globalThis.localStorage = value;
    } catch {
      // ignore
    }
  }
}

function createLocalStorageStub(initialByKey = {}) {
  const backing = new Map(Object.entries(initialByKey).map(([k, v]) => [String(k), String(v)]));
  return {
    getItem: vi.fn((key) => (backing.has(String(key)) ? backing.get(String(key)) : null)),
    setItem: vi.fn((key, value) => {
      backing.set(String(key), String(value));
    }),
    removeItem: vi.fn((key) => {
      backing.delete(String(key));
    }),
    _backing: backing,
  };
}

async function importFreshStoreModule() {
  vi.resetModules();

  const shared = await import(SHARED_MODULE_PATH);
  const safeJsonParse = shared.safeJsonParse;
  safeJsonParse.mockReset();
  safeJsonParse.mockImplementation((raw) => JSON.parse(raw));

  const mod = await import(STORE_MODULE_PATH);
  return { ...mod, safeJsonParse };
}

beforeEach(() => {
  restoreLocalStorage();
  vi.clearAllMocks();
  warnMock.mockReset();
});

afterEach(() => {
  restoreLocalStorage();
});

describe("PolicyRuleStore", () => {
  it("loads from localStorage using default key and caches clones", async () => {
    const storageKey = "paperburner_policy_rules_v1";
    const raw = JSON.stringify([{ effect: "allow" }]);
    const storage = createLocalStorageStub({ [storageKey]: raw });
    installLocalStorage(storage);

    const { PolicyRuleStore, safeJsonParse } = await importFreshStoreModule();
    const store = new PolicyRuleStore();

    const first = store.load();
    const second = store.load();

    expect(storage.getItem).toHaveBeenCalledTimes(1);
    expect(storage.getItem).toHaveBeenCalledWith(storageKey);

    expect(safeJsonParse).toHaveBeenCalledTimes(1);
    expect(safeJsonParse).toHaveBeenCalledWith(raw, { maxChars: 500_000 });

    expect(first).toEqual([{ effect: "allow" }]);
    expect(second).toEqual([{ effect: "allow" }]);
    expect(first).not.toBe(second);

    first.push({ effect: "deny" });
    expect(store.load()).toEqual([{ effect: "allow" }]);
  });

  it("returns [] for empty raw values and caches empty result", async () => {
    const storageKey = "   ";
    const storage = createLocalStorageStub({ [storageKey]: "" });
    installLocalStorage(storage);

    const { PolicyRuleStore, safeJsonParse } = await importFreshStoreModule();
    const store = new PolicyRuleStore({ storageKey });

    expect(store.load()).toEqual([]);
    expect(safeJsonParse).not.toHaveBeenCalled();

    storage._backing.set(storageKey, JSON.stringify([{ effect: "allow" }]));
    expect(store.load()).toEqual([]);
    expect(storage.getItem).toHaveBeenCalledTimes(1);
  });

  it("loads schema {rules} format, filters non-objects, and preserves deep/boundary values", async () => {
    const storageKey = "paperburner_policy_rules_v1";

    const deepRule = {
      effect: "deny",
      resource: { a: { b: { c: [1, { d: "e" }] } } },
      priority: Number.MAX_SAFE_INTEGER,
      path: "p".repeat(10_000),
    };

    const rawObj = {
      schemaVersion: "0.1",
      rules: [
        { effect: "allow", priority: 0, tool: "", type: "   " },
        null,
        0,
        -1,
        "not a rule",
        [],
        {},
        deepRule,
        { effect: "allow", priority: -1, id: "0" },
      ],
    };

    const raw = JSON.stringify(rawObj);
    const storage = createLocalStorageStub({ [storageKey]: raw });
    installLocalStorage(storage);

    const { PolicyRuleStore, safeJsonParse } = await importFreshStoreModule();
    const store = new PolicyRuleStore();

    const rules = store.load();

    expect(safeJsonParse).toHaveBeenCalledWith(raw, { maxChars: 500_000 });
    expect(rules).toEqual([
      { effect: "allow", priority: 0, tool: "", type: "   " },
      [],
      {},
      deepRule,
      { effect: "allow", priority: -1, id: "0" },
    ]);
  });

  it("loads raw array format when parsed is an array", async () => {
    const storageKey = "paperburner_policy_rules_v1";
    const rawArray = [{ effect: "allow" }, null, "x", [], { effect: "", priority: "0" }];
    const storage = createLocalStorageStub({ [storageKey]: JSON.stringify(rawArray) });
    installLocalStorage(storage);

    const { PolicyRuleStore } = await importFreshStoreModule();
    const store = new PolicyRuleStore();

    expect(store.load()).toEqual([{ effect: "allow" }, [], { effect: "", priority: "0" }]);
  });

  it("returns [] when parsed content isn't a rules array (type boundaries)", async () => {
    const storage = createLocalStorageStub({
      "k_num": "0",
      "k_obj": JSON.stringify({ rules: {}, schemaVersion: "0.1" }),
      "k_nullish": JSON.stringify({ rules: null }),
    });
    installLocalStorage(storage);

    const { PolicyRuleStore, safeJsonParse } = await importFreshStoreModule();

    const storeNum = new PolicyRuleStore({ storageKey: "k_num" });
    const storeObj = new PolicyRuleStore({ storageKey: "k_obj" });
    const storeNullish = new PolicyRuleStore({ storageKey: "k_nullish" });

    expect(storeNum.load()).toEqual([]);
    expect(storeObj.load()).toEqual([]);
    expect(storeNullish.load()).toEqual([]);

    expect(safeJsonParse).toHaveBeenCalledTimes(3);
  });

  it("returns [] when safeJsonParse throws (e.g., oversized input) and caches error result", async () => {
    const storageKey = "paperburner_policy_rules_v1";
    const hugeRaw = "x".repeat(500_001);
    const storage = createLocalStorageStub({ [storageKey]: hugeRaw });
    installLocalStorage(storage);

    const { PolicyRuleStore, safeJsonParse } = await importFreshStoreModule();
    safeJsonParse.mockImplementation(() => {
      throw new Error("too large");
    });

    const store = new PolicyRuleStore();

    expect(store.load()).toEqual([]);
    expect(store.load()).toEqual([]);

    expect(storage.getItem).toHaveBeenCalledTimes(1);
    expect(safeJsonParse).toHaveBeenCalledTimes(1);
    expect(safeJsonParse).toHaveBeenCalledWith(hugeRaw, { maxChars: 500_000 });
  });

  it("save() filters inputs, updates cache, and persists schema to localStorage", async () => {
    const storageKey = "custom_key_v1";
    const storage = createLocalStorageStub();
    installLocalStorage(storage);

    const { PolicyRuleStore } = await importFreshStoreModule();
    const store = new PolicyRuleStore({ storageKey });

    const ok = store.save([null, undefined, 0, "", { effect: " " }, {}, [], { effect: "allow", priority: -1 }]);
    expect(ok).toBe(true);

    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(storage.setItem).toHaveBeenCalledWith(storageKey, expect.any(String));

    const stored = storage.setItem.mock.calls[0][1];
    expect(JSON.parse(stored)).toEqual({
      schemaVersion: "0.1",
      rules: [{ effect: " " }, {}, [], { effect: "allow", priority: -1 }],
    });

    expect(store.load()).toEqual([{ effect: " " }, {}, [], { effect: "allow", priority: -1 }]);
  });

  it("save() catches localStorage setItem failures and falls back without throwing", async () => {
    const storageKey = "paperburner_policy_rules_v1";
    const storage = createLocalStorageStub();
    storage.setItem.mockImplementation(() => {
      throw new Error("quota-exceeded");
    });
    installLocalStorage(storage);

    const { PolicyRuleStore } = await importFreshStoreModule();
    const store = new PolicyRuleStore({ storageKey });

    expect(store.save([{ effect: "allow" }])).toBe(false);
    expect(warnMock).toHaveBeenCalledWith(expect.stringContaining("setItem failed"));
    expect(store.load()).toEqual([{ effect: "allow" }]);
  });

  it("save() treats non-array inputs as [] (null/undefined/object/string)", async () => {
    const storageKey = "paperburner_policy_rules_v1";
    const storage = createLocalStorageStub();
    installLocalStorage(storage);

    const { PolicyRuleStore } = await importFreshStoreModule();
    const store = new PolicyRuleStore({ storageKey });

    expect(store.save(null)).toBe(true);
    let last = storage.setItem.mock.calls[storage.setItem.mock.calls.length - 1][1];
    expect(JSON.parse(last).rules).toEqual([]);

    expect(store.save(undefined)).toBe(true);
    last = storage.setItem.mock.calls[storage.setItem.mock.calls.length - 1][1];
    expect(JSON.parse(last).rules).toEqual([]);

    expect(store.save({})).toBe(true);
    last = storage.setItem.mock.calls[storage.setItem.mock.calls.length - 1][1];
    expect(JSON.parse(last).rules).toEqual([]);

    expect(store.save("not-an-array")).toBe(true);
    last = storage.setItem.mock.calls[storage.setItem.mock.calls.length - 1][1];
    expect(JSON.parse(last).rules).toEqual([]);

    expect(store.load()).toEqual([]);
  });

  it("clear() removes storage key and resets cache (localStorage path)", async () => {
    const storageKey = "paperburner_policy_rules_v1";
    const storage = createLocalStorageStub();
    installLocalStorage(storage);

    const { PolicyRuleStore } = await importFreshStoreModule();
    const store = new PolicyRuleStore();

    store.save([{ effect: "allow" }]);
    expect(store.clear()).toBe(true);

    expect(storage.removeItem).toHaveBeenCalledTimes(1);
    expect(storage.removeItem).toHaveBeenCalledWith(storageKey);

    const store2 = new PolicyRuleStore();
    expect(store2.load()).toEqual([]);
  });

  it("clear() catches localStorage removeItem failures", async () => {
    const storage = createLocalStorageStub();
    storage.removeItem.mockImplementation(() => {
      throw new Error("remove-failed");
    });
    installLocalStorage(storage);

    const { PolicyRuleStore } = await importFreshStoreModule();
    const store = new PolicyRuleStore();

    store.save([{ effect: "allow" }]);
    expect(store.clear()).toBe(false);
    expect(warnMock).toHaveBeenCalledWith(expect.stringContaining("removeItem failed"));
    expect(store.load()).toEqual([]);
  });

  it("falls back to in-memory store when localStorage is unavailable", async () => {
    installLocalStorage({}); // no getItem -> hasLocalStorage() should return false

    const { PolicyRuleStore } = await importFreshStoreModule();

    const seed = [{ effect: "allow", priority: 0 }, { effect: "deny", priority: -1 }];
    const storeA = new PolicyRuleStore();
    const storeB = new PolicyRuleStore();

    expect(storeA.save(seed)).toBe(true);
    expect(storeB.load()).toEqual(seed);

    expect(storeA.clear()).toBe(true);

    const storeC = new PolicyRuleStore();
    expect(storeC.load()).toEqual([]);
  });

  it("handles rapid consecutive save() and repeated load() calls (concurrency boundary)", async () => {
    const storageKey = "paperburner_policy_rules_v1";
    const storage = createLocalStorageStub();
    installLocalStorage(storage);

    const { PolicyRuleStore } = await importFreshStoreModule();
    const store = new PolicyRuleStore({ storageKey });

    store.save([{ effect: "allow" }]);
    store.save([{ effect: "deny" }]);

    expect(storage.setItem).toHaveBeenCalledTimes(2);

    const lastStored = storage.setItem.mock.calls[1][1];
    expect(JSON.parse(lastStored).rules).toEqual([{ effect: "deny" }]);

    const results = await Promise.all(
      Array.from({ length: 10 }, () => Promise.resolve().then(() => store.load())),
    );

    for (const res of results) expect(res).toEqual([{ effect: "deny" }]);
    expect(results[0]).not.toBe(results[1]);
  });
});

describe("default", () => {
  it("re-exports PolicyRuleStore as default", async () => {
    const storage = createLocalStorageStub();
    installLocalStorage(storage);

    const mod = await importFreshStoreModule();
    expect(mod.default).toBe(mod.PolicyRuleStore);
  });

  it("default export can be instantiated and used normally", async () => {
    const storage = createLocalStorageStub();
    installLocalStorage(storage);

    const { default: DefaultStore } = await importFreshStoreModule();
    const store = new DefaultStore();

    expect(store.save([{ effect: "allow" }])).toBe(true);
    expect(store.load()).toEqual([{ effect: "allow" }]);
  });
});
