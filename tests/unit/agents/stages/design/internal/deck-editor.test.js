import { describe, it, expect, vi, beforeEach } from "vitest";

const { parseSectionsMock, joinSectionsMock, isPlainObjectMock } = vi.hoisted(() => ({
  parseSectionsMock: vi.fn(),
  joinSectionsMock: vi.fn(),
  isPlainObjectMock: vi.fn(),
}));

vi.mock("../../../../../../js/agents/stages/design/refiner/react-refiner-tools.js", () => ({
  parseSections: parseSectionsMock,
  joinSections: joinSectionsMock,
}));

vi.mock("../../../../../../js/agents/stages/design/shared/design-utils.js", () => ({
  isPlainObject: isPlainObjectMock,
}));

const modulePath = "../../../../../../js/agents/stages/design/internal/deck-editor.js";

async function loadModule() {
  vi.resetModules();
  return import(modulePath);
}

beforeEach(() => {
  vi.clearAllMocks();
  parseSectionsMock.mockImplementation((dsl) => {
    if (typeof dsl !== "string" || dsl.length === 0) return [];
    return dsl.split("||");
  });
  joinSectionsMock.mockImplementation((sections) => sections.join("||"));
  isPlainObjectMock.mockImplementation(
    (value) => value !== null && typeof value === "object" && !Array.isArray(value),
  );
});

describe("EDITOR_CONFIG", () => {
  it("exposes the default maxHistoryLength", async () => {
    const { EDITOR_CONFIG } = await loadModule();
    expect(EDITOR_CONFIG).toEqual({ maxHistoryLength: 50 });
    expect(EDITOR_CONFIG.maxHistoryLength).toBe(50);
  });
});

