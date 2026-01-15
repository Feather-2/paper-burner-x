import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all external deps: states/constants/tools/history/utils.
vi.mock("../../../../js/agents/stages/design/states.js", () => {
  const EditSessionStatus = {
    IDLE: "idle",
    AWAITING_INPUT: "awaiting_input",
    PROCESSING: "processing",
    EXECUTING: "executing",
  };
  const editSessionMachine = {
    transition: vi.fn((session, to) => {
      session.status = to;
      return true;
    }),
  };
  return { EditSessionStatus, editSessionMachine };
});

vi.mock("../../../../js/agents/stages/design/constants.js", () => {
  return {
    EditOperationType: {
      UNDO: "undo",
      REDO: "redo",
      ADD_SLIDE: "add_slide",
      DELETE_SLIDE: "delete_slide",
    },
  };
});

vi.mock("../../../../js/agents/stages/design/edit-mode/tools.js", () => {
  return {
    EditModeTools: { undo: { description: "Undo" }, redo: { description: "Redo" } },
    createEditToolExecutor: vi.fn(() => vi.fn(async () => ({ success: true }))),
  };
});

vi.mock("../../../../js/agents/stages/design/edit-mode/history.js", () => {
  class EditHistoryManager {
    constructor() {
      this.beginTransaction = vi.fn();
      this.commit = vi.fn();
      this.rollback = vi.fn();
    }
  }
  return { EditHistoryManager };
});

vi.mock("../../../../js/agents/stages/design/shared/design-utils.js", () => {
  return {
    isPlainObject: vi.fn((v) => Boolean(v) && typeof v === "object" && !Array.isArray(v)),
  };
});

import { EditSessionStatus } from "../../../../js/agents/stages/design/states.js";
import { EditOperationType } from "../../../../js/agents/stages/design/constants.js";
import { createEditToolExecutor } from "../../../../js/agents/stages/design/edit-mode/tools.js";
import { EditModeAgentLoop } from "../../../../js/agents/stages/design/edit-mode/edit-loop.js";

