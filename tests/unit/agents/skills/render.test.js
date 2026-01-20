import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../js/agents/shared/index.js", async () => {
  const actual = await vi.importActual("../../../../js/agents/shared/index.js");
  return {
    ...actual,
    toNonEmptyString: vi.fn(actual.toNonEmptyString),
  };
});

import { renderSkillsList, renderSkillsSection } from "../../../../js/agents/skills/render.js";
import { toNonEmptyString } from "../../../../js/agents/shared/index.js";

const mockedToNonEmptyString = vi.mocked(toNonEmptyString);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("renderSkillsSection", () => {
  it("returns null for empty inputs (nullish/empty/type boundaries)", () => {
    const cases = [null, undefined, "", [], {}];

    for (const value of cases) {
      expect(renderSkillsSection(value)).toBeNull();
    }
  });

  it("renders grouped skills in priority order with normalized paths", () => {
    const skills = [
      { name: "Standard", description: "std", path: "http://example.com/dir/std.md?ref=1", priority: 100 },
      { metadata: { name: "Core", description: "core", path: "/opt/skills/core.md", activation: { priority: 0 } } },
      { metadata: { name: "Optional", description: "opt", path: "user:opt", priority: "optional" } },
      { metadata: { name: "Windows", description: "win", path: "C:\\skills\\win.md", priority: 100 } },
      { metadata: { name: "Rel", description: "rel", path: "skills\\rel.md", priority: 100 } },
    ];

    const output = renderSkillsSection(skills);

    expect(output).toContain("### 🔴 Core Skills");
    expect(output).toContain("### 🟡 Standard Skills");
    expect(output).toContain("### ⚪ Optional Skills");

    expect(output).toContain("- Core: core (file: core.md)");
    expect(output).toContain("- Standard: std (file: /dir/std.md?ref=1)");
    expect(output).toContain("- Optional: opt (file: user:opt)");
    expect(output).toContain("- Windows: win (file: win.md)");
    expect(output).toContain("- Rel: rel (file: skills/rel.md)");

    const coreIndex = output.indexOf("### 🔴 Core Skills");
    const standardIndex = output.indexOf("### 🟡 Standard Skills");
    const optionalIndex = output.indexOf("### ⚪ Optional Skills");
    expect(coreIndex).toBeLessThan(standardIndex);
    expect(standardIndex).toBeLessThan(optionalIndex);

    const standardLineIndex = output.indexOf("- Standard: std (file: /dir/std.md?ref=1)");
    const windowsLineIndex = output.indexOf("- Windows: win (file: win.md)");
    const relLineIndex = output.indexOf("- Rel: rel (file: skills/rel.md)");
    expect(standardLineIndex).toBeLessThan(windowsLineIndex);
    expect(windowsLineIndex).toBeLessThan(relLineIndex);
  });

  it("omits priority headings when showPriority is false and ignores blank paths", () => {
    const output = renderSkillsSection(
      [{ name: "Solo", description: "desc", path: "   ", priority: 100 }],
      { showPriority: false },
    );

    expect(output).not.toContain("### 🔴 Core Skills");
    expect(output).not.toContain("### 🟡 Standard Skills");
    expect(output).not.toContain("### ⚪ Optional Skills");
    expect(output).toContain("- Solo: desc");
    expect(output).not.toContain("(file:");
  });

  it("handles boundary priorities including 0, -1, MAX_SAFE_INTEGER, and numeric strings", () => {
    const skills = [
      { metadata: { name: "Zero", description: "d0", activation: { priority: 0 } } },
      { name: "Neg", description: "d-1", priority: -1 },
      { name: "Max", description: "dmax", priority: Number.MAX_SAFE_INTEGER },
      { name: "StringOptional", description: "d150", priority: "150" },
    ];

    const output = renderSkillsSection(skills);

    const coreIndex = output.indexOf("### 🔴 Core Skills");
    const optionalIndex = output.indexOf("### ⚪ Optional Skills");
    expect(coreIndex).toBeLessThan(optionalIndex);

    expect(output.indexOf("- Zero: d0")).toBeGreaterThan(coreIndex);
    expect(output.indexOf("- Neg: d-1")).toBeGreaterThan(coreIndex);
    expect(output.indexOf("- Max: dmax")).toBeGreaterThan(optionalIndex);
    expect(output.indexOf("- StringOptional: d150")).toBeGreaterThan(optionalIndex);
  });

  it("is stable under concurrent and rapid successive calls", async () => {
    const skills = [{ name: "Fast", description: "desc", path: "skills/fast.md", priority: 100 }];

    const results = await Promise.all(
      Array.from({ length: 5 }, () => Promise.resolve().then(() => renderSkillsSection(skills))),
    );

    expect(new Set(results).size).toBe(1);

    for (let i = 0; i < 25; i += 1) {
      expect(renderSkillsSection(skills)).toBe(results[0]);
    }
  });

  it("handles long descriptions and deep paths without truncation", () => {
    const longDescription = "d".repeat(5000);
    const deepSegments = Array.from({ length: 80 }, (_, i) => `dir${i}`);
    const hugeFileName = `file-${"x".repeat(1024)}.md`;
    const deepPath = `/${deepSegments.join("/")}/${hugeFileName}`;

    const output = renderSkillsSection([
      { name: "Huge", description: longDescription, path: deepPath, priority: 100 },
    ]);

    expect(output).toContain(longDescription);
    expect(output).toContain(`(file: ${hugeFileName})`);
  });

  it("delegates path normalization to toNonEmptyString for empty values", () => {
    renderSkillsSection([{ name: "EmptyPath", description: "d", path: "", priority: 100 }]);
    expect(mockedToNonEmptyString).toHaveBeenCalledWith("");
  });
});

