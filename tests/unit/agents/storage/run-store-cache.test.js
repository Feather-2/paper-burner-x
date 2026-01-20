import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../../js/agents/shared/index.js", () => ({
  isPlainObject: vi.fn(),
}));

vi.mock("../../../../js/agents/storage/run-store-utils.js", () => ({
  DAY_MS: 24 * 60 * 60 * 1000,
  STORE_ARTIFACTS: "artifacts",
  encodeUtf8Bytes: vi.fn(),
  isPinnedRunContext: vi.fn(),
  logger: { warn: vi.fn() },
  normalizeRetentionConfig: vi.fn(),
  parseIsoMs: vi.fn(),
  promisifyTransaction: vi.fn(),
}));

import { estimateQuota, _maybeWarnQuota, setRetentionPolicy, _estimateRunBytes } from "../../../../js/agents/storage/run-store-cache.js";
import * as shared from "../../../../js/agents/shared/index.js";
import * as utils from "../../../../js/agents/storage/run-store-utils.js";

const setGlobal = (name, value) => {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
};

const createQuotaContext = (overrides = {}) => ({
  _quotaWarnRatio: 0.2,
  _quotaCheckIntervalMs: 0,
  _lastQuotaInfo: null,
  _lastQuotaCheckMs: 0,
  _lastQuotaWarnMs: 0,
  _onQuotaWarning: null,
  _autoCleanup: { enabled: false },
  _lastCleanupMs: 0,
  _cleanupPromise: null,
  estimateQuota: vi.fn(),
  cleanupRuns: vi.fn(() => Promise.resolve()),
  ...overrides,
});

const setupIdb = (records, options = {}) => {
  const idbKeyRangeOnly = vi.fn((id) => ({ id }));
  setGlobal("IDBKeyRange", { only: idbKeyRangeOnly });

  const tx = { objectStore: vi.fn() };
  const openCursor = vi.fn(() => {
    const req = {};
    queueMicrotask(() => {
      if (options.cursorError) {
        req.error = options.cursorError;
        if (req.onerror) req.onerror();
        return;
      }
      let idx = 0;
      const makeCursor = () => ({
        value: records[idx],
        continue: () => {
          idx += 1;
          req.result = idx < records.length ? makeCursor() : null;
          if (req.onsuccess) req.onsuccess();
        },
      });
      req.result = records.length ? makeCursor() : null;
      if (req.onsuccess) req.onsuccess();
    });
    return req;
  });

  const index = { openCursor };
  const store = { index: vi.fn(() => index) };
  tx.objectStore.mockReturnValue(store);

  const db = { transaction: vi.fn(() => tx) };
  const open = vi.fn(async () => db);

  return { open, db, tx, store, index, openCursor, idbKeyRangeOnly };
};

let originalNavigatorDescriptor;
let originalIdbDescriptor;
let originalBlobDescriptor;

beforeEach(() => {
  vi.clearAllMocks();
  originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  originalIdbDescriptor = Object.getOwnPropertyDescriptor(globalThis, "IDBKeyRange");
  originalBlobDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Blob");

  shared.isPlainObject.mockImplementation((value) => {
    if (!value || typeof value !== "object") return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  });

  utils.encodeUtf8Bytes.mockImplementation((text) => {
    if (typeof text !== "string") return undefined;
    return new TextEncoder().encode(text).byteLength;
  });

  utils.normalizeRetentionConfig.mockImplementation((retention) => ({ normalized: true, retention }));
  utils.promisifyTransaction.mockImplementation(() => Promise.resolve());
});

afterEach(() => {
  if (originalNavigatorDescriptor) Object.defineProperty(globalThis, "navigator", originalNavigatorDescriptor);
  else delete globalThis.navigator;

  if (originalIdbDescriptor) Object.defineProperty(globalThis, "IDBKeyRange", originalIdbDescriptor);
  else delete globalThis.IDBKeyRange;

  if (originalBlobDescriptor) Object.defineProperty(globalThis, "Blob", originalBlobDescriptor);
  else delete globalThis.Blob;

  vi.useRealTimers();
});

