import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const loggerInstance = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return {
    loggerInstance,
    createLogger: vi.fn(() => loggerInstance),
    isPlainObject: vi.fn(),
  };
});

vi.mock("../../../../js/agents/shared/index.js", () => ({
  createLogger: mocks.createLogger,
  isPlainObject: mocks.isPlainObject,
}));

import {
  logger,
  DB_NAME,
  DB_VERSION,
  STORE_RUNS,
  STORE_ARTIFACTS,
  STORE_EVENTS,
  STORE_COUNTERS,
  DAY_MS,
  hasIndexedDB,
  promisifyRequest,
  promisifyTransaction,
  toISO,
  encodeUtf8Bytes,
  parseIsoMs,
  normalizeRetentionConfig,
  isPinnedRunContext,
  deleteByIndexKey,
  getLastByCompoundIndex,
  ensureObjectStore,
  ensureIndex,
  default as runStoreUtils,
} from "../../../../js/agents/storage/run-store-utils.js";

const defaultIsPlainObject = (value) => {
  if (!value || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const createCursorRequest = (values = []) => {
  const request = { result: null, onsuccess: null, onerror: null, error: null };
  let index = 0;
  const cursors = values.map((value) => ({
    value,
    delete: vi.fn(),
    continue: vi.fn(),
  }));

  const trigger = () => {
    request.result = cursors[index] || null;
    index += 1;
    if (request.onsuccess) request.onsuccess();
  };

  cursors.forEach((cursor) => {
    cursor.continue = vi.fn(() => trigger());
  });

  return { request, cursors, trigger };
};

const createRequest = () => ({
  result: null,
  onsuccess: null,
  onerror: null,
  error: null,
});

beforeEach(() => {
  mocks.isPlainObject.mockReset();
  mocks.isPlainObject.mockImplementation(defaultIsPlainObject);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("logger", () => {
  it("creates a namespaced logger", () => {
    expect(mocks.createLogger).toHaveBeenCalledWith("storage/run-store");
    expect(logger).toBe(mocks.loggerInstance);
  });
});

describe("DB_NAME", () => {
  it("exposes the database name", () => {
    expect(DB_NAME).toBe("AgentRuntimeDB");
  });
});

describe("DB_VERSION", () => {
  it("exposes the database version", () => {
    expect(DB_VERSION).toBe(2);
  });
});

describe("STORE_RUNS", () => {
  it("exposes the runs store name", () => {
    expect(STORE_RUNS).toBe("runs");
  });
});

describe("STORE_ARTIFACTS", () => {
  it("exposes the artifacts store name", () => {
    expect(STORE_ARTIFACTS).toBe("artifacts");
  });
});

describe("STORE_EVENTS", () => {
  it("exposes the events store name", () => {
    expect(STORE_EVENTS).toBe("events");
  });
});

describe("STORE_COUNTERS", () => {
  it("exposes the counters store name", () => {
    expect(STORE_COUNTERS).toBe("counters");
  });
});

describe("DAY_MS", () => {
  it("exposes milliseconds per day", () => {
    expect(DAY_MS).toBe(24 * 60 * 60 * 1000);
  });
});

describe("hasIndexedDB", () => {
  it("returns false when indexedDB is missing or falsy", () => {
    vi.stubGlobal("indexedDB", undefined);
    expect(hasIndexedDB()).toBe(false);

    vi.stubGlobal("indexedDB", null);
    expect(hasIndexedDB()).toBeFalsy();

    vi.stubGlobal("indexedDB", 0);
    expect(hasIndexedDB()).toBeFalsy();
  });

  it("returns false when indexedDB.open is not a function", () => {
    vi.stubGlobal("indexedDB", { open: "nope" });
    expect(hasIndexedDB()).toBe(false);
  });

  it("returns true when indexedDB.open is available", () => {
    vi.stubGlobal("indexedDB", { open: vi.fn() });
    expect(hasIndexedDB()).toBe(true);
  });

  it("is stable under rapid concurrent checks", async () => {
    vi.stubGlobal("indexedDB", { open: vi.fn() });
    const results = await Promise.all(
      Array.from({ length: 3 }, () => Promise.resolve().then(() => hasIndexedDB()))
    );
    expect(results).toEqual([true, true, true]);
  });
});

describe("promisifyRequest", () => {
  it("resolves with the request result on success", async () => {
    const req = { result: "ok", onsuccess: null, onerror: null, error: null };
    const promise = promisifyRequest(req);
    req.onsuccess();
    await expect(promise).resolves.toBe("ok");
  });

  it("rejects with the request error on failure", async () => {
    const error = new Error("boom");
    const req = { result: null, onsuccess: null, onerror: null, error };
    const promise = promisifyRequest(req);
    req.onerror();
    await expect(promise).rejects.toBe(error);
  });

  it("rejects when given a non-request value", async () => {
    await expect(promisifyRequest(null)).rejects.toThrow(TypeError);
    await expect(promisifyRequest(undefined)).rejects.toThrow(TypeError);
  });

  it("handles concurrent requests independently", async () => {
    const reqA = { result: "a", onsuccess: null, onerror: null, error: null };
    const reqB = { result: "b", onsuccess: null, onerror: null, error: null };

    const promiseA = promisifyRequest(reqA);
    const promiseB = promisifyRequest(reqB);

    reqB.onsuccess();
    reqA.onsuccess();

    await expect(Promise.all([promiseA, promiseB])).resolves.toEqual(["a", "b"]);
  });
});

describe("promisifyTransaction", () => {
  it("resolves when the transaction completes", async () => {
    const tx = { oncomplete: null, onabort: null, onerror: null, error: null };
    const promise = promisifyTransaction(tx);
    tx.oncomplete();
    await expect(promise).resolves.toBeUndefined();
  });

  it("rejects with the transaction error on abort", async () => {
    const error = new Error("abort");
    const tx = { oncomplete: null, onabort: null, onerror: null, error };
    const promise = promisifyTransaction(tx);
    tx.onabort();
    await expect(promise).rejects.toBe(error);
  });

  it("rejects with a default error when aborted without error", async () => {
    const tx = { oncomplete: null, onabort: null, onerror: null, error: null };
    const promise = promisifyTransaction(tx);
    tx.onabort();
    await expect(promise).rejects.toThrow("IndexedDB transaction aborted");
  });

  it("rejects on transaction error", async () => {
    const error = new Error("tx error");
    const tx = { oncomplete: null, onabort: null, onerror: null, error };
    const promise = promisifyTransaction(tx);
    tx.onerror();
    await expect(promise).rejects.toBe(error);
  });

  it("rejects when given a non-transaction value", async () => {
    await expect(promisifyTransaction(null)).rejects.toThrow(TypeError);
    await expect(promisifyTransaction(undefined)).rejects.toThrow(TypeError);
  });

  it("handles concurrent transactions", async () => {
    const txA = { oncomplete: null, onabort: null, onerror: null, error: null };
    const txB = { oncomplete: null, onabort: null, onerror: null, error: null };

    const promiseA = promisifyTransaction(txA);
    const promiseB = promisifyTransaction(txB);

    txA.oncomplete();
    txB.oncomplete();

    await expect(Promise.all([promiseA, promiseB])).resolves.toEqual([undefined, undefined]);
  });
});

describe("toISO", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
  });

  it("defaults to the current time when no argument is provided", () => {
    expect(toISO()).toBe("2024-01-01T00:00:00.000Z");
  });

  it("formats Date instances and timestamps", () => {
    const date = new Date("2023-05-06T07:08:09.000Z");
    expect(toISO(date)).toBe("2023-05-06T07:08:09.000Z");
    expect(toISO(0)).toBe("1970-01-01T00:00:00.000Z");
  });

  it("accepts date-like strings", () => {
    const value = "2024-02-03T04:05:06.000Z";
    expect(toISO(value)).toBe("2024-02-03T04:05:06.000Z");
  });

  it("treats null as epoch", () => {
    expect(toISO(null)).toBe("1970-01-01T00:00:00.000Z");
  });

  it("throws for invalid date values", () => {
    expect(() => toISO("not-a-date")).toThrow();
  });
});

describe("encodeUtf8Bytes", () => {
  it("returns undefined for non-string inputs", () => {
    const values = [null, undefined, 0, -1, Number.MAX_SAFE_INTEGER, {}, [], { text: "a" }];
    for (const value of values) {
      expect(encodeUtf8Bytes(value)).toBeUndefined();
    }
  });

  it("returns byte length for empty and whitespace strings", () => {
    expect(encodeUtf8Bytes("")).toBe(0);
    expect(encodeUtf8Bytes("   ")).toBe(3);
  });

  it("handles long strings (resource boundary)", () => {
    const longText = "a".repeat(100000);
    expect(encodeUtf8Bytes(longText)).toBe(100000);
  });

  it("falls back to string length when TextEncoder fails", () => {
    vi.stubGlobal(
      "TextEncoder",
      class {
        constructor() {
          throw new Error("unsupported");
        }
      }
    );

    expect(encodeUtf8Bytes("fallback")).toBe("fallback".length);
  });

  it("is stable under concurrent calls", async () => {
    const inputs = ["a", "", "abc", " ".repeat(10)];
    const results = await Promise.all(inputs.map((text) => Promise.resolve().then(() => encodeUtf8Bytes(text))));
    expect(results).toEqual(inputs.map((text) => text.length));
  });
});

describe("parseIsoMs", () => {
  it("returns numeric inputs unchanged", () => {
    expect(parseIsoMs(0)).toBe(0);
    expect(parseIsoMs(-1)).toBe(-1);
    expect(parseIsoMs(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("parses ISO strings and trims whitespace", () => {
    const value = "2024-01-02T03:04:05.000Z";
    expect(parseIsoMs(value)).toBe(Date.parse(value));
    expect(parseIsoMs(`  ${value}  `)).toBe(Date.parse(value));
  });

  it("returns null for empty or non-string inputs", () => {
    const values = [null, undefined, "", "   ", [], {}];
    for (const value of values) {
      expect(parseIsoMs(value)).toBeNull();
    }
  });

  it("returns null for invalid date strings", () => {
    expect(parseIsoMs("not-a-date")).toBeNull();
  });

  it("handles numeric strings via Date.parse", () => {
    const numeric = "123";
    expect(parseIsoMs(numeric)).toBe(Date.parse(numeric));
  });

  it("handles concurrent parsing", async () => {
    const valueA = "2024-01-02T03:04:05.000Z";
    const valueB = "2024-01-03T00:00:00.000Z";
    const inputs = [valueA, ` ${valueB} `, "invalid", 42];
    const results = await Promise.all(inputs.map((value) => Promise.resolve().then(() => parseIsoMs(value))));

    expect(results).toEqual([Date.parse(valueA), Date.parse(valueB), null, 42]);
  });
});

describe("normalizeRetentionConfig", () => {
  it("returns defaults for non-plain config values", () => {
    mocks.isPlainObject.mockReturnValue(false);

    const values = [null, undefined, "", [], { maxRuns: 5 }];
    for (const value of values) {
      expect(normalizeRetentionConfig(value)).toEqual({
        enabled: null,
        maxRuns: null,
        maxAgeDays: null,
        maxTotalBytes: null,
        keepPinned: true,
        pinnedKey: "pinned",
      });
    }
  });

  it("normalizes valid numeric limits and flags", () => {
    const result = normalizeRetentionConfig({
      maxRuns: 10.7,
      maxAgeDays: 14.25,
      maxTotalBytes: 2048.9,
      enabled: 0,
      keepPinned: 1,
      pinnedKey: "  keep ",
    });

    expect(result).toEqual({
      enabled: false,
      maxRuns: 10,
      maxAgeDays: 14.25,
      maxTotalBytes: 2048,
      keepPinned: true,
      pinnedKey: "keep",
    });
  });

  it("prefers maxBytes when maxTotalBytes is absent", () => {
    const result = normalizeRetentionConfig({ maxBytes: 512.4 });
    expect(result.maxTotalBytes).toBe(512);
  });

  it("drops invalid numeric values", () => {
    const result = normalizeRetentionConfig({
      maxRuns: "5",
      maxAgeDays: 0,
      maxTotalBytes: -1,
    });

    expect(result.maxRuns).toBeNull();
    expect(result.maxAgeDays).toBeNull();
    expect(result.maxTotalBytes).toBeNull();
  });

  it("keeps defaults for empty pinned keys", () => {
    const result = normalizeRetentionConfig({ pinnedKey: "   ", keepPinned: undefined });
    expect(result.pinnedKey).toBe("pinned");
    expect(result.keepPinned).toBe(true);
  });

  it("supports deep nested config objects", () => {
    const deep = { layer: { next: { value: true } } };
    const result = normalizeRetentionConfig({ ...deep, maxRuns: Number.MAX_SAFE_INTEGER });
    expect(result.maxRuns).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("is stable under concurrent calls", async () => {
    const inputs = [
      { maxRuns: 3 },
      { maxAgeDays: 1.5, enabled: true },
      { maxBytes: 1024, keepPinned: false },
    ];

    const results = await Promise.all(inputs.map((value) => Promise.resolve().then(() => normalizeRetentionConfig(value))));

    expect(results).toEqual([
      expect.objectContaining({ maxRuns: 3 }),
      expect.objectContaining({ maxAgeDays: 1.5, enabled: true }),
      expect.objectContaining({ maxTotalBytes: 1024, keepPinned: false }),
    ]);
  });
});

describe("isPinnedRunContext", () => {
  it("returns false for non-object contexts", () => {
    const values = [null, undefined, "", "   ", 0, -1, [], Number.MAX_SAFE_INTEGER];
    for (const value of values) {
      expect(isPinnedRunContext(value)).toBe(false);
    }
  });

  it("detects pinned context on the root object", () => {
    expect(isPinnedRunContext({ pinned: true })).toBe(true);
    expect(isPinnedRunContext({ pinned: 1 })).toBe(false);
  });

  it("detects pinned context inside retention", () => {
    expect(isPinnedRunContext({ retention: { pinned: true } })).toBe(true);
  });

  it("supports custom pinned keys and defaults when invalid", () => {
    expect(isPinnedRunContext({ favorite: true }, "favorite")).toBe(true);
    expect(isPinnedRunContext({ pinned: true }, "")).toBe(true);
  });

  it("ignores deep nested keys", () => {
    const deep = { retention: { nested: { pinned: true } } };
    expect(isPinnedRunContext(deep)).toBe(false);
  });

  it("handles concurrent checks", async () => {
    const inputs = [
      { pinned: true },
      { pinned: false },
      { retention: { pinned: true } },
      {},
    ];

    const results = await Promise.all(inputs.map((ctx) => Promise.resolve().then(() => isPinnedRunContext(ctx))));
    expect(results).toEqual([true, false, true, false]);
  });
});

describe("deleteByIndexKey", () => {
  it("deletes matching records and resolves when exhausted", async () => {
    const { request, cursors, trigger } = createCursorRequest([{ id: 1 }, { id: 2 }]);
    const index = { openCursor: vi.fn(() => request) };
    const store = { index: vi.fn(() => index) };

    const promise = deleteByIndexKey(store, "byKey", "match");
    trigger();
    await expect(promise).resolves.toBeUndefined();

    expect(store.index).toHaveBeenCalledWith("byKey");
    expect(index.openCursor).toHaveBeenCalledWith("match");
    expect(cursors[0].delete).toHaveBeenCalledTimes(1);
    expect(cursors[1].delete).toHaveBeenCalledTimes(1);
  });

  it("resolves immediately when there are no matches", async () => {
    const { request, trigger } = createCursorRequest([]);
    const store = { index: vi.fn(() => ({ openCursor: vi.fn(() => request) })) };

    const promise = deleteByIndexKey(store, "empty", "key");
    trigger();
    await expect(promise).resolves.toBeUndefined();
  });

  it("rejects when the request errors", async () => {
    const error = new Error("cursor failed");
    const request = { result: null, onsuccess: null, onerror: null, error };
    const store = { index: vi.fn(() => ({ openCursor: vi.fn(() => request) })) };

    const promise = deleteByIndexKey(store, "byKey", "match");
    request.onerror();

    await expect(promise).rejects.toBe(error);
  });

  it("supports concurrent deletions", async () => {
    const first = createCursorRequest([{ id: "a" }]);
    const second = createCursorRequest([{ id: "b" }]);

    const storeA = { index: vi.fn(() => ({ openCursor: vi.fn(() => first.request) })) };
    const storeB = { index: vi.fn(() => ({ openCursor: vi.fn(() => second.request) })) };

    const promiseA = deleteByIndexKey(storeA, "idx", "a");
    const promiseB = deleteByIndexKey(storeB, "idx", "b");

    first.trigger();
    second.trigger();

    await expect(Promise.all([promiseA, promiseB])).resolves.toEqual([undefined, undefined]);
  });
});

describe("getLastByCompoundIndex", () => {
  it("returns the last matching cursor value", async () => {
    const request = createRequest();
    const index = { openCursor: vi.fn(() => request) };
    const store = { index: vi.fn(() => index) };

    const promise = getLastByCompoundIndex(store, "compound", "range");
    request.result = { value: { id: 2 } };
    request.onsuccess();

    await expect(promise).resolves.toEqual({ id: 2 });
    expect(index.openCursor).toHaveBeenCalledWith("range", "prev");
  });

  it("returns null when there is no cursor", async () => {
    const request = createRequest();
    const store = { index: vi.fn(() => ({ openCursor: vi.fn(() => request) })) };

    const promise = getLastByCompoundIndex(store, "compound", "range");
    request.result = null;
    request.onsuccess();

    await expect(promise).resolves.toBeNull();
  });

  it("rejects when the cursor request errors", async () => {
    const error = new Error("cursor error");
    const request = createRequest();
    request.error = error;

    const store = { index: vi.fn(() => ({ openCursor: vi.fn(() => request) })) };
    const promise = getLastByCompoundIndex(store, "compound", "range");

    request.onerror();
    await expect(promise).rejects.toBe(error);
  });
});

describe("ensureObjectStore", () => {
  it("creates the object store when missing", () => {
    const db = {
      objectStoreNames: { contains: vi.fn(() => false) },
      createObjectStore: vi.fn(),
    };

    ensureObjectStore(db, "runs", { keyPath: "runId" });

    expect(db.createObjectStore).toHaveBeenCalledWith("runs", { keyPath: "runId" });
  });

  it("does nothing when the object store exists", () => {
    const db = {
      objectStoreNames: { contains: vi.fn(() => true) },
      createObjectStore: vi.fn(),
    };

    ensureObjectStore(db, "runs");

    expect(db.createObjectStore).not.toHaveBeenCalled();
  });
});

describe("ensureIndex", () => {
  it("creates the index when missing", () => {
    const store = {
      indexNames: { contains: vi.fn(() => false) },
      createIndex: vi.fn(),
    };

    ensureIndex(store, "byRun", ["runId", "createdAt"], { unique: false });

    expect(store.createIndex).toHaveBeenCalledWith("byRun", ["runId", "createdAt"], { unique: false });
  });

  it("does nothing when the index exists", () => {
    const store = {
      indexNames: { contains: vi.fn(() => true) },
      createIndex: vi.fn(),
    };

    ensureIndex(store, "byRun", ["runId", "createdAt"]);

    expect(store.createIndex).not.toHaveBeenCalled();
  });
});

describe("default", () => {
  it("exposes the named utilities", () => {
    expect(runStoreUtils.logger).toBe(logger);
    expect(runStoreUtils.DB_NAME).toBe(DB_NAME);
    expect(runStoreUtils.DB_VERSION).toBe(DB_VERSION);
    expect(runStoreUtils.STORE_RUNS).toBe(STORE_RUNS);
    expect(runStoreUtils.STORE_ARTIFACTS).toBe(STORE_ARTIFACTS);
    expect(runStoreUtils.STORE_EVENTS).toBe(STORE_EVENTS);
    expect(runStoreUtils.STORE_COUNTERS).toBe(STORE_COUNTERS);
    expect(runStoreUtils.DAY_MS).toBe(DAY_MS);
    expect(runStoreUtils.hasIndexedDB).toBe(hasIndexedDB);
    expect(runStoreUtils.promisifyRequest).toBe(promisifyRequest);
    expect(runStoreUtils.promisifyTransaction).toBe(promisifyTransaction);
    expect(runStoreUtils.toISO).toBe(toISO);
    expect(runStoreUtils.encodeUtf8Bytes).toBe(encodeUtf8Bytes);
    expect(runStoreUtils.parseIsoMs).toBe(parseIsoMs);
    expect(runStoreUtils.normalizeRetentionConfig).toBe(normalizeRetentionConfig);
    expect(runStoreUtils.isPinnedRunContext).toBe(isPinnedRunContext);
    expect(runStoreUtils.deleteByIndexKey).toBe(deleteByIndexKey);
    expect(runStoreUtils.getLastByCompoundIndex).toBe(getLastByCompoundIndex);
    expect(runStoreUtils.ensureObjectStore).toBe(ensureObjectStore);
    expect(runStoreUtils.ensureIndex).toBe(ensureIndex);
  });
});
