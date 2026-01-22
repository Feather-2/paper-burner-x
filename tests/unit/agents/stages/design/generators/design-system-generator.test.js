import { beforeEach, describe, expect, it, vi } from "vitest";

const mockedLogger = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));

const mockedModel = vi.hoisted(() => ({
  getDesignModelCaller: vi.fn(),
}));

vi.mock("../../../../../../js/agents/stages/design/model.js", () => mockedModel);

vi.mock("../../../../../../js/agents/stages/design/generators/design-tokens.js", async () => {
  const actual = await vi.importActual(
    "../../../../../../js/agents/stages/design/generators/design-tokens.js"
  );
  return {
    ...actual,
    generateDesignTokens: vi.fn(actual.generateDesignTokens),
    validateDesignSystem: vi.fn(actual.validateDesignSystem),
  };
});

vi.mock("../../../../../../js/agents/shared/index.js", async () => {
  const actual = await vi.importActual("../../../../../../js/agents/shared/index.js");
  return {
    ...actual,
    createLogger: vi.fn(() => mockedLogger),
    robustParseJson: vi.fn(actual.robustParseJson),
    extractJsonCandidate: vi.fn(actual.extractJsonCandidate),
    isPlainObject: vi.fn(actual.isPlainObject),
  };
});

import { generateDesignSystem } from "../../../../../../js/agents/stages/design/generators/design-system-generator.js";

import { getDesignModelCaller } from "../../../../../../js/agents/stages/design/model.js";
import {
  generateDesignTokens,
  validateDesignSystem,
} from "../../../../../../js/agents/stages/design/generators/design-tokens.js";
import { extractJsonCandidate, robustParseJson } from "../../../../../../js/agents/shared/index.js";

function isPlainObjectValue(value) {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeDeep(base, patch) {
  if (!isPlainObjectValue(base)) return cloneJson(patch);
  if (!isPlainObjectValue(patch)) return cloneJson(base);
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (isPlainObjectValue(v) && isPlainObjectValue(out[k])) out[k] = mergeDeep(out[k], v);
    else out[k] = cloneJson(v);
  }
  return out;
}

const BASE_VALID_SYSTEM = Object.freeze({
  colors: {
    background: { slide: "#ffffff", gradient: "#0ea5e9", panel: "#f8fafc" },
    text: { primary: "#0f172a", secondary: "#334155", muted: "#64748b", inverse: "#ffffff" },
    accent: { primary: "#0ea5e9", secondary: "#22c55e" },
    border: "#e2e8f0",
  },
  typography: {
    fontFamily: "Inter, system-ui, -apple-system",
    scale: { hero: 56, h1: 44, h2: 32, subtitle: 18, body: 16, caption: 12 },
    lineHeight: 1.25,
  },
  spacing: {
    page: { marginX: 6, marginTop: 4, contentStartY: 10 },
    element: { gapX: 8, gapY: 10 },
  },
  layouts: {
    header: { align: "left", heightPct: 12 },
    cover: { titleAlign: "left", hero: true },
    content: { columns: 1, density: "comfortable" },
  },
  components: {
    card: { radius: 12, padding: 16, borderWidth: 1 },
    table: { headerFill: "#f8fafc", borderColor: "#e2e8f0" },
    icon: { style: "outline", size: 20 },
    line: { thickness: 2, color: "#e2e8f0" },
  },
  effects: { shadow: { elevation: 2 }, blur: 0, imageMask: "none", imageRadius: 12 },
  constraints: { minFontSize: 12, maxElementsPerSlide: 18, coordinateUnit: "percent", colorFormat: "hex" },
  theme: "light",
  visualPreference: { mode: "balanced" },
  designTokens: {
    colors: { bg: "#ffffff" },
  },
});

function makeValidSystem(overrides = {}) {
  return mergeDeep(cloneJson(BASE_VALID_SYSTEM), overrides);
}

function makeDeepObject(depth, value) {
  let out = value;
  for (let i = depth; i >= 1; i--) out = { [`level${i}`]: out };
  return out;
}

beforeEach(() => {
  vi.clearAllMocks();
  getDesignModelCaller.mockReturnValue(undefined);
});

