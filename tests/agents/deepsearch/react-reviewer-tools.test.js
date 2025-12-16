/**
 * ReactReviewer 工具适配层单元测试
 *
 * 覆盖点：
 * - searchEvidence：查询空结果、正常检索、topK 参数
 * - getEvidence：不存在 evidenceId 返回错误
 * - getSourceChunk：边界条件（偏移超出文档长度）
 * - getSectionFull：章节不存在时返回错误
 * - getWordCount：中英文混合统计准确性
 * - applyPatch：传入无效 patchPlan 时捕获异常
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createToolExecutor, TOOL_SCHEMAS } from "../../../js/agents/stages/deepsearch/react-reviewer-tools.js";

describe("ReactReviewer Tools Adapter", () => {
  // ====== 1. searchEvidence ======
  describe("searchEvidence", () => {
    test("returns empty array when evidenceLedger is empty", async () => {
      const context = {
        evidenceLedger: [],
        report: {},
        sources: [],
      };
      const executor = createToolExecutor(context);
      const result = await executor("searchEvidence", { query: "machine learning" });
      assert.strictEqual(result.success, true);
      assert.deepStrictEqual(result.data, []);
    });

    test("returns error when query is missing", async () => {
      const context = { evidenceLedger: [] };
      const executor = createToolExecutor(context);
      const result = await executor("searchEvidence", {});
      assert.strictEqual(result.success, false);
      assert.match(result.error, /query is required/);
    });

    test("performs BM25 search and returns ranked results", async () => {
      const context = {
        evidenceLedger: [
          { evidenceId: "e1", quote: "machine learning algorithms are powerful" },
          { evidenceId: "e2", quote: "deep learning is a subset of machine learning" },
          { evidenceId: "e3", quote: "cats and dogs are popular pets" },
        ],
      };
      const executor = createToolExecutor(context);
      const result = await executor("searchEvidence", { query: "machine learning", options: { topK: 2 } });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data.length, 2);
      // Verify top results are e1 or e2 (both contain "machine learning")
      const topIds = result.data.map((r) => r.evidenceId);
      assert.ok(topIds.includes("e1") || topIds.includes("e2"));
      assert.ok(!topIds.includes("e3")); // e3 should be filtered out
      assert.strictEqual(typeof result.data[0].score, "number");
      assert.ok(result.data[0].score > 0);
    });

    test("caches BM25 index across multiple calls", async () => {
      const context = {
        evidenceLedger: [{ evidenceId: "e1", quote: "test quote" }],
      };
      const executor = createToolExecutor(context);

      await executor("searchEvidence", { query: "test" });
      assert.ok(context._evidenceIndex, "Index should be cached");

      const cachedIndex = context._evidenceIndex;
      await executor("searchEvidence", { query: "quote" });
      assert.strictEqual(context._evidenceIndex, cachedIndex, "Index should be reused");
    });
  });

  // ====== 2. getEvidence ======
  describe("getEvidence", () => {
    test("returns error when evidenceId does not exist", async () => {
      const context = {
        evidenceLedger: [{ evidenceId: "e1", quote: "test" }],
      };
      const executor = createToolExecutor(context);
      const result = await executor("getEvidence", { evidenceId: "e999" });

      assert.strictEqual(result.success, false);
      assert.match(result.error, /Evidence not found: e999/);
    });

    test("returns evidence details when evidenceId exists", async () => {
      const context = {
        evidenceLedger: [
          {
            evidenceId: "e42",
            quote: "The answer is 42",
            sourceId: "src_guide",
            locator: { page: 108 },
            verifiedAt: "2025-12-15T10:00:00Z",
            chunkId: "chunk_42",
          },
        ],
      };
      const executor = createToolExecutor(context);
      const result = await executor("getEvidence", { evidenceId: "e42" });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data.evidenceId, "e42");
      assert.strictEqual(result.data.quote, "The answer is 42");
      assert.strictEqual(result.data.sourceId, "src_guide");
      assert.deepStrictEqual(result.data.locator, { page: 108 });
      assert.strictEqual(result.data.verifiedAt, "2025-12-15T10:00:00Z");
    });

    test("returns error when evidenceId is missing", async () => {
      const context = { evidenceLedger: [] };
      const executor = createToolExecutor(context);
      const result = await executor("getEvidence", {});

      assert.strictEqual(result.success, false);
      assert.match(result.error, /evidenceId is required/);
    });
  });

  // ====== 3. getSourceChunk ======
  describe("getSourceChunk", () => {
    test("returns error when sourceId does not exist", async () => {
      const context = {
        sources: [{ sourceId: "src1", content: "test" }],
      };
      const executor = createToolExecutor(context);
      const result = await executor("getSourceChunk", { sourceId: "src999", charStart: 0, charEnd: 10 });

      assert.strictEqual(result.success, false);
      assert.match(result.error, /Source not found: src999/);
    });

    test("handles boundary: charStart exceeds document length", async () => {
      const context = {
        sources: [{ sourceId: "src1", content: "Hello World" }], // length = 11
      };
      const executor = createToolExecutor(context);
      const result = await executor("getSourceChunk", { sourceId: "src1", charStart: 20, charEnd: 30 });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data.text, ""); // Out of bounds
      assert.strictEqual(result.data.actualStart, 11); // Clamped to docLength
      assert.strictEqual(result.data.actualEnd, 11);
      assert.strictEqual(result.data.docLength, 11);
    });

    test("handles boundary: charEnd exceeds document length", async () => {
      const context = {
        sources: [{ sourceId: "src1", content: "Hello World" }],
      };
      const executor = createToolExecutor(context);
      const result = await executor("getSourceChunk", { sourceId: "src1", charStart: 6, charEnd: 100 });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data.text, "World"); // Clamped to end
      assert.strictEqual(result.data.actualStart, 6);
      assert.strictEqual(result.data.actualEnd, 11);
    });

    test("extracts text within valid range", async () => {
      const context = {
        sources: [{ sourceId: "doc1", content: "The quick brown fox jumps over the lazy dog." }],
      };
      const executor = createToolExecutor(context);
      const result = await executor("getSourceChunk", { sourceId: "doc1", charStart: 10, charEnd: 19 });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data.text, "brown fox");
      assert.strictEqual(result.data.actualStart, 10);
      assert.strictEqual(result.data.actualEnd, 19);
    });

    test("returns error when charStart or charEnd are invalid", async () => {
      const context = { sources: [{ sourceId: "src1", content: "test" }] };
      const executor = createToolExecutor(context);

      const result1 = await executor("getSourceChunk", { sourceId: "src1", charStart: "invalid", charEnd: 10 });
      assert.strictEqual(result1.success, false);
      assert.match(result1.error, /must be valid integers/);

      const result2 = await executor("getSourceChunk", { sourceId: "src1", charStart: 0 });
      assert.strictEqual(result2.success, false);
      assert.match(result2.error, /must be valid integers/);
    });
  });

  // ====== 4. getSectionFull ======
  describe("getSectionFull", () => {
    test("returns error when section does not exist", async () => {
      const context = {
        report: {
          draftMarkdown: `# Report\n\n## Introduction\n\nContent here.\n\n## Methods\n\nMore content.`,
        },
      };
      const executor = createToolExecutor(context);
      const result = await executor("getSectionFull", { sectionPath: "## Conclusion" });

      assert.strictEqual(result.success, false);
      assert.match(result.error, /Section not found: ## Conclusion/);
    });

    test("returns section content and word count", async () => {
      const context = {
        report: {
          draftMarkdown: `# Research Report\n\n## Introduction\n\nThis is the introduction section. It has some words.\n\n## Methods\n\nMethodology details.`,
        },
      };
      const executor = createToolExecutor(context);
      const result = await executor("getSectionFull", { sectionPath: "## Introduction" });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data.title, "Introduction");
      assert.strictEqual(result.data.content, "This is the introduction section. It has some words.");
      assert.ok(result.data.wordCount > 0);
    });

    test("handles case-insensitive section matching", async () => {
      const context = {
        report: {
          draftMarkdown: `# Report\n\n## RESULTS\n\nFindings here.`,
        },
      };
      const executor = createToolExecutor(context);
      const result = await executor("getSectionFull", { sectionPath: "## results" });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data.title, "RESULTS");
    });

    test("returns error when sectionPath is missing", async () => {
      const context = { report: { draftMarkdown: "# Test" } };
      const executor = createToolExecutor(context);
      const result = await executor("getSectionFull", {});

      assert.strictEqual(result.success, false);
      assert.match(result.error, /sectionPath is required/);
    });
  });

  // ====== 5. getWordCount ======
  describe("getWordCount", () => {
    test("returns zero when report is empty", async () => {
      const context = { report: { draftMarkdown: "" } };
      const executor = createToolExecutor(context);
      const result = await executor("getWordCount", {});

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data.total, 0);
      assert.deepStrictEqual(result.data.bySection, {});
    });

    test("counts mixed Chinese and English words", async () => {
      const context = {
        report: {
          draftMarkdown: `# 研究报告\n\n## Introduction\n\nMachine learning is powerful.\n\n## 方法论\n\n我们使用了深度学习技术。`,
        },
      };
      const executor = createToolExecutor(context);
      const result = await executor("getWordCount", {});

      assert.strictEqual(result.success, true);
      assert.ok(result.data.total > 0);
      assert.ok(result.data.bySection["## Introduction"] >= 3); // "Machine learning is powerful" = 4 words
      assert.ok(result.data.bySection["## 方法论"] >= 6); // 6 Chinese characters
    });

    test("returns word counts by section", async () => {
      const context = {
        report: {
          draftMarkdown: `# Report\n\n## Section A\n\nFive words in this section.\n\n## Section B\n\nTwo words.`,
        },
      };
      const executor = createToolExecutor(context);
      const result = await executor("getWordCount", {});

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data.bySection["## Section A"], 5);
      assert.strictEqual(result.data.bySection["## Section B"], 2);
      assert.strictEqual(result.data.total, 7);
    });
  });

  // ====== 6. applyPatch ======
  describe("applyPatch", () => {
    test("returns error when patchPlan is not an array", async () => {
      const context = {
        report: { title: "Test", sections: [] },
        evidenceLedger: [],
        sources: [],
      };
      const executor = createToolExecutor(context);
      const result = await executor("applyPatch", { patchPlan: "invalid" });

      assert.strictEqual(result.success, false);
      assert.match(result.error, /patchPlan must be an array/);
    });

    test("returns error when invalid operation in patchPlan", async () => {
      const context = {
        report: {
          title: "Test Report",
          draftMarkdown: "# Test Report\n\n## Intro\n\nContent.",
          sections: [{ sectionId: "sec1", title: "Intro", content: "Content.", claimIds: [] }],
        },
        evidenceLedger: [],
        sources: [],
      };
      const executor = createToolExecutor(context);

      // 尝试编辑不存在的章节
      const result = await executor("applyPatch", {
        patchPlan: [{ op: "replaceSection", sectionId: "sec999", newContent: "New" }],
      });

      assert.strictEqual(result.success, false);
      assert.match(result.error, /Patch failed:/);
    });

    test("applies patch successfully and returns updated markdown", async () => {
      const context = {
        report: {
          title: "Original Title",
          draftMarkdown: "# Original Title\n\n## Section 1\n\nOld content.",
          sections: [{ sectionId: "sec1", title: "Section 1", content: "Old content.", claimIds: [] }],
          strategy: "single",
        },
        evidenceLedger: [],
        sources: [],
      };
      const executor = createToolExecutor(context);

      const result = await executor("applyPatch", {
        patchPlan: [
          { op: "editTitle", newTitle: "New Title" },
          { op: "replaceSection", sectionId: "sec1", newContent: "New content with more words." },
        ],
      });

      assert.strictEqual(result.success, true);
      assert.ok(result.data.newMarkdown.includes("# New Title"));
      assert.ok(result.data.newMarkdown.includes("New content with more words."));
      assert.ok(result.data.newWordCount > 0);
      assert.strictEqual(result.data.appliedOps, 2);
    });

    test("handles citations in patch", async () => {
      const context = {
        report: {
          title: "Test",
          draftMarkdown: "# Test\n\n## Main\n\nContent.",
          sections: [{ sectionId: "sec1", title: "Main", content: "Content.", claimIds: [] }],
          strategy: "single",
        },
        evidenceLedger: [{ evidenceId: "e1", quote: "Important fact", sourceId: "src1" }],
        sources: [{ sourceId: "src1", title: "Source One", uri: "http://example.com" }],
      };
      const executor = createToolExecutor(context);

      const result = await executor("applyPatch", {
        patchPlan: [{ op: "replaceSection", sectionId: "sec1", newContent: "New content {{cite:e1}}." }],
      });

      assert.strictEqual(result.success, true);
      assert.ok(result.data.newMarkdown.includes("[1]")); // Citation marker
      assert.ok(result.data.newMarkdown.includes("## References")); // References section added
    });
  });

  // ====== 7. externalSearch ======
  describe("externalSearch", () => {
    test("returns error when query is missing", async () => {
      const context = { stageApi: {} };
      const executor = createToolExecutor(context);
      const result = await executor("externalSearch", {});

      assert.strictEqual(result.success, false);
      assert.match(result.error, /query is required/);
    });

    test("returns error when stageApi is not available", async () => {
      const context = {};
      const executor = createToolExecutor(context);
      const result = await executor("externalSearch", { query: "machine learning" });

      assert.strictEqual(result.success, false);
      assert.match(result.error, /provider not available/);
    });

    test("returns error when externalSearchProvider.search is not a function", async () => {
      const context = {
        stageApi: {
          externalSearchProvider: {},
        },
      };
      const executor = createToolExecutor(context);
      const result = await executor("externalSearch", { query: "test" });

      assert.strictEqual(result.success, false);
      assert.match(result.error, /provider not available/);
    });

    test("successfully calls external search provider", async () => {
      const mockSearchResults = [
        { title: "Result 1", uri: "http://example.com/1", snippet: "First result" },
        { title: "Result 2", uri: "http://example.com/2", snippet: "Second result" },
      ];

      const context = {
        stageApi: {
          externalSearchProvider: {
            search: async (query, options) => {
              assert.strictEqual(query, "quantum computing");
              assert.strictEqual(options.maxResults, 5);
              return mockSearchResults;
            },
          },
        },
      };

      const executor = createToolExecutor(context);
      const result = await executor("externalSearch", { query: "quantum computing" });

      assert.strictEqual(result.success, true);
      assert.deepStrictEqual(result.data, mockSearchResults);
    });

    test("handles custom maxResults option", async () => {
      const context = {
        stageApi: {
          externalSearchProvider: {
            search: async (query, options) => {
              assert.strictEqual(options.maxResults, 10);
              return [];
            },
          },
        },
      };

      const executor = createToolExecutor(context);
      const result = await executor("externalSearch", { query: "test", options: { maxResults: 10 } });

      assert.strictEqual(result.success, true);
    });

    test("handles search provider errors gracefully", async () => {
      const context = {
        stageApi: {
          externalSearchProvider: {
            search: async () => {
              throw new Error("Network timeout");
            },
          },
        },
      };

      const executor = createToolExecutor(context);
      const result = await executor("externalSearch", { query: "test" });

      assert.strictEqual(result.success, false);
      assert.match(result.error, /externalSearch failed: Network timeout/);
    });

    test("handles non-array results from search provider", async () => {
      const context = {
        stageApi: {
          externalSearchProvider: {
            search: async () => null, // Invalid return type
          },
        },
      };

      const executor = createToolExecutor(context);
      const result = await executor("externalSearch", { query: "test" });

      assert.strictEqual(result.success, true);
      assert.deepStrictEqual(result.data, []); // Should default to empty array
    });
  });

  // ====== 8. TOOL_SCHEMAS export ======
  describe("TOOL_SCHEMAS", () => {
    test("exports schema for all 7 tools", () => {
      assert.ok(TOOL_SCHEMAS.searchEvidence);
      assert.ok(TOOL_SCHEMAS.getEvidence);
      assert.ok(TOOL_SCHEMAS.getSourceChunk);
      assert.ok(TOOL_SCHEMAS.getSectionFull);
      assert.ok(TOOL_SCHEMAS.getWordCount);
      assert.ok(TOOL_SCHEMAS.applyPatch);
      assert.ok(TOOL_SCHEMAS.externalSearch);
    });

    test("each schema has params and description", () => {
      for (const [toolName, schema] of Object.entries(TOOL_SCHEMAS)) {
        assert.ok(Array.isArray(schema.params), `${toolName} should have params array`);
        assert.strictEqual(typeof schema.description, "string", `${toolName} should have description`);
      }
    });
  });

  // ====== 9. createToolExecutor ======
  describe("createToolExecutor", () => {
    test("throws TypeError when context is not an object", () => {
      assert.throws(() => createToolExecutor(null), { name: "TypeError" });
      assert.throws(() => createToolExecutor("invalid"), { name: "TypeError" });
    });

    test("returns error for unknown tool", async () => {
      const executor = createToolExecutor({ evidenceLedger: [] });
      const result = await executor("unknownTool", {});

      assert.strictEqual(result.success, false);
      assert.match(result.error, /Unknown tool: unknownTool/);
    });

    test("returns error when tool name is empty", async () => {
      const executor = createToolExecutor({ evidenceLedger: [] });
      const result = await executor("", {});

      assert.strictEqual(result.success, false);
      assert.match(result.error, /Tool name is required/);
    });
  });

  // ====== 10. Edge cases ======
  describe("Edge cases", () => {
    test("handles missing context fields gracefully", async () => {
      const executor = createToolExecutor({}); // Empty context

      const result1 = await executor("searchEvidence", { query: "test" });
      assert.strictEqual(result1.success, true);
      assert.deepStrictEqual(result1.data, []); // Empty evidenceLedger

      const result2 = await executor("getWordCount", {});
      assert.strictEqual(result2.success, true);
      assert.strictEqual(result2.data.total, 0); // No report
    });

    test("handles undefined params gracefully", async () => {
      const context = { evidenceLedger: [{ evidenceId: "e1", quote: "test" }] };
      const executor = createToolExecutor(context);

      const result = await executor("getEvidence", undefined);
      assert.strictEqual(result.success, false); // Missing evidenceId
    });
  });
});
