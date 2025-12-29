import { describe, it, mock } from "node:test";
import assert from "node:assert";
import { buildRepairTask, REPAIR_CONFIG } from "../../../../js/agents/stages/design/refiner/design-repair.js";

describe("DesignRepair", () => {
  describe("buildRepairTask", () => {
    it("should build repair task from QA result", () => {
      const slideHtml = "<section>test</section>";
      const qaResult = {
        pass: false,
        score: 3,
        issues: ["Missing title", "Invalid structure"],
      };
      const slideIntent = {
        slideIntentId: "s1",
        pageType: "content",
        title: "Test Slide",
      };

      const task = buildRepairTask(slideHtml, qaResult, slideIntent, { slideIndex: 0 });

      assert.strictEqual(task.slideHtml, slideHtml);
      assert.strictEqual(task.slideIntentId, "s1");
      assert.strictEqual(task.slideIndex, 0);
      assert.strictEqual(task.pageType, "content");
      assert.deepStrictEqual(task.issues, ["Missing title", "Invalid structure"]);
      assert.strictEqual(task.qaScore, 3);
      assert.strictEqual(task.qaPass, false);
    });

    it("should handle object issues", () => {
      const qaResult = {
        pass: false,
        issues: [
          { message: "Error 1" },
          { description: "Error 2" },
          { other: "data" },
        ],
      };

      const task = buildRepairTask("<section/>", qaResult, {});

      assert.strictEqual(task.issues[0], "Error 1");
      assert.strictEqual(task.issues[1], "Error 2");
      assert.ok(task.issues[2].includes("other"));
    });

    it("should handle missing data gracefully", () => {
      const task = buildRepairTask("<section/>", {}, null);

      assert.strictEqual(task.slideHtml, "<section/>");
      assert.deepStrictEqual(task.issues, []);
      assert.strictEqual(task.slideIntentId, undefined);
    });
  });

  describe("REPAIR_CONFIG", () => {
    it("should have default values", () => {
      assert.strictEqual(REPAIR_CONFIG.maxRetries, 3);
      assert.strictEqual(REPAIR_CONFIG.maxStepsPerRetry, 5);
      assert.strictEqual(REPAIR_CONFIG.qualityThreshold, 6);
    });
  });
});
