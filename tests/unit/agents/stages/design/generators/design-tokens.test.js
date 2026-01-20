import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../../js/agents/shared/index.js", () => {
  return {
    isPlainObject: vi.fn((value) => {
      if (!value || typeof value !== "object") return false;
      if (Array.isArray(value)) return false;
      const proto = Object.getPrototypeOf(value);
      return proto === Object.prototype || proto === null;
    }),
  };
});

import {
  generateDesignTokens,
  validateDesignSystem,
} from "../../../../../../js/agents/stages/design/generators/design-tokens.js";

function buildValidSystem() {
  return {
    colors: {
      background: {
        slide: "#ffffff",
        gradient: "#f8fafc",
        panel: "#ffffff",
      },
      text: {
        primary: "#111111",
        secondary: "#222222",
        muted: "#333333",
        inverse: "#ffffff",
      },
      accent: {
        primary: "#0ea5e9",
        secondary: "#22c55e",
      },
      border: "#e2e8f0",
    },
    typography: {
      fontFamily: "Inter",
      scale: {
        hero: 60,
        h1: 44,
        h2: 32,
        subtitle: 18,
        body: 16,
        caption: 12,
      },
      lineHeight: 1.4,
    },
    spacing: {
      page: { marginX: 6, marginTop: 3, contentStartY: 10 },
      element: { gapX: 8, gapY: 8 },
    },
    layouts: { header: {}, cover: {}, content: {} },
    components: { card: {}, table: {}, icon: {}, line: {} },
    effects: { shadow: {}, blur: {}, imageMask: {}, imageRadius: 8 },
    constraints: {
      minFontSize: 12,
      maxElementsPerSlide: 20,
      coordinateUnit: "percent",
      colorFormat: "hex",
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generateDesignTokens", () => {
  it("resolves theme and applies palette", () => {
    const dark = generateDesignTokens({ theme: "dark", safeMarginPct: 3 });
    expect(dark.theme).toBe("dark");
    expect(dark.designTokens.colors.bg).toBe("#0b1220");
    expect(dark.designTokens.spacing.safeMarginPct).toBe(3);
    expect(dark.designTokens.grid.safe).toEqual({
      x: "3%",
      y: "3%",
      w: "94%",
      h: "94%",
    });
    expect(dark.visualPreference).toEqual({ mode: "balanced" });
    expect(dark.designTokens.visualPreference).toEqual({ mode: "balanced" });
  });

  it("clamps safeMarginPct and respects fallback inputs", () => {
    const invalidTheme = generateDesignTokens({ theme: "nope", safeMarginPct: 2 });
    expect(invalidTheme.theme).toBe("light");
    expect(invalidTheme.designTokens.spacing.safeMarginPct).toBe(3);

    const fromSafeMargin = generateDesignTokens({ safeMargin: 9 });
    expect(fromSafeMargin.designTokens.spacing.safeMarginPct).toBe(9);

    const clampedHigh = generateDesignTokens({ safeMarginPct: 99 });
    expect(clampedHigh.designTokens.spacing.safeMarginPct).toBe(12);

    const fallback = generateDesignTokens({ safeMarginPct: "not-a-number" });
    expect(fallback.designTokens.spacing.safeMarginPct).toBe(6);
  });

  it("handles non-object constraints by falling back to defaults", () => {
    const result = generateDesignTokens(null);
    expect(result.theme).toBe("light");
    expect(result.designTokens.spacing.safeMarginPct).toBe(6);
  });
});

describe("validateDesignSystem", () => {
  it("rejects non-object inputs", () => {
    const inputs = [null, undefined, "", [], 0];
    for (const value of inputs) {
      expect(validateDesignSystem(value)).toEqual({
        ok: false,
        errors: ["system must be an object"],
      });
    }
  });

  it("reports missing required paths for empty object", () => {
    const result = validateDesignSystem({});
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "missing:colors.background.slide",
        "missing:constraints.minFontSize",
      ])
    );
  });

  it("accepts a valid system with rgba colors and visualPreference", () => {
    const system = buildValidSystem();
    system.colors.text.primary = "rgba(0,128,255,0.5)";
    system.constraints.coordinateUnit = "PERCENT";
    system.constraints.colorFormat = "RGBA";
    system.visualPreference = { mode: "ai-first" };

    const result = validateDesignSystem(system);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("allows visualPreference to be null", () => {
    const system = buildValidSystem();
    system.visualPreference = null;
    const result = validateDesignSystem(system);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("validates minFontSize types and bounds", () => {
    const cases = [
      { value: "16", error: "constraints.minFontSize must be a number" },
      { value: 0, error: "constraints.minFontSize must be >= 12" },
      { value: -1, error: "constraints.minFontSize must be >= 12" },
      {
        value: Number.MAX_SAFE_INTEGER,
        error: "constraints.minFontSize must be within 12-80",
      },
    ];

    for (const { value, error } of cases) {
      const system = buildValidSystem();
      system.constraints.minFontSize = value;
      const result = validateDesignSystem(system);
      expect(result.ok).toBe(false);
      expect(result.errors).toContain(error);
    }
  });

  it("validates typography.scale types and ranges", () => {
    const badScale = buildValidSystem();
    badScale.typography.scale = "nope";
    const badScaleResult = validateDesignSystem(badScale);
    expect(badScaleResult.errors).toContain("typography.scale must be an object");

    const rangeSystem = buildValidSystem();
    rangeSystem.constraints.minFontSize = 16;
    rangeSystem.typography.scale.caption = 12;
    rangeSystem.typography.scale.h1 = 81;
    rangeSystem.typography.scale.body = "14";

    const rangeResult = validateDesignSystem(rangeSystem);
    expect(rangeResult.errors).toEqual(
      expect.arrayContaining([
        "typography.scale.caption must be >= minFontSize",
        "typography.scale.h1 must be within 12-80",
        "typography.scale.body must be a number",
      ])
    );
  });

  it("validates fontFamily and lineHeight types", () => {
    const system = buildValidSystem();
    system.typography.fontFamily = "   ";
    system.typography.lineHeight = "1.4";

    const result = validateDesignSystem(system);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "typography.fontFamily must be a non-empty string",
        "typography.lineHeight must be a number",
      ])
    );
  });

  it("validates spacing margins bounds", () => {
    const system = buildValidSystem();
    system.spacing.page.marginX = 0;
    system.spacing.page.marginTop = -1;

    const result = validateDesignSystem(system);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "spacing.page.marginX must be >= 5",
        "spacing.page.marginTop must be >= 2",
      ])
    );
  });

  it("flags non-number margins", () => {
    const system = buildValidSystem();
    system.spacing.page.marginX = {};
    system.spacing.page.marginTop = [];

    const result = validateDesignSystem(system);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "spacing.page.marginX must be a number",
        "spacing.page.marginTop must be a number",
      ])
    );
  });

  it("validates coordinateUnit and colorFormat strings", () => {
    const emptySystem = buildValidSystem();
    emptySystem.constraints.coordinateUnit = "   ";
    emptySystem.constraints.colorFormat = "";
    const emptyResult = validateDesignSystem(emptySystem);
    expect(emptyResult.errors).toEqual(
      expect.arrayContaining([
        "constraints.coordinateUnit must be a string",
        "constraints.colorFormat must be a string",
      ])
    );

    const invalidSystem = buildValidSystem();
    invalidSystem.constraints.coordinateUnit = "px";
    invalidSystem.constraints.colorFormat = "hsl";
    const invalidResult = validateDesignSystem(invalidSystem);
    expect(invalidResult.errors).toEqual(
      expect.arrayContaining([
        "constraints.coordinateUnit must be 'percent'",
        "constraints.colorFormat must be 'hex' or 'rgba'",
      ])
    );
  });

  it("validates colors structure and tokens", () => {
    const arraySystem = buildValidSystem();
    arraySystem.colors = [];
    const arrayResult = validateDesignSystem(arraySystem);
    expect(arrayResult.errors).toEqual(
      expect.arrayContaining([
        "colors must be an object",
        "missing:colors.background.slide",
      ])
    );

    const emptySystem = buildValidSystem();
    emptySystem.colors = {};
    const emptyResult = validateDesignSystem(emptySystem);
    expect(emptyResult.errors).toContain("colors must contain color strings");

    const invalidSystem = buildValidSystem();
    invalidSystem.colors.background.slide = "not-a-color";
    invalidSystem.colors.text.secondary = "rgba(256,0,0,1)";
    invalidSystem.colors.accent.secondary = "#12";
    const invalidResult = validateDesignSystem(invalidSystem);
    expect(invalidResult.errors).toEqual(
      expect.arrayContaining([
        "invalid_color:not-a-color",
        "invalid_color:rgba(256,0,0,1)",
        "invalid_color:#12",
      ])
    );
  });

  it("validates visualPreference type and mode", () => {
    const typeSystem = buildValidSystem();
    typeSystem.visualPreference = [];
    const typeResult = validateDesignSystem(typeSystem);
    expect(typeResult.errors).toContain("visualPreference must be an object");

    const modeSystem = buildValidSystem();
    modeSystem.visualPreference = { mode: "wrong" };
    const modeResult = validateDesignSystem(modeSystem);
    expect(modeResult.errors).toContain(
      "visualPreference.mode must be 'ai-first' | 'svg-first' | 'balanced'"
    );
  });

  it("supports concurrent calls without shared state", async () => {
    const system = buildValidSystem();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => Promise.resolve(validateDesignSystem(system)))
    );
    expect(results.every((result) => result.ok)).toBe(true);
    expect(results.every((result) => result.errors.length === 0)).toBe(true);
    expect(new Set(results.map((result) => result.errors)).size).toBe(results.length);
  });

  it("stays consistent across rapid sequential calls", () => {
    const valid = buildValidSystem();
    const invalid = buildValidSystem();
    invalid.constraints.minFontSize = 0;

    const outputs = [];
    for (let i = 0; i < 20; i += 1) {
      outputs.push(validateDesignSystem(i % 2 === 0 ? valid : invalid));
    }

    expect(outputs.filter((result) => result.ok).length).toBe(10);
    expect(outputs.filter((result) => !result.ok).length).toBe(10);
  });

  it("handles large inputs with deep nesting", () => {
    const system = buildValidSystem();
    system.typography.fontFamily = "A".repeat(10000);
    system.colors.palette = Array.from({ length: 1000 }, () => "#123456");

    const deep = {};
    let cursor = deep;
    for (let i = 0; i < 30; i += 1) {
      cursor.next = {};
      cursor = cursor.next;
    }
    cursor.values = ["#abcdef", "rgba(0,0,0,0.4)"];
    system.colors.deep = deep;

    const result = validateDesignSystem(system);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });
});
