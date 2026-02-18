import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const cryptoRandomHexMock = vi.hoisted(() => vi.fn());
const getGlobalContainerMock = vi.hoisted(() => vi.fn());

vi.mock("../../../../../js/agents/shared/index.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    cryptoRandomHex: cryptoRandomHexMock,
  };
});

vi.mock("../../../../../js/agents/core/di/global-container.js", () => ({
  getGlobalContainer: getGlobalContainerMock,
}));

import {
  TokenTracker,
  getGlobalTokenTracker,
  trackTokenUsage,
  getTokenUsageSummary,
  exportTokenUsageJson,
  exportTokenUsageCsv,
} from "../../../../../js/agents/plugins/telemetry/token-tracker.js";

const TOKEN_TRACKER_SERVICE_ID = "tokenTracker";

const makeContainer = (initialEntries = []) => {
  const services = new Map(initialEntries);
  return {
    has: vi.fn((id) => services.has(id)),
    register: vi.fn((id, factory) => {
      services.set(id, factory());
    }),
    get: vi.fn((id) => services.get(id)),
    _services: services,
  };
};

const makeDeepObject = (depth) => {
  let root = {};
  let cursor = root;
  for (let i = 0; i < depth; i += 1) {
    cursor.next = {};
    cursor = cursor.next;
  }
  return root;
};

const baseParams = (overrides = {}) => ({
  model: "m1",
  provider: "p1",
  usage: "worker",
  promptTokens: 1,
  completionTokens: 2,
  latencyMs: 5,
  ...overrides,
});

