import { describe, it, expect, beforeEach, afterEach } from "vitest";

const test = require("node:test");
const assert = require("node:assert/strict");

function delay() {
  return new Promise((resolve) => setImmediate(resolve));
}

function makeSlot({ slotId, slideIndex, priority }) {
  return {
    slotId,
    slideIntentId: `s_${slotId}`,
    slideIndex,
    purpose: "illustration",
    promptHint: `Prompt for ${slotId}`,
    style: "flat",
    priority,
    aspectRatio: "16:9",
  };
}

it("ImageGenerator: concurrency=2 limits concurrent provider calls", async () => {
  const { ImageGenerator } = await import("../../js/agents/stages/design/image-generator.js");

  let active = 0;
  let maxActive = 0;
  const provider = {
    provider: "mock",
    model: "m1",
    generate: async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await delay();
      active -= 1;
      return { provider: "mock", model: "m1", mimeType: "image/png", url: "https://example.com/x.png", width: 1, height: 1 };
    },
  };

  const slots = [
    makeSlot({ slotId: "img_a", slideIndex: 0, priority: "optional" }),
    makeSlot({ slotId: "img_b", slideIndex: 1, priority: "optional" }),
    makeSlot({ slotId: "img_c", slideIndex: 2, priority: "optional" }),
    makeSlot({ slotId: "img_d", slideIndex: 3, priority: "optional" }),
    makeSlot({ slotId: "img_e", slideIndex: 4, priority: "optional" }),
  ];

  const gen = new ImageGenerator({ imageProvider: provider, concurrency: 2, budget: { maxImages: 10, maxCostUSD: 10, candidatesPerSlot: 1 } });
  const { report } = await gen.generate(slots, { runId: "run_conc", constraints: {} }, { imageStyle: "Test style" }, { concurrency: 2 });

  expect(maxActive <= 2).toBeTruthy();
  expect(report.summary.succeeded).toBe(5);
  expect(report.summary.failed).toBe(0);
  expect(report.summary.skipped).toBe(0);
});

it("ImageGenerator: retries once after failure, then succeeds", async () => {
  const { ImageGenerator } = await import("../../js/agents/stages/design/image-generator.js");

  let calls = 0;
  const provider = {
    provider: "mock",
    model: "m1",
    generate: async () => {
      calls += 1;
      if (calls === 1) throw new Error("boom");
      return { provider: "mock", model: "m1", mimeType: "image/png", url: "https://example.com/s.png", width: 1, height: 1 };
    },
  };

  const slots = [makeSlot({ slotId: "img_retry", slideIndex: 0, priority: "critical" })];
  const gen = new ImageGenerator({ imageProvider: provider, budget: { maxRetries: 2, timeoutMs: 200, maxImages: 5, maxCostUSD: 10, candidatesPerSlot: 1 } });
  const { report } = await gen.generate(slots, { runId: "run_retry", constraints: {} }, { imageStyle: "Test style" }, {});

  expect(calls).toBe(2);
  expect(report.tasks.length).toBe(1);
  expect(report.tasks[0].status).toBe("success");
  expect(report.tasks[0].retryCount).toBe(1);
});

it("ImageGenerator: retry stops when maxCostUSD is exhausted during retries", async () => {
  const { ImageGenerator } = await import("../../js/agents/stages/design/image-generator.js");

  let calls = 0;
  const provider = {
    provider: "openai-image",
    model: "gpt-image-1",
    generate: async () => {
      calls += 1;
      throw new Error(`fail_${calls}`);
    },
  };

  const slots = [makeSlot({ slotId: "img_cost_retry", slideIndex: 0, priority: "critical" })];
  const gen = new ImageGenerator({
    imageProvider: provider,
    budget: { maxRetries: 1, timeoutMs: 200, maxImages: 5, maxCostUSD: 0.05, candidatesPerSlot: 1 },
  });
  const { report } = await gen.generate(slots, { runId: "run_cost_retry", constraints: {} }, { imageStyle: "Test style" }, {});

  expect(calls).toBe(1); // second attempt is blocked by budget reserve
  expect(report.tasks[0].status).toBe("failed");
  expect(report.tasks[0].error).toMatch(/budget exhausted/i);
});

