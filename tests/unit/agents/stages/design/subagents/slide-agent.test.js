import { describe, it, expect, vi, beforeEach } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

const mockedBatchGenerator = vi.hoisted(() => ({
  generateSingleSlide: vi.fn(),
}));

const mockedDslRules = vi.hoisted(() => ({
  getDslRules: vi.fn(),
}));

vi.mock("../../../../../../js/agents/stages/design/generators/batch-generator.js", () => ({
  generateSingleSlide: mockedBatchGenerator.generateSingleSlide,
}));

vi.mock("../../../../../../js/agents/stages/design/dsl/dsl-rules.js", () => ({
  getDslRules: mockedDslRules.getDslRules,
}));

import { setLinkedFilesRoot, SlideSubAgent } from "../../../../../../js/agents/stages/design/subagents/slide-agent.js";
import { SlideStatus, VisualSlotStatus } from "../../../../../../js/agents/stages/design/states.js";

const makeDesignSystem = () => ({ theme: "test" });

const makeSlideIntent = (overrides = {}) => ({
  slideIntentId: "slide-1",
  slideIndex: 0,
  content: "Base content",
  linkedAssets: [],
  linkedFiles: [],
  ...overrides,
});

const makeTempDir = () => fs.mkdtemp(path.join(os.tmpdir(), "slide-agent-"));

const writeTempFile = async (dir, name, content) => {
  const filePath = path.join(dir, name);
  await fs.writeFile(filePath, content, "utf8");
  return filePath;
};

beforeEach(() => {
  vi.resetAllMocks();
  setLinkedFilesRoot(null);
  mockedDslRules.getDslRules.mockResolvedValue({ rules: true });
  mockedBatchGenerator.generateSingleSlide.mockResolvedValue({
    slideHtml: "<section></section>",
    source: "mock",
  });
});

