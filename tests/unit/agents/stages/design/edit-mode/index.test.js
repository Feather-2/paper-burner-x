import { describe, it, expect, vi, beforeEach } from "vitest";
import { EditOperationType } from "../../../../../../js/agents/stages/design/constants.js";
import { EditSessionStatus } from "../../../../../../js/agents/stages/design/states.js";

vi.mock("../../../../../../js/agents/shared/index.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    isPlainObject: vi.fn(actual.isPlainObject),
  };
});

const MODULE_PATH = "../../../../../../js/agents/stages/design/edit-mode/index.js";
const SHARED_MODULE_PATH = "../../../../../../js/agents/shared/index.js";

const makeIdGenerator = (prefix) => {
  let counter = 0;
  return () => `${prefix}_${(counter += 1)}`;
};

const makeDeepObject = (depth) => {
  let root = {};
  let cursor = root;
  for (let i = 0; i < depth; i += 1) {
    cursor.child = {};
    cursor = cursor.child;
  }
  return root;
};

describe("EditModeAgentLoop", () => {
  let EditModeAgentLoop;
  let createEditToolExecutor;
  let EditHistoryManager;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    ({ EditModeAgentLoop, createEditToolExecutor, EditHistoryManager } = await import(MODULE_PATH));
  });

  it("processes chat_message intent and executes operations", async () => {
    const state = {
      slides: [{ id: "slide_1", elements: [], htmlDsl: "<div/>" }],
      currentSlideIndex: 0,
    };
    const historyManager = new EditHistoryManager();
    const canvasBridge = {
      canvasToDsl: vi.fn(async () => "<dsl/>"),
      screenshot: vi.fn(async () => "base64"),
      dslToCanvas: vi.fn(async () => {}),
    };
    const slideIdGenerator = makeIdGenerator("slide");
    const toolExecutor = createEditToolExecutor({
      state,
      historyManager,
      canvasBridge,
      slideIdGenerator,
    });
    const chat = { send: vi.fn(async () => {}) };
    const intentParser = vi.fn(async () => ({
      understanding: "add slide",
      operations: [{ tool: EditOperationType.ADD_SLIDE, params: { afterIndex: 0 } }],
      response: "ok",
    }));
    const loop = new EditModeAgentLoop({ maxTurns: 3 });

    const result = await loop.run(state, {
      actions: [{ type: "chat_message", message: "add" }, { type: "exit" }],
      historyManager,
      canvasBridge,
      chat,
      intentParser,
      toolExecutor,
      emit: vi.fn(),
    });

    expect(result.slides).toHaveLength(2);
    expect(historyManager.history).toHaveLength(1);
    expect(chat.send).toHaveBeenCalledWith({ message: "ok" });
    expect(intentParser).toHaveBeenCalledTimes(1);
    expect(canvasBridge.canvasToDsl).toHaveBeenCalledTimes(1);
    expect(canvasBridge.screenshot).toHaveBeenCalledTimes(1);
  });

  it("returns state when actions queue is empty", async () => {
    const loop = new EditModeAgentLoop();
    const state = { slides: [] };

    const result = await loop.run(state, { actions: [] });

    expect(result.slides).toEqual([]);
    expect(result.editSessionStatus).toBe(result.editSession.status);
    expect(result.editSession.status).toBe(EditSessionStatus.IDLE);
  });

  it("throws when waitForUserAction is missing and actions is not an array", async () => {
    const loop = new EditModeAgentLoop();
    await expect(loop.run({}, { actions: {} })).rejects.toThrow(
      "Edit loop requires waitForUserAction or actions queue"
    );
  });

  it("rejects null/undefined initial state", async () => {
    const loop = new EditModeAgentLoop();
    await expect(loop.run(null, { actions: [] })).rejects.toThrow(TypeError);
    await expect(loop.run(undefined, { actions: [] })).rejects.toThrow(TypeError);
  });

  it("handles deep nested intent by notifying chat", async () => {
    const state = { slides: [{ id: "slide_1", elements: [] }], currentSlideIndex: 0 };
    const toolExecutor = vi.fn(async (tool) => {
      if (tool === "parse_canvas_state") return { success: true, data: { dsl: "<dsl/>" } };
      if (tool === "screenshot_current") return { success: true, data: { image: "img" } };
      return { success: true, data: {} };
    });
    const chat = { send: vi.fn(async () => {}) };
    const intentParser = vi.fn(async () => ({
      understanding: "deep",
      response: "nope",
      operations: [],
      payload: makeDeepObject(10),
    }));
    const loop = new EditModeAgentLoop();

    await loop.run(state, {
      actions: [{ type: "chat_message", message: "test" }, { type: "exit" }],
      toolExecutor,
      chat,
      intentParser,
    });

    expect(chat.send).toHaveBeenCalledWith({ message: expect.stringContaining("解析失败") });
    expect(toolExecutor).toHaveBeenCalledWith("parse_canvas_state", {});
    expect(toolExecutor).toHaveBeenCalledWith("screenshot_current", {});
  });

  it("stores null selectedElementId when element_selected uses empty string", async () => {
    const loop = new EditModeAgentLoop();
    const state = { slides: [], selectedElementId: "existing" };
    const chat = { send: vi.fn(async () => {}) };

    const result = await loop.run(state, {
      actions: [{ type: "element_selected", elementId: "" }, { type: "exit" }],
      chat,
    });

    expect(result.selectedElementId).toBe(null);
    expect(chat.send).toHaveBeenCalledWith({ message: expect.stringContaining("已选中元素") });
  });
});

