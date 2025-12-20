const test = require("node:test");
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

test("EditHistoryManager supports undo/redo and transactions", async () => {
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

  assert.equal(history.history.length, 2, "history should respect maxHistory");
  history.undo();
  assert.equal(state.count, 3, "undo should revert last op");
  history.redo();
  assert.equal(state.count, 6, "redo should reapply last op");

  const txHistory = new EditHistoryManager();
  const txState = { count: 0 };

  txHistory.beginTransaction();
  txState.count += 4;
  txHistory.push({ undo: () => (txState.count -= 4), redo: () => (txState.count += 4) });
  txState.count += 1;
  txHistory.push({ undo: () => (txState.count -= 1), redo: () => (txState.count += 1) });
  txHistory.commit();

  assert.equal(txHistory.history.length, 1, "transaction should batch operations");
  txHistory.undo();
  assert.equal(txState.count, 0, "undo should revert transaction");

  txHistory.beginTransaction();
  txState.count += 5;
  txHistory.push({ undo: () => (txState.count -= 5), redo: () => (txState.count += 5) });
  txHistory.rollback();
  assert.equal(txState.count, 0, "rollback should revert transaction");
});

test("edit tools execute and integrate with history", async () => {
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
  assert.equal(shot.success, true);
  assert.equal(parsed.success, true);
  assert.equal(screenshotCalls, 1);
  assert.equal(dslCalls, 1);
  assert.equal(state.currentDsl, "<section>canvas</section>");

  await executor("add_slide", { afterIndex: 0, slideId: "slide-3" });
  assert.equal(state.slides.length, 3);
  assert.equal(state.slides[1].id, "slide-3");

  await executor("edit_element", { elementId: "el-1", changes: { text: "Updated" } });
  assert.equal(state.slides[0].elements[0].text, "Updated");

  await executor("undo", {});
  assert.equal(state.slides[0].elements[0].text, "Title");
  await executor("redo", {});
  assert.equal(state.slides[0].elements[0].text, "Updated");

  await executor("move_element", { elementId: "el-1", x: 10, y: 20 });
  assert.equal(state.slides[0].elements[0].x, 10);
  await executor("resize_element", { elementId: "el-1", width: 200, height: 50 });
  assert.equal(state.slides[0].elements[0].width, 200);

  await executor("add_element", { slideIndex: 0, elementType: "Shape", elementId: "el-new" });
  assert.equal(state.slides[0].elements.some((el) => el.id === "el-new"), true);
  await executor("delete_element", { elementId: "el-new" });
  assert.equal(state.slides[0].elements.some((el) => el.id === "el-new"), false);

  await executor("duplicate_slide", { slideIndex: 0, newSlideId: "slide-dup" });
  assert.equal(state.slides[1].id, "slide-dup");

  await executor("reorder_slides", { fromIndex: 0, toIndex: 1 });
  assert.equal(state.slides[0].id, "slide-dup");

  await executor("change_color_scheme", { primary: "#123", accent: "#456" });
  assert.equal(state.designSystem.designTokens.colors.primary, "#123");

  await executor("change_font", { headingFont: "Oswald" });
  assert.equal(state.designSystem.designTokens.typography.headingFont, "Oswald");

  await executor("apply_theme", { themeName: "dark" });
  assert.equal(state.designSystem.theme, "dark");

  const invalid = await executor("delete_slide", { slideIndex: 99 });
  assert.equal(invalid.success, false);
});

test("edit loop handles actions, intent parsing, and transitions", async () => {
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

  assert.equal(messages.length >= 2, true, "chat should send prompts and responses");
  assert.equal(capturedVision, true);
  assert.equal(capturedPrompt.includes("edit_element"), true);
  assert.equal(state.slides[0].elements[0].color, "#000", "undo should revert edit");
  assert.equal(dslToCanvasCalls >= 2, true, "canvas sync should run");
  assert.equal(state.editSession.status, EditSessionStatus.IDLE);
  assert.equal(transitions.includes("idle->awaiting_input"), true);
  assert.equal(transitions.includes("awaiting_input->processing"), true);
  assert.equal(transitions.includes("processing->executing"), true);
});

test("EditHistoryManager handles edge cases and callbacks", async () => {
  const { EditHistoryManager } = await import("../../../js/agents/stages/design/edit-mode/history.js");

  const undoCalls = [];
  const redoCalls = [];
  const history = new EditHistoryManager(3, {
    onUndo: (op) => undoCalls.push(op.id),
    onRedo: (op) => redoCalls.push(op.id),
  });

  assert.equal(history.push(null), false);
  assert.equal(history.undo(), null);
  assert.equal(history.redo(), null);

  assert.equal(history.beginTransaction(), true);
  assert.equal(history.beginTransaction(), false);
  assert.equal(history.commit(), true);
  assert.equal(history.history.length, 0);

  history.beginTransaction();
  history.push({ id: "op_1" });
  history.commit();
  assert.equal(history.history.length, 1);
  history.undo();
  history.redo();

  assert.deepEqual(undoCalls, ["op_1"]);
  assert.deepEqual(redoCalls, ["op_1"]);
  assert.equal(history.rollback(), false);
});

test("EditHistoryManager returns undefined when no undo/redo handlers exist", async () => {
  const { EditHistoryManager } = await import("../../../js/agents/stages/design/edit-mode/history.js");

  const history = new EditHistoryManager();
  assert.equal(history._executeUndo({}), undefined);
  assert.equal(history._executeRedo({}), undefined);
});

test("edit tools cover edge cases and undo/redo paths", async () => {
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
    assert.equal(addRes.success, true);
    assert.ok(state.slides[state.slides.length - 1].id.startsWith("slide_"));
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
    assert.equal(invalidReorder.success, false);

    const invalidDup = await executor("duplicate_slide", { slideIndex: 99 });
    assert.equal(invalidDup.success, false);

    const dup = await executor("duplicate_slide", { slideIndex: 0 });
    assert.equal(dup.success, true);
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
    assert.ok(addEl.data.element.id.startsWith("el_"));
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
    assert.equal(invalidAddEl.success, false);
  } finally {
    globalThis.structuredClone = originalClone;
  }
});

test("edit loop handles clarification, quick actions, and parsing errors", async () => {
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

  assert.ok(chatMessages.some((msg) => msg.includes("clarify")));
  assert.ok(emits.some((evt) => evt.name === "edit.session.transition"));
});

test("EditModeAgentLoop intent parsing fallback and JSON errors", async () => {
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
  assert.equal(fallback.operations.length, 0);

  await assert.rejects(
    loop._interpretIntent({
      userMessage: "bad",
      currentDsl: "",
      screenshot: null,
      state: makeState(),
      selectedElement: null,
      modelRouter: { chat: async () => "not-json" },
      intentParser: null,
    }),
    /Model response is not valid JSON/
  );
});

test("EditModeAgentLoop captures canvas context from canvasBridge", async () => {
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

  assert.equal(context.currentDsl, "<section>bridge</section>");
  assert.equal(context.screenshot, "data:image/bridge");
});

test("edit loop rolls back transaction when a tool fails", async () => {
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

  assert.equal(state.slides[0].elements[0].text, "Title");
  assert.ok(messages.some((msg) => msg.includes("操作失败")));
});

test("edit loop requires a waitForUserAction or actions queue", async () => {
  const { EditModeAgentLoop } = await import("../../../js/agents/stages/design/edit-mode/edit-loop.js");

  const loop = new EditModeAgentLoop();
  await assert.rejects(loop.run(makeState(), {}), /waitForUserAction/);
});
