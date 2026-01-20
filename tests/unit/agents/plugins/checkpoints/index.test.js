import { describe, it, expect, vi, beforeEach } from "vitest";

const sharedMocks = vi.hoisted(() => {
  const state = { idCounter: 0 };

  const defaultToNonEmptyString = (value) => {
    if (value === undefined || value === null) return undefined;
    const s = String(value).trim();
    return s.length ? s : undefined;
  };

  const defaultSafeInt = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.floor(n) : null;
  };

  const defaultIsPlainObject = (value) => {
    if (value === null || typeof value !== "object") return false;
    if (Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  };

  const defaultSafeJsonParse = (value, options) => {
    if (value === null || value === undefined) return null;
    if (typeof value === "object") return value;
    const raw = typeof value === "string" ? value : String(value);
    const s = raw.trim();
    if (!s) return null;

    const maxChars = options && typeof options === "object" ? options.maxChars : undefined;
    const limit = maxChars === Infinity
      ? Infinity
      : Number.isFinite(maxChars) && maxChars > 0
        ? Math.floor(maxChars)
        : 1_000_000;
    if (limit !== Infinity && s.length > limit) return null;

    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };

  const mockLogger = { warn: vi.fn() };
  const createLogger = vi.fn(() => mockLogger);

  const toNonEmptyString = vi.fn(defaultToNonEmptyString);
  const safeInt = vi.fn(defaultSafeInt);
  const isPlainObject = vi.fn(defaultIsPlainObject);
  const safeJsonParse = vi.fn(defaultSafeJsonParse);
  const makeSecureTimestampedId = vi.fn(() => `ckpt_${++state.idCounter}`);

  return {
    state,
    mockLogger,
    createLogger,
    toNonEmptyString,
    safeInt,
    isPlainObject,
    safeJsonParse,
    makeSecureTimestampedId,
    defaultToNonEmptyString,
    defaultSafeInt,
    defaultIsPlainObject,
    defaultSafeJsonParse,
  };
});

const storageMocks = vi.hoisted(() => {
  const constructed = [];
  class StorageVfs {
    constructor(adapter) {
      if (!adapter || typeof adapter.get !== "function") {
        throw new Error("Invalid storage adapter");
      }
      if (adapter.shouldThrow) {
        throw new Error("StorageVfs boom");
      }
      this._adapter = adapter;
      constructed.push(adapter);
    }

    async readFile(path) {
      const value = this._adapter.get(path);
      if (value === undefined) {
        throw new Error(`ENOENT: ${path}`);
      }
      return value;
    }

    async writeFile(path, data) {
      this._adapter.set(path, data);
      return true;
    }
  }

  return { StorageVfs, constructed };
});

vi.mock("../../../../../js/agents/shared/index.js", () => ({
  createLogger: sharedMocks.createLogger,
  safeJsonParse: sharedMocks.safeJsonParse,
  isPlainObject: sharedMocks.isPlainObject,
  safeInt: sharedMocks.safeInt,
  toNonEmptyString: sharedMocks.toNonEmptyString,
  makeSecureTimestampedId: sharedMocks.makeSecureTimestampedId,
}));

vi.mock("../../../../../js/agents/vfs/vfs.storage.js", () => ({
  StorageVfs: storageMocks.StorageVfs,
}));

import { AgentCheckpointStore } from "../../../../../js/agents/plugins/checkpoints/index.js";

function createMemoryVfs({ withText = true, asyncTick = false } = {}) {
  const files = new Map();
  const maybeTick = async () => {
    if (asyncTick) {
      await Promise.resolve();
    }
  };

  const readFile = async (path) => {
    await maybeTick();
    if (!files.has(path)) {
      throw new Error(`ENOENT: ${path}`);
    }
    return files.get(path);
  };

  const writeFile = async (path, data) => {
    await maybeTick();
    files.set(path, data);
    return true;
  };

  const vfs = { files, readFile, writeFile };

  if (withText) {
    vfs.readText = async (path) => {
      const data = await readFile(path);
      return typeof data === "string" ? data : String(data);
    };
    vfs.writeText = async (path, text) => {
      await writeFile(path, String(text));
      return true;
    };
  }

  return vfs;
}

