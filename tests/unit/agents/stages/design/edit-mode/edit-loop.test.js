// EditModeAgentLoop tests cover run flow, intent parsing, and boundary/error handling.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../../js/agents/stages/design/states.js", () => {
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

vi.mock("../../../../../../js/agents/stages/design/constants.js", () => {
  return {
    EditOperationType: {
      UNDO: "undo",
      REDO: "redo",
      ADD_SLIDE: "add_slide",
      DELETE_SLIDE: "delete_slide",
    },
  };
});

vi.mock("../../../../../../js/agents/stages/design/edit-mode/tools.js", () => {
  return {
    EditModeTools: {
      noop: { description: "No-op", params: {} },
    },
    createEditToolExecutor: vi.fn(() => vi.fn(async () => ({ success: true }))),
  };
});

vi.mock("../../../../../../js/agents/stages/design/edit-mode/history.js", () => {
  class EditHistoryManager {
    constructor() {
      this.beginTransaction = vi.fn();
      this.commit = vi.fn();
      this.rollback = vi.fn();
    }
  }
  return { EditHistoryManager };
});

vi.mock("../../../../../../js/agents/stages/design/shared/design-utils.js", () => {
  return {
    isPlainObject: vi.fn((v) => Boolean(v) && typeof v === "object" && !Array.isArray(v)),
  };
});

import { EditSessionStatus } from "../../../../../../js/agents/stages/design/states.js";
import { EditOperationType } from "../../../../../../js/agents/stages/design/constants.js";
import * as editLoopModule from "../../../../../../js/agents/stages/design/edit-mode/edit-loop.js";

const { EditModeAgentLoop } = editLoopModule;

const LONG_STRING = "x".repeat(50_001);

const makeState = (overrides = {}) => ({
  slides: [{ htmlDsl: "<slide/>" }],
  currentSlideIndex: 0,
  ...overrides,
});

const makeSession = (status = EditSessionStatus.IDLE) => ({ status });

const makeDeepObject = (depth) => {
  let root = {};
  let cursor = root;
  for (let i = 0; i < depth; i += 1) {
    cursor.child = {};
    cursor = cursor.child;
  }
  return root;
};

const makeOps = (count) => Array.from({ length: count }, () => ({ tool: "noop" }));

