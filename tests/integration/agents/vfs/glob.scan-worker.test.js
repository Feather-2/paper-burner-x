import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("agents/vfs/glob (scan worker integration)", () => {
  it("uses scanOpfsAsync when scan worker is available", async () => {
    vi.resetModules();

    // Exercise the `fallbackListFiles` function inside glob.js by having our mocked scanOpfsAsync call it.
    const scanOpfsAsync = vi.fn(async (opts) => {
      const files = await opts.fallbackListFiles?.(opts.prefix, opts.recursive);
      return Array.isArray(files) ? files : [];
    });
    const isScanWorkerAvailable = vi.fn(() => true);

    vi.doMock("../../../js/agents/vfs/vfs-scan-async.js", () => ({
      isScanWorkerAvailable,
      scanOpfsAsync,
    }));

    const { createVfsGlobFn } = await import("../../../../js/agents/vfs/glob.js");

    const allFiles = ["base/dir/a.md", "base/dir/b.txt", "base/dir/sub/nested.md", "base/other/c.md"];
    const vfs = {
      listFiles: vi.fn(async ({ prefix }) => allFiles.filter((f) => !prefix || f.startsWith(prefix))),
      walkFiles: vi.fn(async function* () {
        throw new Error("unexpected walkFiles() call");
      }),
    };

    const globFn = createVfsGlobFn(vfs, {
      maxScanFiles: 100,
      useWorker: false,
      useScanWorker: true,
      opfsRootDirName: "opfs-root",
    });

    const out = await globFn({ pattern: "dir/*.md", path: "base" });
    expect(out).toEqual(["base/dir/a.md"]);

    expect(scanOpfsAsync).toHaveBeenCalledTimes(1);
    const opts = scanOpfsAsync.mock.calls[0][0];
    expect(opts.rootDirName).toBe("opfs-root");
    expect(opts.prefix).toBe("base/dir");
    expect(opts.recursive).toBe(true);
    expect(opts.maxFiles).toBe(100);
    expect(typeof opts.fallbackListFiles).toBe("function");

    // scanOpfsAsync called fallbackListFiles, which delegates to vfs.listFiles.
    expect(vfs.listFiles).toHaveBeenCalledWith({ prefix: "base/dir", recursive: true });
    expect(vfs.walkFiles).not.toHaveBeenCalled();
  });

  it("falls back to main-thread scanning when scan worker fails (non-abort errors)", async () => {
    vi.resetModules();

    const scanOpfsAsync = vi.fn(async () => {
      throw new Error("boom");
    });
    const isScanWorkerAvailable = vi.fn(() => true);

    vi.doMock("../../../js/agents/vfs/vfs-scan-async.js", () => ({
      isScanWorkerAvailable,
      scanOpfsAsync,
    }));

    const { createVfsGlobFn } = await import("../../../../js/agents/vfs/glob.js");

    const seen = [];
    const vfs = {
      async *walkFiles({ prefix }) {
        // The scan prefix should still be computed even if the scan worker fails.
        seen.push(prefix);
        yield "base/dir/a.md";
        yield "base/dir/b.txt";
      },
    };

    const globFn = createVfsGlobFn(vfs, {
      useWorker: false,
      useScanWorker: true,
      opfsRootDirName: "opfs-root",
    });

    const out = await globFn({ pattern: "dir/*.md", path: "base" });
    expect(out).toEqual(["base/dir/a.md"]);
    expect(seen).toEqual(["base/dir"]);

    expect(scanOpfsAsync).toHaveBeenCalledTimes(1);
  });

  it("normalizes scan-worker abort errors to 'glob: aborted'", async () => {
    vi.resetModules();

    const scanOpfsAsync = vi.fn(async () => {
      throw new Error("scan: aborted");
    });
    const isScanWorkerAvailable = vi.fn(() => true);

    vi.doMock("../../../js/agents/vfs/vfs-scan-async.js", () => ({
      isScanWorkerAvailable,
      scanOpfsAsync,
    }));

    const { createVfsGlobFn } = await import("../../../../js/agents/vfs/glob.js");

    const vfs = {
      listFiles: vi.fn(async () => ["base/dir/a.md"]),
    };

    const globFn = createVfsGlobFn(vfs, {
      useWorker: false,
      useScanWorker: true,
      opfsRootDirName: "opfs-root",
    });

    await expect(globFn({ pattern: "**/*.md", path: "base" })).rejects.toThrow("glob: aborted");
  });
});
