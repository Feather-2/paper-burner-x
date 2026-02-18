import { describe, it, expect, vi, beforeEach } from "vitest";

const EditOperationType = vi.hoisted(() => ({
  ADD_SLIDE: "add_slide",
  DELETE_SLIDE: "delete_slide",
  REORDER_SLIDES: "reorder_slides",
  DUPLICATE_SLIDE: "duplicate_slide",
  CHANGE_COLOR_SCHEME: "change_color_scheme",
  CHANGE_FONT: "change_font",
  APPLY_THEME: "apply_theme",
  EDIT_ELEMENT: "edit_element",
  DELETE_ELEMENT: "delete_element",
  ADD_ELEMENT: "add_element",
  MOVE_ELEMENT: "move_element",
  RESIZE_ELEMENT: "resize_element",
  UNDO: "undo",
  REDO: "redo",
}));

const isPlainObject = vi.hoisted(() =>
  vi.fn((value) => {
    if (value === null || typeof value !== "object") return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  })
);

vi.mock("../../../../../../js/agents/stages/design/constants.js", () => ({
  EditOperationType,
}));

vi.mock("../../../../../../js/agents/shared/index.js", () => ({
  isPlainObject,
}));

import { EditModeTools, createEditToolExecutor } from "../../../../../../js/agents/stages/design/edit-mode/tools.js";

const largeString = "x".repeat(10000);

const makeSlide = (id, overrides = {}) => ({
  id,
  title: "",
  elements: [],
  htmlDsl: "",
  ...overrides,
});

const makeState = (overrides = {}) => ({
  slides: [],
  designSystem: {},
  ...overrides,
});

