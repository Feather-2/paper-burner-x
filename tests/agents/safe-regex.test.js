import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  isPotentiallyDangerous,
  createSafeRegex,
  safeMatch,
  globToRegex,
} from "../../js/agents/shared/utils/safe-regex.js";

describe("shared/utils/safe-regex", () => {
  describe("isPotentiallyDangerous", () => {
    it("returns false for simple pattern", () => {
      assert.equal(isPotentiallyDangerous("hello"), false);
    });

    it("returns false for null", () => {
      assert.equal(isPotentiallyDangerous(null), false);
    });

    it("returns false for non-string", () => {
      assert.equal(isPotentiallyDangerous(123), false);
    });

    it("returns true for very long pattern", () => {
      const longPattern = "a".repeat(1001);
      assert.ok(isPotentiallyDangerous(longPattern));
    });

    it("returns true for nested quantifiers (a+)+", () => {
      assert.ok(isPotentiallyDangerous("(a+)+"));
    });

    it("returns true for nested quantifiers (a*)*", () => {
      assert.ok(isPotentiallyDangerous("(a*)*"));
    });

    it("returns true for repeated alternation (a|ab)+", () => {
      assert.ok(isPotentiallyDangerous("(a|ab)+"));
    });

    it("returns true for many alternations in groups", () => {
      assert.ok(isPotentiallyDangerous("(a|b)(c|d)(e|f)(g|h)"));
    });

    it("returns true for nested ranges", () => {
      assert.ok(isPotentiallyDangerous("a{1,2}{3,4}"));
    });

    it("returns false for safe alternation", () => {
      assert.equal(isPotentiallyDangerous("(foo|bar)"), false);
    });

    it("returns false for simple character class", () => {
      assert.equal(isPotentiallyDangerous("[a-z]+"), false);
    });
  });

  describe("createSafeRegex", () => {
    it("creates regex for safe pattern", () => {
      const regex = createSafeRegex("hello\\s+world");
      assert.ok(regex instanceof RegExp);
    });

    it("uses provided flags", () => {
      const regex = createSafeRegex("test", "i");
      assert.equal(regex.flags, "i");
    });

    it("uses default gu flags", () => {
      const regex = createSafeRegex("test");
      assert.ok(regex.flags.includes("g"));
      assert.ok(regex.flags.includes("u"));
    });

    it("throws for dangerous pattern", () => {
      assert.throws(
        () => createSafeRegex("(a+)+"),
        /ReDoS/
      );
    });

    it("throws for invalid regex syntax", () => {
      assert.throws(
        () => createSafeRegex("[unclosed"),
        /Invalid RegExp/
      );
    });
  });

  describe("safeMatch", () => {
    it("matches text with regex", () => {
      const result = safeMatch("hello world", /world/);
      assert.ok(result);
      assert.equal(result[0], "world");
    });

    it("returns null for no match", () => {
      const result = safeMatch("hello", /world/);
      assert.equal(result, null);
    });

    it("handles null text", () => {
      const result = safeMatch(null, /test/);
      assert.equal(result, null);
    });

    it("handles undefined text", () => {
      const result = safeMatch(undefined, /test/);
      assert.equal(result, null);
    });

    it("accepts timeout parameter (no-op)", () => {
      const result = safeMatch("test", /test/, 1000);
      assert.ok(result);
    });
  });

  describe("globToRegex", () => {
    it("converts simple glob", () => {
      const regex = globToRegex("*.js");
      assert.ok(regex.test("file.js"));
      // Note: globToRegex does partial matching, not anchored
    });

    it("handles ** for directory matching", () => {
      const regex = globToRegex("**/*.js");
      assert.ok(regex.test("src/components/file.js"));
    });

    it("handles ? for single character", () => {
      const regex = globToRegex("file?.txt");
      assert.ok(regex.test("file1.txt"));
      assert.ok(regex.test("fileA.txt"));
    });

    it("escapes regex special characters", () => {
      const regex = globToRegex("file.name+test");
      assert.ok(regex.test("file.name+test"));
    });

    it("handles null input", () => {
      const regex = globToRegex(null);
      assert.ok(regex instanceof RegExp);
    });

    it("handles non-string input", () => {
      const regex = globToRegex(123);
      assert.ok(regex instanceof RegExp);
    });

    it("matches exact pattern", () => {
      const regex = globToRegex("exact");
      assert.ok(regex.test("exact"));
    });
  });
});
