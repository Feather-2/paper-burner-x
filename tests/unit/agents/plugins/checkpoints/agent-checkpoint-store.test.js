import { describe, it, expect, vi, beforeEach } from "vitest";

const loggerMock = vi.hoisted(() => ({
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

const storageVfsCtor = vi.hoisted(() => vi.fn());

vi.mock("../../../../../js/agents/shared/index.js", async () => {
  const actual = await vi.importActual("../../../../../js/agents/shared/index.js");
  return {
    ...actual,
    createLogger: vi.fn(() => loggerMock),
    makeSecureTimestampedId: vi.fn(() => "ckpt_0"),
  };
});

vi.mock("../../../../../js/agents/vfs/vfs.storage.js", () => ({
  StorageVfs: class StorageVfsMock {
    constructor(adapter) {
      return storageVfsCtor(adapter);
    }
  },
}));

import AgentCheckpointStore, {
  AgentCheckpointStore as NamedAgentCheckpointStore,
} from "../../../../../js/agents/plugins/checkpoints/agent-checkpoint-store.js";
import { makeSecureTimestampedId } from "../../../../../js/agents/shared/index.js";

const makeMemoryVfs = ({
  supportReadText = true,
  supportWriteText = true,
  readFileMode = "bytes",
  delay = 0,
} = {}) => {
  const files = new Map();
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const maybeDelay = async () => {
    if (delay > 0) await wait(delay);
  };

  const readText = vi.fn(async (path) => {
    await maybeDelay();
    if (!files.has(path)) throw new Error(`ENOENT: ${path}`);
    return files.get(path);
  });

  const writeText = vi.fn(async (path, text) => {
    await maybeDelay();
    files.set(path, String(text));
  });

  const readFile = vi.fn(async (path) => {
    await maybeDelay();
    if (!files.has(path)) throw new Error(`ENOENT: ${path}`);
    const data = files.get(path);
    if (readFileMode === "string") return String(data);
    return new TextEncoder().encode(String(data));
  });

  const writeFile = vi.fn(async (path, data) => {
    await maybeDelay();
    if (typeof data === "string") {
      files.set(path, data);
      return;
    }
    if (data instanceof Uint8Array) {
      files.set(path, new TextDecoder().decode(data));
      return;
    }
    files.set(path, String(data));
  });

  const vfs = { files, readFile, writeFile };
  if (supportReadText) vfs.readText = readText;
  if (supportWriteText) vfs.writeText = writeText;
  return vfs;
};

const findFile = (files, predicate) => {
  for (const [path, content] of files.entries()) {
    if (predicate(path)) return { path, content };
  }
  return null;
};

const makeDeepObject = (depth) => {
  const root = {};
  let node = root;
  for (let i = 0; i < depth; i += 1) {
    node.next = { level: i };
    node = node.next;
  }
  return root;
};

let idCounter = 0;

beforeEach(() => {
  idCounter = 0;
  loggerMock.warn.mockClear();
  loggerMock.info.mockClear();
  loggerMock.error.mockClear();
  loggerMock.debug.mockClear();
  storageVfsCtor.mockReset();
  vi.mocked(makeSecureTimestampedId).mockReset();
  vi.mocked(makeSecureTimestampedId).mockImplementation((prefix) => `${prefix}_${idCounter++}`);
});

describe("AgentCheckpointStore", () => {
  describe("constructor/runId", () => {
    it("normalizes runId and setter handles empty values", () => {
      const vfs = makeMemoryVfs();
      const store = new AgentCheckpointStore({ vfs, runId: "  run_1  " });

      expect(store.runId).toBe("run_1");

      store.runId = "   ";
      expect(store.runId).toBeNull();

      store.runId = 0;
      expect(store.runId).toBe("0");

      store.runId = null;
      expect(store.runId).toBeNull();
    });

    it("uses StorageVfs when storageAdapter is provided", () => {
      const storageAdapter = { get: vi.fn() };
      const vfs = makeMemoryVfs();
      storageVfsCtor.mockImplementation(() => vfs);

      const store = new AgentCheckpointStore({ storageAdapter, runId: "run_1" });

      expect(storageVfsCtor).toHaveBeenCalledWith(storageAdapter);
      expect(store._requireVfs()).toBe(vfs);
    });

    it("logs a warning when StorageVfs construction fails", () => {
      const storageAdapter = { get: vi.fn() };
      storageVfsCtor.mockImplementation(() => {
        throw new Error("boom");
      });

      const store = new AgentCheckpointStore({ storageAdapter, runId: "run_1" });

      expect(loggerMock.warn).toHaveBeenCalledWith(expect.stringContaining("Failed to build StorageVfs"));
      expect(() => store._requireVfs()).toThrow(/requires vfs or storageAdapter/i);
    });
  });

  describe("listCheckpoints", () => {
    it("returns empty when runId is missing or blank", async () => {
      const vfs = makeMemoryVfs();
      const store = new AgentCheckpointStore({ vfs });

      await expect(store.listCheckpoints()).resolves.toEqual([]);
      await expect(store.listCheckpoints({ runId: "   " })).resolves.toEqual([]);
      await expect(store.listCheckpoints({ runId: null })).resolves.toEqual([]);
    });

    it("throws when runId is set but vfs is missing", async () => {
      const store = new AgentCheckpointStore({ runId: "run_1" });

      await expect(store.listCheckpoints()).rejects.toThrow(/requires vfs or storageAdapter/i);
    });

    it("parses array index and normalizes entries", async () => {
      const vfs = makeMemoryVfs();
      const payload = [
        { checkpointId: "cp1", ts: "t1", step: "1", iteration: 2, metadata: { ok: true } },
        { checkpointId: "   ", ts: "bad" },
        { checkpointId: "cp2", step: "notnum", iteration: "3", metadata: [] },
      ];
      vfs.readText.mockResolvedValueOnce(JSON.stringify(payload));

      const store = new AgentCheckpointStore({ vfs, runId: "run_1" });
      const list = await store.listCheckpoints();

      expect(list).toHaveLength(2);
      expect(list[0]).toEqual(
        expect.objectContaining({
          checkpointId: "cp1",
          ts: "t1",
          step: 1,
          iteration: 2,
          metadata: { ok: true },
        })
      );
      expect(list[1].checkpointId).toBe("cp2");
      expect(list[1].step).toBeNull();
      expect(list[1].iteration).toBe(3);
      expect(list[1].metadata).toBeUndefined();
      expect(typeof list[1].ts).toBe("string");
    });

    it("accepts object index payloads", async () => {
      const vfs = makeMemoryVfs();
      const payload = {
        checkpoints: [{ checkpointId: "cp_obj", ts: "t2", step: 0, metadata: {} }],
      };
      vfs.readText.mockResolvedValueOnce(JSON.stringify(payload));

      const store = new AgentCheckpointStore({ vfs, runId: "run_obj" });
      const list = await store.listCheckpoints();

      expect(list).toEqual([
        expect.objectContaining({ checkpointId: "cp_obj", step: 0, metadata: {} }),
      ]);
    });

    it("returns empty for oversized index payloads", async () => {
      const vfs = makeMemoryVfs();
      vfs.readText.mockResolvedValueOnce("x".repeat(2_000_001));

      const store = new AgentCheckpointStore({ vfs, runId: "run_big" });
      const list = await store.listCheckpoints();

      expect(list).toEqual([]);
    });

    it("logs warning for read errors", async () => {
      const vfs = makeMemoryVfs();
      vfs.readText.mockRejectedValueOnce(new Error("boom"));

      const store = new AgentCheckpointStore({ vfs, runId: "run_err" });
      const list = await store.listCheckpoints();

      expect(list).toEqual([]);
      expect(loggerMock.warn).toHaveBeenCalledWith(expect.stringContaining("Failed to read index"));
    });
  });

  describe("saveCheckpoint", () => {
    it("writes checkpoint and index with defaults and sanitized paths", async () => {
      const vfs = makeMemoryVfs();
      const runId = "run/../id";
      const store = new AgentCheckpointStore({ vfs, runId });

      const { checkpointId } = await store.saveCheckpoint({
        messages: { not: "array" },
        toolCalls: "oops",
        results: { nope: true },
        metadata: "bad",
        step: "2",
        iteration: 3,
      });

      const checkpointFile = findFile(
        vfs.files,
        (path) => path.endsWith(`${checkpointId}.json`) && !path.endsWith("index.json")
      );
      const indexFile = findFile(vfs.files, (path) => path.endsWith("index.json"));

      expect(checkpointFile).not.toBeNull();
      expect(indexFile).not.toBeNull();
      expect(checkpointFile.path).toContain(".agents/runs/run_.._id/checkpoints/");

      const checkpointPayload = JSON.parse(checkpointFile.content);
      expect(checkpointPayload).toEqual(
        expect.objectContaining({
          schemaVersion: "0.1",
          kind: "agent_checkpoint",
          checkpointId,
          runId,
          step: 2,
          iteration: 3,
          messages: [],
          toolCalls: [],
          results: [],
          metadata: {},
        })
      );

      const indexPayload = JSON.parse(indexFile.content);
      expect(indexPayload).toEqual(
        expect.objectContaining({
          schemaVersion: "0.1",
          kind: "agent_checkpoint_index",
          runId,
        })
      );
      expect(indexPayload.checkpoints).toHaveLength(1);
      expect(indexPayload.checkpoints[0]).toEqual(
        expect.objectContaining({
          checkpointId,
          step: 2,
          iteration: 3,
          metadata: {},
        })
      );
    });

    it("rejects missing runId and traversal segments", async () => {
      const vfs = makeMemoryVfs();
      const store = new AgentCheckpointStore({ vfs });

      await expect(store.saveCheckpoint()).rejects.toThrow(/runId is required/i);

      const storeDot = new AgentCheckpointStore({ vfs, runId: "." });
      await expect(storeDot.saveCheckpoint({})).rejects.toThrow(/Invalid path segment/);

      await expect(store.saveCheckpoint({ runId: ".." })).rejects.toThrow(/Invalid path segment/);
    });

    it("falls back when secure id generation fails", async () => {
      const vfs = makeMemoryVfs();
      vi.mocked(makeSecureTimestampedId).mockImplementationOnce(() => {
        throw new Error("nope");
      });

      const store = new AgentCheckpointStore({ vfs, runId: "run_fallback" });
      const { checkpointId } = await store.saveCheckpoint({ messages: [] });

      expect(checkpointId).toMatch(/^ckpt_/);
      expect(loggerMock.warn).toHaveBeenCalledWith(
        expect.stringContaining("Failed to generate secure checkpoint id")
      );
    });

    it("tolerates circular metadata and writes error payload", async () => {
      const vfs = makeMemoryVfs();
      const store = new AgentCheckpointStore({ vfs, runId: "run_circular" });
      const meta = {};
      meta.self = meta;

      const { checkpointId } = await store.saveCheckpoint({ metadata: meta });

      const checkpointFile = findFile(vfs.files, (path) => path.endsWith(`${checkpointId}.json`));
      const payload = JSON.parse(checkpointFile.content);

      expect(payload).toEqual(
        expect.objectContaining({
          error: "json_stringify_failed",
        })
      );
      expect(typeof payload.message).toBe("string");
    });

    it("handles boundary step values with rapid successive saves", async () => {
      const vfs = makeMemoryVfs();
      const store = new AgentCheckpointStore({ vfs, runId: "run_steps" });

      await store.saveCheckpoint({ step: 0, messages: [], metadata: {} });
      await store.saveCheckpoint({ step: -1, messages: [], metadata: {} });
      await store.saveCheckpoint({ step: Number.MAX_SAFE_INTEGER, messages: [], metadata: {} });

      const list = await store.listCheckpoints();
      expect(list.map((entry) => entry.step)).toEqual([0, -1, Number.MAX_SAFE_INTEGER]);
    });

    it("preserves index entries across concurrent saves", async () => {
      const vfs = makeMemoryVfs({ delay: 2 });
      const store = new AgentCheckpointStore({ vfs, runId: "run_concurrent" });

      const results = await Promise.all([
        store.saveCheckpoint({ step: 1 }),
        store.saveCheckpoint({ step: 2 }),
        store.saveCheckpoint({ step: 3 }),
      ]);

      const ids = results.map((res) => res.checkpointId);
      expect(new Set(ids).size).toBe(3);

      const list = await store.listCheckpoints();
      expect(list).toHaveLength(3);
    });
  });

  describe("loadCheckpoint", () => {
    it("returns null when runId is missing", async () => {
      const vfs = makeMemoryVfs();
      const store = new AgentCheckpointStore({ vfs });

      await expect(store.loadCheckpoint()).resolves.toBeNull();
      await expect(store.loadCheckpoint({ runId: "   " })).resolves.toBeNull();
    });

    it("resolves latest, step, and checkpoint modes using readFile bytes", async () => {
      const vfs = makeMemoryVfs({
        supportReadText: false,
        supportWriteText: false,
        readFileMode: "bytes",
      });
      const store = new AgentCheckpointStore({ vfs, runId: "run_load" });

      const first = await store.saveCheckpoint({ step: 1, messages: [], metadata: {} });
      const second = await store.saveCheckpoint({ step: 2, messages: [], metadata: {} });

      const latest = await store.loadCheckpoint();
      expect(latest.checkpointId).toBe(second.checkpointId);
      expect(latest.step).toBe(2);

      const byStep = await store.loadCheckpoint({ step: "1" });
      expect(byStep.checkpointId).toBe(first.checkpointId);
      expect(byStep.step).toBe(1);

      const byId = await store.loadCheckpoint({ checkpointId: second.checkpointId, mode: "checkpoint" });
      expect(byId.checkpointId).toBe(second.checkpointId);

      const missing = await store.loadCheckpoint({ mode: "checkpoint" });
      expect(missing).toBeNull();
    });

    it("roundtrips deep metadata and long strings", async () => {
      const vfs = makeMemoryVfs();
      const store = new AgentCheckpointStore({ vfs, runId: "run_deep" });
      const deep = makeDeepObject(40);
      const longString = "x".repeat(10_000);

      const saved = await store.saveCheckpoint({
        metadata: { deep, longString },
        messages: [],
      });

      const loaded = await store.loadCheckpoint({ checkpointId: saved.checkpointId });
      expect(loaded.metadata.longString).toHaveLength(10_000);

      let node = loaded.metadata.deep;
      for (let i = 0; i < 40; i += 1) {
        expect(node).toHaveProperty("next");
        node = node.next;
      }
    });

    it("returns null and warns for invalid schema or traversal checkpointId", async () => {
      const vfs = makeMemoryVfs();
      vfs.readText.mockResolvedValueOnce(JSON.stringify({ schemaVersion: "0.1" }));

      const customLogger = { warn: vi.fn() };
      const store = new AgentCheckpointStore({ vfs, runId: "run_invalid", logger: customLogger });

      const invalid = await store.loadCheckpoint({ checkpointId: "ckpt_bad" });
      expect(invalid).toBeNull();
      expect(customLogger.warn).toHaveBeenCalledWith(expect.stringContaining("Invalid checkpoint schema"));

      const traversal = await store.loadCheckpoint({ checkpointId: ".." });
      expect(traversal).toBeNull();
      expect(customLogger.warn).toHaveBeenCalledWith(expect.stringContaining("Failed to read checkpoint"));
    });

    it("returns null and warns on read errors", async () => {
      const vfs = makeMemoryVfs();
      vfs.readText.mockRejectedValueOnce(new Error("read failed"));

      const customLogger = { warn: vi.fn() };
      const store = new AgentCheckpointStore({ vfs, runId: "run_readerr", logger: customLogger });

      const result = await store.loadCheckpoint({ checkpointId: "ckpt_missing" });
      expect(result).toBeNull();
      expect(customLogger.warn).toHaveBeenCalledWith(expect.stringContaining("Failed to read checkpoint"));
    });

    it("returns null for oversized payloads", async () => {
      const vfs = makeMemoryVfs();
      vfs.readText.mockResolvedValueOnce("x".repeat(5_000_001));

      const customLogger = { warn: vi.fn() };
      const store = new AgentCheckpointStore({ vfs, runId: "run_big", logger: customLogger });

      const result = await store.loadCheckpoint({ checkpointId: "ckpt_big" });
      expect(result).toBeNull();
      expect(customLogger.warn).toHaveBeenCalledWith(expect.stringContaining("Invalid checkpoint schema"));
    });
  });
});

describe("default export", () => {
  it("matches the named export", () => {
    expect(AgentCheckpointStore).toBe(NamedAgentCheckpointStore);
  });
});
