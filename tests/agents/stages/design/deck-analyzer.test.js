import { describe, it } from "node:test";
import assert from "node:assert";
import {
  collectAllDsl,
  analyzeStyleConsistency,
  locateElement,
  extractDesignTokensSummary,
  DeckAnalyzer,
  createDeckAnalyzer,
} from "../../../../js/agents/stages/design/runtime/deck-analyzer.js";

describe("DeckAnalyzer", () => {
  const sampleDeckHtmlDsl = `
    <section data-layout="title" data-bg="#ffffff">
      <h1 data-el="title1" style="color: #333333; font-family: Arial;">Title</h1>
    </section>
    <section data-layout="content" data-bg="#f0f0f0">
      <p data-el="text1" style="color: #333333; font-family: Arial;">Content</p>
      <img data-el="img1" src="test.jpg" />
    </section>
  `;

  describe("collectAllDsl", () => {
    it("should collect all slides DSL", () => {
      const result = collectAllDsl(sampleDeckHtmlDsl);
      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].slideIndex, 0);
      assert.strictEqual(result[1].slideIndex, 1);
    });

    it("should extract elements from each slide", () => {
      const result = collectAllDsl(sampleDeckHtmlDsl);
      assert.ok(result[0].elements.length > 0);
      assert.ok(result[1].elements.length > 0);
    });

    it("should handle empty DSL", () => {
      const result = collectAllDsl("");
      assert.strictEqual(result.length, 0);
    });
  });

  describe("analyzeStyleConsistency", () => {
    it("should analyze color usage", () => {
      const allDsl = collectAllDsl(sampleDeckHtmlDsl);
      const result = analyzeStyleConsistency(allDsl, {});
      assert.ok(result.stats.colorUsage instanceof Map);
    });

    it("should analyze font usage", () => {
      const allDsl = collectAllDsl(sampleDeckHtmlDsl);
      const result = analyzeStyleConsistency(allDsl, {});
      assert.ok(result.stats.fontUsage instanceof Map);
    });

    it("should return issues array", () => {
      const allDsl = collectAllDsl(sampleDeckHtmlDsl);
      const result = analyzeStyleConsistency(allDsl, {});
      assert.ok(Array.isArray(result.issues));
    });
  });

  describe("locateElement", () => {
    const slideHtml = `
      <section>
        <h1 data-el="title" class="heading">标题</h1>
        <p data-el="text" class="body">内容</p>
        <img data-el="image" src="test.jpg" />
      </section>
    `;

    it("should locate element by text content", () => {
      const result = locateElement(slideHtml, "标题");
      assert.strictEqual(result.found, true);
      assert.strictEqual(result.element.elementId, "title");
    });

    it("should locate element by keyword", () => {
      const result = locateElement(slideHtml, "图片");
      assert.strictEqual(result.found, true);
      assert.strictEqual(result.element.tag, "img");
    });

    it("should return candidates when not found", () => {
      const result = locateElement(slideHtml, "不存在的元素");
      assert.strictEqual(result.found, false);
      assert.ok(Array.isArray(result.candidates));
    });
  });

  describe("extractDesignTokensSummary", () => {
    it("should extract design tokens", () => {
      const designSystem = {
        theme: "modern",
        designTokens: {
          colorScheme: "blue",
          fontFamily: "Arial",
          accentColor: "#ff0000",
        },
      };
      const result = extractDesignTokensSummary(designSystem);
      assert.strictEqual(result.theme, "modern");
      assert.strictEqual(result.colorScheme, "blue");
    });

    it("should handle null input", () => {
      const result = extractDesignTokensSummary(null);
      assert.strictEqual(result, null);
    });
  });

  describe("DeckAnalyzer class", () => {
    it("should create instance", () => {
      const analyzer = createDeckAnalyzer();
      assert.ok(analyzer instanceof DeckAnalyzer);
    });

    it("should collect all DSL", () => {
      const analyzer = createDeckAnalyzer();
      const result = analyzer.collectAllDsl({ deckHtmlDsl: sampleDeckHtmlDsl });
      assert.strictEqual(result.length, 2);
    });

    it("should analyze style consistency", () => {
      const analyzer = createDeckAnalyzer();
      const result = analyzer.analyzeStyleConsistency({ deckHtmlDsl: sampleDeckHtmlDsl }, {});
      assert.ok(result.issues);
      assert.ok(result.stats);
    });
  });
});
