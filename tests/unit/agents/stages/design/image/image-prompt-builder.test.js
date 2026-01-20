import { describe, it, expect, vi, beforeEach } from "vitest";

const uuidSequence = vi.hoisted(() => {
  let counter = 0;
  return {
    next() {
      counter += 1;
      return `uuid-${counter}`;
    },
    reset() {
      counter = 0;
    },
  };
});

vi.mock("node:crypto", () => {
  return {
    randomUUID: vi.fn(() => uuidSequence.next()),
  };
});

import { randomUUID } from "node:crypto";
import { buildPrompt } from "../../../../../../js/agents/stages/design/image/image-prompt-builder.js";

const getKeyConcepts = (prompt) => {
  const line = prompt.split("\n").find((item) => item.startsWith("Key concepts: "));
  if (!line) return [];
  return line.replace("Key concepts: ", "").split(", ").filter(Boolean);
};

describe("buildPrompt", () => {
  beforeEach(() => {
    uuidSequence.reset();
    vi.clearAllMocks();
  });

  it("builds prompt with explicit inputs and derived keywords", () => {
    const imageSlot = {
      promptHint: "Solar energy for schools",
      style: "isometric",
      purpose: "hero",
      aspectRatio: "4:3",
      claimIds: ["c1", "c2"],
    };
    const designSystem = { imageStyle: "Vibrant collage style." };
    const contentPackage = {
      claims: [
        { claimId: "c1", text: "Claim 1: Solar energy reduces costs for schools." },
        { claimId: "c2", text: "Claim 2: Solar panels provide clean power for students." },
        { claimId: "c3", text: "Claim 3: This should be ignored." },
      ],
    };

    const prompt = buildPrompt(imageSlot, designSystem, contentPackage);

    expect(prompt).toContain("Create a isometric illustration for a presentation slide.");
    expect(prompt).toContain("Topic: Solar energy for schools");
    expect(prompt).toContain("Purpose: hero.");
    expect(prompt).toContain("High-impact hero image");
    expect(prompt).toContain("Aspect ratio: 4:3");
    expect(prompt).toContain("Style guidelines: Vibrant collage style.");
    expect(prompt).toContain("Do not include any text in the image.");
    expect(prompt).toContain("No logos, watermarks, captions, or UI chrome.");
    expect(prompt.endsWith("\n")).toBe(true);

    const keywords = getKeyConcepts(prompt);
    expect(keywords[0]).toBe("solar");
    expect(keywords).toHaveLength(10);
    const expected = [
      "solar",
      "clean",
      "costs",
      "energy",
      "panels",
      "power",
      "provide",
      "reduces",
      "schools",
      "students",
    ];
    expect([...keywords].sort()).toEqual([...expected].sort());
  });

  it("uses defaults for null/undefined/empty inputs", () => {
    const cases = [
      { label: "nulls", args: [null, null, null] },
      { label: "undefined", args: [undefined, undefined, undefined] },
      { label: "empty objects", args: [{}, {}, {}] },
      {
        label: "empty strings",
        args: [{ promptHint: "", style: "", purpose: "", aspectRatio: "", claimIds: [] }, {}, { claims: [] }],
      },
      { label: "empty arrays", args: [{ claimIds: [] }, {}, { claims: [] }] },
    ];

    for (const { args } of cases) {
      const prompt = buildPrompt(...args);
      expect(prompt).toContain("Create a flat illustration for a presentation slide.");
      expect(prompt).toContain("Topic: A presentation slide illustration.");
      expect(prompt).toContain("Purpose: illustration.");
      expect(prompt).toContain("Conceptual illustration that supports the slide message");
      expect(prompt).toContain("Aspect ratio: 16:9");
      expect(prompt).toContain("Clean modern presentation style.");
      expect(prompt).toContain("High contrast shapes; simple composition; no clutter.");
      expect(prompt).not.toContain("Key concepts:");
      expect(prompt.endsWith("\n")).toBe(true);
    }
  });

  it("retains empty purpose/aspectRatio when whitespace is trimmed", () => {
    const prompt = buildPrompt(
      { promptHint: "   ", style: " ", purpose: " ", aspectRatio: "   ", claimIds: [] },
      {},
      { claims: [] }
    );

    expect(prompt).toContain("Create a flat illustration for a presentation slide.");
    expect(prompt).toContain("Topic: A presentation slide illustration.");
    expect(prompt).toContain("Purpose: . Presentation-friendly illustration.");
    const aspectLine = prompt.split("\n").find((line) => line.startsWith("Aspect ratio: "));
    expect(aspectLine).toBe("Aspect ratio: ");
    expect(prompt).toContain("Clean modern presentation style.");
    expect(prompt).not.toContain("Key concepts:");
    expect(prompt.endsWith("\n")).toBe(true);
  });

  it("handles numeric boundaries and MAX_SAFE_INTEGER claimIds", () => {
    const imageSlot = {
      promptHint: 0,
      style: 0,
      purpose: 0,
      aspectRatio: -1,
      claimIds: [0, -1, Number.MAX_SAFE_INTEGER],
    };
    const contentPackage = {
      claims: [
        { claimId: 0, text: "Claim 0: Zero energy usage." },
        { claimId: -1, text: "Claim -1: Negative emissions target." },
        { claimId: Number.MAX_SAFE_INTEGER, text: "Claim 9007199254740991: Mega scale deployment." },
      ],
    };

    const prompt = buildPrompt(imageSlot, {}, contentPackage);

    expect(prompt).toContain("Create a flat illustration for a presentation slide.");
    expect(prompt).toContain("Topic: A presentation slide illustration.");
    expect(prompt).toContain("Purpose: illustration.");
    expect(prompt).toContain("Aspect ratio: -1");
    expect(prompt).toContain("Key concepts:");
    expect(prompt.endsWith("\n")).toBe(true);

    const keywords = getKeyConcepts(prompt);
    const expected = ["deployment", "emissions", "energy", "mega", "negative", "scale", "target", "usage", "zero"];
    expect([...keywords].sort()).toEqual([...expected].sort());
  });

  it("treats non-array claimIds/claims as empty and trims string inputs", () => {
    const imageSlot = {
      promptHint: " 123 ",
      style: " 456 ",
      purpose: "icon",
      aspectRatio: "0",
      claimIds: { bad: "array" },
    };
    const designSystem = { imageStyle: "Minimal line art." };
    const contentPackage = { claims: { bad: "array" } };

    const prompt = buildPrompt(imageSlot, designSystem, contentPackage);

    expect(prompt).toContain("Create a 456 illustration for a presentation slide.");
    expect(prompt).toContain("Topic: 123");
    expect(prompt).toContain("Purpose: icon.");
    expect(prompt).toContain("Single simple icon");
    expect(prompt).toContain("Aspect ratio: 0");
    expect(prompt).toContain("Style guidelines: Minimal line art.");
    expect(prompt).not.toContain("Key concepts:");
    expect(prompt.endsWith("\n")).toBe(true);
  });

  it("supports concurrent and rapid successive calls without shared state", async () => {
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    const contentPackage = {
      claims: [
        { claimId: ids[0], text: "Claim 1: Alpha topic shows clarity." },
        { claimId: ids[1], text: "Claim 2: Beta topic reveals depth." },
        { claimId: ids[2], text: "Claim 3: Gamma topic indicates motion." },
      ],
    };
    const designSystem = { imageStyle: "Unified vector style." };
    const slots = [
      { promptHint: "Alpha", style: "flat", purpose: "background", aspectRatio: "1:1", claimIds: [ids[0]] },
      { promptHint: "Beta", style: "3d", purpose: "chart_fallback", aspectRatio: "4:3", claimIds: [ids[1]] },
      { promptHint: "Gamma", style: "line", purpose: "hero", aspectRatio: "16:9", claimIds: [ids[2]] },
    ];

    const results = await Promise.all(
      slots.map((slot) => Promise.resolve().then(() => buildPrompt(slot, designSystem, contentPackage)))
    );

    expect(results[0]).toContain("Topic: Alpha");
    expect(results[0]).toContain("Purpose: background.");
    expect(results[0]).not.toContain("Topic: Beta");
    expect(results[1]).toContain("Topic: Beta");
    expect(results[1]).toContain("avoid literal charts");
    expect(results[2]).toContain("Topic: Gamma");
    expect(results[2]).toContain("High-impact hero image");

    const repeated = Array.from({ length: 5 }, () => buildPrompt(slots[0], designSystem, contentPackage));
    expect(new Set(repeated).size).toBe(1);
  });

  it("handles large inputs, deep nesting, and large claim sets", () => {
    const hugeHint = `${"Insight ".repeat(5000)}mega`;
    const deepDesignSystem = {
      theme: "NeOn",
      designTokens: {
        colors: { primary: "#ff00aa", bg: "#001122" },
        palette: { nested: { deeper: { flag: true } } },
      },
    };
    const importantId = randomUUID();
    const bulkClaims = Array.from({ length: 200 }, (_, index) => ({
      claimId: `bulk-${index}`,
      text: `Claim ${index}: mega scale deployment strategy.`,
    }));
    const contentPackage = {
      claims: [
        { claimId: importantId, text: "Claim 999: mega mega mega scale deployment." },
        ...bulkClaims,
      ],
    };
    const imageSlot = {
      promptHint: hugeHint,
      style: "flat",
      purpose: "background",
      aspectRatio: "21:9",
      claimIds: [importantId, ...bulkClaims.map((c) => c.claimId)],
    };

    const prompt = buildPrompt(imageSlot, deepDesignSystem, contentPackage);

    expect(prompt.length).toBeGreaterThan(hugeHint.length);
    expect(prompt).toContain("Theme: neon.");
    expect(prompt).toContain("primary color (#ff00aa)");
    expect(prompt).toContain("Background should harmonize with (#001122).");
    expect(prompt).toContain("Style guidelines: Clean modern presentation style.");
    expect(prompt.endsWith("\n")).toBe(true);

    const keywords = getKeyConcepts(prompt);
    expect(keywords[0]).toBe("mega");
    expect(keywords).toContain("deployment");
  });

  it("does not throw on unexpected types and unknown purposes", () => {
    const prompt = buildPrompt({ promptHint: "Weird case", purpose: "mystery", claimIds: "bad" }, 5, "oops");

    expect(prompt).toContain("Purpose: mystery.");
    expect(prompt).toContain("Presentation-friendly illustration.");
    expect(prompt).toContain("Clean modern presentation style.");
    expect(prompt.endsWith("\n")).toBe(true);
  });
});
