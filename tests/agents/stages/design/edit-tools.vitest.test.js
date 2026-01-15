import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../js/agents/stages/design/constants.js", () => {
  return {
    EditOperationType: {
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
    },
  };
});

vi.mock("../../../../js/agents/shared/utils/value-utils.js", () => {
  return {
    isPlainObject: vi.fn((v) => Boolean(v) && typeof v === "object" && !Array.isArray(v)),
  };
});

import { EditOperationType } from "../../../../js/agents/stages/design/constants.js";
import { createEditToolExecutor } from "../../../../js/agents/stages/design/edit-mode/tools.js";

describe("design/edit-mode/tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an error for unknown tool names", async () => {
    const exec = createEditToolExecutor({ state: { slides: [] } });
    const out = await exec("nope", {});
    expect(out).toEqual({ success: false, error: "Unknown edit tool: nope" });
  });

  it("ADD_SLIDE inserts after afterIndex, pushes history, and undo/redo works", async () => {
    const historyManager = { push: vi.fn() };
    const state = { slides: [{ id: "s1", elements: [] }], currentSlideIndex: 0 };
    const exec = createEditToolExecutor({
      state,
      historyManager,
      slideIdGenerator: () => "slide_new",
    });

    const out = await exec(EditOperationType.ADD_SLIDE, { afterIndex: 0, title: "New slide" });
    expect(out.success).toBe(true);
    expect(state.slides).toHaveLength(2);
    expect(state.slides[1].id).toBe("slide_new");
    expect(historyManager.push).toHaveBeenCalledTimes(1);

    const op = historyManager.push.mock.calls[0][0];
    expect(op.type).toBe(EditOperationType.ADD_SLIDE);

    op.undo();
    expect(state.slides).toHaveLength(1);

    op.redo();
    expect(state.slides).toHaveLength(2);
  });

  it("DELETE_SLIDE validates slideIndex and updates currentSlideIndex", async () => {
    const historyManager = { push: vi.fn() };
    const state = { slides: [{ id: "a" }, { id: "b" }], currentSlideIndex: 1 };
    const exec = createEditToolExecutor({ state, historyManager });

    const bad = await exec(EditOperationType.DELETE_SLIDE, { slideIndex: 99 });
    expect(bad.success).toBe(false);
    expect(bad.error).toContain("Invalid slideIndex");

    const ok = await exec(EditOperationType.DELETE_SLIDE, { slideIndex: 1 });
    expect(ok.success).toBe(true);
    expect(state.slides).toHaveLength(1);
    expect(state.currentSlideIndex).toBe(0);
  });

  it("REORDER_SLIDES validates indices and creates reversible operation", async () => {
    const historyManager = { push: vi.fn() };
    const state = { slides: [{ id: "a" }, { id: "b" }, { id: "c" }], currentSlideIndex: 0 };
    const exec = createEditToolExecutor({ state, historyManager });

    const bad = await exec(EditOperationType.REORDER_SLIDES, { fromIndex: -1, toIndex: 1 });
    expect(bad.success).toBe(false);

    const ok = await exec(EditOperationType.REORDER_SLIDES, { fromIndex: 0, toIndex: 2 });
    expect(ok.success).toBe(true);
    expect(state.slides.map((s) => s.id)).toEqual(["b", "c", "a"]);

    const op = historyManager.push.mock.calls[0][0];
    op.undo();
    expect(state.slides.map((s) => s.id)).toEqual(["a", "b", "c"]);
    op.redo();
    expect(state.slides.map((s) => s.id)).toEqual(["b", "c", "a"]);
  });

  it("DUPLICATE_SLIDE clones a slide and is undoable", async () => {
    const historyManager = { push: vi.fn() };
    const state = { slides: [{ id: "a", title: "A" }], currentSlideIndex: 0 };
    const exec = createEditToolExecutor({ state, historyManager, slideIdGenerator: () => "dup1" });

    const out = await exec(EditOperationType.DUPLICATE_SLIDE, { slideIndex: 0 });
    expect(out.success).toBe(true);
    expect(state.slides).toHaveLength(2);
    expect(state.slides[1].id).toBe("dup1");

    const op = historyManager.push.mock.calls[0][0];
    op.undo();
    expect(state.slides).toHaveLength(1);
  });

  it("CHANGE_COLOR_SCHEME updates tokens and emits warning when deviating from styleLock (edge)", async () => {
    const emit = vi.fn();
    const historyManager = { push: vi.fn() };
    const state = {
      slides: [],
      designSystem: {
        styleLock: { colors: { primary: "#111111", accent: "#222222" } },
        designTokens: { colors: { primary: "#111111", accent: "#222222" } },
      },
    };
    const exec = createEditToolExecutor({ state, historyManager, emit });

    const out = await exec(EditOperationType.CHANGE_COLOR_SCHEME, { primary: "#999999" });
    expect(out.success).toBe(true);
    expect(state.designSystem.designTokens.colors.primary).toBe("#999999");
    expect(out.data.styleDeviations).toBeTruthy();
    expect(emit).toHaveBeenCalledWith(
      "edit.style.deviation",
      expect.objectContaining({ status: "warning", payload: expect.objectContaining({ deviations: expect.any(Array) }) })
    );
  });

  it("CHANGE_FONT and APPLY_THEME update designSystem tokens and are undoable", async () => {
    const historyManager = { push: vi.fn() };
    const state = { slides: [], designSystem: { theme: "light", designTokens: {} } };
    const exec = createEditToolExecutor({ state, historyManager });

    const font = await exec(EditOperationType.CHANGE_FONT, { headingFont: "H", bodyFont: "B" });
    expect(font.success).toBe(true);
    expect(state.designSystem.designTokens.typography.headingFont).toBe("H");

    const theme = await exec(EditOperationType.APPLY_THEME, { themeName: "dark" });
    expect(theme.success).toBe(true);
    expect(state.designSystem.theme).toBe("dark");
  });

  it("EDIT_ELEMENT/DELETE_ELEMENT/ADD_ELEMENT update slide elements and report errors for missing targets", async () => {
    const historyManager = { push: vi.fn() };
    const state = {
      slides: [{ id: "s1", elements: [{ id: "el1", type: "text", position: { x: 1, y: 2 } }] }],
    };
    const exec = createEditToolExecutor({ state, historyManager, idGenerator: () => "el_new" });

    const missing = await exec(EditOperationType.EDIT_ELEMENT, { elementId: "nope", changes: { text: "x" } });
    expect(missing.success).toBe(false);
    expect(missing.error).toContain("Element not found");

    const badChanges = await exec(EditOperationType.EDIT_ELEMENT, { elementId: "el1", changes: "nope" });
    expect(badChanges.success).toBe(false);
    expect(badChanges.error).toContain("changes must be an object");

    const edited = await exec(EditOperationType.EDIT_ELEMENT, { elementId: "el1", changes: { type: "shape" } });
    expect(edited.success).toBe(true);
    expect(state.slides[0].elements[0].type).toBe("shape");

    const added = await exec(EditOperationType.ADD_ELEMENT, { slideIndex: 0, elementType: "icon", position: { x: 3 } });
    expect(added.success).toBe(true);
    expect(added.data.element.id).toBe("el_new");

    const deleted = await exec(EditOperationType.DELETE_ELEMENT, { elementId: "el_new" });
    expect(deleted.success).toBe(true);
  });

  it("MOVE_ELEMENT/RESIZE_ELEMENT update position values and handle missing elements", async () => {
    const historyManager = { push: vi.fn() };
    const state = {
      slides: [{ id: "s1", elements: [{ id: "el1", position: { x: 1, y: 2, width: 10, height: 20 } }] }],
    };
    const exec = createEditToolExecutor({ state, historyManager });

    const missing = await exec(EditOperationType.MOVE_ELEMENT, { elementId: "nope", x: 1 });
    expect(missing.success).toBe(false);

    const moved = await exec(EditOperationType.MOVE_ELEMENT, { elementId: "el1", x: 9 });
    expect(moved.success).toBe(true);
    expect(state.slides[0].elements[0].x).toBe(9);
    expect(state.slides[0].elements[0].position.x).toBe(9);

    const resized = await exec(EditOperationType.RESIZE_ELEMENT, { elementId: "el1", width: 99, height: 88 });
    expect(resized.success).toBe(true);
    expect(state.slides[0].elements[0].width).toBe(99);
    expect(state.slides[0].elements[0].position.height).toBe(88);
  });

  it("screenshot_current/parse_canvas_state require canvasBridge and are skipHistory", async () => {
    const historyManager = { push: vi.fn(), undo: vi.fn(() => "u"), redo: vi.fn(() => "r") };
    const state = { slides: [{ id: "s1", htmlDsl: "" }], currentSlideIndex: 0 };

    const execNoBridge = createEditToolExecutor({ state, historyManager });
    expect((await execNoBridge("screenshot_current", {})).success).toBe(false);
    expect((await execNoBridge("parse_canvas_state", {})).success).toBe(false);

    const canvasBridge = {
      screenshot: vi.fn(async () => "img"),
      canvasToDsl: vi.fn(async () => "<section/>"),
    };
    const exec = createEditToolExecutor({ state, historyManager, canvasBridge });

    const shot = await exec("screenshot_current", {});
    expect(shot).toEqual({ success: true, data: { image: "img" } });
    expect(historyManager.push).not.toHaveBeenCalled();

    const parsed = await exec("parse_canvas_state", {});
    expect(parsed.success).toBe(true);
    expect(state.currentDsl).toBe("<section/>");
    expect(state.slides[0].htmlDsl).toBe("<section/>");
  });

  it("UNDO/REDO require historyManager and do not add history entries", async () => {
    const state = { slides: [] };
    const execMissing = createEditToolExecutor({ state });
    expect((await execMissing(EditOperationType.UNDO, {})).success).toBe(false);

    const historyManager = { push: vi.fn(), undo: vi.fn(() => ({ ok: 1 })), redo: vi.fn(() => ({ ok: 2 })) };
    const exec = createEditToolExecutor({ state, historyManager });
    const u = await exec(EditOperationType.UNDO, {});
    const r = await exec(EditOperationType.REDO, {});
    expect(u).toEqual({ success: true, data: { entry: { ok: 1 } } });
    expect(r).toEqual({ success: true, data: { entry: { ok: 2 } } });
    expect(historyManager.push).not.toHaveBeenCalled();
  });
});

