import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../js/agents/shared/index.js", () => ({
  isNodeLike: vi.fn(() => true),
}));

import { createUnifiedDiff } from "../../../../js/agents/vfs/diff.js";

describe("createUnifiedDiff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a unified diff for a line replacement with default context", () => {
    const result = createUnifiedDiff({
      path: "demo.txt",
      beforeText: "a\nb\nc\n",
      afterText: "a\nx\nc\n",
    });

    expect(result.hunks).toHaveLength(1);
    expect(result.hunks[0]).toEqual({
      aStart: 1,
      bStart: 1,
      aCount: 3,
      bCount: 3,
      lines: [
        { tag: " ", line: "a" },
        { tag: "-", line: "b" },
        { tag: "+", line: "x" },
        { tag: " ", line: "c" },
      ],
    });
    expect(result.text).toBe(
      "--- a/demo.txt\n+++ b/demo.txt\n@@ -1,3 +1,3 @@\n a\n-b\n+x\n c\n"
    );
  });

  it("clamps negative context to 0 and omits context lines", () => {
    const base = { beforeText: "a\nb\nc\n", afterText: "a\nx\nc\n", context: 0 };
    const zero = createUnifiedDiff(base);
    const negative = createUnifiedDiff({ ...base, context: -1 });

    expect(negative.text).toBe(zero.text);
    expect(zero.hunks).toHaveLength(1);
    expect(zero.hunks[0].lines).toEqual([
      { tag: "-", line: "b" },
      { tag: "+", line: "x" },
    ]);
    expect(zero.text).toBe("--- a/file\n+++ b/file\n@@ -2,1 +2,1 @@\n-b\n+x\n");
  });

  it("falls back to default context for string values and uses full context for MAX_SAFE_INTEGER", () => {
    const before = "l1\nl2\nl3\nl4\nl5\nl6\n";
    const after = "l1\nl2\nX\nl4\nl5\nl6\n";
    const defaultContext = createUnifiedDiff({ beforeText: before, afterText: after });
    const stringContext = createUnifiedDiff({ beforeText: before, afterText: after, context: "2" });

    expect(stringContext.text).toBe(defaultContext.text);

    const largeBefore = ["l1", "l2", "l3", "l4", "l5", "l6", "l7", "l8", "l9", "l10"].join("\n");
    const largeAfter = ["l1", "l2", "l3", "l4", "l5", "X", "l7", "l8", "l9", "l10"].join("\n");
    const maxContext = createUnifiedDiff({
      beforeText: largeBefore,
      afterText: largeAfter,
      context: Number.MAX_SAFE_INTEGER,
    });

    expect(maxContext.hunks).toHaveLength(1);
    expect(maxContext.hunks[0].aCount).toBe(10);
    expect(maxContext.hunks[0].bCount).toBe(10);
  });

  it("handles null/undefined/empty inputs for beforeText and afterText", () => {
    const cases = [
      { beforeText: null, afterText: undefined },
      { beforeText: "", afterText: "" },
      { beforeText: [], afterText: [] },
      { beforeText: {}, afterText: {} },
    ];

    for (const entry of cases) {
      const result = createUnifiedDiff({ beforeText: entry.beforeText, afterText: entry.afterText });
      expect(result.hunks).toHaveLength(0);
      expect(result.text).toBe("--- a/file\n+++ b/file");
    }
  });

  it("preserves whitespace-only lines and falls back to default path", () => {
    const result = createUnifiedDiff({ path: "", beforeText: "   ", afterText: "  " });
    const diffLines = result.text
      .split("\n")
      .filter(
        (line) =>
          (line.startsWith("-") && !line.startsWith("---")) ||
          (line.startsWith("+") && !line.startsWith("+++"))
      );

    expect(result.text.startsWith("--- a/file\n+++ b/file")).toBe(true);
    expect(diffLines).toEqual(["-   ", "+  "]);
  });

  it("stringifies object inputs via toString", () => {
    const beforeObj = { toString: () => "one\ntwo\nthree" };
    const afterObj = { toString: () => "one\nTWO\nthree" };
    const result = createUnifiedDiff({ beforeText: beforeObj, afterText: afterObj, context: 1 });

    expect(result.hunks).toHaveLength(1);
    expect(result.hunks[0].lines).toEqual(
      expect.arrayContaining([
        { tag: "-", line: "two" },
        { tag: "+", line: "TWO" },
      ])
    );
  });

  it("supports concurrent calls without shared state", async () => {
    const [first, second] = await Promise.all([
      Promise.resolve().then(() =>
        createUnifiedDiff({
          path: "p1.txt",
          beforeText: "a\nb\n",
          afterText: "a\nc\n",
        })
      ),
      Promise.resolve().then(() =>
        createUnifiedDiff({
          path: "p2.txt",
          beforeText: "x\ny\n",
          afterText: "x\ny\nz\n",
        })
      ),
    ]);

    expect(first.text).toContain("--- a/p1.txt");
    expect(second.text).toContain("--- a/p2.txt");
    expect(first.text).not.toBe(second.text);
  });

  it("supports rapid consecutive calls with stable output", () => {
    const options = { beforeText: "a\nb\nc\n", afterText: "a\nx\nc\n" };
    const expected = createUnifiedDiff(options).text;

    for (let i = 0; i < 25; i++) {
      const result = createUnifiedDiff(options);
      expect(result.text).toBe(expected);
    }
  });

  it("handles large files, long lines, and deeply nested text", () => {
    const largeCount = 5000;
    const largeBeforeLines = Array.from({ length: largeCount }, (_, i) => `line-${i}`);
    const largeAfterLines = [...largeBeforeLines];
    largeAfterLines[2500] = "line-2500-changed";

    const largeResult = createUnifiedDiff({
      beforeText: largeBeforeLines.join("\n"),
      afterText: largeAfterLines.join("\n"),
      context: 0,
    });

    expect(largeResult.hunks).toHaveLength(1);
    expect(largeResult.hunks[0].lines).toEqual([
      { tag: "-", line: "line-2500" },
      { tag: "+", line: "line-2500-changed" },
    ]);

    const longBefore = "a".repeat(20000);
    const longAfter = `${"a".repeat(19999)}b`;
    const longResult = createUnifiedDiff({ beforeText: longBefore, afterText: longAfter, context: 0 });

    expect(longResult.hunks).toHaveLength(1);
    expect(longResult.hunks[0].lines[0].line.length).toBe(20000);
    expect(longResult.hunks[0].lines[1].line.endsWith("b")).toBe(true);

    const depth = 30;
    const nestedLines = [];
    for (let i = 0; i < depth; i++) nestedLines.push(`${"  ".repeat(i)}{`);
    const leafLine = `${"  ".repeat(depth)}\"leaf\": true`;
    nestedLines.push(leafLine);
    for (let i = depth - 1; i >= 0; i--) nestedLines.push(`${"  ".repeat(i)}}`);
    const nestedBefore = nestedLines.join("\n");
    const nestedAfter = nestedBefore.replace("\"leaf\": true", "\"leaf\": false");
    const nestedResult = createUnifiedDiff({ beforeText: nestedBefore, afterText: nestedAfter, context: 2 });

    expect(nestedResult.hunks).toHaveLength(1);
    expect(nestedResult.hunks[0].lines).toEqual(
      expect.arrayContaining([
        { tag: "-", line: leafLine },
        { tag: "+", line: leafLine.replace("true", "false") },
      ])
    );
  });

  it("throws when options is null", () => {
    expect(() => createUnifiedDiff(null)).toThrow(TypeError);
  });
});
