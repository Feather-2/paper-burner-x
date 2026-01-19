import { describe, it, expect, beforeEach, afterEach } from "vitest";

const assert = require("node:assert/strict");

function makeState() {
  return {
    currentSlideIndex: 0,
    slides: [
      {
        id: "slide-1",
        htmlDsl: "<section>one</section>",
        elements: [
          {
            id: "el-1",
            type: "Text",
            text: "Title",
            color: "#000",
            x: 0,
            y: 0,
            width: 100,
            height: 20,
          },
        ],
      },
      { id: "slide-2", htmlDsl: "<section>two</section>", elements: [] },
    ],
    designSystem: {
      theme: "light",
      designTokens: {
        colors: { primary: "#111", accent: "#222", background: "#fff" },
        typography: { headingFont: "Inter", bodyFont: "Roboto" },
      },
    },
  };
}

it("EditHistoryManager supports undo/redo and transactions", async () => {
  const { EditHistoryManager } = await import("../../../js/agents/stages/design/edit-mode/history.js");

  const history = new EditHistoryManager(2);
  const state = { count: 0 };

  function apply(delta) {
    state.count += delta;
  }

  function op(delta) {
    return {
      undo: () => apply(-delta),
      redo: () => apply(delta),
    };
  }

  apply(1);
  history.push(op(1));
  apply(2);
  history.push(op(2));
  apply(3);
  history.push(op(3));

  expect(history.history.length).toBe(2, "history should respect maxHistory");
  history.undo();
  expect(state.count).toBe(3, "undo should revert last op");
  history.redo();
  expect(state.count).toBe(6, "redo should reapply last op");

  const txHistory = new EditHistoryManager();
  const txState = { count: 0 };

  txHistory.beginTransaction();
  txState.count += 4;
  txHistory.push({ undo: () => (txState.count -= 4), redo: () => (txState.count += 4) });
  txState.count += 1;
  txHistory.push({ undo: () => (txState.count -= 1), redo: () => (txState.count += 1) });
  txHistory.commit();

  expect(txHistory.history.length).toBe(1, "transaction should batch operations");
  txHistory.undo();
  expect(txState.count).toBe(0, "undo should revert transaction");

  txHistory.beginTransaction();
  txState.count += 5;
  txHistory.push({ undo: () => (txState.count -= 5), redo: () => (txState.count += 5) });
  txHistory.rollback();
  expect(txState.count).toBe(0, "rollback should revert transaction");
});

it("edit tools execute and integrate with history", async () => {
  const { createEditToolExecutor } = await import("../../../js/agents/stages/design/edit-mode/tools.js");
  const { EditHistoryManager } = await import("../../../js/agents/stages/design/edit-mode/history.js");

  const state = makeState();
  const historyManager = new EditHistoryManager();
  let screenshotCalls = 0;
  let dslCalls = 0;

  const canvasBridge = {
    screenshot: async () => {
      screenshotCalls += 1;
      return "data:image/mock";
    },
    canvasToDsl: async () => {
      dslCalls += 1;
      return "<section>canvas</section>";
    },
  };

  const executor = createEditToolExecutor({
    state,
    historyManager,
    canvasBridge,
    idGenerator: () => "el-new",
    slideIdGenerator: () => "slide-new",
  });

  const shot = await executor("screenshot_current", {});
  const parsed = await executor("parse_canvas_state", {});
  expect(shot.success).toBe(true);
  expect(parsed.success).toBe(true);
  expect(screenshotCalls).toBe(1);
  expect(dslCalls).toBe(1);
  expect(state.currentDsl).toBe("<section>canvas</section>");

  await executor("add_slide", { afterIndex: 0, slideId: "slide-3" });
  expect(state.slides.length).toBe(3);
  expect(state.slides[1].id).toBe("slide-3");

  await executor("edit_element", { elementId: "el-1", changes: { text: "Updated" } });
  expect(state.slides[0].elements[0].text).toBe("Updated");

  await executor("undo", {});
  expect(state.slides[0].elements[0].text).toBe("Title");
  await executor("redo", {});
  expect(state.slides[0].elements[0].text).toBe("Updated");

  await executor("move_element", { elementId: "el-1", x: 10, y: 20 });
  expect(state.slides[0].elements[0].x).toBe(10);
  await executor("resize_element", { elementId: "el-1", width: 200, height: 50 });
  expect(state.slides[0].elements[0].width).toBe(200);

  await executor("add_element", { slideIndex: 0, elementType: "Shape", elementId: "el-new" });
  expect(state.slides[0].elements.some((el) => el.id === "el-new")).toBe(true);
  await executor("delete_element", { elementId: "el-new" });
  expect(state.slides[0].elements.some((el) => el.id === "el-new")).toBe(false);

  await executor("duplicate_slide", { slideIndex: 0, newSlideId: "slide-dup" });
  expect(state.slides[1].id).toBe("slide-dup");

  await executor("reorder_slides", { fromIndex: 0, toIndex: 1 });
  expect(state.slides[0].id).toBe("slide-dup");

  await executor("change_color_scheme", { primary: "#123", accent: "#456" });
  expect(state.designSystem.designTokens.colors.primary).toBe("#123");

  await executor("change_font", { headingFont: "Oswald" });
  expect(state.designSystem.designTokens.typography.headingFont).toBe("Oswald");

  await executor("apply_theme", { themeName: "dark" });
  expect(state.designSystem.theme).toBe("dark");

  const invalid = await executor("delete_slide", { slideIndex: 99 });
  expect(invalid.success).toBe(false);
});

