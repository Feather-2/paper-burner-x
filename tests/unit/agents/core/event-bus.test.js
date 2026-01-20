/**
 * RunStoreAdapter unit tests for js/agents/core/event-bus.js, validating
 * constructor checks, append paths, and boundary inputs including concurrency.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../js/agents/shared/index.js", () => ({
  createLogger: () => ({
    debug() {},
    info() {},
    warn() {},
    error() {},
  }),
}));

import { RunStoreAdapter } from "../../../../js/agents/core/event-bus.js";

function createRunStore(mode = "batch") {
  const store = {
    getEvents: vi.fn().mockResolvedValue([]),
  };
  if (mode === "batch") {
    store.appendEvents = vi.fn().mockResolvedValue(undefined);
  }
  if (mode === "single") {
    store.appendEvent = vi.fn().mockResolvedValue(undefined);
  }
  if (mode === "both") {
    store.appendEvents = vi.fn().mockResolvedValue(undefined);
    store.appendEvent = vi.fn().mockResolvedValue(undefined);
  }
  return store;
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createDeepPayload(depth) {
  let current = { value: "leaf" };
  for (let i = 0; i < depth; i += 1) {
    current = { nested: current };
  }
  return current;
}

describe("RunStoreAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("throws when runStore is missing getEvents", () => {
      const invalidStores = [
        null,
        undefined,
        {},
        { appendEvents: vi.fn() },
        { appendEvent: vi.fn() },
        "not-an-object",
      ];

      for (const store of invalidStores) {
        expect(() => new RunStoreAdapter(store)).toThrow(
          "RunStoreAdapter(runStore): runStore.getEvents must be a function"
        );
      }
    });

    it("throws when runStore lacks appendEvents and appendEvent", () => {
      const store = { getEvents: vi.fn() };
      expect(() => new RunStoreAdapter(store)).toThrow(
        "RunStoreAdapter(runStore): runStore.appendEvents/appendEvent must be a function"
      );
    });

    it("accepts runStore with batch appendEvents", () => {
      const store = createRunStore("batch");
      expect(() => new RunStoreAdapter(store)).not.toThrow();
    });

    it("accepts runStore with single appendEvent", () => {
      const store = createRunStore("single");
      expect(() => new RunStoreAdapter(store)).not.toThrow();
    });
  });

  describe("appendEvents", () => {
    it("rejects non-array inputs", async () => {
      const adapter = new RunStoreAdapter(createRunStore("batch"));
      const invalidInputs = [null, undefined, {}, "not-array"];

      for (const input of invalidInputs) {
        await expect(adapter.appendEvents(input)).rejects.toThrow(
          "RunStoreAdapter.appendEvents(events): events must be an array"
        );
      }
    });

    it("returns 0 for empty arrays without touching the store", async () => {
      const store = createRunStore("batch");
      const adapter = new RunStoreAdapter(store);

      const total = await adapter.appendEvents([]);

      expect(total).toBe(0);
      expect(store.appendEvents).not.toHaveBeenCalled();
    });

    it("rejects events missing a non-empty string runId", async () => {
      const adapter = new RunStoreAdapter(createRunStore("batch"));
      const invalidEvents = [
        {},
        { runId: "" },
        { runId: 0 },
        { runId: -1 },
        { runId: Number.MAX_SAFE_INTEGER },
        { runId: null },
        { runId: undefined },
        "not-an-object",
        [],
      ];

      for (const event of invalidEvents) {
        await expect(adapter.appendEvents([event])).rejects.toThrow(
          "RunStoreAdapter.appendEvents(events): events must include a string runId"
        );
      }
    });

    it("accepts whitespace and numeric-string runIds", async () => {
      const store = createRunStore("batch");
      const adapter = new RunStoreAdapter(store);
      const events = [
        { runId: " ", payload: { value: 0 } },
        { runId: "0", payload: { value: -1 } },
        { runId: `${Number.MAX_SAFE_INTEGER}` },
      ];

      const total = await adapter.appendEvents(events);

      expect(total).toBe(3);
      expect(store.appendEvents).toHaveBeenCalledTimes(3);
      const calls = store.appendEvents.mock.calls;
      const whitespaceBatch = calls.find(([runId]) => runId === " ");
      const zeroBatch = calls.find(([runId]) => runId === "0");
      const maxBatch = calls.find(([runId]) => runId === `${Number.MAX_SAFE_INTEGER}`);

      expect(whitespaceBatch?.[1]).toEqual([events[0]]);
      expect(zeroBatch?.[1]).toEqual([events[1]]);
      expect(maxBatch?.[1]).toEqual([events[2]]);
    });

    it("batches events by runId when appendEvents is available", async () => {
      const store = createRunStore("both");
      const adapter = new RunStoreAdapter(store);
      const events = [
        { runId: "run-a", payload: { value: 1 } },
        { runId: "run-b", payload: { value: 2 } },
        { runId: "run-a", payload: { value: 3 } },
      ];

      const total = await adapter.appendEvents(events);

      expect(total).toBe(3);
      expect(store.appendEvents).toHaveBeenCalledTimes(2);
      expect(store.appendEvent).not.toHaveBeenCalled();

      const calls = store.appendEvents.mock.calls;
      const batchA = calls.find(([runId]) => runId === "run-a");
      const batchB = calls.find(([runId]) => runId === "run-b");

      expect(batchA?.[1]).toEqual([events[0], events[2]]);
      expect(batchB?.[1]).toEqual([events[1]]);
    });

    it("falls back to appendEvent when appendEvents is missing", async () => {
      const store = createRunStore("single");
      const adapter = new RunStoreAdapter(store);
      const events = [
        { runId: "run-a", payload: { value: 1 } },
        { runId: "run-b", payload: { value: 2 } },
      ];

      const total = await adapter.appendEvents(events);

      expect(total).toBe(2);
      expect(store.appendEvent).toHaveBeenCalledTimes(2);
      expect(store.appendEvent).toHaveBeenNthCalledWith(1, "run-a", events[0]);
      expect(store.appendEvent).toHaveBeenNthCalledWith(2, "run-b", events[1]);
    });

    it("handles concurrent appendEvents calls", async () => {
      const deferreds = [];
      const store = {
        getEvents: vi.fn().mockResolvedValue([]),
        appendEvents: vi.fn((runId, events) => {
          const deferred = createDeferred();
          deferreds.push({ runId, events, deferred });
          return deferred.promise;
        }),
      };
      const adapter = new RunStoreAdapter(store);

      const promiseA = adapter.appendEvents([{ runId: "run-a" }]);
      const promiseB = adapter.appendEvents([{ runId: "run-b" }]);

      expect(store.appendEvents).toHaveBeenCalledTimes(2);

      deferreds[1].deferred.resolve();
      deferreds[0].deferred.resolve();

      await expect(Promise.all([promiseA, promiseB])).resolves.toEqual([1, 1]);
    });

    it("supports rapid successive calls without shared state", async () => {
      const store = createRunStore("batch");
      const adapter = new RunStoreAdapter(store);
      const calls = [];

      for (let i = 0; i < 3; i += 1) {
        calls.push(adapter.appendEvents([{ runId: `run-${i}` }]));
      }

      const results = await Promise.all(calls);

      expect(results).toEqual([1, 1, 1]);
      expect(store.appendEvents).toHaveBeenCalledTimes(3);
      expect(new Set(store.appendEvents.mock.calls.map(([runId]) => runId))).toEqual(
        new Set(["run-0", "run-1", "run-2"])
      );
    });

    it("handles large payloads, long runIds, and deep nesting", async () => {
      const store = createRunStore("batch");
      const adapter = new RunStoreAdapter(store);
      const longRunId = "r".repeat(10000);
      const largeData = "x".repeat(20000);
      const deepPayload = createDeepPayload(10);
      const events = Array.from({ length: 1000 }, (_, index) => ({
        runId: longRunId,
        payload: { index, data: largeData, deep: deepPayload },
      }));

      const total = await adapter.appendEvents(events);

      expect(total).toBe(1000);
      expect(store.appendEvents).toHaveBeenCalledTimes(1);
      expect(store.appendEvents.mock.calls[0][0]).toBe(longRunId);
      expect(store.appendEvents.mock.calls[0][1]).toHaveLength(1000);
    });
  });

  describe("getEvents", () => {
    it("delegates to runStore.getEvents", async () => {
      const store = createRunStore("batch");
      const expected = [{ runId: "run-a" }];
      store.getEvents.mockResolvedValue(expected);
      const adapter = new RunStoreAdapter(store);

      const result = await adapter.getEvents("run-a");

      expect(store.getEvents).toHaveBeenCalledWith("run-a");
      expect(result).toBe(expected);
    });

    it("passes through empty and null runIds", async () => {
      const store = createRunStore("batch");
      store.getEvents.mockResolvedValue([]);
      const adapter = new RunStoreAdapter(store);

      await adapter.getEvents("");
      await adapter.getEvents(null);

      expect(store.getEvents).toHaveBeenCalledWith("");
      expect(store.getEvents).toHaveBeenCalledWith(null);
    });
  });
});