describe("EditModeTools", () => {
  let EditModeTools;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    ({ EditModeTools } = await import(MODULE_PATH));
  });

  it("exposes tool metadata for core operations", () => {
    const requiredKeys = [
      EditOperationType.ADD_SLIDE,
      EditOperationType.DELETE_SLIDE,
      EditOperationType.REORDER_SLIDES,
      EditOperationType.DUPLICATE_SLIDE,
      EditOperationType.CHANGE_COLOR_SCHEME,
      EditOperationType.CHANGE_FONT,
      EditOperationType.APPLY_THEME,
      EditOperationType.EDIT_ELEMENT,
      EditOperationType.DELETE_ELEMENT,
      EditOperationType.ADD_ELEMENT,
      EditOperationType.MOVE_ELEMENT,
      EditOperationType.RESIZE_ELEMENT,
      EditOperationType.UNDO,
      EditOperationType.REDO,
      "screenshot_current",
      "parse_canvas_state",
    ];

    for (const key of requiredKeys) {
      expect(EditModeTools[key]).toBeTypeOf("object");
      expect(EditModeTools[key]?.description).toBeTypeOf("string");
    }

    expect(EditModeTools[EditOperationType.ADD_SLIDE].params.afterIndex).toBe("number");
    expect(EditModeTools[EditOperationType.ADD_SLIDE].params.template).toBe("string?");
    expect(EditModeTools[EditOperationType.EDIT_ELEMENT].params.changes).toBe("object");
  });

  it("is frozen and ignores invalid keys", () => {
    expect(Object.isFrozen(EditModeTools)).toBe(true);
    expect(() => {
      EditModeTools.newTool = { description: "nope" };
    }).toThrow(TypeError);

    expect(EditModeTools[null]).toBeUndefined();
    expect(EditModeTools[undefined]).toBeUndefined();
    expect(EditModeTools[""]).toBeUndefined();
    expect(EditModeTools["   "]).toBeUndefined();
    expect(EditModeTools[{}]).toBeUndefined();
  });
});

