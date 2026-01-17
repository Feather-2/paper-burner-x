
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  expandBraces,
  globToRegExp,
  matchGlob,
  createVfsGlobFn,
} from "../../js/agents/vfs/glob.js";

describe("vfs/glob", () => {
  describe("expandBraces", () => {
    it("returns single pattern without braces", () => {
      const result = expandBraces("src/*.js");
      expect(result).toEqual(["src/*.js"]);
    });

    it("expands single brace group", () => {
      const result = expandBraces("src/*.{js,ts}");
      expect(result).toEqual(["src/*.js", "src/*.ts"]);
    });

    it("expands multiple options", () => {
      const result = expandBraces("file.{a,b,c}");
      expect(result).toEqual(["file.a", "file.b", "file.c"]);
    });

    it("expands nested braces", () => {
      const result = expandBraces("{a,b}.{x,y}");
      // Should expand to: a.x, a.y, b.x, b.y
      expect(result).toContain("a.x");
      expect(result).toContain("a.y");
      expect(result).toContain("b.x");
      expect(result).toContain("b.y");
    });

    it("handles empty braces", () => {
      const result = expandBraces("src/{}.js");
      expect(result).toEqual(["src/{}.js"]);
    });

    it("handles unclosed brace", () => {
      const result = expandBraces("src/{a,b.js");
      expect(result).toEqual(["src/{a,b.js"]);
    });

    it("deduplicates results", () => {
      const result = expandBraces("{a,a,a}");
      expect(result).toEqual(["a"]);
    });

    it("normalizes backslashes", () => {
      const result = expandBraces("src\\*.{js,ts}");
      expect(result[0]).toContain("/");
      expect(result[0].includes("\\")).toBe(false);
    });

    it("handles null pattern", () => {
      const result = expandBraces(null);
      expect(result).toEqual([""]);
    });

    it("handles whitespace", () => {
      const result = expandBraces("  *.js  ");
      expect(result).toEqual(["*.js"]);
    });
  });

  describe("globToRegExp", () => {
    it("matches literal path", () => {
      const re = globToRegExp("src/index.js");
      expect(re.test("src/index.js")).toBe(true);
      expect(re.test("src/other.js")).toBe(false);
    });

    it("matches single star wildcard", () => {
      const re = globToRegExp("src/*.js");
      expect(re.test("src/index.js")).toBe(true);
      expect(re.test("src/utils.js")).toBe(true);
      expect(re.test("src/sub/index.js")).toBe(false);
    });

    it("matches double star for any path", () => {
      const re = globToRegExp("src/**/*.js");
      expect(re.test("src/index.js")).toBe(true);
      expect(re.test("src/sub/index.js")).toBe(true);
      expect(re.test("src/a/b/c/d.js")).toBe(true);
    });

    it("matches question mark for single char", () => {
      const re = globToRegExp("src/?.js");
      expect(re.test("src/a.js")).toBe(true);
      expect(re.test("src/b.js")).toBe(true);
      expect(re.test("src/ab.js")).toBe(false);
    });

    it("escapes regex special chars", () => {
      const re = globToRegExp("src/file.test.js");
      expect(re.test("src/file.test.js")).toBe(true);
      expect(re.test("src/fileXtest.js")).toBe(false);
    });

    it("handles double star at start", () => {
      const re = globToRegExp("**/*.md");
      expect(re.test("README.md")).toBe(true);
      expect(re.test("docs/guide.md")).toBe(true);
      expect(re.test("a/b/c/file.md")).toBe(true);
    });

    it("handles double star at end", () => {
      const re = globToRegExp("src/**");
      expect(re.test("src/index.js")).toBe(true);
      expect(re.test("src/sub/file.ts")).toBe(true);
    });
  });

  describe("matchGlob", () => {
    it("matches exact path", () => {
      expect(matchGlob("src/index.js", "src/index.js")).toBe(true);
    });

    it("matches with wildcard", () => {
      expect(matchGlob("src/*.js", "src/index.js")).toBe(true);
      expect(matchGlob("src/*.js", "src/sub/index.js")).toBe(false);
    });

    it("matches with double wildcard", () => {
      expect(matchGlob("**/*.js", "src/sub/index.js")).toBe(true);
    });

    it("matches with brace expansion", () => {
      expect(matchGlob("src/*.{js,ts}", "src/file.js")).toBe(true);
      expect(matchGlob("src/*.{js,ts}", "src/file.ts")).toBe(true);
      expect(matchGlob("src/*.{js,ts}", "src/file.jsx")).toBe(false);
    });

    it("normalizes path", () => {
      expect(matchGlob("src/*.js", "/src/index.js")).toBe(true);
      expect(matchGlob("src/*.js", "src//index.js")).toBe(true);
    });

    it("returns false for non-matching", () => {
      expect(matchGlob("*.js", "file.ts")).toBe(false);
    });
  });

  describe("createVfsGlobFn", () => {
    it("returns null for null vfs", () => {
      const fn = createVfsGlobFn(null);
      expect(fn).toBe(null);
    });

    it("returns null for vfs without listFiles or walkFiles", () => {
      const fn = createVfsGlobFn({});
      expect(fn).toBe(null);
    });

    it("returns function for vfs with listFiles", () => {
      const vfs = {
        listFiles: async () => [],
      };
      const fn = createVfsGlobFn(vfs);
      expect(typeof fn).toBe("function");
    });

    it("returns function for vfs with walkFiles", () => {
      const vfs = {
        walkFiles: async () => [],
      };
      const fn = createVfsGlobFn(vfs);
      expect(typeof fn).toBe("function");
    });

    it("glob function returns matching files", async () => {
      const files = ["src/a.js", "src/b.js", "src/c.ts", "lib/d.js"];
      const vfs = {
        listFiles: async () => files,
      };
      const glob = createVfsGlobFn(vfs);
      const result = await glob({ pattern: "src/*.js" });
      expect(result.sort()).toEqual(["src/a.js", "src/b.js"]);
    });

    it("glob function respects maxScanFiles", async () => {
      const files = Array.from({ length: 100 }, (_, i) => `file${i}.js`);
      const vfs = {
        listFiles: async () => files,
      };
      const glob = createVfsGlobFn(vfs, { maxScanFiles: 10 });
      const result = await glob({ pattern: "*.js" });
      expect(result.length).toBeLessThanOrEqual(10);
    });

    it("glob function handles abort signal", async () => {
      const controller = new AbortController();
      controller.abort();

      const vfs = {
        listFiles: async () => {
          return ["file.js"];
        },
      };
      const glob = createVfsGlobFn(vfs);

      await expect(() => glob({ pattern: "*.js", signal: controller.signal }),
        /abort/i
      );
    });

    it("glob function filters by brace expansion", async () => {
      const files = ["a.js", "b.ts", "c.jsx"];
      const vfs = {
        listFiles: async () => files,
      };
      const glob = createVfsGlobFn(vfs);
      const result = await glob({ pattern: "*.{js,ts}" });
      expect(result.sort()).toEqual(["a.js", "b.ts"]);
    });
  });
});
