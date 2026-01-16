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
      expect(prompt.includes("Test Slide")).toBeTruthy();
      expect(prompt.includes("content")).toBeTruthy();
      expect(prompt.includes("chart")).toBeTruthy();
    });

    it("should include design system info", () => {
      const intent = { title: "Test" };
      const designSystem = {
        theme: "modern",
        colorScheme: "blue",
      };
      const prompt = buildImagePrompt(intent, designSystem);
      expect(prompt.includes("modern")).toBeTruthy();
      expect(prompt.includes("blue")).toBeTruthy();
    });

    it("should include bullets", () => {
      const intent = {
        title: "Test",
        bullets: ["Point 1", "Point 2"],
      };
      const prompt = buildImagePrompt(intent, {});
      expect(prompt.includes("Point 1")).toBeTruthy();
    });

    it("should include additional prompt", () => {
      const intent = { title: "Test" };
      const prompt = buildImagePrompt(intent, {}, { additionalPrompt: "Extra info" });
      expect(prompt.includes("Extra info")).toBeTruthy();
    });
  });

  describe("runBananaGenerate", () => {
    it("should require imageGenerator", async () => {
      const result = await runBananaGenerate([], {});
      expect(result.success).toBe(false);
      expect(result.error.includes("imageGenerator")).toBeTruthy();
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
    });

    it("should regenerate with modified prompt", async () => {
      const mockGenerator = {
        generate: async ({ prompt }) => {
          expect(prompt.includes("Make it blue")).toBeTruthy();
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
          expect(prompt.includes("x=10")).toBeTruthy();
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
      expect(BANANA_CONFIG.defaultWidth > 0).toBeTruthy();
      expect(BANANA_CONFIG.defaultHeight > 0).toBeTruthy();
      expect(BANANA_CONFIG.maxConcurrency > 0).toBeTruthy();
    });
  });

  describe("BananaGenerator class", () => {
    it("should create instance", () => {
      const generator = createBananaGenerator();
      expect(generator instanceof BananaGenerator).toBeTruthy();
    });

    it("should get config", () => {
      const generator = createBananaGenerator();
      const config = generator.getConfig();
      expect(config.defaultWidth).toBeTruthy();
    });

    it("should set image generator", () => {
      const generator = createBananaGenerator();
      const mockGenerator = { generate: async () => ({}) };
      generator.setImageGenerator(mockGenerator);
      // No error means success
    });
  });
});
