import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../../js/agents/shared/index.js", () => ({
  migrateCheckpoint: vi.fn(),
}));

vi.mock("../../../../../../js/agents/stages/deepsearch/state.js", () => ({
  DeepSearchState: {
    fromJSON: vi.fn(),
  },
}));

import {
  BacktrackManager,
  createBacktrackManager,
} from "../../../../../../js/agents/stages/deepsearch/internal/backtrack-manager.js";
import { migrateCheckpoint } from "../../../../../../js/agents/shared/index.js";
import { DeepSearchState } from "../../../../../../js/agents/stages/deepsearch/state.js";

const createArchive = (restoreImpl) => ({
  restore: vi.fn(
    restoreImpl ||
      (async () => ({
        nodeStates: { todos: [] },
      }))
  ),
  save: vi.fn(async () => "checkpoint-id"),
});

const createLogger = () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

const createState = (overrides = {}) => ({
  runId: "run-1",
  checkpoints: [],
  todos: [],
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  migrateCheckpoint.mockImplementation((value) => value);
  DeepSearchState.fromJSON.mockImplementation((nodeStates) => nodeStates);
});

describe("BacktrackManager", () => {
  describe("constructor", () => {
    it("uses defaults when options omitted", () => {
      const manager = new BacktrackManager();

      expect(manager.archive).toBe(null);
      expect(manager.maxBacktracks).toBe(3);
      expect(manager.backtrackCount).toBe(0);
      expect(manager.remaining).toBe(3);
      expect(manager.sideEffects).toBe(null);
      expect(manager.canBacktrack()).toBe(null);
    });

    it("handles zero and negative maxBacktracks", () => {
      const archive = createArchive();

      const zero = new BacktrackManager({ archive, maxBacktracks: 0 });
      expect(zero.remaining).toBe(0);
      expect(zero.canBacktrack()).toBe(false);

      const negative = new BacktrackManager({ archive, maxBacktracks: -1 });
      expect(negative.remaining).toBe(0);
      expect(negative.canBacktrack()).toBe(false);
    });

    it("handles MAX_SAFE_INTEGER and string maxBacktracks", () => {
      const archive = createArchive();

      const huge = new BacktrackManager({
        archive,
        maxBacktracks: Number.MAX_SAFE_INTEGER,
      });
      expect(huge.remaining).toBe(Number.MAX_SAFE_INTEGER);
      expect(huge.canBacktrack()).toBe(true);

      const stringy = new BacktrackManager({ archive, maxBacktracks: "2" });
      expect(stringy.remaining).toBe(2);
      expect(stringy.canBacktrack()).toBe(true);
    });
  });

  describe("backtrack", () => {
    it("returns no_archive when archive is missing", async () => {
      const manager = new BacktrackManager();

      const result = await manager.backtrack(null, null);

      expect(result).toEqual({ success: false, reason: "no_archive" });
    });

    it("returns limit_reached and emits todo context with large data", async () => {
      const archive = createArchive();
      const logger = createLogger();
      const emit = vi.fn();
      const manager = new BacktrackManager({
        archive,
        maxBacktracks: 1,
        logger,
        emit,
      });
      manager._backtrackCount = 1;

      const openTodos = Array.from({ length: 25 }, (_, i) => ({
        todoId: `open_${i}`,
        status: "open",
      }));
      const todos = [
        { todoId: "done", status: "completed" },
        { todoId: "cancel", status: "cancelled" },
        { status: "open" },
        ...openTodos,
      ];
      const state = createState({ todos });

      const result = await manager.backtrack(state, "cp1");

      expect(result).toEqual({ success: false, reason: "limit_reached" });
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledTimes(1);
      expect(archive.restore).not.toHaveBeenCalled();

      const payload = emit.mock.calls[0][1];
      expect(payload.todoContext.todoCount).toBe(todos.length);
      expect(payload.todoContext.completedTodoCount).toBe(1);
      expect(payload.todoContext.cancelledTodoCount).toBe(1);
      expect(payload.todoContext.openTodoCount).toBe(todos.length - 2);
      expect(payload.todoContext.openTodoIds.length).toBe(10);
      expect(payload.todoContext.openTodoIds[0]).toBe("todo_unknown");
    });

    it("returns no_checkpoint for empty checkpoints and undefined checkpointId", async () => {
      const archive = createArchive();
      const manager = new BacktrackManager({
        archive,
        logger: createLogger(),
        emit: vi.fn(),
      });
      const state = createState({ checkpoints: [], todos: [] });

      const result = await manager.backtrack(state, undefined);

      expect(result).toEqual({ success: false, reason: "no_checkpoint" });
      expect(archive.restore).not.toHaveBeenCalled();
    });

    it("restores using fallback checkpoint when checkpointId is empty string", async () => {
      const archive = createArchive(async () => ({
        nodeStates: { todos: [] },
      }));
      const manager = new BacktrackManager({
        archive,
        logger: createLogger(),
        emit: vi.fn(),
      });
      const state = createState({
        checkpoints: [
          { checkpointId: "older" },
          { checkpointId: "previous" },
          { checkpointId: "current" },
        ],
      });

      const result = await manager.backtrack(state, "");

      expect(archive.restore).toHaveBeenCalledWith("previous");
      expect(result.success).toBe(true);
    });

    it("returns restore_failed when archive.restore throws", async () => {
      const archive = createArchive(async () => {
        throw new Error("restore boom");
      });
      const logger = createLogger();
      const manager = new BacktrackManager({ archive, logger, emit: vi.fn() });
      const state = createState();

      const result = await manager.backtrack(state, "cp1");

      expect(result.success).toBe(false);
      expect(result.reason).toBe("restore_failed");
      expect(result.error).toBe("restore boom");
      expect(result.details).toEqual({
        checkpointId: "cp1",
        stage: "archive.restore",
      });
      expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    it("returns invalid_checkpoint when migrateCheckpoint throws", async () => {
      migrateCheckpoint.mockImplementation(() => {
        throw new Error("bad schema");
      });
      const archive = createArchive(async () => ({
        nodeStates: { todos: [] },
      }));
      const logger = createLogger();
      const manager = new BacktrackManager({ archive, logger, emit: vi.fn() });
      const state = createState();

      const result = await manager.backtrack(state, "cp2");

      expect(result.success).toBe(false);
      expect(result.reason).toBe("invalid_checkpoint");
      expect(result.error).toBe("bad schema");
      expect(result.details).toEqual({
        checkpointId: "cp2",
        stage: "migrateCheckpoint",
      });
      expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    it("returns invalid_checkpoint when nodeStates are missing", async () => {
      const raw = { schemaVersion: "v1" };
      for (let i = 0; i < 30; i += 1) {
        raw[`k${i}`] = i;
      }
      const archive = createArchive(async () => raw);
      const manager = new BacktrackManager({
        archive,
        logger: createLogger(),
        emit: vi.fn(),
      });
      const state = createState();

      const result = await manager.backtrack(state, "cp3");

      expect(result.success).toBe(false);
      expect(result.reason).toBe("invalid_checkpoint");
      expect(result.error).toBe("missing_nodeStates");
      expect(result.details.schemaVersion).toBe("v1");
      expect(result.details.keys.length).toBe(20);
      expect(DeepSearchState.fromJSON).not.toHaveBeenCalled();
    });

    it("restores state, emits events, and signals sharedContext with boundary inputs", async () => {
      const longText = "x".repeat(100000);
      const nodeStates = {
        todos: [
          { todoId: "t1", status: "open" },
          { todoId: "t2", status: "completed" },
          { todoId: "t3", status: "cancelled" },
        ],
        deep: { level1: { level2: { text: longText } } },
      };
      const archive = createArchive(async () => ({
        nodeStates,
        metadata: { sideEffectsCursor: "cursor-1" },
      }));
      const sideEffects = {
        rollbackToCursor: vi.fn(async () => ({ ok: true, reason: "rolled_back" })),
      };
      const logger = createLogger();
      const emit = vi.fn();
      const sharedContext = { signal: vi.fn() };
      const manager = new BacktrackManager({
        archive,
        logger,
        emit,
        sideEffects,
        maxBacktracks: 2,
      });
      const state = createState({ todos: [] });

      const result = await manager.backtrack(state, "cp_success", {
        failReason: "",
        correctionHint: " ",
        sharedContext,
      });

      expect(result.success).toBe(true);
      expect(result.reason).toBe("restored");
      expect(result.state).toBe(nodeStates);
      expect(manager.backtrackCount).toBe(1);
      expect(DeepSearchState.fromJSON).toHaveBeenCalledWith(nodeStates);
      expect(sideEffects.rollbackToCursor).toHaveBeenCalledWith("cursor-1", {
        reason: "backtrack:cp_success",
      });

      const payload = emit.mock.calls[0][1];
      expect(payload.failReason).toBe(null);
      expect(payload.correctionHint).toBe(" ");
      expect(payload.todoContext).toEqual({
        todoCount: 3,
        openTodoCount: 1,
        completedTodoCount: 1,
        cancelledTodoCount: 1,
        openTodoIds: ["t1"],
      });
      expect(payload.sideEffectsRollback).toEqual({ ok: true, reason: "rolled_back" });

      expect(sharedContext.signal).toHaveBeenCalledWith(
        "backtrack_hint",
        expect.objectContaining({
          failReason: "unknown",
          correctionHint: " ",
          checkpointId: "cp_success",
          backtrackCount: 1,
        })
      );
      expect(logger.info).toHaveBeenCalledTimes(1);
    });

    it("continues when sideEffects rollback throws", async () => {
      const archive = createArchive(async () => ({
        nodeStates: { todos: [] },
        metadata: { sideEffectsCursor: "cursor-2" },
      }));
      const sideEffects = {
        rollbackToCursor: vi.fn(async () => {
          throw new Error("rollback boom");
        }),
      };
      const logger = createLogger();
      const emit = vi.fn();
      const manager = new BacktrackManager({
        archive,
        logger,
        emit,
        sideEffects,
      });
      const state = createState();

      const result = await manager.backtrack(state, "cp_side");

      expect(result.success).toBe(true);
      expect(logger.warn).toHaveBeenCalledTimes(1);
      const payload = emit.mock.calls[0][1];
      expect(payload.sideEffectsRollback).toEqual({
        ok: false,
        reason: "rollback_failed",
        error: "rollback boom",
      });
    });

    it("returns restore_failed when DeepSearchState.fromJSON throws", async () => {
      DeepSearchState.fromJSON.mockImplementation(() => {
        throw new Error("fromJSON fail");
      });
      const archive = createArchive(async () => ({
        nodeStates: { todos: [] },
      }));
      const logger = createLogger();
      const manager = new BacktrackManager({ archive, logger, emit: vi.fn() });
      const state = createState();

      const result = await manager.backtrack(state, "cp_bad_state");

      expect(result.success).toBe(false);
      expect(result.reason).toBe("restore_failed");
      expect(result.error).toBe("fromJSON fail");
      expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    it("supports concurrent backtrack calls", async () => {
      const resolvers = [];
      const archive = {
        restore: vi.fn(
          () =>
            new Promise((resolve) => {
              resolvers.push(resolve);
            })
        ),
        save: vi.fn(async () => "checkpoint-id"),
      };
      const manager = new BacktrackManager({
        archive,
        logger: createLogger(),
        emit: vi.fn(),
        maxBacktracks: 5,
      });
      const state = createState();

      const first = manager.backtrack(state, "cp1");
      const second = manager.backtrack(state, "cp2");

      expect(resolvers.length).toBe(2);
      resolvers[0]({ nodeStates: { todos: [] } });
      resolvers[1]({ nodeStates: { todos: [] } });

      const results = await Promise.all([first, second]);

      expect(results.map((r) => r.success)).toEqual([true, true]);
      expect(manager.backtrackCount).toBe(2);
    });

    it("handles rapid consecutive backtracks", async () => {
      const archive = createArchive(async () => ({ nodeStates: { todos: [] } }));
      const manager = new BacktrackManager({
        archive,
        logger: createLogger(),
        emit: vi.fn(),
        maxBacktracks: 3,
      });
      const state = createState();

      const results = [];
      for (const id of ["cp1", "cp2", "cp3"]) {
        results.push(await manager.backtrack(state, id));
      }

      expect(results.every((r) => r.success)).toBe(true);
      expect(manager.backtrackCount).toBe(3);
      expect(manager.remaining).toBe(0);
    });
  });

  describe("_getFallbackCheckpointId", () => {
    it("returns null for empty state and non-array checkpoints", () => {
      const manager = new BacktrackManager({ archive: createArchive() });

      expect(manager._getFallbackCheckpointId({})).toBe(null);
      expect(manager._getFallbackCheckpointId({ checkpoints: { length: 2 } })).toBe(
        null
      );
    });
  });

  describe("reset", () => {
    it("resets backtrack count to zero", () => {
      const manager = new BacktrackManager({
        archive: createArchive(),
        maxBacktracks: 2,
      });
      manager._backtrackCount = 2;

      manager.reset();

      expect(manager.backtrackCount).toBe(0);
      expect(manager.remaining).toBe(2);
    });
  });
});

describe("createBacktrackManager", () => {
  it("creates a BacktrackManager with provided options", () => {
    const archive = createArchive();
    const manager = createBacktrackManager({ archive, maxBacktracks: 4 });

    expect(manager).toBeInstanceOf(BacktrackManager);
    expect(manager.archive).toBe(archive);
    expect(manager.maxBacktracks).toBe(4);
  });
});