describe("setLinkedFilesRoot", () => {
  it("allows reading within root and truncates large files", async () => {
    const dir = await makeTempDir();
    try {
      const huge = "A".repeat(1300);
      const filePath = await writeTempFile(dir, "huge.txt", huge);
      setLinkedFilesRoot(dir);

      const slideIntent = makeSlideIntent({
        linkedFiles: ["", filePath],
      });
      const agent = new SlideSubAgent({ slideIntent, designSystem: makeDesignSystem() });
      await agent.run();

      expect(mockedBatchGenerator.generateSingleSlide).toHaveBeenCalledTimes(1);
      const [enrichedSlideIntent] = mockedBatchGenerator.generateSingleSlide.mock.calls[0];
      expect(enrichedSlideIntent.content).toContain("Base content");
      expect(enrichedSlideIntent.content).toContain("Linked files:");
      expect(enrichedSlideIntent.content).toContain("--- huge.txt ---");

      const truncated = `${huge.slice(0, 1200)}\n...(truncated)`;
      expect(enrichedSlideIntent.content).toContain(truncated);
      expect(enrichedSlideIntent.content).not.toContain(huge);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("uses the last root on rapid updates and denies outside paths", async () => {
    const dir1 = await makeTempDir();
    const dir2 = await makeTempDir();
    try {
      const file1 = await writeTempFile(dir1, "one.txt", "root1");
      const file2 = await writeTempFile(dir2, "two.txt", "root2");

      setLinkedFilesRoot(dir1);
      setLinkedFilesRoot(dir2);

      const slideIntent = makeSlideIntent({
        linkedFiles: [file1, file2],
      });
      const agent = new SlideSubAgent({ slideIntent, designSystem: makeDesignSystem() });
      await agent.run();

      const [enrichedSlideIntent] = mockedBatchGenerator.generateSingleSlide.mock.calls[0];
      expect(enrichedSlideIntent.content).toContain(`[access denied`);
      expect(enrichedSlideIntent.content).toContain(`--- ${file1} ---`);
      expect(enrichedSlideIntent.content).toContain("--- two.txt ---\nroot2");
    } finally {
      await fs.rm(dir1, { recursive: true, force: true });
      await fs.rm(dir2, { recursive: true, force: true });
    }
  });

  it("blocks reads when root is non-string or whitespace", async () => {
    const dir = await makeTempDir();
    try {
      const filePath = await writeTempFile(dir, "data.txt", "payload");

      setLinkedFilesRoot(0);
      const slideIntent = makeSlideIntent({
        linkedFiles: [filePath],
      });
      const agent = new SlideSubAgent({ slideIntent, designSystem: makeDesignSystem() });
      await agent.run();

      let [enrichedSlideIntent] = mockedBatchGenerator.generateSingleSlide.mock.calls[0];
      expect(enrichedSlideIntent.content).toContain("[access denied");

      mockedBatchGenerator.generateSingleSlide.mockClear();

      setLinkedFilesRoot("   ");
      const slideIntent2 = makeSlideIntent({
        linkedFiles: [filePath],
      });
      const agent2 = new SlideSubAgent({ slideIntent: slideIntent2, designSystem: makeDesignSystem() });
      await agent2.run();

      [enrichedSlideIntent] = mockedBatchGenerator.generateSingleSlide.mock.calls[0];
      expect(enrichedSlideIntent.content).toContain("[access denied");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("SlideSubAgent", () => {
  it("throws when required inputs are missing", async () => {
    const agentMissingIntent = new SlideSubAgent({ designSystem: makeDesignSystem() });
    await expect(agentMissingIntent.run()).rejects.toThrow("slideIntent is required");

    const agentMissingDesign = new SlideSubAgent({ slideIntent: makeSlideIntent() });
    await expect(agentMissingDesign.run()).rejects.toThrow("designSystem is required");
  });

  it("appends supplemental content and preserves nested metadata", async () => {
    const dir = await makeTempDir();
    try {
      const filePath = await writeTempFile(dir, "notes.txt", "File content");
      setLinkedFilesRoot(dir);

      const longNotes = "N".repeat(1500);
      const slideIntent = makeSlideIntent({
        slideIntentId: "slide-deep",
        content: {
          markdown: "Intro",
          meta: { level1: { level2: { level3: { value: "deep" } } } },
        },
        userNotes: longNotes,
        linkedAssets: ["asset-1"],
        linkedFiles: [filePath],
      });

      const assetRegistry = {
        getAsset: (id) => ({
          context: "Sales data",
          type: "image",
          source: "library",
          tags: ["q1", "chart"],
        }),
      };

      const agent = new SlideSubAgent({
        slideIntent,
        designSystem: makeDesignSystem(),
        assetRegistry,
      });
      const result = await agent.run();

      const [enrichedSlideIntent] = mockedBatchGenerator.generateSingleSlide.mock.calls[0];
      expect(enrichedSlideIntent.content).toEqual(expect.any(Object));
      expect(enrichedSlideIntent.content.markdown).toContain("Intro");
      expect(enrichedSlideIntent.content.markdown).toContain(`User notes: ${longNotes}`);
      expect(enrichedSlideIntent.content.markdown).toContain("Linked assets:");
      expect(enrichedSlideIntent.content.markdown).toContain("- asset-1: Sales data; image; source:library; tags:q1, chart");
      expect(enrichedSlideIntent.content.markdown).toContain("--- notes.txt ---\nFile content");
      expect(enrichedSlideIntent.content.meta.level1.level2.level3.value).toBe("deep");
      expect(result.status).toBe(SlideStatus.COMPLETED);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("extracts visual slots and keeps visual_pending status when slots exist", async () => {
    const html = `<section>
      <div data-el="image-placeholder" data-slot-id="slot-1" data-render-type="svg" data-x="10" data-y="20" data-w="100" data-h="200" data-effects='{"blur":2}' data-aspect-ratio="16:9"></div>
      <div data-el="image-placeholder" id="slot-2" data-render-type="image"></div>
      <div data-el="image-placeholder" data-slot-id="slot-1"></div>
      <div data-el="image-placeholder"></div>
    </section>`;

    mockedBatchGenerator.generateSingleSlide.mockResolvedValueOnce({
      slideHtml: html,
      source: "mock",
    });

    const slideIntent = makeSlideIntent({
      slideIntentId: "slot-test",
      slideIndex: 5,
    });
    const agent = new SlideSubAgent({ slideIntent, designSystem: makeDesignSystem() });
    const result = await agent.run();

    expect(result.status).toBe(SlideStatus.VISUAL_PENDING);
    expect(result.visualSlots).toHaveLength(2);

    const slot1 = result.visualSlots.find((slot) => slot.slotId === "slot-1");
    expect(slot1).toEqual(expect.objectContaining({
      slotId: "slot-1",
      slideIntentId: "slot-test",
      slideIndex: 5,
      renderType: "svg",
      status: VisualSlotStatus.PENDING,
      aspectRatio: "16:9",
    }));
    expect(slot1.position).toEqual({ x: "10", y: "20", w: "100", h: "200" });
    expect(slot1.effects).toEqual({ blur: 2 });

    const slot2 = result.visualSlots.find((slot) => slot.slotId === "slot-2");
    expect(slot2.renderType).toBe("ai-image");
  });

  it("handles invalid types and empty structures without supplemental content", async () => {
    const slideIntent = makeSlideIntent({
      slideIntentId: "   ",
      slideIndex: "3",
      content: {},
      linkedFiles: [],
      linkedAssets: {},
    });

    const agent = new SlideSubAgent({ slideIntent, designSystem: makeDesignSystem() });
    const result = await agent.run({
      slideIndex: "4",
      imageSlotsForSlide: { not: "array" },
      selectedIdeas: { nope: true },
    });

    const [passedIntent, , , options] = mockedBatchGenerator.generateSingleSlide.mock.calls[0];
    expect(passedIntent).toBe(slideIntent);
    expect(options.imageSlotsForSlide).toEqual([]);
    expect(options.selectedIdeas).toEqual([]);
    expect(result.slideIntentId).toBeUndefined();
    expect(result.slideIndex).toBe(0);
  });

  it("computes slideNo for boundary slideIndex values", async () => {
    const cases = [
      { slideIndex: 0, expectedSlideNo: 1 },
      { slideIndex: -1, expectedSlideNo: 0 },
      { slideIndex: Number.MAX_SAFE_INTEGER, expectedSlideNo: Number.MAX_SAFE_INTEGER + 1 },
    ];

    for (const { slideIndex, expectedSlideNo } of cases) {
      const slideIntent = makeSlideIntent({
        slideIntentId: `case-${slideIndex}`,
        slideIndex,
        content: "",
      });
      const agent = new SlideSubAgent({ slideIntent, designSystem: makeDesignSystem() });
      const result = await agent.run();
      const lastCall = mockedBatchGenerator.generateSingleSlide.mock.calls.at(-1);
      expect(lastCall[3].slideIndex).toBe(slideIndex);
      expect(lastCall[3].slideNo).toBe(expectedSlideNo);
      expect(result.slideIndex).toBe(slideIndex);
    }
  });

  it("returns failed status when generation throws", async () => {
    mockedBatchGenerator.generateSingleSlide.mockRejectedValueOnce(new Error("boom"));

    const slideIntent = makeSlideIntent({ slideIntentId: "fail", slideIndex: 1 });
    const agent = new SlideSubAgent({ slideIntent, designSystem: makeDesignSystem() });
    const result = await agent.run();

    expect(result.status).toBe(SlideStatus.FAILED);
    expect(result.source).toBe("error");
    expect(result.error).toContain("boom");
    expect(result.htmlDsl).toBe("");
    expect(result.visualSlots).toEqual([]);
  });

  it("supports concurrent runs without cross-talk", async () => {
    mockedBatchGenerator.generateSingleSlide.mockImplementation(async (intent) => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      return { slideHtml: `<section>${intent.slideIntentId}</section>`, source: intent.slideIntentId };
    });

    const agent1 = new SlideSubAgent({
      slideIntent: makeSlideIntent({ slideIntentId: "s1", slideIndex: 1 }),
      designSystem: makeDesignSystem(),
    });
    const agent2 = new SlideSubAgent({
      slideIntent: makeSlideIntent({ slideIntentId: "s2", slideIndex: 2 }),
      designSystem: makeDesignSystem(),
    });

    const [res1, res2] = await Promise.all([agent1.run(), agent2.run()]);

    expect(mockedBatchGenerator.generateSingleSlide).toHaveBeenCalledTimes(2);
    expect([res1.slideIntentId, res2.slideIntentId].sort()).toEqual(["s1", "s2"]);
    expect([res1.slideIndex, res2.slideIndex].sort()).toEqual([1, 2]);
    expect(res1.status).toBe(SlideStatus.COMPLETED);
    expect(res2.status).toBe(SlideStatus.COMPLETED);
  });
});
