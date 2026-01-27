import { describe, it, expect, vi, beforeEach } from "vitest";

const sharedMock = vi.hoisted(() => {
  const state = {
    platformIsBrowser: false,
    globalTokenCounter: { kind: "global-token-counter" },
  };

  const Platform = {};
  Object.defineProperty(Platform, "isBrowser", {
    get() {
      return state.platformIsBrowser;
    },
    set(value) {
      state.platformIsBrowser = Boolean(value);
    },
    configurable: true,
    enumerable: true,
  });

  class DisposableBase {
    constructor() {
      this.__disposableBaseConstructed = true;
    }
  }

  const deepClone = vi.fn((value) => {
    if (typeof globalThis.structuredClone === "function") return globalThis.structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  });

  const isPlainObject = vi.fn((value) => {
    if (value === null || typeof value !== "object") return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  });

  const toNonEmptyString = vi.fn((value) => (typeof value === "string" && value.trim().length > 0 ? value : ""));

  const getGlobalTokenCounter = vi.fn(() => state.globalTokenCounter);

  return {
    state,
    Platform,
    DisposableBase,
    deepClone,
    isPlainObject,
    toNonEmptyString,
    getGlobalTokenCounter,
  };
});

const utilsMock = vi.hoisted(() => {
  const state = { genIdCounter: 0 };

  const estimateTokens = vi.fn(() => 0);
  const truncate = vi.fn((value) => value);

  const genId = vi.fn((prefix) => `${prefix}_${++state.genIdCounter}`);

  return { state, estimateTokens, genId, truncate };
});

const todoNormalizeMock = vi.hoisted(() => ({
  normalizeTodoStatus: vi.fn((value) => value),
}));

const layerMock = vi.hoisted(() => ({
  defineL0Layer: vi.fn(() => ({})),
  defineL1Layer: vi.fn(() => ({})),
  defineL2Layer: vi.fn(() => ({})),
  defineL3Layer: vi.fn(() => ({})),
}));

vi.mock("../../../../../js/agents/shared/index.js", () => ({
  deepClone: sharedMock.deepClone,
  isPlainObject: sharedMock.isPlainObject,
  toNonEmptyString: sharedMock.toNonEmptyString,
  getGlobalTokenCounter: sharedMock.getGlobalTokenCounter,
  Platform: sharedMock.Platform,
  DisposableBase: sharedMock.DisposableBase,
}));

vi.mock("../../../../../js/agents/plugins/memory/memory-store.impl.utils.js", () => ({
  estimateTokens: utilsMock.estimateTokens,
  genId: utilsMock.genId,
  truncate: utilsMock.truncate,
}));

vi.mock("../../../../../js/agents/plugins/memory/todo-normalize.js", () => ({
  normalizeTodoStatus: todoNormalizeMock.normalizeTodoStatus,
}));

vi.mock("../../../../../js/agents/plugins/memory/memory-store.impl.l0.js", () => ({
  defineL0Layer: layerMock.defineL0Layer,
}));

vi.mock("../../../../../js/agents/plugins/memory/memory-store.impl.l1.js", () => ({
  defineL1Layer: layerMock.defineL1Layer,
}));

vi.mock("../../../../../js/agents/plugins/memory/memory-store.impl.l2.js", () => ({
  defineL2Layer: layerMock.defineL2Layer,
}));

vi.mock("../../../../../js/agents/plugins/memory/memory-store.impl.l3.js", () => ({
  defineL3Layer: layerMock.defineL3Layer,
}));

async function importMemoryStoreModule() {
  return import("../../../../../js/agents/plugins/memory/memory-store.impl.core.js");
}