it("edit loop handles actions, intent parsing, and transitions", async () => {
  const { EditModeAgentLoop } = await import("../../../js/agents/stages/design/edit-mode/edit-loop.js");
  const { EditHistoryManager } = await import("../../../js/agents/stages/design/edit-mode/history.js");
  const { EditSessionStatus } = await import("../../../js/agents/stages/design/states.js");

  const state = makeState();
  const historyManager = new EditHistoryManager();
  const messages = [];
  const transitions = [];
  let capturedPrompt = null;
  let capturedVision = null;
  let dslToCanvasCalls = 0;

  const chat = {
    send: async ({ message }) => messages.push(message),
  };

  const canvasBridge = {
    screenshot: async () => "data:image/test",
    canvasToDsl: async () => "<section>dsl</section>",
    dslToCanvas: async () => {
      dslToCanvasCalls += 1;
    },
  };

  const modelRouter = {
    chat: async (messagesArg, options) => {
      capturedPrompt = messagesArg?.[0]?.content?.[0]?.text || "";
      capturedVision = options?.vision;
      return JSON.stringify({
        understanding: "change color",
        operations: [
          { tool: "edit_element", params: { elementId: "el-1", changes: { color: "#00f" } } },
        ],
        response: "done",
      });
    },
  };

  const loop = new EditModeAgentLoop({ modelRouter, canvasBridge, historyManager });
  await loop.run(state, {
    actions: [
      { type: "element_selected", elementId: "el-1" },
      { type: "chat_message", message: "make it blue" },
      { type: "quick_action", action: "undo" },
      { type: "exit" },
    ],
    chat,
    onSessionTransition: (from, to) => transitions.push(`${from}->${to}`),
  });

  expect(messages.length >= 2).toBe(true, "chat should send prompts and responses");
  expect(capturedVision).toBe(true);
  expect(capturedPrompt.includes("edit_element")).toBe(true);
  expect(state.slides[0].elements[0].color).toBe("#000", "undo should revert edit");
  expect(dslToCanvasCalls >= 2).toBe(true, "canvas sync should run");
  expect(state.editSession.status).toBe(EditSessionStatus.IDLE);
  expect(transitions.includes("idle->awaiting_input")).toBe(true);
  expect(transitions.includes("awaiting_input->processing")).toBe(true);
  expect(transitions.includes("processing->executing")).toBe(true);
});