function indexPath(runId) {
  return `.agents/runs/${runId}/checkpoints/index.json`;
}

function checkpointPath(runId, checkpointId) {
  return `.agents/runs/${runId}/checkpoints/${checkpointId}.json`;
}

async function readJson(vfs, path) {
  const raw = vfs.readText ? await vfs.readText(path) : await vfs.readFile(path);
  const text = typeof raw === "string" ? raw : String(raw);
  return JSON.parse(text);
}

beforeEach(() => {
  sharedMocks.state.idCounter = 0;

  sharedMocks.createLogger.mockClear();
  sharedMocks.mockLogger.warn.mockClear();
  sharedMocks.toNonEmptyString.mockClear();
  sharedMocks.safeInt.mockClear();
  sharedMocks.isPlainObject.mockClear();
  sharedMocks.safeJsonParse.mockClear();
  sharedMocks.makeSecureTimestampedId.mockClear();

  sharedMocks.toNonEmptyString.mockImplementation(sharedMocks.defaultToNonEmptyString);
  sharedMocks.safeInt.mockImplementation(sharedMocks.defaultSafeInt);
  sharedMocks.isPlainObject.mockImplementation(sharedMocks.defaultIsPlainObject);
  sharedMocks.safeJsonParse.mockImplementation(sharedMocks.defaultSafeJsonParse);
  sharedMocks.makeSecureTimestampedId.mockImplementation(() => `ckpt_${++sharedMocks.state.idCounter}`);

  storageMocks.constructed.length = 0;
});