describe("EditModeTools", () => {
  beforeEach(() => {
    isPlainObject.mockClear();
  });

  it("exposes frozen tool definitions keyed by EditOperationType", () => {
    expect(EditModeTools).toBeTypeOf("object");
    expect(Object.isFrozen(EditModeTools)).toBe(true);

    const keys = [
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

    for (const key of keys) {
      expect(EditModeTools[key]).toBeTypeOf("object");
      expect(EditModeTools[key].description).toBeTypeOf("string");
    }

    expect(EditModeTools[EditOperationType.ADD_SLIDE].params).toMatchObject({
      afterIndex: "number",
      template: "string?",
    });
    expect(EditModeTools.screenshot_current.returns).toBe("base64 image");
    expect(EditModeTools.parse_canvas_state.returns).toBe("HTML DSL string");
  });
});

describe("createEditToolExecutor", () => {
  beforeEach(() => {
    isPlainObject.mockClear();
  });

  it("returns error for unknown tools and empty names", async () => {
    const exec = createEditToolExecutor({ state: makeState() });
    const cases = [null, undefined, "", "   ", "unknown-tool"];

    for (const toolName of cases) {
      const result = await exec(toolName);
      expect(result.success).toBe(false);
      expect(result.error).toContain("Unknown edit tool");
    }
  });

  it("fails when state is missing in context", async () => {
    const exec = createEditToolExecutor(null);
    const result = await exec(EditOperationType.ADD_SLIDE, {});

    expect(result.success).toBe(false);
    expect(result.error).toContain("state must be provided");
  });

  it("adds slides after index, updates current slide, and records history", async () => {
    const state = makeState({
      slides: [makeSlide("s1"), makeSlide("s2")],
      currentSlideIndex: 1,
    });
    const historyManager = { push: vi.fn() };
    const exec = createEditToolExecutor({ state, historyManager });

    const result = await exec(EditOperationType.ADD_SLIDE, {
      afterIndex: "0",
      slideId: "s-new",
      title: "New",
    });

    expect(result.success).toBe(true);
    expect(result.data.insertIndex).toBe(1);
    expect(state.slides.map((slide) => slide.id)).toEqual(["s1", "s-new", "s2"]);
    expect(state.currentSlideIndex).toBe(2);
    expect(historyManager.push).toHaveBeenCalledTimes(1);

    const op = historyManager.push.mock.calls[0][0];
    expect(op.type).toBe(EditOperationType.ADD_SLIDE);
    op.undo();
    expect(state.slides.map((slide) => slide.id)).toEqual(["s1", "s2"]);
    op.redo();
    expect(state.slides.map((slide) => slide.id)).toEqual(["s1", "s-new", "s2"]);
  });

  it("appends for blank/large indices and normalizes slides arrays", async () => {
    const stateBlank = makeState();
    const execBlank = createEditToolExecutor({ state: stateBlank });
    await execBlank(EditOperationType.ADD_SLIDE, { afterIndex: "   ", slideId: "s-1" });
    expect(stateBlank.slides.map((slide) => slide.id)).toEqual(["s-1"]);

    const stateLarge = makeState({ slides: [makeSlide("a")] });
    const execLarge = createEditToolExecutor({ state: stateLarge });
    await execLarge(EditOperationType.ADD_SLIDE, {
      afterIndex: Number.MAX_SAFE_INTEGER,
      slideId: "s-2",
    });
    expect(stateLarge.slides.map((slide) => slide.id)).toEqual(["a", "s-2"]);

    const stateObject = { slides: {}, currentSlideIndex: 0 };
    const execObject = createEditToolExecutor({ state: stateObject });
    await execObject(EditOperationType.ADD_SLIDE, { slideId: "s-3" });
    expect(Array.isArray(stateObject.slides)).toBe(true);
    expect(stateObject.slides[0].id).toBe("s-3");

    const stateEmptyObject = {};
    const execEmptyObject = createEditToolExecutor({ state: stateEmptyObject });
    await execEmptyObject(EditOperationType.ADD_SLIDE, { slideId: "s-4" });
    expect(Array.isArray(stateEmptyObject.slides)).toBe(true);
  });

  it("rejects invalid delete indices", async () => {
    const state = makeState({ slides: [makeSlide("s1")] });
    const exec = createEditToolExecutor({ state });
    const cases = [null, -1, Number.MAX_SAFE_INTEGER, "   ", {}, []];

    for (const slideIndex of cases) {
      const result = await exec(EditOperationType.DELETE_SLIDE, { slideIndex });
      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid slideIndex");
    }
  });

  it("deletes slides with string index and supports undo/redo", async () => {
    const state = makeState({
      slides: [makeSlide("s1"), makeSlide("s2")],
      currentSlideIndex: 1,
    });
    const historyManager = { push: vi.fn() };
    const exec = createEditToolExecutor({ state, historyManager });

    const result = await exec(EditOperationType.DELETE_SLIDE, { slideIndex: "0" });

    expect(result.success).toBe(true);
    expect(state.slides.map((slide) => slide.id)).toEqual(["s2"]);
    expect(state.currentSlideIndex).toBe(0);
    expect(historyManager.push).toHaveBeenCalledTimes(1);

    const op = historyManager.push.mock.calls[0][0];
    op.undo();
    expect(state.slides.map((slide) => slide.id)).toEqual(["s1", "s2"]);
    op.redo();
    expect(state.slides.map((slide) => slide.id)).toEqual(["s2"]);
  });

  it("reorders slides with string indices and records history", async () => {
    const state = makeState({
      slides: [makeSlide("s1"), makeSlide("s2"), makeSlide("s3")],
      currentSlideIndex: 0,
    });
    const historyManager = { push: vi.fn() };
    const exec = createEditToolExecutor({ state, historyManager });

    const result = await exec(EditOperationType.REORDER_SLIDES, { fromIndex: "0", toIndex: 2 });

    expect(result.success).toBe(true);
    expect(state.slides.map((slide) => slide.id)).toEqual(["s2", "s3", "s1"]);
    expect(state.currentSlideIndex).toBe(2);

    const op = historyManager.push.mock.calls[0][0];
    op.undo();
    expect(state.slides.map((slide) => slide.id)).toEqual(["s1", "s2", "s3"]);
    op.redo();
    expect(state.slides.map((slide) => slide.id)).toEqual(["s2", "s3", "s1"]);
  });

  it("rejects invalid reorder indices", async () => {
    const state = makeState({ slides: [makeSlide("s1")] });
    const exec = createEditToolExecutor({ state });

    const cases = [
      { fromIndex: -1, toIndex: 0 },
      { fromIndex: 0, toIndex: Number.MAX_SAFE_INTEGER },
      { fromIndex: {}, toIndex: 0 },
      { fromIndex: 0, toIndex: "   " },
    ];

    for (const params of cases) {
      const result = await exec(EditOperationType.REORDER_SLIDES, params);
      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid reorder indices");
    }
  });

  it("duplicates slides with deep clone and supports undo/redo", async () => {
    const state = makeState({
      slides: [
        makeSlide("s1", {
          elements: [{ id: "e1", config: { nested: { value: 1 } } }],
          htmlDsl: largeString,
        }),
      ],
      currentSlideIndex: 0,
    });
    const historyManager = { push: vi.fn() };
    const exec = createEditToolExecutor({ state, historyManager });

    const result = await exec(EditOperationType.DUPLICATE_SLIDE, { slideIndex: 0, newSlideId: "s2" });

    expect(result.success).toBe(true);
    expect(state.slides).toHaveLength(2);
    expect(state.slides[1].id).toBe("s2");

    state.slides[1].elements[0].config.nested.value = 99;
    expect(state.slides[0].elements[0].config.nested.value).toBe(1);

    const op = historyManager.push.mock.calls[0][0];
    op.undo();
    expect(state.slides).toHaveLength(1);
    op.redo();
    expect(state.slides).toHaveLength(2);
  });

  it("changes color scheme, emits deviations, and supports undo/redo", async () => {
    const state = makeState({
      designSystem: {
        styleLock: { colors: { primary: "#fff" } },
        designTokens: { colors: { primary: "#fff" } },
      },
    });
    const emit = vi.fn();
    const historyManager = { push: vi.fn() };
    const exec = createEditToolExecutor({ state, emit, historyManager });

    const result = await exec(EditOperationType.CHANGE_COLOR_SCHEME, { primary: "#000" });

    expect(result.success).toBe(true);
    expect(result.data.colors.primary).toBe("#000");
    expect(result.data.styleDeviations).toHaveLength(1);
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls.map((call) => call[0])).toEqual([
      "edit:style.deviation",
      "edit:style:deviation",
    ]);

    const op = historyManager.push.mock.calls[0][0];
    op.undo();
    expect(state.designSystem.designTokens.colors.primary).toBe("#fff");
    op.redo();
    expect(state.designSystem.designTokens.colors.primary).toBe("#000");
  });

  it("does not emit style warning when colors match lock", async () => {
    const state = makeState({
      designSystem: {
        styleLock: { colors: { primary: "#111" } },
        tokens: { colors: { primary: "#111" } },
      },
    });
    const emit = vi.fn();
    const exec = createEditToolExecutor({ state, emit });

    const result = await exec(EditOperationType.CHANGE_COLOR_SCHEME, { primary: "#111" });

    expect(result.success).toBe(true);
    expect(result.data.styleDeviations).toBeUndefined();
    expect(emit).not.toHaveBeenCalled();
  });

  it("updates typography tokens with large strings and supports undo/redo", async () => {
    const state = makeState({ designSystem: {} });
    const historyManager = { push: vi.fn() };
    const exec = createEditToolExecutor({ state, historyManager });

    const result = await exec(EditOperationType.CHANGE_FONT, {
      headingFont: largeString,
      bodyFont: "Body",
    });

    expect(result.success).toBe(true);
    expect(state.designSystem.typography.headingFont).toBe(largeString);
    expect(state.designSystem.typography.bodyFont).toBe("Body");

    const op = historyManager.push.mock.calls[0][0];
    op.undo();
    expect(state.designSystem.typography).toEqual({});
    op.redo();
    expect(state.designSystem.typography.headingFont).toBe(largeString);
  });

  it("applies theme fallback and supports undo/redo", async () => {
    const state = makeState({ designSystem: { theme: "legacy" } });
    const historyManager = { push: vi.fn() };
    const exec = createEditToolExecutor({ state, historyManager });

    const result = await exec(EditOperationType.APPLY_THEME, { themeName: "", theme: "new-theme" });

    expect(result.success).toBe(true);
    expect(state.designSystem.theme).toBe("new-theme");

    const op = historyManager.push.mock.calls[0][0];
    op.undo();
    expect(state.designSystem.theme).toBe("legacy");
    op.redo();
    expect(state.designSystem.theme).toBe("new-theme");
  });

  it("rejects edit_element when changes are not plain objects", async () => {
    const state = makeState({
      slides: [makeSlide("s1", { elements: [{ id: "e1", text: "Old" }] })],
    });
    const exec = createEditToolExecutor({ state });

    const result = await exec(EditOperationType.EDIT_ELEMENT, { elementId: "e1", changes: null });

    expect(result.success).toBe(false);
    expect(result.error).toContain("changes must be an object");
  });

  it("edits elements and supports undo/redo", async () => {
    const state = makeState({
      slides: [
        makeSlide("s1", {
          elements: [{ id: "e1", text: "Old", style: { color: "red" } }],
        }),
      ],
    });
    const historyManager = { push: vi.fn() };
    const exec = createEditToolExecutor({ state, historyManager });

    const result = await exec(EditOperationType.EDIT_ELEMENT, {
      elementId: "e1",
      changes: { text: "New" },
    });

    expect(result.success).toBe(true);
    expect(state.slides[0].elements[0].text).toBe("New");

    const op = historyManager.push.mock.calls[0][0];
    op.undo();
    expect(state.slides[0].elements[0].text).toBe("Old");
    op.redo();
    expect(state.slides[0].elements[0].text).toBe("New");
  });

  it("rejects delete_element for missing elements", async () => {
    const state = makeState({ slides: [makeSlide("s1")] });
    const exec = createEditToolExecutor({ state });

    const result = await exec(EditOperationType.DELETE_ELEMENT, { elementId: "missing" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Element not found");
  });

  it("deletes elements and supports undo/redo", async () => {
    const state = makeState({
      slides: [makeSlide("s1", { elements: [{ id: "e1" }, { id: "e2" }] })],
    });
    const historyManager = { push: vi.fn() };
    const exec = createEditToolExecutor({ state, historyManager });

    const result = await exec(EditOperationType.DELETE_ELEMENT, { elementId: "e1" });

    expect(result.success).toBe(true);
    expect(state.slides[0].elements.map((el) => el.id)).toEqual(["e2"]);

    const op = historyManager.push.mock.calls[0][0];
    op.undo();
    expect(state.slides[0].elements.map((el) => el.id)).toEqual(["e1", "e2"]);
    op.redo();
    expect(state.slides[0].elements.map((el) => el.id)).toEqual(["e2"]);
  });

  it("rejects add_element for invalid slideIndex values", async () => {
    const state = makeState({ slides: [] });
    const exec = createEditToolExecutor({ state });

    const result = await exec(EditOperationType.ADD_ELEMENT, { slideIndex: {}, elementType: "Text" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid slideIndex");
  });

  it("adds elements with normalized arrays and position handling", async () => {
    const state = makeState({ slides: [makeSlide("s1", { elements: {} })] });
    let count = 0;
    const exec = createEditToolExecutor({
      state,
      idGenerator: () => `el-${count++}`,
    });

    const result1 = await exec(EditOperationType.ADD_ELEMENT, {
      slideIndex: "0",
      elementType: "Text",
      position: { x: 10, y: 20 },
    });

    expect(result1.success).toBe(true);
    expect(Array.isArray(state.slides[0].elements)).toBe(true);
    expect(state.slides[0].elements[0].position).toEqual({ x: 10, y: 20 });

    const result2 = await exec(EditOperationType.ADD_ELEMENT, {
      slideIndex: 0,
      elementType: "Box",
      position: "not-an-object",
    });

    expect(result2.success).toBe(true);
    expect(state.slides[0].elements[1].position).toEqual({});
  });

  it("moves elements and syncs position fields with undo/redo", async () => {
    const element = { id: "e1", x: 1, y: 2, position: { x: 1, y: 2 } };
    const state = makeState({ slides: [makeSlide("s1", { elements: [element] })] });
    const historyManager = { push: vi.fn() };
    const exec = createEditToolExecutor({ state, historyManager });

    const result = await exec(EditOperationType.MOVE_ELEMENT, { elementId: "e1", x: 10, y: 20 });

    expect(result.success).toBe(true);
    expect(state.slides[0].elements[0].x).toBe(10);
    expect(state.slides[0].elements[0].position.x).toBe(10);
    expect(state.slides[0].elements[0].y).toBe(20);
    expect(state.slides[0].elements[0].position.y).toBe(20);

    const op = historyManager.push.mock.calls[0][0];
    op.undo();
    expect(state.slides[0].elements[0].x).toBe(1);
    expect(state.slides[0].elements[0].position.x).toBe(1);
    op.redo();
    expect(state.slides[0].elements[0].x).toBe(10);
  });

  it("resizes elements and syncs size fields with undo/redo", async () => {
    const element = {
      id: "e1",
      width: 100,
      height: 50,
      position: { width: 100, height: 50 },
    };
    const state = makeState({ slides: [makeSlide("s1", { elements: [element] })] });
    const historyManager = { push: vi.fn() };
    const exec = createEditToolExecutor({ state, historyManager });

    const result = await exec(EditOperationType.RESIZE_ELEMENT, {
      elementId: "e1",
      width: 200,
      height: 80,
    });

    expect(result.success).toBe(true);
    expect(state.slides[0].elements[0].width).toBe(200);
    expect(state.slides[0].elements[0].position.width).toBe(200);

    const op = historyManager.push.mock.calls[0][0];
    op.undo();
    expect(state.slides[0].elements[0].width).toBe(100);
    op.redo();
    expect(state.slides[0].elements[0].width).toBe(200);
  });

  it("rejects screenshot_current without bridge support", async () => {
    const exec = createEditToolExecutor({ state: makeState(), canvasBridge: {} });

    const result = await exec("screenshot_current", {});

    expect(result.success).toBe(false);
    expect(result.error).toContain("screenshot");
  });

  it("takes screenshot without recording history", async () => {
    const image = `data:${largeString}`;
    const screenshot = vi.fn().mockResolvedValue(image);
    const historyManager = { push: vi.fn() };
    const state = makeState();
    const exec = createEditToolExecutor({ state, canvasBridge: { screenshot }, historyManager });

    const result = await exec("screenshot_current");

    expect(result.success).toBe(true);
    expect(result.data.image).toBe(image);
    expect(screenshot).toHaveBeenCalledWith(state);
    expect(historyManager.push).not.toHaveBeenCalled();
  });

  it("rejects parse_canvas_state without bridge support", async () => {
    const exec = createEditToolExecutor({ state: makeState(), canvasBridge: {} });

    const result = await exec("parse_canvas_state", {});

    expect(result.success).toBe(false);
    expect(result.error).toContain("canvasToDsl");
  });

  it("parses canvas state, updates DSL, and skips history", async () => {
    const dsl = `<div>${largeString}</div>`;
    const canvasToDsl = vi.fn().mockResolvedValue(dsl);
    const historyManager = { push: vi.fn() };
    const state = makeState({
      slides: [makeSlide("s1", { htmlDsl: "" })],
      currentSlideIndex: 0,
    });
    const exec = createEditToolExecutor({ state, canvasBridge: { canvasToDsl }, historyManager });

    const result = await exec("parse_canvas_state", {});

    expect(result.success).toBe(true);
    expect(result.data.dsl).toBe(dsl);
    expect(state.currentDsl).toBe(dsl);
    expect(state.slides[0].htmlDsl).toBe(dsl);
    expect(historyManager.push).not.toHaveBeenCalled();
  });

  it("handles concurrent parse_canvas_state calls and final state reflects last completion", async () => {
    const state = makeState({
      slides: [makeSlide("s1", { htmlDsl: "" })],
      currentSlideIndex: 0,
    });
    const resolvers = [];
    const canvasBridge = {
      canvasToDsl: vi.fn(() => new Promise((resolve) => resolvers.push(resolve))),
    };
    const exec = createEditToolExecutor({ state, canvasBridge });

    const first = exec("parse_canvas_state");
    const second = exec("parse_canvas_state");
    resolvers[1]("dsl-2");
    resolvers[0]("dsl-1");

    const results = await Promise.all([first, second]);
    expect(results.map((entry) => entry.data.dsl).sort()).toEqual(["dsl-1", "dsl-2"]);
    expect(state.currentDsl).toBe("dsl-1");
    expect(state.slides[0].htmlDsl).toBe("dsl-1");
  });

  it("handles undo/redo tools with and without history manager", async () => {
    const execMissing = createEditToolExecutor({ state: makeState() });

    const missingUndo = await execMissing(EditOperationType.UNDO);
    expect(missingUndo.success).toBe(false);
    expect(missingUndo.error).toContain("History manager");

    const historyManager = {
      undo: vi.fn(() => "undo-entry"),
      redo: vi.fn(() => "redo-entry"),
      push: vi.fn(),
    };
    const exec = createEditToolExecutor({ state: makeState(), historyManager });

    const undoResult = await exec(EditOperationType.UNDO);
    const redoResult = await exec(EditOperationType.REDO);

    expect(undoResult.success).toBe(true);
    expect(undoResult.data.entry).toBe("undo-entry");
    expect(redoResult.success).toBe(true);
    expect(redoResult.data.entry).toBe("redo-entry");
    expect(historyManager.push).not.toHaveBeenCalled();
  });

  it("supports fast consecutive add_element calls", async () => {
    const state = makeState({ slides: [makeSlide("s1")] });
    let counter = 0;
    const exec = createEditToolExecutor({
      state,
      idGenerator: () => `fast-${counter++}`,
    });

    for (let i = 0; i < 5; i += 1) {
      await exec(EditOperationType.ADD_ELEMENT, { slideIndex: 0 });
    }

    expect(state.slides[0].elements.map((el) => el.id)).toEqual([
      "fast-0",
      "fast-1",
      "fast-2",
      "fast-3",
      "fast-4",
    ]);
  });
});
