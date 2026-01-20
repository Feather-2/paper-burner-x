/**
 * Unit tests for formatBullets in js/agents/prompts/formatters/format-bullets.js.
 * Covers arrays/strings/other values, boundaries, concurrency, and large inputs.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock(
  "virtual:format-bullets-fixtures",
  () => ({
    makeLargeArray: vi.fn((count) =>
      Array.from({ length: count }, (_, i) => `item ${i}`)
    ),
    makeLargeString: vi.fn((count) =>
      Array.from({ length: count }, (_, i) => `line ${i}`).join("\n")
    ),
    makeNestedArray: vi.fn(() => [[[["deep"]]]]),
  }),
  { virtual: true }
);

import {
  makeLargeArray,
  makeLargeString,
  makeNestedArray,
} from "virtual:format-bullets-fixtures";
import { formatBullets } from "../../../../../js/agents/prompts/formatters/format-bullets.js";

describe("js/agents/prompts/formatters/format-bullets.js", () => {
  describe("formatBullets", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("formats arrays into bullet lines and drops empty entries", () => {
      const input = ["alpha", " ", null, "beta", 0];

      expect(formatBullets(input)).toBe("- alpha\n- beta\n- 0");
    });

    it("formats strings into bullet lines, trimming line endings", () => {
      const input = "first  \n\n second\t\nthird";

      expect(formatBullets(input)).toBe("- first\n-  second\n- third");
    });

    it("formats non-string, non-array values as a single bullet", () => {
      expect(formatBullets(42)).toBe("- 42");
    });

    it("supports custom bullet and indentation options", () => {
      const input = ["item"];

      expect(formatBullets(input, { bullet: "* ", indent: "  " })).toBe(
        "  * item"
      );
    });

    it("returns empty string for null, undefined, empty, or whitespace-only inputs", () => {
      expect(formatBullets(null)).toBe("");
      expect(formatBullets(undefined)).toBe("");
      expect(formatBullets("")).toBe("");
      expect(formatBullets("   \n\t")).toBe("");
      expect(formatBullets([])).toBe("");
    });

    it("formats empty objects as a bullet string representation", () => {
      expect(formatBullets({})).toBe("- [object Object]");
    });

    it("handles numeric boundary values", () => {
      const cases = [
        [0, "- 0"],
        [-1, "- -1"],
        [Number.MAX_SAFE_INTEGER, `- ${Number.MAX_SAFE_INTEGER}`],
      ];

      for (const [input, expected] of cases) {
        expect(formatBullets(input)).toBe(expected);
      }
    });

    it("treats numeric strings as strings and array-like objects as non-arrays", () => {
      expect(formatBullets("123")).toBe("- 123");

      const arrayLike = { 0: "a", length: 1 };
      expect(formatBullets(arrayLike)).toBe("- [object Object]");
    });

    it("propagates errors from value stringification", () => {
      const badValue = {
        toString() {
          throw new Error("boom");
        },
      };

      expect(() => formatBullets(badValue)).toThrow("boom");
    });

    it("handles concurrent calls without shared state", async () => {
      const values = [["a", "b"], "c\nd", 0, null];
      const expected = ["- a\n- b", "- c\n- d", "- 0", ""];
      const results = await Promise.all(
        values.map((value) => Promise.resolve().then(() => formatBullets(value)))
      );

      expect(results).toEqual(expected);
    });

    it("handles rapid successive calls", () => {
      let last = "";
      for (let i = 0; i < 1000; i += 1) {
        last = formatBullets([i]);
      }

      expect(last).toBe("- 999");
    });

    it("handles large inputs and deep nesting", () => {
      const largeArray = makeLargeArray(2000);
      const largeOutput = formatBullets(largeArray);
      const largeLines = largeOutput.split("\n");

      expect(largeLines.length).toBe(2000);
      expect(largeLines[0]).toBe("- item 0");
      expect(largeLines[largeLines.length - 1]).toBe("- item 1999");

      const largeString = makeLargeString(1500);
      const largeStringOutput = formatBullets(largeString);
      const stringLines = largeStringOutput.split("\n");

      expect(stringLines.length).toBe(1500);
      expect(stringLines[0]).toBe("- line 0");
      expect(stringLines[stringLines.length - 1]).toBe("- line 1499");

      const longLine = "x".repeat(10000);
      expect(formatBullets(longLine)).toBe(`- ${longLine}`);

      const nested = makeNestedArray();
      expect(formatBullets(nested)).toBe("- deep");
    });
  });
});
