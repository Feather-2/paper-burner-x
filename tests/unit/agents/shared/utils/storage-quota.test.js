// Unit tests for storage-quota utilities in js/agents/shared/utils/storage-quota.js.
// Covers localStorage availability, quota estimation, and safe write behavior.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const safeJsonParseMock = vi.hoisted(() => vi.fn(() => null));

vi.mock("../../../../../js/agents/shared/utils/safe-json.js", () => ({
  safeJsonParse: safeJsonParseMock,
}));

import {
  hasLocalStorage,
  estimateLocalStorageUsage,
  estimateLocalStorageQuota,
  getLocalStorageQuotaStatus,
  safeLocalStorageSet,
} from "../../../../../js/agents/shared/utils/storage-quota.js";

const QUOTA_BYTES = 5 * 1024 * 1024;

function createLocalStorageMock(seed = {}, overrides = {}) {
  const store = new Map(Object.entries(seed).map(([key, value]) => [String(key), String(value)]));
  const keys = () => Array.from(store.keys());
  return {
    get length() {
      return store.size;
    },
    key(index) {
      if (typeof overrides.key === "function") {
        return overrides.key(index, keys());
      }
      const key = keys()[index];
      return typeof key === "string" ? key : null;
    },
    getItem(key) {
      if (typeof overrides.getItem === "function") {
        return overrides.getItem(key, store);
      }
      const normalized = String(key);
      return store.has(normalized) ? store.get(normalized) : null;
    },
    setItem(key, value) {
      if (typeof overrides.setItem === "function") {
        return overrides.setItem(key, value, store);
      }
      store.set(String(key), String(value));
    },
    removeItem(key) {
      if (typeof overrides.removeItem === "function") {
        return overrides.removeItem(key, store);
      }
      store.delete(String(key));
    },
    clear() {
      store.clear();
    },
  };
}

function makeString(size) {
  return "x".repeat(size);
}

function makeDeepObject(depth) {
  const root = { level: 0 };
  let cursor = root;
  for (let i = 1; i <= depth; i += 1) {
    cursor.child = { level: i };
    cursor = cursor.child;
  }
  return root;
}

function makeValueForRatio(ratio, keyLength = 1) {
  const targetUsed = Math.floor(QUOTA_BYTES * ratio);
  const valueLength = Math.max(0, Math.floor(targetUsed / 2) - keyLength);
  return makeString(valueLength);
}

beforeEach(() => {
  safeJsonParseMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("hasLocalStorage", () => {
  it("returns false when localStorage is undefined", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(hasLocalStorage()).toBe(false);
  });

  it("returns false when localStorage is missing getItem", () => {
    vi.stubGlobal("localStorage", { setItem: () => {} });
    expect(hasLocalStorage()).toBe(false);
  });

  it("returns false when accessing getItem throws", () => {
    const storage = {};
    Object.defineProperty(storage, "getItem", {
      get() {
        throw new Error("boom");
      },
    });
    vi.stubGlobal("localStorage", storage);
    expect(hasLocalStorage()).toBe(false);
  });

  it("returns true when localStorage is available", () => {
    vi.stubGlobal("localStorage", createLocalStorageMock());
    expect(hasLocalStorage()).toBe(true);
  });
});

describe("estimateLocalStorageUsage", () => {
  it("returns zeros when localStorage is unavailable", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(estimateLocalStorageUsage()).toEqual({ used: 0, keys: 0 });
  });

  it("counts key/value bytes using UTF-16 sizing", () => {
    vi.stubGlobal("localStorage", createLocalStorageMock({ a: "1", bb: "22" }));
    expect(estimateLocalStorageUsage()).toEqual({ used: 12, keys: 2 });
  });

  it("skips null keys and treats null values as empty", () => {
    const storage = createLocalStorageMock({ a: "1", b: "2" }, {
      key: (index, keys) => (index === 0 ? null : keys[index]),
      getItem: (key, store) => (String(key) === "b" ? null : store.get(String(key))),
    });
    vi.stubGlobal("localStorage", storage);
    expect(estimateLocalStorageUsage()).toEqual({ used: 2, keys: 1 });
  });

  it("handles array-like key objects without throwing", () => {
    const arrayLikeKey = { length: 6, toString: () => "objKey" };
    const storage = createLocalStorageMock({ objKey: "val" }, {
      key: (index) => (index === 0 ? arrayLikeKey : null),
    });
    vi.stubGlobal("localStorage", storage);
    expect(estimateLocalStorageUsage()).toEqual({ used: 18, keys: 1 });
  });

  it("estimates usage for large and deeply nested values", () => {
    const deepValue = JSON.stringify(makeDeepObject(20));
    const largeValue = makeString(1_000_000);
    const storage = createLocalStorageMock({ deep: deepValue, large: largeValue });
    vi.stubGlobal("localStorage", storage);

    const result = estimateLocalStorageUsage();
    const expectedUsed =
      (String("deep").length + deepValue.length) * 2 + (String("large").length + largeValue.length) * 2;

    expect(result).toEqual({ used: expectedUsed, keys: 2 });
  });

  it("returns partial totals when storage access throws", () => {
    const storage = createLocalStorageMock({ a: "1", b: "22" }, {
      getItem: (key, store) => {
        if (String(key) === "b") throw new Error("fail");
        return store.get(String(key));
      },
    });
    vi.stubGlobal("localStorage", storage);
    expect(estimateLocalStorageUsage()).toEqual({ used: 4, keys: 1 });
  });
});

