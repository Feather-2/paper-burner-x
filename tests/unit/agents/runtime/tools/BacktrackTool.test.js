import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  randomUUID: vi.fn(() => "mock-uuid"),
}));

vi.mock("node:crypto", () => ({
  randomUUID: mocks.randomUUID,
}));

import { randomUUID } from "node:crypto";
import {
  createBacktrackTool,
  BACKTRACK_TOOL_DEFINITION,
} from "../../../../../js/agents/runtime/tools/BacktrackTool.js";

describe("createBacktrackTool", () => {
  let backtrackManager;
  let logger;
  let emit;
  let context;
  let handler;

  beforeEach(() => {
    backtrackManager = { prepareBacktrack: vi.fn() };
    logger = { warn: vi.fn(), error: vi.fn() };
    emit = vi.fn();
    context = { logger, emit };
    handler = createBacktrackTool({ backtrackManager });
    mocks.randomUUID.mockClear();
  });

  it("throws when backtrackManager is missing or falsy", () => {
    const values = [null, undefined, 0, "", false];

    values.forEach((value) => {
      expect(() => createBacktrackTool({ backtrackManager: value }))
        .toThrow("BacktrackTool requires a BacktrackManager instance");
    });
  });

  it("returns error when prepareBacktrack is missing on manager", async () => {
    const managers = [{}, []];

    for (const manager of managers) {
      const localHandler = createBacktrackTool({ backtrackManager: manager });
      const localLogger = { warn: vi.fn(), error: vi.fn() };
      const localEmit = vi.fn();

      const result = await localHandler({ reason: "missing" }, {
        logger: localLogger,
        emit: localEmit,
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain("Backtrack error");
      expect(localLogger.error).toHaveBeenCalledTimes(1);
      expect(localEmit).toHaveBeenCalledWith("agent:backtrackFailed", {
        checkpoint_id: undefined,
        error: expect.any(String),
      });
    }
  });

  it("returns a backtrack signal and emits requested on success", async () => {
    mocks.randomUUID.mockReturnValueOnce("checkpoint-123");
    const checkpointId = randomUUID();

    backtrackManager.prepareBacktrack.mockResolvedValue({
      success: true,
      checkpointId,
      state: { step: 1 },
    });

    const args = {
      reason: "bad branch",
      checkpoint_id: "cp-1",
      hint: "try alt",
    };

    const result = await handler(args, context);

    expect(randomUUID).toHaveBeenCalledTimes(1);
    expect(backtrackManager.prepareBacktrack).toHaveBeenCalledWith("cp-1");
    expect(logger.warn).toHaveBeenCalledWith("模型请求回溯: bad branch", {
      checkpoint_id: "cp-1",
      hint: "try alt",
    });
    expect(emit).toHaveBeenCalledWith("agent:backtrackRequested", {
      checkpointId,
      state: { step: 1 },
      reason: "bad branch",
      hint: "try alt",
    });
    expect(result).toEqual({
      ok: true,
      backtrack: {
        checkpointId,
        state: { step: 1 },
        reason: "bad branch",
        hint: "try alt",
      },
    });
  });

  it("returns error and emits failure when prepareBacktrack reports failure", async () => {
    backtrackManager.prepareBacktrack.mockResolvedValue({
      success: false,
      reason: "no checkpoint",
    });

    const result = await handler({
      reason: "dead end",
      checkpoint_id: "cp-2",
    }, context);

    expect(result).toEqual({
      ok: false,
      error: "Backtrack failed: no checkpoint",
    });
    expect(emit).toHaveBeenCalledWith("agent:backtrackFailed", {
      checkpoint_id: "cp-2",
      reason: "no checkpoint",
    });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("handles errors thrown by prepareBacktrack", async () => {
    backtrackManager.prepareBacktrack.mockRejectedValue(new Error("boom"));

    const result = await handler({
      reason: "fail",
      checkpoint_id: "cp-3",
    }, context);

    expect(result).toEqual({
      ok: false,
      error: "Backtrack error: boom",
    });
    expect(logger.error).toHaveBeenCalledWith(
      "Backtrack prepareBacktrack failed: boom",
    );
    expect(emit).toHaveBeenCalledWith("agent:backtrackFailed", {
      checkpoint_id: "cp-3",
      error: "boom",
    });
  });

  it("stringifies non-Error thrown values", async () => {
    backtrackManager.prepareBacktrack.mockRejectedValue("oops");

    const result = await handler({
      reason: "fail",
      checkpoint_id: "cp-4",
    }, context);

    expect(result).toEqual({
      ok: false,
      error: "Backtrack error: oops",
    });
    expect(logger.error).toHaveBeenCalledWith(
      "Backtrack prepareBacktrack failed: oops",
    );
    expect(emit).toHaveBeenCalledWith("agent:backtrackFailed", {
      checkpoint_id: "cp-4",
      error: "oops",
    });
  });

  it("handles empty args object without crashing", async () => {
    backtrackManager.prepareBacktrack.mockResolvedValue({
      success: true,
      checkpointId: "empty",
      state: null,
    });

    const result = await handler({}, context);

    expect(result.ok).toBe(true);
    expect(result.backtrack.reason).toBe(undefined);
    expect(result.backtrack.hint).toBe(undefined);
    expect(logger.warn).toHaveBeenCalledWith("模型请求回溯: undefined", {
      checkpoint_id: undefined,
      hint: undefined,
    });
  });

  it("accepts boundary checkpoint_id values and passes them through", async () => {
    const values = [
      null,
      undefined,
      "",
      "   ",
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      "123",
      [],
      {},
      { 0: "array", length: 1 },
    ];

    backtrackManager.prepareBacktrack.mockResolvedValue({
      success: true,
      checkpointId: "cp",
      state: {},
    });

    for (const value of values) {
      const result = await handler({
        reason: "ok",
        checkpoint_id: value,
        hint: "",
      }, context);

      expect(result.ok).toBe(true);
    }

    expect(backtrackManager.prepareBacktrack).toHaveBeenCalledTimes(values.length);
    values.forEach((value, index) => {
      expect(backtrackManager.prepareBacktrack.mock.calls[index][0]).toBe(value);
    });
  });

  it("handles whitespace reason and empty hint values", async () => {
    backtrackManager.prepareBacktrack.mockResolvedValue({
      success: true,
      checkpointId: "cp-whitespace",
      state: { ok: true },
    });

    const args = {
      reason: "   ",
      checkpoint_id: "cp-5",
      hint: "",
    };

    const result = await handler(args, context);

    expect(result.ok).toBe(true);
    expect(result.backtrack.reason).toBe("   ");
    expect(result.backtrack.hint).toBe("");
    expect(logger.warn).toHaveBeenCalledWith("模型请求回溯:    ", {
      checkpoint_id: "cp-5",
      hint: "",
    });
  });

  it("handles rapid consecutive calls without shared state", async () => {
    backtrackManager.prepareBacktrack
      .mockResolvedValueOnce({ success: true, checkpointId: "cp-1", state: { step: 1 } })
      .mockResolvedValueOnce({ success: true, checkpointId: "cp-2", state: { step: 2 } });

    const first = await handler({ reason: "first", checkpoint_id: "a" }, context);
    const second = await handler({ reason: "second", checkpoint_id: "b" }, context);

    expect(first.backtrack.checkpointId).toBe("cp-1");
    expect(second.backtrack.checkpointId).toBe("cp-2");
    expect(backtrackManager.prepareBacktrack).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenCalledTimes(2);
  });

  it("handles concurrent calls independently", async () => {
    backtrackManager.prepareBacktrack
      .mockResolvedValueOnce({ success: true, checkpointId: "cp-a", state: { step: "a" } })
      .mockResolvedValueOnce({ success: true, checkpointId: "cp-b", state: { step: "b" } });

    const firstCall = handler({ reason: "first", checkpoint_id: "a" }, context);
    const secondCall = handler({ reason: "second", checkpoint_id: "b" }, context);

    const [firstResult, secondResult] = await Promise.all([firstCall, secondCall]);

    expect(firstResult.backtrack.checkpointId).toBe("cp-a");
    expect(secondResult.backtrack.checkpointId).toBe("cp-b");
    expect(backtrackManager.prepareBacktrack).toHaveBeenCalledTimes(2);
    expect(backtrackManager.prepareBacktrack.mock.calls[0][0]).toBe("a");
    expect(backtrackManager.prepareBacktrack.mock.calls[1][0]).toBe("b");
  });

  it("accepts large payloads and deep nested state", async () => {
    const hugeContent = "x".repeat(1024 * 1024);
    const deepNested = {
      level0: {
        level1: {
          level2: {
            level3: {
              level4: { value: "deep" },
            },
          },
        },
      },
    };

    backtrackManager.prepareBacktrack.mockResolvedValue({
      success: true,
      checkpointId: "cp-large",
      state: {
        hugeFile: { name: "huge.bin", content: hugeContent },
        deepNested,
      },
    });

    const result = await handler({
      reason: "large",
      checkpoint_id: "cp-large",
      hint: hugeContent,
    }, context);

    expect(result.ok).toBe(true);
    expect(result.backtrack.state.hugeFile.content.length).toBe(hugeContent.length);
    expect(result.backtrack.state.deepNested.level0.level1.level2.level3.level4.value)
      .toBe("deep");
  });
});

describe("BACKTRACK_TOOL_DEFINITION", () => {
  it("exposes the expected schema shape", () => {
    expect(BACKTRACK_TOOL_DEFINITION).toMatchObject({
      name: "Backtrack",
      description: expect.any(String),
      parameters: {
        type: "object",
        required: ["reason"],
        properties: {
          reason: {
            type: "string",
          },
          checkpoint_id: {
            type: "string",
          },
          hint: {
            type: "string",
          },
        },
      },
    });
  });

  it("keeps required fields minimal and stable", () => {
    expect(BACKTRACK_TOOL_DEFINITION.parameters.required).toEqual(["reason"]);
  });
});
