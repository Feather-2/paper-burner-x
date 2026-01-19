/**
 * edit-mode/tools.js 单元测试
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createEditToolExecutor, EditModeTools } from '../../../../../js/agents/stages/design/edit-mode/tools.js';

describe("edit-mode/tools", () => {
  let context;
  let executeEditTool;

  beforeEach(() => {
    context = {
      state: {
        slides: [
          { id: "slide_1", elements: [{ id: "el_1", type: "text", x: 0, y: 0 }] },
          { id: "slide_2", elements: [] },
        ],
        designSystem: {
          designTokens: { colors: {}, typography: {} },
        },
        currentSlideIndex: 0,
      },
    };
    executeEditTool = createEditToolExecutor(context);
  });

  describe("EditModeTools", () => {
    it("should export tool definitions", () => {
      expect(EditModeTools).toBeDefined();
      expect(EditModeTools.add_slide).toBeDefined();
      expect(EditModeTools.delete_slide).toBeDefined();
    });
  });

  describe("createEditToolExecutor", () => {
    it("should return a function", () => {
      const executor = createEditToolExecutor({});
      expect(typeof executor).toBe("function");
    });

    it("should handle non-object context", () => {
      const executor = createEditToolExecutor(null);
      expect(typeof executor).toBe("function");
    });

    it("should return error when state is missing", async () => {
      const executor = createEditToolExecutor({});
      const result = await executor("add_slide", {});
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/state must be provided/i);
    });
  });

  describe("unknown tool", () => {
    it("should return error for unknown tool", async () => {
      const result = await executeEditTool("unknown_tool", {});
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/unknown/i);
    });

    it("should return error for non-string tool name", async () => {
      const result = await executeEditTool(null, {});
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/unknown edit tool/i);
    });
  });

  describe("ADD_SLIDE", () => {
    it("should add slide at end when no afterIndex", async () => {
      const result = await executeEditTool("add_slide", {});
      expect(result.success).toBe(true);
      expect(context.state.slides.length).toBe(3);
    });

    it("should add slide after specified index", async () => {
      const result = await executeEditTool("add_slide", { afterIndex: 0 });
      expect(result.success).toBe(true);
      expect(context.state.slides.length).toBe(3);
    });

    it("should handle string afterIndex", async () => {
      const result = await executeEditTool("add_slide", { afterIndex: "0" });
      expect(result.success).toBe(true);
      expect(context.state.slides.length).toBe(3);
    });

    it("should execute undo/redo callbacks for add_slide", async () => {
      const push = vi.fn();
      context.historyManager = { push };
      context.state.currentSlideIndex = 0;
      executeEditTool = createEditToolExecutor(context);

      const result = await executeEditTool("add_slide", { afterIndex: -1, slideId: "slide_new", template: "hero" });
      expect(result.success).toBe(true);
      expect(push).toHaveBeenCalled();
      expect(context.state.slides[0].id).toBe("slide_new");
      expect(context.state.slides[0].template).toBe("hero");

      const operation = push.mock.calls[0][0];
      // redo while the slide exists should not duplicate it
      if (operation.redo) operation.redo();
      expect(context.state.slides.filter((s) => s.id === "slide_new").length).toBe(1);

      if (operation.undo) operation.undo();
      expect(context.state.slides.find((s) => s.id === "slide_new")).toBeUndefined();
      // Calling undo again should not throw (idx === -1 branch)
      if (operation.undo) expect(() => operation.undo()).not.toThrow();

      if (operation.redo) operation.redo();
      expect(context.state.slides.find((s) => s.id === "slide_new")).toBeDefined();
      // Calling redo again should not duplicate
      if (operation.redo) operation.redo();
      expect(context.state.slides.filter((s) => s.id === "slide_new").length).toBe(1);
    });

    it("should handle undo/redo callbacks when currentSlideIndex is not finite", async () => {
      const push = vi.fn();
      context.historyManager = { push };
      context.state.currentSlideIndex = Number.NaN;
      executeEditTool = createEditToolExecutor(context);

      await executeEditTool("add_slide", { slideId: "slide_nan" });
      expect(Number.isNaN(context.state.currentSlideIndex)).toBe(true);

      const operation = push.mock.calls[0][0];
      if (operation.undo) operation.undo();
      if (operation.redo) operation.redo();
      expect(Number.isNaN(context.state.currentSlideIndex)).toBe(true);
    });
  });

  describe("DELETE_SLIDE", () => {
    it("should delete slide at index", async () => {
      const result = await executeEditTool("delete_slide", { slideIndex: 1 });
      expect(result.success).toBe(true);
      expect(context.state.slides.length).toBe(1);
    });

    it("should return error on invalid slideIndex", async () => {
      const result = await executeEditTool("delete_slide", { slideIndex: 99 });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/invalid slideIndex/i);
    });

    it("should return error on negative slideIndex", async () => {
      const result = await executeEditTool("delete_slide", { slideIndex: -1 });
      expect(result.success).toBe(false);
    });

    it("should update currentSlideIndex when deleting current slide", async () => {
      context.state.currentSlideIndex = 1;
      await executeEditTool("delete_slide", { slideIndex: 1 });
      expect(context.state.currentSlideIndex).toBe(0);
    });

    it("should update currentSlideIndex when deleting before current", async () => {
      context.state.currentSlideIndex = 1;
      await executeEditTool("delete_slide", { slideIndex: 0 });
      expect(context.state.currentSlideIndex).toBe(0);
    });

    it("should execute undo/redo callbacks for delete_slide", async () => {
      const push = vi.fn();
      context.historyManager = { push };
      context.state.currentSlideIndex = 0;
      executeEditTool = createEditToolExecutor(context);

      await executeEditTool("delete_slide", { slideIndex: 1 });
      expect(context.state.slides.length).toBe(1);

      const operation = push.mock.calls[0][0];
      if (operation.undo) operation.undo();
      expect(context.state.slides.length).toBe(2);

      if (operation.redo) operation.redo();
      expect(context.state.slides.length).toBe(1);
      // Calling redo again should not throw (idx === -1 branch)
      if (operation.redo) expect(() => operation.redo()).not.toThrow();
    });

    it("should handle undo/redo callbacks for delete_slide when currentSlideIndex is not finite", async () => {
      const push = vi.fn();
      context.historyManager = { push };
      context.state.currentSlideIndex = Number.NaN;
      executeEditTool = createEditToolExecutor(context);

      await executeEditTool("delete_slide", { slideIndex: 1 });
      expect(Number.isNaN(context.state.currentSlideIndex)).toBe(true);

      const operation = push.mock.calls[0][0];
      if (operation.undo) operation.undo();
      if (operation.redo) operation.redo();
      expect(Number.isNaN(context.state.currentSlideIndex)).toBe(true);
    });
  });

  describe("REORDER_SLIDES", () => {
    it("should reorder slides", async () => {
      const result = await executeEditTool("reorder_slides", { fromIndex: 0, toIndex: 1 });
      expect(result.success).toBe(true);
      expect(context.state.slides[0].id).toBe("slide_2");
      expect(context.state.slides[1].id).toBe("slide_1");
    });

    it("should return error on invalid indices", async () => {
      const result = await executeEditTool("reorder_slides", { fromIndex: 0, toIndex: 99 });
      expect(result.success).toBe(false);
    });

    it("should return error on null indices", async () => {
      const result = await executeEditTool("reorder_slides", { fromIndex: null, toIndex: 1 });
      expect(result.success).toBe(false);
    });

    it("should update currentSlideIndex when current slide moves", async () => {
      context.state.currentSlideIndex = 0;
      await executeEditTool("reorder_slides", { fromIndex: 0, toIndex: 1 });
      expect(context.state.currentSlideIndex).toBe(1);
    });

    it("should update currentSlideIndex when slide moves past current", async () => {
      context.state.currentSlideIndex = 1;
      await executeEditTool("reorder_slides", { fromIndex: 0, toIndex: 1 });
      expect(context.state.currentSlideIndex).toBe(0);
    });

    it("should update currentSlideIndex when a slide moves before the current slide", async () => {
      const push = vi.fn();
      context.historyManager = { push };
      context.state.currentSlideIndex = 0;
      executeEditTool = createEditToolExecutor(context);

      await executeEditTool("reorder_slides", { fromIndex: 1, toIndex: 0 });
      expect(context.state.slides[0].id).toBe("slide_2");
      expect(context.state.currentSlideIndex).toBe(1);

      const operation = push.mock.calls[0][0];
      if (operation.undo) operation.undo();
      expect(context.state.slides[0].id).toBe("slide_1");
      expect(context.state.currentSlideIndex).toBe(0);

      if (operation.redo) operation.redo();
      expect(context.state.slides[0].id).toBe("slide_2");
      expect(context.state.currentSlideIndex).toBe(1);
    });

    it("should handle undo/redo callbacks for reorder_slides when currentSlideIndex is not finite", async () => {
      const push = vi.fn();
      context.historyManager = { push };
      context.state.currentSlideIndex = Number.NaN;
      executeEditTool = createEditToolExecutor(context);

      await executeEditTool("reorder_slides", { fromIndex: 0, toIndex: 1 });
      expect(Number.isNaN(context.state.currentSlideIndex)).toBe(true);

      const operation = push.mock.calls[0][0];
      if (operation.undo) operation.undo();
      if (operation.redo) operation.redo();
      expect(Number.isNaN(context.state.currentSlideIndex)).toBe(true);
    });
  });

  describe("DUPLICATE_SLIDE", () => {
    it("should duplicate slide", async () => {
      const result = await executeEditTool("duplicate_slide", { slideIndex: 0 });
      expect(result.success).toBe(true);
      expect(context.state.slides.length).toBe(3);
    });

    it("should return error on invalid slideIndex", async () => {
      const result = await executeEditTool("duplicate_slide", { slideIndex: -1 });
      expect(result.success).toBe(false);
    });

    it("should update currentSlideIndex when duplicating before current", async () => {
      context.state.currentSlideIndex = 1;
      await executeEditTool("duplicate_slide", { slideIndex: 0 });
      expect(context.state.currentSlideIndex).toBe(2);
    });

    it("should execute undo/redo callbacks for duplicate_slide", async () => {
      const push = vi.fn();
      context.historyManager = { push };
      context.state.currentSlideIndex = 0;
      executeEditTool = createEditToolExecutor(context);

      await executeEditTool("duplicate_slide", { slideIndex: 0, newSlideId: "slide_dup_1" });
      expect(context.state.slides.find((s) => s.id === "slide_dup_1")).toBeDefined();

      const operation = push.mock.calls[0][0];
      // redo while the duplicate exists should not add another copy
      if (operation.redo) operation.redo();
      expect(context.state.slides.filter((s) => s.id === "slide_dup_1").length).toBe(1);

      if (operation.undo) operation.undo();
      expect(context.state.slides.find((s) => s.id === "slide_dup_1")).toBeUndefined();
      // Calling undo again should not throw (idx === -1 branch)
      if (operation.undo) expect(() => operation.undo()).not.toThrow();

      if (operation.redo) operation.redo();
      expect(context.state.slides.filter((s) => s.id === "slide_dup_1").length).toBe(1);
      // Calling redo again should not duplicate
      if (operation.redo) operation.redo();
      expect(context.state.slides.filter((s) => s.id === "slide_dup_1").length).toBe(1);
    });

    it("should handle undo/redo callbacks for duplicate_slide when currentSlideIndex is not finite", async () => {
      const push = vi.fn();
      context.historyManager = { push };
      context.state.currentSlideIndex = Number.NaN;
      executeEditTool = createEditToolExecutor(context);

      await executeEditTool("duplicate_slide", { slideIndex: 0, newSlideId: "slide_dup_nan" });
      expect(Number.isNaN(context.state.currentSlideIndex)).toBe(true);

      const operation = push.mock.calls[0][0];
      if (operation.undo) operation.undo();
      if (operation.redo) operation.redo();
      expect(Number.isNaN(context.state.currentSlideIndex)).toBe(true);
    });
  });

  describe("CHANGE_COLOR_SCHEME", () => {
    it("should change colors", async () => {
      const result = await executeEditTool("change_color_scheme", { primary: "#FF0000", accent: "#00FF00" });
      expect(result.success).toBe(true);
      expect(context.state.designSystem.designTokens.colors.primary).toBe("#FF0000");
    });

    it("should only update provided colors", async () => {
      await executeEditTool("change_color_scheme", { primary: "#FF0000" });
      expect(context.state.designSystem.designTokens.colors.primary).toBe("#FF0000");
      expect(context.state.designSystem.designTokens.colors.accent).toBeUndefined();
    });

    it("should emit style deviation warning when locked style exists", async () => {
      context.state.designSystem.styleLock = { colors: { primary: "#000000" } };
      const emit = vi.fn();
      context.emit = emit;
      executeEditTool = createEditToolExecutor(context);

      await executeEditTool("change_color_scheme", { primary: "#FF0000" });
      expect(emit).toHaveBeenCalledWith("edit.style.deviation", expect.any(Object));
    });

    it("should not emit warning when color matches locked style", async () => {
      context.state.designSystem.styleLock = { colors: { primary: "#000000" } };
      const emit = vi.fn();
      context.emit = emit;
      executeEditTool = createEditToolExecutor(context);

      await executeEditTool("change_color_scheme", { primary: "#000000" });
      expect(emit).not.toHaveBeenCalled();
    });

    it("should allow accent-only updates (no primary)", async () => {
      const result = await executeEditTool("change_color_scheme", { accent: "#00FF00" });
      expect(result.success).toBe(true);
      expect(context.state.designSystem.designTokens.colors.accent).toBe("#00FF00");
      expect(context.state.designSystem.designTokens.colors.primary).toBeUndefined();
    });

    it("should update background color", async () => {
      const result = await executeEditTool("change_color_scheme", { background: "#FFFFFF" });
      expect(result.success).toBe(true);
      expect(context.state.designSystem.designTokens.colors.background).toBe("#FFFFFF");
    });

    it("should return styleDeviations even when emit is not provided", async () => {
      context.state.designSystem.styleLock = { colors: { primary: "#000000" } };
      executeEditTool = createEditToolExecutor(context);

      const result = await executeEditTool("change_color_scheme", { primary: "#FF0000" });
      expect(result.success).toBe(true);
      expect(Array.isArray(result.data.styleDeviations)).toBe(true);
      expect(result.data.styleDeviations.length).toBeGreaterThan(0);
    });

    it("should ignore lock when the color key is not locked", async () => {
      context.state.designSystem.styleLock = { colors: { primary: "#000000" } };
      executeEditTool = createEditToolExecutor(context);

      const result = await executeEditTool("change_color_scheme", { accent: "#00FF00" });
      expect(result.success).toBe(true);
      expect(result.data.styleDeviations).toBeUndefined();
    });
  });

  describe("CHANGE_FONT", () => {
    it("should change fonts", async () => {
      const result = await executeEditTool("change_font", { headingFont: "Arial", bodyFont: "Georgia" });
      expect(result.success).toBe(true);
      expect(context.state.designSystem.designTokens.typography.headingFont).toBe("Arial");
    });

    it("should only update provided fonts", async () => {
      await executeEditTool("change_font", { headingFont: "Arial" });
      expect(context.state.designSystem.designTokens.typography.headingFont).toBe("Arial");
      expect(context.state.designSystem.designTokens.typography.bodyFont).toBeUndefined();
    });

    it("should initialize typography container and handle bodyFont-only updates", async () => {
      context.state.designSystem.designTokens.typography = null;
      executeEditTool = createEditToolExecutor(context);

      const result = await executeEditTool("change_font", { bodyFont: "Georgia" });
      expect(result.success).toBe(true);
      expect(context.state.designSystem.designTokens.typography.headingFont).toBeUndefined();
      expect(context.state.designSystem.designTokens.typography.bodyFont).toBe("Georgia");
    });
  });

  describe("APPLY_THEME", () => {
    it("should apply theme with themeName", async () => {
      const result = await executeEditTool("apply_theme", { themeName: "dark" });
      expect(result.success).toBe(true);
      expect(context.state.designSystem.theme).toBe("dark");
    });

    it("should apply theme with theme param", async () => {
      const result = await executeEditTool("apply_theme", { theme: "light" });
      expect(result.success).toBe(true);
      expect(context.state.designSystem.theme).toBe("light");
    });

    it("should keep the existing theme when no theme params are provided", async () => {
      context.state.designSystem.theme = "base";
      executeEditTool = createEditToolExecutor(context);

      const result = await executeEditTool("apply_theme", {});
      expect(result.success).toBe(true);
      expect(context.state.designSystem.theme).toBe("base");
    });

    it("should initialize designSystem when missing", async () => {
      context.state.designSystem = null;
      executeEditTool = createEditToolExecutor(context);

      const result = await executeEditTool("apply_theme", { themeName: "dark" });
      expect(result.success).toBe(true);
      expect(context.state.designSystem.theme).toBe("dark");
    });
  });

  describe("EDIT_ELEMENT", () => {
    it("should edit element", async () => {
      const result = await executeEditTool("edit_element", { elementId: "el_1", changes: { text: "Hello" } });
      expect(result.success).toBe(true);
      expect(context.state.slides[0].elements[0].text).toBe("Hello");
    });

    it("should return error on element not found", async () => {
      const result = await executeEditTool("edit_element", { elementId: "unknown", changes: {} });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/element not found/i);
    });

    it("should return error on invalid changes", async () => {
      const result = await executeEditTool("edit_element", { elementId: "el_1", changes: null });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/changes must be an object/i);
    });

    it("should return error when changes is an array", async () => {
      const result = await executeEditTool("edit_element", { elementId: "el_1", changes: [] });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/changes must be an object/i);
    });

    it("should execute undo/redo callbacks for edit_element", async () => {
      const push = vi.fn();
      context.historyManager = { push };
      executeEditTool = createEditToolExecutor(context);

      await executeEditTool("edit_element", { elementId: "el_1", changes: { text: "Updated" } });
      expect(context.state.slides[0].elements[0].text).toBe("Updated");

      const operation = push.mock.calls[0][0];
      if (operation.undo) operation.undo();
      expect(context.state.slides[0].elements[0].text).toBeUndefined();

      if (operation.redo) operation.redo();
      expect(context.state.slides[0].elements[0].text).toBe("Updated");
    });
  });

  describe("DELETE_ELEMENT", () => {
    it("should delete element", async () => {
      const result = await executeEditTool("delete_element", { elementId: "el_1" });
      expect(result.success).toBe(true);
      expect(context.state.slides[0].elements.length).toBe(0);
    });

    it("should return error on element not found", async () => {
      const result = await executeEditTool("delete_element", { elementId: "unknown" });
      expect(result.success).toBe(false);
    });

    it("should execute undo/redo callbacks for delete_element (including empty list cases)", async () => {
      const push = vi.fn();
      context.historyManager = { push };
      executeEditTool = createEditToolExecutor(context);

      await executeEditTool("delete_element", { elementId: "el_1" });
      expect(context.state.slides[0].elements.length).toBe(0);

      const operation = push.mock.calls[0][0];
      // redo right after delete should be a no-op (idx === -1 branch)
      if (operation.redo) expect(() => operation.redo()).not.toThrow();

      if (operation.undo) operation.undo();
      expect(context.state.slides[0].elements.length).toBe(1);

      if (operation.redo) operation.redo();
      expect(context.state.slides[0].elements.length).toBe(0);
      // redo again should be safe when elements list is empty
      if (operation.redo) expect(() => operation.redo()).not.toThrow();
    });
  });

  describe("ADD_ELEMENT", () => {
    it("should add element", async () => {
      const result = await executeEditTool("add_element", { slideIndex: 0, elementType: "image" });
      expect(result.success).toBe(true);
      expect(context.state.slides[0].elements.length).toBe(2);
    });

    it("should return error on invalid slideIndex", async () => {
      const result = await executeEditTool("add_element", { slideIndex: 99, elementType: "text" });
      expect(result.success).toBe(false);
    });

    it("should handle position object", async () => {
      const result = await executeEditTool("add_element", { slideIndex: 0, elementType: "text", position: { x: 10, y: 20 } });
      expect(result.success).toBe(true);
      expect(result.data.element.position.x).toBe(10);
    });

    it("should execute undo/redo callbacks for add_element with empty/undefined elements list", async () => {
      const push = vi.fn();
      context.historyManager = { push };
      // Force ensureElements() to initialize slide.elements
      context.state.slides[1].elements = undefined;
      executeEditTool = createEditToolExecutor(context);

      const result = await executeEditTool("add_element", {
        slideIndex: "1",
        elementId: "el_new_1",
        elementType: "text",
        position: "not-an-object",
      });
      expect(result.success).toBe(true);
      expect(context.state.slides[1].elements.length).toBe(1);
      expect(result.data.element.position).toEqual({});

      const operation = push.mock.calls[0][0];
      if (operation.undo) operation.undo();
      expect(context.state.slides[1].elements.length).toBe(0);
      // Calling undo again should not throw (idx === -1 branch)
      if (operation.undo) expect(() => operation.undo()).not.toThrow();

      if (operation.redo) operation.redo();
      expect(context.state.slides[1].elements.find((el) => el.id === "el_new_1")).toBeDefined();
      // Calling redo again should not duplicate
      if (operation.redo) operation.redo();
      expect(context.state.slides[1].elements.filter((el) => el.id === "el_new_1").length).toBe(1);
    });

    it("should return error on invalid slideIndex string", async () => {
      const result = await executeEditTool("add_element", { slideIndex: "nope" });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/invalid slideIndex/i);
    });
  });

  describe("MOVE_ELEMENT", () => {
    it("should move element", async () => {
      const result = await executeEditTool("move_element", { elementId: "el_1", x: 100, y: 200 });
      expect(result.success).toBe(true);
      expect(context.state.slides[0].elements[0].x).toBe(100);
    });

    it("should return error on element not found", async () => {
      const result = await executeEditTool("move_element", { elementId: "unknown", x: 0, y: 0 });
      expect(result.success).toBe(false);
    });

    it("should only update provided coordinates", async () => {
      await executeEditTool("move_element", { elementId: "el_1", x: 100 });
      expect(context.state.slides[0].elements[0].x).toBe(100);
      expect(context.state.slides[0].elements[0].y).toBe(0);
    });

    it("should only update provided coordinates (y only)", async () => {
      await executeEditTool("move_element", { elementId: "el_1", y: 200 });
      expect(context.state.slides[0].elements[0].x).toBe(0);
      expect(context.state.slides[0].elements[0].y).toBe(200);
    });
  });

  describe("RESIZE_ELEMENT", () => {
    it("should resize element", async () => {
      const result = await executeEditTool("resize_element", { elementId: "el_1", width: 300, height: 400 });
      expect(result.success).toBe(true);
      expect(context.state.slides[0].elements[0].width).toBe(300);
    });

    it("should return error on element not found", async () => {
      const result = await executeEditTool("resize_element", { elementId: "unknown", width: 100, height: 100 });
      expect(result.success).toBe(false);
    });

    it("should only update provided dimensions (height only)", async () => {
      context.state.slides[0].elements[0] = { id: "el_1", type: "text", height: 60 };
      executeEditTool = createEditToolExecutor(context);

      const result = await executeEditTool("resize_element", { elementId: "el_1", height: 300 });
      expect(result.success).toBe(true);
      expect(context.state.slides[0].elements[0].width).toBeUndefined();
      expect(context.state.slides[0].elements[0].height).toBe(300);
    });
  });

  describe("screenshot_current", () => {
    it("should return error when bridge not available", async () => {
      const result = await executeEditTool("screenshot_current", {});
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/canvas bridge/i);
    });

    it("should return error when bridge.screenshot is not a function", async () => {
      context.canvasBridge = { screenshot: "not-a-function" };
      executeEditTool = createEditToolExecutor(context);

      const result = await executeEditTool("screenshot_current", {});
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/screenshot\(\) not available/i);
    });

    it("should return image when bridge available", async () => {
      context.canvasBridge = { screenshot: vi.fn().mockResolvedValue("base64image") };
      executeEditTool = createEditToolExecutor(context);

      const result = await executeEditTool("screenshot_current", {});
      expect(result.success).toBe(true);
      expect(result.data.image).toBe("base64image");
    });

    it("should return error when screenshot throws", async () => {
      context.canvasBridge = { screenshot: vi.fn().mockRejectedValue(new Error("boom")) };
      executeEditTool = createEditToolExecutor(context);

      const result = await executeEditTool("screenshot_current", {});
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/boom/);
    });
  });

  describe("parse_canvas_state", () => {
    it("should return error when bridge not available", async () => {
      const result = await executeEditTool("parse_canvas_state", {});
      expect(result.success).toBe(false);
    });

    it("should return error when bridge.canvasToDsl is not a function", async () => {
      context.canvasBridge = { canvasToDsl: "not-a-function" };
      executeEditTool = createEditToolExecutor(context);

      const result = await executeEditTool("parse_canvas_state", {});
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/canvasToDsl\(\) not available/i);
    });

    it("should return dsl when bridge available", async () => {
      context.canvasBridge = { canvasToDsl: vi.fn().mockResolvedValue("<div>DSL</div>") };
      executeEditTool = createEditToolExecutor(context);

      const result = await executeEditTool("parse_canvas_state", {});
      expect(result.success).toBe(true);
      expect(result.data.dsl).toBe("<div>DSL</div>");
      expect(context.state.currentDsl).toBe("<div>DSL</div>");
    });

    it("should handle non-finite currentSlideIndex and missing slide gracefully", async () => {
      context.state.slides = [];
      context.state.currentSlideIndex = Number.NaN;
      context.canvasBridge = { canvasToDsl: vi.fn().mockResolvedValue("<div>DSL</div>") };
      executeEditTool = createEditToolExecutor(context);

      const result = await executeEditTool("parse_canvas_state", {});
      expect(result.success).toBe(true);
      expect(result.data.dsl).toBe("<div>DSL</div>");
      expect(context.state.currentDsl).toBe("<div>DSL</div>");
    });

    it("should return error when canvasToDsl throws", async () => {
      context.canvasBridge = { canvasToDsl: vi.fn().mockRejectedValue(new Error("dsl_fail")) };
      executeEditTool = createEditToolExecutor(context);

      const result = await executeEditTool("parse_canvas_state", {});
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/dsl_fail/);
    });
  });

  describe("UNDO", () => {
    it("should return error when history manager not available", async () => {
      const result = await executeEditTool("undo", {});
      expect(result.success).toBe(false);
    });

    it("should call history manager undo", async () => {
      const undo = vi.fn().mockReturnValue({ entry: "test" });
      context.historyManager = { undo };
      executeEditTool = createEditToolExecutor(context);

      const result = await executeEditTool("undo", {});
      expect(undo).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });
  });

  describe("REDO", () => {
    it("should return error when history manager not available", async () => {
      const result = await executeEditTool("redo", {});
      expect(result.success).toBe(false);
    });

    it("should call history manager redo", async () => {
      const redo = vi.fn().mockReturnValue({ entry: "test" });
      context.historyManager = { redo };
      executeEditTool = createEditToolExecutor(context);

      const result = await executeEditTool("redo", {});
      expect(redo).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });
  });

  describe("history integration", () => {
    it("should push to history manager when operation returned", async () => {
      const push = vi.fn();
      context.historyManager = { push };
      executeEditTool = createEditToolExecutor(context);

      await executeEditTool("add_slide", {});
      expect(push).toHaveBeenCalled();
    });

    it("should not push to history when skipHistory is true", async () => {
      const push = vi.fn();
      context.historyManager = { push, undo: vi.fn().mockReturnValue({}) };
      executeEditTool = createEditToolExecutor(context);

      await executeEditTool("undo", {});
      expect(push).not.toHaveBeenCalled();
    });

    it("should stringify thrown values when they do not have a message", async () => {
      const push = vi.fn(() => {
        throw "push_failed";
      });
      context.historyManager = { push };
      executeEditTool = createEditToolExecutor(context);

      const result = await executeEditTool("add_slide", {});
      expect(result.success).toBe(false);
      expect(result.error).toBe("push_failed");
    });
  });

  describe("edge cases", () => {
    it("should handle currentState fallback", async () => {
      const ctx = { currentState: { slides: [] } };
      const exec = createEditToolExecutor(ctx);
      const result = await exec("add_slide", {});
      expect(result.success).toBe(true);
    });

    it("should handle designSystem.tokens fallback", async () => {
      context.state.designSystem = { tokens: { colors: {} } };
      executeEditTool = createEditToolExecutor(context);
      const result = await executeEditTool("change_color_scheme", { primary: "#123" });
      expect(result.success).toBe(true);
    });

    it("should fallback to designSystem directly when no tokens", async () => {
      context.state.designSystem = {};
      executeEditTool = createEditToolExecutor(context);
      const result = await executeEditTool("change_color_scheme", { primary: "#456" });
      expect(result.success).toBe(true);
    });

    it("should initialize slides array if missing", async () => {
      context.state.slides = undefined;
      executeEditTool = createEditToolExecutor(context);
      const result = await executeEditTool("add_slide", {});
      expect(result.success).toBe(true);
      expect(context.state.slides.length).toBe(1);
    });

    it("should use custom idGenerator", async () => {
      context.idGenerator = vi.fn().mockReturnValue("custom_el_id");
      executeEditTool = createEditToolExecutor(context);
      const result = await executeEditTool("add_element", { slideIndex: 0 });
      expect(result.data.element.id).toBe("custom_el_id");
    });

    it("should use custom slideIdGenerator", async () => {
      context.slideIdGenerator = vi.fn().mockReturnValue("custom_slide_id");
      executeEditTool = createEditToolExecutor(context);
      const result = await executeEditTool("add_slide", {});
      expect(result.data.slide.id).toBe("custom_slide_id");
    });

    it("should handle element with position object", async () => {
      context.state.slides[0].elements[0].position = { x: 5, y: 10 };
      executeEditTool = createEditToolExecutor(context);
      await executeEditTool("move_element", { elementId: "el_1", x: 50, y: 100 });
      expect(context.state.slides[0].elements[0].position.x).toBe(50);
    });

    it("should treat missing slide.elements as an empty list", async () => {
      context.state.slides[0].elements = undefined;
      executeEditTool = createEditToolExecutor(context);
      const result = await executeEditTool("move_element", { elementId: "el_1", x: 10 });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/element not found/i);
    });

    it("should read previous coordinates from element.position when root values are missing", async () => {
      context.state.slides[0].elements[0] = { id: "el_1", type: "text", position: { x: 5, y: 10 } };
      executeEditTool = createEditToolExecutor(context);

      await executeEditTool("move_element", { elementId: "el_1", x: 50, y: 100 });
      expect(context.state.slides[0].elements[0].position.x).toBe(50);
      expect(context.state.slides[0].elements[0].x).toBe(50);
    });

    it("should skip undo/redo updates when prev/next position values are undefined", async () => {
      const push = vi.fn();
      context.historyManager = { push };
      context.state.slides[0].elements[0] = { id: "el_1", type: "text" };
      executeEditTool = createEditToolExecutor(context);

      await executeEditTool("move_element", { elementId: "el_1", y: 200 });
      const operation = push.mock.calls[0][0];

      if (operation.undo) operation.undo();
      expect(context.state.slides[0].elements[0].x).toBeUndefined();
      expect(context.state.slides[0].elements[0].y).toBe(200);

      if (operation.redo) operation.redo();
      expect(context.state.slides[0].elements[0].x).toBeUndefined();
      expect(context.state.slides[0].elements[0].y).toBe(200);
    });

    it("should execute undo callback for move_element", async () => {
      const push = vi.fn();
      context.historyManager = { push };
      context.state.slides[0].elements[0] = { id: "el_1", type: "text", x: 10, y: 20 };
      executeEditTool = createEditToolExecutor(context);

      const result = await executeEditTool("move_element", { elementId: "el_1", x: 100, y: 200 });
      expect(result.success).toBe(true);
      expect(push).toHaveBeenCalled();

      // Get the operation and call undo
      const operation = push.mock.calls[0][0];
      expect(operation).toBeDefined();
      if (operation.undo) {
        operation.undo();
        expect(context.state.slides[0].elements[0].x).toBe(10);
        expect(context.state.slides[0].elements[0].y).toBe(20);
      }
    });

    it("should execute redo callback for move_element", async () => {
      const push = vi.fn();
      context.historyManager = { push };
      context.state.slides[0].elements[0] = { id: "el_1", type: "text", x: 10, y: 20 };
      executeEditTool = createEditToolExecutor(context);

      await executeEditTool("move_element", { elementId: "el_1", x: 100, y: 200 });

      const operation = push.mock.calls[0][0];
      if (operation.undo) operation.undo();
      if (operation.redo) {
        operation.redo();
        expect(context.state.slides[0].elements[0].x).toBe(100);
        expect(context.state.slides[0].elements[0].y).toBe(200);
      }
    });

    it("should execute undo callback for resize_element", async () => {
      const push = vi.fn();
      context.historyManager = { push };
      context.state.slides[0].elements[0] = { id: "el_1", type: "text", width: 50, height: 60 };
      executeEditTool = createEditToolExecutor(context);

      const result = await executeEditTool("resize_element", { elementId: "el_1", width: 200, height: 300 });
      expect(result.success).toBe(true);

      const operation = push.mock.calls[0][0];
      if (operation.undo) {
        operation.undo();
        expect(context.state.slides[0].elements[0].width).toBe(50);
        expect(context.state.slides[0].elements[0].height).toBe(60);
      }
    });

    it("should execute redo callback for resize_element", async () => {
      const push = vi.fn();
      context.historyManager = { push };
      context.state.slides[0].elements[0] = { id: "el_1", type: "text", width: 50, height: 60 };
      executeEditTool = createEditToolExecutor(context);

      await executeEditTool("resize_element", { elementId: "el_1", width: 200, height: 300 });

      const operation = push.mock.calls[0][0];
      if (operation.undo) operation.undo();
      if (operation.redo) {
        operation.redo();
        expect(context.state.slides[0].elements[0].width).toBe(200);
        expect(context.state.slides[0].elements[0].height).toBe(300);
      }
    });

    it("should handle undo/redo when element is missing", async () => {
      const push = vi.fn();
      context.historyManager = { push };
      context.state.slides[0].elements[0] = { id: "el_1", type: "text", x: 10, y: 20 };
      executeEditTool = createEditToolExecutor(context);

      await executeEditTool("move_element", { elementId: "el_1", x: 100, y: 200 });

      // Remove the element
      context.state.slides[0].elements = [];

      const operation = push.mock.calls[0][0];
      // Should not throw when element is missing
      if (operation.undo) {
        expect(() => operation.undo()).not.toThrow();
      }
      if (operation.redo) {
        expect(() => operation.redo()).not.toThrow();
      }
    });

    it("should handle undo/redo for resize_element when element is missing", async () => {
      const push = vi.fn();
      context.historyManager = { push };
      context.state.slides[0].elements[0] = { id: "el_1", type: "text", width: 50, height: 60 };
      executeEditTool = createEditToolExecutor(context);

      await executeEditTool("resize_element", { elementId: "el_1", width: 200, height: 300 });

      // Remove the element
      context.state.slides[0].elements = [];

      const operation = push.mock.calls[0][0];
      if (operation.undo) expect(() => operation.undo()).not.toThrow();
      if (operation.redo) expect(() => operation.redo()).not.toThrow();
    });

    it("should skip undo dimension updates when prev values are undefined", async () => {
      const push = vi.fn();
      context.historyManager = { push };
      context.state.slides[0].elements[0] = { id: "el_1", type: "text" };
      executeEditTool = createEditToolExecutor(context);

      await executeEditTool("resize_element", { elementId: "el_1", width: 200 });
      const operation = push.mock.calls[0][0];

      if (operation.undo) operation.undo();
      // prev.width/prev.height were undefined, so undo should not revert the resize
      expect(context.state.slides[0].elements[0].width).toBe(200);

      if (operation.redo) operation.redo();
      expect(context.state.slides[0].elements[0].width).toBe(200);
      expect(context.state.slides[0].elements[0].height).toBeUndefined();
    });
  });
});
