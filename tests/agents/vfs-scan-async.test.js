/**
 * vfs-scan-async.js 测试
 *
 * 覆盖异步扫描功能：scanOpfsAsync, createWorkerListFiles,
 * isScanWorkerAvailable, terminateScanWorker
 *
 * 注意：Worker 相关代码路径需要在浏览器环境测试，
 * 此处仅测试 Node.js 环境下的 fallback 路径。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  scanOpfsAsync,
  createWorkerListFiles,
  isScanWorkerAvailable,
  terminateScanWorker,
} from "../../js/agents/vfs/vfs-scan-async.js";

describe("vfs-scan-async", () => {
  describe("isScanWorkerAvailable", () => {
    it("returns false in Node.js environment (no Worker API)", () => {
      // Node.js 没有 Worker/navigator.storage.getDirectory
      const available = isScanWorkerAvailable();
      expect(available).toBe(false);
    });
  });

  describe("terminateScanWorker", () => {
    it("does nothing when no worker exists", () => {
      // 应该不抛错
      expect(() => {
        terminateScanWorker();
      }).not.toThrow();
    });

    it("can be called multiple times safely", () => {
      terminateScanWorker();
      terminateScanWorker();
      terminateScanWorker();
      // 无异常即通过
    });
  });

  describe("scanOpfsAsync", () => {
    describe("without Worker (fallback mode)", () => {
      it("returns empty array when no fallbackListFiles provided", async () => {
        const result = await scanOpfsAsync({
          prefix: "test",
          recursive: true,
          useWorker: false,
        });
        expect(result).toEqual([]);
      });

      it("returns empty array when worker unavailable and no fallback", async () => {
        // Node.js 环境 Worker 不可用
        const result = await scanOpfsAsync({
          prefix: "data",
          recursive: true,
        });
        expect(result).toEqual([]);
      });

      it("uses fallbackListFiles when provided", async () => {
        const mockFiles = ["file1.txt", "dir/file2.txt", "dir/sub/file3.txt"];
        const fallback = vi.fn(async (prefix, recursive) => {
          return mockFiles.filter((f) => f.startsWith(prefix || ""));
        });

        const result = await scanOpfsAsync({
          prefix: "dir",
          recursive: true,
          useWorker: false,
          fallbackListFiles: fallback,
        });

        expect(fallback.mock.calls.length).toBe(1);
        expect(fallback.mock.calls[0]).toEqual(["dir", true]);
        expect(result).toEqual(["dir/file2.txt", "dir/sub/file3.txt"]);
      });

      it("respects maxFiles limit with fallback", async () => {
        const mockFiles = ["a.txt", "b.txt", "c.txt", "d.txt", "e.txt"];
        const fallback = vi.fn(async () => mockFiles);

        const result = await scanOpfsAsync({
          maxFiles: 3,
          useWorker: false,
          fallbackListFiles: fallback,
        });

        expect(result.length).toBe(3);
        expect(result).toEqual(["a.txt", "b.txt", "c.txt"]);
      });

      it("returns all files when maxFiles is 0 (unlimited)", async () => {
        const mockFiles = ["a.txt", "b.txt"];
        const fallback = vi.fn(async () => mockFiles);

        const result = await scanOpfsAsync({
          maxFiles: 0,
          useWorker: false,
          fallbackListFiles: fallback,
        });

        expect(result).toEqual(mockFiles);
      });

      it("returns empty array on fallback error (non-abort)", async () => {
        const fallback = vi.fn(async () => {
          throw new Error("Network error");
        });

        const result = await scanOpfsAsync({
          useWorker: false,
          fallbackListFiles: fallback,
        });

        expect(result).toEqual([]);
      });

      it("re-throws abort errors from fallback", async () => {
        const fallback = vi.fn(async () => {
          throw new Error("scan: aborted");
        });

        await expect(
          scanOpfsAsync({
            useWorker: false,
            fallbackListFiles: fallback,
          })
        ).rejects.toThrow(/scan: aborted/);
      });

      it("handles non-array fallback result gracefully", async () => {
        const fallback = vi.fn(async () => null);

        const result = await scanOpfsAsync({
          useWorker: false,
          fallbackListFiles: fallback,
        });

        expect(result).toEqual([]);
      });
    });

    describe("AbortSignal handling", () => {
      it("throws immediately if signal already aborted", async () => {
        const controller = new AbortController();
        controller.abort();

        await expect(
          scanOpfsAsync({
            signal: controller.signal,
            useWorker: false,
          })
        ).rejects.toThrow(/scan: aborted/);
      });

      it("throws if signal aborts during fallback execution", async () => {
        const controller = new AbortController();
        const fallback = vi.fn(async () => {
          // 模拟异步操作期间 abort
          controller.abort();
          return ["file.txt"];
        });

        await expect(
          scanOpfsAsync({
            signal: controller.signal,
            useWorker: false,
            fallbackListFiles: fallback,
          })
        ).rejects.toThrow(/scan: aborted/);
      });

      it("does not throw if signal not aborted", async () => {
        const controller = new AbortController();
        const fallback = vi.fn(async () => ["file.txt"]);

        const result = await scanOpfsAsync({
          signal: controller.signal,
          useWorker: false,
          fallbackListFiles: fallback,
        });

        expect(result).toEqual(["file.txt"]);
      });
    });

    describe("parameter handling", () => {
      it("accepts empty options object", async () => {
        const result = await scanOpfsAsync({});
        expect(result).toEqual([]);
      });

      it("accepts no options at all", async () => {
        const result = await scanOpfsAsync();
        expect(result).toEqual([]);
      });

      it("passes prefix and recursive to fallback", async () => {
        const fallback = vi.fn(async (prefix, recursive) => {
          return [`${prefix}/test.txt`];
        });

        await scanOpfsAsync({
          prefix: "myprefix",
          recursive: false,
          useWorker: false,
          fallbackListFiles: fallback,
        });

        expect(fallback.mock.calls[0]).toEqual(["myprefix", false]);
      });

      it("uses default values for optional params", async () => {
        const fallback = vi.fn(async (prefix, recursive) => {
          expect(prefix).toBe("");
          expect(recursive).toBe(true);
          return [];
        });

        await scanOpfsAsync({
          useWorker: false,
          fallbackListFiles: fallback,
        });

        expect(fallback.mock.calls.length).toBe(1);
      });
    });
  });

  describe("createWorkerListFiles", () => {
    it("returns a function", () => {
      const listFiles = createWorkerListFiles("test-root");
      expect(typeof listFiles).toBe("function");
    });

    it("returned function returns empty array in Node.js (no worker)", async () => {
      const listFiles = createWorkerListFiles("test-root");
      const result = await listFiles({ prefix: "data" });
      expect(result).toEqual([]);
    });

    it("returned function accepts options", async () => {
      const listFiles = createWorkerListFiles("test-root");
      const result = await listFiles({
        prefix: "docs",
        recursive: false,
        maxFiles: 10,
      });
      expect(result).toEqual([]);
    });

    it("returned function works with empty options", async () => {
      const listFiles = createWorkerListFiles("test-root");
      const result = await listFiles({});
      expect(result).toEqual([]);
    });

    it("returned function works without options", async () => {
      const listFiles = createWorkerListFiles("test-root");
      const result = await listFiles();
      expect(result).toEqual([]);
    });

    it("returned function respects AbortSignal", async () => {
      const listFiles = createWorkerListFiles("test-root");
      const controller = new AbortController();
      controller.abort();

      await expect(listFiles({ signal: controller.signal })).rejects.toThrow(/scan: aborted/);
    });
  });

  describe("edge cases", () => {
    it("handles undefined fallback result", async () => {
      const fallback = vi.fn(async () => undefined);

      const result = await scanOpfsAsync({
        useWorker: false,
        fallbackListFiles: fallback,
      });

      // undefined 被视为非数组，返回空数组
      expect(result).toEqual([]);
    });

    it("handles object fallback result", async () => {
      const fallback = vi.fn(async () => ({ files: ["a.txt"] }));

      const result = await scanOpfsAsync({
        useWorker: false,
        fallbackListFiles: fallback,
      });

      expect(result).toEqual([]);
    });

    it("handles empty string prefix", async () => {
      const fallback = vi.fn(async (prefix) => {
        expect(prefix).toBe("");
        return ["root.txt"];
      });

      const result = await scanOpfsAsync({
        prefix: "",
        useWorker: false,
        fallbackListFiles: fallback,
      });

      expect(result).toEqual(["root.txt"]);
    });

    it("handles deeply nested prefix", async () => {
      const fallback = vi.fn(async (prefix) => {
        return [`${prefix}/file.txt`];
      });

      const result = await scanOpfsAsync({
        prefix: "a/b/c/d/e",
        useWorker: false,
        fallbackListFiles: fallback,
      });

      expect(result).toEqual(["a/b/c/d/e/file.txt"]);
    });

    it("handles large file list with maxFiles", async () => {
      const largeList = Array.from({ length: 10000 }, (_, i) => `file${i}.txt`);
      const fallback = vi.fn(async () => largeList);

      const result = await scanOpfsAsync({
        maxFiles: 100,
        useWorker: false,
        fallbackListFiles: fallback,
      });

      expect(result.length).toBe(100);
      expect(result[0]).toBe("file0.txt");
      expect(result[99]).toBe("file99.txt");
    });

    it("handles concurrent scans", async () => {
      let callCount = 0;
      const fallback = vi.fn(async (prefix) => {
        callCount++;
        await new Promise((r) => setTimeout(r, 10));
        return [`${prefix}/file${callCount}.txt`];
      });

      const [result1, result2, result3] = await Promise.all([
        scanOpfsAsync({
          prefix: "a",
          useWorker: false,
          fallbackListFiles: fallback,
        }),
        scanOpfsAsync({
          prefix: "b",
          useWorker: false,
          fallbackListFiles: fallback,
        }),
        scanOpfsAsync({
          prefix: "c",
          useWorker: false,
          fallbackListFiles: fallback,
        }),
      ]);

      expect(fallback.mock.calls.length).toBe(3);
      // 结果应该都是独立的
      expect(result1[0].startsWith("a/")).toBeTruthy();
      expect(result2[0].startsWith("b/")).toBeTruthy();
      expect(result3[0].startsWith("c/")).toBeTruthy();
    });

    it("handles fallback throwing non-Error", async () => {
      const fallback = vi.fn(async () => {
        throw "string error";
      });

      const result = await scanOpfsAsync({
        useWorker: false,
        fallbackListFiles: fallback,
      });

      // 非 abort 错误静默降级为空数组
      expect(result).toEqual([]);
    });

    it("handles fallback returning frozen array", async () => {
      const frozen = Object.freeze(["a.txt", "b.txt"]);
      const fallback = vi.fn(async () => frozen);

      const result = await scanOpfsAsync({
        maxFiles: 1,
        useWorker: false,
        fallbackListFiles: fallback,
      });

      expect(result).toEqual(["a.txt"]);
    });
  });

  describe("useWorker flag", () => {
    it("disables worker when useWorker=false", async () => {
      const fallback = vi.fn(async () => ["test.txt"]);

      const result = await scanOpfsAsync({
        useWorker: false,
        fallbackListFiles: fallback,
      });

      // 应该使用 fallback
      expect(fallback.mock.calls.length).toBe(1);
      expect(result).toEqual(["test.txt"]);
    });

    it("tries worker first when useWorker=true (falls back in Node.js)", async () => {
      const fallback = vi.fn(async () => ["test.txt"]);

      // Node.js 环境 Worker 不可用，会回退
      const result = await scanOpfsAsync({
        useWorker: true,
        fallbackListFiles: fallback,
      });

      // 由于 Worker 不可用，应该使用 fallback
      expect(fallback.mock.calls.length).toBe(1);
      expect(result).toEqual(["test.txt"]);
    });

    it("returns empty when useWorker=true and no fallback in Node.js", async () => {
      const result = await scanOpfsAsync({
        useWorker: true,
      });

      // Worker 不可用，无 fallback，静默返回空数组
      expect(result).toEqual([]);
    });
  });

  describe("progress callback (fallback mode)", () => {
    it("does not call onProgress in fallback mode", async () => {
      const onProgress = vi.fn();
      const fallback = vi.fn(async () => ["a.txt", "b.txt"]);

      await scanOpfsAsync({
        useWorker: false,
        fallbackListFiles: fallback,
        onProgress,
      });

      // fallback 模式不触发 progress 回调
      expect(onProgress.mock.calls.length).toBe(0);
    });
  });

  describe("rootDirName parameter", () => {
    it("passes rootDirName to worker (ignored in fallback)", async () => {
      // 在 Node.js 环境，rootDirName 会被传递但 fallback 不使用它
      const fallback = vi.fn(async () => ["test.txt"]);

      const result = await scanOpfsAsync({
        rootDirName: "my-opfs-root",
        useWorker: false,
        fallbackListFiles: fallback,
      });

      expect(result).toEqual(["test.txt"]);
    });
  });
});