describe("DeckEditor", () => {
  it("initializes with defaults and empty history", async () => {
    const { DeckEditor } = await loadModule();
    const editor = new DeckEditor();

    expect(editor.getDeckHtmlDsl()).toBe("");

    const history = editor.getHistory();
    expect(history.entries).toEqual([]);
    expect(history.currentIndex).toBe(-1);
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
  });

  it("setDeckPackage accepts null and getDeckHtmlDsl falls back to empty string", async () => {
    const { DeckEditor } = await loadModule();
    const editor = new DeckEditor({ deckPackage: { deckHtmlDsl: "<section>one</section>" } });

    editor.setDeckPackage(null);

    expect(editor.getDeckHtmlDsl()).toBe("");
  });

  it("editElement uses toolExecutor and records history on success", async () => {
    const { DeckEditor } = await loadModule();
    const toolExecutor = vi.fn().mockResolvedValue({
      success: true,
      data: { deckPackage: { deckHtmlDsl: "<section>updated</section>" } },
    });
    const editor = new DeckEditor({
      deckPackage: { deckHtmlDsl: "<section>old</section>" },
      toolExecutor,
    });

    const result = await editor.editElement(0, "el1", { text: "ok" });

    expect(result.success).toBe(true);
    expect(toolExecutor).toHaveBeenCalledWith("editElement", {
      slideIndex: 0,
      elementId: "el1",
      changes: { text: "ok" },
    });
    expect(editor.getDeckHtmlDsl()).toBe("<section>updated</section>");

    const history = editor.getHistory();
    expect(history.entries).toHaveLength(1);
    expect(history.entries[0].action).toBe("editElement");
    expect(history.entries[0].params).toEqual({
      slideIndex: 0,
      elementId: "el1",
      changes: { text: "ok" },
    });
    expect(history.entries[0].prevDeckHtmlDsl).toBe("<section>old</section>");
    expect(history.entries[0].nextDeckHtmlDsl).toBe("<section>updated</section>");
  });

  it("editElement with toolExecutor does not mutate state on failure", async () => {
    const { DeckEditor } = await loadModule();
    const toolExecutor = vi.fn().mockResolvedValue({ success: false, error: "nope" });
    const editor = new DeckEditor({
      deckPackage: { deckHtmlDsl: "<section>old</section>" },
      toolExecutor,
    });

    const result = await editor.editElement(0, "el1", { text: "x" });

    expect(result.success).toBe(false);
    expect(editor.getDeckHtmlDsl()).toBe("<section>old</section>");
    expect(editor.getHistory().entries).toHaveLength(0);
  });

  it("direct editElement rejects invalid slideIndex", async () => {
    const { DeckEditor } = await loadModule();
    const deckHtmlDsl = '<section><div data-el="el1">Hello</div></section>';
    const editor = new DeckEditor({ deckPackage: { deckHtmlDsl } });

    const result = await editor.editElement(-1, "el1", { text: "x" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid slideIndex");
  });

  it("direct editElement rejects missing element id", async () => {
    const { DeckEditor } = await loadModule();
    const deckHtmlDsl = '<section><div data-el="el1">Hello</div></section>';
    const editor = new DeckEditor({ deckPackage: { deckHtmlDsl } });

    const result = await editor.editElement(0, "missing", { text: "x" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Element not found");
  });

  it("direct editElement escapes text content", async () => {
    const { DeckEditor } = await loadModule();
    const deckHtmlDsl = '<section><div data-el="el1">Hello</div></section>';
    const editor = new DeckEditor({ deckPackage: { deckHtmlDsl } });

    const result = await editor.editElement(0, "el1", { text: '<script>alert("x")</script>' });

    expect(result.success).toBe(true);
    const updated = editor.getDeckHtmlDsl();
    expect(updated).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(updated).not.toContain("<script>");

    const history = editor.getHistory();
    expect(history.entries[0].params.changes.text).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
    );
  });

  it("direct editElement truncates long text to 10000 chars", async () => {
    const { DeckEditor } = await loadModule();
    const deckHtmlDsl = '<section><div data-el="el1">Hello</div></section>';
    const editor = new DeckEditor({ deckPackage: { deckHtmlDsl } });
    const longText = "a".repeat(10005);

    const result = await editor.editElement(0, "el1", { text: longText });

    expect(result.success).toBe(true);
    const updated = editor.getDeckHtmlDsl();
    const match = updated.match(/data-el="el1"[^>]*>([^<]*)</);
    expect(match).not.toBeNull();
    expect(match[1].length).toBe(10000);
  });

  it("direct editElement sanitizes inline styles and keeps safe properties", async () => {
    const { DeckEditor } = await loadModule();
    const deckHtmlDsl = '<section><div data-el="el1" style="color: blue">Hello</div></section>';
    const editor = new DeckEditor({ deckPackage: { deckHtmlDsl } });

    const rawStyle =
      "color: red; background: url(javascript:alert(1)); position: absolute; cursor: pointer;";
    const result = await editor.editElement(0, "el1", { style: rawStyle });

    expect(result.success).toBe(true);
    const updated = editor.getDeckHtmlDsl();
    expect(updated).toContain('style="color: red; position: absolute"');
    expect(updated).not.toContain("cursor: pointer");
    expect(updated).not.toContain("url(");

    const history = editor.getHistory();
    expect(history.entries[0].params.changes.style).toBe("color: red; position: absolute");
  });

  it("direct editElement allows clearing style with whitespace input", async () => {
    const { DeckEditor } = await loadModule();
    const deckHtmlDsl = '<section><div data-el="el1" style="color: blue">Hello</div></section>';
    const editor = new DeckEditor({ deckPackage: { deckHtmlDsl } });

    const result = await editor.editElement(0, "el1", { style: "   " });

    expect(result.success).toBe(true);
    const updated = editor.getDeckHtmlDsl();
    expect(updated).toContain('style=""');

    const history = editor.getHistory();
    expect(history.entries[0].params.changes.style).toBe("");
  });

  it("direct editSlide sanitizes html and layout while accepting string slideIndex", async () => {
    const { DeckEditor } = await loadModule();
    const deckHtmlDsl = '<section data-layout="old"><div>Old</div></section>';
    const editor = new DeckEditor({ deckPackage: { deckHtmlDsl } });

    const result = await editor.editSlide("0", {
      html: '<section data-layout="bad" onclick="alert(1)" style="color: red; background: url(javascript:alert(1))"><div>Hi</div></section>',
      layout: "grid@12 ",
    });

    expect(result.success).toBe(true);
    const updated = editor.getDeckHtmlDsl();
    expect(updated).toContain('data-layout="grid12"');
    expect(updated).toContain('style="color: red"');
    expect(updated).not.toContain("onclick=");
    expect(updated).not.toContain("javascript:");
  });

  it.each([
    ["number", 123],
    ["object", { foo: "bar" }],
  ])("direct editSlide rejects non-string html (%s)", async (_label, html) => {
    const { DeckEditor } = await loadModule();
    const deckHtmlDsl = '<section data-layout="old"><div>Old</div></section>';
    const editor = new DeckEditor({ deckPackage: { deckHtmlDsl } });

    const result = await editor.editSlide(0, { html });

    expect(result.success).toBe(false);
    expect(result.error).toBe("changes.html must be a string");
  });

  it("direct editSlide rejects oversized html payloads", async () => {
    const { DeckEditor } = await loadModule();
    const deckHtmlDsl = '<section data-layout="old"><div>Old</div></section>';
    const editor = new DeckEditor({ deckPackage: { deckHtmlDsl } });
    const bigHtml = "a".repeat(500001);

    const result = await editor.editSlide(0, { html: bigHtml });

    expect(result.success).toBe(false);
    expect(result.error).toBe("changes.html exceeds max length (500KB)");
  });

  it("direct editSlide ignores empty html string without changing content", async () => {
    const { DeckEditor } = await loadModule();
    const deckHtmlDsl = '<section data-layout="old"><div>Keep</div></section>';
    const editor = new DeckEditor({ deckPackage: { deckHtmlDsl } });

    const result = await editor.editSlide(0, { html: "" });

    expect(result.success).toBe(true);
    expect(editor.getDeckHtmlDsl()).toBe(deckHtmlDsl);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["object", {}],
    ["empty array", []],
  ])("batchEdit rejects invalid edits input (%s)", async (_label, value) => {
    const { DeckEditor } = await loadModule();
    const editor = new DeckEditor();

    const result = await editor.batchEdit(value);

    expect(result.success).toBe(false);
    expect(result.error).toBe("edits must be a non-empty array");
  });

  it("batchEdit aggregates mixed results and unknown edit types", async () => {
    const { DeckEditor } = await loadModule();
    const toolExecutor = vi
      .fn()
      .mockResolvedValueOnce({
        success: true,
        data: { deckPackage: { deckHtmlDsl: "one" } },
      })
      .mockResolvedValueOnce({
        success: true,
        data: { deckPackage: { deckHtmlDsl: "two" } },
      });
    const editor = new DeckEditor({ deckPackage: { deckHtmlDsl: "start" }, toolExecutor });

    const result = await editor.batchEdit([
      { type: "element", slideIndex: 0, elementId: "el1", changes: { text: "a" } },
      { type: "unknown", slideIndex: 0, changes: {} },
      { type: "slide", slideIndex: 1, changes: { html: "<section>two</section>" } },
    ]);

    expect(result.success).toBe(true);
    expect(result.data.total).toBe(3);
    expect(result.data.success).toBe(2);
    expect(result.data.failed).toBe(1);
    expect(result.data.results[1].result.success).toBe(false);
    expect(result.data.results[1].result.error).toContain("Unknown edit type");
    expect(toolExecutor).toHaveBeenCalledTimes(2);
  });

  it("applyStyleFix rejects non-object inputs", async () => {
    const { DeckEditor } = await loadModule();
    const editor = new DeckEditor();
    isPlainObjectMock.mockReturnValueOnce(false);

    const result = await editor.applyStyleFix(null);

    expect(isPlainObjectMock).toHaveBeenCalledWith(null);
    expect(result.success).toBe(false);
    expect(result.error).toBe("fix must be an object");
  });

  it("applyStyleFix returns no-op result when no fixes provided", async () => {
    const { DeckEditor } = await loadModule();
    const editor = new DeckEditor();

    const result = await editor.applyStyleFix({});

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ message: "No fixes to apply" });
  });

  it("applyStyleFix builds edits from fix arrays and delegates to batchEdit", async () => {
    const { DeckEditor } = await loadModule();
    const editor = new DeckEditor();
    const batchEditSpy = vi
      .spyOn(editor, "batchEdit")
      .mockResolvedValue({ success: true, data: { total: 4 } });

    const fix = {
      colorFixes: [
        { slideIndex: 0, elementId: "el1", newStyle: "color: red" },
      ],
      fontFixes: [
        { slideIndex: 1, elementId: "el2", newStyle: "font-size: 12px" },
      ],
      layoutFixes: [{ slideIndex: 2, newLayout: "grid" }],
      htmlReplacements: [{ slideIndex: 3, newHtml: "<section>hi</section>" }],
    };

    const result = await editor.applyStyleFix(fix);

    expect(batchEditSpy).toHaveBeenCalledWith([
      {
        type: "element",
        slideIndex: 0,
        elementId: "el1",
        changes: { style: "color: red" },
      },
      {
        type: "element",
        slideIndex: 1,
        elementId: "el2",
        changes: { style: "font-size: 12px" },
      },
      {
        type: "slide",
        slideIndex: 2,
        changes: { layout: "grid" },
      },
      {
        type: "slide",
        slideIndex: 3,
        changes: { html: "<section>hi</section>" },
      },
    ]);
    expect(result).toEqual({ success: true, data: { total: 4 } });
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["zero", 0],
    ["empty object", {}],
    ["empty array", []],
  ])("replaceSlideHtml rejects non-string newHtml (%s)", async (_label, value) => {
    const { DeckEditor } = await loadModule();
    const editor = new DeckEditor({ deckPackage: { deckHtmlDsl: "<section>old</section>" } });

    const result = editor.replaceSlideHtml(0, value);

    expect(result.success).toBe(false);
    expect(result.error).toBe("newHtml must be a string");
  });

  it("replaceSlideHtml rejects oversized html payloads", async () => {
    const { DeckEditor } = await loadModule();
    const editor = new DeckEditor({ deckPackage: { deckHtmlDsl: "<section>old</section>" } });
    const bigHtml = "a".repeat(500001);

    const result = editor.replaceSlideHtml(0, bigHtml);

    expect(result.success).toBe(false);
    expect(result.error).toBe("newHtml exceeds max length (500KB)");
  });

  it("replaceSlideHtml rejects invalid slideIndex boundaries", async () => {
    const { DeckEditor } = await loadModule();
    const editor = new DeckEditor({ deckPackage: { deckHtmlDsl: "<section>old</section>" } });

    const resultNegative = editor.replaceSlideHtml(-1, "<section>new</section>");
    expect(resultNegative.success).toBe(false);
    expect(resultNegative.error).toContain("Invalid slideIndex");

    const resultHuge = editor.replaceSlideHtml(Number.MAX_SAFE_INTEGER, "<section>new</section>");
    expect(resultHuge.success).toBe(false);
    expect(resultHuge.error).toContain("Invalid slideIndex");
  });

  it("replaceSlideHtml sanitizes dangerous tags, urls, and styles", async () => {
    const { DeckEditor } = await loadModule();
    const editor = new DeckEditor({ deckPackage: { deckHtmlDsl: "<section>old</section>" } });
    const newHtml =
      '<section><img src="javascript:alert(1)" srcset="javascript:alert(1) 1x, safe.png 2x" onerror="alert(1)" style="color: red; background: url(javascript:alert(1));"></section><script>alert(1)</script>';

    const result = editor.replaceSlideHtml(0, newHtml);

    expect(result.success).toBe(true);
    const updated = editor.getDeckHtmlDsl();
    expect(updated).toContain('style="color: red"');
    expect(updated).not.toContain("<script");
    expect(updated).not.toContain("onerror=");
    expect(updated).not.toContain("javascript:");
    expect(updated).not.toContain("srcset=");
    expect(updated).not.toContain("src=");
  });

  it("replaceSlideHtml accepts empty and whitespace html strings", async () => {
    const { DeckEditor } = await loadModule();
    const editorEmpty = new DeckEditor({ deckPackage: { deckHtmlDsl: "<section>old</section>" } });
    const editorWhitespace = new DeckEditor({ deckPackage: { deckHtmlDsl: "<section>old</section>" } });

    const resultEmpty = editorEmpty.replaceSlideHtml(0, "");
    expect(resultEmpty.success).toBe(true);
    expect(editorEmpty.getDeckHtmlDsl()).toBe("");
    expect(editorEmpty.getHistory().entries).toHaveLength(1);

    const resultWhitespace = editorWhitespace.replaceSlideHtml(0, "   ");
    expect(resultWhitespace.success).toBe(true);
    expect(editorWhitespace.getDeckHtmlDsl()).toBe("");
  });

  it("undo/redo restore history state and enforce bounds", async () => {
    const { DeckEditor } = await loadModule();
    const editor = new DeckEditor({ deckPackage: { deckHtmlDsl: "<section>one</section>" } });

    expect(editor.undo().success).toBe(false);
    expect(editor.redo().success).toBe(false);

    const result = editor.replaceSlideHtml(0, "<section>two</section>");
    expect(result.success).toBe(true);
    expect(editor.getDeckHtmlDsl()).toBe("<section>two</section>");

    const undo = editor.undo();
    expect(undo.success).toBe(true);
    expect(editor.getDeckHtmlDsl()).toBe("<section>one</section>");

    const redo = editor.redo();
    expect(redo.success).toBe(true);
    expect(editor.getDeckHtmlDsl()).toBe("<section>two</section>");
  });

  it("limits history length and truncates redo after new edits", async () => {
    const { DeckEditor } = await loadModule();
    const editor = new DeckEditor({
      deckPackage: { deckHtmlDsl: "<section>start</section>" },
      config: { maxHistoryLength: 2 },
    });

    editor.replaceSlideHtml(0, "<section>one</section>");
    editor.replaceSlideHtml(0, "<section>two</section>");
    editor.replaceSlideHtml(0, "<section>three</section>");

    const history = editor.getHistory();
    expect(history.entries).toHaveLength(2);
    expect(history.currentIndex).toBe(1);
    expect(history.entries[0].params.newHtml).toBe("<section>two</section>");
    expect(history.entries[1].params.newHtml).toBe("<section>three</section>");

    const undo = editor.undo();
    expect(undo.success).toBe(true);
    const afterUndo = editor.getHistory();
    expect(afterUndo.canRedo).toBe(true);

    editor.replaceSlideHtml(0, "<section>four</section>");
    const afterNewEdit = editor.getHistory();
    expect(afterNewEdit.canRedo).toBe(false);
    expect(afterNewEdit.entries).toHaveLength(2);
  });

  it("getHistory returns a copy of the entries array", async () => {
    const { DeckEditor } = await loadModule();
    const editor = new DeckEditor({ deckPackage: { deckHtmlDsl: "<section>one</section>" } });

    editor.replaceSlideHtml(0, "<section>two</section>");

    const history = editor.getHistory();
    history.entries.push({ action: "fake" });

    const nextHistory = editor.getHistory();
    expect(nextHistory.entries).toHaveLength(1);
  });

  it("handles concurrent edits and deep nested changes", async () => {
    const { DeckEditor } = await loadModule();
    const toolExecutor = vi.fn(async (toolName, params) => ({
      success: true,
      data: { deckPackage: { deckHtmlDsl: `${toolName}-${params.slideIndex}` } },
    }));
    const editor = new DeckEditor({ deckPackage: { deckHtmlDsl: "<section>start</section>" }, toolExecutor });
    const deepChanges = { level1: { level2: { level3: { level4: { value: "x" } } } } };

    await Promise.all([
      editor.editElement(0, "el1", deepChanges),
      editor.editSlide(1, { html: "<section>two</section>" }),
    ]);

    expect(toolExecutor).toHaveBeenCalledTimes(2);
    expect(toolExecutor).toHaveBeenCalledWith("editElement", {
      slideIndex: 0,
      elementId: "el1",
      changes: deepChanges,
    });
    expect(editor.getHistory().entries).toHaveLength(2);
  });

  it("handles rapid sequential edits", async () => {
    const { DeckEditor } = await loadModule();
    const toolExecutor = vi
      .fn()
      .mockResolvedValueOnce({
        success: true,
        data: { deckPackage: { deckHtmlDsl: "<section>one</section>" } },
      })
      .mockResolvedValueOnce({
        success: true,
        data: { deckPackage: { deckHtmlDsl: "<section>two</section>" } },
      });
    const editor = new DeckEditor({ deckPackage: { deckHtmlDsl: "<section>start</section>" }, toolExecutor });

    await editor.editSlide(0, { html: "<section>one</section>" });
    await editor.editSlide(0, { html: "<section>two</section>" });

    expect(toolExecutor).toHaveBeenCalledTimes(2);
    expect(editor.getHistory().entries).toHaveLength(2);
    expect(editor.getDeckHtmlDsl()).toBe("<section>two</section>");
  });
});

describe("createDeckEditor", () => {
  it("creates a DeckEditor instance with provided options", async () => {
    const { createDeckEditor, DeckEditor } = await loadModule();
    const editor = createDeckEditor({ deckPackage: { deckHtmlDsl: "<section>hi</section>" } });

    expect(editor).toBeInstanceOf(DeckEditor);
    expect(editor.getDeckHtmlDsl()).toBe("<section>hi</section>");
  });

  it("uses defaults when options are undefined", async () => {
    const { createDeckEditor } = await loadModule();
    const editor = createDeckEditor(undefined);

    expect(editor.getDeckHtmlDsl()).toBe("");
  });

  it("throws when options are null", async () => {
    const { createDeckEditor } = await loadModule();

    expect(() => createDeckEditor(null)).toThrow();
  });
});
