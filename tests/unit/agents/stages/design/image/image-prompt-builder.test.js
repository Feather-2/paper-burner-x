import { describe, it, expect, beforeEach, afterEach } from "vitest";

const test = require("node:test");
const assert = require("node:assert/strict");

it("PromptBuilder: assembles promptHint + style + designSystem.imageStyle and includes no-text instruction", async () => {
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

  expect(prompt).toContain("AI-powered presentation generation workflow");
  expect(prompt).toContain("Create a 3d illustration");
  expect(prompt).toContain(designSystem.imageStyle);
  expect(prompt).toContain("Do not include any text in the image.");
  expect(prompt).toContain("Purpose: hero.");
  expect(prompt).toContain("Aspect ratio: 16:9");
});

it("PromptBuilder: purpose=chart_fallback adjusts guidance", async () => {
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
  expect(prompt).toMatch(/avoid literal charts/i);
});

it("PromptBuilder: extracts keywords from claims when claimIds are present", async () => {
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

  expect(prompt).toContain("Key concepts:");
  expect(prompt).toMatch(/evidence/i);
  expect(prompt).toMatch(/citation/i);
  expect(prompt).toMatch(/tracking/i);
});

it("PromptBuilder: handles missing designSystem.imageStyle and missing claims gracefully", async () => {
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
  expect(prompt).toContain("Style guidelines:");
  expect(prompt.includes("Key concepts:")).toBeFalsy();
});