describe("design/edit-mode/edit-loop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when initialState is not an object (edge)", async () => {
    const loop = new EditModeAgentLoop({ waitForUserAction: vi.fn() });
    await expect(loop.run(null)).rejects.toBeInstanceOf(TypeError);
  });

  it("requires waitForUserAction or actions queue", async () => {
    const loop = new EditModeAgentLoop();
    await expect(loop.run({ slides: [] }, {})).rejects.toThrow("Edit loop requires waitForUserAction or actions queue");
  });

  it("transitions IDLE -> AWAITING_INPUT and back to IDLE on exit", async () => {
    const onSessionTransition = vi.fn();
    const emit = vi.fn();
    const loop = new EditModeAgentLoop();

    const state = await loop.run(
      { slides: [], editSession: { status: EditSessionStatus.IDLE } },
      {
        actions: [{ type: "exit" }],
        onSessionTransition,
        emit,
      }
    );

    expect(state.editSession.status).toBe(EditSessionStatus.IDLE);
    expect(onSessionTransition).toHaveBeenCalledWith(EditSessionStatus.IDLE, EditSessionStatus.AWAITING_INPUT);
    expect(onSessionTransition).toHaveBeenCalledWith(EditSessionStatus.AWAITING_INPUT, EditSessionStatus.IDLE);
    expect(emit).toHaveBeenCalledWith("edit.session.transition", { from: EditSessionStatus.IDLE, to: EditSessionStatus.AWAITING_INPUT });
  });

  it("handles element_selected by updating selectedElementId and prompting user", async () => {
    const chat = { send: vi.fn(async () => {}) };
    const emit = vi.fn();
    const loop = new EditModeAgentLoop();

    const state = await loop.run(
      { slides: [], editSession: { status: EditSessionStatus.IDLE } },
      {
        actions: [{ type: "element_selected", elementId: "el1" }, { type: "exit" }],
        chat,
        emit,
      }
    );

    expect(state.selectedElementId).toBe("el1");
    expect(emit).toHaveBeenCalledWith("edit.element.selected", { elementId: "el1" });
    expect(chat.send).toHaveBeenCalled();
  });

  it("chat_message uses intentParser when provided and supports clarification flow", async () => {
    const chat = { send: vi.fn(async () => {}) };
    const intentParser = vi.fn(async () => ({
      needsClarification: true,
      clarificationQuestion: "Clarify?",
      operations: [],
    }));
    const loop = new EditModeAgentLoop({ intentParser });

    await loop.run(
      { slides: [{ htmlDsl: "<s/>" }], currentSlideIndex: 0, editSession: { status: EditSessionStatus.IDLE } },
      {
        actions: [{ type: "chat_message", message: "hi" }, { type: "exit" }],
        chat,
        toolExecutor: vi.fn(async () => ({ success: true })),
      }
    );

    expect(intentParser).toHaveBeenCalled();
    expect(chat.send).toHaveBeenCalledWith({ message: "Clarify?" });
  });

  it("chat_message rolls back and reports errors when a tool fails (edge)", async () => {
    const historyManager = { beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn() };
    const canvasBridge = { dslToCanvas: vi.fn(async () => {}) };
    const chat = { send: vi.fn(async () => {}) };
    const emit = vi.fn();

    const toolExecutor = vi
      .fn()
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false, error: "boom" });

    const intentParser = vi.fn(async () => ({
      operations: [
        { tool: "t1", params: {} },
        { tool: "t2", params: {} },
      ],
      response: "done",
    }));

    const loop = new EditModeAgentLoop({ intentParser });
    const state = { slides: [{ htmlDsl: "<dsl/>" }], currentSlideIndex: 0, editSession: { status: EditSessionStatus.IDLE } };

    await loop.run(state, {
      actions: [{ type: "chat_message", text: "do" }, { type: "exit" }],
      historyManager,
      canvasBridge,
      chat,
      emit,
      toolExecutor,
    });

    expect(historyManager.beginTransaction).toHaveBeenCalled();
    expect(historyManager.rollback).toHaveBeenCalled();
    expect(historyManager.commit).not.toHaveBeenCalled();
    expect(chat.send).toHaveBeenCalledWith({ message: expect.stringContaining("操作失败") });
    expect(canvasBridge.dslToCanvas).not.toHaveBeenCalled();
  });

  it("chat_message commits changes and syncs canvas on success", async () => {
    const historyManager = { beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn() };
    const canvasBridge = { dslToCanvas: vi.fn(async () => {}) };
    const chat = { send: vi.fn(async () => {}) };

    const toolExecutor = vi.fn(async () => ({ success: true }));
    const intentParser = vi.fn(async () => ({
      operations: [
        { tool: "t1", params: {} },
        { tool: "t2", params: {} },
      ],
      response: "done",
    }));

    const loop = new EditModeAgentLoop({ intentParser });
    const state = { slides: [{ htmlDsl: "<dsl/>" }], currentSlideIndex: 0, editSession: { status: EditSessionStatus.IDLE } };

    await loop.run(state, {
      actions: [{ type: "chat_message", text: "do" }, { type: "exit" }],
      historyManager,
      canvasBridge,
      chat,
      toolExecutor,
    });

    expect(historyManager.beginTransaction).toHaveBeenCalledTimes(1);
    expect(historyManager.commit).toHaveBeenCalledTimes(1);
    expect(historyManager.rollback).not.toHaveBeenCalled();
    expect(canvasBridge.dslToCanvas).toHaveBeenCalledWith("<dsl/>", state);
    expect(chat.send).toHaveBeenCalledWith({ message: "done" });
  });

  it("quick_action maps undo/redo/add_slide/delete_slide to EditOperationType tools", async () => {
    const toolExecutor = vi.fn(async () => ({ success: true }));
    const loop = new EditModeAgentLoop();

    await loop.run(
      { slides: [{ htmlDsl: "<dsl/>" }], currentSlideIndex: 0, editSession: { status: EditSessionStatus.IDLE } },
      {
        actions: [
          { action: "undo" },
          { action: "redo" },
          { action: "add_slide" },
          { action: "delete_slide" },
          { type: "exit" },
        ],
        toolExecutor,
      }
    );

    expect(toolExecutor).toHaveBeenCalledWith(EditOperationType.UNDO, {});
    expect(toolExecutor).toHaveBeenCalledWith(EditOperationType.REDO, {});
    expect(toolExecutor).toHaveBeenCalledWith(EditOperationType.ADD_SLIDE, expect.any(Object));
    expect(toolExecutor).toHaveBeenCalledWith(EditOperationType.DELETE_SLIDE, expect.any(Object));
  });

  it("_interpretIntent falls back to modelRouter.chat when no intentParser and validates JSON", async () => {
    const modelRouter = {
      chat: vi.fn(async () => JSON.stringify({ understanding: "u", operations: [], response: "ok" })),
    };
    const loop = new EditModeAgentLoop({ modelRouter });

    const parsed = await loop._interpretIntent({
      userMessage: "hi",
      currentDsl: "<dsl/>",
      screenshot: null,
      state: { slides: [] },
      selectedElement: null,
      modelRouter,
      intentParser: null,
    });
    expect(parsed.response).toBe("ok");

    modelRouter.chat.mockResolvedValueOnce("not json");
    await expect(
      loop._interpretIntent({
        userMessage: "hi",
        currentDsl: "<dsl/>",
        screenshot: null,
        state: { slides: [] },
        selectedElement: null,
        modelRouter,
        intentParser: null,
      })
    ).rejects.toThrow("Model response is not valid JSON");
  });

  it("uses toolExecutorFactory when toolExecutor not provided in context", async () => {
    const loop = new EditModeAgentLoop();
    await loop.run(
      { slides: [], editSession: { status: EditSessionStatus.IDLE } },
      { actions: [{ type: "exit" }] }
    );
    expect(createEditToolExecutor).toHaveBeenCalled();
  });
});
