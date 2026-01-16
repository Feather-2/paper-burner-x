import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../js/agents/stages/design/states.js", () => {
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

vi.mock("../../../../../js/agents/stages/design/constants.js", () => {
  return {
    EditOperationType: {
      UNDO: "undo",
      REDO: "redo",
      ADD_SLIDE: "add_slide",
      DELETE_SLIDE: "delete_slide",
    },
  };
});

vi.mock("../../../../../js/agents/stages/design/edit-mode/tools.js", () => {
  return {
    EditModeTools: { undo: { description: "Undo" }, redo: { description: "Redo" } },
    createEditToolExecutor: vi.fn(() => vi.fn(async () => ({ success: true }))),
  };
});

vi.mock("../../../../../js/agents/stages/design/edit-mode/history.js", () => {
  class EditHistoryManager {
    constructor() {
      this.beginTransaction = vi.fn();
      this.commit = vi.fn();
      this.rollback = vi.fn();
    }
  }
  return { EditHistoryManager };
});

vi.mock("../../../../../js/agents/stages/design/shared/design-utils.js", () => {
  return {
    isPlainObject: vi.fn((v) => Boolean(v) && typeof v === "object" && !Array.isArray(v)),
  };
});

import { EditSessionStatus } from "../../../../../js/agents/stages/design/states.js";
import { EditModeAgentLoop } from "../../../../../js/agents/stages/design/edit-mode/edit-loop.js";

describe("design/edit-mode/edit-loop edge cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips transition hooks when session machine declines transition", () => {
    const sessionMachine = { transition: vi.fn(() => false) };
    const loop = new EditModeAgentLoop({ sessionMachine });
    const session = { status: EditSessionStatus.IDLE };
    const state = { editSessionStatus: EditSessionStatus.IDLE };
    const onSessionTransition = vi.fn();
    const emit = vi.fn();

    const ok = loop._transitionSession(session, EditSessionStatus.AWAITING_INPUT, {
      state,
      emit,
      onSessionTransition,
    });

    expect(ok).toBe(false);
    expect(onSessionTransition).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
    expect(state.editSessionStatus).toBe(EditSessionStatus.IDLE);
  });

  it("falls back to slide HTML when toolExecutor cannot parse canvas context", async () => {
    const loop = new EditModeAgentLoop();
    const state = { currentSlideIndex: 0, slides: [{ htmlDsl: "<slide/>" }], currentDsl: "" };
    const toolExecutor = vi.fn(async (tool) => {
      if (tool === "parse_canvas_state") return { success: false };
      if (tool === "screenshot_current") return { success: false };
      return { success: false };
    });

    const result = await loop._captureCanvasContext({ state, toolExecutor });

    expect(result.currentDsl).toBe("<slide/>");
    expect(result.screenshot).toBe(null);
    expect(toolExecutor).toHaveBeenCalledWith("parse_canvas_state", {});
    expect(toolExecutor).toHaveBeenCalledWith("screenshot_current", {});
  });

  it("returns fallback intent when modelRouter is missing", async () => {
    const loop = new EditModeAgentLoop();
    const result = await loop._interpretIntent({
      userMessage: "hi",
      currentDsl: "<dsl/>",
      screenshot: null,
      state: { slides: [] },
      selectedElement: null,
      modelRouter: null,
      intentParser: null,
    });

    expect(result.operations).toEqual([]);
    expect(result.response).toEqual(expect.any(String));
    expect(result.understanding).toEqual(expect.any(String));
  });

  it("uses a default clarification message when intent omits the question", async () => {
    const loop = new EditModeAgentLoop();
    const session = { status: EditSessionStatus.IDLE };
    const state = { slides: [] };
    const historyManager = { beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn() };
    const chat = { send: vi.fn(async () => {}) };
    const toolExecutor = vi.fn(async () => ({ success: true }));

    vi.spyOn(loop, "_captureCanvasContext").mockResolvedValue({ currentDsl: "", screenshot: null });
    vi.spyOn(loop, "_interpretIntent").mockResolvedValue({ needsClarification: true });

    await loop._handleChatMessage({
      action: { message: "help" },
      state,
      session,
      selectedElement: null,
      historyManager,
      canvasBridge: null,
      modelRouter: null,
      chat,
      emit: null,
      intentParser: null,
      toolExecutor,
      onSessionTransition: vi.fn(),
    });

    expect(chat.send).toHaveBeenCalledWith({ message: expect.any(String) });
    expect(historyManager.beginTransaction).not.toHaveBeenCalled();
    expect(historyManager.commit).not.toHaveBeenCalled();
    expect(historyManager.rollback).not.toHaveBeenCalled();
  });

  it("rolls back when toolExecutor throws during execution", async () => {
    const loop = new EditModeAgentLoop();
    const session = { status: EditSessionStatus.IDLE };
    const state = { slides: [{ htmlDsl: "<dsl/>" }], currentSlideIndex: 0 };
    const historyManager = { beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn() };
    const chat = { send: vi.fn(async () => {}) };
    const toolExecutor = vi.fn(async () => {
      throw new Error("boom");
    });

    vi.spyOn(loop, "_captureCanvasContext").mockResolvedValue({ currentDsl: "<dsl/>", screenshot: null });
    vi.spyOn(loop, "_interpretIntent").mockResolvedValue({
      operations: [{ tool: "t1", params: {} }],
      response: "done",
    });

    await loop._handleChatMessage({
      action: { text: "run" },
      state,
      session,
      selectedElement: null,
      historyManager,
      canvasBridge: null,
      modelRouter: null,
      chat,
      emit: null,
      intentParser: null,
      toolExecutor,
      onSessionTransition: vi.fn(),
    });

    expect(historyManager.beginTransaction).toHaveBeenCalledTimes(1);
    expect(historyManager.rollback).toHaveBeenCalledTimes(1);
    expect(historyManager.commit).not.toHaveBeenCalled();
    expect(chat.send).toHaveBeenCalledWith({ message: expect.stringContaining("boom") });
  });
});
