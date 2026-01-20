import { beforeEach, describe, expect, it, vi } from "vitest";

const mockedMessageManagerModule = vi.hoisted(() => {
  class MessageManager {
    constructor() {
      this.markAsSuperseded = vi.fn(() => 0);
      this.insertCorrectionMessage = vi.fn();
    }
  }

  return { MessageManager };
});

const mockedL3StorageModule = vi.hoisted(() => {
  class L3Storage {
    constructor() {
      this.init = vi.fn(async () => {});
      this.getTimeline = vi.fn(() => []);
      this.markSnapshotsSuperseded = vi.fn(async () => {});
    }
  }

  return { L3Storage };
});

vi.mock("../../../../js/agents/runtime/core/message-manager.js", () => mockedMessageManagerModule);
vi.mock("../../../../js/agents/plugins/memory/l3-storage.js", () => mockedL3StorageModule);

let SoftBacktrackManager;
let SoftBacktrackManagerDefault;

beforeEach(async () => {
  vi.clearAllMocks();
  const module = await import("../../../../js/agents/sdk/SoftBacktrackManager.js");
  SoftBacktrackManager = module.SoftBacktrackManager;
  SoftBacktrackManagerDefault = module.default;
});

const createMessageManager = (overrides = {}) => {
  const manager = new mockedMessageManagerModule.MessageManager();
  Object.assign(manager, overrides);
  return manager;
};

const createL3Storage = (overrides = {}) => {
  const storage = new mockedL3StorageModule.L3Storage();
  Object.assign(storage, overrides);
  return storage;
};

const createLogger = () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
});

const createSignal = (overrides = {}) => ({
  correction: "Fix it",
  supersedeRange: null,
  severity: "minor",
  timestamp: 0,
  ...overrides,
});

const createDeferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe("SoftBacktrackManager", () => {
  it("throws without messageManager", () => {
    expect(() => new SoftBacktrackManager()).toThrow("SoftBacktrackManager requires { messageManager }");
    expect(() => new SoftBacktrackManager(null)).toThrow("SoftBacktrackManager requires { messageManager }");
  });

  it("defaults maxDMails and respects boundary limits", () => {
    const manager = new SoftBacktrackManager({
      messageManager: createMessageManager(),
      maxDMails: "5",
    });
    expect(manager.maxDMails).toBe(5);
    expect(manager.dmailCount).toBe(0);
    expect(manager.remaining).toBe(5);

    const zero = new SoftBacktrackManager({
      messageManager: createMessageManager(),
      maxDMails: 0,
    });
    expect(zero.canSendDMail()).toBe(false);
    expect(zero.remaining).toBe(0);

    const negative = new SoftBacktrackManager({
      messageManager: createMessageManager(),
      maxDMails: -1,
    });
    expect(negative.canSendDMail()).toBe(false);
    expect(negative.remaining).toBe(0);
  });

  it("rejects empty or missing corrections", async () => {
    const cases = [
      { signal: null },
      { signal: undefined },
      { signal: {} },
      { signal: [] },
      { signal: createSignal({ correction: "" }) },
      { signal: createSignal({ correction: "   " }) },
    ];

    for (const { signal } of cases) {
      const messageManager = createMessageManager();
      const manager = new SoftBacktrackManager({ messageManager });

      const result = await manager.processDMailSignal(signal);

      expect(result).toEqual({ success: false, reason: "invalid_correction" });
      expect(messageManager.markAsSuperseded).not.toHaveBeenCalled();
      expect(messageManager.insertCorrectionMessage).not.toHaveBeenCalled();
      expect(manager.dmailCount).toBe(0);
    }
  });

  it("treats non-numeric supersedeRange as missing", async () => {
    const messageManager = createMessageManager();
    const l3Storage = createL3Storage({
      getTimeline: vi.fn(() => [{ id: "a" }]),
    });
    const manager = new SoftBacktrackManager({ messageManager, l3Storage });
    const signal = createSignal({
      supersedeRange: { from: "1", to: { value: 2 } },
    });

    const result = await manager.processDMailSignal(signal);

    expect(result.success).toBe(true);
    const [fromArg, toArg, correctionArg] = messageManager.markAsSuperseded.mock.calls[0];
    expect(fromArg).toBeNaN();
    expect(toArg).toBeNaN();
    expect(correctionArg).toBe("Fix it");
    expect(l3Storage.markSnapshotsSuperseded).toHaveBeenCalledWith([], "Fix it");
  });

  it("clamps ranges and deduplicates snapshot ids", async () => {
    const messageManager = createMessageManager({
      markAsSuperseded: vi.fn(() => 2),
    });
    const l3Storage = createL3Storage({
      getTimeline: vi.fn(() => [
        { id: "a" },
        { id: "b" },
        { id: "b" },
        { id: 123 },
        { id: "c" },
      ]),
    });
    const manager = new SoftBacktrackManager({ messageManager, l3Storage });
    const signal = createSignal({
      correction: "Fix",
      supersedeRange: { from: 3, to: -1 },
      meta: { deep: { nested: { value: true } } },
    });

    const result = await manager.processDMailSignal(signal);

    expect(result).toEqual({ success: true, markedCount: 2 });
    expect(messageManager.markAsSuperseded).toHaveBeenCalledWith(3, -1, "Fix");
    expect(messageManager.insertCorrectionMessage).toHaveBeenCalledWith(signal);
    expect(l3Storage.init).toHaveBeenCalledTimes(1);
    expect(l3Storage.getTimeline).toHaveBeenCalledWith({ includeSuperseded: true });
    expect(l3Storage.markSnapshotsSuperseded).toHaveBeenCalledWith(["a", "b"], "Fix");
    expect(manager.dmailCount).toBe(1);
    expect(manager.getDMailHistory()).toEqual([signal]);
  });

  it("uses a single index when only one bound is provided", async () => {
    const messageManager = createMessageManager();
    const l3Storage = createL3Storage({
      getTimeline: vi.fn(() => [{ id: "x" }, { id: "y" }, { id: "z" }]),
    });
    const manager = new SoftBacktrackManager({ messageManager, l3Storage });
    const signal = createSignal({
      supersedeRange: { from: null, to: 1 },
    });

    const result = await manager.processDMailSignal(signal);

    expect(result.success).toBe(true);
    expect(messageManager.markAsSuperseded).toHaveBeenCalledWith(1, 1, "Fix it");
    expect(l3Storage.markSnapshotsSuperseded).toHaveBeenCalledWith(["y"], "Fix it");
  });

  it("skips snapshot ids when range is out of bounds", async () => {
    const messageManager = createMessageManager();
    const l3Storage = createL3Storage({
      getTimeline: vi.fn(() => [{ id: "a" }, { id: "b" }]),
    });
    const manager = new SoftBacktrackManager({ messageManager, l3Storage });
    const signal = createSignal({
      supersedeRange: { from: Number.MAX_SAFE_INTEGER, to: Number.MAX_SAFE_INTEGER },
    });

    const result = await manager.processDMailSignal(signal);

    expect(result.success).toBe(true);
    expect(messageManager.markAsSuperseded).toHaveBeenCalledWith(
      Number.MAX_SAFE_INTEGER,
      Number.MAX_SAFE_INTEGER,
      "Fix it",
    );
    expect(l3Storage.markSnapshotsSuperseded).toHaveBeenCalledWith([], "Fix it");
  });

  it("returns limit_reached after max and handles fast sequential calls", async () => {
    const messageManager = createMessageManager();
    const manager = new SoftBacktrackManager({ messageManager, maxDMails: 1 });
    const signal = createSignal();

    const first = await manager.processDMailSignal(signal);
    const second = await manager.processDMailSignal(signal);

    expect(first.success).toBe(true);
    expect(second).toEqual({ success: false, reason: "limit_reached" });
    expect(manager.dmailCount).toBe(1);
    expect(manager.remaining).toBe(0);
    expect(messageManager.markAsSuperseded).toHaveBeenCalledTimes(1);
  });

  it("handles concurrent calls", async () => {
    const messageManager = createMessageManager();
    const deferred = createDeferred();
    const l3Storage = createL3Storage({
      init: vi.fn(() => deferred.promise),
    });
    const manager = new SoftBacktrackManager({ messageManager, l3Storage, maxDMails: 2 });
    const signalA = createSignal({ correction: "A" });
    const signalB = createSignal({ correction: "B" });

    const firstPromise = manager.processDMailSignal(signalA);
    const secondPromise = manager.processDMailSignal(signalB);
    deferred.resolve();

    const results = await Promise.all([firstPromise, secondPromise]);

    expect(results.every((result) => result.success)).toBe(true);
    expect(manager.dmailCount).toBe(2);
    expect(messageManager.markAsSuperseded).toHaveBeenCalledTimes(2);
    expect(manager.getDMailHistory()).toEqual(expect.arrayContaining([signalA, signalB]));
  });

  it("handles non-array timeline input by reporting an error", async () => {
    const logger = createLogger();
    const messageManager = createMessageManager();
    const l3Storage = createL3Storage({
      getTimeline: vi.fn(() => ({})),
    });
    const manager = new SoftBacktrackManager({ messageManager, l3Storage, logger });
    const signal = createSignal({ supersedeRange: { from: 0, to: 0 } });

    const result = await manager.processDMailSignal(signal);

    expect(result.success).toBe(false);
    expect(result.reason).toEqual(expect.any(String));
    expect(logger.error).toHaveBeenCalledWith("D-Mail processing failed", { error: expect.any(String) });
    expect(manager.dmailCount).toBe(0);
    expect(l3Storage.markSnapshotsSuperseded).not.toHaveBeenCalled();
  });

  it("handles large timelines, long corrections, and deep nesting", async () => {
    const timeline = Array.from({ length: 5000 }, (_, index) => ({ id: `id-${index}` }));
    const longCorrection = "x".repeat(10000);
    const messageManager = createMessageManager({
      markAsSuperseded: vi.fn(() => timeline.length),
    });
    const l3Storage = createL3Storage({
      getTimeline: vi.fn(() => timeline),
    });
    const manager = new SoftBacktrackManager({ messageManager, l3Storage });
    const signal = createSignal({
      correction: longCorrection,
      supersedeRange: { from: 0, to: timeline.length - 1 },
      meta: { a: { b: { c: { d: { e: true } } } } },
    });

    const result = await manager.processDMailSignal(signal);

    expect(result).toEqual({ success: true, markedCount: timeline.length });
    const ids = l3Storage.markSnapshotsSuperseded.mock.calls[0][0];
    expect(ids).toHaveLength(timeline.length);
    expect(ids[0]).toBe("id-0");
    expect(ids[ids.length - 1]).toBe(`id-${timeline.length - 1}`);
  });

  it("returns history copies and reset clears state", async () => {
    const messageManager = createMessageManager();
    const manager = new SoftBacktrackManager({ messageManager });
    const signal = createSignal();

    await manager.processDMailSignal(signal);
    const history = manager.getDMailHistory();

    expect(history).toEqual([signal]);
    history.push(createSignal({ correction: "extra" }));
    expect(manager.getDMailHistory()).toEqual([signal]);

    manager.reset();
    expect(manager.dmailCount).toBe(0);
    expect(manager.getDMailHistory()).toEqual([]);
  });
});

describe("SoftBacktrackManager (default export)", () => {
  it("matches the named export", () => {
    expect(SoftBacktrackManagerDefault).toBe(SoftBacktrackManager);
  });
});
