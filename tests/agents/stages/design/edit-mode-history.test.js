import { describe, it, expect, vi } from "vitest";

import { EditHistoryManager } from "../../../../js/agents/stages/design/edit-mode/history.js";

describe("design/edit-mode/history (branches)", () => {
  it("returns null at undo/redo boundaries and tolerates no-op operations", () => {
    const mgr = new EditHistoryManager();

    expect(mgr.undo()).toBeNull();
    expect(mgr.redo()).toBeNull();

    const op = {};
    mgr.push(op);

    const entry = mgr.undo();
    expect(entry).toEqual(
      expect.objectContaining({
        operations: [op],
        timestamp: expect.any(Number),
      }),
    );
    expect(mgr.history).toHaveLength(0);
    expect(mgr.redoStack).toHaveLength(1);

    const redone = mgr.redo();
    expect(redone).toBe(entry);
    expect(mgr.history).toHaveLength(1);
    expect(mgr.redoStack).toHaveLength(0);
  });

  it("merges transaction operations and clears redo stack on commit", () => {
    const mgr = new EditHistoryManager();
    const op = { undo: vi.fn(), redo: vi.fn() };
    mgr.push(op);

    const undone = mgr.undo();
    expect(undone).toEqual(
      expect.objectContaining({
        operations: [op],
        timestamp: expect.any(Number),
      }),
    );
    expect(mgr.redoStack).toHaveLength(1);
    expect(mgr.redoStack[0]).toBe(undone);

    const op1 = { undo: vi.fn(), redo: vi.fn(), id: "a" };
    const op2 = { undo: vi.fn(), redo: vi.fn(), id: "b" };

    expect(mgr.beginTransaction()).toBe(true);
    mgr.push(op1);
    mgr.push(op2);
    expect(mgr.commit()).toBe(true);

    expect(mgr.redoStack).toHaveLength(0);
    expect(mgr.history).toHaveLength(1);
    expect(mgr.history[0].operations).toEqual([op1, op2]);
  });

  it("enforces maxHistory by trimming oldest entries", () => {
    const mgr = new EditHistoryManager(2);
    const op1 = { undo: vi.fn(), redo: vi.fn(), id: 1 };
    const op2 = { undo: vi.fn(), redo: vi.fn(), id: 2 };
    const op3 = { undo: vi.fn(), redo: vi.fn(), id: 3 };

    mgr.push(op1);
    mgr.push(op2);
    mgr.push(op3);

    expect(mgr.history).toHaveLength(2);
    expect(mgr.history[0].operations[0]).toBe(op2);
    expect(mgr.history[1].operations[0]).toBe(op3);
  });
});
