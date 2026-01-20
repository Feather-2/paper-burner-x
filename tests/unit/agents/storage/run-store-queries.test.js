import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const sharedMocks = vi.hoisted(() => ({
  safeJsonParse: vi.fn(),
}));

const utilsMocks = vi.hoisted(() => ({
  STORE_RUNS: "runs",
  STORE_ARTIFACTS: "artifacts",
  STORE_EVENTS: "events",
  getLastByCompoundIndex: vi.fn(),
  logger: { warn: vi.fn() },
  promisifyRequest: vi.fn(),
  promisifyTransaction: vi.fn(),
}));

vi.mock("../../../../js/agents/shared/index.js", () => ({
  safeJsonParse: sharedMocks.safeJsonParse,
}));

vi.mock("../../../../js/agents/storage/run-store-utils.js", () => ({
  STORE_RUNS: utilsMocks.STORE_RUNS,
  STORE_ARTIFACTS: utilsMocks.STORE_ARTIFACTS,
  STORE_EVENTS: utilsMocks.STORE_EVENTS,
  getLastByCompoundIndex: utilsMocks.getLastByCompoundIndex,
  logger: utilsMocks.logger,
  promisifyRequest: utilsMocks.promisifyRequest,
  promisifyTransaction: utilsMocks.promisifyTransaction,
}));

import {
  loadTask,
  loadState,
  listRunRecords,
  listRuns,
  getRun,
  getEvents,
  getArtifact,
} from "../../../../js/agents/storage/run-store-queries.js";

const schedule = typeof queueMicrotask === "function" ? queueMicrotask : (fn) => Promise.resolve().then(fn);

function makeCursorRequest(values, { error } = {}) {
  const req = {
    result: null,
    error: error || null,
    onsuccess: null,
    onerror: null,
  };
  let index = 0;

  const trigger = () => {
    if (error) {
      if (req.onerror) req.onerror();
      return;
    }
    if (!req.onsuccess) return;
    if (index >= values.length) {
      req.result = null;
      req.onsuccess();
      return;
    }
    const value = values[index];
    const cursor = {
      value,
      continue: () => {
        index += 1;
        schedule(trigger);
      },
    };
    req.result = cursor;
    req.onsuccess();
  };

  schedule(trigger);
  return req;
}

function makeDeepObject(depth) {
  let current = { leaf: "value" };
  for (let i = 0; i < depth; i += 1) {
    current = { level: i, next: current };
  }
  return current;
}