it("ImageGenerator: maxImages budget causes later tasks to be skipped", async () => {
  const { ImageGenerator } = await import("../../js/agents/stages/design/image-generator.js");

  let calls = 0;
  const provider = {
    provider: "mock",
    model: "m1",
    generate: async () => {
      calls += 1;
      return { provider: "mock", model: "m1", mimeType: "image/png", url: `https://example.com/${calls}.png`, width: 1, height: 1 };
    },
  };

  const slots = [
    makeSlot({ slotId: "img_1", slideIndex: 0, priority: "critical" }),
    makeSlot({ slotId: "img_2", slideIndex: 1, priority: "important" }),
    makeSlot({ slotId: "img_3", slideIndex: 2, priority: "optional" }),
  ];

  const gen = new ImageGenerator({ imageProvider: provider, concurrency: 2, budget: { maxImages: 2, maxCostUSD: 10, candidatesPerSlot: 1 } });
  const { report } = await gen.generate(slots, { runId: "run_max_images", constraints: {} }, { imageStyle: "Test style" }, {});

  expect(calls).toBe(2);
  expect(report.summary.attempted).toBe(2);
  expect(report.summary.skipped).toBe(1);
  expect(report.tasks.some(t => t.status === "skipped")).toBeTruthy();
});

it("ImageGenerator: maxCostUSD prevents later tasks from starting (provider-based estimate)", async () => {
  const { ImageGenerator } = await import("../../js/agents/stages/design/image-generator.js");

  let calls = 0;
  const provider = {
    provider: "openai-image",
    model: "gpt-image-1",
    generate: async () => {
      calls += 1;
      return { provider: "openai-image", model: "gpt-image-1", mimeType: "image/png", url: `https://example.com/${calls}.png`, width: 1, height: 1 };
    },
  };

  const slots = [
    makeSlot({ slotId: "img_cost_1", slideIndex: 0, priority: "critical" }),
    makeSlot({ slotId: "img_cost_2", slideIndex: 1, priority: "important" }),
  ];

  const gen = new ImageGenerator({ imageProvider: provider, budget: { maxImages: 10, maxCostUSD: 0.05, candidatesPerSlot: 1 } });
  const { report } = await gen.generate(slots, { runId: "run_cost", constraints: {} }, { imageStyle: "Test style" }, {});

  expect(calls).toBe(1);
  expect(report.summary.skipped).toBe(1);
  expect(report.summary.totalCostUSD).toBe(0.04);
});

it("ImageGenerator: priority sorting runs critical before important before optional (concurrency=1)", async () => {
  const { ImageGenerator } = await import("../../js/agents/stages/design/image-generator.js");

  const started = [];
  const emit = (name, record) => {
    if (name === "design.image.generate.started") started.push(record.payload.slotId);
  };

  const provider = {
    provider: "mock",
    model: "m1",
    generate: async () => ({ provider: "mock", model: "m1", mimeType: "image/png", url: "https://example.com/x.png", width: 1, height: 1 }),
  };

  const slots = [
    makeSlot({ slotId: "img_optional", slideIndex: 0, priority: "optional" }),
    makeSlot({ slotId: "img_critical", slideIndex: 1, priority: "critical" }),
    makeSlot({ slotId: "img_important", slideIndex: 2, priority: "important" }),
  ];

  const gen = new ImageGenerator({ imageProvider: provider, concurrency: 1, budget: { maxImages: 10, maxCostUSD: 10, candidatesPerSlot: 1 } });
  await gen.generate(slots, { runId: "run_pri", constraints: {} }, { imageStyle: "Test style" }, { emit, concurrency: 1 });

  expect(started).toEqual(["img_critical", "img_important", "img_optional"]);
});

it("ImageGenerator: timeout produces a failed task and does not hang", async () => {
  const { ImageGenerator } = await import("../../js/agents/stages/design/image-generator.js");

  const provider = {
    provider: "mock",
    model: "m1",
    generate: async () => new Promise(() => {}), // never resolves
  };

  const slots = [makeSlot({ slotId: "img_timeout", slideIndex: 0, priority: "critical" })];
  const gen = new ImageGenerator({ imageProvider: provider, concurrency: 1, budget: { maxRetries: 0, timeoutMs: 20, maxImages: 5, maxCostUSD: 10, candidatesPerSlot: 1 } });
  const { report } = await gen.generate(slots, { runId: "run_timeout", constraints: {} }, { imageStyle: "Test style" }, {});

  expect(report.tasks[0].status).toBe("failed");
  expect(report.tasks[0].error).toMatch(/timed out/i);
});