it("EditHistoryManager handles edge cases and callbacks", async () => {
  const { EditHistoryManager } = await import("../../../js/agents/stages/design/edit-mode/history.js");

  const undoCalls = [];
  const redoCalls = [];
  const history = new EditHistoryManager(3, {
    onUndo: (op) => undoCalls.push(op.id),
    onRedo: (op) => redoCalls.push(op.id),
  });

  expect(history.push(null)).toBe(false);
  expect(history.undo()).toBe(null);
  expect(history.redo()).toBe(null);

  expect(history.beginTransaction()).toBe(true);
  expect(history.beginTransaction()).toBe(false);
  expect(history.commit()).toBe(true);
  expect(history.history.length).toBe(0);

  history.beginTransaction();
  history.push({ id: "op_1" });
  history.commit();
  expect(history.history.length).toBe(1);
  history.undo();
  history.redo();

  expect(undoCalls).toEqual(["op_1"]);
  expect(redoCalls).toEqual(["op_1"]);
  expect(history.rollback()).toBe(false);
});

it("EditHistoryManager returns undefined when no undo/redo handlers exist", async () => {
  const { EditHistoryManager } = await import("../../../js/agents/stages/design/edit-mode/history.js");

  const history = new EditHistoryManager();
  expect(history._executeUndo({})).toBe(undefined);
  expect(history._executeRedo({})).toBe(undefined);
});

it("edit tools cover edge cases and undo/redo paths", async () => {
  const { createEditToolExecutor } = await import("../../../js/agents/stages/design/edit-mode/tools.js");
  const { EditHistoryManager } = await import("../../../js/agents/stages/design/edit-mode/history.js");

  const state = {
    currentSlideIndex: 1,
    slides: [
      { id: "slide-a", htmlDsl: "<section>a</section>", elements: [{ id: "el-1", type: "Text", text: "Title" }] },
      { id: "slide-b", htmlDsl: "<section>b</section>", elements: [] },
      { id: "slide-c", htmlDsl: "<section>c</section>", elements: [] },
    ],
    designSystem: { theme: "light", tokens: { colors: {}, typography: {} } },
  };

  const historyManager = new EditHistoryManager();
  const executor = createEditToolExecutor({ state, historyManager });
  const originalClone = globalThis.structuredClone;
  globalThis.structuredClone = undefined;

  try {
    const addRes = await executor("add_slide", { afterIndex: "bad" });
    expect(addRes.success).toBe(true);
    expect(state.slides[state.slides.length - 1].id).toMatch(/^slide_/);
    historyManager.undo();
    historyManager.redo();

    state.currentSlideIndex = 1;
    await executor("reorder_slides", { fromIndex: 0, toIndex: 2 });
    historyManager.undo();
    historyManager.redo();

    state.currentSlideIndex = 1;
    await executor("reorder_slides", { fromIndex: 2, toIndex: 0 });
    historyManager.undo();
    historyManager.redo();

    const invalidReorder = await executor("reorder_slides", { fromIndex: "bad", toIndex: 1 });
    expect(invalidReorder.success).toBe(false);

    const invalidDup = await executor("duplicate_slide", { slideIndex: 99 });
    expect(invalidDup.success).toBe(false);

    const dup = await executor("duplicate_slide", { slideIndex: 0 });
    expect(dup.success).toBe(true);
    historyManager.undo();
    historyManager.redo();

    state.currentSlideIndex = 1;
    await executor("delete_slide", { slideIndex: 1 });
    historyManager.undo();
    historyManager.redo();

    state.currentSlideIndex = 1;
    await executor("delete_slide", { slideIndex: 0 });
    historyManager.undo();
    historyManager.redo();

    const addEl = await executor("add_element", { slideIndex: 0, elementType: "Shape" });
    expect(addEl.data.element.id).toMatch(/^el_/);
    historyManager.undo();
    historyManager.redo();

    await executor("move_element", { elementId: addEl.data.element.id, x: 10 });
    historyManager.undo();
    historyManager.redo();

    await executor("resize_element", { elementId: addEl.data.element.id, width: 120, height: 60 });
    historyManager.undo();
    historyManager.redo();

    await executor("delete_element", { elementId: addEl.data.element.id });
    historyManager.undo();
    historyManager.redo();

    await executor("change_color_scheme", { primary: "#abc" });
    historyManager.undo();
    historyManager.redo();

    await executor("change_font", { headingFont: "Mono" });
    historyManager.undo();
    historyManager.redo();

    await executor("apply_theme", { themeName: "night" });
    historyManager.undo();
    historyManager.redo();

    const invalidAddEl = await executor("add_element", { slideIndex: 99, elementType: "Shape" });
    expect(invalidAddEl.success).toBe(false);
  } finally {
    globalThis.structuredClone = originalClone;
  }
});

