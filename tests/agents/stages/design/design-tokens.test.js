import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../js/agents/shared/utils/value-utils.js", () => {
  return {
    // Keep semantics close enough for unit tests; implementation is not under test here.
    isPlainObject: vi.fn((v) => Boolean(v) && typeof v === "object" && !Array.isArray(v)),
  };
});

import { isPlainObject } from "../../../../js/agents/shared/utils/value-utils.js";
import { generateDesignTokens, validateDesignSystem } from "../../../../js/agents/stages/design/generators/design-tokens.js";

function buildValidSystem(overrides = {}) {
  const base = {
    colors: {
      background: { slide: "#ffffff", gradient: "#ffffff", panel: "#ffffff" },
      text: { primary: "#111111", secondary: "#222222", muted: "#333333", inverse: "#ffffff" },
      accent: { primary: "#0ea5e9", secondary: "#22c55e" },
      border: "#e2e8f0",
    },
    typography: {
      fontFamily: "Arial",
      scale: { hero: 60, h1: 44, h2: 32, subtitle: 18, body: 16, caption: 12 },
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
  return { ...base, ...overrides };
}

describe("design/generators/design-tokens", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("generateDesignTokens normalizes theme and clamps safeMarginPct (normal + edge cases)", () => {
    const dark = generateDesignTokens({ theme: "dark", safeMarginPct: 3 });
    expect(dark.theme).toBe("dark");
    expect(dark.designTokens.colors.bg).toBe("#0b1220");
    expect(dark.designTokens.spacing.safeMarginPct).toBe(3);

    const auto = generateDesignTokens({ theme: "auto" });
    expect(auto.theme).toBe("light");

    const invalidTheme = generateDesignTokens({ theme: "nope" });
    expect(invalidTheme.theme).toBe("light");

    const clampedLow = generateDesignTokens({ safeMargin: 2 });
    expect(clampedLow.designTokens.spacing.safeMarginPct).toBe(3);

    const clampedHigh = generateDesignTokens({ safeMarginPct: 99 });
    expect(clampedHigh.designTokens.spacing.safeMarginPct).toBe(12);

    // External dep is mocked, but should still be invoked by validateDesignSystem().
    expect(isPlainObject).toBeTypeOf("function");
  });

  it("validateDesignSystem rejects non-objects and reports missing required paths", () => {
    expect(validateDesignSystem(null)).toEqual({ ok: false, errors: ["system must be an object"] });

    const out = validateDesignSystem({});
    expect(out.ok).toBe(false);
    expect(out.errors).toEqual(expect.arrayContaining(["missing:colors.background.slide", "missing:constraints.minFontSize"]));
  });

  it("validateDesignSystem accepts a fully populated valid system", () => {
    const out = validateDesignSystem(buildValidSystem());
    expect(out.ok).toBe(true);
    expect(out.errors).toEqual([]);
  });

  it("validateDesignSystem flags invalid constraints/colors/visualPreference (edge cases)", () => {
    const badMinFont = validateDesignSystem(buildValidSystem({ constraints: { ...buildValidSystem().constraints, minFontSize: 10 } }));
    expect(badMinFont.ok).toBe(false);
    expect(badMinFont.errors.join("\n")).toContain("minFontSize");

    const badScale = validateDesignSystem(
      buildValidSystem({
        constraints: { ...buildValidSystem().constraints, minFontSize: 16 },
        typography: { ...buildValidSystem().typography, scale: { ...buildValidSystem().typography.scale, caption: 12 } },
      })
    );
    expect(badScale.ok).toBe(false);
    expect(badScale.errors.join("\n")).toContain("typography.scale.caption must be >= minFontSize");

    const badUnit = validateDesignSystem(buildValidSystem({ constraints: { ...buildValidSystem().constraints, coordinateUnit: "px" } }));
    expect(badUnit.ok).toBe(false);
    expect(badUnit.errors.join("\n")).toContain("coordinateUnit");

    const badColorFormat = validateDesignSystem(
      buildValidSystem({ constraints: { ...buildValidSystem().constraints, colorFormat: "hsl" } })
    );
    expect(badColorFormat.ok).toBe(false);
    expect(badColorFormat.errors.join("\n")).toContain("colorFormat");

    const badColor = validateDesignSystem(
      buildValidSystem({
        colors: {
          ...buildValidSystem().colors,
          background: { ...buildValidSystem().colors.background, slide: "not-a-color" },
        },
      })
    );
    expect(badColor.ok).toBe(false);
    expect(badColor.errors.join("\n")).toContain("invalid_color");

    const badVp = validateDesignSystem({ ...buildValidSystem(), visualPreference: { mode: "wrong" } });
    expect(badVp.ok).toBe(false);
    expect(badVp.errors.join("\n")).toContain("visualPreference.mode");
  });
});