describe("createEditToolExecutor", () => {
  let createEditToolExecutor;
  let EditHistoryManager;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    ({ createEditToolExecutor, EditHistoryManager } = await import(MODULE_PATH));
  });

  it("returns error for unknown tool and non-object context", async () => {
    const executor = createEditToolExecutor(null);

    const result = await executor("unknown", {});
    const undefinedResult = await executor(undefined, {});

    expect(result.success).toBe(false);
    expect(result.error).toContain("Unknown edit tool");
    expect(undefinedResult.success).toBe(false);
    expect(undefinedResult.error).toContain("Unknown edit tool");
  });

  it("returns error when state is missing from context", async () => {
    const executor = createEditToolExecutor({});
    const result = await executor(EditOperationType.ADD_SLIDE, {});

    expect(result.success).toBe(false);
    expect(result.error).toContain("state must be provided");
  });

  it("inserts slides at the start when afterIndex is -1", async () => {
    const state = { slides: [{ id: "s1", elements: [] }], currentSlideIndex: 0 };
    const historyManager = new EditHistoryManager();
    const executor = createEditToolExecutor({
      state,
      historyManager,
      slideIdGenerator: makeIdGenerator("slide"),
    });

    const result = await executor(EditOperationType.ADD_SLIDE, { afterIndex: -1 });

    expect(result.success).toBe(true);
    expect(result.data.insertIndex).toBe(0);
    expect(state.slides[0].id).toBe("slide_1");
    expect(historyManager.history).toHaveLength(1);
  });

  it("inserts slides at the end when afterIndex is MAX_SAFE_INTEGER", async () => {
    const state = { slides: [{ id: "s1", elements: [] }], currentSlideIndex: 0 };
    const executor = createEditToolExecutor({
      state,
      slideIdGenerator: makeIdGenerator("slide"),
    });

    const result = await executor(EditOperationType.ADD_SLIDE, { afterIndex: Number.MAX_SAFE_INTEGER });

    expect(result.success).toBe(true);
    expect(result.data.insertIndex).toBe(1);
    expect(state.slides[1].id).toBe("slide_1");
  });

  it("accepts string indices and whitespace strings", async () => {
    const state = { slides: [{ id: "s1", elements: [] }], currentSlideIndex: 0 };
    const executor = createEditToolExecutor({
      state,
      slideIdGenerator: makeIdGenerator("slide"),
    });

    const resultOne = await executor(EditOperationType.ADD_SLIDE, { afterIndex: "0" });
    const resultTwo = await executor(EditOperationType.ADD_SLIDE, { afterIndex: "   " });

    expect(resultOne.success).toBe(true);
    expect(resultOne.data.insertIndex).toBe(1);
    expect(resultTwo.success).toBe(true);
    expect(resultTwo.data.insertIndex).toBe(2);
  });

  it("rejects invalid delete_slide indices", async () => {
    const state = {
      slides: [{ id: "s1", elements: [] }, { id: "s2", elements: [] }],
      currentSlideIndex: 0,
    };
    const executor = createEditToolExecutor({ state, slideIdGenerator: makeIdGenerator("slide") });

    const invalidValues = [null, undefined, "", "   ", -1, {}, Number.MAX_SAFE_INTEGER];
    for (const value of invalidValues) {
      const result = await executor(EditOperationType.DELETE_SLIDE, { slideIndex: value });
      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid slideIndex");
    }

    expect(state.slides).toHaveLength(2);
  });

  it("updates element content with a long string and tracks history", async () => {
    const longText = "x".repeat(120000);
    const state = {
      slides: [{ id: "s1", elements: [{ id: "el1", text: "old" }] }],
      currentSlideIndex: 0,
    };
    const historyManager = new EditHistoryManager();
    const executor = createEditToolExecutor({ state, historyManager });

    const result = await executor(EditOperationType.EDIT_ELEMENT, {
      elementId: "el1",
      changes: { text: longText },
    });

    expect(result.success).toBe(true);
    expect(state.slides[0].elements[0].text).toBe(longText);
    expect(historyManager.history).toHaveLength(1);
  });

  it("handles large htmlDsl strings when adding slides", async () => {
    const hugeDsl = `<div>${"y".repeat(200000)}</div>`;
    const state = { slides: [], currentSlideIndex: 0 };
    const executor = createEditToolExecutor({ state, slideIdGenerator: makeIdGenerator("slide") });

    const result = await executor(EditOperationType.ADD_SLIDE, { afterIndex: 0, htmlDsl: hugeDsl });

    expect(result.success).toBe(true);
    expect(state.slides[0].htmlDsl.length).toBe(hugeDsl.length);
  });

  it("executes concurrent tool calls without losing state", async () => {
    const state = { slides: [], currentSlideIndex: 0 };
    const historyManager = new EditHistoryManager();
    const executor = createEditToolExecutor({
      state,
      historyManager,
      slideIdGenerator: makeIdGenerator("slide"),
    });

    await Promise.all([
      executor(EditOperationType.ADD_SLIDE, { afterIndex: 0 }),
      executor(EditOperationType.ADD_SLIDE, { afterIndex: 0 }),
    ]);

    expect(state.slides).toHaveLength(2);
    expect(historyManager.history).toHaveLength(2);
  });
});