describe("estimateLocalStorageQuota", () => {
  it("returns a stable 5MB quota estimate", () => {
    const quota = estimateLocalStorageQuota();
    expect(quota).toBe(QUOTA_BYTES);
    expect(quota).toBeGreaterThan(0);
    expect(quota).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });
});

describe("getLocalStorageQuotaStatus", () => {
  it("returns unavailable when localStorage is missing", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(getLocalStorageQuotaStatus()).toEqual({ used: 0, quota: 0, ratio: 0, status: "unavailable" });
  });

  it("returns ok when usage is low", () => {
    vi.stubGlobal("localStorage", createLocalStorageMock({ a: "1" }));
    const result = getLocalStorageQuotaStatus();
    expect(result.status).toBe("ok");
    expect(result.used).toBeGreaterThan(0);
    expect(result.ratio).toBeGreaterThan(0);
    expect(result.ratio).toBeLessThan(0.8);
  });

  it("returns warn when ratio is between thresholds with string inputs", () => {
    const value = makeValueForRatio(0.9, 1);
    vi.stubGlobal("localStorage", createLocalStorageMock({ k: value }));
    const result = getLocalStorageQuotaStatus({ warnThreshold: "0.8", criticalThreshold: "0.95" });
    expect(result.status).toBe("warn");
    expect(result.ratio).toBeGreaterThanOrEqual(0.8);
    expect(result.ratio).toBeLessThan(0.95);
  });

  it("returns critical when ratio meets the critical threshold", () => {
    const value = makeValueForRatio(0.97, 1);
    vi.stubGlobal("localStorage", createLocalStorageMock({ k: value }));
    const result = getLocalStorageQuotaStatus();
    expect(result.status).toBe("critical");
    expect(result.ratio).toBeGreaterThanOrEqual(0.95);
  });

  it("honors negative and zero thresholds", () => {
    vi.stubGlobal("localStorage", createLocalStorageMock({ a: "1" }));
    const result = getLocalStorageQuotaStatus({ warnThreshold: -1, criticalThreshold: 0 });
    expect(result.status).toBe("critical");
  });

  it("accepts array inputs for options without throwing", () => {
    vi.stubGlobal("localStorage", createLocalStorageMock({ a: "1" }));
    const result = getLocalStorageQuotaStatus([]);
    expect(result.status).toBe("ok");
  });
});

