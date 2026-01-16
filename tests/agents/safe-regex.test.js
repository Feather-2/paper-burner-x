
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  isPotentiallyDangerous,
  createSafeRegex,
  safeMatch,
  globToRegex,
} from "../../js/agents/shared/utils/safe-regex.js";

describe("shared/utils/safe-regex", () => {
  describe("isPotentiallyDangerous", () => {
    it("returns false for simple pattern", () => {
      expect(isPotentiallyDangerous("hello")).toBe(false);
    });

    it("returns false for null", () => {
      expect(isPotentiallyDangerous(null)).toBe(false);
    });

    it("returns false for non-string", () => {
      expect(isPotentiallyDangerous(123)).toBe(false);
    });

    it("returns true for very long pattern", () => {
      const longPattern = "a".repeat(1001);
      expect(isPotentiallyDangerous(longPattern)).toBeTruthy();
    });

    it("returns true for nested quantifiers (a+)+", () => {
      expect(isPotentiallyDangerous("(a+)+")).toBeTruthy();
    });

    it("returns true for nested quantifiers (a*)*", () => {
      expect(isPotentiallyDangerous("(a*)*")).toBeTruthy();
    });

    it("returns true for repeated alternation (a|ab)+", () => {
      expect(isPotentiallyDangerous("(a|ab)+")).toBeTruthy();
    });

    it("returns true for many alternations in groups", () => {
      expect(isPotentiallyDangerous("(a|b)(c|d)(e|f)(g|h)")).toBeTruthy();
    });

    it("returns true for nested ranges", () => {
      expect(isPotentiallyDangerous("a{1,2}{3,4}")).toBeTruthy();
    });

    it("returns false for safe alternation", () => {
      expect(isPotentiallyDangerous("(foo|bar)")).toBe(false);
    });

    it("returns false for simple character class", () => {
      expect(isPotentiallyDangerous("[a-z]+")).toBe(false);
    });
  });

  describe("createSafeRegex", () => {
    it("creates regex for safe pattern", () => {
      const regex = createSafeRegex("hello\\s+world");
      expect(regex instanceof RegExp).toBeTruthy();
    });

    it("uses provided flags", () => {
      const regex = createSafeRegex("test", "i");
      expect(regex.flags).toBe("i");
    });

    it("uses default gu flags", () => {
      const regex = createSafeRegex("test");
      expect(regex.flags.includes("g")).toBeTruthy();
      expect(regex.flags.includes("u")).toBeTruthy();
    });

    it("throws for dangerous pattern", () => {
      expect(() => createSafeRegex("(a+)+")).toThrow(/ReDoS/);
    });

    it("throws for invalid regex syntax", () => {
      expect(() => createSafeRegex("[unclosed")).toThrow(/Invalid RegExp/);
    });
  });

  describe("safeMatch", () => {
    it("matches text with regex", () => {
      const result = safeMatch("hello world", /world/);
      expect(result).toBeTruthy();
      expect(result[0]).toBe("world");
    });

    it("returns null for no match", () => {
      const result = safeMatch("hello", /world/);
      expect(result).toBe(null);
    });

    it("handles null text", () => {
      const result = safeMatch(null, /test/);
      expect(result).toBe(null);
    });

    it("handles undefined text", () => {
      const result = safeMatch(undefined, /test/);
      expect(result).toBe(null);
    });

    it("accepts timeout parameter (no-op)", () => {
      const result = safeMatch("test", /test/, 1000);
      expect(result).toBeTruthy();
    });
  });

  describe("globToRegex", () => {
    it("converts simple glob", () => {
      const regex = globToRegex("*.js");
      expect(regex.test("file.js")).toBeTruthy();
      // Note: globToRegex does partial matching, not anchored
    });

    it("handles ** for directory matching", () => {
      const regex = globToRegex("**/*.js");
      expect(regex.test("src/components/file.js")).toBeTruthy();
    });

    it("handles ? for single character", () => {
      const regex = globToRegex("file?.txt");
      expect(regex.test("file1.txt")).toBeTruthy();
      expect(regex.test("fileA.txt")).toBeTruthy();
    });

    it("escapes regex special characters", () => {
      const regex = globToRegex("file.name+test");
      expect(regex.test("file.name+test")).toBeTruthy();
    });

    it("handles null input", () => {
      const regex = globToRegex(null);
      expect(regex instanceof RegExp).toBeTruthy();
    });

    it("handles non-string input", () => {
      const regex = globToRegex(123);
      expect(regex instanceof RegExp).toBeTruthy();
    });

    it("matches exact pattern", () => {
      const regex = globToRegex("exact");
      expect(regex.test("exact")).toBeTruthy();
    });
  });
});