beforeEach(() => {
  sharedMocks.safeJsonParse.mockImplementation((value) => (typeof value === "string" ? JSON.parse(value) : value));
  utilsMocks.promisifyRequest.mockImplementation((req) => {
    if (!req) return Promise.resolve(undefined);
    if (req.__reject) return Promise.reject(req.__reject);
    return Promise.resolve(req.__result);
  });
  utilsMocks.promisifyTransaction.mockResolvedValue(undefined);
  utilsMocks.getLastByCompoundIndex.mockResolvedValue(null);
  utilsMocks.logger.warn.mockImplementation(() => {});

  vi.stubGlobal("IDBKeyRange", {
    bound: vi.fn((lower, upper) => ({ lower, upper })),
    only: vi.fn((value) => ({ value })),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe("loadTask", () => {
  it("throws for non-string or empty taskId values", async () => {
    const invalid = [null, undefined, "", 0, -1, Number.MAX_SAFE_INTEGER, {}, []];
    for (const value of invalid) {
      await expect(loadTask.call({}, value)).rejects.toThrow(/taskId must be a string/i);
    }
  });

  it("uses storage adapter, parses JSON, and handles empty payload", async () => {
    const storage = {
      get: vi
        .fn()
        .mockResolvedValueOnce('{"ok":true}')
        .mockResolvedValueOnce("")
        .mockResolvedValueOnce(null),
    };
    const ctx = {
      storage,
      _keyForTask: vi.fn((taskId) => `task:${taskId}`),
    };

    await expect(loadTask.call(ctx, "task_1")).resolves.toEqual({ ok: true });
    await expect(loadTask.call(ctx, "task_2")).resolves.toBeNull();
    await expect(loadTask.call(ctx, "task_3")).resolves.toBeNull();

    expect(ctx._keyForTask).toHaveBeenCalledWith("task_1");
    expect(sharedMocks.safeJsonParse).toHaveBeenCalledWith('{"ok":true}', null);
  });

  it("uses getArtifact when no storage and supports concurrent calls with large/deep payloads", async () => {
    const deep = makeDeepObject(20);
    const longText = "x".repeat(200000);
    const dataMap = new Map([
      ["task_deep", JSON.stringify({ deep })],
      ["task_obj", { empty: {} }],
      ["task_long", JSON.stringify({ text: longText })],
      ["missing", null],
    ]);

    const ctx = {
      getArtifact: vi.fn(async (taskId) => dataMap.get(taskId)),
    };

    const [deepResult, objResult, longResult, missing] = await Promise.all([
      loadTask.call(ctx, "task_deep"),
      loadTask.call(ctx, "task_obj"),
      loadTask.call(ctx, "task_long"),
      loadTask.call(ctx, "missing"),
    ]);

    expect(deepResult).toEqual({ deep });
    expect(objResult).toEqual({ empty: {} });
    expect(longResult.text).toHaveLength(longText.length);
    expect(missing).toBeNull();
    expect(ctx.getArtifact).toHaveBeenCalledTimes(4);
  });
});

describe("loadState", () => {
  it("throws for non-string or empty runId values", async () => {
    const invalid = [null, undefined, "", 0, -1, Number.MAX_SAFE_INTEGER, {}, []];
    for (const value of invalid) {
      await expect(loadState.call({}, value)).rejects.toThrow(/runId must be a string/i);
    }
  });

  it("uses storage adapter and safeJsonParse", async () => {
    const storage = {
      get: vi
        .fn()
        .mockResolvedValueOnce('{"state":true}')
        .mockResolvedValueOnce(undefined),
    };
    const ctx = {
      storage,
      _keyForState: vi.fn((runId) => `state:${runId}`),
    };

    await expect(loadState.call(ctx, "run_1")).resolves.toEqual({ state: true });
    await expect(loadState.call(ctx, "run_2")).resolves.toBeNull();

    expect(ctx._keyForState).toHaveBeenCalledWith("run_1");
    expect(sharedMocks.safeJsonParse).toHaveBeenCalledWith('{"state":true}', null);
  });

  it("falls back to getArtifact and supports rapid successive calls", async () => {
    const ctx = {
      getArtifact: vi
        .fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce('{"nested":{"ok":true}}')
        .mockResolvedValueOnce(null),
    };

    await expect(loadState.call(ctx, "run_1")).resolves.toEqual({});
    await expect(loadState.call(ctx, "run_2")).resolves.toEqual({ nested: { ok: true } });
    await expect(loadState.call(ctx, "run_3")).resolves.toBeNull();
    expect(ctx.getArtifact).toHaveBeenCalledTimes(3);
  });
});

describe("listRunRecords", () => {
  it("returns empty array when storage adapter is present", async () => {
    const ctx = { storage: { get: vi.fn() }, open: vi.fn() };
    await expect(listRunRecords.call(ctx)).resolves.toEqual([]);
    expect(ctx.open).not.toHaveBeenCalled();
  });

  it("iterates cursor values, respects includeContext, and converts fields to strings", async () => {
    const values = [
      { runId: "r1", createdAt: 2, updatedAt: 3, manifest: { ok: true }, runContext: { a: 1 } },
      "skip",
      { runId: 0, createdAt: "", updatedAt: null, runContext: { b: 2 } },
    ];

    const index = {
      openCursor: vi.fn(() => makeCursorRequest(values)),
    };
    const store = {
      index: vi.fn(() => index),
    };
    const tx = {
      objectStore: vi.fn(() => store),
    };
    const db = {
      transaction: vi.fn(() => tx),
    };
    const ctx = { open: vi.fn(async () => db) };

    const rows = await listRunRecords.call(ctx);

    expect(db.transaction).toHaveBeenCalledWith(["runs"], "readonly");
    expect(index.openCursor).toHaveBeenCalledWith(null, "prev");
    expect(rows).toEqual([
      { runId: "r1", createdAt: "2", updatedAt: "3", manifest: { ok: true } },
      { runId: "0", createdAt: "", updatedAt: "", manifest: null },
    ]);
  });

  it("supports includeContext and ascending order", async () => {
    const values = [{ runId: "a", createdAt: "2023", updatedAt: "2024", runContext: { ok: true } }];
    const index = {
      openCursor: vi.fn(() => makeCursorRequest(values)),
    };
    const store = {
      index: vi.fn(() => index),
    };
    const tx = {
      objectStore: vi.fn(() => store),
    };
    const db = {
      transaction: vi.fn(() => tx),
    };
    const ctx = { open: vi.fn(async () => db) };

    const rows = await listRunRecords.call(ctx, { order: "asc", includeContext: true });

    expect(index.openCursor).toHaveBeenCalledWith(null, "next");
    expect(rows).toEqual([
      { runId: "a", createdAt: "2023", updatedAt: "2024", manifest: null, runContext: { ok: true } },
    ]);
  });

  it("propagates cursor errors", async () => {
    const error = new Error("cursor failed");
    const index = {
      openCursor: vi.fn(() => makeCursorRequest([], { error })),
    };
    const store = {
      index: vi.fn(() => index),
    };
    const tx = {
      objectStore: vi.fn(() => store),
    };
    const db = {
      transaction: vi.fn(() => tx),
    };
    const ctx = { open: vi.fn(async () => db) };

    await expect(listRunRecords.call(ctx)).rejects.toThrow(/cursor failed/i);
  });
});

describe("listRuns", () => {
  it("returns runContexts sorted by createdAt desc", async () => {
    const rows = [
      { createdAt: "2023-01-01", runContext: { id: "a" } },
      { createdAt: "2024-01-01", runContext: { id: "b" } },
      { createdAt: null, runContext: { id: "c" } },
    ];
    const store = {
      getAll: vi.fn(() => ({ __result: rows })),
    };
    const tx = {
      objectStore: vi.fn(() => store),
    };
    const db = {
      transaction: vi.fn(() => tx),
    };
    const ctx = { open: vi.fn(async () => db) };

    const result = await listRuns.call(ctx);

    expect(result).toEqual([{ id: "b" }, { id: "a" }, { id: "c" }]);
  });

  it("returns [] for null or empty results", async () => {
    const store = {
      getAll: vi.fn(() => ({ __result: null })),
    };
    const tx = {
      objectStore: vi.fn(() => store),
    };
    const db = {
      transaction: vi.fn(() => tx),
    };
    const ctx = { open: vi.fn(async () => db) };

    await expect(listRuns.call(ctx)).resolves.toEqual([]);

    store.getAll.mockReturnValueOnce({ __result: [] });
    await expect(listRuns.call(ctx)).resolves.toEqual([]);
  });

  it("throws when IndexedDB returns non-array (object as array)", async () => {
    const store = {
      getAll: vi.fn(() => ({ __result: { not: "array" } })),
    };
    const tx = {
      objectStore: vi.fn(() => store),
    };
    const db = {
      transaction: vi.fn(() => tx),
    };
    const ctx = { open: vi.fn(async () => db) };

    await expect(listRuns.call(ctx)).rejects.toThrow(/slice is not a function/i);
  });

  it("supports concurrent calls", async () => {
    const rows = [
      { createdAt: "2022", runContext: { id: "x" } },
      { createdAt: "2021", runContext: { id: "y" } },
    ];
    const store = {
      getAll: vi.fn(() => ({ __result: rows })),
    };
    const tx = {
      objectStore: vi.fn(() => store),
    };
    const db = {
      transaction: vi.fn(() => tx),
    };
    const ctx = { open: vi.fn(async () => db) };

    const [first, second] = await Promise.all([listRuns.call(ctx), listRuns.call(ctx)]);

    expect(first).toEqual([{ id: "x" }, { id: "y" }]);
    expect(second).toEqual([{ id: "x" }, { id: "y" }]);
    expect(utilsMocks.promisifyRequest).toHaveBeenCalledTimes(2);
  });
});

describe("getRun", () => {
  it("returns runContext or null", async () => {
    const store = {
      get: vi.fn(() => ({ __result: { runContext: { id: "r1" } } })),
    };
    const tx = {
      objectStore: vi.fn(() => store),
    };
    const db = {
      transaction: vi.fn(() => tx),
    };
    const ctx = { open: vi.fn(async () => db) };

    await expect(getRun.call(ctx, "r1")).resolves.toEqual({ id: "r1" });

    store.get.mockReturnValueOnce({ __result: null });
    await expect(getRun.call(ctx, "r2")).resolves.toBeNull();
  });

  it("passes through numeric string runId and handles empty record", async () => {
    const store = {
      get: vi.fn(() => ({ __result: {} })),
    };
    const tx = {
      objectStore: vi.fn(() => store),
    };
    const db = {
      transaction: vi.fn(() => tx),
    };
    const ctx = { open: vi.fn(async () => db) };

    const result = await getRun.call(ctx, "123");

    expect(store.get).toHaveBeenCalledWith("123");
    expect(result).toBeUndefined();
  });

  it("propagates request errors", async () => {
    const store = {
      get: vi.fn(() => ({ __reject: new Error("get failed") })),
    };
    const tx = {
      objectStore: vi.fn(() => store),
    };
    const db = {
      transaction: vi.fn(() => tx),
    };
    const ctx = { open: vi.fn(async () => db) };

    await expect(getRun.call(ctx, "r1")).rejects.toThrow(/get failed/i);
  });
});

describe("getEvents", () => {
  it("builds IDBKeyRange and returns events", async () => {
    const events = [{ id: 1 }, { id: 2 }];
    const index = {
      getAll: vi.fn((range) => ({ __result: range && events })),
    };
    const store = {
      index: vi.fn(() => index),
    };
    const tx = {
      objectStore: vi.fn(() => store),
    };
    const db = {
      transaction: vi.fn(() => tx),
    };
    const ctx = { open: vi.fn(async () => db) };

    const result = await getEvents.call(ctx, "run_1");

    expect(globalThis.IDBKeyRange.bound).toHaveBeenCalledWith(["run_1", ""], ["run_1", "\uffff"]);
    expect(index.getAll).toHaveBeenCalledWith({ lower: ["run_1", ""], upper: ["run_1", "\uffff"] });
    expect(result).toEqual(events);
  });

  it("returns [] when no events are found", async () => {
    const index = {
      getAll: vi.fn(() => ({ __result: null })),
    };
    const store = {
      index: vi.fn(() => index),
    };
    const tx = {
      objectStore: vi.fn(() => store),
    };
    const db = {
      transaction: vi.fn(() => tx),
    };
    const ctx = { open: vi.fn(async () => db) };

    await expect(getEvents.call(ctx, "run_empty")).resolves.toEqual([]);
  });

  it("handles concurrent calls with numeric boundary runIds", async () => {
    const index = {
      getAll: vi.fn(() => ({ __result: [] })),
    };
    const store = {
      index: vi.fn(() => index),
    };
    const tx = {
      objectStore: vi.fn(() => store),
    };
    const db = {
      transaction: vi.fn(() => tx),
    };
    const ctx = { open: vi.fn(async () => db) };

    const runIds = [0, -1, Number.MAX_SAFE_INTEGER];
    await Promise.all(runIds.map((id) => getEvents.call(ctx, id)));

    expect(globalThis.IDBKeyRange.bound).toHaveBeenCalledWith([0, ""], [0, "\uffff"]);
    expect(globalThis.IDBKeyRange.bound).toHaveBeenCalledWith([-1, ""], [-1, "\uffff"]);
    expect(globalThis.IDBKeyRange.bound).toHaveBeenCalledWith([Number.MAX_SAFE_INTEGER, ""], [Number.MAX_SAFE_INTEGER, "\uffff"]);
  });

  it("propagates request errors", async () => {
    const index = {
      getAll: vi.fn(() => ({ __reject: new Error("events failed") })),
    };
    const store = {
      index: vi.fn(() => index),
    };
    const tx = {
      objectStore: vi.fn(() => store),
    };
    const db = {
      transaction: vi.fn(() => tx),
    };
    const ctx = { open: vi.fn(async () => db) };

    await expect(getEvents.call(ctx, "run_err")).rejects.toThrow(/events failed/i);
  });
});

describe("getArtifact", () => {
  it("uses storage adapter when available", async () => {
    const storage = {
      get: vi.fn(async (key) => `value:${key}`),
    };
    const ctx = {
      storage,
      _keyForArtifact: vi.fn((runId, type) => `artifact:${runId}:${type}`),
    };

    const result = await getArtifact.call(ctx, "run_1", "plan.json");

    expect(ctx._keyForArtifact).toHaveBeenCalledWith("run_1", "plan.json");
    expect(result).toBe("value:artifact:run_1:plan.json");
    expect(utilsMocks.getLastByCompoundIndex).not.toHaveBeenCalled();
  });

  it("returns latest artifact data from IndexedDB and supports large payloads", async () => {
    const largePayload = "x".repeat(1000000);
    utilsMocks.getLastByCompoundIndex.mockResolvedValueOnce({ data: largePayload });

    const store = {};
    const tx = {
      objectStore: vi.fn(() => store),
    };
    const db = {
      transaction: vi.fn(() => tx),
    };
    const ctx = { open: vi.fn(async () => db) };

    const result = await getArtifact.call(ctx, "run_big", "file.bin");

    expect(globalThis.IDBKeyRange.bound).toHaveBeenCalledWith(["run_big", "file.bin", 0], ["run_big", "file.bin", Number.MAX_SAFE_INTEGER]);
    expect(utilsMocks.getLastByCompoundIndex).toHaveBeenCalledWith(store, "byRunIdTypeSeq", {
      lower: ["run_big", "file.bin", 0],
      upper: ["run_big", "file.bin", Number.MAX_SAFE_INTEGER],
    });
    expect(result).toBe(largePayload);
  });

  it("builds events.jsonl when no artifact data (deep nested)", async () => {
    const deep = makeDeepObject(25);
    const events = [
      { id: "evt_1", payload: deep },
      { id: "evt_2", payload: { text: "ok" } },
    ];
    const store = {};
    const tx = {
      objectStore: vi.fn(() => store),
    };
    const db = {
      transaction: vi.fn(() => tx),
    };
    const ctx = {
      open: vi.fn(async () => db),
      getEvents: vi.fn(async () => events),
    };

    const result = await getArtifact.call(ctx, "run_events", "events.jsonl");

    const expected = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
    expect(ctx.getEvents).toHaveBeenCalledWith("run_events");
    expect(result).toBe(expected);
  });

  it("returns null when no artifact and type is not events.jsonl", async () => {
    const store = {};
    const tx = {
      objectStore: vi.fn(() => store),
    };
    const db = {
      transaction: vi.fn(() => tx),
    };
    const ctx = { open: vi.fn(async () => db) };

    await expect(getArtifact.call(ctx, "run_missing", "state.json")).resolves.toBeNull();
  });

  it("propagates getLastByCompoundIndex errors", async () => {
    utilsMocks.getLastByCompoundIndex.mockRejectedValueOnce(new Error("idx failed"));

    const store = {};
    const tx = {
      objectStore: vi.fn(() => store),
    };
    const db = {
      transaction: vi.fn(() => tx),
    };
    const ctx = { open: vi.fn(async () => db) };

    await expect(getArtifact.call(ctx, "run_err", "plan.json")).rejects.toThrow(/idx failed/i);
  });
});
