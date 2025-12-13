const test = require("node:test");
const assert = require("node:assert/strict");

test("PromptBuilder: assembles promptHint + style + designSystem.imageStyle and includes no-text instruction", async () => {
  const { buildPrompt } = await import("../../js/agents/stages/design/image-prompt-builder.js");

  const slot = {
    slotId: "img_s0_hero",
    slideIntentId: "s0",
    slideIndex: 0,
    purpose: "hero",
    promptHint: "AI-powered presentation generation workflow",
    style: "3d",
    priority: "critical",
    aspectRatio: "16:9",
  };

  const designSystem = { imageStyle: "Minimal, modern, brand-consistent. Use clean gradients and simple forms." };
  const prompt = buildPrompt(slot, designSystem, {});

  assert.ok(prompt.includes("AI-powered presentation generation workflow"));
  assert.ok(prompt.includes("Create a 3d illustration"));
  assert.ok(prompt.includes(designSystem.imageStyle));
  assert.ok(prompt.includes("Do not include any text in the image."));
  assert.ok(prompt.includes("Purpose: hero."));
  assert.ok(prompt.includes("Aspect ratio: 16:9"));
});

test("PromptBuilder: purpose=chart_fallback adjusts guidance", async () => {
  const { buildPrompt } = await import("../../js/agents/stages/design/image-prompt-builder.js");

  const slot = {
    slotId: "img_s3_chart_fallback",
    slideIntentId: "s3",
    slideIndex: 3,
    purpose: "chart_fallback",
    promptHint: "Comparison between Option A and Option B",
    style: "flat",
    priority: "optional",
    aspectRatio: "16:9",
  };

  const prompt = buildPrompt(slot, { imageStyle: "Flat vector, clear shapes." }, {});
  assert.ok(prompt.toLowerCase().includes("avoid literal charts"));
});

test("PromptBuilder: extracts keywords from claims when claimIds are present", async () => {
  const { buildPrompt } = await import("../../js/agents/stages/design/image-prompt-builder.js");

  const slot = {
    slotId: "img_s2_illustration",
    slideIntentId: "s2",
    slideIndex: 2,
    purpose: "illustration",
    promptHint: "Evidence chain and citation tracking system",
    style: "3d",
    priority: "important",
    aspectRatio: "4:3",
    claimIds: ["c1", "c2"],
  };

  const contentPackage = {
    claims: [
      { claimId: "c1", text: "Claim 1: Evidence chain improves trust and auditability in workflows." },
      { claimId: "c2", text: "Claim 2: Citation tracking reduces hallucinations and increases reliability." },
    ],
  };

  const prompt = buildPrompt(slot, { imageStyle: "Modern, high clarity." }, contentPackage);

  assert.ok(prompt.includes("Key concepts:"));
  assert.ok(prompt.toLowerCase().includes("evidence"));
  assert.ok(prompt.toLowerCase().includes("citation"));
  assert.ok(prompt.toLowerCase().includes("tracking"));
});

test("PromptBuilder: handles missing designSystem.imageStyle and missing claims gracefully", async () => {
  const { buildPrompt } = await import("../../js/agents/stages/design/image-prompt-builder.js");

  const slot = {
    slotId: "img_s1_illustration",
    slideIntentId: "s1",
    slideIndex: 1,
    purpose: "illustration",
    promptHint: "Simple overview illustration",
    style: "flat",
    priority: "important",
    aspectRatio: "4:3",
    claimIds: ["missing"],
  };

  const prompt = buildPrompt(slot, { theme: "dark", designTokens: { colors: { primary: "#38bdf8", bg: "#0b1220" } } }, { claims: [] });
  assert.ok(prompt.includes("Style guidelines:"));
  assert.ok(!prompt.includes("Key concepts:"));
});

