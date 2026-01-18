import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  buildImagePrompt,
  runBananaGenerate,
  regenerate,
  BananaGenerator,
  createBananaGenerator,
  BANANA_CONFIG,
} from "../../../../js/agents/stages/design/banana/banana-generator.js";

describe("BananaGenerator", () => {
  describe("buildImagePrompt", () => {
    it("should build prompt from slide intent", () => {
      const intent = {
        title: "Test Slide",
        pageType: "content",
        visualFocus: "chart",
        keyMessage: "Key point",
      };
      const prompt = buildImagePrompt(intent, {});
      expect(prompt).toContain('Slide title: "Test Slide"');
      expect(prompt).toContain("Page type: content");
      expect(prompt).toContain("Visual focus: chart");
    });

    it("should include design system info", () => {
      const intent = { title: "Test" };
      const designSystem = {
        theme: "modern",
        colorScheme: "blue",
      };
      const prompt = buildImagePrompt(intent, designSystem);
      expect(prompt).toContain("theme: modern");
      expect(prompt).toContain("colors: blue");
    });

    it("should include bullets", () => {
      const intent = {
        title: "Test",
        bullets: ["Point 1", "Point 2"],
      };
      const prompt = buildImagePrompt(intent, {});
      expect(prompt).toContain("Content points: Point 1, Point 2");
    });

    it("should include additional prompt", () => {
      const intent = { title: "Test" };
      const prompt = buildImagePrompt(intent, {}, { additionalPrompt: "Extra info" });
      expect(prompt).toContain("Extra info");
    });
  });

  describe("runBananaGenerate", () => {
    it("should require imageGenerator", async () => {
      const result = await runBananaGenerate([], {});
      expect(result.success).toBe(false);
      expect(result.error).toBe("imageGenerator is required");
    });

    it("should generate images for all intents", async () => {
      const mockGenerator = {
        generate: async () => ({ url: "http://test.com/image.png" }),
      };
      const intents = [
        { slideIntentId: "s1", title: "Slide 1" },
        { slideIntentId: "s2", title: "Slide 2" },
      ];
      const result = await runBananaGenerate(intents, {}, { imageGenerator: mockGenerator });
      expect(result.success).toBe(true);
      expect(result.results.length).toBe(2);
      expect(result.summary.success).toBe(2);
    });

    it("should handle generation errors", async () => {
      const mockGenerator = {
        generate: async () => {
          throw new Error("Generation failed");
        },
      };
      const intents = [{ slideIntentId: "s1", title: "Slide 1" }];
      const result = await runBananaGenerate(intents, {}, { imageGenerator: mockGenerator });
      expect(result.results[0].success).toBe(false);
    });
  });

  describe("regenerate", () => {
    it("should require imageGenerator", async () => {
      const result = await regenerate({ slideIndex: 0, command: "test" }, {});
      expect(result.success).toBe(false);
      expect(result.error).toBe("imageGenerator is required");
    });

    it("should regenerate with modified prompt", async () => {
      const mockGenerator = {
        generate: async ({ prompt }) => {
          expect(prompt).toContain("Modification request: Make it blue");
          return { url: "http://test.com/new.png" };
        },
      };
      const result = await regenerate(
        {
          slideIndex: 0,
          command: "Make it blue",
          originalPrompt: "Original prompt",
        },
        { imageGenerator: mockGenerator }
      );
      expect(result.success).toBe(true);
    });

    it("should include bbox reference", async () => {
      const mockGenerator = {
        generate: async ({ prompt }) => {
          expect(prompt).toContain("Reference area: x=10, y=20, w=100, h=50");
          return { url: "http://test.com/new.png" };
        },
      };
      const result = await regenerate(
        {
          slideIndex: 0,
          command: "Fix this area",
          bbox: { x: 10, y: 20, w: 100, h: 50 },
        },
        { imageGenerator: mockGenerator }
      );
      expect(result.success).toBe(true);
    });
  });

  describe("BANANA_CONFIG", () => {
    it("should have default values", () => {
      expect(BANANA_CONFIG.defaultWidth).toBe(1920);
      expect(BANANA_CONFIG.defaultHeight).toBe(1080);
      expect(BANANA_CONFIG.maxConcurrency).toBe(4);
    });
  });

  describe("BananaGenerator class", () => {
    it("should create instance", () => {
      const generator = createBananaGenerator();
      expect(generator).toBeInstanceOf(BananaGenerator);
    });

    it("should get config", () => {
      const generator = createBananaGenerator();
      const config = generator.getConfig();
      expect(config.defaultWidth).toBe(BANANA_CONFIG.defaultWidth);
    });

    it("should set image generator", () => {
      const generator = createBananaGenerator();
      const mockGenerator = { generate: async () => ({}) };
      generator.setImageGenerator(mockGenerator);
      // No error means success
    });
  });
});
