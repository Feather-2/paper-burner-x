import { describe, it } from "node:test";
import assert from "node:assert";
import {
  DeckEditor,
  createDeckEditor,
} from "../../../../js/agents/stages/design/runtime/deck-editor.js";

describe("DeckEditor", () => {
  const sampleDeckHtmlDsl = `
<section data-layout="title">
  <h1 data-el="title1">Title</h1>
</section>

<section data-layout="content">
  <p data-el="text1">Content</p>
</section>
  `.trim();

  describe("constructor", () => {
    it("should create instance", () => {
      const editor = createDeckEditor();
      assert.ok(editor instanceof DeckEditor);
    });

    it("should accept deckPackage", () => {
      const editor = createDeckEditor({ deckPackage: { deckHtmlDsl: sampleDeckHtmlDsl } });
      assert.strictEqual(editor.getDeckHtmlDsl(), sampleDeckHtmlDsl);
    });
  });

  describe("setDeckPackage", () => {
    it("should update deck package", () => {
      const editor = createDeckEditor();
      editor.setDeckPackage({ deckHtmlDsl: sampleDeckHtmlDsl });
      assert.strictEqual(editor.getDeckHtmlDsl(), sampleDeckHtmlDsl);
    });
  });

  describe("replaceSlideHtml", () => {
    it("should replace slide HTML", () => {
      const editor = createDeckEditor({ deckPackage: { deckHtmlDsl: sampleDeckHtmlDsl } });
      const newHtml = '<section data-layout="new"><h1>New</h1></section>';
      const result = editor.replaceSlideHtml(0, newHtml);
      assert.strictEqual(result.success, true);
      assert.ok(editor.getDeckHtmlDsl().includes("New"));
    });

    it("should reject invalid slideIndex", () => {
      const editor = createDeckEditor({ deckPackage: { deckHtmlDsl: sampleDeckHtmlDsl } });
      const result = editor.replaceSlideHtml(99, "<section></section>");
      assert.strictEqual(result.success, false);
    });
  });

  describe("batchEdit", () => {
    it("should reject empty edits", async () => {
      const editor = createDeckEditor({ deckPackage: { deckHtmlDsl: sampleDeckHtmlDsl } });
      const result = await editor.batchEdit([]);
      assert.strictEqual(result.success, false);
    });

    it("should reject non-array edits", async () => {
      const editor = createDeckEditor({ deckPackage: { deckHtmlDsl: sampleDeckHtmlDsl } });
      const result = await editor.batchEdit(null);
      assert.strictEqual(result.success, false);
    });
  });

  describe("applyStyleFix", () => {
    it("should handle empty fix", async () => {
      const editor = createDeckEditor({ deckPackage: { deckHtmlDsl: sampleDeckHtmlDsl } });
      const result = await editor.applyStyleFix({});
      assert.strictEqual(result.success, true);
    });

    it("should reject non-object fix", async () => {
      const editor = createDeckEditor({ deckPackage: { deckHtmlDsl: sampleDeckHtmlDsl } });
      const result = await editor.applyStyleFix(null);
      assert.strictEqual(result.success, false);
    });
  });

  describe("history", () => {
    it("should track undo/redo state", () => {
      const editor = createDeckEditor({ deckPackage: { deckHtmlDsl: sampleDeckHtmlDsl } });
      const history = editor.getHistory();
      assert.strictEqual(history.canUndo, false);
      assert.strictEqual(history.canRedo, false);
    });

    it("should undo after edit", () => {
      const editor = createDeckEditor({ deckPackage: { deckHtmlDsl: sampleDeckHtmlDsl } });
      editor.replaceSlideHtml(0, "<section>New</section>");
      const history = editor.getHistory();
      assert.strictEqual(history.canUndo, true);
    });
  });
});
