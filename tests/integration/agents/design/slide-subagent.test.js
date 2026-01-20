import { describe, it, expect, beforeEach, afterEach } from "vitest";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

function makeTempFile(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "slide-subagent-"));
  const filePath = path.join(dir, "linked.txt");
  fs.writeFileSync(filePath, content, "utf8");
  return { dir, filePath };
}

it("SlideSubAgent: generates HTML, extracts visual slots, uses linked context", async () => {
  const { SlideSubAgent } = await import("../../../../js/agents/stages/design/subagents/slide-agent.js");
  const { AssetRegistry } = await import("../../../../js/agents/stages/design/subagents/asset-registry.js");
  const { SlideStatus } = await import("../../../../js/agents/stages/design/states.js");

  const { dir, filePath } = makeTempFile("Quarterly revenue up 12%.");

  try {
    const registry = new AssetRegistry();
    registry.addAsset({ assetId: "asset_001", type: "image", source: "upload", context: "Company logo" });

    const slideIntent = {
      slideIntentId: "s1",
      slideIndex: 0,
      title: "Growth",
      keyPoints: ["Revenue", "Margin"],
      linkedFiles: [filePath],
      linkedAssets: ["asset_001"],
    };

    let capturedMessages = null;
    const modelCaller = async (messages) => {
      capturedMessages = messages;
      return {
        content: JSON.stringify([
          {
            slideIntentId: "s1",
            slideHtml: "<section data-type=\"freeform\" data-bg=\"#fff\"><div data-el=\"text\">Title</div><div data-el=\"image-placeholder\" data-slot-id=\"slot_1\" data-render-type=\"svg\" data-x=\"10%\" data-y=\"20%\" data-w=\"30%\" data-h=\"40%\" data-effects=\"{\\\"blur\\\":2}\"></div></section>",
          },
        ]),
      };
    };

    const agent = new SlideSubAgent({
      slideIntent,
      designSystem: { designTokens: { colors: { bg: "#ffffff", text: "#111111" } } },
      assetRegistry: registry,
      modelCaller,
      dslRules: "DSL RULES",
    });

    const result = await agent.run({ contentPackage: { runId: "run_slide" } });

    expect(capturedMessages, "modelCaller should be invoked").toHaveLength(2);
    const prompt = capturedMessages[1]?.content || "";
    expect(prompt).toContain("linked.txt");
    expect(prompt).toContain("Company logo");

    expect(result.htmlDsl).toContain("data-el=\"image-placeholder\"");
    expect(result.visualSlots.length).toBe(1);
    expect(result.visualSlots[0].slotId).toBe("slot_1");
    expect(result.visualSlots[0].renderType).toBe("svg");
    expect(result.status).toBe(SlideStatus.VISUAL_PENDING);
    expect(agent.statusLog).toEqual(
      expect.arrayContaining([expect.objectContaining({ to: SlideStatus.GENERATING })])
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

it("SlideSubAgent: completes when no visual placeholders", async () => {
  const { SlideSubAgent } = await import("../../../../js/agents/stages/design/subagents/slide-agent.js");
  const { SlideStatus } = await import("../../../../js/agents/stages/design/states.js");

  const modelCaller = async () => ({
    content: JSON.stringify([
      {
        slideIntentId: "s2",
        slideHtml: "<section data-type=\"freeform\" data-bg=\"#fff\"><div data-el=\"text\">Only text</div></section>",
      },
    ]),
  });

  const agent = new SlideSubAgent({
    slideIntent: { slideIntentId: "s2", slideIndex: 1, title: "Summary" },
    designSystem: { designTokens: { colors: { bg: "#ffffff" } } },
    modelCaller,
    dslRules: "DSL RULES",
  });

  const result = await agent.run({ contentPackage: { runId: "run_slide_2" } });
  expect(result.visualSlots.length).toBe(0);
  expect(result.status).toBe(SlideStatus.COMPLETED);
});

it("SlideSubAgent: appends supplemental content and handles missing linked files", async () => {
  const { SlideSubAgent } = await import("../../../../js/agents/stages/design/subagents/slide-agent.js");
  const { AssetRegistry } = await import("../../../../js/agents/stages/design/subagents/asset-registry.js");

  const registry = new AssetRegistry();
  registry.addAsset({ assetId: "asset_tagged", type: "image", source: "upload", description: "Chart", tags: ["alpha", "beta"] });

  const missingPath = path.join(os.tmpdir(), "missing-file.txt");
  const slideIntent = {
    slideIntentId: "s_extra",
    slideIndex: 0,
    title: "Extras",
    content: "Base content",
    userNotes: "Please emphasize growth.",
    linkedFiles: [missingPath],
    linkedAssets: ["asset_tagged"],
  };

  let capturedMessages = null;
  const modelCaller = async (messages) => {
    capturedMessages = messages;
    return {
      content: JSON.stringify([{ slideIntentId: "s_extra", slideHtml: "<section data-type=\"freeform\"></section>" }]),
    };
  };

  const agent = new SlideSubAgent({
    slideIntent,
    designSystem: { designTokens: { colors: { bg: "#ffffff", text: "#111111" } } },
    assetRegistry: registry,
    modelCaller,
    dslRules: "DSL RULES",
  });

  const result = await agent.run({ contentPackage: { runId: "run_supplemental" } });
  const prompt = capturedMessages?.[1]?.content || "";

  expect(prompt).toContain("Base content");
  expect(prompt).toContain("Linked files:");
  expect(prompt).toContain("read failed");
  expect(prompt).toContain("tags:alpha, beta");
  expect(result.status).toBe(agent.status);
});

it("SlideSubAgent: merges supplemental content into markdown objects", async () => {
  const { SlideSubAgent } = await import("../../../../js/agents/stages/design/subagents/slide-agent.js");

  let capturedMessages = null;
  const modelCaller = async (messages) => {
    capturedMessages = messages;
    return {
      content: JSON.stringify([{ slideIntentId: "s_markdown", slideHtml: "<section data-type=\"freeform\"></section>" }]),
    };
  };

  const agent = new SlideSubAgent({
    slideIntent: {
      slideIntentId: "s_markdown",
      slideIndex: 0,
      content: { markdown: "Base markdown" },
      userNotes: "Add emphasis",
    },
    designSystem: { designTokens: { colors: { bg: "#ffffff", text: "#111111" } } },
    modelCaller,
    dslRules: "DSL RULES",
  });

  await agent.run({ contentPackage: { runId: "run_markdown" } });
  const prompt = capturedMessages?.[1]?.content || "";
  expect(prompt).toContain("Base markdown");
  expect(prompt).toContain("User notes");
});

it("SlideSubAgent: returns failed when run is cancelled", async () => {
  const { SlideSubAgent } = await import("../../../../js/agents/stages/design/subagents/slide-agent.js");
  const { SlideStatus } = await import("../../../../js/agents/stages/design/states.js");

  const controller = new AbortController();
  controller.abort("Stop");

  const agent = new SlideSubAgent({
    slideIntent: { slideIntentId: "s_cancel", slideIndex: 0, title: "Cancel" },
    designSystem: { designTokens: { colors: { bg: "#ffffff" } } },
    dslRules: "DSL RULES",
  });

  const result = await agent.run({ signal: controller.signal });
  expect(result.status).toBe(SlideStatus.FAILED);
  expect(result.error).toBe("Stop");
  expect(agent.statusLog).toEqual(
    expect.arrayContaining([expect.objectContaining({ to: SlideStatus.FAILED })])
  );
});

it("SlideSubAgent: throws when required inputs are missing", async () => {
  const { SlideSubAgent } = await import("../../../../js/agents/stages/design/subagents/slide-agent.js");

  const agent = new SlideSubAgent({ slideIntent: { slideIntentId: "s_missing" } });
  await expect(agent.run()).rejects.toThrow(/designSystem/);
});

it("AssetRegistry normalizes categories and links assets", async () => {
  const { AssetRegistry } = await import("../../../../js/agents/stages/design/subagents/asset-registry.js");

  const registry = new AssetRegistry({
    uploaded: [{ assetId: "asset_1", source: "upload", context: "Logo" }],
    slideAssetMapping: { slide_1: ["asset_1"] },
  });

  registry.addAsset({ assetId: "asset_1", source: "pdf" }, { category: "extracted" });
  registry.addAsset({ assetId: "asset_2", source: "video_frame" }, { category: "frames" });
  registry.linkToSlide("slide_1", ["asset_2", "", null]);

  expect(registry.uploaded.length).toBe(0);
  expect(registry.extracted.length).toBe(1);
  expect(registry.videoFrames.length).toBe(1);
  expect(registry.getAssetsForSlide("slide_1").length).toBe(2);

  const exported = registry.export();
  expect(exported.slideAssetMapping.slide_1).toContain("asset_1");
  expect(exported.slideAssetMapping.slide_1).toContain("asset_2");
});

it("AssetRegistry generates ids and infers categories", async () => {
  const { AssetRegistry } = await import("../../../../js/agents/stages/design/subagents/asset-registry.js");

  const registry = new AssetRegistry();
  const assetId = registry.addAsset({ source: "custom_source", description: "Unknown asset" });
  const fallbackId = registry.addAsset({ description: "No source asset" });

  expect(assetId).toMatch(/^asset_/);
  expect(fallbackId).toMatch(/^asset_/);
  expect(registry.generated.length).toBe(2);
});