describe("renderSkillsList", () => {
  it("returns empty string for empty inputs (nullish/empty/type boundaries)", () => {
    const cases = [null, undefined, "", [], {}];

    for (const value of cases) {
      expect(renderSkillsList(value)).toBe("");
    }
  });

  it("renders prioritized list with tags and short descriptions", () => {
    const skills = [
      { name: "Standard", description: "standard desc", priority: 100 },
      { metadata: { name: "Core", description: "core desc", shortDescription: "core short", activation: { priority: 0 } } },
      { metadata: { name: "Optional", description: "optional desc", shortDescription: "opt short", priority: "150" } },
    ];

    const output = renderSkillsList(skills);
    const lines = output.split("\\n");

    expect(lines[0]).toBe("Available skills:");
    expect(lines[1]).toBe("- 🔴 $Core: core short");
    expect(lines[2]).toBe("- $Standard: standard desc");
    expect(lines[3]).toBe("- ⚪ $Optional: opt short");
  });

  it("falls back to description when shortDescription is empty or null", () => {
    const skills = [
      { name: "EmptyShort", description: "full desc", shortDescription: "", priority: 100 },
      { metadata: { name: "NullShort", description: "full desc 2", shortDescription: null, priority: 100 } },
    ];

    const output = renderSkillsList(skills);

    expect(output).toContain("- $EmptyShort: full desc");
    expect(output).toContain("- $NullShort: full desc 2");
  });

  it("handles long descriptions and deep nested metadata without truncation", () => {
    const longDescription = "L".repeat(8000);
    const skill = {
      metadata: { name: "Deep", description: longDescription, priority: -1 },
      extra: { nested: { deeper: { deepest: { value: "x" } } } },
    };

    const output = renderSkillsList([skill]);

    expect(output).toContain("- 🔴 $Deep:");
    expect(output).toContain(longDescription);
  });

  it("is stable under concurrent and rapid successive calls", async () => {
    const skills = [{ name: "Fast", description: "desc", priority: 100 }];

    const results = await Promise.all(
      Array.from({ length: 5 }, () => Promise.resolve().then(() => renderSkillsList(skills))),
    );

    expect(new Set(results).size).toBe(1);

    for (let i = 0; i < 25; i += 1) {
      expect(renderSkillsList(skills)).toBe(results[0]);
    }
  });
});
