const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

function makeTempFile(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "slide-subagent-"));
  const filePath = path.join(dir, "linked.txt");
  fs.writeFileSync(filePath, content, "utf8");
  return { dir, filePath };
}

test("SlideSubAgent: generates HTML, extracts visual slots, uses linked context", async (t) => {
  const { SlideSubAgent } = await import("../../../js/agents/stages/design/subagents/slide-agent.js");
  const { AssetRegistry } = await import("../../../js/agents/stages/design/subagents/asset-registry.js");
  const { SlideStatus } = await import("../../../js/agents/stages/design/states.js");

  const { dir, filePath } = makeTempFile("Quarterly revenue up 12%.");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

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

  assert.ok(capturedMessages, "modelCaller should be invoked");
  const prompt = capturedMessages[1]?.content || "";
  assert.ok(prompt.includes("linked.txt"), "prompt should include linked file name");
  assert.ok(prompt.includes("Company logo"), "prompt should include linked asset context");

  assert.ok(result.htmlDsl.includes("data-el=\"image-placeholder\""));
  assert.equal(result.visualSlots.length, 1);
  assert.equal(result.visualSlots[0].slotId, "slot_1");
  assert.equal(result.visualSlots[0].renderType, "svg");
  assert.equal(result.status, SlideStatus.VISUAL_PENDING);
  assert.ok(agent.statusLog.some((row) => row.to === SlideStatus.GENERATING));
});

test("SlideSubAgent: completes when no visual placeholders", async () => {
  const { SlideSubAgent } = await import("../../../js/agents/stages/design/subagents/slide-agent.js");
  const { SlideStatus } = await import("../../../js/agents/stages/design/states.js");

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
  assert.equal(result.visualSlots.length, 0);
  assert.equal(result.status, SlideStatus.COMPLETED);
});

test("SlideSubAgent: appends supplemental content and handles missing linked files", async (t) => {
  const { SlideSubAgent } = await import("../../../js/agents/stages/design/subagents/slide-agent.js");
  const { AssetRegistry } = await import("../../../js/agents/stages/design/subagents/asset-registry.js");

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

  assert.ok(prompt.includes("Base content"));
  assert.ok(prompt.includes("Linked files:"));
  assert.ok(prompt.includes("read failed"));
  assert.ok(prompt.includes("tags:alpha, beta"));
  assert.equal(result.status, agent.status);
});

test("SlideSubAgent: merges supplemental content into markdown objects", async () => {
  const { SlideSubAgent } = await import("../../../js/agents/stages/design/subagents/slide-agent.js");

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
  assert.ok(prompt.includes("Base markdown"));
  assert.ok(prompt.includes("User notes"));
});

test("SlideSubAgent: returns failed when run is cancelled", async () => {
  const { SlideSubAgent } = await import("../../../js/agents/stages/design/subagents/slide-agent.js");
  const { SlideStatus } = await import("../../../js/agents/stages/design/states.js");

  const controller = new AbortController();
  controller.abort("Stop");

  const agent = new SlideSubAgent({
    slideIntent: { slideIntentId: "s_cancel", slideIndex: 0, title: "Cancel" },
    designSystem: { designTokens: { colors: { bg: "#ffffff" } } },
    dslRules: "DSL RULES",
  });

  const result = await agent.run({ signal: controller.signal });
  assert.equal(result.status, SlideStatus.FAILED);
  assert.equal(result.error, "Stop");
  assert.ok(agent.statusLog.some((row) => row.to === SlideStatus.FAILED));
});

test("SlideSubAgent: throws when required inputs are missing", async () => {
  const { SlideSubAgent } = await import("../../../js/agents/stages/design/subagents/slide-agent.js");

  const agent = new SlideSubAgent({ slideIntent: { slideIntentId: "s_missing" } });
  await assert.rejects(agent.run(), /designSystem/);
});

test("AssetRegistry normalizes categories and links assets", async () => {
  const { AssetRegistry } = await import("../../../js/agents/stages/design/subagents/asset-registry.js");

  const registry = new AssetRegistry({
    uploaded: [{ assetId: "asset_1", source: "upload", context: "Logo" }],
    slideAssetMapping: { slide_1: ["asset_1"] },
  });

  registry.addAsset({ assetId: "asset_1", source: "pdf" }, { category: "extracted" });
  registry.addAsset({ assetId: "asset_2", source: "video_frame" }, { category: "frames" });
  registry.linkToSlide("slide_1", ["asset_2", "", null]);

  assert.equal(registry.uploaded.length, 0);
  assert.equal(registry.extracted.length, 1);
  assert.equal(registry.videoFrames.length, 1);
  assert.equal(registry.getAssetsForSlide("slide_1").length, 2);

  const exported = registry.export();
  assert.ok(exported.slideAssetMapping.slide_1.includes("asset_1"));
  assert.ok(exported.slideAssetMapping.slide_1.includes("asset_2"));
});

test("AssetRegistry generates ids and infers categories", async () => {
  const { AssetRegistry } = await import("../../../js/agents/stages/design/subagents/asset-registry.js");

  const registry = new AssetRegistry();
  const assetId = registry.addAsset({ source: "custom_source", description: "Unknown asset" });
  const fallbackId = registry.addAsset({ description: "No source asset" });

  assert.ok(assetId.startsWith("asset_"));
  assert.ok(fallbackId.startsWith("asset_"));
  assert.equal(registry.generated.length, 2);
});
