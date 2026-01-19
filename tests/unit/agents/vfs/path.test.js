import { describe, expect, it } from "vitest";

import { basenameVfsPath, dirnameVfsPath, joinVfsPath, normalizeVfsPath } from '../../../../js/agents/vfs/path.js';

describe("agents/vfs/path", () => {
  it("normalizes to relative POSIX paths (root, slashes, dots, trimming)", () => {
    expect(normalizeVfsPath()).toBe("");
    expect(normalizeVfsPath(null)).toBe("");
    expect(normalizeVfsPath("")).toBe("");
    expect(normalizeVfsPath(".")).toBe("");
    expect(normalizeVfsPath("./")).toBe("");
    expect(normalizeVfsPath("/")).toBe("");
    expect(normalizeVfsPath("////")).toBe("");

    expect(normalizeVfsPath("  /a/b/  ")).toBe("a/b");
    expect(normalizeVfsPath("a//b/./c")).toBe("a/b/c");
    expect(normalizeVfsPath("././a/b")).toBe("a/b");

    // Windows separators are normalized to POSIX.
    expect(normalizeVfsPath(" \\a\\b\\c.txt ")).toBe("a/b/c.txt");

    // Each segment is trimmed.
    expect(normalizeVfsPath("a/  b  /c")).toBe("a/b/c");
  });

  it("rejects traversal, invalid segments, reserved names, and Windows absolute paths", () => {
    expect(() => normalizeVfsPath("../x")).toThrow(/traversal/i);
    expect(() => normalizeVfsPath("a/../b")).toThrow(/traversal/i);
    expect(() => normalizeVfsPath("a/ .. /b")).toThrow(/traversal/i);

    expect(() => normalizeVfsPath("C:/Windows/System32")).toThrow(/absolute/i);
    expect(() => normalizeVfsPath("c:\\Windows\\System32")).toThrow(/absolute/i);
    expect(() => normalizeVfsPath("/C:/Windows/System32")).toThrow(/absolute/i);

    expect(() => normalizeVfsPath("CON")).toThrow(/reserved/i);
    expect(() => normalizeVfsPath("con.txt")).toThrow(/reserved/i);
    expect(() => normalizeVfsPath("lpt1")).toThrow(/reserved/i);
    expect(normalizeVfsPath("console.txt")).toBe("console.txt");

    expect(() => normalizeVfsPath("a/<b>")).toThrow(/segment/i);
    expect(() => normalizeVfsPath("a/b:c")).toThrow(/segment/i);
    expect(() => normalizeVfsPath("a/\u0001b")).toThrow(/segment/i);
  });

  it("provides dirname/basename/join helpers (all normalized)", () => {
    expect(dirnameVfsPath("")).toBe("");
    expect(basenameVfsPath("")).toBe("");

    expect(dirnameVfsPath("a/b/c.txt")).toBe("a/b");
    expect(dirnameVfsPath("a")).toBe("");
    expect(basenameVfsPath("a/b/c.txt")).toBe("c.txt");
    expect(basenameVfsPath("a")).toBe("a");

    expect(joinVfsPath("", "")).toBe("");
    expect(joinVfsPath("", "a")).toBe("a");
    expect(joinVfsPath("a", "")).toBe("a");
    expect(joinVfsPath("a/", "/b/c.txt")).toBe("a/b/c.txt");

    expect(() => joinVfsPath("a", "../b")).toThrow(/traversal/i);
    expect(() => basenameVfsPath("CON")).toThrow(/reserved/i);
  });
});

