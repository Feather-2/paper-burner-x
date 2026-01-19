import { describe, it, expect, beforeEach, afterEach } from "vitest";

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

      expect(task.slideHtml).toBe(slideHtml);
      expect(task.slideIntentId).toBe("s1");
      expect(task.slideIndex).toBe(0);
      expect(task.pageType).toBe("content");
      expect(task.issues).toEqual(["Missing title", "Invalid structure"]);
      expect(task.qaScore).toBe(3);
      expect(task.qaPass).toBe(false);
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

      expect(task.issues[0]).toBe("Error 1");
      expect(task.issues[1]).toBe("Error 2");
      expect(task.issues[2]).toBe('{"other":"data"}');
    });

    it("should handle missing data gracefully", () => {
      const task = buildRepairTask("<section/>", {}, null);

      expect(task.slideHtml).toBe("<section/>");
      expect(task.issues).toEqual([]);
      expect(task.slideIntentId).toBe(undefined);
    });
  });

  describe("REPAIR_CONFIG", () => {
    it("should have default values", () => {
      expect(REPAIR_CONFIG.maxRetries).toBe(3);
      expect(REPAIR_CONFIG.maxStepsPerRetry).toBe(5);
      expect(REPAIR_CONFIG.qualityThreshold).toBe(6);
    });
  });
});
