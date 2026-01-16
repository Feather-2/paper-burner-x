import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  normalizeVfsPath,
  dirnameVfsPath,
  basenameVfsPath,
  joinVfsPath,
} from "../../js/agents/vfs/path.js";

describe("vfs/path", () => {
  describe("normalizeVfsPath", () => {
    it("returns empty for empty string", () => {
      assert.equal(normalizeVfsPath(""), "");
    });

    it("returns empty for '.'", () => {
      assert.equal(normalizeVfsPath("."), "");
    });

    it("returns empty for './'", () => {
      assert.equal(normalizeVfsPath("./"), "");
    });

    it("returns empty for '/'", () => {
      assert.equal(normalizeVfsPath("/"), "");
    });

    it("strips leading slashes", () => {
      assert.equal(normalizeVfsPath("/foo/bar"), "foo/bar");
    });

    it("strips multiple leading slashes", () => {
      assert.equal(normalizeVfsPath("///foo"), "foo");
    });

    it("strips leading ./ sequences", () => {
      assert.equal(normalizeVfsPath("./foo/bar"), "foo/bar");
    });

    it("converts backslashes to forward slashes", () => {
      assert.equal(normalizeVfsPath("foo\\bar\\baz"), "foo/bar/baz");
    });

    it("collapses . segments", () => {
      assert.equal(normalizeVfsPath("foo/./bar"), "foo/bar");
    });

    it("collapses empty segments", () => {
      assert.equal(normalizeVfsPath("foo//bar"), "foo/bar");
    });

    it("throws for .. traversal", () => {
      assert.throws(
        () => normalizeVfsPath("foo/../bar"),
        /traversal/
      );
    });

    it("throws for leading .. traversal", () => {
      assert.throws(
        () => normalizeVfsPath("../foo"),
        /traversal/
      );
    });

    it("throws for Windows absolute path", () => {
      assert.throws(
        () => normalizeVfsPath("C:/foo/bar"),
        /absolute path/
      );
    });

    it("throws for invalid characters", () => {
      assert.throws(
        () => normalizeVfsPath("foo<bar"),
        /Invalid VFS path segment/
      );
    });

    it("throws for control characters", () => {
      assert.throws(
        () => normalizeVfsPath("foo\x00bar"),
        /Invalid VFS path segment/
      );
    });

    it("throws for Windows reserved names", () => {
      assert.throws(
        () => normalizeVfsPath("CON"),
        /reserved name/
      );
    });

    it("throws for Windows reserved names with extension", () => {
      assert.throws(
        () => normalizeVfsPath("nul.txt"),
        /reserved name/
      );
    });

    it("handles normal path", () => {
      assert.equal(normalizeVfsPath("foo/bar/baz.txt"), "foo/bar/baz.txt");
    });

    it("handles spaces in path", () => {
      assert.equal(normalizeVfsPath("foo/bar baz"), "foo/bar baz");
    });

    it("handles null input", () => {
      assert.equal(normalizeVfsPath(null), "");
    });

    it("handles undefined input", () => {
      assert.equal(normalizeVfsPath(undefined), "");
    });
  });

  describe("dirnameVfsPath", () => {
    it("returns parent directory", () => {
      assert.equal(dirnameVfsPath("foo/bar/baz.txt"), "foo/bar");
    });

    it("returns empty for root file", () => {
      assert.equal(dirnameVfsPath("file.txt"), "");
    });

    it("returns empty for root path", () => {
      assert.equal(dirnameVfsPath("/"), "");
    });

    it("normalizes path before extracting dirname", () => {
      assert.equal(dirnameVfsPath("/foo/bar"), "foo");
    });

    it("handles deeply nested path", () => {
      assert.equal(dirnameVfsPath("a/b/c/d/e.txt"), "a/b/c/d");
    });
  });

  describe("basenameVfsPath", () => {
    it("returns filename from path", () => {
      assert.equal(basenameVfsPath("foo/bar/baz.txt"), "baz.txt");
    });

    it("returns name for root file", () => {
      assert.equal(basenameVfsPath("file.txt"), "file.txt");
    });

    it("returns empty for root path", () => {
      assert.equal(basenameVfsPath("/"), "");
    });

    it("normalizes path before extracting basename", () => {
      assert.equal(basenameVfsPath("/foo/bar"), "bar");
    });

    it("handles directory name", () => {
      assert.equal(basenameVfsPath("foo/bar/"), "bar");
    });
  });

  describe("joinVfsPath", () => {
    it("joins two paths", () => {
      assert.equal(joinVfsPath("foo", "bar"), "foo/bar");
    });

    it("returns child when base is empty", () => {
      assert.equal(joinVfsPath("", "bar"), "bar");
    });

    it("returns base when child is empty", () => {
      assert.equal(joinVfsPath("foo", ""), "foo");
    });

    it("normalizes both paths", () => {
      assert.equal(joinVfsPath("/foo/", "./bar"), "foo/bar");
    });

    it("returns empty when both are empty", () => {
      assert.equal(joinVfsPath("", ""), "");
    });

    it("handles multiple segments", () => {
      assert.equal(joinVfsPath("foo/bar", "baz/qux"), "foo/bar/baz/qux");
    });
  });
});
