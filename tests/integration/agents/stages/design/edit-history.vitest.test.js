import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../js/agents/shared/utils/value-utils.js", () => {
  return {
    isPlainObject: vi.fn((v) => Boolean(v) && typeof v === "object" && !Array.isArray(v)),
  };
});

import { EditHistoryManager } from "../../../../js/agents/stages/design/edit-mode/history.js";

describe("design/edit-mode/history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("push ignores non-objects and clears redo stack on new entries", () => {
    const mgr = new EditHistoryManager();
    expect(mgr.push(null)).toBe(false);
    expect(mgr.history).toHaveLength(0);

    const undo = vi.fn();
    const redo = vi.fn();
    mgr.push({ undo, redo });
    expect(mgr.history).toHaveLength(1);

    // Seed redo stack via undo then ensure new push clears it.
    mgr.undo();
    expect(mgr.redoStack).toHaveLength(1);

    mgr.push({ undo: vi.fn(), redo: vi.fn() });
    expect(mgr.redoStack).toHaveLength(0);
  });

  it("supports transaction batching: beginTransaction/commit and beginTransaction/rollback", () => {
    const undo1 = vi.fn();
    const redo1 = vi.fn();
    const undo2 = vi.fn();
    const redo2 = vi.fn();

    const mgr = new EditHistoryManager();
    expect(mgr.beginTransaction()).toBe(true);
    expect(mgr.beginTransaction()).toBe(false);

    mgr.push({ undo: undo1, redo: redo1 });
    mgr.push({ undo: undo2, redo: redo2 });

    expect(mgr.commit()).toBe(true);
    expect(mgr.history).toHaveLength(1);
    expect(mgr.history[0].operations).toHaveLength(2);

    expect(mgr.rollback()).toBe(false);

    // Rollback executes undo for operations added in the transaction.
    mgr.beginTransaction();
    mgr.push({ undo: undo1, redo: redo1 });
    mgr.push({ undo: undo2, redo: redo2 });
    expect(mgr.rollback()).toBe(true);
    expect(undo2).toHaveBeenCalledTimes(1);
    expect(undo1).toHaveBeenCalledTimes(1);
  });

  it("undo/redo execute operations in correct order and moves entries between stacks", () => {
    const undoA = vi.fn();
    const redoA = vi.fn();
    const undoB = vi.fn();
    const redoB = vi.fn();

    const mgr = new EditHistoryManager();
    mgr.beginTransaction();
    mgr.push({ undo: undoA, redo: redoA });
    mgr.push({ undo: undoB, redo: redoB });
    mgr.commit();

    const entry = mgr.undo();
    expect(entry).toEqual(
      expect.objectContaining({
        operations: [
          { undo: undoA, redo: redoA },
          { undo: undoB, redo: redoB },
        ],
        timestamp: expect.any(Number),
      }),
    );
    // Undo runs in reverse order.
    expect(undoB).toHaveBeenCalledTimes(1);
    expect(undoA).toHaveBeenCalledTimes(1);
    expect(mgr.redoStack).toHaveLength(1);

    const redone = mgr.redo();
    expect(redone).toEqual(
      expect.objectContaining({
        operations: [
          { undo: undoA, redo: redoA },
          { undo: undoB, redo: redoB },
        ],
        timestamp: expect.any(Number),
      }),
    );
    expect(redoA).toHaveBeenCalledTimes(1);
    expect(redoB).toHaveBeenCalledTimes(1);
    expect(mgr.redoStack).toHaveLength(0);
  });

  it("falls back to onUndo/onRedo when operation has no explicit undo/redo", () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    const mgr = new EditHistoryManager(50, { onUndo, onRedo });

    mgr.push({});
    mgr.undo();
    expect(onUndo).toHaveBeenCalledTimes(1);

    mgr.redo();
    expect(onRedo).toHaveBeenCalledTimes(1);
  });

  it("trims history to maxHistory", () => {
    const mgr = new EditHistoryManager(1);
    mgr.push({ undo: vi.fn(), redo: vi.fn() });
    mgr.push({ undo: vi.fn(), redo: vi.fn() });
    expect(mgr.history).toHaveLength(1);
  });
});