describe("safeLocalStorageSet", () => {
  it("returns an error when localStorage is unavailable", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(safeLocalStorageSet("a", "b")).toEqual({ ok: false, error: "localStorage unavailable" });
  });

  it("stringifies boundary inputs for keys and values", () => {
    const storage = createLocalStorageMock();
    vi.stubGlobal("localStorage", storage);

    const cases = [
      { key: null, value: null, expectedKey: "null", expectedValue: "null" },
      { key: undefined, value: undefined, expectedKey: "undefined", expectedValue: "undefined" },
      { key: "", value: "", expectedKey: "", expectedValue: "" },
      { key: [], value: [], expectedKey: "", expectedValue: "" },
      { key: {}, value: {}, expectedKey: "[object Object]", expectedValue: "[object Object]" },
      { key: 0, value: 0, expectedKey: "0", expectedValue: "0" },
      { key: -1, value: -1, expectedKey: "-1", expectedValue: "-1" },
      { key: Number.MAX_SAFE_INTEGER, value: Number.MAX_SAFE_INTEGER, expectedKey: String(Number.MAX_SAFE_INTEGER), expectedValue: String(Number.MAX_SAFE_INTEGER) },
      { key: "   ", value: "   ", expectedKey: "   ", expectedValue: "   " },
    ];

    for (const testCase of cases) {
      storage.clear();
      const result = safeLocalStorageSet(testCase.key, testCase.value);
      expect(result.ok).toBe(true);
      expect(storage.getItem(testCase.expectedKey)).toBe(testCase.expectedValue);
    }
  });

  it("invokes onQuotaWarn when projected ratio is between thresholds", () => {
    const storage = createLocalStorageMock();
    vi.stubGlobal("localStorage", storage);

    const key = "warn";
    const value = makeValueForRatio(0.00015, key.length);
    const onQuotaWarn = vi.fn();

    const result = safeLocalStorageSet(key, value, {
      warnThreshold: 0.0001,
      criticalThreshold: 0.0002,
      onQuotaWarn,
    });

    expect(result.ok).toBe(true);
    expect(onQuotaWarn).toHaveBeenCalledTimes(1);
    const payload = onQuotaWarn.mock.calls[0][0];
    expect(payload.key).toBe(key);
    expect(payload.projectedRatio).toBeGreaterThanOrEqual(0.0001);
    expect(payload.projectedRatio).toBeLessThan(0.0002);
  });

  it("blocks writes when projected ratio exceeds critical and overwrites are disallowed", () => {
    const storage = createLocalStorageMock();
    vi.stubGlobal("localStorage", storage);

    const onQuotaExceeded = vi.fn();
    const key = "big";
    const value = makeValueForRatio(0.00003, key.length);

    const result = safeLocalStorageSet(key, value, {
      warnThreshold: 0.00001,
      criticalThreshold: 0.00002,
      allowOverwrite: false,
      onQuotaExceeded,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("quota_exceeded");
    expect(storage.getItem(key)).toBeNull();
    expect(onQuotaExceeded).toHaveBeenCalledTimes(1);
    expect(result.quotaStatus.projectedRatio).toBeGreaterThanOrEqual(0.00002);
  });

  it("allows writes when overwrites are allowed even above critical", () => {
    const storage = createLocalStorageMock();
    vi.stubGlobal("localStorage", storage);

    const key = "big";
    const value = makeValueForRatio(0.00003, key.length);

    const result = safeLocalStorageSet(key, value, {
      warnThreshold: 0.00001,
      criticalThreshold: 0.00002,
      allowOverwrite: true,
    });

    expect(result.ok).toBe(true);
    expect(storage.getItem(key)).toBe(value);
  });

  it("reports quota errors thrown by setItem", () => {
    const storage = createLocalStorageMock({}, {
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    });
    vi.stubGlobal("localStorage", storage);

    const onQuotaExceeded = vi.fn();
    const result = safeLocalStorageSet("k", "v", { onQuotaExceeded });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("quota_exceeded");
    expect(onQuotaExceeded).toHaveBeenCalledTimes(1);
    expect(onQuotaExceeded.mock.calls[0][0].error).toMatch("QuotaExceededError");
  });

  it("reports non-quota errors thrown by setItem", () => {
    const storage = createLocalStorageMock({}, {
      setItem: () => {
        throw new Error("boom");
      },
    });
    vi.stubGlobal("localStorage", storage);

    const onQuotaExceeded = vi.fn();
    const result = safeLocalStorageSet("k", "v", { onQuotaExceeded });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("boom");
    expect(onQuotaExceeded).not.toHaveBeenCalled();
  });

  it("uses delta size when overwriting with a smaller value", () => {
    const key = "k";
    const existingValue = makeValueForRatio(0.00012, key.length);
    const newValue = makeValueForRatio(0.00002, key.length);
    const storage = createLocalStorageMock({ [key]: existingValue });
    vi.stubGlobal("localStorage", storage);

    const onQuotaExceeded = vi.fn();
    const result = safeLocalStorageSet(key, newValue, {
      warnThreshold: 0.00005,
      criticalThreshold: 0.0001,
      allowOverwrite: false,
      onQuotaExceeded,
    });

    expect(result.ok).toBe(true);
    expect(storage.getItem(key)).toBe(newValue);
    expect(onQuotaExceeded).not.toHaveBeenCalled();
  });

  it("supports concurrent writes", async () => {
    const storage = createLocalStorageMock();
    vi.stubGlobal("localStorage", storage);

    const results = await Promise.all([
      Promise.resolve(safeLocalStorageSet("k1", "v1")),
      Promise.resolve(safeLocalStorageSet("k2", "v2")),
      Promise.resolve(safeLocalStorageSet("k3", "v3")),
    ]);

    expect(results.every((r) => r.ok)).toBe(true);
    expect(storage.length).toBe(3);
  });

  it("supports rapid consecutive writes", () => {
    const storage = createLocalStorageMock();
    vi.stubGlobal("localStorage", storage);

    for (let i = 0; i < 25; i += 1) {
      safeLocalStorageSet("rapid", i);
    }

    expect(storage.getItem("rapid")).toBe("24");
  });
});