it("ImageGenerator: report summary fields are correct (success + failed + skipped)", async () => {
  const { ImageGenerator } = await import("../../js/agents/stages/design/image-generator.js");

  const provider = {
    provider: "mock",
    model: "m1",
    generate: async (req) => {
      await delay();
      if (String(req.prompt).includes("img_fail")) throw new Error("fail");
      return { provider: "mock", model: "m1", mimeType: "image/png", url: "https://example.com/x.png", width: 1, height: 1 };
    },
  };

  const slots = [
    makeSlot({ slotId: "img_ok", slideIndex: 0, priority: "critical" }),
    makeSlot({ slotId: "img_fail", slideIndex: 1, priority: "important" }),
    makeSlot({ slotId: "img_skip", slideIndex: 2, priority: "optional" }),
  ];

  const gen = new ImageGenerator({ imageProvider: provider, concurrency: 1, budget: { maxImages: 2, maxCostUSD: 10, maxRetries: 0, candidatesPerSlot: 1 } });
  const { report } = await gen.generate(slots, { runId: "run_report", constraints: { imagePolicy: "balanced" } }, { imageStyle: "Test style" }, {});

  expect(report.schemaVersion).toBe("0.1");
  expect(report.runId).toBe("run_report");
  expect(report.policy).toBe("balanced");
  expect(report.summary.planned).toBe(3);
  expect(report.summary.attempted).toBe(2);
  expect(report.summary.succeeded).toBe(1);
  expect(report.summary.failed).toBe(1);
  expect(report.summary.skipped).toBe(1);
  expect(report.summary.totalCostUSD).toBe(0);
  expect(report.summary.totalDurationMs > 0).toBeTruthy();
});

it("ImageGenerator: fills slot candidates and auto-selects first success (candidatesPerSlot=2)", async () => {
  const { ImageGenerator } = await import("../../js/agents/stages/design/image-generator.js");

  let calls = 0;
  const provider = {
    provider: "mock",
    model: "m1",
    generate: async () => {
      calls += 1;
      return { provider: "mock", model: "m1", mimeType: "image/png", url: `https://example.com/${calls}.png`, width: 1, height: 1 };
    },
  };

  const slots = [makeSlot({ slotId: "img_multi", slideIndex: 0, priority: "critical" })];
  const gen = new ImageGenerator({ imageProvider: provider, concurrency: 2, budget: { maxImages: 10, maxCostUSD: 10, candidatesPerSlot: 2 } });
  const { filledSlots, report } = await gen.generate(slots, { runId: "run_multi", constraints: {} }, { imageStyle: "Test style" }, {});

  expect(calls).toBe(2);
  expect(report.tasks.length).toBe(2);
  expect(filledSlots.length).toBe(1);
  expect(filledSlots[0].candidates.length).toBe(2);
  expect(filledSlots[0].selectedId).toBe("img_multi_c1");
  expect(filledSlots[0].selectionStatus).toBe("auto_selected");
});

it("ImageGenerator: emits per-task events and ends with design.image.fill.completed", async () => {
  const { createImageGenerator, generateImages } = await import("../../js/agents/stages/design/image-generator.js");

  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const provider = {
    provider: "mock",
    model: "m1",
    generate: async (req) => {
      if (String(req.prompt).includes("img_bad")) throw new Error("nope");
      return { provider: "mock", model: "m1", mimeType: "image/png", url: "https://example.com/x.png", width: 1, height: 1 };
    },
  };

  const slots = [
    makeSlot({ slotId: "img_good", slideIndex: 0, priority: "critical" }),
    makeSlot({ slotId: "img_bad", slideIndex: 1, priority: "important" }),
  ];

  const gen = createImageGenerator({ imageProvider: provider, concurrency: 1, budget: { maxImages: 10, maxCostUSD: 10, maxRetries: 0, candidatesPerSlot: 1 } });
  await gen.generate(slots, { runId: "run_events", constraints: {} }, { imageStyle: "Test style" }, { emit, concurrency: 1 });

  const names = events.map((e) => e.name);
  expect(names).toEqual([
    "design.image.generate.started",
    "design.image.generate.succeeded",
    "design.image.generate.started",
    "design.image.generate.failed",
    "design.image.fill.completed",
  ]);

  // Convenience function should be usable too.
  const out = await generateImages([makeSlot({ slotId: "img_2", slideIndex: 0, priority: "critical" })], { runId: "run_events2", constraints: {} }, { imageStyle: "Test style" }, { imageProvider: provider });
  expect(out.report.runId).toBe("run_events2");
});
