import { describe, it } from "node:test";
import assert from "node:assert";
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
      assert.ok(prompt.includes("Test Slide"));
      assert.ok(prompt.includes("content"));
      assert.ok(prompt.includes("chart"));
    });

    it("should include design system info", () => {
      const intent = { title: "Test" };
      const designSystem = {
        theme: "modern",
        colorScheme: "blue",
      };
      const prompt = buildImagePrompt(intent, designSystem);
      assert.ok(prompt.includes("modern"));
      assert.ok(prompt.includes("blue"));
    });

    it("should include bullets", () => {
      const intent = {
        title: "Test",
        bullets: ["Point 1", "Point 2"],
      };
      const prompt = buildImagePrompt(intent, {});
      assert.ok(prompt.includes("Point 1"));
    });

    it("should include additional prompt", () => {
      const intent = { title: "Test" };
      const prompt = buildImagePrompt(intent, {}, { additionalPrompt: "Extra info" });
      assert.ok(prompt.includes("Extra info"));
    });
  });

  describe("runBananaGenerate", () => {
    it("should require imageGenerator", async () => {
      const result = await runBananaGenerate([], {});
      assert.strictEqual(result.success, false);
      assert.ok(result.error.includes("imageGenerator"));
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
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.results.length, 2);
      assert.strictEqual(result.summary.success, 2);
    });

    it("should handle generation errors", async () => {
      const mockGenerator = {
        generate: async () => {
          throw new Error("Generation failed");
        },
      };
      const intents = [{ slideIntentId: "s1", title: "Slide 1" }];
      const result = await runBananaGenerate(intents, {}, { imageGenerator: mockGenerator });
      assert.strictEqual(result.results[0].success, false);
    });
  });

  describe("regenerate", () => {
    it("should require imageGenerator", async () => {
      const result = await regenerate({ slideIndex: 0, command: "test" }, {});
      assert.strictEqual(result.success, false);
    });

    it("should regenerate with modified prompt", async () => {
      const mockGenerator = {
        generate: async ({ prompt }) => {
          assert.ok(prompt.includes("Make it blue"));
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
      assert.strictEqual(result.success, true);
    });

    it("should include bbox reference", async () => {
      const mockGenerator = {
        generate: async ({ prompt }) => {
          assert.ok(prompt.includes("x=10"));
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
      assert.strictEqual(result.success, true);
    });
  });

  describe("BANANA_CONFIG", () => {
    it("should have default values", () => {
      assert.ok(BANANA_CONFIG.defaultWidth > 0);
      assert.ok(BANANA_CONFIG.defaultHeight > 0);
      assert.ok(BANANA_CONFIG.maxConcurrency > 0);
    });
  });

  describe("BananaGenerator class", () => {
    it("should create instance", () => {
      const generator = createBananaGenerator();
      assert.ok(generator instanceof BananaGenerator);
    });

    it("should get config", () => {
      const generator = createBananaGenerator();
      const config = generator.getConfig();
      assert.ok(config.defaultWidth);
    });

    it("should set image generator", () => {
      const generator = createBananaGenerator();
      const mockGenerator = { generate: async () => ({}) };
      generator.setImageGenerator(mockGenerator);
      // No error means success
    });
  });
});
