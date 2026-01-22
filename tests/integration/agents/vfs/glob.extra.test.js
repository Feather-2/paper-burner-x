import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("agents/vfs/glob (extra coverage cases)", () => {
  it("globToRegExp handles '**' not followed by '/' (matches across slashes)", async () => {
    const { globToRegExp } = await import("../../../../js/agents/vfs/glob.js");

    const re = globToRegExp("a/**.txt");
    expect(re.test("a/y.txt")).toBe(true);
    expect(re.test("a/x/y.txt")).toBe(true);
    expect(re.test("a/x/y.md")).toBe(false);
  });

  it("falls back to main-thread filtering when Worker construction fails", async () => {
    vi.resetModules();
    vi.doMock("../../../../js/agents/shared/platform.js", () => ({
      isNodeLike: () => false,
    }));

    // Simulate a browser-like environment with a broken Worker constructor.
    vi.stubGlobal(
      "Worker",
      class ThrowingWorker {
        constructor() {
          throw new Error("no worker");
        }
      }
    );

    const { createVfsGlobFn } = await import("../../../../js/agents/vfs/glob.js");

    const vfs = {
      listFiles: async () => ["a.md", "b.txt", "dir/c.md"],
    };
    const globFn = createVfsGlobFn(vfs, { useWorker: true, workerThresholdFiles: 1 });

    await expect(globFn({ pattern: "**/*.md", path: "" })).resolves.toEqual(["a.md", "dir/c.md"]);
  });
});

