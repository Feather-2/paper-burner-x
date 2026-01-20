import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  buildPromptMock,
  safeEmitMock,
  makeSecureTimestampedIdMock,
  DesignEventsMock,
  nowMsMock,
  state,
  toNonEmptyString,
  escapeHtml,
} = vi.hoisted(() => {
  const state = { nowValue: 0, nowStep: 0 };
  const buildPromptMock = vi.fn();
  const safeEmitMock = vi.fn((emit, name, status, payload) => {
    if (typeof emit === "function") {
      emit(name, { actor: "design", status, payload });
    }
  });
  const makeSecureTimestampedIdMock = vi.fn(() => "run_test");
  const DesignEventsMock = {
    IMAGE_GENERATE_STARTED: "design.image.generate.started",
    IMAGE_GENERATE_SUCCEEDED: "design.image.generate.succeeded",
    IMAGE_GENERATE_FAILED: "design.image.generate.failed",
    IMAGE_GENERATE_SKIPPED: "design.image.generate.skipped",
    IMAGE_FILL_COMPLETED: "design.image.fill.completed",
  };
  const nowMsMock = vi.fn(() => {
    state.nowValue += state.nowStep;
    return state.nowValue;
  });
  const toNonEmptyString = (value) => {
    if (value === undefined || value === null) return undefined;
    const s = String(value).trim();
    return s.length ? s : undefined;
  };
  const escapeHtml = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");

  return {
    buildPromptMock,
    safeEmitMock,
    makeSecureTimestampedIdMock,
    DesignEventsMock,
    nowMsMock,
    state,
    toNonEmptyString,
    escapeHtml,
  };
});

vi.mock("../../../../../../js/agents/stages/design/image/image-prompt-builder.js", () => ({
  buildPrompt: buildPromptMock,
}));

vi.mock("../../../../../../js/agents/runtime/index.js", async () => {
  const actual = await vi.importActual("../../../../../../js/agents/runtime/index.js");
  return {
    ...actual,
    DesignEvents: DesignEventsMock,
  };
});

vi.mock("../../../../../../js/agents/shared/index.js", async () => {
  const actual = await vi.importActual("../../../../../../js/agents/shared/index.js");
  return {
    ...actual,
    makeSecureTimestampedId: makeSecureTimestampedIdMock,
    CircuitBreakerRegistry: class {
      get() {
        return {
          canExecute: vi.fn(() => true),
          execute: vi.fn((fn) => fn()),
        };
      }
    },
  };
});

vi.mock("../../../../../../js/agents/stages/design/shared/design-utils.js", () => ({
  nowMs: nowMsMock,
  toNonEmptyString,
  escapeHtml,
}));

vi.mock("../../../../../../js/agents/stages/design/shared/safe-emit.js", () => ({
  safeEmit: safeEmitMock,
  default: { safeEmit: safeEmitMock },
}));

import { ImageGenerator } from "../../../../../../js/agents/stages/design/generators/image-generator.js";
import { ImageTaskStatus, SlotSelectionStatus } from "../../../../../../js/agents/stages/design/constants.js";

const makeSlot = (overrides = {}) => {
  const slotId = overrides.slotId ?? "slot";
  return {
    slotId,
    slideIntentId: `intent_${slotId}`,
    slideIndex: 0,
    purpose: "illustration",
    promptHint: `Prompt for ${slotId}`,
    style: "flat",
    priority: "optional",
    aspectRatio: "16:9",
    ...overrides,
  };
};