describe("AgentCheckpointStore", () => {
  it("normalizes runId and handles empty values", async () => {
    const vfs = createMemoryVfs();
    const store = new AgentCheckpointStore({ vfs, runId: "run_1" });

    expect(store.runId).toBe("run_1");

    store.runId = "   ";
    expect(store.runId).toBe(null);

    store.runId = "";
    expect(store.runId).toBe(null);

    store.runId = undefined;
    expect(store.runId).toBe(null);

    store.runId = null;
    expect(store.runId).toBe(null);

    expect(await store.listCheckpoints()).toEqual([]);
    expect(await store.listCheckpoints({ runId: "" })).toEqual([]);
    expect(await store.listCheckpoints({ runId: "   " })).toEqual([]);
    expect(await store.listCheckpoints({ runId: undefined })).toEqual([]);
    expect(await store.listCheckpoints({ runId: null })).toEqual([]);
  });

  it("throws when vfs and storageAdapter are missing", async () => {
    const store = new AgentCheckpointStore({ runId: "run_missing" });

    await expect(store.listCheckpoints({ runId: "run_missing" })).rejects.toThrow(
      "AgentCheckpointStore requires vfs or storageAdapter",
    );
    await expect(store.saveCheckpoint({ runId: "run_missing" })).rejects.toThrow(
      "AgentCheckpointStore requires vfs or storageAdapter",
    );
  });

  it("uses storageAdapter and warns when StorageVfs construction fails", async () => {
    const storage = new Map();
    const adapter = {
      get: (path) => storage.get(path),
      set: (path, value) => storage.set(path, value),
    };

    const store = new AgentCheckpointStore({ storageAdapter: adapter, runId: "run_storage" });
    const saved = await store.saveCheckpoint({ messages: [] });

    expect(storageMocks.constructed.length).toBe(1);
    expect(storage.size).toBeGreaterThan(0);
    expect(saved.checkpointId).toBe("ckpt_1");

    sharedMocks.mockLogger.warn.mockClear();

    const badAdapter = { get: () => undefined, shouldThrow: true };
    const badStore = new AgentCheckpointStore({ storageAdapter: badAdapter, runId: "run_storage" });
    await expect(badStore.saveCheckpoint({ runId: "run_storage" })).rejects.toThrow(
      "AgentCheckpointStore requires vfs or storageAdapter",
    );
    expect(sharedMocks.mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Failed to build StorageVfs"),
    );
  });

  it("listCheckpoints normalizes index entries with boundaries", async () => {
    const vfs = createMemoryVfs();
    const runId = "run_list";
    const indexPayload = {
      checkpoints: [
        { checkpointId: "ckpt_a", ts: "2024-01-01T00:00:00.000Z", step: "0", iteration: "1", metadata: { note: "ok" } },
        { checkpointId: "ckpt_b", ts: "2024-01-01T00:00:01.000Z", step: -1, iteration: Number.MAX_SAFE_INTEGER },
        { checkpointId: "", ts: "bad" },
        { checkpointId: "ckpt_c", metadata: [] },
      ],
    };
    await vfs.writeText(indexPath(runId), JSON.stringify(indexPayload));

    const store = new AgentCheckpointStore({ vfs, runId });
    const list = await store.listCheckpoints();

    expect(list.map((entry) => entry.checkpointId)).toEqual(["ckpt_a", "ckpt_b", "ckpt_c"]);

    const entryA = list.find((entry) => entry.checkpointId === "ckpt_a");
    expect(entryA.step).toBe(0);
    expect(entryA.iteration).toBe(1);
    expect(entryA.metadata).toEqual({ note: "ok" });

    const entryB = list.find((entry) => entry.checkpointId === "ckpt_b");
    expect(entryB.step).toBe(-1);
    expect(entryB.iteration).toBe(Number.MAX_SAFE_INTEGER);

    const entryC = list.find((entry) => entry.checkpointId === "ckpt_c");
    expect(entryC.metadata).toBeUndefined();
  });

  it("saveCheckpoint writes checkpoint and index with coerced inputs", async () => {
    const vfs = createMemoryVfs();
    const runId = "run_save";

    sharedMocks.makeSecureTimestampedId.mockReturnValueOnce("ckpt_fixed");

    const store = new AgentCheckpointStore({ vfs, runId });
    const saved = await store.saveCheckpoint({
      messages: null,
      toolCalls: [],
      results: {},
      metadata: {},
      step: "7",
      iteration: 0,
    });

    expect(saved.checkpointId).toBe("ckpt_fixed");
    expect(saved.checkpoint.step).toBe(7);
    expect(saved.checkpoint.iteration).toBe(0);
    expect(saved.checkpoint.messages).toEqual([]);
    expect(saved.checkpoint.toolCalls).toEqual([]);
    expect(saved.checkpoint.results).toEqual([]);
    expect(saved.checkpoint.metadata).toEqual({});

    const checkpoint = await readJson(vfs, checkpointPath(runId, "ckpt_fixed"));
    expect(checkpoint.checkpointId).toBe("ckpt_fixed");
    expect(checkpoint.step).toBe(7);
    expect(checkpoint.iteration).toBe(0);
    expect(checkpoint.messages).toEqual([]);
    expect(checkpoint.toolCalls).toEqual([]);
    expect(checkpoint.results).toEqual([]);
    expect(checkpoint.metadata).toEqual({});

    const index = await readJson(vfs, indexPath(runId));
    expect(index.checkpoints).toHaveLength(1);
    expect(index.checkpoints[0].checkpointId).toBe("ckpt_fixed");
    expect(index.checkpoints[0].step).toBe(7);
    expect(index.checkpoints[0].iteration).toBe(0);
  });

  it("falls back to a generated id when secure id creation fails", async () => {
    const vfs = createMemoryVfs();
    const store = new AgentCheckpointStore({ vfs, runId: "run_fallback" });

    sharedMocks.makeSecureTimestampedId.mockImplementationOnce(() => {
      throw new Error("boom");
    });

    const saved = await store.saveCheckpoint({ messages: [] });

    expect(saved.checkpointId).toMatch(/^ckpt_/);
    expect(saved.checkpoint.checkpointId).toBe(saved.checkpointId);
    expect(sharedMocks.mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Failed to generate secure checkpoint id"),
    );
  });

  it("returns null and warns for invalid schema or oversized payload", async () => {
    const vfs = createMemoryVfs();
    const store = new AgentCheckpointStore({ vfs, runId: "run_bad" });

    const invalid = { schemaVersion: "0.1", kind: "wrong", checkpointId: "bad", runId: "run_bad" };
    await vfs.writeText(checkpointPath("run_bad", "bad"), JSON.stringify(invalid));

    const invalidResult = await store.loadCheckpoint({ checkpointId: "bad" });
    expect(invalidResult).toBeNull();
    expect(sharedMocks.mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Invalid checkpoint schema"),
    );

    sharedMocks.mockLogger.warn.mockClear();

    const huge = "x".repeat(5_000_001);
    await vfs.writeText(checkpointPath("run_bad", "huge"), huge);

    const hugeResult = await store.loadCheckpoint({ checkpointId: "huge" });
    expect(hugeResult).toBeNull();
    expect(sharedMocks.mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Invalid checkpoint schema"),
    );
  });

  it("resolves checkpoints by step, checkpoint id, and last with boundary values", async () => {
    const vfs = createMemoryVfs();
    const store = new AgentCheckpointStore({ vfs, runId: "run_steps" });

    sharedMocks.makeSecureTimestampedId
      .mockReturnValueOnce("ckpt_zero")
      .mockReturnValueOnce("ckpt_neg")
      .mockReturnValueOnce("ckpt_max");

    const savedZero = await store.saveCheckpoint({ step: 0 });
    const savedNeg = await store.saveCheckpoint({ step: -1 });
    const savedMax = await store.saveCheckpoint({ step: Number.MAX_SAFE_INTEGER });

    const byZero = await store.loadCheckpoint({ mode: "step", step: "0" });
    expect(byZero.checkpointId).toBe(savedZero.checkpointId);

    const byNeg = await store.loadCheckpoint({ mode: "step", step: -1 });
    expect(byNeg.checkpointId).toBe(savedNeg.checkpointId);

    const byMax = await store.loadCheckpoint({ mode: "step", step: Number.MAX_SAFE_INTEGER });
    expect(byMax.checkpointId).toBe(savedMax.checkpointId);

    const byId = await store.loadCheckpoint({ mode: "checkpoint", checkpointId: savedNeg.checkpointId });
    expect(byId.checkpointId).toBe(savedNeg.checkpointId);

    const byLast = await store.loadCheckpoint({ mode: "last" });
    expect(byLast.checkpointId).toBe(savedMax.checkpointId);
  });

  it("handles concurrent saves and rapid consecutive loads", async () => {
    const vfs = createMemoryVfs({ asyncTick: true });
    const store = new AgentCheckpointStore({ vfs, runId: "run_concurrent" });

    const saveA = store.saveCheckpoint({ messages: [], step: 1 });
    const saveB = store.saveCheckpoint({ messages: [], step: 2 });
    const [a, b] = await Promise.all([saveA, saveB]);

    const list = await store.listCheckpoints();
    const ids = list.map((entry) => entry.checkpointId);
    expect(ids).toHaveLength(2);
    expect(ids).toEqual(expect.arrayContaining([a.checkpointId, b.checkpointId]));

    const firstLoad = await store.loadCheckpoint({ mode: "last" });
    const secondLoad = await store.loadCheckpoint({ mode: "last" });
    expect(firstLoad.checkpointId).toBe(secondLoad.checkpointId);
  });

  it("stores long runId and deep metadata safely", async () => {
    const vfs = createMemoryVfs();
    const longRunId = `run_${"a".repeat(2048)}`;
    const deepMetadata = {
      level1: {
        level2: {
          level3: {
            level4: {
              level5: {
                value: "deep",
              },
            },
          },
        },
      },
    };

    sharedMocks.makeSecureTimestampedId.mockReturnValueOnce("ckpt_deep");

    const store = new AgentCheckpointStore({ vfs, runId: longRunId });
    const saved = await store.saveCheckpoint({ metadata: deepMetadata });
    const loaded = await store.loadCheckpoint({ checkpointId: saved.checkpointId });

    expect(loaded.metadata.level1.level2.level3.level4.level5.value).toBe("deep");

    const paths = Array.from(vfs.files.keys());
    expect(paths.some((path) => path.includes(longRunId))).toBe(true);
  });
});
