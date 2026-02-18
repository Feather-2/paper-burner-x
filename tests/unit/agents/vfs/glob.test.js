import { describe, it, expect, vi, beforeEach } from "vitest";

const { isNodeLikeMock, normalizeVfsPathMock, isScanWorkerAvailableMock, scanOpfsAsyncMock } = vi.hoisted(() => ({
  isNodeLikeMock: vi.fn(() => true),
  normalizeVfsPathMock: vi.fn((value) => String(value ?? "").replaceAll("\\", "/").trim()),
  isScanWorkerAvailableMock: vi.fn(() => false),
  scanOpfsAsyncMock: vi.fn(async () => []),
}));

vi.mock("../../../../js/agents/shared/index.js", () => ({
  isNodeLike: isNodeLikeMock,
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock("../../../../js/agents/vfs/path.js", () => ({ normalizeVfsPath: normalizeVfsPathMock }));

vi.mock("../../../../js/agents/vfs/vfs-scan-async.js", () => ({
  isScanWorkerAvailable: isScanWorkerAvailableMock,
  scanOpfsAsync: scanOpfsAsyncMock,
}));

import { expandBraces, globToRegExp, matchGlob, createVfsGlobFn } from "../../../../js/agents/vfs/glob.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("expandBraces", () => {
  it("expands simple brace groups and removes duplicates", () => {
    const result = expandBraces("a/{b,b,c}/d");
    expect(result).toEqual(["a/b/d", "a/c/d"]);
  });

  it("expands multiple brace groups over repeated passes", () => {
    const result = expandBraces("src/{a,b}/{c,d}.js");
    expect(result).toEqual([
      "src/a/c.js",
      "src/a/d.js",
      "src/b/c.js",
      "src/b/d.js",
    ]);
  });

  it("leaves invalid or empty brace expressions untouched", () => {
    expect(expandBraces("a/{}/b")).toEqual(["a/{}/b"]);
    expect(expandBraces("a/{b")).toEqual(["a/{b"]);
  });

  it("normalizes backslashes and trims whitespace", () => {
    const result = expandBraces("  a\\b\\{c,d}\\e  ");
    expect(result).toEqual(["a/b/c/e", "a/b/d/e"]);
  });

  it("handles nullish, empty, and object-like patterns", () => {
    const cases = [
      { pattern: null, expected: [""] },
      { pattern: undefined, expected: [""] },
      { pattern: "", expected: [""] },
      { pattern: "   ", expected: [""] },
      { pattern: [], expected: [""] },
      { pattern: {}, expected: ["[object Object]"] },
    ];

    for (const entry of cases) {
      expect(expandBraces(entry.pattern)).toEqual(entry.expected);
    }
  });

  it("handles numeric boundaries and numeric strings", () => {
    const max = Number.MAX_SAFE_INTEGER;

    expect(expandBraces(0)).toEqual(["0"]);
    expect(expandBraces(-1)).toEqual(["-1"]);
    expect(expandBraces(max)).toEqual([String(max)]);
    expect(expandBraces("42")).toEqual(["42"]);
  });

  it("handles long patterns without shared state", () => {
    const longPattern = "a".repeat(20000);
    const expected = [longPattern];

    for (let i = 0; i < 10; i += 1) {
      expect(expandBraces(longPattern)).toEqual(expected);
    }
  });
});

describe("globToRegExp", () => {
  it("supports * and ? wildcards with anchored matching", () => {
    const star = globToRegExp("src/*.js");
    expect(star.test("src/app.js")).toBe(true);
    expect(star.test("src/app.jsx")).toBe(false);
    expect(star.test("src/nested/app.js")).toBe(false);

    const question = globToRegExp("src/file?.js");
    expect(question.test("src/file1.js")).toBe(true);
    expect(question.test("src/file10.js")).toBe(false);
    expect(question.test("src/file/.js")).toBe(false);
  });

  it("supports ** and **/ patterns", () => {
    const globstar = globToRegExp("src/**/test.js");
    expect(globstar.test("src/test.js")).toBe(true);
    expect(globstar.test("src/deep/test.js")).toBe(true);
    expect(globstar.test("src/deep/nested/test.js")).toBe(true);

    const globstarNoSlash = globToRegExp("src/**.js");
    expect(globstarNoSlash.test("src/file.js")).toBe(true);
    expect(globstarNoSlash.test("src/deep/file.js")).toBe(true);
  });

  it("escapes regex metacharacters", () => {
    const plus = globToRegExp("a/+.js");
    expect(plus.test("a/+.js")).toBe(true);
    expect(plus.test("a/aa.js")).toBe(false);

    const bracket = globToRegExp("a/[b].js");
    expect(bracket.test("a/[b].js")).toBe(true);
    expect(bracket.test("a/b.js")).toBe(false);
  });

  it("normalizes backslashes and trims whitespace", () => {
    const re = globToRegExp("  src\\**\\file?.js  ");
    expect(re.test("src/file1.js")).toBe(true);
    expect(re.test("src/deep/file2.js")).toBe(true);
    expect(re.test("src/deep/file20.js")).toBe(false);
  });

  it("handles nullish, empty, and object-like patterns", () => {
    const emptyCases = [null, undefined, "", "   ", []];

    for (const pattern of emptyCases) {
      const re = globToRegExp(pattern);
      expect(re.test("")).toBe(true);
      expect(re.test(" ")).toBe(false);
    }

    const objPattern = globToRegExp({});
    expect(objPattern.test("[object Object]")).toBe(true);
    expect(objPattern.test("object Object")).toBe(false);
  });

  it("handles numeric boundaries and numeric strings", () => {
    const max = Number.MAX_SAFE_INTEGER;

    expect(globToRegExp(0).test("0")).toBe(true);
    expect(globToRegExp(-1).test("-1")).toBe(true);
    expect(globToRegExp(max).test(String(max))).toBe(true);
    expect(globToRegExp("42").test("42")).toBe(true);
    expect(globToRegExp("42").test("0042")).toBe(false);
  });

  it("handles long literal patterns", () => {
    const longPattern = "a".repeat(10000);
    const re = globToRegExp(longPattern);

    expect(re.test(longPattern)).toBe(true);
    expect(re.test(`${longPattern}b`)).toBe(false);
  });
});

describe("matchGlob", () => {
  it("matches brace expansions with wildcards", () => {
    const pattern = "{src,test}/*.js";

    expect(matchGlob(pattern, "src/app.js")).toBe(true);
    expect(matchGlob(pattern, "test/util.js")).toBe(true);
    expect(matchGlob(pattern, "lib/app.js")).toBe(false);
  });

  it("matches globstar patterns across nested directories", () => {
    const pattern = "src/**/file?.js";

    expect(matchGlob(pattern, "src/file1.js")).toBe(true);
    expect(matchGlob(pattern, "src/deep/file2.js")).toBe(true);
    expect(matchGlob(pattern, "src/deep/file20.js")).toBe(false);
  });

  it("normalizes paths via normalizeVfsPath", () => {
    const result = matchGlob("src/*.js", "  src\\app.js  ");

    expect(result).toBe(true);
    expect(normalizeVfsPathMock).toHaveBeenCalledWith("  src\\app.js  ");
  });

  it("handles empty, nullish, and array/object inputs", () => {
    const cases = [
      { pattern: null, path: "", expected: true },
      { pattern: undefined, path: "   ", expected: true },
      { pattern: "", path: "x", expected: false },
      { pattern: [], path: "", expected: true },
      { pattern: {}, path: "", expected: false },
    ];

    for (const entry of cases) {
      expect(matchGlob(entry.pattern, entry.path)).toBe(entry.expected);
    }
  });

  it("handles numeric boundaries and type coercion", () => {
    const max = Number.MAX_SAFE_INTEGER;

    expect(matchGlob(0, 0)).toBe(true);
    expect(matchGlob(-1, -1)).toBe(true);
    expect(matchGlob(max, String(max))).toBe(true);
    expect(matchGlob("42", 42)).toBe(true);

    const arrayLike = { 0: "a", length: 1 };
    expect(matchGlob("a", arrayLike)).toBe(false);
  });

  it("supports concurrent calls without shared state", async () => {
    const [first, second] = await Promise.all([
      Promise.resolve().then(() => matchGlob("src/*.js", "src/app.js")),
      Promise.resolve().then(() => matchGlob("lib/*.ts", "lib/index.ts")),
    ]);

    expect(first).toBe(true);
    expect(second).toBe(true);
  });

  it("supports rapid consecutive calls", () => {
    const expected = matchGlob("src/*.js", "src/app.js");

    for (let i = 0; i < 25; i += 1) {
      expect(matchGlob("src/*.js", "src/app.js")).toBe(expected);
    }
  });

  it("handles large paths and deep nesting", () => {
    const depth = 120;
    const deepPath = `${"dir/".repeat(depth)}file.txt`;
    const longSegment = "a".repeat(20000);
    const longPath = `root/${longSegment}.txt`;

    expect(matchGlob("**/file.txt", deepPath)).toBe(true);
    expect(matchGlob("root/*.txt", longPath)).toBe(true);
  });
});

describe("createVfsGlobFn worker fallbacks", () => {
  it("reports scan worker fallback when scan worker fails", async () => {
    isScanWorkerAvailableMock.mockReturnValue(true);
    scanOpfsAsyncMock.mockRejectedValueOnce(new Error("scan-failed"));

    const onWorkerFallback = vi.fn();
    const vfs = {
      listFiles: vi.fn(async () => ["src/a.js", "src/b.ts"]),
    };

    const globFn = createVfsGlobFn(vfs, {
      useScanWorker: true,
      useWorker: false,
      opfsRootDirName: "root",
      onWorkerFallback,
    });
    const result = await globFn({ pattern: "**/*.js", path: "src" });

    expect(result).toEqual(["src/a.js"]);
    expect(onWorkerFallback).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "scan_worker_failed" })
    );
  });

  it("falls back to main-thread filtering when worker transfer caps are exceeded", async () => {
    const originalWorker = globalThis.Worker;
    const originalCreateObjectURL = globalThis.URL?.createObjectURL;
    const originalRevokeObjectURL = globalThis.URL?.revokeObjectURL;

    class FakeWorker {
      constructor() {
        this.onmessage = null;
        this.onerror = null;
        this.postMessage = vi.fn();
        this.terminate = vi.fn();
      }
    }

    try {
      isNodeLikeMock.mockReturnValue(false);
      if (globalThis.URL) {
        globalThis.URL.createObjectURL = vi.fn(() => "blob:mock-url");
        globalThis.URL.revokeObjectURL = vi.fn(() => {});
      }
      globalThis.Worker = /** @type {any} */ (FakeWorker);

      const onWorkerFallback = vi.fn();
      const vfs = {
        listFiles: vi.fn(async () => ["src/a.js", "src/b.js", "src/c.ts"]),
      };
      const globFn = createVfsGlobFn(vfs, {
        useWorker: true,
        workerThresholdFiles: 1,
        maxWorkerTransferFiles: 1,
        onWorkerFallback,
      });

      const result = await globFn({ pattern: "**/*.js", path: "src" });
      expect(result).toEqual(["src/a.js", "src/b.js"]);
      expect(onWorkerFallback).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "worker_transfer_cap_exceeded" })
      );
    } finally {
      isNodeLikeMock.mockReturnValue(true);
      globalThis.Worker = originalWorker;
      if (globalThis.URL) {
        globalThis.URL.createObjectURL = originalCreateObjectURL;
        globalThis.URL.revokeObjectURL = originalRevokeObjectURL;
      }
    }
  });
});
