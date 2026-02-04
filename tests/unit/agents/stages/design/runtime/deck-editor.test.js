import { describe, it, expect, vi, beforeEach } from "vitest";

// Unit-scope: mock external deps so we only test DeckEditor logic.
vi.mock("../../../../../../js/agents/stages/design/refiner/react-refiner-tools.js", () => {
  return {
    parseSections: vi.fn(),
    joinSections: vi.fn(),
    extractElements: vi.fn(),
  };
});

vi.mock("../../../../../../js/agents/stages/design/shared/design-utils.js", () => {
  return {
    isPlainObject: vi.fn(),
  };
});

let parseSections;
let joinSections;
let isPlainObject;
let DeckEditor;
let createDeckEditor;

const SPLIT = "<!--SPLIT-->";

function dslFromSections(sections) {
  return sections.join(SPLIT);
}

describe("design/runtime/deck-editor", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    ({ parseSections, joinSections } = await import(
      "../../../../../../js/agents/stages/design/refiner/react-refiner-tools.js"
    ));
    ({ isPlainObject } = await import(
      "../../../../../../js/agents/stages/design/shared/design-utils.js"
    ));
    ({ DeckEditor, createDeckEditor } = await import(
      "../../../../../../js/agents/stages/design/internal/deck-editor.js"
    ));

    parseSections.mockImplementation((deckHtmlDsl) => {
      const s = String(deckHtmlDsl || "");
      if (!s) return [];
      return s
        .split(SPLIT)
        .map((v) => v.trim())
        .filter(Boolean);
    });

    joinSections.mockImplementation((sections) => dslFromSections(sections));

    isPlainObject.mockImplementation((v) => {
      if (!v || typeof v !== "object") return false;
      if (Array.isArray(v)) return false;
      const proto = Object.getPrototypeOf(v);
      return proto === Object.prototype || proto === null;
    });
  });

  it("createDeckEditor() creates an editor with empty default deck", () => {
    const editor = createDeckEditor();
    expect(editor).toBeInstanceOf(DeckEditor);
    expect(editor.getDeckHtmlDsl()).toBe("");
    expect(editor.getHistory().canUndo).toBe(false);
    expect(editor.getHistory().canRedo).toBe(false);
  });

  it("setDeckPackage() updates internal deck package", () => {
    const editor = createDeckEditor();
    editor.setDeckPackage({ deckHtmlDsl: "<section>one</section>" });
    expect(editor.getDeckHtmlDsl()).toBe("<section>one</section>");
  });

  it("editElement() delegates to toolExecutor when provided and updates deck on success", async () => {
    const toolExecutor = vi.fn(async (_tool, _params) => {
      return { success: true, data: { deckPackage: { deckHtmlDsl: "<section>updated</section>" } } };
    });
    const editor = createDeckEditor({
      toolExecutor,
      deckPackage: { deckHtmlDsl: "<section>old</section>" },
    });

    const res = await editor.editElement(1, "title1", { text: "New" });
    expect(res.success).toBe(true);
    expect(toolExecutor).toHaveBeenCalledWith("editElement", {
      slideIndex: 1,
      elementId: "title1",
      changes: { text: "New" },
    });
    expect(editor.getDeckHtmlDsl()).toBe("<section>updated</section>");
    expect(editor.getHistory().canUndo).toBe(true);
  });

  it("editElement() does not mutate deck/history when toolExecutor fails (edge case)", async () => {
    const toolExecutor = vi.fn(async () => ({ success: false, error: "nope" }));
    const editor = createDeckEditor({
      toolExecutor,
      deckPackage: { deckHtmlDsl: "<section>old</section>" },
    });

    const res = await editor.editElement(0, "x", { text: "y" });
    expect(res.success).toBe(false);
    expect(editor.getDeckHtmlDsl()).toBe("<section>old</section>");
    expect(editor.getHistory().canUndo).toBe(false);
  });

  it("editSlide() delegates to toolExecutor when provided and updates deck on success", async () => {
    const toolExecutor = vi.fn(async () => {
      return { success: true, data: { deckPackage: { deckHtmlDsl: "<section>slide-updated</section>" } } };
    });
    const editor = createDeckEditor({
      toolExecutor,
      deckPackage: { deckHtmlDsl: "<section>old</section>" },
    });

    const res = await editor.editSlide(2, { layout: "new-layout" });
    expect(res.success).toBe(true);
    expect(toolExecutor).toHaveBeenCalledWith("editSlide", { slideIndex: 2, changes: { layout: "new-layout" } });
    expect(editor.getDeckHtmlDsl()).toBe("<section>slide-updated</section>");
    expect(editor.getHistory().canUndo).toBe(true);
  });

  it("replaceSlideHtml() replaces only the requested section and rejects invalid index", () => {
    const sections = [
      `<section data-layout="title"><h1 data-el="title1">A</h1></section>`,
      `<section data-layout="content"><p data-el="text1">B</p></section>`,
    ];
    const editor = createDeckEditor({ deckPackage: { deckHtmlDsl: dslFromSections(sections) } });

    const bad = editor.replaceSlideHtml(99, "<section>bad</section>");
    expect(bad.success).toBe(false);
    expect(bad.error).toContain("Invalid slideIndex");

    const ok = editor.replaceSlideHtml(0, `<section data-layout="title"><h1 data-el="title1">NEW</h1></section>`);
    expect(ok.success).toBe(true);
    expect(editor.getDeckHtmlDsl()).toContain("NEW");
    expect(editor.getHistory().canUndo).toBe(true);
  });

  it("direct editElement() updates text/style, validates slideIndex, and returns not-found for missing element", async () => {
    const sections = [
      `<section data-layout="title"><h1 data-el="title1">Old</h1><p data-el="subtitle" style="color: red">Sub</p></section>`,
      `<section data-layout="content"><p data-el="body">Hello</p></section>`,
    ];
    const editor = createDeckEditor({ deckPackage: { deckHtmlDsl: dslFromSections(sections) } });

    const badIdx = await editor.editElement(-1, "title1", { text: "X" });
    expect(badIdx.success).toBe(false);
    expect(badIdx.error).toContain("Invalid slideIndex");

    const missing = await editor.editElement(0, "missing", { text: "X" });
    expect(missing.success).toBe(false);
    expect(missing.error).toContain("Element not found");

    const textOk = await editor.editElement(0, "title1", { text: "New Title" });
    expect(textOk.success).toBe(true);
    expect(editor.getDeckHtmlDsl()).toContain("New Title");

    const styleOk = await editor.editElement(0, "subtitle", { style: "color: blue" });
    expect(styleOk.success).toBe(true);
    expect(editor.getDeckHtmlDsl()).toContain(`data-el="subtitle" style="color: blue"`);

    // Style updates only apply when a style attribute already exists (edge case).
    const noStyleAdded = await editor.editElement(1, "body", { style: "color: red" });
    expect(noStyleAdded.success).toBe(true);
    expect(editor.getDeckHtmlDsl()).not.toContain(`data-el="body" style="`);
  });

  it("direct editSlide() supports html replacement and layout mutation; missing layout attribute is a no-op but still succeeds", async () => {
    const sections = [
      `<section data-layout="title"><h1 data-el="t">T</h1></section>`,
      `<section><p data-el="x">X</p></section>`,
    ];
    const editor = createDeckEditor({ deckPackage: { deckHtmlDsl: dslFromSections(sections) } });

    const htmlRes = await editor.editSlide(0, { html: `<section data-layout="hero"><h1 data-el="t">NEW</h1></section>` });
    expect(htmlRes.success).toBe(true);
    expect(editor.getDeckHtmlDsl()).toContain(`data-layout="hero"`);
    expect(editor.getDeckHtmlDsl()).toContain("NEW");

    const layoutRes = await editor.editSlide(0, { layout: "cover" });
    expect(layoutRes.success).toBe(true);
    expect(editor.getDeckHtmlDsl()).toContain(`data-layout="cover"`);

    const missingAttrRes = await editor.editSlide(1, { layout: "content" });
    expect(missingAttrRes.success).toBe(true);
    // Section[1] has no data-layout attribute; replace() is a no-op.
    expect(editor.getDeckHtmlDsl()).toContain(`<section><p data-el="x">X</p></section>`);
  });

  it("batchEdit() validates input and aggregates mixed success/failure edits", async () => {
    const toolExecutor = vi.fn(async () => ({ success: true, data: { deckPackage: { deckHtmlDsl: "<section>ok</section>" } } }));
    const editor = createDeckEditor({ toolExecutor, deckPackage: { deckHtmlDsl: "<section>start</section>" } });

    expect((await editor.batchEdit(null)).success).toBe(false);
    expect((await editor.batchEdit([])).success).toBe(false);

    const result = await editor.batchEdit([
      { type: "element", slideIndex: 0, elementId: "e1", changes: { text: "x" } },
      { type: "wat", slideIndex: 1, changes: {} },
    ]);

    expect(result.success).toBe(true);
    expect(result.data.total).toBe(2);
    expect(result.data.success).toBe(1);
    expect(result.data.failed).toBe(1);
    expect(result.data.results[1].result.success).toBe(false);
    expect(result.data.results[1].result.error).toContain("Unknown edit type");
  });

  it("applyStyleFix() validates fix shape and expands fixes into batch edits", async () => {
    const editor = createDeckEditor({ deckPackage: { deckHtmlDsl: "<section/>" } });

    expect((await editor.applyStyleFix(null)).success).toBe(false);
    expect(isPlainObject).toHaveBeenCalled();

    const empty = await editor.applyStyleFix({});
    expect(empty.success).toBe(true);
    expect(empty.data.message).toContain("No fixes");

    const batchSpy = vi.spyOn(editor, "batchEdit").mockResolvedValue({ success: true, data: { ok: true } });
    const fix = {
      colorFixes: [{ slideIndex: 0, elementId: "t1", newStyle: "color: red" }],
      fontFixes: [{ slideIndex: 1, elementId: "t2", newStyle: "font-family: Inter" }],
      layoutFixes: [{ slideIndex: 2, newLayout: "cover" }],
      htmlReplacements: [{ slideIndex: 3, newHtml: "<section>R</section>" }],
    };

    const res = await editor.applyStyleFix(fix);
    expect(res.success).toBe(true);
    expect(batchSpy).toHaveBeenCalledTimes(1);
    expect(batchSpy.mock.calls[0][0]).toEqual([
      { type: "element", slideIndex: 0, elementId: "t1", changes: { style: "color: red" } },
      { type: "element", slideIndex: 1, elementId: "t2", changes: { style: "font-family: Inter" } },
      { type: "slide", slideIndex: 2, changes: { layout: "cover" } },
      { type: "slide", slideIndex: 3, changes: { html: "<section>R</section>" } },
    ]);
  });

  it("undo()/redo() expose expected edge-case errors and can restore nextDeckHtmlDsl when present", () => {
    const editor = createDeckEditor({
      deckPackage: { deckHtmlDsl: dslFromSections([`<section data-layout="a">A</section>`]) },
      config: { maxHistoryLength: 1 },
    });

    expect(editor.undo().success).toBe(false);
    expect(editor.redo().success).toBe(false);

    editor.replaceSlideHtml(0, `<section data-layout="b">B</section>`);
    editor.replaceSlideHtml(0, `<section data-layout="c">C</section>`);

    // History is trimmed to maxHistoryLength.
    const history = editor.getHistory();
    expect(history.entries.length).toBe(1);
    expect(history.canUndo).toBe(true);

    // Force a redo-able entry to exercise the nextDeckHtmlDsl branch.
    editor.undo();
    editor._history[0].nextDeckHtmlDsl = "<section>redo</section>";
    const redoRes = editor.redo();
    expect(redoRes.success).toBe(true);
    expect(editor.getDeckHtmlDsl()).toBe("<section>redo</section>");
  });
});
