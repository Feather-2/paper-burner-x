import { describe, it, expect, vi, beforeEach } from "vitest";

const runtimeMock = vi.hoisted(() => {
  class UnifiedAgentContext {
    constructor(options = {}) {
      this.runId = options.runId || "";
      this.options = options;
      UnifiedAgentContext.calls.push(options);
    }
  }

  UnifiedAgentContext.calls = [];

  return { UnifiedAgentContext };
});

vi.mock("../../../../../../js/agents/runtime/index.js", () => runtimeMock);

import { DesignContext, createDesignContext } from "../../../../../../js/agents/stages/design/internal/design-context.js";

const { UnifiedAgentContext } = runtimeMock;

const createDeepObject = (depth) => {
  let current = { level: depth };
  for (let i = depth - 1; i >= 0; i -= 1) {
    current = { level: i, child: current };
  }
  return current;
};

describe("DesignContext", () => {
  beforeEach(() => {
    UnifiedAgentContext.calls = [];
  });

  it("initializes defaults for falsy options and calls base constructor", () => {
    const options = {
      runId: "run-1",
      slideIntents: null,
      designSystem: 0,
      imageSlots: undefined,
      deckHtmlDsl: "",
      slidesMeta: null,
      constraints: 0,
      userConfig: "",
    };

    const context = new DesignContext(options);

    expect(UnifiedAgentContext.calls).toEqual([options]);
    expect(context.runId).toBe("run-1");
    expect(context.slideIntents).toEqual([]);
    expect(context.designSystem).toBe(null);
    expect(context.imageSlots).toEqual([]);
    expect(context.deckHtmlDsl).toBe("");
    expect(context.slidesMeta).toEqual([]);
    expect(context.constraints).toEqual({});
    expect(context.userConfig).toEqual({});
  });

  it("sanitizes slide intents and keeps slideCount in sync", () => {
    const context = new DesignContext();

    context.setSlideIntents([{ id: 1 }, { id: 2 }]);
    expect(context.slideIntents).toEqual([{ id: 1 }, { id: 2 }]);
    expect(context.slideCount).toBe(2);

    context.setSlideIntents([]);
    expect(context.slideIntents).toEqual([]);
    expect(context.slideCount).toBe(0);

    context.setSlideIntents({});
    expect(context.slideIntents).toEqual([]);
    expect(context.slideCount).toBe(0);

    expect(() => context.setSlideIntents(null)).not.toThrow();
    expect(() => context.setSlideIntents(undefined)).not.toThrow();
    expect(() => context.setSlideIntents("1")).not.toThrow();
  });

  it("handles design system values and exposes tokens/theme", () => {
    const context = new DesignContext();

    context.setDesignSystem({ designTokens: { color: "red" }, theme: "light" });
    expect(context.designSystem).toEqual({ designTokens: { color: "red" }, theme: "light" });
    expect(context.designTokens).toEqual({ color: "red" });
    expect(context.theme).toBe("light");

    context.setDesignSystem(0);
    expect(context.designSystem).toBe(null);
    expect(context.designTokens).toBe(null);
    expect(context.theme).toBe(null);

    context.setDesignSystem("");
    expect(context.designSystem).toBe(null);

    context.setDesignSystem("   ");
    expect(context.designSystem).toBe("   ");
    expect(context.designTokens).toBe(null);
    expect(context.theme).toBe(null);
  });

  it("manages image slots and merges updates with boundary ids", () => {
    const context = new DesignContext();

    context.setImageSlots({});
    expect(context.imageSlots).toEqual([]);

    const slots = [
      { slotId: 0, url: "zero" },
      { slotId: -1, url: "minus" },
      { slotId: Number.MAX_SAFE_INTEGER, url: "max" },
      { slotId: "  ", url: "space" },
    ];

    context.setImageSlots(slots);
    context.updateImageSlot(0, { url: "zero-2", note: "n" });
    context.updateImageSlot(-1, { url: "minus-2" });
    context.updateImageSlot(Number.MAX_SAFE_INTEGER, { meta: { size: 1 } });
    context.updateImageSlot("  ", { url: "space-2" });
    context.updateImageSlot("0", { url: "wrong" });
    context.updateImageSlot(999, { url: "missing" });

    expect(context.imageSlots).toEqual([
      { slotId: 0, url: "zero-2", note: "n" },
      { slotId: -1, url: "minus-2" },
      { slotId: Number.MAX_SAFE_INTEGER, url: "max", meta: { size: 1 } },
      { slotId: "  ", url: "space-2" },
    ]);
  });

  it("supports rapid and concurrent image slot updates", async () => {
    const context = new DesignContext();

    context.setImageSlots([{ slotId: 1, url: "start" }]);

    for (let i = 0; i < 5; i += 1) {
      context.updateImageSlot(1, { seq: i });
    }

    expect(context.imageSlots[0].seq).toBe(4);

    await Promise.all([
      Promise.resolve().then(() => context.updateImageSlot(1, { url: "first" })),
      Promise.resolve().then(() => context.updateImageSlot(1, { url: "second" })),
    ]);

    expect(context.imageSlots[0].url).toBe("second");
    expect(() => context.updateImageSlot(1, null)).not.toThrow();
  });

  it("sanitizes deckHtmlDsl and handles large payloads and concurrent calls", async () => {
    const context = new DesignContext();

    context.setDeckHtmlDsl(0);
    expect(context.deckHtmlDsl).toBe("");

    context.setDeckHtmlDsl(-1);
    expect(context.deckHtmlDsl).toBe("");

    context.setDeckHtmlDsl("   ");
    expect(context.deckHtmlDsl).toBe("   ");

    const hugeHtml = "x".repeat(100000);
    context.setDeckHtmlDsl(hugeHtml);
    expect(context.deckHtmlDsl.length).toBe(hugeHtml.length);

    await Promise.all([
      Promise.resolve().then(() => context.setDeckHtmlDsl("first")),
      Promise.resolve().then(() => context.setDeckHtmlDsl("second")),
    ]);

    expect(context.deckHtmlDsl).toBe("second");
    expect(() => context.setDeckHtmlDsl({})).not.toThrow();
  });

  it("sanitizes slidesMeta and accepts large arrays", () => {
    const context = new DesignContext();

    context.setSlidesMeta([{ id: 1 }]);
    expect(context.slidesMeta).toEqual([{ id: 1 }]);

    context.setSlidesMeta([]);
    expect(context.slidesMeta).toEqual([]);

    context.setSlidesMeta({});
    expect(context.slidesMeta).toEqual([]);

    expect(() => context.setSlidesMeta("invalid")).not.toThrow();

    const largeMeta = Array.from({ length: 5000 }, (_, index) => ({ index }));
    context.setSlidesMeta(largeMeta);
    expect(context.slidesMeta).toHaveLength(5000);
  });

  it("handles constraints/userConfig defaults and deep nesting", () => {
    const context = new DesignContext();
    const deepConstraints = createDeepObject(25);
    const deepConfig = { features: createDeepObject(10) };

    context.setConstraints(deepConstraints);
    context.setUserConfig(deepConfig);
    expect(context.constraints).toBe(deepConstraints);
    expect(context.userConfig).toBe(deepConfig);

    context.setConstraints(null);
    context.setUserConfig(undefined);
    expect(context.constraints).toEqual({});
    expect(context.userConfig).toEqual({});

    context.setConstraints({});
    context.setUserConfig({});
    expect(context.constraints).toEqual({});
    expect(context.userConfig).toEqual({});
  });

  it("creates snapshots from current state", () => {
    const context = new DesignContext({
      runId: "snapshot-run",
      slideIntents: [{ id: "s1" }],
      designSystem: { theme: "t1" },
      imageSlots: [{ slotId: 7 }],
      deckHtmlDsl: "html",
      slidesMeta: [{ title: "a" }],
      constraints: { maxSlides: 10 },
      userConfig: { locale: "en" },
    });

    const snapshot = context.toSnapshot();

    expect(snapshot).toEqual({
      runId: "snapshot-run",
      slideIntents: [{ id: "s1" }],
      designSystem: { theme: "t1" },
      imageSlots: [{ slotId: 7 }],
      deckHtmlDsl: "html",
      slidesMeta: [{ title: "a" }],
      constraints: { maxSlides: 10 },
      userConfig: { locale: "en" },
    });
  });

  it("builds from snapshot with snapshot taking precedence over options", () => {
    const snapshot = {
      runId: "snap-1",
      slideIntents: [{ id: 1 }],
      designSystem: { theme: "dark" },
      imageSlots: [{ slotId: 2 }],
      deckHtmlDsl: "dsl",
      slidesMeta: [{ id: "meta" }],
      constraints: { max: 1 },
      userConfig: { locale: "fr" },
    };

    const context = DesignContext.fromSnapshot(snapshot, {
      runId: "override",
      slideIntents: [{ id: 999 }],
      deckHtmlDsl: "override",
      constraints: { max: 999 },
    });

    expect(context).toBeInstanceOf(DesignContext);
    expect(context.runId).toBe("snap-1");
    expect(context.slideIntents).toEqual([{ id: 1 }]);
    expect(context.designSystem).toEqual({ theme: "dark" });
    expect(context.imageSlots).toEqual([{ slotId: 2 }]);
    expect(context.deckHtmlDsl).toBe("dsl");
    expect(context.slidesMeta).toEqual([{ id: "meta" }]);
    expect(context.constraints).toEqual({ max: 1 });
    expect(context.userConfig).toEqual({ locale: "fr" });
  });
});

describe("createDesignContext", () => {
  beforeEach(() => {
    UnifiedAgentContext.calls = [];
  });

  it("creates a DesignContext instance with provided options", () => {
    const first = createDesignContext({ runId: "ctx-1" });
    const second = createDesignContext();

    expect(first).toBeInstanceOf(DesignContext);
    expect(second).toBeInstanceOf(DesignContext);
    expect(first).not.toBe(second);
    expect(first.runId).toBe("ctx-1");
    expect(UnifiedAgentContext.calls).toHaveLength(2);
  });
});