it("edit loop handles clarification, quick actions, and parsing errors", async () => {
  const { EditModeAgentLoop } = await import("../../../js/agents/stages/design/edit-mode/edit-loop.js");
  const { EditHistoryManager } = await import("../../../js/agents/stages/design/edit-mode/history.js");

  const state = makeState();
  const historyManager = new EditHistoryManager();
  const chatMessages = [];
  const emits = [];

  const loop = new EditModeAgentLoop({
    historyManager,
    emit: (name, record) => emits.push({ name, record }),
    intentParser: async () => ({ needsClarification: true, clarificationQuestion: "clarify?" }),
  });

  await loop.run(state, {
    actions: [
      { type: "chat_message", text: "edit please" },
      { action: "add_slide" },
      { action: "delete_slide" },
      { type: "exit" },
    ],
    chat: { send: async ({ message }) => chatMessages.push(message) },
  });

  expect(chatMessages).toEqual(expect.arrayContaining([expect.stringContaining("clarify")]));
  expect(emits).toEqual(expect.arrayContaining([expect.objectContaining({ name: "edit.session.transition" })]));
});

it("EditModeAgentLoop intent parsing fallback and JSON errors", async () => {
  const { EditModeAgentLoop } = await import("../../../js/agents/stages/design/edit-mode/edit-loop.js");

  const loop = new EditModeAgentLoop();
  const fallback = await loop._interpretIntent({
    userMessage: "hello",
    currentDsl: "",
    screenshot: null,
    state: makeState(),
    selectedElement: null,
    modelRouter: null,
    intentParser: null,
  });
  expect(fallback.operations.length).toBe(0);

  await expect(loop._interpretIntent({
      userMessage: "bad",
      currentDsl: "",
      screenshot: null,
      state: makeState(),
      selectedElement: null,
      modelRouter: { chat: async () => "not-json" },
      intentParser: null,
    })).rejects.toThrow(/Model response is not valid JSON/);
});

it("EditModeAgentLoop captures canvas context from canvasBridge", async () => {
  const { EditModeAgentLoop } = await import("../../../js/agents/stages/design/edit-mode/edit-loop.js");

  const loop = new EditModeAgentLoop();
  const state = makeState();
  const context = await loop._captureCanvasContext({
    state,
    canvasBridge: {
      canvasToDsl: async () => "<section>bridge</section>",
      screenshot: async () => "data:image/bridge",
    },
    toolExecutor: null,
  });

  expect(context.currentDsl).toBe("<section>bridge</section>");
  expect(context.screenshot).toBe("data:image/bridge");
});

it("edit loop rolls back transaction when a tool fails", async () => {
  const { EditModeAgentLoop } = await import("../../../js/agents/stages/design/edit-mode/edit-loop.js");
  const { EditHistoryManager } = await import("../../../js/agents/stages/design/edit-mode/history.js");

  const state = makeState();
  const historyManager = new EditHistoryManager();
  const messages = [];

  const chat = {
    send: async ({ message }) => messages.push(message),
  };

  const intentParser = async () => ({
    operations: [
      { tool: "edit_element", params: { elementId: "el-1", changes: { text: "Updated" } } },
      { tool: "edit_element", params: { elementId: "missing", changes: { text: "Fail" } } },
    ],
    response: "done",
  });

  const loop = new EditModeAgentLoop({ intentParser, historyManager });
  await loop.run(state, { actions: [{ type: "chat_message", message: "change" }, { type: "exit" }], chat });

  expect(state.slides[0].elements[0].text).toBe("Title");
  expect(messages).toEqual(expect.arrayContaining([expect.stringContaining("操作失败")]));
});

it("edit loop requires a waitForUserAction or actions queue", async () => {
  const { EditModeAgentLoop } = await import("../../../js/agents/stages/design/edit-mode/edit-loop.js");

  const loop = new EditModeAgentLoop();
  await expect(loop.run(makeState(), {})).rejects.toThrow(/waitForUserAction/);
});
