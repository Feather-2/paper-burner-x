import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockedShared = vi.hoisted(() => ({
  deepClone: vi.fn(),
}));

vi.mock("../../../../js/agents/shared/index.js", () => mockedShared);

import BacktrackManagerDefault, { BacktrackManager } from "../../../../js/agents/sdk/BacktrackManager.js";

const cloneValue = (value) => {
  if (value && typeof value === "object") {
    return JSON.parse(JSON.stringify(value));
  }
  return value;
};

const createLogger = () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
});

const createCompressor = (options = {}) => {
  const {
    archives = [],
    snapshot,
    restoreError = null,
    restore = null,
    onRestore = null,
  } = options;

  return {
    listArchives: vi.fn(async () => archives),
    restore: vi.fn(async (checkpointId) => {
      if (onRestore) onRestore(checkpointId);
      if (restore) return restore(checkpointId);
      if (restoreError) throw restoreError;
      if (Object.prototype.hasOwnProperty.call(options, "snapshot")) {
        return snapshot;
      }
      return { context: {} };
    }),
  };
};

const createDeferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const createDeepNested = (depth) => {
  let current = { leaf: true };
  for (let i = 0; i < depth; i += 1) {
    current = { nested: current };
  }
  return current;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.stubGlobal("structuredClone", undefined);
  mockedShared.deepClone.mockImplementation(cloneValue);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BacktrackManager", () => {
  it("defaults to no compressor and maxBacktracks 3", () => {
    const manager = new BacktrackManager();

    expect(manager.compressor).toBe(null);
    expect(manager.maxBacktracks).toBe(3);
    expect(manager.backtrackCount).toBe(0);
    expect(manager.remaining).toBe(3);
    expect(manager.canBacktrack()).toBe(false);
  });

  it("handles boundary maxBacktracks values and numeric strings", () => {
    const compressor = createCompressor();

    const cases = [
      { value: 0, remaining: 0, canBacktrack: false },
      { value: -1, remaining: 0, canBacktrack: false },
      { value: Number.MAX_SAFE_INTEGER, remaining: Number.MAX_SAFE_INTEGER, canBacktrack: true },
      { value: "2", remaining: 2, canBacktrack: true },
      { value: "   ", remaining: 0, canBacktrack: false },
    ];

    for (const { value, remaining, canBacktrack } of cases) {
      const manager = new BacktrackManager({ compressor, maxBacktracks: value });
      expect(manager.remaining).toBe(remaining);
      expect(manager.canBacktrack()).toBe(canBacktrack);
    }
  });

  it("reset clears backtrack count", () => {
    const manager = new BacktrackManager({ maxBacktracks: 2 });
    manager._backtrackCount = 2;

    manager.reset();

    expect(manager.backtrackCount).toBe(0);
    expect(manager.remaining).toBe(2);
  });

  describe("prepareBacktrack", () => {
    it("returns no_memory_system without a compressor", async () => {
      const manager = new BacktrackManager();
      const cases = [undefined, null, "", "checkpoint"];

      for (const checkpointId of cases) {
        const result = await manager.prepareBacktrack(checkpointId);
        expect(result.success).toBe(false);
        expect(result.reason).toBe("no_memory_system");
      }
    });

    it("returns limit_reached when maxBacktracks is 0 or negative", async () => {
      const compressor = createCompressor();
      const cases = [0, -1];

      for (const maxBacktracks of cases) {
        const manager = new BacktrackManager({ compressor, maxBacktracks });
        const result = await manager.prepareBacktrack("checkpoint");
        expect(result.success).toBe(false);
        expect(result.reason).toBe("limit_reached");
      }
    });

    it("returns no_previous_checkpoint for empty or non-array archives", async () => {
      const cases = [[], [{ id: "only" }], {}];

      for (const archives of cases) {
        const compressor = createCompressor({ archives });
        const manager = new BacktrackManager({ compressor, logger: createLogger() });
        const result = await manager.prepareBacktrack();
        expect(result.success).toBe(false);
        expect(result.reason).toBe("no_previous_checkpoint");
      }
    });

    it("returns no_checkpoint_found when previous checkpoint id is empty string", async () => {
      const compressor = createCompressor({
        archives: [{ id: "current" }, { id: "" }],
      });
      const manager = new BacktrackManager({ compressor, logger: createLogger() });

      const result = await manager.prepareBacktrack("");

      expect(result.success).toBe(false);
      expect(result.reason).toBe("no_checkpoint_found");
    });

    it("returns snapshot_not_found when restore yields null or undefined", async () => {
      const cases = [null, undefined];

      for (const snapshot of cases) {
        const compressor = createCompressor({ snapshot });
        const manager = new BacktrackManager({ compressor, logger: createLogger() });

        const result = await manager.prepareBacktrack("checkpoint");

        expect(result.success).toBe(false);
        expect(result.reason).toBe("snapshot_not_found");
      }
    });

    it("returns restore_error when restore throws and logs error", async () => {
      const error = new Error("restore failed");
      const compressor = createCompressor({ restoreError: error });
      const logger = createLogger();
      const manager = new BacktrackManager({ compressor, logger });

      const result = await manager.prepareBacktrack("checkpoint");

      expect(result.success).toBe(false);
      expect(result.reason).toBe("restore_error");
      expect(result.error).toBe("restore failed");
      expect(logger.error).toHaveBeenCalledWith(expect.any(String), error);
    });

    it("restores explicit checkpoint IDs including whitespace strings", async () => {
      const snapshot = { context: { value: "ok" } };
      const compressor = createCompressor({ snapshot });
      const logger = createLogger();
      const manager = new BacktrackManager({ compressor, logger });

      const result = await manager.prepareBacktrack("   ");

      expect(result.success).toBe(true);
      expect(result.state).toEqual({ value: "ok" });
      expect(result.checkpointId).toBe("   ");
      expect(manager.backtrackCount).toBe(1);
      expect(compressor.restore).toHaveBeenCalledWith("   ");
      expect(logger.info).toHaveBeenCalledTimes(1);
    });

    it("auto-selects previous checkpoint when checkpointId is null", async () => {
      const snapshot = { context: { step: 1 } };
      const compressor = createCompressor({
        archives: [{ id: "current" }, { id: "previous" }],
        snapshot,
      });
      const logger = createLogger();
      const manager = new BacktrackManager({ compressor, logger });

      const result = await manager.prepareBacktrack(null);

      expect(result.success).toBe(true);
      expect(result.checkpointId).toBe("previous");
      expect(compressor.listArchives).toHaveBeenCalledWith({ limit: 2 });
      expect(compressor.restore).toHaveBeenCalledWith("previous");
    });

    it("handles empty array and empty object contexts", async () => {
      const cases = [
        { context: [], expected: [] },
        { context: {}, expected: {} },
      ];

      for (const { context, expected } of cases) {
        const compressor = createCompressor({ snapshot: { context } });
        const manager = new BacktrackManager({ compressor, logger: createLogger() });
        const result = await manager.prepareBacktrack("checkpoint");

        expect(result.success).toBe(true);
        expect(result.state).toEqual(expected);
      }
    });

    it("falls back to snapshot when context is null or undefined", async () => {
      const snapshotWithNull = { context: null, extra: "value" };
      const compressorNull = createCompressor({ snapshot: snapshotWithNull });
      const managerNull = new BacktrackManager({ compressor: compressorNull, logger: createLogger() });

      const resultNull = await managerNull.prepareBacktrack("checkpoint");

      expect(resultNull.success).toBe(true);
      expect(resultNull.state).toEqual(snapshotWithNull);

      const snapshotWithoutContext = { data: "value" };
      const compressorUndef = createCompressor({ snapshot: snapshotWithoutContext });
      const managerUndef = new BacktrackManager({ compressor: compressorUndef, logger: createLogger() });

      const resultUndef = await managerUndef.prepareBacktrack("checkpoint");

      expect(resultUndef.success).toBe(true);
      expect(resultUndef.state).toEqual(snapshotWithoutContext);
    });

    it("uses structuredClone when available", async () => {
      const cloned = { from: "structured" };
      const structuredClone = vi.fn(() => cloned);
      vi.stubGlobal("structuredClone", structuredClone);

      const snapshot = { context: { value: 1 } };
      const compressor = createCompressor({ snapshot });
      const manager = new BacktrackManager({ compressor, logger: createLogger() });

      const result = await manager.prepareBacktrack("checkpoint");

      expect(result.success).toBe(true);
      expect(result.state).toBe(cloned);
      expect(structuredClone).toHaveBeenCalledWith(snapshot.context);
      expect(mockedShared.deepClone).not.toHaveBeenCalled();
    });

    it("falls back to deepClone when structuredClone throws", async () => {
      vi.stubGlobal("structuredClone", vi.fn(() => {
        throw new Error("structured clone failed");
      }));

      const sentinel = { from: "deepClone" };
      mockedShared.deepClone.mockImplementation(() => sentinel);

      const snapshot = { context: { value: 2 } };
      const compressor = createCompressor({ snapshot });
      const manager = new BacktrackManager({ compressor, logger: createLogger() });

      const result = await manager.prepareBacktrack("checkpoint");

      expect(result.success).toBe(true);
      expect(result.state).toBe(sentinel);
      expect(mockedShared.deepClone).toHaveBeenCalledWith(snapshot.context);
    });

    it("handles large payloads with long strings and arrays", async () => {
      const hugeText = "x".repeat(100000);
      const largeArray = Array.from({ length: 5000 }, (_, index) => ({ index }));
      const snapshot = { context: { hugeText, largeArray } };
      const compressor = createCompressor({ snapshot });
      const manager = new BacktrackManager({ compressor, logger: createLogger() });

      const result = await manager.prepareBacktrack("checkpoint");

      expect(result.success).toBe(true);
      expect(result.state.hugeText.length).toBe(hugeText.length);
      expect(result.state.largeArray).toHaveLength(largeArray.length);

      result.state.largeArray.push({ index: "extra" });
      expect(snapshot.context.largeArray).toHaveLength(largeArray.length);
    });

    it("handles deeply nested state without mutating the snapshot", async () => {
      const nested = createDeepNested(60);
      const snapshot = { context: nested };
      const compressor = createCompressor({ snapshot });
      const manager = new BacktrackManager({ compressor, logger: createLogger() });

      const result = await manager.prepareBacktrack("checkpoint");

      let current = result.state;
      for (let i = 0; i < 60; i += 1) {
        current = current.nested;
      }
      expect(current.leaf).toBe(true);

      current.leaf = false;
      let original = snapshot.context;
      for (let i = 0; i < 60; i += 1) {
        original = original.nested;
      }
      expect(original.leaf).toBe(true);
    });

    it("supports concurrent prepareBacktrack calls", async () => {
      const deferredOne = createDeferred();
      const deferredTwo = createDeferred();
      const restoreQueue = [deferredOne, deferredTwo];
      const compressor = createCompressor({
        restore: () => restoreQueue.shift().promise,
      });
      const manager = new BacktrackManager({ compressor, logger: createLogger(), maxBacktracks: 2 });

      const first = manager.prepareBacktrack("checkpoint-1");
      const second = manager.prepareBacktrack("checkpoint-2");

      deferredOne.resolve({ context: { id: "checkpoint-1" } });
      deferredTwo.resolve({ context: { id: "checkpoint-2" } });

      const results = await Promise.all([first, second]);

      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);
      expect(manager.backtrackCount).toBe(2);
      expect(compressor.restore.mock.calls.map((call) => call[0])).toEqual([
        "checkpoint-1",
        "checkpoint-2",
      ]);
    });

    it("supports rapid consecutive backtracks and updates remaining", async () => {
      const snapshot = { context: { step: 0 } };
      const compressor = createCompressor({ snapshot });
      const manager = new BacktrackManager({ compressor, logger: createLogger(), maxBacktracks: 3 });

      await manager.prepareBacktrack("cp-1");
      await manager.prepareBacktrack("cp-2");
      await manager.prepareBacktrack("cp-3");

      expect(manager.remaining).toBe(0);

      const result = await manager.prepareBacktrack("cp-4");

      expect(result.success).toBe(false);
      expect(result.reason).toBe("limit_reached");
    });
  });
});

describe("BacktrackManager (default export)", () => {
  it("matches the named export", () => {
    expect(BacktrackManagerDefault).toBe(BacktrackManager);
  });
});