describe("ImageGenerator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.nowValue = 0;
    state.nowStep = 0;
    buildPromptMock.mockImplementation((slot) => slot.promptHint || "prompt");
  });

  it("generates a candidate with URL, auto-selects, and emits events", async () => {
    const provider = {
      provider: "mock",
      model: "m1",
      generate: vi.fn(async () => ({
        provider: "mock",
        model: "m1",
        mimeType: "image/png",
        url: "https://example.com/hero.png",
        width: 640,
        height: 480,
      })),
    };

    const slot = makeSlot({ slotId: "hero", slideIndex: 1, priority: "important", aspectRatio: "4:3" });
    const emit = vi.fn();
    const gen = new ImageGenerator({
      imageProvider: provider,
      budget: { maxImages: 1, maxCostUSD: 10, candidatesPerSlot: 1, timeoutMs: 123 },
    });

    const { filledSlots, report } = await gen.generate(
      [slot],
      { runId: "run_success", constraints: {} },
      { imageStyle: "test" },
      { emit }
    );

    expect(buildPromptMock).toHaveBeenCalledWith(
      expect.objectContaining({ slotId: "hero" }),
      { imageStyle: "test" },
      { runId: "run_success", constraints: {} }
    );
    expect(provider.generate).toHaveBeenCalledWith(
      { prompt: "Prompt for hero", aspectRatio: "4:3" },
      { timeoutMs: 123 }
    );
    expect(report.tasks).toHaveLength(1);
    expect(report.tasks[0].status).toBe(ImageTaskStatus.SUCCESS);
    expect(report.tasks[0].result.src).toBe("https://example.com/hero.png");
    expect(report.summary.succeeded).toBe(1);
    expect(report.summary.totalDurationMs).toBe(1);
    expect(filledSlots[0]).not.toBe(slot);
    expect(filledSlots[0].selectedId).toBe("hero_c1");
    expect(filledSlots[0].selectionStatus).toBe(SlotSelectionStatus.AUTO_SELECTED);
    expect(filledSlots[0].candidates).toHaveLength(1);
    expect(slot.candidates).toBeUndefined();

    const eventNames = safeEmitMock.mock.calls.map((call) => call[1]);
    expect(eventNames).toEqual(
      expect.arrayContaining([
        DesignEventsMock.IMAGE_GENERATE_STARTED,
        DesignEventsMock.IMAGE_GENERATE_SUCCEEDED,
        DesignEventsMock.IMAGE_FILL_COMPLETED,
      ])
    );
  });

  it("handles base64 outputs, long prompts, and deep nested slot data", async () => {
    const longPrompt = "P".repeat(12000);
    const bigBase64 = "a".repeat(10000);
    buildPromptMock.mockReturnValue(longPrompt);
    state.nowStep = 5;

    const provider = {
      provider: "mock",
      model: "m1",
      generate: vi.fn(async () => ({
        base64: bigBase64,
        mimeType: "image/jpeg",
        width: 2,
        height: 3,
      })),
    };

    const slot = makeSlot({
      slotId: "slot_big",
      selectedId: "manual",
      metadata: { deep: { nested: { value: "x" } } },
    });
    const gen = new ImageGenerator({
      imageProvider: provider,
      concurrency: 1,
      budget: { maxImages: 2, maxCostUSD: 10, candidatesPerSlot: 2 },
    });

    const { filledSlots, report } = await gen.generate([slot], { runId: "run_big", constraints: {} }, {}, {});

    const filled = filledSlots[0];
    expect(provider.generate).toHaveBeenCalledTimes(2);
    expect(provider.generate.mock.calls[0][0].prompt.length).toBe(longPrompt.length);
    expect(filled.selectedId).toBe("manual");
    expect(filled.selectionStatus).toBeUndefined();
    expect(filled.candidates).toHaveLength(2);
    expect(filled.candidates[0].url.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(filled.candidates[0].url.length).toBeGreaterThan(bigBase64.length);
    expect(filled.metadata.deep.nested.value).toBe("x");
    expect(report.tasks.map((task) => task.result.candidateId)).toEqual(["slot_big_c1", "slot_big_c2"]);
  });

  it("handles empty/invalid inputs and falls back to defaults", async () => {
    const provider = {
      provider: "mock",
      model: "m1",
      generate: vi.fn(),
    };
    const gen = new ImageGenerator({ imageProvider: provider });

    const resultNull = await gen.generate(null, { runId: "   ", constraints: {} }, null, { policy: "   " });
    expect(resultNull.report.runId).toBe("run_test");
    expect(resultNull.report.policy).toBe("balanced");
    expect(resultNull.report.tasks).toHaveLength(0);
    expect(resultNull.filledSlots).toHaveLength(0);

    const resultEmptyArray = await gen.generate([], { runId: "run_empty", constraints: {} }, {}, {});
    expect(resultEmptyArray.report.tasks).toHaveLength(0);

    const resultObject = await gen.generate({ not: "array" }, undefined, undefined, {});
    expect(resultObject.report.tasks).toHaveLength(0);

    const resultBlankSlot = await gen.generate(
      [{ slotId: "  " }, { slotId: "" }],
      { runId: "run_blank", constraints: {} },
      {},
      {}
    );
    expect(resultBlankSlot.report.tasks).toHaveLength(0);
    expect(provider.generate).not.toHaveBeenCalled();
    expect(makeSecureTimestampedIdMock).toHaveBeenCalled();
  });

  it("skips tasks when maxImages is negative or zero", async () => {
    const provider = {
      provider: "mock",
      model: "m1",
      generate: vi.fn(),
    };
    const gen = new ImageGenerator({
      imageProvider: provider,
      budget: { maxImages: -1, maxCostUSD: 10, candidatesPerSlot: 1 },
    });
    const slots = [makeSlot({ slotId: "a" }), makeSlot({ slotId: "b" })];

    const { report } = await gen.generate(slots, { runId: "run_skip", constraints: {} }, {}, {});

    expect(report.tasks).toHaveLength(2);
    expect(report.tasks.every((task) => task.status === ImageTaskStatus.SKIPPED)).toBe(true);
    expect(report.summary.skipped).toBe(2);
    expect(report.summary.attempted).toBe(0);
    expect(provider.generate).not.toHaveBeenCalled();

    const skipCalls = safeEmitMock.mock.calls.filter((call) => call[1] === DesignEventsMock.IMAGE_GENERATE_SKIPPED);
    expect(skipCalls).toHaveLength(2);
    skipCalls.forEach((call) => expect(call[3].reason).toBe("maxImages"));
  });

  it("respects string budgets and skips when maxCostUSD is exceeded", async () => {
    const provider = {
      provider: "openai-image",
      model: "hd",
      generate: vi.fn(),
    };
    const gen = new ImageGenerator({
      imageProvider: provider,
      budget: { maxImages: "2", maxCostUSD: "0.05", maxRetries: "0", timeoutMs: "5", candidatesPerSlot: "1" },
    });

    const { report } = await gen.generate([makeSlot({ slotId: "cost" })], { runId: "run_cost", constraints: {} }, {}, {});

    expect(report.tasks[0].status).toBe(ImageTaskStatus.SKIPPED);
    expect(report.tasks[0].error).toMatch(/maxCostUSD/);
    expect(provider.generate).not.toHaveBeenCalled();

    const skipCall = safeEmitMock.mock.calls.find((call) => call[1] === DesignEventsMock.IMAGE_GENERATE_SKIPPED);
    expect(skipCall[3].reason).toBe("maxCostUSD");
  });

  it("fails with timeout error when provider hangs", async () => {
    const provider = {
      provider: "mock",
      model: "m1",
      generate: vi.fn(() => new Promise(() => {})),
    };
    const gen = new ImageGenerator({
      imageProvider: provider,
      concurrency: 1,
      budget: { maxImages: 1, maxCostUSD: 1, maxRetries: 0, timeoutMs: 5, candidatesPerSlot: 1 },
    });

    vi.useFakeTimers();
    try {
      const promise = gen.generate([makeSlot({ slotId: "timeout" })], { runId: "run_timeout", constraints: {} }, {}, {});
      await vi.advanceTimersByTimeAsync(10);
      const { report } = await promise;

      expect(report.tasks[0].status).toBe(ImageTaskStatus.FAILED);
      expect(report.tasks[0].error).toMatch(/Timed out/);
      expect(provider.generate).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips when circuit breaker is open before execution", async () => {
    const provider = {
      provider: "mock",
      model: "m1",
      generate: vi.fn(),
    };
    const breaker = {
      canExecute: vi.fn(() => false),
      execute: vi.fn(),
    };
    const registry = {
      get: vi.fn(() => breaker),
    };

    const gen = new ImageGenerator({ imageProvider: provider, circuitBreakerRegistry: registry });
    const { report } = await gen.generate([makeSlot({ slotId: "circuit" })], { runId: "run_circuit", constraints: {} }, {}, {});

    expect(report.tasks[0].status).toBe(ImageTaskStatus.SKIPPED);
    expect(report.tasks[0].error).toMatch(/circuit open/i);
    expect(provider.generate).not.toHaveBeenCalled();

    const skipCall = safeEmitMock.mock.calls.find((call) => call[1] === DesignEventsMock.IMAGE_GENERATE_SKIPPED);
    expect(skipCall[3].reason).toBe("circuit_open");
  });

  it("fails when circuit breaker opens during retry", async () => {
    const provider = {
      provider: "mock",
      model: "m1",
      generate: vi.fn(async () => {
        throw new Error("boom");
      }),
    };
    const canExecute = vi
      .fn()
      .mockImplementationOnce(() => true)
      .mockImplementationOnce(() => false);
    const breaker = {
      canExecute,
      execute: vi.fn((fn) => fn()),
    };
    const registry = {
      get: vi.fn(() => breaker),
    };

    const gen = new ImageGenerator({
      imageProvider: provider,
      circuitBreakerRegistry: registry,
      budget: { maxImages: 1, maxCostUSD: 1, maxRetries: 1, candidatesPerSlot: 1 },
    });

    const { report } = await gen.generate([makeSlot({ slotId: "retry" })], { runId: "run_retry", constraints: {} }, {}, {});

    expect(report.tasks[0].status).toBe(ImageTaskStatus.FAILED);
    expect(report.tasks[0].error).toBe("Failed: image provider circuit open during retry");
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(canExecute).toHaveBeenCalledTimes(2);
  });

  it("handles parallel and back-to-back generate calls without cross-talk", async () => {
    const provider = {
      provider: "mock",
      model: "m1",
      generate: vi.fn(async () => ({
        mimeType: "image/png",
        url: "https://example.com/x.png",
        width: 1,
        height: 1,
      })),
    };
    const gen = new ImageGenerator({
      imageProvider: provider,
      concurrency: 0,
      budget: {
        maxImages: Number.MAX_SAFE_INTEGER,
        maxCostUSD: Number.MAX_SAFE_INTEGER,
        candidatesPerSlot: 1,
      },
    });

    const slotsA = [makeSlot({ slotId: "a" }), makeSlot({ slotId: "b" })];
    const slotsB = [makeSlot({ slotId: "c" })];

    const [resA, resB] = await Promise.all([
      gen.generate(slotsA, { runId: "runA", constraints: {} }, {}, {}),
      gen.generate(slotsB, { runId: "runB", constraints: {} }, {}, {}),
    ]);

    expect(resA.report.runId).toBe("runA");
    expect(resB.report.runId).toBe("runB");
    expect(resA.report.tasks).toHaveLength(2);
    expect(resB.report.tasks).toHaveLength(1);

    const resC = await gen.generate(slotsB, { runId: "runC", constraints: {} }, {}, {});
    expect(resC.report.runId).toBe("runC");
    expect(provider.generate).toHaveBeenCalledTimes(4);
  });
});
