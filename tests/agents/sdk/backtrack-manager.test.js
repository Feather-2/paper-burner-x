import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

import { BacktrackManager } from "../../../js/agents/sdk/BacktrackManager.js";

/**
 * Mock compressor factory
 * @param {Object} options
 * @param {Array} [options.archives] - List of archives for listArchives
 * @param {Object|null} [options.snapshot] - Snapshot to return from restore
 * @param {Error} [options.restoreError] - Error to throw on restore
 * @param {Function} [options.onRestore] - Callback when restore is called
 */
function createMockCompressor({
  archives = [],
  snapshot = null,
  restoreError = null,
  onRestore = null,
} = {}) {
  return {
    listArchives: mock.fn(async () => archives),
    restore: mock.fn(async (checkpointId) => {
      if (onRestore) onRestore(checkpointId);
      if (restoreError) throw restoreError;
      return snapshot;
    }),
  };
}

function createMockLogger() {
  return {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
  };
}

describe("BacktrackManager", () => {
  describe("constructor", () => {
    it("should use default values when no options provided", () => {
      const manager = new BacktrackManager();

      assert.equal(manager.compressor, null);
      assert.equal(manager.maxBacktracks, 3);
      assert.equal(manager.backtrackCount, 0);
    });

    it("should accept custom options", () => {
      const compressor = createMockCompressor();
      const logger = createMockLogger();

      const manager = new BacktrackManager({
        compressor,
        maxBacktracks: 5,
        logger,
      });

      assert.equal(manager.compressor, compressor);
      assert.equal(manager.maxBacktracks, 5);
      assert.equal(manager._logger, logger);
    });

    it("should handle maxBacktracks of 0", () => {
      const manager = new BacktrackManager({ maxBacktracks: 0 });
      assert.equal(manager.maxBacktracks, 0);
      assert.equal(manager.remaining, 0);
    });
  });

  describe("backtrackCount getter", () => {
    it("should return current backtrack count", () => {
      const manager = new BacktrackManager();
      assert.equal(manager.backtrackCount, 0);

      manager._backtrackCount = 2;
      assert.equal(manager.backtrackCount, 2);
    });
  });

  describe("remaining getter", () => {
    it("should calculate remaining backtracks correctly", () => {
      const manager = new BacktrackManager({ maxBacktracks: 5 });

      assert.equal(manager.remaining, 5);

      manager._backtrackCount = 2;
      assert.equal(manager.remaining, 3);

      manager._backtrackCount = 5;
      assert.equal(manager.remaining, 0);
    });

    it("should never return negative values", () => {
      const manager = new BacktrackManager({ maxBacktracks: 2 });
      manager._backtrackCount = 10;

      assert.equal(manager.remaining, 0);
    });
  });

  describe("canBacktrack", () => {
    it("should return false when no compressor", () => {
      const manager = new BacktrackManager({ maxBacktracks: 3 });
      assert.equal(manager.canBacktrack(), false);
    });

    it("should return true when compressor exists and under limit", () => {
      const manager = new BacktrackManager({
        compressor: createMockCompressor(),
        maxBacktracks: 3,
      });
      assert.equal(manager.canBacktrack(), true);
    });

    it("should return false when at limit", () => {
      const manager = new BacktrackManager({
        compressor: createMockCompressor(),
        maxBacktracks: 3,
      });
      manager._backtrackCount = 3;

      assert.equal(manager.canBacktrack(), false);
    });

    it("should return false when over limit", () => {
      const manager = new BacktrackManager({
        compressor: createMockCompressor(),
        maxBacktracks: 2,
      });
      manager._backtrackCount = 5;

      assert.equal(manager.canBacktrack(), false);
    });
  });

  describe("prepareBacktrack", () => {
    describe("failure cases", () => {
      it("should return no_memory_system when no compressor", async () => {
        const manager = new BacktrackManager();

        const result = await manager.prepareBacktrack("checkpoint_1");

        assert.equal(result.success, false);
        assert.equal(result.reason, "no_memory_system");
      });

      it("should return limit_reached when at max backtracks", async () => {
        const manager = new BacktrackManager({
          compressor: createMockCompressor(),
          maxBacktracks: 2,
        });
        manager._backtrackCount = 2;

        const result = await manager.prepareBacktrack("checkpoint_1");

        assert.equal(result.success, false);
        assert.equal(result.reason, "limit_reached");
      });

      it("should return no_previous_checkpoint when only one archive exists", async () => {
        const compressor = createMockCompressor({
          archives: [{ id: "current" }],
        });
        const manager = new BacktrackManager({ compressor });

        const result = await manager.prepareBacktrack();

        assert.equal(result.success, false);
        assert.equal(result.reason, "no_previous_checkpoint");
      });

      it("should return no_previous_checkpoint when no archives exist", async () => {
        const compressor = createMockCompressor({ archives: [] });
        const manager = new BacktrackManager({ compressor });

        const result = await manager.prepareBacktrack();

        assert.equal(result.success, false);
        // Empty archives treated same as single archive (no previous to backtrack to)
        assert.equal(result.reason, "no_previous_checkpoint");
      });

      it("should return snapshot_not_found when restore returns null", async () => {
        const compressor = createMockCompressor({ snapshot: null });
        const manager = new BacktrackManager({ compressor });

        const result = await manager.prepareBacktrack("checkpoint_1");

        assert.equal(result.success, false);
        assert.equal(result.reason, "snapshot_not_found");
      });

      it("should return restore_error when restore throws", async () => {
        const compressor = createMockCompressor({
          restoreError: new Error("Database connection failed"),
        });
        const logger = createMockLogger();
        const manager = new BacktrackManager({ compressor, logger });

        const result = await manager.prepareBacktrack("checkpoint_1");

        assert.equal(result.success, false);
        assert.equal(result.reason, "restore_error");
        assert.equal(result.error, "Database connection failed");
        assert.equal(logger.error.mock.calls.length, 1);
      });
    });

    describe("success cases", () => {
      it("should restore with explicit checkpoint ID", async () => {
        const snapshot = { context: { messages: ["hello"] } };
        const restoredIds = [];
        const compressor = createMockCompressor({
          snapshot,
          onRestore: (id) => restoredIds.push(id),
        });
        const logger = createMockLogger();
        const manager = new BacktrackManager({ compressor, logger });

        const result = await manager.prepareBacktrack("checkpoint_42");

        assert.equal(result.success, true);
        assert.deepEqual(result.state, { messages: ["hello"] });
        assert.equal(result.checkpointId, "checkpoint_42");
        assert.deepEqual(restoredIds, ["checkpoint_42"]);
        assert.equal(manager.backtrackCount, 1);
      });

      it("should auto-select previous checkpoint when ID not provided", async () => {
        const snapshot = { context: { step: 5 } };
        const restoredIds = [];
        const compressor = createMockCompressor({
          archives: [{ id: "current_checkpoint" }, { id: "previous_checkpoint" }],
          snapshot,
          onRestore: (id) => restoredIds.push(id),
        });
        const manager = new BacktrackManager({ compressor });

        const result = await manager.prepareBacktrack();

        assert.equal(result.success, true);
        assert.deepEqual(restoredIds, ["previous_checkpoint"]);
        assert.equal(result.checkpointId, "previous_checkpoint");
      });

      it("should return snapshot directly when no context property", async () => {
        const snapshot = { data: "raw_snapshot" };
        const compressor = createMockCompressor({ snapshot });
        const manager = new BacktrackManager({ compressor });

        const result = await manager.prepareBacktrack("cp_1");

        assert.equal(result.success, true);
        assert.deepEqual(result.state, { data: "raw_snapshot" });
      });

      it("should increment backtrack count on success", async () => {
        const compressor = createMockCompressor({
          snapshot: { context: {} },
        });
        const manager = new BacktrackManager({ compressor, maxBacktracks: 5 });

        assert.equal(manager.backtrackCount, 0);

        await manager.prepareBacktrack("cp_1");
        assert.equal(manager.backtrackCount, 1);

        await manager.prepareBacktrack("cp_2");
        assert.equal(manager.backtrackCount, 2);

        await manager.prepareBacktrack("cp_3");
        assert.equal(manager.backtrackCount, 3);
      });

      it("should log backtrack info on success", async () => {
        const compressor = createMockCompressor({
          snapshot: { context: {} },
        });
        const logger = createMockLogger();
        const manager = new BacktrackManager({
          compressor,
          logger,
          maxBacktracks: 3,
        });

        await manager.prepareBacktrack("my_checkpoint");

        assert.equal(logger.info.mock.calls.length, 1);
        const logMessage = logger.info.mock.calls[0].arguments[0];
        assert.ok(logMessage.includes("春秋蝉"));
        assert.ok(logMessage.includes("1/3"));
        assert.ok(logMessage.includes("my_checkpoint"));
      });
    });

    describe("state cloning", () => {
      it("should deep clone the restored state to prevent mutation", async () => {
        const originalContext = {
          messages: [{ role: "user", content: "test" }],
          metadata: { count: 1 },
        };
        const snapshot = { context: originalContext };
        const compressor = createMockCompressor({ snapshot });
        const manager = new BacktrackManager({ compressor });

        const result = await manager.prepareBacktrack("cp_1");

        // Mutate the returned state
        result.state.messages.push({ role: "assistant", content: "reply" });
        result.state.metadata.count = 999;

        // Original should be unchanged
        assert.equal(originalContext.messages.length, 1);
        assert.equal(originalContext.metadata.count, 1);
      });

      it("should handle complex nested objects", async () => {
        const snapshot = {
          context: {
            nested: {
              deep: {
                array: [1, 2, { value: 3 }],
              },
            },
          },
        };
        const compressor = createMockCompressor({ snapshot });
        const manager = new BacktrackManager({ compressor });

        const result = await manager.prepareBacktrack("cp_1");

        assert.deepEqual(result.state.nested.deep.array, [1, 2, { value: 3 }]);
      });
    });
  });

  describe("reset", () => {
    it("should reset backtrack count to zero", () => {
      const manager = new BacktrackManager({ maxBacktracks: 5 });
      manager._backtrackCount = 4;

      manager.reset();

      assert.equal(manager.backtrackCount, 0);
      assert.equal(manager.remaining, 5);
    });

    it("should allow backtracking again after reset", () => {
      const manager = new BacktrackManager({
        compressor: createMockCompressor(),
        maxBacktracks: 2,
      });
      manager._backtrackCount = 2;

      assert.equal(manager.canBacktrack(), false);

      manager.reset();

      assert.equal(manager.canBacktrack(), true);
    });
  });

  describe("edge cases", () => {
    it("should handle empty context object", async () => {
      const compressor = createMockCompressor({
        snapshot: { context: {} },
      });
      const manager = new BacktrackManager({ compressor });

      const result = await manager.prepareBacktrack("cp_1");

      assert.equal(result.success, true);
      assert.deepEqual(result.state, {});
    });

    it("should handle null context in snapshot", async () => {
      const compressor = createMockCompressor({
        snapshot: { context: null },
      });
      const manager = new BacktrackManager({ compressor });

      const result = await manager.prepareBacktrack("cp_1");

      assert.equal(result.success, true);
      // When context is null, should fall back to snapshot itself
      assert.deepEqual(result.state, { context: null });
    });

    it("should handle undefined context in snapshot", async () => {
      const compressor = createMockCompressor({
        snapshot: { data: "value" },
      });
      const manager = new BacktrackManager({ compressor });

      const result = await manager.prepareBacktrack("cp_1");

      assert.equal(result.success, true);
      assert.deepEqual(result.state, { data: "value" });
    });

    it("should work with multiple sequential backtracks", async () => {
      const compressor = createMockCompressor({
        snapshot: { context: { step: 1 } },
      });
      const manager = new BacktrackManager({ compressor, maxBacktracks: 3 });

      // First backtrack
      let result = await manager.prepareBacktrack("cp_1");
      assert.equal(result.success, true);
      assert.equal(manager.remaining, 2);

      // Second backtrack
      result = await manager.prepareBacktrack("cp_2");
      assert.equal(result.success, true);
      assert.equal(manager.remaining, 1);

      // Third backtrack
      result = await manager.prepareBacktrack("cp_3");
      assert.equal(result.success, true);
      assert.equal(manager.remaining, 0);

      // Fourth should fail
      result = await manager.prepareBacktrack("cp_4");
      assert.equal(result.success, false);
      assert.equal(result.reason, "limit_reached");
    });
  });
});
