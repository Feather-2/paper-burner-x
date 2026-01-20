import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

import {
  PageType,
  ALLOWED_PAGE_TYPES,
  KEY_PAGE_TYPES,
  isValidPageType,
  normalizePageType,
} from "../../../../../js/agents/stages/textprep/constants.js";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(() => ""),
}));

const mockedReadFileSync = vi.mocked(readFileSync);

beforeEach(() => {
  vi.clearAllMocks();
  mockedReadFileSync.mockReturnValue("");
});

describe("PageType", () => {
  it("exposes expected keys and values", () => {
    const expectedKeys = [
      "COVER",
      "AGENDA",
      "OVERVIEW",
      "COMPARISON",
      "PROCESS",
      "SUMMARY",
      "APPENDIX",
      "ARCHITECTURE",
      "CONCLUSION",
    ];
    const expectedValues = [
      "cover",
      "agenda",
      "overview",
      "comparison",
      "process",
      "summary",
      "appendix",
      "architecture",
      "conclusion",
    ];

    expect(Object.keys(PageType).sort()).toEqual([...expectedKeys].sort());
    expect(Object.values(PageType).sort()).toEqual([...expectedValues].sort());
  });

  it("is frozen and does not expose unknown types", () => {
    expect(Object.isFrozen(PageType)).toBe(true);
    expect(PageType.UNKNOWN).toBeUndefined();
  });
});

describe("ALLOWED_PAGE_TYPES", () => {
  it("contains all page types", () => {
    const values = Object.values(PageType);
    expect(ALLOWED_PAGE_TYPES.size).toBe(values.length);
    values.forEach((value) => {
      expect(ALLOWED_PAGE_TYPES.has(value)).toBe(true);
    });
  });

  it("is frozen and rejects unknown values", () => {
    expect(Object.isFrozen(ALLOWED_PAGE_TYPES)).toBe(true);
    expect(ALLOWED_PAGE_TYPES.has("unknown")).toBe(false);
    for (const value of ALLOWED_PAGE_TYPES) {
      expect(typeof value).toBe("string");
    }
  });
});

describe("KEY_PAGE_TYPES", () => {
  it("contains the expected key page types", () => {
    const expected = [
      PageType.COVER,
      PageType.AGENDA,
      PageType.ARCHITECTURE,
      PageType.OVERVIEW,
      PageType.SUMMARY,
      PageType.CONCLUSION,
    ];

    expect(KEY_PAGE_TYPES.size).toBe(expected.length);
    expected.forEach((value) => {
      expect(KEY_PAGE_TYPES.has(value)).toBe(true);
    });
    expect(KEY_PAGE_TYPES.has(PageType.PROCESS)).toBe(false);
    expect(KEY_PAGE_TYPES.has(PageType.APPENDIX)).toBe(false);
  });

  it("is frozen and subset of allowed types", () => {
    expect(Object.isFrozen(KEY_PAGE_TYPES)).toBe(true);
    for (const value of KEY_PAGE_TYPES) {
      expect(ALLOWED_PAGE_TYPES.has(value)).toBe(true);
    }
  });
});

describe("isValidPageType", () => {
  it("returns true for allowed page types", () => {
    Object.values(PageType).forEach((value) => {
      expect(isValidPageType(value)).toBe(true);
    });
  });

  it("returns false for invalid and boundary values without throwing", () => {
    const invalidValues = [
      null,
      undefined,
      "",
      "   ",
      [],
      {},
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      "123",
      "not-a-type",
      "COVER",
      { 0: "cover", length: 1 },
      Symbol("cover"),
    ];

    invalidValues.forEach((value) => {
      let result;
      expect(() => {
        result = isValidPageType(value);
      }).not.toThrow();
      expect(result).toBe(false);
    });
  });

  it("handles concurrent calls without shared state", async () => {
    const inputs = [PageType.COVER, "unknown", null, PageType.AGENDA, "COVER"];
    const results = await Promise.all(
      inputs.map((input) => Promise.resolve().then(() => isValidPageType(input)))
    );

    expect(results).toEqual([true, false, false, true, false]);
  });

  it("handles rapid consecutive calls consistently", () => {
    const inputs = [PageType.COVER, PageType.AGENDA, "unknown", "COVER", null];
    const results = inputs.map((input) => isValidPageType(input));

    expect(results).toEqual([true, true, false, false, false]);
  });
});

describe("normalizePageType", () => {
  it("normalizes case and whitespace for allowed values", () => {
    expect(normalizePageType(" Cover ")).toBe("cover");
    expect(normalizePageType("AGENDA")).toBe("agenda");
    expect(normalizePageType("overview")).toBe("overview");
    expect(normalizePageType("  summary  ")).toBe("summary");
  });

  it("returns null for invalid and boundary values without throwing", () => {
    const invalidValues = [
      null,
      undefined,
      "",
      "   ",
      [],
      {},
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      "123",
      "not-a-type",
      "0",
      { 0: "cover", length: 1 },
      Symbol("cover"),
    ];

    invalidValues.forEach((value) => {
      let result;
      expect(() => {
        result = normalizePageType(value);
      }).not.toThrow();
      expect(result).toBeNull();
    });
  });

  it("handles resource boundary inputs", () => {
    const largeContent = "x".repeat(50000);
    mockedReadFileSync.mockReturnValueOnce(largeContent);
    const fileContent = readFileSync("/fake/large.txt", "utf-8");

    expect(fileContent.length).toBe(50000);
    expect(normalizePageType(fileContent)).toBeNull();
    expect(mockedReadFileSync).toHaveBeenCalledWith("/fake/large.txt", "utf-8");

    const longString = `${" ".repeat(5000)}COVER${" ".repeat(5000)}`;
    expect(normalizePageType(longString)).toBe("cover");

    let deep = {};
    for (let i = 0; i < 200; i += 1) {
      deep = { child: deep };
    }

    let deepResult;
    expect(() => {
      deepResult = normalizePageType(deep);
    }).not.toThrow();
    expect(deepResult).toBeNull();
  });

  it("handles concurrent calls without shared state", async () => {
    const inputs = [" Cover ", "unknown", null, "AGENDA", " overview "];
    const results = await Promise.all(
      inputs.map((input) => Promise.resolve().then(() => normalizePageType(input)))
    );

    expect(results).toEqual(["cover", null, null, "agenda", "overview"]);
  });

  it("handles rapid consecutive calls consistently", () => {
    const inputs = ["cover", "COVER", "unknown", "", "  summary "];
    const results = inputs.map((input) => normalizePageType(input));

    expect(results).toEqual(["cover", "cover", null, null, "summary"]);
  });
});