describe("MemoryStore", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    sharedMock.Platform.isBrowser = false;
    sharedMock.state.globalTokenCounter = { kind: "global-token-counter" };
    sharedMock.getGlobalTokenCounter.mockImplementation(() => sharedMock.state.globalTokenCounter);

    sharedMock.toNonEmptyString.mockImplementation((value) =>
      typeof value === "string" && value.trim().length > 0 ? value : ""
    );

    utilsMock.state.genIdCounter = 0;
    utilsMock.genId.mockImplementation((prefix) => `${prefix}_${++utilsMock.state.genIdCounter}`);
  });

  it("initializes with defaults and generates runId when runId missing/empty", async () => {
    const { MemoryStore } = await importMemoryStoreModule();

    const store = new MemoryStore();

    expect(sharedMock.toNonEmptyString).toHaveBeenCalledWith(undefined);
    expect(utilsMock.genId).toHaveBeenCalledWith("run");
    expect(store.runId).toBe("run_1");

    expect(store.config).toBeTruthy();
    expect(store.config.maxMessages).toBe(20);
    expect(store.config.maxSignals).toBe(50);
    expect(store.config.maxDecisions).toBe(30);
    expect(store.config.keepLastTurns).toBe(6);
    expect(store.config.compressThreshold).toBe(0.8);
    expect(store.config.contextWindow).toBe(128000);

    expect(store.eventBus).toBe(null);
    expect(store.archiveAdapter).toBe(null);

    expect(sharedMock.getGlobalTokenCounter).toHaveBeenCalledTimes(1);
    expect(store._tokenCounter).toBe(sharedMock.state.globalTokenCounter);

    expect(store).toBeInstanceOf(sharedMock.DisposableBase);
    expect(store.__disposableBaseConstructed).toBe(true);
  });

  it("uses provided non-empty runId and preserves it exactly", async () => {
    const { MemoryStore } = await importMemoryStoreModule();

    const store = new MemoryStore({ runId: "my-run-id" });

    expect(sharedMock.toNonEmptyString).toHaveBeenCalledWith("my-run-id");
    expect(store.runId).toBe("my-run-id");
  });

  it("treats whitespace-only runId as empty and falls back to genId", async () => {
    const { MemoryStore } = await importMemoryStoreModule();

    const store = new MemoryStore({ runId: "   " });

    expect(sharedMock.toNonEmptyString).toHaveBeenCalledWith("   ");
    expect(store.runId).toBe("run_1");
  });

  it("merges config overrides (including boundary values) without coercion", async () => {
    const { MemoryStore } = await importMemoryStoreModule();

    const nested = { level0: { level1: { level2: { value: 123 } } } };
    const store = new MemoryStore({
      config: {
        maxMessages: 0,
        maxSignals: -1,
        maxDecisions: Number.MAX_SAFE_INTEGER,
        keepLastTurns: "6",
        compressThreshold: 0,
        contextWindow: 0,
        extra: nested,
      },
    });

    expect(store.config.maxMessages).toBe(0);
    expect(store.config.maxSignals).toBe(-1);
    expect(store.config.maxDecisions).toBe(Number.MAX_SAFE_INTEGER);
    expect(store.config.keepLastTurns).toBe("6");
    expect(store.config.compressThreshold).toBe(0);
    expect(store.config.contextWindow).toBe(0);

    expect(store.config.extra).toBe(nested);
    expect(store.config.extra.level0.level1.level2.value).toBe(123);
  });

  it("resolves tokenCounter option precedence (null > provided > global default) and handles type boundaries", async () => {
    const { MemoryStore } = await importMemoryStoreModule();

    const storeNull = new MemoryStore({ tokenCounter: null });
    expect(sharedMock.getGlobalTokenCounter).not.toHaveBeenCalled();
    expect(storeNull._tokenCounter).toBe(null);

    const customCounter = { kind: "custom-token-counter" };
    const storeProvided = new MemoryStore({ tokenCounter: customCounter });
    expect(sharedMock.getGlobalTokenCounter).not.toHaveBeenCalled();
    expect(storeProvided._tokenCounter).toBe(customCounter);

    const storeFalsy = new MemoryStore({ tokenCounter: 0 });
    expect(sharedMock.getGlobalTokenCounter).toHaveBeenCalledTimes(1);
    expect(storeFalsy._tokenCounter).toBe(sharedMock.state.globalTokenCounter);

    const storeDefault = new MemoryStore();
    expect(sharedMock.getGlobalTokenCounter).toHaveBeenCalledTimes(2);
    expect(storeDefault._tokenCounter).toBe(sharedMock.state.globalTokenCounter);
  });

  it("accepts object-ish optional services and ignores non-objects", async () => {
    const { MemoryStore } = await importMemoryStoreModule();

    const embeddingService = { embed: true };
    const vectorIndex = [];
    const retrievalEngine = "not-an-object";

    const store = new MemoryStore({ embeddingService, vectorIndex, retrievalEngine });

    expect(store._embeddingService).toBe(embeddingService);
    expect(store._vectorIndex).toBe(vectorIndex);
    expect(store._retrievalEngine).toBe(null);
  });

  it("selects explicit l3Storage over vfs; otherwise stores vfs for lazy construction", async () => {
    const { MemoryStore } = await importMemoryStoreModule();

    const l3Storage = { kind: "l3" };
    const vfs = { kind: "vfs" };

    const storePreferL3 = new MemoryStore({ l3Storage, vfs });
    expect(storePreferL3._l3Storage).toBe(l3Storage);
    expect(storePreferL3._vfs).toBe(null);

    const storeVfsOnly = new MemoryStore({ vfs });
    expect(storeVfsOnly._vfs).toBe(vfs);
    expect(storeVfsOnly._l3Storage).toBe(null);
  });

  it("initializes internal layers and keeps per-instance isolation", async () => {
    const { MemoryStore } = await importMemoryStoreModule();

    const a = new MemoryStore({ tokenCounter: null });
    const b = new MemoryStore({ tokenCounter: null });

    expect(a._L0).toEqual({ systemPrompt: "", taskGoal: "", todos: [] });
    expect(b._L0).toEqual({ systemPrompt: "", taskGoal: "", todos: [] });

    expect(a._L1.messages).toEqual([]);
    expect(b._L1.messages).toEqual([]);
    a._L1.messages.push({ role: "user", content: "hi" });
    expect(b._L1.messages).toEqual([]);

    expect(a._L1.syncTable.discoveries).toBeInstanceOf(Map);
    expect(a._L1.syncTable.subagents).toBeInstanceOf(Map);
    a._L1.syncTable.discoveries.set("d1", { id: "d1" });
    expect(b._L1.syncTable.discoveries.has("d1")).toBe(false);

    expect(a._L2.stageSummaries).toBeInstanceOf(Map);
    expect(a._L3.snapshots).toBeInstanceOf(Map);
    expect(a._L3.index.keywords).toBeInstanceOf(Map);
    expect(a._L3.index.stages).toBeInstanceOf(Map);
    expect(Array.isArray(a._L3.index.timeline)).toBe(true);
    expect(Array.isArray(a._L3.checkpoints)).toBe(true);
  });

  it("_markDirty sets known layers and ignores unknown keys", async () => {
    const { MemoryStore } = await importMemoryStoreModule();

    const store = new MemoryStore({ tokenCounter: null });

    expect(store._dirty).toEqual({ L0: true, L1: true, L2: true, L3: false });

    store._markDirty("L3");
    expect(store._dirty.L3).toBe(true);

    const snapshot = { ...store._dirty };
    store._markDirty("UNKNOWN_LAYER");
    expect(store._dirty).toEqual(snapshot);
  });

  it("_clearDirty clears a specific layer or all layers and ignores invalid keys", async () => {
    const { MemoryStore } = await importMemoryStoreModule();

    const store = new MemoryStore({ tokenCounter: null });
    store._dirty.L0 = true;
    store._dirty.L1 = true;
    store._dirty.L2 = true;
    store._dirty.L3 = true;

    store._clearDirty("L1");
    expect(store._dirty).toEqual({ L0: true, L1: false, L2: true, L3: true });

    store._clearDirty("NOPE");
    expect(store._dirty).toEqual({ L0: true, L1: false, L2: true, L3: true });

    store._clearDirty();
    expect(store._dirty).toEqual({ L0: false, L1: false, L2: false, L3: false });
  });

  it("defaults maxL3Bytes to Infinity when Platform.isBrowser is false", async () => {
    sharedMock.Platform.isBrowser = false;
    vi.resetModules();

    const { MemoryStore } = await importMemoryStoreModule();
    const store = new MemoryStore({ tokenCounter: null });

    expect(store.config.maxL3Bytes).toBe(Infinity);
  });

  it("defaults maxL3Bytes to 5GB when Platform.isBrowser is true", async () => {
    sharedMock.Platform.isBrowser = true;
    vi.resetModules();

    const { MemoryStore } = await importMemoryStoreModule();
    const store = new MemoryStore({ tokenCounter: null });

    expect(store.config.maxL3Bytes).toBe(5 * 1024 * 1024 * 1024);
  });

  it("throws on null options (error handling)", async () => {
    const { MemoryStore } = await importMemoryStoreModule();
    expect(() => new MemoryStore(null)).toThrow();
  });

  it("handles huge strings, deep nesting, rapid consecutive construction, and concurrent dirty marking", async () => {
    const { MemoryStore } = await importMemoryStoreModule();

    const hugeRunId = "r".repeat(10_000);
    const deep = { a: { b: { c: { d: { e: { value: "ok" } } } } } };
    const store = new MemoryStore({ runId: hugeRunId, config: { deep } });

    expect(store.runId).toBe(hugeRunId);
    expect(store.config.deep.a.b.c.d.e.value).toBe("ok");

    const stores = Array.from({ length: 25 }, () => new MemoryStore({ tokenCounter: null }));
    const runIds = stores.map((s) => s.runId);
    expect(new Set(runIds).size).toBe(runIds.length);

    const target = stores[0];
    target._dirty.L3 = false;

    await Promise.all(
      Array.from({ length: 50 }, () => Promise.resolve().then(() => target._markDirty("L3")))
    );

    expect(target._dirty.L3).toBe(true);
  });
});