describe("EditModeAgentLoop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("run", () => {
    it("initializes defaults for empty state, slides, and session", async () => {
      const loop = new EditModeAgentLoop();
      const emptyState = {};
      const badSlidesState = { slides: {}, editSession: {} };

      const result = await loop.run(emptyState, { actions: [] });
      const resultWithBadSlides = await loop.run(badSlidesState, { actions: [] });

      expect(result.slides).toEqual([]);
      expect(result.editSession).toEqual(expect.objectContaining({ status: EditSessionStatus.IDLE }));
      expect(result.editSessionStatus).toBe(EditSessionStatus.IDLE);
      expect(resultWithBadSlides.slides).toEqual([]);
      expect(resultWithBadSlides.editSession.status).toBe(EditSessionStatus.IDLE);
    });

    it("rejects invalid initialState values", async () => {
      const loop = new EditModeAgentLoop();
      const invalidStates = [null, undefined, "", [], 0];

      for (const invalidState of invalidStates) {
        await expect(loop.run(invalidState, { actions: [] })).rejects.toThrow(TypeError);
      }
    });

    it("throws when waitForUserAction is missing", async () => {
      const loop = new EditModeAgentLoop();
      const state = { slides: [] };

      await expect(loop.run(state, { actions: {} })).rejects.toThrow(/waitForUserAction/);
      await expect(loop.run(state, { actions: null })).rejects.toThrow(/waitForUserAction/);
    });

    it("honors maxTurns=0 and skips queued actions", async () => {
      const loop = new EditModeAgentLoop({ maxTurns: 0 });
      const toolExecutor = vi.fn(async () => ({ success: true }));
      const chat = { send: vi.fn(async () => {}) };

      const result = await loop.run({ slides: [] }, {
        actions: [{ type: "chat_message", message: "hi" }],
        toolExecutor,
        chat,
      });

      expect(toolExecutor).not.toHaveBeenCalled();
      expect(chat.send).not.toHaveBeenCalled();
      expect(result.editSession.status).toBe(EditSessionStatus.IDLE);
    });

    it("handles rapid consecutive chat messages", async () => {
      const loop = new EditModeAgentLoop();
      loop._handleChatMessage = vi.fn(async () => {});

      await loop.run({ slides: [] }, {
        actions: [
          { type: "chat_message", message: "one" },
          { type: "chat_message", message: "two" },
        ],
        toolExecutor: vi.fn(async () => ({ success: true })),
      });

      expect(loop._handleChatMessage).toHaveBeenCalledTimes(2);
      expect(loop._handleChatMessage.mock.calls[0][0].action.message).toBe("one");
      expect(loop._handleChatMessage.mock.calls[1][0].action.message).toBe("two");
    });

    it("stores null selectedElementId for empty element_selected and emits", async () => {
      const loop = new EditModeAgentLoop();
      const chat = { send: vi.fn(async () => {}) };
      const emit = vi.fn();
      const state = { slides: [], selectedElementId: "prev" };

      const result = await loop.run(state, {
        actions: [{ type: "element_selected", elementId: "" }, { type: "exit" }],
        chat,
        emit,
      });

      expect(result.selectedElementId).toBe(null);
      expect(chat.send).toHaveBeenCalledWith({ message: expect.any(String) });
      expect(emit).toHaveBeenCalledWith("edit:element.selected", { elementId: null });
    });

    it("handles back-to-back quick actions", async () => {
      const loop = new EditModeAgentLoop();
      const toolExecutor = vi.fn(async () => ({ success: true }));
      const canvasBridge = { dslToCanvas: vi.fn(async () => {}) };
      const state = makeState();

      await loop.run(state, {
        actions: [{ action: "undo" }, { action: "redo" }, { type: "exit" }],
        toolExecutor,
        canvasBridge,
      });

      expect(toolExecutor.mock.calls[0][0]).toBe(EditOperationType.UNDO);
      expect(toolExecutor.mock.calls[1][0]).toBe(EditOperationType.REDO);
      expect(canvasBridge.dslToCanvas).toHaveBeenCalledTimes(2);
    });

    it("skips empty and whitespace action types", async () => {
      const loop = new EditModeAgentLoop();
      loop._handleChatMessage = vi.fn();
      loop._handleQuickAction = vi.fn();

      await loop.run({ slides: [] }, {
        actions: [{ type: "" }, { type: "   " }, { type: "exit" }],
      });

      expect(loop._handleChatMessage).not.toHaveBeenCalled();
      expect(loop._handleQuickAction).not.toHaveBeenCalled();
    });
  });

  describe("_transitionSession", () => {
    it("skips hooks when transition is declined", () => {
      const sessionMachine = { transition: vi.fn(() => false) };
      const loop = new EditModeAgentLoop({ sessionMachine });
      const session = makeSession();
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

    it("updates state and emits on success", () => {
      const sessionMachine = {
        transition: vi.fn((session, to) => {
          session.status = to;
          return true;
        }),
      };
      const loop = new EditModeAgentLoop({ sessionMachine });
      const session = makeSession();
      const state = { editSessionStatus: EditSessionStatus.IDLE };
      const onSessionTransition = vi.fn();
      const emit = vi.fn();

      const ok = loop._transitionSession(session, EditSessionStatus.AWAITING_INPUT, {
        state,
        emit,
        onSessionTransition,
      });

      expect(ok).toBe(true);
      expect(state.editSessionStatus).toBe(EditSessionStatus.AWAITING_INPUT);
      expect(onSessionTransition).toHaveBeenCalledWith(EditSessionStatus.IDLE, EditSessionStatus.AWAITING_INPUT);
      expect(emit).toHaveBeenCalledWith("edit:session.transition", {
        from: EditSessionStatus.IDLE,
        to: EditSessionStatus.AWAITING_INPUT,
      });
    });
  });

  describe("_captureCanvasContext", () => {
    it("prefers toolExecutor results", async () => {
      const loop = new EditModeAgentLoop();
      const state = makeState({ currentDsl: "" });
      const toolExecutor = vi.fn(async (tool) => {
        if (tool === "parse_canvas_state") return { success: true, data: { dsl: "<dsl/>" } };
        if (tool === "screenshot_current") return { success: true, data: { image: "img" } };
        return { success: false };
      });

      const result = await loop._captureCanvasContext({ state, toolExecutor });

      expect(result.currentDsl).toBe("<dsl/>");
      expect(result.screenshot).toBe("img");
      expect(toolExecutor).toHaveBeenCalledWith("parse_canvas_state", {});
      expect(toolExecutor).toHaveBeenCalledWith("screenshot_current", {});
    });

    it("falls back to state.currentDsl when tool data is empty", async () => {
      const loop = new EditModeAgentLoop();
      const state = makeState({ currentDsl: "<state/>" });
      const toolExecutor = vi.fn(async () => ({ success: true }));

      const result = await loop._captureCanvasContext({ state, toolExecutor });

      expect(result.currentDsl).toBe("<state/>");
      expect(result.screenshot).toBe(null);
    });

    it("falls back to slide html when currentDsl is empty and tool data missing", async () => {
      const loop = new EditModeAgentLoop();
      const state = makeState({ currentDsl: "" });
      const toolExecutor = vi.fn(async () => ({ success: true }));

      const result = await loop._captureCanvasContext({ state, toolExecutor });

      expect(result.currentDsl).toBe("<slide/>");
      expect(result.screenshot).toBe(null);
    });

    it("uses canvasBridge and falls back to slide html", async () => {
      const loop = new EditModeAgentLoop();
      const state = makeState({ currentDsl: "" });
      const canvasBridge = {
        canvasToDsl: vi.fn(async () => ""),
        screenshot: vi.fn(async () => null),
      };

      const result = await loop._captureCanvasContext({ state, canvasBridge, toolExecutor: null });

      expect(result.currentDsl).toBe("<slide/>");
      expect(result.screenshot).toBe(null);
    });
  });

  describe("buildIntentPrompt", () => {
    it("includes tools, message, and DSL", () => {
      const tools = {
        tool_a: { description: "Do A" },
        tool_b: { description: "" },
      };
      const loop = new EditModeAgentLoop({ tools });

      const prompt = loop.buildIntentPrompt({
        state: { currentSlideIndex: 0 },
        selectedElement: null,
        userMessage: "   ",
        currentDsl: "<dsl/>",
      });

      expect(prompt).toContain("\"   \"");
      expect(prompt).toContain("<dsl/>");
      expect(prompt).toContain("- tool_a: Do A");
      expect(prompt).toContain("- tool_b:");
    });
  });

  describe("_interpretIntent", () => {
    it("uses custom intentParser", async () => {
      const tools = { tool_a: { description: "Do A" } };
      const intentParser = vi.fn(async (payload) => ({ ok: true, payload }));
      const loop = new EditModeAgentLoop({ tools });

      const result = await loop._interpretIntent({
        userMessage: null,
        currentDsl: "",
        screenshot: null,
        state: { slides: [] },
        selectedElement: null,
        modelRouter: null,
        intentParser,
      });

      expect(intentParser).toHaveBeenCalledWith(expect.objectContaining({ userMessage: null, tools }));
      expect(result.ok).toBe(true);
    });

    it("returns fallback when modelRouter is missing", async () => {
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

    it("accepts object payloads", async () => {
      const loop = new EditModeAgentLoop();
      const payload = { understanding: "", operations: [], response: "" };

      const result = await loop._interpretIntent({
        userMessage: "hi",
        currentDsl: "",
        screenshot: null,
        state: { slides: [] },
        selectedElement: null,
        modelRouter: { chat: async () => payload },
        intentParser: null,
      });

      expect(result).toEqual(payload);
    });

    it("parses valid JSON string responses", async () => {
      const loop = new EditModeAgentLoop();
      const payload = { understanding: "", operations: [], response: "" };

      const result = await loop._interpretIntent({
        userMessage: "hi",
        currentDsl: "",
        screenshot: null,
        state: { slides: [] },
        selectedElement: null,
        modelRouter: { chat: async () => JSON.stringify(payload) },
        intentParser: null,
      });

      expect(result).toEqual(payload);
    });

    it("rejects invalid or unsafe model responses", async () => {
      const loop = new EditModeAgentLoop();
      const baseArgs = {
        userMessage: "hi",
        currentDsl: "",
        screenshot: null,
        state: { slides: [] },
        selectedElement: null,
        intentParser: null,
      };
      const cases = [
        { response: "not-json" },
        { response: LONG_STRING },
        { response: { response: LONG_STRING } },
        { response: JSON.stringify({ operations: makeOps(51) }) },
        { response: JSON.stringify({ operations: [{ params: {} }] }) },
        { response: makeDeepObject(10) },
      ];

      for (const testCase of cases) {
        const modelRouter = { chat: async () => testCase.response };
        await expect(loop._interpretIntent({ ...baseArgs, modelRouter })).rejects.toThrow(
          "Model response is not valid JSON"
        );
      }
    });

    it("times out slow model responses", async () => {
      const loop = new EditModeAgentLoop();
      const modelRouter = { chat: vi.fn(() => new Promise(() => {})) };

      vi.useFakeTimers();
      try {
        const promise = loop._interpretIntent({
          userMessage: "hi",
          currentDsl: "",
          screenshot: null,
          state: { slides: [] },
          selectedElement: null,
          modelRouter,
          intentParser: null,
        });

        const expectation = expect(promise).rejects.toMatchObject({ name: "TimeoutError", code: "ETIMEDOUT" });
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(120_000);
        await expectation;
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("_handleChatMessage", () => {
    it("executes operations and commits", async () => {
      const tools = {
        apply_change: {
          description: "Apply",
          params: { count: "number", note: "string?" },
        },
      };
      const loop = new EditModeAgentLoop({ tools });
      const session = makeSession();
      const state = makeState();
      const historyManager = { beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn() };
      const canvasBridge = { dslToCanvas: vi.fn(async () => {}) };
      const chat = { send: vi.fn(async () => {}) };
      const toolExecutor = vi.fn(async () => ({ success: true }));

      loop._captureCanvasContext = vi.fn(async () => ({ currentDsl: "<dsl/>", screenshot: "img" }));
      loop._interpretIntent = vi.fn(async () => ({
        operations: [{ tool: "apply_change", params: { count: 1, note: "" } }],
        response: "ok",
      }));

      await loop._handleChatMessage({
        action: { text: "   " },
        state,
        session,
        selectedElement: null,
        historyManager,
        canvasBridge,
        modelRouter: null,
        chat,
        emit: null,
        intentParser: null,
        toolExecutor,
        onSessionTransition: null,
      });

      expect(loop._interpretIntent).toHaveBeenCalledWith(expect.objectContaining({ userMessage: "   " }));
      expect(historyManager.beginTransaction).toHaveBeenCalledTimes(1);
      expect(historyManager.commit).toHaveBeenCalledTimes(1);
      expect(historyManager.rollback).not.toHaveBeenCalled();
      expect(toolExecutor).toHaveBeenCalledWith("apply_change", { count: 1, note: "" });
      expect(canvasBridge.dslToCanvas).toHaveBeenCalledWith("<slide/>", state);
      expect(chat.send).toHaveBeenCalledWith({ message: "ok" });
      expect(session.status).toBe(EditSessionStatus.AWAITING_INPUT);
    });

    it("requests clarification and skips execution", async () => {
      const loop = new EditModeAgentLoop({ tools: { noop: { description: "noop" } } });
      const session = makeSession();
      const state = makeState();
      const historyManager = { beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn() };
      const chat = { send: vi.fn(async () => {}) };

      loop._captureCanvasContext = vi.fn(async () => ({ currentDsl: "", screenshot: null }));
      loop._interpretIntent = vi.fn(async () => ({
        needsClarification: true,
        clarificationQuestion: "Need details?",
      }));

      await loop._handleChatMessage({
        action: { message: "" },
        state,
        session,
        selectedElement: null,
        historyManager,
        canvasBridge: null,
        modelRouter: null,
        chat,
        emit: null,
        intentParser: null,
        toolExecutor: vi.fn(),
        onSessionTransition: null,
      });

      expect(chat.send).toHaveBeenCalledWith({ message: "Need details?" });
      expect(historyManager.beginTransaction).not.toHaveBeenCalled();
      expect(session.status).toBe(EditSessionStatus.AWAITING_INPUT);
    });

    it("rejects invalid param types", async () => {
      const tools = {
        edit_item: {
          description: "Edit",
          params: { count: "number", list: "array" },
        },
      };
      const loop = new EditModeAgentLoop({ tools });
      const session = makeSession();
      const state = makeState();
      const historyManager = { beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn() };
      const chat = { send: vi.fn(async () => {}) };

      loop._captureCanvasContext = vi.fn(async () => ({ currentDsl: "", screenshot: null }));
      loop._interpretIntent = vi.fn(async () => ({
        operations: [{ tool: "edit_item", params: { count: "1", list: {} } }],
        response: "ok",
      }));

      await loop._handleChatMessage({
        action: { message: "hi" },
        state,
        session,
        selectedElement: null,
        historyManager,
        canvasBridge: null,
        modelRouter: null,
        chat,
        emit: null,
        intentParser: null,
        toolExecutor: vi.fn(),
        onSessionTransition: null,
      });

      expect(historyManager.beginTransaction).not.toHaveBeenCalled();
      expect(chat.send).toHaveBeenCalledWith({ message: expect.stringContaining("Intent schema validation failed") });
    });

    it("rolls back on tool failure", async () => {
      const tools = {
        apply_change: {
          description: "Apply",
          params: { count: "number" },
        },
      };
      const loop = new EditModeAgentLoop({ tools });
      const session = makeSession();
      const state = makeState();
      const historyManager = { beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn() };
      const chat = { send: vi.fn(async () => {}) };
      const toolExecutor = vi.fn(async () => ({ success: false, error: "bad-tool" }));

      loop._captureCanvasContext = vi.fn(async () => ({ currentDsl: "", screenshot: null }));
      loop._interpretIntent = vi.fn(async () => ({
        operations: [{ tool: "apply_change", params: { count: 1 } }],
        response: "ok",
      }));

      await loop._handleChatMessage({
        action: { message: "hi" },
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
        onSessionTransition: null,
      });

      expect(historyManager.beginTransaction).toHaveBeenCalledTimes(1);
      expect(historyManager.rollback).toHaveBeenCalledTimes(1);
      expect(historyManager.commit).not.toHaveBeenCalled();
      expect(chat.send).toHaveBeenCalledWith({ message: expect.stringContaining("bad-tool") });
    });

    it("uses timeout messaging on TimeoutError", async () => {
      const tools = {
        apply_change: {
          description: "Apply",
          params: { count: "number" },
        },
      };
      const loop = new EditModeAgentLoop({ tools });
      const session = makeSession();
      const state = makeState();
      const historyManager = { beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn() };
      const chat = { send: vi.fn(async () => {}) };
      const timeoutError = new Error("boom");
      timeoutError.name = "TimeoutError";
      const toolExecutor = vi.fn(async () => {
        throw timeoutError;
      });

      loop._captureCanvasContext = vi.fn(async () => ({ currentDsl: "", screenshot: null }));
      loop._interpretIntent = vi.fn(async () => ({
        operations: [{ tool: "apply_change", params: { count: 1 } }],
        response: "ok",
      }));

      await loop._handleChatMessage({
        action: { message: "hi" },
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
        onSessionTransition: null,
      });

      expect(historyManager.rollback).toHaveBeenCalledTimes(1);
      const timeoutMessage = chat.send.mock.calls[0][0].message;
      expect(timeoutMessage).toEqual(expect.any(String));
      expect(timeoutMessage).not.toContain("boom");
    });

    it("sends error when capture fails", async () => {
      const loop = new EditModeAgentLoop({ tools: { noop: { description: "noop" } } });
      const session = makeSession();
      const state = makeState();
      const historyManager = { beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn() };
      const chat = { send: vi.fn(async () => {}) };

      loop._captureCanvasContext = vi.fn(async () => {
        throw new Error("capture-broke");
      });
      loop._interpretIntent = vi.fn();

      await loop._handleChatMessage({
        action: { message: "hi" },
        state,
        session,
        selectedElement: null,
        historyManager,
        canvasBridge: null,
        modelRouter: null,
        chat,
        emit: null,
        intentParser: null,
        toolExecutor: vi.fn(),
        onSessionTransition: null,
      });

      expect(chat.send).toHaveBeenCalledWith({ message: expect.stringContaining("capture-broke") });
      expect(historyManager.beginTransaction).not.toHaveBeenCalled();
      expect(loop._interpretIntent).not.toHaveBeenCalled();
      expect(session.status).toBe(EditSessionStatus.AWAITING_INPUT);
    });

    it("sanitizes extra params before executing", async () => {
      const tools = {
        apply_change: {
          description: "Apply",
          params: { count: "number" },
        },
      };
      const loop = new EditModeAgentLoop({ tools });
      const session = makeSession();
      const state = makeState();
      const historyManager = { beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn() };
      const chat = { send: vi.fn(async () => {}) };
      const toolExecutor = vi.fn(async () => ({ success: true }));

      loop._captureCanvasContext = vi.fn(async () => ({ currentDsl: "", screenshot: null }));
      loop._interpretIntent = vi.fn(async () => ({
        operations: [{ tool: "apply_change", params: { count: 0, extra: "drop" } }],
        response: "",
      }));

      await loop._handleChatMessage({
        action: { message: "hi" },
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
        onSessionTransition: null,
      });

      expect(toolExecutor).toHaveBeenCalledWith("apply_change", { count: 0 });
      expect(historyManager.commit).toHaveBeenCalledTimes(1);
    });
  });

  describe("_handleQuickAction", () => {
    it("uses boundary indexes for add/delete and renders", async () => {
      const loop = new EditModeAgentLoop();
      const toolExecutor = vi.fn(async () => ({ success: true }));
      const canvasBridge = { dslToCanvas: vi.fn(async () => {}) };

      const addState = makeState({ currentSlideIndex: Number.MAX_SAFE_INTEGER, currentDsl: "<fallback/>", slides: [] });
      const addSession = makeSession();

      await loop._handleQuickAction({
        action: { action: "add_slide" },
        state: addState,
        session: addSession,
        historyManager: {},
        canvasBridge,
        toolExecutor,
        onSessionTransition: null,
      });

      expect(toolExecutor).toHaveBeenCalledWith(EditOperationType.ADD_SLIDE, {
        afterIndex: Number.MAX_SAFE_INTEGER,
      });
      expect(canvasBridge.dslToCanvas).toHaveBeenCalledWith("<fallback/>", addState);

      const deleteState = makeState({ currentSlideIndex: -1 });
      const deleteSession = makeSession();

      await loop._handleQuickAction({
        action: { action: "delete_slide" },
        state: deleteState,
        session: deleteSession,
        historyManager: {},
        canvasBridge,
        toolExecutor,
        onSessionTransition: null,
      });

      expect(toolExecutor).toHaveBeenCalledWith(EditOperationType.DELETE_SLIDE, { slideIndex: -1 });
    });

    it("supports concurrent calls", async () => {
      const loop = new EditModeAgentLoop();
      const toolExecutor = vi.fn(async () => ({ success: true }));
      const canvasBridge = { dslToCanvas: vi.fn(async () => {}) };

      await Promise.all([
        loop._handleQuickAction({
          action: { action: "undo" },
          state: makeState(),
          session: makeSession(),
          historyManager: {},
          canvasBridge,
          toolExecutor,
          onSessionTransition: null,
        }),
        loop._handleQuickAction({
          action: { action: "redo" },
          state: makeState({ currentSlideIndex: 0 }),
          session: makeSession(),
          historyManager: {},
          canvasBridge,
          toolExecutor,
          onSessionTransition: null,
        }),
      ]);

      expect(toolExecutor).toHaveBeenCalledWith(EditOperationType.UNDO, {});
      expect(toolExecutor).toHaveBeenCalledWith(EditOperationType.REDO, {});
    });
  });
});