describe("TokenTracker", () => {
  let hexCounter;

  beforeEach(() => {
    hexCounter = 0;
    cryptoRandomHexMock.mockReset();
    cryptoRandomHexMock.mockImplementation(() => `hex${hexCounter++}`);
    getGlobalContainerMock.mockReset();
    getGlobalContainerMock.mockReturnValue(makeContainer());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("bounds maxRecords and initializes buffer", () => {
    const tracker = new TokenTracker({ maxRecords: Number.MAX_SAFE_INTEGER, onRecord: "nope" });
    expect(tracker.maxRecords).toBe(500);
    expect(tracker._records.length).toBe(500);
    expect(tracker.onRecord).toBeNull();

    const zeroTracker = new TokenTracker({ maxRecords: 0, onRecord: () => {} });
    expect(zeroTracker.maxRecords).toBe(0);
    expect(zeroTracker._records.length).toBe(0);
    expect(zeroTracker.getAllRecords()).toEqual([]);

    const negativeTracker = new TokenTracker({ maxRecords: -1 });
    expect(negativeTracker.maxRecords).toBe(500);
  });

  it("records usage, updates stats, and calls onRecord", () => {
    const onRecord = vi.fn();
    const tracker = new TokenTracker({ maxRecords: 5, onRecord });

    const record = tracker.record({
      model: "gpt-4",
      provider: "openai",
      usage: "worker",
      promptTokens: 2,
      completionTokens: 3,
      latencyMs: 50,
      success: true,
    });

    expect(record.id).toMatch(/^tok_[a-z0-9]+_hex0$/);
    expect(record.timestamp).toEqual(expect.any(Number));
    expect(record).toMatchObject({
      model: "gpt-4",
      provider: "openai",
      usage: "worker",
      promptTokens: 2,
      completionTokens: 3,
      totalTokens: 5,
      latencyMs: 50,
      success: true,
    });
    expect(onRecord).toHaveBeenCalledTimes(1);
    expect(onRecord).toHaveBeenCalledWith(record);
    expect(cryptoRandomHexMock).toHaveBeenCalledWith(3);

    const summary = tracker.getSummary();
    expect(summary).toMatchObject({
      totalCalls: 1,
      successCalls: 1,
      failedCalls: 0,
      totalPromptTokens: 2,
      totalCompletionTokens: 3,
      totalTokens: 5,
      totalLatencyMs: 50,
      avgLatencyMs: 50,
      avgTokensPerCall: 5,
      successRate: 1,
    });
    expect(summary.byModel["gpt-4"]).toMatchObject({ calls: 1, totalTokens: 5 });
    expect(summary.byUsage.worker).toMatchObject({ calls: 1, totalTokens: 5 });
    expect(summary.byProvider.openai).toMatchObject({ calls: 1, totalTokens: 5 });
  });

  it("coerces null/undefined/empty inputs and numeric strings", () => {
    const tracker = new TokenTracker({ maxRecords: 3 });
    const record = tracker.record({
      model: null,
      provider: undefined,
      usage: "",
      promptTokens: null,
      completionTokens: "7",
      latencyMs: "   ",
      error: "",
    });

    expect(record.model).toBe("unknown");
    expect(record.provider).toBe("unknown");
    expect(record.usage).toBe("unknown");
    expect(record.promptTokens).toBe(0);
    expect(record.completionTokens).toBe(7);
    expect(record.totalTokens).toBe(7);
    expect(record.latencyMs).toBe(0);
    expect(record.success).toBe(true);
    expect(record).not.toHaveProperty("error");
  });

  it("handles arrays/objects, type boundaries, and falsy success values", () => {
    const tracker = new TokenTracker({ maxRecords: 2 });
    const record = tracker.record({
      model: [],
      provider: {},
      usage: ["WORKER"],
      promptTokens: "12px",
      completionTokens: {},
      latencyMs: -1,
      success: 0,
      error: { message: "boom" },
    });

    expect(record.model).toBe("");
    expect(record.provider).toBe("[object Object]");
    expect(record.usage).toBe("WORKER");
    expect(record.promptTokens).toBe(12);
    expect(record.completionTokens).toBe(0);
    expect(record.totalTokens).toBe(12);
    expect(record.latencyMs).toBe(0);
    expect(record.success).toBe(false);
    expect(record.error).toBe("[object Object]");
  });

  it("preserves MAX_SAFE_INTEGER token counts", () => {
    const tracker = new TokenTracker();
    const record = tracker.record(
      baseParams({
        promptTokens: Number.MAX_SAFE_INTEGER,
        completionTokens: 0,
        latencyMs: 0,
      })
    );

    expect(record.promptTokens).toBe(Number.MAX_SAFE_INTEGER);
    expect(record.totalTokens).toBe(Number.MAX_SAFE_INTEGER);
    expect(tracker.getTotalTokens()).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("supports ring buffer ordering and recent record limits", () => {
    const tracker = new TokenTracker({ maxRecords: 3 });

    for (let i = 0; i <= 4; i += 1) {
      tracker.record(baseParams({ promptTokens: i, completionTokens: 0 }));
    }

    const all = tracker.getAllRecords();
    expect(all).toHaveLength(3);
    expect(all.map((r) => r.promptTokens)).toEqual([2, 3, 4]);

    const recent = tracker.getRecentRecords(2);
    expect(recent.map((r) => r.promptTokens)).toEqual([3, 4]);

    expect(tracker.getRecentRecords(0)).toEqual([]);
    expect(tracker.getRecentRecords(-1)).toHaveLength(3);
    expect(tracker.getRecentRecords({})).toHaveLength(3);
    expect(tracker.getRecentRecords([])).toHaveLength(3);
  });

  it("does not store records when maxRecords is 0", () => {
    const tracker = new TokenTracker({ maxRecords: 0 });
    tracker.record(baseParams({ promptTokens: 4, completionTokens: 1 }));

    expect(tracker.getAllRecords()).toEqual([]);
    expect(tracker.getSummary().totalCalls).toBe(1);
  });

  it("returns records within a time range", () => {
    const times = [1000, 1000, 2000, 2000, 3000, 3000];
    vi.spyOn(Date, "now").mockImplementation(() => (times.length ? times.shift() : 3000));

    const tracker = new TokenTracker();
    tracker.record(baseParams({ promptTokens: 1 }));
    tracker.record(baseParams({ promptTokens: 2 }));
    tracker.record(baseParams({ promptTokens: 3 }));

    const range = tracker.getRecordsInRange(1500, 2500);
    expect(range).toHaveLength(1);
    expect(range[0].timestamp).toBe(2000);
  });

  it("filters records by model and usage (case-insensitive)", () => {
    const tracker = new TokenTracker();
    const r1 = tracker.record(baseParams({ model: "GPT-4", usage: "Worker" }));
    tracker.record(baseParams({ model: "gpt-3.5", usage: "planner" }));

    const byModel = tracker.getRecordsByModel("gpt-4");
    expect(byModel).toEqual([r1]);

    const byUsage = tracker.getRecordsByUsage("worker");
    expect(byUsage).toEqual([r1]);
  });

  it("exports JSON and CSV with escaped errors", () => {
    const tracker = new TokenTracker();
    const errorMessage = 'bad "quote"';

    tracker.record(
      baseParams({
        success: false,
        error: errorMessage,
      })
    );

    const json = tracker.exportJson();
    const parsed = JSON.parse(json);
    expect(parsed.records).toHaveLength(1);
    expect(parsed.summary.totalCalls).toBe(1);
    expect(Number.isNaN(Date.parse(parsed.exportedAt))).toBe(false);

    const csv = tracker.exportCsv();
    const lines = csv.split("\n");
    expect(lines[0]).toBe(
      "id,timestamp,model,provider,usage,promptTokens,completionTokens,totalTokens,latencyMs,success,error"
    );
    expect(lines[1]).toContain('"bad ""quote"""');
  });

  it("clears records and resets summary", () => {
    const tracker = new TokenTracker();
    tracker.record(baseParams());
    tracker.clear();

    expect(tracker.getAllRecords()).toEqual([]);
    expect(tracker.getSummary().totalCalls).toBe(0);
    expect(tracker.getTotalTokens()).toBe(0);
  });

  it("handles rapid concurrent calls and large payloads", async () => {
    const longString = "x".repeat(10000);
    const deepObject = makeDeepObject(40);
    const tracker = new TokenTracker({ maxRecords: 500 });

    const tasks = Array.from({ length: 520 }, (_, i) =>
      Promise.resolve().then(() =>
        tracker.record(
          baseParams({
            model: deepObject,
            provider: longString,
            usage: `u${i}`,
            promptTokens: i,
            completionTokens: 0,
            error: longString,
          })
        )
      )
    );

    await Promise.all(tasks);

    const all = tracker.getAllRecords();
    expect(all).toHaveLength(500);
    expect(tracker.getSummary().totalCalls).toBe(520);
    expect(tracker.exportJson()).toContain(longString.slice(0, 50));
  });

  it("exposes compatibility aliases for records and totals", () => {
    const tracker = new TokenTracker();
    tracker.record(baseParams({ promptTokens: 4, completionTokens: 1 }));

    expect(tracker.getRecords()).toEqual(tracker.getAllRecords());
    expect(tracker.getTotalTokens()).toBe(5);
  });

  it("flushes scheduled archive persistence and exposes persistence status", async () => {
    const archive = {
      list: vi.fn().mockResolvedValue([]),
      load: vi.fn(),
      save: vi.fn().mockResolvedValue(undefined),
    };
    const tracker = new TokenTracker({ archive, runId: "run-flush" });

    tracker.record(baseParams({ promptTokens: 2, completionTokens: 3 }));
    await tracker.flush();

    expect(archive.save).toHaveBeenCalledTimes(1);
    expect(archive.save).toHaveBeenCalledWith("run-flush", expect.objectContaining({
      stats: expect.objectContaining({ totalTokens: 5 }),
    }));
    expect(tracker.getPersistenceStatus()).toEqual(expect.objectContaining({
      enabled: true,
      runId: "run-flush",
      successCount: 1,
      failureCount: 0,
    }));
  });

  it("reports hydrate and persist errors via onPersistenceError callback", async () => {
    const onPersistenceError = vi.fn();
    const archive = {
      list: vi.fn().mockRejectedValue(new Error("hydrate-fail")),
      load: vi.fn(),
      save: vi.fn().mockRejectedValue(new Error("persist-fail")),
    };
    const tracker = new TokenTracker({ archive, runId: "run-errors", onPersistenceError });

    await tracker.init();
    tracker.record(baseParams());
    await tracker.flush({ throwOnError: false });

    expect(onPersistenceError).toHaveBeenCalledWith(expect.objectContaining({
      phase: "hydrate",
      runId: "run-errors",
      error: expect.objectContaining({ message: "hydrate-fail" }),
    }));
    expect(onPersistenceError).toHaveBeenCalledWith(expect.objectContaining({
      phase: "persist",
      runId: "run-errors",
      error: expect.objectContaining({ message: "persist-fail" }),
    }));
    expect(tracker.getPersistenceStatus()).toEqual(expect.objectContaining({
      failureCount: 1,
      lastError: "persist-fail",
    }));
  });
});

describe("getGlobalTokenTracker", () => {
  beforeEach(() => {
    cryptoRandomHexMock.mockReset();
    cryptoRandomHexMock.mockImplementation(() => "hex");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers and caches a tracker in the global container", () => {
    const container = makeContainer();
    getGlobalContainerMock.mockReturnValue(container);

    const tracker = getGlobalTokenTracker();
    const trackerAgain = getGlobalTokenTracker();

    expect(container.has).toHaveBeenCalledWith(TOKEN_TRACKER_SERVICE_ID);
    expect(container.register).toHaveBeenCalledTimes(1);
    expect(container.get).toHaveBeenCalledWith(TOKEN_TRACKER_SERVICE_ID);
    expect(trackerAgain).toBe(tracker);
  });
});

describe("trackTokenUsage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("forwards to the global tracker record method", () => {
    const record = { id: "r1" };
    const tracker = { record: vi.fn().mockReturnValue(record) };
    const container = makeContainer([[TOKEN_TRACKER_SERVICE_ID, tracker]]);
    getGlobalContainerMock.mockReturnValue(container);

    const params = baseParams({ model: "m2" });
    const result = trackTokenUsage(params);

    expect(result).toBe(record);
    expect(tracker.record).toHaveBeenCalledWith(params);
    expect(container.register).not.toHaveBeenCalled();
  });
});

describe("getTokenUsageSummary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the global tracker summary", () => {
    const summary = { totalCalls: 3 };
    const tracker = { getSummary: vi.fn().mockReturnValue(summary) };
    const container = makeContainer([[TOKEN_TRACKER_SERVICE_ID, tracker]]);
    getGlobalContainerMock.mockReturnValue(container);

    const result = getTokenUsageSummary();
    expect(result).toBe(summary);
    expect(tracker.getSummary).toHaveBeenCalledTimes(1);
  });
});

describe("exportTokenUsageJson", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns JSON from the global tracker", () => {
    const tracker = { exportJson: vi.fn().mockReturnValue("{\"ok\":true}") };
    const container = makeContainer([[TOKEN_TRACKER_SERVICE_ID, tracker]]);
    getGlobalContainerMock.mockReturnValue(container);

    const result = exportTokenUsageJson();
    expect(result).toBe("{\"ok\":true}");
    expect(tracker.exportJson).toHaveBeenCalledTimes(1);
  });
});

describe("exportTokenUsageCsv", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns CSV from the global tracker", () => {
    const tracker = { exportCsv: vi.fn().mockReturnValue("id,foo") };
    const container = makeContainer([[TOKEN_TRACKER_SERVICE_ID, tracker]]);
    getGlobalContainerMock.mockReturnValue(container);

    const result = exportTokenUsageCsv();
    expect(result).toBe("id,foo");
    expect(tracker.exportCsv).toHaveBeenCalledTimes(1);
  });
});
