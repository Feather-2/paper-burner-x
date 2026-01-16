import { describe, it } from "node:test";
import assert from "node:assert/strict";

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
      assert.deepEqual(result, ["src/*.js"]);
    });

    it("expands single brace group", () => {
      const result = expandBraces("src/*.{js,ts}");
      assert.deepEqual(result, ["src/*.js", "src/*.ts"]);
    });

    it("expands multiple options", () => {
      const result = expandBraces("file.{a,b,c}");
      assert.deepEqual(result, ["file.a", "file.b", "file.c"]);
    });

    it("expands nested braces", () => {
      const result = expandBraces("{a,b}.{x,y}");
      // Should expand to: a.x, a.y, b.x, b.y
      assert.ok(result.includes("a.x"));
      assert.ok(result.includes("a.y"));
      assert.ok(result.includes("b.x"));
      assert.ok(result.includes("b.y"));
    });

    it("handles empty braces", () => {
      const result = expandBraces("src/{}.js");
      assert.deepEqual(result, ["src/{}.js"]);
    });

    it("handles unclosed brace", () => {
      const result = expandBraces("src/{a,b.js");
      assert.deepEqual(result, ["src/{a,b.js"]);
    });

    it("deduplicates results", () => {
      const result = expandBraces("{a,a,a}");
      assert.deepEqual(result, ["a"]);
    });

    it("normalizes backslashes", () => {
      const result = expandBraces("src\\*.{js,ts}");
      assert.ok(result[0].includes("/"));
      assert.ok(!result[0].includes("\\"));
    });

    it("handles null pattern", () => {
      const result = expandBraces(null);
      assert.deepEqual(result, [""]);
    });

    it("handles whitespace", () => {
      const result = expandBraces("  *.js  ");
      assert.deepEqual(result, ["*.js"]);
    });
  });

  describe("globToRegExp", () => {
    it("matches literal path", () => {
      const re = globToRegExp("src/index.js");
      assert.ok(re.test("src/index.js"));
      assert.ok(!re.test("src/other.js"));
    });

    it("matches single star wildcard", () => {
      const re = globToRegExp("src/*.js");
      assert.ok(re.test("src/index.js"));
      assert.ok(re.test("src/utils.js"));
      assert.ok(!re.test("src/sub/index.js"));
    });

    it("matches double star for any path", () => {
      const re = globToRegExp("src/**/*.js");
      assert.ok(re.test("src/index.js"));
      assert.ok(re.test("src/sub/index.js"));
      assert.ok(re.test("src/a/b/c/d.js"));
    });

    it("matches question mark for single char", () => {
      const re = globToRegExp("src/?.js");
      assert.ok(re.test("src/a.js"));
      assert.ok(re.test("src/b.js"));
      assert.ok(!re.test("src/ab.js"));
    });

    it("escapes regex special chars", () => {
      const re = globToRegExp("src/file.test.js");
      assert.ok(re.test("src/file.test.js"));
      assert.ok(!re.test("src/fileXtest.js"));
    });

    it("handles double star at start", () => {
      const re = globToRegExp("**/*.md");
      assert.ok(re.test("README.md"));
      assert.ok(re.test("docs/guide.md"));
      assert.ok(re.test("a/b/c/file.md"));
    });

    it("handles double star at end", () => {
      const re = globToRegExp("src/**");
      assert.ok(re.test("src/index.js"));
      assert.ok(re.test("src/sub/file.ts"));
    });
  });

  describe("matchGlob", () => {
    it("matches exact path", () => {
      assert.ok(matchGlob("src/index.js", "src/index.js"));
    });

    it("matches with wildcard", () => {
      assert.ok(matchGlob("src/*.js", "src/index.js"));
      assert.ok(!matchGlob("src/*.js", "src/sub/index.js"));
    });

    it("matches with double wildcard", () => {
      assert.ok(matchGlob("**/*.js", "src/sub/index.js"));
    });

    it("matches with brace expansion", () => {
      assert.ok(matchGlob("src/*.{js,ts}", "src/file.js"));
      assert.ok(matchGlob("src/*.{js,ts}", "src/file.ts"));
      assert.ok(!matchGlob("src/*.{js,ts}", "src/file.jsx"));
    });

    it("normalizes path", () => {
      assert.ok(matchGlob("src/*.js", "/src/index.js"));
      assert.ok(matchGlob("src/*.js", "src//index.js"));
    });

    it("returns false for non-matching", () => {
      assert.ok(!matchGlob("*.js", "file.ts"));
    });
  });

  describe("createVfsGlobFn", () => {
    it("returns null for null vfs", () => {
      const fn = createVfsGlobFn(null);
      assert.equal(fn, null);
    });

    it("returns null for vfs without listFiles or walkFiles", () => {
      const fn = createVfsGlobFn({});
      assert.equal(fn, null);
    });

    it("returns function for vfs with listFiles", () => {
      const vfs = {
        listFiles: async () => [],
      };
      const fn = createVfsGlobFn(vfs);
      assert.equal(typeof fn, "function");
    });

    it("returns function for vfs with walkFiles", () => {
      const vfs = {
        walkFiles: async () => [],
      };
      const fn = createVfsGlobFn(vfs);
      assert.equal(typeof fn, "function");
    });

    it("glob function returns matching files", async () => {
      const files = ["src/a.js", "src/b.js", "src/c.ts", "lib/d.js"];
      const vfs = {
        listFiles: async () => files,
      };
      const glob = createVfsGlobFn(vfs);
      const result = await glob({ pattern: "src/*.js" });
      assert.deepEqual(result.sort(), ["src/a.js", "src/b.js"]);
    });

    it("glob function respects maxScanFiles", async () => {
      const files = Array.from({ length: 100 }, (_, i) => `file${i}.js`);
      const vfs = {
        listFiles: async () => files,
      };
      const glob = createVfsGlobFn(vfs, { maxScanFiles: 10 });
      const result = await glob({ pattern: "*.js" });
      assert.ok(result.length <= 10);
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

      await assert.rejects(
        () => glob({ pattern: "*.js", signal: controller.signal }),
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
      assert.deepEqual(result.sort(), ["a.js", "b.ts"]);
    });
  });
});
