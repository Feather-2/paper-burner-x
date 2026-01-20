import { beforeEach, describe, expect, it, vi } from "vitest";

const mockedDesignTokens = vi.hoisted(() => ({
  generateDesignTokens: vi.fn(),
  validateDesignSystem: vi.fn(),
}));

const mockedModel = vi.hoisted(() => ({
  getDesignModelCaller: vi.fn(),
}));

const mockedShared = vi.hoisted(() => ({
  robustParseJson: vi.fn(),
  extractJsonCandidate: vi.fn(),
  createLogger: vi.fn(),
  isPlainObject: vi.fn(),
}));

vi.mock("../../../../../../js/agents/stages/design/generators/design-tokens.js", () => mockedDesignTokens);
vi.mock("../../../../../../js/agents/stages/design/model.js", () => mockedModel);
vi.mock("../../../../../../js/agents/shared/index.js", () => mockedShared);

function isPlainObject(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

const BASE_SYSTEM = {
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
  layouts: { header: { align: "left" }, cover: { titleAlign: "left" }, content: { columns: 1 } },
  components: { card: { radius: 12, padding: 16 }, table: { headerFill: "#f8fafc" }, icon: { style: "outline" }, line: { thickness: 2 } },
  effects: { shadow: { elevation: 2 }, blur: 0, imageMask: "none", imageRadius: 12 },
  constraints: { minFontSize: 12, maxElementsPerSlide: 18, coordinateUnit: "percent", colorFormat: "hex" },
  theme: "light",
  visualPreference: { mode: "balanced" },
  designTokens: {
    colors: {
      bg: "#ffffff",
      panel: "#f8fafc",
      text: "#0f172a",
      muted: "#64748b",
      border: "#e2e8f0",
      primary: "#0ea5e9",
      accent: "#22c55e",
    },
    typography: { fontFamily: "Inter, system-ui, -apple-system", minFont: 12, titleFont: 44, subtitleFont: 18, bodyFont: 16, smallFont: 12 },
    spacing: { safeMarginPct: 6, base: 8 },
    grid: { aspect: "16:9", columns: 12, gutterPct: 2, safe: { x: "6%", y: "6%", w: "88%", h: "88%" } },
    visualPreference: { mode: "balanced" },
  },
};

const DEFAULT_LEGACY = {
  theme: "light",
  visualPreference: { mode: "balanced" },
  designTokens: {
    colors: {
      bg: "#ffffff",
      panel: "#f8fafc",
      text: "#0f172a",
      muted: "#64748b",
      border: "#e2e8f0",
      primary: "#0ea5e9",
      accent: "#22c55e",
    },
    typography: { fontFamily: "Inter, system-ui, -apple-system", minFont: 12, titleFont: 44, subtitleFont: 18, bodyFont: 16, smallFont: 12 },
    spacing: { safeMarginPct: 6, base: 8 },
    grid: { aspect: "16:9", columns: 12, gutterPct: 2, safe: { x: "6%", y: "6%", w: "88%", h: "88%" } },
    visualPreference: { mode: "balanced" },
  },
};

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeDeep(target, source) {
  if (!isPlainObject(source)) return target;
  for (const [key, value] of Object.entries(source)) {
    if (isPlainObject(value)) {
      const base = isPlainObject(target[key]) ? target[key] : {};
      target[key] = mergeDeep({ ...base }, value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

function createDesignSystem(overrides = {}) {
  return mergeDeep(cloneJson(BASE_SYSTEM), overrides);
}

let generateDesignSystem;
let loggerWarn;

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();

  loggerWarn = vi.fn();
  mockedShared.createLogger.mockReturnValue({ warn: loggerWarn });
  mockedShared.isPlainObject.mockImplementation(isPlainObject);
  mockedShared.extractJsonCandidate.mockImplementation((value) => value);
  mockedShared.robustParseJson.mockImplementation((value) => {
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  });

  mockedDesignTokens.generateDesignTokens.mockImplementation(() => cloneJson(DEFAULT_LEGACY));
  mockedDesignTokens.validateDesignSystem.mockImplementation((system) => {
    if (!isPlainObject(system)) return { ok: false, errors: ["system must be an object"] };
    return { ok: true, errors: [] };
  });

  mockedModel.getDesignModelCaller.mockReturnValue(undefined);

  generateDesignSystem = (await import("../../../../../../js/agents/stages/design/generators/design-system-generator.js"))
    .generateDesignSystem;
});

describe("generateDesignSystem", () => {
  it("merges overrides, normalizes theme/visualPreference, and syncs legacy tokens", async () => {
    const callModel = vi.fn(async () => ({
      content: JSON.stringify(
        createDesignSystem({
          theme: "  LIGHT  ",
          spacing: { page: { marginX: 8 } },
          components: { card: { radius: 10, padding: 12 } },
        })
      ),
    }));
    mockedModel.getDesignModelCaller.mockReturnValue(callModel);

    const overrides = {
      visualPreference: "SVG-FIRST",
      typography: { lineHeight: 1.5 },
      components: { card: { padding: 24 }, line: { dash: [2, 4] } },
      colors: { accent: { secondary: "#ff0000" } },
      ["__proto__"]: { polluted: true },
    };

    const result = await generateDesignSystem(
      { contentSummary: "summary", tone: "calm", userPreferences: { designSystemOverrides: overrides } },
      { modelRouter: {}, aiApiService: {} }
    );

    expect(callModel).toHaveBeenCalledTimes(1);
    expect(result.theme).toBe("light");
    expect(result.visualPreference).toEqual({ mode: "svg-first" });
    expect(result.typography.lineHeight).toBe(1.5);
    expect(result.components.card.padding).toBe(24);
    expect(result.components.card.radius).toBe(10);
    expect(result.colors.accent.secondary).toBe("#ff0000");
    expect(result.components.line.dash).toEqual([2, 4]);
    expect(result.designTokens.colors.bg).toBe(result.colors.background.slide);
    expect(result.designTokens.spacing.safeMarginPct).toBe(8);
    expect({}.polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(result, "__proto__")).toBe(false);
  });

  it("falls back to legacy tokens and clamps boundary values", async () => {
    mockedDesignTokens.generateDesignTokens.mockReturnValue({
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
    });

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
  });

  it("throws when aborted before starting", async () => {
    const controller = new AbortController();
    controller.abort("stop");

    await expect(generateDesignSystem({}, { signal: controller.signal })).rejects.toThrow("stop");
    expect(mockedModel.getDesignModelCaller).not.toHaveBeenCalled();
  });

  it("retries on parse failure and falls back with warnings", async () => {
    const callModel = vi.fn(async () => ({ content: "not-json" }));
    mockedModel.getDesignModelCaller.mockReturnValue(callModel);
    mockedShared.robustParseJson.mockReturnValue(null);

    const result = await generateDesignSystem(
      { contentSummary: "", tone: "", extractedPalette: {}, userPreferences: {} },
      { modelRouter: {}, aiApiService: {} }
    );

    expect(callModel).toHaveBeenCalledTimes(2);
    expect(loggerWarn).toHaveBeenCalledTimes(3);
    expect(mockedDesignTokens.generateDesignTokens).toHaveBeenCalledTimes(2);
    expect(result.designTokens).toBeTruthy();
  });

  it("throws when overrides introduce invalid types", async () => {
    mockedDesignTokens.validateDesignSystem.mockImplementation((system) => {
      if (!isPlainObject(system)) return { ok: false, errors: ["system must be an object"] };
      const marginX = system?.spacing?.page?.marginX;
      if (typeof marginX === "string") return { ok: false, errors: ["spacing.page.marginX must be a number"] };
      return { ok: true, errors: [] };
    });

    const callModel = vi.fn(async () => ({ content: JSON.stringify(createDesignSystem()) }));
    mockedModel.getDesignModelCaller.mockReturnValue(callModel);

    await expect(
      generateDesignSystem({
        userPreferences: { designSystemOverrides: { spacing: { page: { marginX: "12" } } } },
      })
    ).rejects.toThrow("invalid_design_system_after_overrides");
  });

  it("handles null/undefined inputs and ignores array overrides", async () => {
    const callModel = vi.fn(async () => ({ content: JSON.stringify(createDesignSystem({ theme: "dark" })) }));
    mockedModel.getDesignModelCaller.mockReturnValue(callModel);

    const resultNull = await generateDesignSystem(null, {});
    const resultUndefined = await generateDesignSystem(undefined, undefined);
    const resultArrayOverride = await generateDesignSystem(
      { contentSummary: "", tone: "", extractedPalette: {}, userPreferences: { designSystemOverrides: [] } },
      undefined
    );

    expect(resultNull.theme).toBe("dark");
    expect(resultUndefined.theme).toBe("dark");
    expect(resultArrayOverride.typography.lineHeight).toBe(BASE_SYSTEM.typography.lineHeight);
  });

  it("truncates long contentSummary and merges deep overrides", async () => {
    const tail = "TAIL-UNIQUE";
    const longSummary = "A".repeat(1600) + tail;

    const callModel = vi.fn(async () => ({ content: JSON.stringify(createDesignSystem()) }));
    mockedModel.getDesignModelCaller.mockReturnValue(callModel);

    const result = await generateDesignSystem({
      contentSummary: longSummary,
      userPreferences: {
        designSystemOverrides: {
          components: { card: { meta: { level1: { level2: { level3: "ok" } } } } },
        },
      },
    });

    const prompt = callModel.mock.calls[0][0][1].content;
    expect(prompt).toContain(longSummary.slice(0, 1500));
    expect(prompt).not.toContain(tail);
    expect(result.components.card.meta.level1.level2.level3).toBe("ok");
  });

  it("supports concurrent and rapid consecutive calls independently", async () => {
    const system1 = createDesignSystem({
      theme: "dark",
      colors: { background: { slide: "#111111" } },
      designTokens: { colors: { bg: "#0b1220" } },
    });
    const system2 = createDesignSystem({
      theme: "light",
      colors: { background: { slide: "#ffffff" } },
      designTokens: { colors: { bg: "#ffffff" } },
    });
    const system3 = createDesignSystem({
      theme: "light",
      colors: { background: { slide: "#ffeecc" } },
      designTokens: { colors: { bg: "#ffeecc" } },
    });

    const callModel = vi
      .fn()
      .mockResolvedValueOnce({ content: JSON.stringify(system1) })
      .mockResolvedValueOnce({ content: JSON.stringify(system2) })
      .mockResolvedValue({ content: JSON.stringify(system3) });
    mockedModel.getDesignModelCaller.mockReturnValue(callModel);

    const [first, second] = await Promise.all([
      generateDesignSystem({ tone: "one" }, {}),
      generateDesignSystem({ tone: "two" }, {}),
    ]);

    expect(first.colors.background.slide).toBe("#111111");
    expect(second.colors.background.slide).toBe("#ffffff");

    const third = await generateDesignSystem({
      userPreferences: { designSystemOverrides: { typography: { lineHeight: 1.3 } } },
    });
    const fourth = await generateDesignSystem({
      userPreferences: { designSystemOverrides: { typography: { lineHeight: 2 } } },
    });

    expect(third.typography.lineHeight).toBe(1.3);
    expect(fourth.typography.lineHeight).toBe(2);
    expect(third.colors.background.slide).toBe("#ffeecc");
    expect(fourth.colors.background.slide).toBe("#ffeecc");
    expect(callModel).toHaveBeenCalledTimes(4);
  });
});