describe("estimateQuota", () => {
  it("returns supported false when estimate is missing", async () => {
    setGlobal("navigator", {});
    const result = await estimateQuota();
    expect(result).toEqual({ supported: false });
  });

  it("returns supported true with numeric quota and usage", async () => {
    const estimate = vi.fn().mockResolvedValue({ quota: 123, usage: 45 });
    setGlobal("navigator", { storage: { estimate } });

    const result = await estimateQuota();

    expect(result).toEqual({ supported: true, quota: 123, usage: 45 });
    expect(estimate).toHaveBeenCalledTimes(1);
  });

  it("ignores non-numeric quota and usage", async () => {
    const estimate = vi.fn().mockResolvedValue({ quota: "100", usage: null });
    setGlobal("navigator", { storage: { estimate } });

    const result = await estimateQuota();

    expect(result).toEqual({ supported: true, quota: undefined, usage: undefined });
  });

  it("handles estimate errors", async () => {
    const estimate = vi.fn(() => {
      throw new Error("boom");
    });
    setGlobal("navigator", { storage: { estimate } });

    const result = await estimateQuota();

    expect(result.supported).toBe(false);
    expect(result.error).toContain("boom");
  });
});

describe("_maybeWarnQuota", () => {
  it("returns early when warn ratio is non-positive", async () => {
    const ctx = createQuotaContext({ _quotaWarnRatio: 0 });

    await _maybeWarnQuota.call(ctx, { upcomingBytes: 100 });

    expect(ctx.estimateQuota).not.toHaveBeenCalled();
    expect(utils.logger.warn).not.toHaveBeenCalled();
  });

  it("uses cached quota info within the check interval", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:10Z"));

    const now = Date.now();
    const ctx = createQuotaContext({
      _quotaWarnRatio: 0.1,
      _quotaCheckIntervalMs: 1000,
      _lastQuotaCheckMs: now - 500,
      _lastQuotaInfo: { supported: true, quota: 100, usage: 20 },
    });

    await _maybeWarnQuota.call(ctx, { upcomingBytes: 0 });

    expect(ctx.estimateQuota).not.toHaveBeenCalled();
    expect(utils.logger.warn).not.toHaveBeenCalled();
  });

  it("skips warnings when quota info is unsupported", async () => {
    const ctx = createQuotaContext({
      estimateQuota: vi.fn().mockResolvedValue({ supported: false }),
    });

    await _maybeWarnQuota.call(ctx, {});

    expect(utils.logger.warn).not.toHaveBeenCalled();
  });

  it("skips warnings when quota/usage are missing", async () => {
    const ctx = createQuotaContext({
      estimateQuota: vi.fn().mockResolvedValue({ supported: true, quota: "100", usage: undefined }),
    });

    await _maybeWarnQuota.call(ctx, {});

    expect(utils.logger.warn).not.toHaveBeenCalled();
  });

  it("emits warning payload via callback with sanitized inputs", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(20_000));

    const onQuotaWarning = vi.fn();
    const ctx = createQuotaContext({
      _quotaWarnRatio: 0.3,
      _lastQuotaWarnMs: 0,
      estimateQuota: vi.fn().mockResolvedValue({ supported: true, quota: 100, usage: 80 }),
      _onQuotaWarning: onQuotaWarning,
    });

    await _maybeWarnQuota.call(ctx, { upcomingBytes: "10", runId: null, type: 123 });

    expect(onQuotaWarning).toHaveBeenCalledTimes(1);
    const payload = onQuotaWarning.mock.calls[0][0];
    expect(payload).toMatchObject({
      runId: undefined,
      type: undefined,
      quota: 100,
      usage: 80,
      upcomingBytes: 0,
      remaining: 20,
      warnRatio: 0.3,
    });
    expect(payload.remainingRatio).toBeCloseTo(0.2, 6);
    expect(utils.logger.warn).not.toHaveBeenCalled();
  });

  it("falls back to logger when callback throws", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(30_000));

    const onQuotaWarning = vi.fn(() => {
      throw new Error("fail");
    });
    const ctx = createQuotaContext({
      _quotaWarnRatio: 0.4,
      estimateQuota: vi.fn().mockResolvedValue({ supported: true, quota: 100, usage: 90 }),
      _onQuotaWarning: onQuotaWarning,
    });

    await _maybeWarnQuota.call(ctx, { upcomingBytes: -1, runId: "" });

    expect(onQuotaWarning).toHaveBeenCalledTimes(1);
    expect(utils.logger.warn).toHaveBeenCalledTimes(1);
  });

  it("throttles warnings on rapid consecutive calls", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(50_000));

    const onQuotaWarning = vi.fn();
    const ctx = createQuotaContext({
      _quotaWarnRatio: 0.5,
      estimateQuota: vi.fn().mockResolvedValue({ supported: true, quota: 100, usage: 90 }),
      _onQuotaWarning: onQuotaWarning,
    });

    await _maybeWarnQuota.call(ctx, { upcomingBytes: 0 });
    await _maybeWarnQuota.call(ctx, { upcomingBytes: 0 });

    expect(onQuotaWarning).toHaveBeenCalledTimes(1);
  });

  it("triggers auto cleanup when enabled and quota is low", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(60_000));

    const cleanupRuns = vi.fn().mockResolvedValue({});
    const ctx = createQuotaContext({
      _quotaWarnRatio: 0.4,
      estimateQuota: vi.fn().mockResolvedValue({ supported: true, quota: 100, usage: 90 }),
      _autoCleanup: { enabled: true, maxRuns: 1 },
      cleanupRuns,
      _lastCleanupMs: 0,
    });

    await _maybeWarnQuota.call(ctx, { runId: "run-1" });

    const cleanupPromise = ctx._cleanupPromise;
    expect(cleanupRuns).toHaveBeenCalledWith({
      retention: ctx._autoCleanup,
      keepRunIds: ["run-1"],
      reason: "quota_low",
    });

    expect(cleanupPromise).toBeInstanceOf(Promise);
    await cleanupPromise;
    expect(ctx._cleanupPromise).toBeNull();
  });
});

