// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  FakeJSZip,
  mockCreateManifest,
  mockIsPlainObject,
  mockSafeJsonParse,
  mockIsNodeLike,
  MockRunStore,
  RunStoreConstants,
} = vi.hoisted(() => {
  class FakeZipFile {
    constructor(data) {
      this._data = data;
    }

    async async(type) {
      const data = this._data;
      if (type === "string") {
        if (typeof data === "string") return data;
        if (data instanceof Uint8Array) return new TextDecoder().decode(data);
        if (data instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(data));
        if (typeof Blob !== "undefined" && data instanceof Blob) return await data.text();
        return String(data ?? "");
      }
      if (type === "uint8array") {
        if (data instanceof Uint8Array) return data;
        if (data instanceof ArrayBuffer) return new Uint8Array(data);
        if (typeof data === "string") return new TextEncoder().encode(data);
        if (typeof Blob !== "undefined" && data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
        return new TextEncoder().encode(String(data ?? ""));
      }
      return data;
    }
  }

  class FakeJSZip {
    constructor() {
      this._files = new Map();
      this._generateCalls = [];
      FakeJSZip.instances.push(this);
    }

    file(name, data) {
      if (data !== undefined) {
        this._files.set(name, data);
        return this;
      }
      if (!this._files.has(name)) return null;
      return new FakeZipFile(this._files.get(name));
    }

    async generateAsync(options = {}) {
      this._generateCalls.push(options);
      if (options?.type === "blob" && typeof Blob !== "undefined") {
        return new Blob(["fake-zip"]);
      }
      return new Uint8Array([1, 2, 3]);
    }

    static async loadAsync(input) {
      if (input && input.__zipKey && FakeJSZip.zipByKey.has(input.__zipKey)) {
        const zip = FakeJSZip.zipByKey.get(input.__zipKey);
        FakeJSZip.zipByKey.delete(input.__zipKey);
        return zip;
      }
      if (FakeJSZip.loadQueue.length) {
        return FakeJSZip.loadQueue.shift();
      }
      if (FakeJSZip.nextZip) {
        const zip = FakeJSZip.nextZip;
        FakeJSZip.nextZip = null;
        return zip;
      }
      if (input instanceof FakeJSZip) return input;
      return new FakeJSZip();
    }
  }

  FakeJSZip.instances = [];
  FakeJSZip.nextZip = null;
  FakeJSZip.loadQueue = [];
  FakeJSZip.zipByKey = new Map();
  FakeJSZip.reset = () => {
    FakeJSZip.instances = [];
    FakeJSZip.nextZip = null;
    FakeJSZip.loadQueue = [];
    FakeJSZip.zipByKey = new Map();
  };

  const mockCreateManifest = vi.fn((runId) => ({
    schemaVersion: "0.1",
    runId,
    createdAt: "2024-01-01T00:00:00.000Z",
    artifacts: [],
  }));

  const mockIsPlainObject = vi.fn((value) => value && typeof value === "object" && !Array.isArray(value));
  const mockSafeJsonParse = vi.fn((text, opts = {}) => {
    const maxChars = typeof opts.maxChars === "number" ? opts.maxChars : Infinity;
    if (typeof text !== "string" || text.length > maxChars) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  });
  const mockIsNodeLike = vi.fn(() => false);

  class MockRunStore {}

  const RunStoreConstants = {
    STORE_RUNS: "runs",
    STORE_ARTIFACTS: "artifacts",
    STORE_EVENTS: "events",
    STORE_COUNTERS: "counters",
  };

  return {
    FakeJSZip,
    mockCreateManifest,
    mockIsPlainObject,
    mockSafeJsonParse,
    mockIsNodeLike,
    MockRunStore,
    RunStoreConstants,
  };
});

vi.mock("../../../../js/agents/storage/run-store.js", () => ({
  RunStore: MockRunStore,
  RunStoreConstants,
}));

vi.mock("../../../../js/agents/storage/artifact-manager.js", () => ({
  createManifest: mockCreateManifest,
  SUPPORTED_ARTIFACT_TYPES: ["events.jsonl", "report.json", "tool_output.json", "data.bin"],
}));

vi.mock("../../../../js/agents/shared/index.js", () => ({
  isPlainObject: mockIsPlainObject,
  safeJsonParse: mockSafeJsonParse,
  isNodeLike: mockIsNodeLike,
  protoSafeReviver: (_, value) => value,
}));

vi.mock("jszip", () => ({ default: FakeJSZip }));

import { exportRunAsZip, importRunFromZip } from "../../../../js/agents/storage/run-exporter.js";

function makeZip({ manifest, events = "", artifacts = {} }) {
  const zip = new FakeJSZip();
  if (manifest !== undefined) {
    const payload = typeof manifest === "string" ? manifest : JSON.stringify(manifest);
    zip.file("manifest.json", payload);
  }
  if (events !== undefined) {
    zip.file("events.jsonl", events);
  }
  for (const [path, data] of Object.entries(artifacts)) {
    zip.file(path, data);
  }
  return zip;
}

function createFakeDb({ existingRun = null } = {}) {
  const makeRequest = (result) => {
    const req = { result, error: null, onsuccess: null, onerror: null };
    queueMicrotask(() => req.onsuccess && req.onsuccess());
    return req;
  };

  const makeStore = () => {
    const store = {
      puts: [],
      deletes: [],
      getCalls: [],
      put(value) {
        store.puts.push(value);
      },
      delete(key) {
        store.deletes.push(key);
      },
      get(key) {
        store.getCalls.push(key);
        return makeRequest(existingRun && key === existingRun.runId ? existingRun : null);
      },
      index() {
        return { openCursor: () => makeRequest(null) };
      },
    };
    return store;
  };

  const stores = {
    runs: makeStore(),
    artifacts: makeStore(),
    events: makeStore(),
    counters: makeStore(),
  };

  const db = {
    transaction: () => {
      let oncomplete = null;
      const tx = {
        onabort: null,
        onerror: null,
        abort: vi.fn(),
        objectStore: (name) => {
          if (name === RunStoreConstants.STORE_RUNS) return stores.runs;
          if (name === RunStoreConstants.STORE_ARTIFACTS) return stores.artifacts;
          if (name === RunStoreConstants.STORE_EVENTS) return stores.events;
          if (name === RunStoreConstants.STORE_COUNTERS) return stores.counters;
          throw new Error(`Unknown store: ${name}`);
        },
      };
      Object.defineProperty(tx, "oncomplete", {
        get: () => oncomplete,
        set: (handler) => {
          oncomplete = handler;
          if (typeof handler === "function") {
            queueMicrotask(() => handler());
          }
        },
      });
      return tx;
    },
  };

  return { db, stores };
}

let previousIDBKeyRange;
let previousJSZip;

beforeEach(() => {
  FakeJSZip.reset();
  vi.clearAllMocks();
  previousJSZip = globalThis.JSZip;
  globalThis.JSZip = FakeJSZip;
  mockCreateManifest.mockImplementation((runId) => ({
    schemaVersion: "0.1",
    runId,
    createdAt: "2024-01-01T00:00:00.000Z",
    artifacts: [],
  }));
  mockIsPlainObject.mockImplementation((value) => value && typeof value === "object" && !Array.isArray(value));
  mockSafeJsonParse.mockImplementation((text, opts = {}) => {
    const maxChars = typeof opts.maxChars === "number" ? opts.maxChars : Infinity;
    if (typeof text !== "string" || text.length > maxChars) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  });
  mockIsNodeLike.mockReturnValue(false);
  previousIDBKeyRange = globalThis.IDBKeyRange;
  globalThis.IDBKeyRange = { only: vi.fn((value) => ({ key: value })) };
});

afterEach(() => {
  if (previousJSZip === undefined) {
    delete globalThis.JSZip;
  } else {
    globalThis.JSZip = previousJSZip;
  }
  if (previousIDBKeyRange === undefined) {
    delete globalThis.IDBKeyRange;
  } else {
    globalThis.IDBKeyRange = previousIDBKeyRange;
  }
  vi.restoreAllMocks();
});

describe("exportRunAsZip", () => {
  it("builds zip with normalized manifest, runContext, and sanitized zip paths", async () => {
    const runId = "run-1";
    const runStore = {
      getManifest: vi.fn().mockResolvedValue({
        runId: "wrong",
        createdAt: "2024-01-01T00:00:00.000Z",
        artifacts: [
          { artifactId: "a-1", type: "report.json", storageKey: `runs/${runId}/report.json`, zipPath: "reports/report.json", seq: 2 },
          { artifactId: "a-dup", type: "tool_output.json", storageKey: `runs/${runId}/tool_output.json`, zipPath: "reports/report.json", seq: 1 },
          { artifactId: "a-bad", type: "data.bin", storageKey: `runs/${runId}/data.bin`, zipPath: "../bad\\path", seq: 3 },
        ],
      }),
      listArtifacts: vi.fn().mockResolvedValue([
        { artifactId: "a-1", type: "report.json", storageKey: `runs/${runId}/report.json`, mime: "application/json", bytes: 5 },
        { artifactId: "a-extra", type: "tool_output.json", storageKey: `runs/${runId}/tool_output.json`, createdAt: "2024-01-01T00:00:01.000Z", seq: 5 },
        { artifactId: "unsupported", type: "unsupported.json", storageKey: `runs/${runId}/unsupported.json` },
      ]),
      getRun: vi.fn().mockResolvedValue({ runId, mode: "debug", constraints: { limit: 1 } }),
      getArtifactById: vi.fn((id) => {
        if (id === "a-1") return { ok: true };
        if (id === "a-extra") return "extra";
        return null;
      }),
      getArtifact: vi.fn((_, type) => {
        if (type === "events.jsonl") return '{"eventId":"e1"}\n';
        if (type === "tool_output.json") return ["fallback"];
        if (type === "data.bin") return new Uint8Array([9, 9]);
        return null;
      }),
    };

    const result = await exportRunAsZip(runId, { runStore });

    expect(result).toBeInstanceOf(Blob);

    const zip = FakeJSZip.instances[0];
    const manifest = JSON.parse(zip._files.get("manifest.json"));

    expect(manifest.runId).toBe(runId);
    expect(manifest.runContext).toEqual(expect.objectContaining({ runId, mode: "debug" }));
    expect(manifest.artifacts.some((a) => a.type === "events.jsonl")).toBe(true);
    expect(manifest.artifacts.find((a) => a.artifactId === "unsupported")).toBeUndefined();

    const a1 = manifest.artifacts.find((a) => a.artifactId === "a-1");
    const aDup = manifest.artifacts.find((a) => a.artifactId === "a-dup");
    expect(new Set([a1.zipPath, aDup.zipPath])).toEqual(new Set(["reports/report.json", "reports/report.json_2"]));

    const aBad = manifest.artifacts.find((a) => a.artifactId === "a-bad");
    expect(aBad.zipPath).toBe("artifacts/a-bad");

    expect(zip._files.has("reports/report.json")).toBe(true);
    expect(zip._files.has("reports/report.json_2")).toBe(true);
    expect(zip._files.has("artifacts/a-bad")).toBe(true);
    expect(zip._files.has("events.jsonl")).toBe(true);

    expect(runStore.getArtifactById).toHaveBeenCalledWith("a-1");
    expect(runStore.getArtifact).toHaveBeenCalledWith(runId, "events.jsonl");
  });

  it("writes artifacts across data types, skips null payloads, and serializes objects", async () => {
    const runId = "run-edge";
    const longString = "x".repeat(10_000);
    const deepNested = { level1: { level2: { level3: { arr: [1, { a: "b" }] } } } };
    const arrayBuffer = new Uint8Array([1, 2, 3]).buffer;

    const runStore = {
      getManifest: vi.fn().mockResolvedValue({
        runId,
        artifacts: [
          { artifactId: "a-str", type: "report.json", storageKey: "runs/run-edge/report.json", zipPath: "artifacts/a-str" },
          { artifactId: "a-blob", type: "tool_output.json", storageKey: "runs/run-edge/tool_output.json", zipPath: "artifacts/a-blob" },
          { artifactId: "a-ab", type: "data.bin", storageKey: "runs/run-edge/data.bin", zipPath: "artifacts/a-ab" },
          { artifactId: "a-nested", type: "tool_output.json", storageKey: "runs/run-edge/tool_output.json", zipPath: "artifacts/a-nested" },
          { artifactId: "a-num", type: "tool_output.json", storageKey: "runs/run-edge/tool_output.json", zipPath: "artifacts/a-num" },
          { artifactId: "a-null", type: "report.json", storageKey: "runs/run-edge/report.json", zipPath: "artifacts/a-null" },
        ],
      }),
      listArtifacts: vi.fn().mockResolvedValue([]),
      getRun: vi.fn().mockResolvedValue(null),
      getArtifactById: vi.fn((id) => {
        if (id === "a-str") return longString;
        if (id === "a-blob") return new Blob(["blob"]);
        if (id === "a-ab") return arrayBuffer;
        if (id === "a-nested") return deepNested;
        if (id === "a-num") return 42;
        if (id === "a-null") return null;
        return undefined;
      }),
      getArtifact: vi.fn((_, type) => (type === "events.jsonl" ? "" : null)),
    };

    await exportRunAsZip(runId, { runStore });

    const zip = FakeJSZip.instances[0];
    expect(zip._files.get("artifacts/a-str")).toBe(longString);
    expect(zip._files.get("artifacts/a-blob")).toBeInstanceOf(Blob);
    expect(zip._files.get("artifacts/a-ab")).toBeInstanceOf(ArrayBuffer);
    expect(JSON.parse(zip._files.get("artifacts/a-nested"))).toEqual(deepNested);
    expect(zip._files.get("artifacts/a-num")).toBe("42");
    expect(zip._files.has("artifacts/a-null")).toBe(false);
  });

  it("continues when listArtifacts/getRun fail and events payload is null", async () => {
    const runId = "run-empty";
    const runStore = {
      getManifest: vi.fn().mockResolvedValue(null),
      listArtifacts: vi.fn().mockRejectedValue(new Error("boom")),
      getRun: vi.fn().mockRejectedValue(new Error("nope")),
      getArtifact: vi.fn().mockResolvedValue(null),
    };

    await exportRunAsZip(runId, { runStore });

    const zip = FakeJSZip.instances[0];
    const manifest = JSON.parse(zip._files.get("manifest.json"));
    expect(manifest.runId).toBe(runId);
    expect(manifest.runContext).toBeUndefined();
    expect(zip._files.get("events.jsonl")).toBe("");
    expect(mockCreateManifest).toHaveBeenCalledWith(runId);
  });

  it("returns nodebuffer results when node-like and supports concurrent and sequential calls", async () => {
    mockIsNodeLike.mockReturnValue(true);
    const runStore = {
      getManifest: vi.fn().mockResolvedValue({ runId: "run-node", artifacts: [] }),
      listArtifacts: vi.fn().mockResolvedValue([]),
      getArtifact: vi.fn().mockResolvedValue(""),
    };

    const nodeResult = await exportRunAsZip("run-node", { runStore });
    const nodeZip = FakeJSZip.instances[0];
    expect(nodeResult).toBeInstanceOf(Blob);
    expect(nodeZip._generateCalls[0].type).toBe("nodebuffer");

    mockIsNodeLike.mockReturnValue(false);
    const runStoreA = {
      getManifest: vi.fn().mockResolvedValue({ runId: "run-a", artifacts: [] }),
      listArtifacts: vi.fn().mockResolvedValue([]),
      getArtifact: vi.fn().mockResolvedValue(""),
    };
    const runStoreB = {
      getManifest: vi.fn().mockResolvedValue({ runId: "run-b", artifacts: [] }),
      listArtifacts: vi.fn().mockResolvedValue([]),
      getArtifact: vi.fn().mockResolvedValue(""),
    };

    const [resA, resB] = await Promise.all([
      exportRunAsZip("run-a", { runStore: runStoreA }),
      exportRunAsZip("run-b", { runStore: runStoreB }),
    ]);
    expect(resA).toBeInstanceOf(Blob);
    expect(resB).toBeInstanceOf(Blob);
    expect(FakeJSZip.instances).toHaveLength(3);

    await exportRunAsZip("run-c", {
      runStore: {
        getManifest: vi.fn().mockResolvedValue({ runId: "run-c", artifacts: [] }),
        listArtifacts: vi.fn().mockResolvedValue([]),
        getArtifact: vi.fn().mockResolvedValue(""),
      },
    });
    expect(FakeJSZip.instances).toHaveLength(4);
  });
});

describe("importRunFromZip", () => {
  it("imports a run with events and artifacts (non-atomic path)", async () => {
    const runId = "run-1";
    const runStore = {
      storage: {},
      getRun: vi.fn().mockResolvedValue(null),
      deleteRun: vi.fn().mockResolvedValue(),
      createRun: vi.fn().mockResolvedValue(),
      appendEvents: vi.fn().mockResolvedValue(),
      saveArtifact: vi.fn().mockResolvedValue(),
      updateManifest: vi.fn().mockResolvedValue(),
    };

    const manifest = {
      runId,
      createdAt: "2024-01-02T00:00:00.000Z",
      runContext: { schemaVersion: "0.2", mode: "custom", constraints: { max: 1 }, startedAt: "2024-01-02T00:00:00.000Z" },
      artifacts: [
        { artifactId: "a-1", type: "report.json", zipPath: "artifacts/a-1", mime: "application/json", storageKey: `runs/${runId}/report.json`, seq: 2, bytes: 0 },
        { artifactId: "art_run-1_data.bin_005", type: "data.bin", zipPath: "artifacts/a-2", storageKey: `runs/${runId}/data.bin`, seq: 0, bytes: -1 },
      ],
    };

    const zip = makeZip({
      manifest,
      events: '{"eventId":"e1","runId":"run-1"}\nINVALID\n{"eventId":"e2","runId":"run-1"}\n',
      artifacts: {
        "artifacts/a-1": '{"score":42}',
        "artifacts/a-2": new Uint8Array([1, 2, 3]),
      },
    });
    FakeJSZip.nextZip = zip;

    const resultId = await importRunFromZip(new Uint8Array([1, 2, 3]), { runStore });

    expect(resultId).toBe(runId);
    expect(runStore.createRun).toHaveBeenCalledWith(expect.objectContaining({ runId, mode: "custom", constraints: { max: 1 } }));

    const eventsBatch = runStore.appendEvents.mock.calls[0][1];
    expect(eventsBatch).toHaveLength(2);

    const reportCall = runStore.saveArtifact.mock.calls.find((call) => call[1] === "report.json");
    expect(reportCall[2]).toEqual({ score: 42 });
    expect(reportCall[3].seq).toBe(2);
    expect(reportCall[3].bytes).toBe(0);

    const binCall = runStore.saveArtifact.mock.calls.find((call) => call[1] === "data.bin");
    expect(binCall[3].seq).toBe(5);
    expect(binCall[3].bytes).toBeUndefined();

    expect(runStore.updateManifest).toHaveBeenCalledWith(runId, manifest);
  });

  it("throws when overwrite=false and run already exists", async () => {
    const runStore = {
      storage: {},
      getRun: vi.fn().mockResolvedValue({ runId: "run-exists" }),
      deleteRun: vi.fn(),
      createRun: vi.fn(),
      appendEvents: vi.fn(),
      saveArtifact: vi.fn(),
      updateManifest: vi.fn(),
    };

    const zip = makeZip({
      manifest: { runId: "run-exists", artifacts: [] },
      events: "",
    });
    FakeJSZip.nextZip = zip;

    await expect(importRunFromZip(new Uint8Array([1]), { runStore, overwrite: false })).rejects.toThrow(/run already exists/);
    expect(runStore.createRun).not.toHaveBeenCalled();
  });

  it("throws when manifest.json is missing", async () => {
    const runStore = { storage: {} };
    const zip = makeZip({ events: "" });
    FakeJSZip.nextZip = zip;

    await expect(importRunFromZip(new Uint8Array([1]), { runStore })).rejects.toThrow(/missing manifest\.json/);
  });

  it("throws when manifest.json is invalid JSON", async () => {
    const runStore = { storage: {} };
    const zip = makeZip({ manifest: "{not valid json}", events: "" });
    FakeJSZip.nextZip = zip;

    await expect(importRunFromZip(new Uint8Array([1]), { runStore })).rejects.toThrow(/invalid or oversized manifest\.json/);
  });

  it("throws when manifest.json exceeds max size", async () => {
    const runStore = { storage: {} };
    const longValue = "a".repeat(1_000_001);
    const zip = makeZip({
      manifest: JSON.stringify({ runId: "run-long", payload: longValue }),
      events: "",
    });
    FakeJSZip.nextZip = zip;

    await expect(importRunFromZip(new Uint8Array([1]), { runStore })).rejects.toThrow(/invalid or oversized manifest\.json/);
  });

  it("rejects duplicate artifactId entries during validation", async () => {
    const runStore = { storage: {} };
    const manifest = {
      runId: "run-dup",
      artifacts: [
        { artifactId: "dup", type: "report.json", zipPath: "artifacts/dup", storageKey: "runs/run-dup/report.json" },
        { artifactId: "dup", type: "report.json", zipPath: "artifacts/dup2", storageKey: "runs/run-dup/report.json" },
      ],
    };
    const zip = makeZip({
      manifest,
      events: "",
      artifacts: { "artifacts/dup": '{"ok":true}', "artifacts/dup2": '{"ok":false}' },
    });
    FakeJSZip.nextZip = zip;

    await expect(importRunFromZip(new Uint8Array([1]), { runStore })).rejects.toThrow(/duplicate artifactId/);
  });

  it("rejects missing artifact payloads in the zip", async () => {
    const runStore = { storage: {} };
    const manifest = {
      runId: "run-missing",
      artifacts: [{ artifactId: "a1", type: "report.json", zipPath: "artifacts/a1", storageKey: "runs/run-missing/report.json" }],
    };
    const zip = makeZip({ manifest, events: "" });
    FakeJSZip.nextZip = zip;

    await expect(importRunFromZip(new Uint8Array([1]), { runStore })).rejects.toThrow(/missing artifact payload/);
  });

  it("throws when manifest.runId is empty or whitespace", async () => {
    const runStore = { storage: {} };
    const zip = makeZip({ manifest: { runId: "   ", artifacts: [] }, events: "" });
    FakeJSZip.nextZip = zip;

    await expect(importRunFromZip(new Uint8Array([1]), { runStore })).rejects.toThrow(/runId must be a non-empty string/);
  });

  it("handles non-array artifacts and empty events", async () => {
    const runStore = {
      storage: {},
      getRun: vi.fn().mockResolvedValue(null),
      deleteRun: vi.fn().mockResolvedValue(),
      createRun: vi.fn().mockResolvedValue(),
      appendEvents: vi.fn().mockResolvedValue(),
      saveArtifact: vi.fn().mockResolvedValue(),
      updateManifest: vi.fn().mockResolvedValue(),
    };
    const manifest = { runId: "run-empty", artifacts: {}, runContext: {} };
    const zip = makeZip({ manifest });
    FakeJSZip.nextZip = zip;

    const resultId = await importRunFromZip(new Uint8Array([1]), { runStore });
    expect(resultId).toBe("run-empty");
    expect(runStore.appendEvents).not.toHaveBeenCalled();
    expect(runStore.saveArtifact).not.toHaveBeenCalled();
  });

  it("rejects oversized zip inputs before load", async () => {
    const runStore = { storage: {} };
    const bigInput = { byteLength: 256 * 1024 * 1024 + 1 };
    const file = { arrayBuffer: vi.fn().mockResolvedValue(bigInput) };

    await expect(importRunFromZip(file, { runStore })).rejects.toThrow(/zip file too large/);
  });

  it("imports via IndexedDB transaction and updates counters (atomic path)", async () => {
    const { db, stores } = createFakeDb();
    const runId = "run-atomic";
    const runStore = { open: vi.fn().mockResolvedValue(db) };

    const manifest = {
      runId,
      createdAt: "2024-01-03T00:00:00.000Z",
      artifacts: [
        { artifactId: "a1", type: "report.json", zipPath: "artifacts/a1", storageKey: `runs/${runId}/report.json`, seq: 1, bytes: "9" },
        { artifactId: "a2", type: "report.json", zipPath: "artifacts/a2", storageKey: `runs/${runId}/report.json`, seq: Number.MAX_SAFE_INTEGER },
      ],
    };

    const zip = makeZip({
      manifest,
      events: '{"eventId":"e1","runId":"other"}\n{"eventId":"e2","runId":"run-atomic"}\n',
      artifacts: {
        "artifacts/a1": '{"nested":{"a":1}}',
        "artifacts/a2": '{"n":2}',
      },
    });
    FakeJSZip.nextZip = zip;

    const resultId = await importRunFromZip(new Uint8Array([1]), { runStore });

    expect(resultId).toBe(runId);
    expect(stores.runs.puts).toHaveLength(1);
    expect(stores.events.puts).toHaveLength(2);
    expect(stores.events.puts[0].runId).toBe(runId);
    expect(stores.artifacts.puts).toHaveLength(2);
    expect(stores.counters.puts.find((entry) => entry.type === "report.json").lastSeq).toBe(Number.MAX_SAFE_INTEGER);

    const expectedBytes = new TextEncoder().encode('{"nested":{"a":1}}').byteLength;
    const a1 = stores.artifacts.puts.find((entry) => entry.artifactId === "a1");
    expect(a1.bytes).toBe(expectedBytes);
  });

  it("supports concurrent imports without shared state", async () => {
    const runStoreA = {
      storage: {},
      getRun: vi.fn().mockResolvedValue(null),
      deleteRun: vi.fn().mockResolvedValue(),
      createRun: vi.fn().mockResolvedValue(),
      appendEvents: vi.fn().mockResolvedValue(),
      saveArtifact: vi.fn().mockResolvedValue(),
      updateManifest: vi.fn().mockResolvedValue(),
    };
    const runStoreB = {
      storage: {},
      getRun: vi.fn().mockResolvedValue(null),
      deleteRun: vi.fn().mockResolvedValue(),
      createRun: vi.fn().mockResolvedValue(),
      appendEvents: vi.fn().mockResolvedValue(),
      saveArtifact: vi.fn().mockResolvedValue(),
      updateManifest: vi.fn().mockResolvedValue(),
    };

    const zipA = makeZip({ manifest: { runId: "run-a", artifacts: [] }, events: "" });
    const zipB = makeZip({ manifest: { runId: "run-b", artifacts: [] }, events: "" });
    FakeJSZip.zipByKey.set("zip-a", zipA);
    FakeJSZip.zipByKey.set("zip-b", zipB);

    const fileA = { arrayBuffer: vi.fn().mockResolvedValue({ byteLength: 1, __zipKey: "zip-a" }) };
    const fileB = { arrayBuffer: vi.fn().mockResolvedValue({ byteLength: 1, __zipKey: "zip-b" }) };

    const [idA, idB] = await Promise.all([
      importRunFromZip(fileA, { runStore: runStoreA }),
      importRunFromZip(fileB, { runStore: runStoreB }),
    ]);

    expect(idA).toBe("run-a");
    expect(idB).toBe("run-b");
    expect(runStoreA.createRun).toHaveBeenCalled();
    expect(runStoreB.createRun).toHaveBeenCalled();
  });
});