describe("generateDesignSystem", () => {
  it("uses model JSON, merges overrides safely, normalizes compat fields, and syncs legacy tokens", async () => {
    const dash = [2, 4];
    const modelSystem = makeValidSystem({
      theme: "  LIGHT  ",
      spacing: { page: { marginX: 8 } },
      designTokens: { colors: { bg: "#0b1220" } },
    });

    const callModel = vi.fn(async () => ({
      content: `<think>ignore</think>\n\`\`\`json\n${JSON.stringify(modelSystem)}\n\`\`\``,
    }));
    getDesignModelCaller.mockReturnValue(callModel);

    const overrides = {
      theme: "AUTO",
      visualPreference: "  SVG-FIRST  ",
      typography: { lineHeight: 1.5 },
      components: { card: { padding: 24, meta: makeDeepObject(6, "ok") }, line: { dash } },
      colors: { accent: { secondary: "#ff0000" } },
    };
    Object.defineProperty(overrides, "__proto__", { value: { polluted: true }, enumerable: true });
    Object.defineProperty(overrides, "constructor", { value: { prototype: { polluted2: true } }, enumerable: true });

    const result = await generateDesignSystem(
      { contentSummary: "summary", tone: "calm", userPreferences: { designSystemOverrides: overrides } },
      { modelRouter: {}, aiApiService: {} }
    );

    expect(getDesignModelCaller).toHaveBeenCalledTimes(1);
    expect(callModel).toHaveBeenCalledTimes(1);
    expect(extractJsonCandidate).toHaveBeenCalledWith(expect.any(String), { prefer: "object" });
    expect(robustParseJson).toHaveBeenCalledTimes(1);

    expect(result.theme).toBe("dark");
    expect(result.visualPreference).toEqual({ mode: "svg-first" });
    expect(result.typography.lineHeight).toBe(1.5);
    expect(result.components.card.padding).toBe(24);
    expect(result.components.card.radius).toBe(12);
    expect(result.colors.accent.secondary).toBe("#ff0000");
    expect(result.components.line.dash).toEqual([2, 4]);
    expect(result.components.line.dash).not.toBe(dash);
    expect(result.components.card.meta.level1.level2.level3.level4.level5.level6).toBe("ok");

    expect(result.designTokens.colors.bg).toBe(result.colors.background.slide);
    expect(result.designTokens.spacing.safeMarginPct).toBe(8);
    expect(result.designTokens.grid.safe).toEqual({ x: "8%", y: "8%", w: "84%", h: "84%" });
    expect(result.designTokens.visualPreference).toEqual({ mode: "svg-first" });

    expect(validateDesignSystem(result).ok).toBe(true);
    expect({}.polluted).toBeUndefined();
    expect({}.polluted2).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(result, "__proto__")).toBe(false);
  });

  it("falls back when model caller is missing", async () => {
    getDesignModelCaller.mockReturnValue(null);

    const result = await generateDesignSystem(undefined, { constraints: { safeMarginPct: 6 } });

    expect(robustParseJson).not.toHaveBeenCalled();
    expect(extractJsonCandidate).not.toHaveBeenCalled();
    expect(generateDesignTokens).toHaveBeenCalledTimes(2);
    expect(validateDesignSystem(result).ok).toBe(true);
  });

  it("retries once on parse failure and succeeds on the second attempt", async () => {
    const recovered = makeValidSystem({ colors: { background: { slide: "#ffeecc" } } });
    const callModel = vi
      .fn()
      .mockResolvedValueOnce({ content: "not-json" })
      .mockResolvedValueOnce({ content: JSON.stringify(recovered) });
    getDesignModelCaller.mockReturnValue(callModel);

    const result = await generateDesignSystem({ tone: "retry" }, { modelRouter: {}, aiApiService: {} });

    expect(callModel).toHaveBeenCalledTimes(2);
    expect(mockedLogger.warn).toHaveBeenCalledTimes(1);
    expect(generateDesignTokens).toHaveBeenCalledTimes(1);
    expect(result.colors.background.slide).toBe("#ffeecc");
    expect(validateDesignSystem(result).ok).toBe(true);
  });

  it("falls back after two model failures and logs warnings", async () => {
    const callModel = vi.fn(async () => {
      throw new Error("boom");
    });
    getDesignModelCaller.mockReturnValue(callModel);

    const result = await generateDesignSystem({ tone: "fail" }, { modelRouter: {}, aiApiService: {} });

    expect(callModel).toHaveBeenCalledTimes(2);
    expect(mockedLogger.warn).toHaveBeenCalledTimes(3);
    expect(robustParseJson).not.toHaveBeenCalled();
    expect(extractJsonCandidate).not.toHaveBeenCalled();
    expect(generateDesignTokens).toHaveBeenCalledTimes(2);
    expect(validateDesignSystem(result).ok).toBe(true);
  });

  it("throws when aborted before starting (string reason)", async () => {
    const controller = new AbortController();
    controller.abort("stop");

    await expect(generateDesignSystem({}, { signal: controller.signal })).rejects.toThrow("stop");
    expect(getDesignModelCaller).not.toHaveBeenCalled();
    expect(generateDesignTokens).not.toHaveBeenCalled();
  });

  it("throws 'Run cancelled' when aborted before starting (non-string reason)", async () => {
    const controller = new AbortController();
    controller.abort(new Error("stop"));

    await expect(generateDesignSystem({}, { signal: controller.signal })).rejects.toThrow("Run cancelled");
    expect(getDesignModelCaller).not.toHaveBeenCalled();
  });

  it("aborts between attempts without falling back", async () => {
    const controller = new AbortController();
    const callModel = vi.fn(async () => {
      controller.abort("stop");
      return { content: "not-json" };
    });
    getDesignModelCaller.mockReturnValue(callModel);

    await expect(
      generateDesignSystem({ tone: "cancel" }, { modelRouter: {}, aiApiService: {}, signal: controller.signal })
    ).rejects.toThrow("stop");

    expect(callModel).toHaveBeenCalledTimes(1);
    expect(mockedLogger.warn).toHaveBeenCalledTimes(1);
    expect(generateDesignTokens).not.toHaveBeenCalled();
  });

  it("throws when overrides introduce invalid types or boundary values", async () => {
    const callModel = vi.fn(async () => ({ content: JSON.stringify(makeValidSystem()) }));
    getDesignModelCaller.mockReturnValue(callModel);

    const cases = [
      { label: "string-as-number", overrides: { spacing: { page: { marginX: "12" } } }, match: /marginX.*number/i },
      { label: "zero", overrides: { spacing: { page: { marginX: 0 } } }, match: /marginX must be >= 5/i },
      { label: "negative", overrides: { spacing: { page: { marginTop: -1 } } }, match: /marginTop must be >= 2/i },
      { label: "max-safe-int", overrides: { typography: { scale: { h1: Number.MAX_SAFE_INTEGER } } }, match: /within 12-80/i },
      { label: "invalid-color", overrides: { colors: { background: { slide: "not-a-color" } } }, match: /invalid_color/i },
    ];

    for (const c of cases) {
      await expect(
        generateDesignSystem({ userPreferences: { designSystemOverrides: c.overrides } }, { modelRouter: {}, aiApiService: {} })
      ).rejects.toThrow(/invalid_design_system_after_overrides/);
      await expect(
        generateDesignSystem({ userPreferences: { designSystemOverrides: c.overrides } }, { modelRouter: {}, aiApiService: {} })
      ).rejects.toThrow(c.match);
    }

    expect(callModel).toHaveBeenCalled();
  });

  it("handles empty inputs and ignores non-object overrides; null input throws in model path", async () => {
    const callModel = vi.fn(async () => ({ content: JSON.stringify(makeValidSystem({ theme: "dark" })) }));
    getDesignModelCaller.mockReturnValue(callModel);

    const okInputs = [undefined, "", [], {}];
    for (const input of okInputs) {
      const result = await generateDesignSystem(input, { modelRouter: {}, aiApiService: {} });
      expect(result.theme).toBe("dark");
    }

    const ignoredOverrides = [undefined, null, "", [], 0, Number.MAX_SAFE_INTEGER];
    for (const designSystemOverrides of ignoredOverrides) {
      const result = await generateDesignSystem(
        { userPreferences: { designSystemOverrides } },
        { modelRouter: {}, aiApiService: {} }
      );
      expect(result.typography.lineHeight).toBe(BASE_VALID_SYSTEM.typography.lineHeight);
    }

    // null input is handled gracefully (falls through to default path)
    const nullResult = await generateDesignSystem(null, { modelRouter: {}, aiApiService: {} });
    expect(nullResult.theme).toBe("dark");
  });

  it("truncates long contentSummary and supports deep nested overrides", async () => {
    const tail = "TAIL-UNIQUE";
    const longSummary = "A".repeat(1600) + tail;
    const deep = makeDeepObject(30, "ok");

    const callModel = vi.fn(async (messages) => {
      return { content: JSON.stringify(makeValidSystem()) };
    });
    getDesignModelCaller.mockReturnValue(callModel);

    const result = await generateDesignSystem({
      contentSummary: longSummary,
      userPreferences: { designSystemOverrides: { components: { card: { meta: deep } } } },
    });

    const prompt = callModel.mock.calls[0][0][1].content;
    expect(prompt).toContain(longSummary.slice(0, 1500));
    expect(prompt).not.toContain(tail);
    expect(result.components.card.meta.level1.level2.level3.level4.level5.level6.level7).toBeDefined();
    expect(result.components.card.meta.level1.level2.level3.level4.level5.level6.level7.level8.level9.level10).toBeDefined();
    expect(result.components.card.meta.level1.level2.level3.level4.level5.level6.level7.level8.level9.level10.level11).toBeDefined();
    expect(result.components.card.meta.level1.level2.level3.level4.level5.level6.level7.level8.level9.level10.level11.level12).toBeDefined();
    expect(result.components.card.meta.level1.level2.level3.level4.level5.level6.level7.level8.level9.level10.level11.level12.level13).toBeDefined();
    expect(result.components.card.meta.level1.level2.level3.level4.level5.level6.level7.level8.level9.level10.level11.level12.level13.level14).toBeDefined();
    expect(result.components.card.meta.level1.level2.level3.level4.level5.level6.level7.level8.level9.level10.level11.level12.level13.level14.level15).toBeDefined();
  });

  it("supports concurrent and rapid consecutive calls independently", async () => {
    const callModel = vi.fn(async (messages) => {
      const prompt = String(messages?.[1]?.content || "");
      if (prompt.includes("tone: one")) return { content: JSON.stringify(makeValidSystem({ colors: { background: { slide: "#111111" } } })) };
      if (prompt.includes("tone: two")) return { content: JSON.stringify(makeValidSystem({ colors: { background: { slide: "#222222" } } })) };
      return { content: JSON.stringify(makeValidSystem({ colors: { background: { slide: "#ffeecc" } } })) };
    });
    getDesignModelCaller.mockReturnValue(callModel);

    const [first, second] = await Promise.all([
      generateDesignSystem({ tone: "one" }, { modelRouter: {}, aiApiService: {} }),
      generateDesignSystem({ tone: "two" }, { modelRouter: {}, aiApiService: {} }),
    ]);

    expect(first.colors.background.slide).toBe("#111111");
    expect(second.colors.background.slide).toBe("#222222");

    const third = await generateDesignSystem(
      { tone: "three", userPreferences: { designSystemOverrides: { typography: { lineHeight: 1.3 } } } },
      { modelRouter: {}, aiApiService: {} }
    );
    const fourth = await generateDesignSystem(
      { tone: "three", userPreferences: { designSystemOverrides: { typography: { lineHeight: 2 } } } },
      { modelRouter: {}, aiApiService: {} }
    );

    expect(third.colors.background.slide).toBe("#ffeecc");
    expect(fourth.colors.background.slide).toBe("#ffeecc");
    expect(third.typography.lineHeight).toBe(1.3);
    expect(fourth.typography.lineHeight).toBe(2);
    expect(callModel).toHaveBeenCalledTimes(4);
  });

  it("clamps extreme legacy token values when falling back", async () => {
    getDesignModelCaller.mockReturnValue(undefined);

    const extremeLegacy = {
      theme: "dark",
      designTokens: {
        colors: {
          bg: "#000000",
          panel: "#111111",
          text: "#222222",
          muted: "#333333",
          border: "#444444",
          primary: "#555555",
          accent: "#666666",
        },
        typography: {
          fontFamily: "Test",
          minFont: -1,
          titleFont: Number.MAX_SAFE_INTEGER,
          subtitleFont: -1,
          bodyFont: "16",
          smallFont: 0,
        },
        spacing: { safeMarginPct: -1, base: 0 },
        grid: { aspect: "16:9", columns: 12, gutterPct: 2, safe: { x: "0%", y: "0%", w: "100%", h: "100%" } },
      },
    };

    generateDesignTokens.mockImplementationOnce(() => cloneJson(extremeLegacy));
    generateDesignTokens.mockImplementationOnce(() => cloneJson(extremeLegacy));

    const result = await generateDesignSystem(undefined, { constraints: { safeMarginPct: 0 } });

    expect(result.theme).toBe("dark");
    expect(result.spacing.page.marginX).toBe(5);
    expect(result.spacing.page.marginTop).toBe(3);
    expect(result.spacing.element.gapX).toBe(4);
    expect(result.spacing.element.gapY).toBe(4);
    expect(result.typography.scale.hero).toBe(80);
    expect(result.typography.scale.subtitle).toBe(12);
    expect(result.typography.scale.body).toBe(16);
    expect(result.constraints.minFontSize).toBe(12);
    expect(validateDesignSystem(result).ok).toBe(true);
  });
});