describe("setRetentionPolicy", () => {
  it("sets and returns normalized retention", () => {
    const ctx = {};
    const retention = { maxRuns: 5 };
    const normalized = { normalized: true, retention };
    utils.normalizeRetentionConfig.mockReturnValueOnce(normalized);

    const result = setRetentionPolicy.call(ctx, retention);

    expect(utils.normalizeRetentionConfig).toHaveBeenCalledWith(retention);
    expect(result).toEqual(normalized);
    expect(ctx._retention).toEqual(normalized);
  });

  it("handles null, undefined, empty object, empty array, and empty string", () => {
    const ctx = {};
    const inputs = [null, undefined, {}, [], ""];

    for (const input of inputs) {
      utils.normalizeRetentionConfig.mockReturnValueOnce({ normalized: true, retention: input });
      const result = setRetentionPolicy.call(ctx, input);
      expect(result).toEqual({ normalized: true, retention: input });
    }

    expect(utils.normalizeRetentionConfig).toHaveBeenCalledTimes(inputs.length);
  });
});

describe("_estimateRunBytes", () => {
  it("returns null when storage is available", async () => {
    const ctx = { storage: {}, open: vi.fn() };

    const result = await _estimateRunBytes.call(ctx, "run-1");

    expect(result).toBeNull();
    expect(ctx.open).not.toHaveBeenCalled();
  });

  it("returns null for invalid runId values", async () => {
    const ctx = { storage: null, open: vi.fn() };
    const inputs = [null, undefined, "", "   ", 0, -1, {}, []];

    for (const input of inputs) {
      const result = await _estimateRunBytes.call(ctx, input);
      expect(result).toBeNull();
    }

    expect(ctx.open).not.toHaveBeenCalled();
  });

  it("sums positive numeric bytes and ignores non-positive or non-finite values", async () => {
    const records = [
      { bytes: 1 },
      { bytes: 0 },
      { bytes: -1 },
      { bytes: Number.MAX_SAFE_INTEGER },
      { bytes: Number.POSITIVE_INFINITY },
      { bytes: NaN },
      { bytes: "5" },
    ];
    const { open, tx, idbKeyRangeOnly } = setupIdb(records);
    const ctx = { storage: null, open };

    const result = await _estimateRunBytes.call(ctx, "  run  ");

    expect(result).toBe(1 + Number.MAX_SAFE_INTEGER);
    expect(idbKeyRangeOnly).toHaveBeenCalledWith("run");
    expect(utils.promisifyTransaction).toHaveBeenCalledWith(tx);
    expect(utils.encodeUtf8Bytes).not.toHaveBeenCalled();
  });

  it("estimates bytes from blobs, strings, and buffers with fallback", async () => {
    class FakeBlob {
      constructor(size) {
        this.size = size;
      }
    }
    setGlobal("Blob", FakeBlob);

    const longString = "a".repeat(10_000);
    utils.encodeUtf8Bytes.mockImplementationOnce(() => undefined);

    const records = [
      { data: new FakeBlob(5) },
      { data: longString },
      { data: new Uint8Array([1, 2, 3, 4]) },
      { data: new ArrayBuffer(3) },
      { data: null },
      { bytes: 0, data: "ignored" },
      { data: {} },
      { data: "" },
    ];

    const { open, tx } = setupIdb(records);
    const ctx = { storage: null, open };

    const result = await _estimateRunBytes.call(ctx, "run", { estimateObjectBytes: false });

    expect(result).toBe(5 + longString.length + 4 + 3);
    expect(utils.promisifyTransaction).toHaveBeenCalledWith(tx);
  });

  it("estimates object and array bytes when enabled and skips circular data", async () => {
    const deep = { level: 0 };
    let cursor = deep;
    for (let i = 1; i <= 10; i += 1) {
      cursor.next = { level: i };
      cursor = cursor.next;
    }
    const list = [1, 2, 3];
    const emptyList = [];
    const circular = {};
    circular.self = circular;

    const records = [{ data: deep }, { data: list }, { data: emptyList }, { data: circular }];
    const { open } = setupIdb(records);
    const ctx = { storage: null, open };

    const expected =
      new TextEncoder().encode(JSON.stringify(deep)).byteLength +
      new TextEncoder().encode(JSON.stringify(list)).byteLength +
      new TextEncoder().encode(JSON.stringify(emptyList)).byteLength;

    const result = await _estimateRunBytes.call(ctx, "run", { estimateObjectBytes: true });

    expect(result).toBe(expected);
    expect(utils.encodeUtf8Bytes).toHaveBeenCalledWith(JSON.stringify(deep));
    expect(utils.encodeUtf8Bytes).toHaveBeenCalledWith(JSON.stringify(list));
    expect(utils.encodeUtf8Bytes).toHaveBeenCalledWith(JSON.stringify(emptyList));
    expect(utils.encodeUtf8Bytes).toHaveBeenCalledTimes(3);
  });

  it("throws when cursor request errors", async () => {
    const cursorError = new Error("cursor fail");
    const { open } = setupIdb([], { cursorError });
    const ctx = { storage: null, open };

    await expect(_estimateRunBytes.call(ctx, "run")).rejects.toThrow("cursor fail");
  });

  it("supports concurrent calls", async () => {
    const records = [{ bytes: 2 }, { data: "hi" }];
    const { open } = setupIdb(records);
    const ctx = { storage: null, open };

    const [first, second] = await Promise.all([
      _estimateRunBytes.call(ctx, "run"),
      _estimateRunBytes.call(ctx, "run"),
    ]);

    const expected = 2 + new TextEncoder().encode("hi").byteLength;
    expect(first).toBe(expected);
    expect(second).toBe(expected);
    expect(open).toHaveBeenCalledTimes(2);
  });
});
