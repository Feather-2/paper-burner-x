
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  normalizeVfsPath,
  dirnameVfsPath,
  basenameVfsPath,
  joinVfsPath,
} from "../../js/agents/vfs/path.js";

describe("vfs/path", () => {
  describe("normalizeVfsPath", () => {
    it("returns empty for empty string", () => {
      expect(normalizeVfsPath("")).toBe("");
    });

    it("returns empty for '.'", () => {
      expect(normalizeVfsPath(".")).toBe("");
    });

    it("returns empty for './'", () => {
      expect(normalizeVfsPath("./")).toBe("");
    });

    it("returns empty for '/'", () => {
      expect(normalizeVfsPath("/")).toBe("");
    });

    it("strips leading slashes", () => {
      expect(normalizeVfsPath("/foo/bar")).toBe("foo/bar");
    });

    it("strips multiple leading slashes", () => {
      expect(normalizeVfsPath("///foo")).toBe("foo");
    });

    it("strips leading ./ sequences", () => {
      expect(normalizeVfsPath("./foo/bar")).toBe("foo/bar");
    });

    it("converts backslashes to forward slashes", () => {
      expect(normalizeVfsPath("foo\\bar\\baz")).toBe("foo/bar/baz");
    });

    it("collapses . segments", () => {
      expect(normalizeVfsPath("foo/./bar")).toBe("foo/bar");
    });

    it("collapses empty segments", () => {
      expect(normalizeVfsPath("foo//bar")).toBe("foo/bar");
    });

    it("throws for .. traversal", () => {
      expect(() => normalizeVfsPath("foo/../bar")).toThrow(/traversal/);
    });

    it("throws for leading .. traversal", () => {
      expect(() => normalizeVfsPath("../foo")).toThrow(/traversal/);
    });

    it("throws for Windows absolute path", () => {
      expect(() => normalizeVfsPath("C:/foo/bar")).toThrow(/absolute path/);
    });

    it("throws for invalid characters", () => {
      expect(() => normalizeVfsPath("foo<bar")).toThrow(/Invalid VFS path segment/);
    });

    it("throws for control characters", () => {
      expect(() => normalizeVfsPath("foo\x00bar")).toThrow(/Invalid VFS path segment/);
    });

    it("throws for Windows reserved names", () => {
      expect(() => normalizeVfsPath("CON")).toThrow(/reserved name/);
    });

    it("throws for Windows reserved names with extension", () => {
      expect(() => normalizeVfsPath("nul.txt")).toThrow(/reserved name/);
    });

    it("handles normal path", () => {
      expect(normalizeVfsPath("foo/bar/baz.txt")).toBe("foo/bar/baz.txt");
    });

    it("handles spaces in path", () => {
      expect(normalizeVfsPath("foo/bar baz")).toBe("foo/bar baz");
    });

    it("handles null input", () => {
      expect(normalizeVfsPath(null)).toBe("");
    });

    it("handles undefined input", () => {
      expect(normalizeVfsPath(undefined)).toBe("");
    });
  });

  describe("dirnameVfsPath", () => {
    it("returns parent directory", () => {
      expect(dirnameVfsPath("foo/bar/baz.txt")).toBe("foo/bar");
    });

    it("returns empty for root file", () => {
      expect(dirnameVfsPath("file.txt")).toBe("");
    });

    it("returns empty for root path", () => {
      expect(dirnameVfsPath("/")).toBe("");
    });

    it("normalizes path before extracting dirname", () => {
      expect(dirnameVfsPath("/foo/bar")).toBe("foo");
    });

    it("handles deeply nested path", () => {
      expect(dirnameVfsPath("a/b/c/d/e.txt")).toBe("a/b/c/d");
    });
  });

  describe("basenameVfsPath", () => {
    it("returns filename from path", () => {
      expect(basenameVfsPath("foo/bar/baz.txt")).toBe("baz.txt");
    });

    it("returns name for root file", () => {
      expect(basenameVfsPath("file.txt")).toBe("file.txt");
    });

    it("returns empty for root path", () => {
      expect(basenameVfsPath("/")).toBe("");
    });

    it("normalizes path before extracting basename", () => {
      expect(basenameVfsPath("/foo/bar")).toBe("bar");
    });

    it("handles directory name", () => {
      expect(basenameVfsPath("foo/bar/")).toBe("bar");
    });
  });

  describe("joinVfsPath", () => {
    it("joins two paths", () => {
      expect(joinVfsPath("foo").toBe("bar"), "foo/bar");
    });

    it("returns child when base is empty", () => {
      expect(joinVfsPath("").toBe("bar"), "bar");
    });

    it("returns base when child is empty", () => {
      expect(joinVfsPath("foo").toBe(""), "foo");
    });

    it("normalizes both paths", () => {
      expect(joinVfsPath("/foo/").toBe("./bar"), "foo/bar");
    });

    it("returns empty when both are empty", () => {
      expect(joinVfsPath("").toBe(""), "");
    });

    it("handles multiple segments", () => {
      expect(joinVfsPath("foo/bar").toBe("baz/qux"), "foo/bar/baz/qux");
    });
  });
});