describe("EditHistoryManager", () => {
  let EditHistoryManager;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    ({ EditHistoryManager } = await import(MODULE_PATH));
  });

  it("pushes operations and supports undo/redo callbacks", () => {
    const undo = vi.fn();
    const redo = vi.fn();
    const manager = new EditHistoryManager(5);

    expect(manager.push({ undo, redo })).toBe(true);
    expect(manager.history).toHaveLength(1);

    const entry = manager.undo();
    expect(entry).not.toBeNull();
    expect(undo).toHaveBeenCalledTimes(1);

    const redoEntry = manager.redo();
    expect(redoEntry).not.toBeNull();
    expect(redo).toHaveBeenCalledTimes(1);
  });

  it("commits transactions as a single history entry and clears redo", () => {
    const manager = new EditHistoryManager();

    manager.push({ undo: vi.fn() });
    manager.undo();
    expect(manager.redoStack).toHaveLength(1);

    expect(manager.beginTransaction()).toBe(true);
    manager.push({ undo: vi.fn() });
    manager.push({ undo: vi.fn() });
    expect(manager.commit()).toBe(true);

    expect(manager.history).toHaveLength(1);
    expect(manager.redoStack).toHaveLength(0);
  });

  it("rolls back transaction operations in reverse order", () => {
    const callOrder = [];
    const manager = new EditHistoryManager();

    manager.beginTransaction();
    manager.push({ undo: () => callOrder.push("first") });
    manager.push({ undo: () => callOrder.push("second") });

    expect(manager.rollback()).toBe(true);
    expect(callOrder).toEqual(["second", "first"]);
    expect(manager.transaction).toBe(null);
  });

  it("clamps maxHistory and trims older entries", () => {
    const managerZero = new EditHistoryManager(0);
    const managerNegative = new EditHistoryManager(-1);
    const managerString = new EditHistoryManager("3");

    expect(managerZero.maxHistory).toBe(50);
    expect(managerNegative.maxHistory).toBe(50);
    expect(managerString.maxHistory).toBe(50);

    const manager = new EditHistoryManager(1);
    manager.push({ undo: vi.fn() });
    manager.push({ undo: vi.fn() });
    expect(manager.history).toHaveLength(1);
  });

  it("ignores invalid operations and accepts empty objects", async () => {
    const { isPlainObject } = await import(SHARED_MODULE_PATH);
    const manager = new EditHistoryManager();

    expect(manager.push(null)).toBe(false);
    expect(manager.push(undefined)).toBe(false);
    expect(manager.push("")).toBe(false);
    expect(manager.push({})).toBe(true);
    expect(manager.history).toHaveLength(1);
    expect(isPlainObject).toHaveBeenCalled();
  });

  it("returns null on quick consecutive undo calls", () => {
    const manager = new EditHistoryManager();

    manager.push({ undo: vi.fn() });
    const first = manager.undo();
    const second = manager.undo();

    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });
});
