/**
 * vfs-scan-async.js 测试
 *
 * 覆盖异步扫描功能：scanOpfsAsync, createWorkerListFiles,
 * isScanWorkerAvailable, terminateScanWorker
 *
 * 注意：Worker 相关代码路径需要在浏览器环境测试，
 * 此处仅测试 Node.js 环境下的 fallback 路径。
 */
import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";

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
      assert.equal(available, false);
    });
  });

  describe("terminateScanWorker", () => {
    it("does nothing when no worker exists", () => {
      // 应该不抛错
      assert.doesNotThrow(() => {
        terminateScanWorker();
      });
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
        assert.deepEqual(result, []);
      });

      it("returns empty array when worker unavailable and no fallback", async () => {
        // Node.js 环境 Worker 不可用
        const result = await scanOpfsAsync({
          prefix: "data",
          recursive: true,
        });
        assert.deepEqual(result, []);
      });

      it("uses fallbackListFiles when provided", async () => {
        const mockFiles = ["file1.txt", "dir/file2.txt", "dir/sub/file3.txt"];
        const fallback = mock.fn(async (prefix, recursive) => {
          return mockFiles.filter((f) => f.startsWith(prefix || ""));
        });

        const result = await scanOpfsAsync({
          prefix: "dir",
          recursive: true,
          useWorker: false,
          fallbackListFiles: fallback,
        });

        assert.equal(fallback.mock.calls.length, 1);
        assert.deepEqual(fallback.mock.calls[0].arguments, ["dir", true]);
        assert.deepEqual(result, ["dir/file2.txt", "dir/sub/file3.txt"]);
      });

      it("respects maxFiles limit with fallback", async () => {
        const mockFiles = ["a.txt", "b.txt", "c.txt", "d.txt", "e.txt"];
        const fallback = mock.fn(async () => mockFiles);

        const result = await scanOpfsAsync({
          maxFiles: 3,
          useWorker: false,
          fallbackListFiles: fallback,
        });

        assert.equal(result.length, 3);
        assert.deepEqual(result, ["a.txt", "b.txt", "c.txt"]);
      });

      it("returns all files when maxFiles is 0 (unlimited)", async () => {
        const mockFiles = ["a.txt", "b.txt"];
        const fallback = mock.fn(async () => mockFiles);

        const result = await scanOpfsAsync({
          maxFiles: 0,
          useWorker: false,
          fallbackListFiles: fallback,
        });

        assert.deepEqual(result, mockFiles);
      });

      it("returns empty array on fallback error (non-abort)", async () => {
        const fallback = mock.fn(async () => {
          throw new Error("Network error");
        });

        const result = await scanOpfsAsync({
          useWorker: false,
          fallbackListFiles: fallback,
        });

        assert.deepEqual(result, []);
      });

      it("re-throws abort errors from fallback", async () => {
        const fallback = mock.fn(async () => {
          throw new Error("scan: aborted");
        });

        await assert.rejects(
          () =>
            scanOpfsAsync({
              useWorker: false,
              fallbackListFiles: fallback,
            }),
          { message: "scan: aborted" }
        );
      });

      it("handles non-array fallback result gracefully", async () => {
        const fallback = mock.fn(async () => null);

        const result = await scanOpfsAsync({
          useWorker: false,
          fallbackListFiles: fallback,
        });

        assert.deepEqual(result, []);
      });
    });

    describe("AbortSignal handling", () => {
      it("throws immediately if signal already aborted", async () => {
        const controller = new AbortController();
        controller.abort();

        await assert.rejects(
          () =>
            scanOpfsAsync({
              signal: controller.signal,
              useWorker: false,
            }),
          { message: "scan: aborted" }
        );
      });

      it("throws if signal aborts during fallback execution", async () => {
        const controller = new AbortController();
        const fallback = mock.fn(async () => {
          // 模拟异步操作期间 abort
          controller.abort();
          return ["file.txt"];
        });

        await assert.rejects(
          () =>
            scanOpfsAsync({
              signal: controller.signal,
              useWorker: false,
              fallbackListFiles: fallback,
            }),
          { message: "scan: aborted" }
        );
      });

      it("does not throw if signal not aborted", async () => {
        const controller = new AbortController();
        const fallback = mock.fn(async () => ["file.txt"]);

        const result = await scanOpfsAsync({
          signal: controller.signal,
          useWorker: false,
          fallbackListFiles: fallback,
        });

        assert.deepEqual(result, ["file.txt"]);
      });
    });

    describe("parameter handling", () => {
      it("accepts empty options object", async () => {
        const result = await scanOpfsAsync({});
        assert.deepEqual(result, []);
      });

      it("accepts no options at all", async () => {
        const result = await scanOpfsAsync();
        assert.deepEqual(result, []);
      });

      it("passes prefix and recursive to fallback", async () => {
        const fallback = mock.fn(async (prefix, recursive) => {
          return [`${prefix}/test.txt`];
        });

        await scanOpfsAsync({
          prefix: "myprefix",
          recursive: false,
          useWorker: false,
          fallbackListFiles: fallback,
        });

        assert.deepEqual(fallback.mock.calls[0].arguments, ["myprefix", false]);
      });

      it("uses default values for optional params", async () => {
        const fallback = mock.fn(async (prefix, recursive) => {
          assert.equal(prefix, "");
          assert.equal(recursive, true);
          return [];
        });

        await scanOpfsAsync({
          useWorker: false,
          fallbackListFiles: fallback,
        });

        assert.equal(fallback.mock.calls.length, 1);
      });
    });
  });

  describe("createWorkerListFiles", () => {
    it("returns a function", () => {
      const listFiles = createWorkerListFiles("test-root");
      assert.equal(typeof listFiles, "function");
    });

    it("returned function returns empty array in Node.js (no worker)", async () => {
      const listFiles = createWorkerListFiles("test-root");
      const result = await listFiles({ prefix: "data" });
      assert.deepEqual(result, []);
    });

    it("returned function accepts options", async () => {
      const listFiles = createWorkerListFiles("test-root");
      const result = await listFiles({
        prefix: "docs",
        recursive: false,
        maxFiles: 10,
      });
      assert.deepEqual(result, []);
    });

    it("returned function works with empty options", async () => {
      const listFiles = createWorkerListFiles("test-root");
      const result = await listFiles({});
      assert.deepEqual(result, []);
    });

    it("returned function works without options", async () => {
      const listFiles = createWorkerListFiles("test-root");
      const result = await listFiles();
      assert.deepEqual(result, []);
    });

    it("returned function respects AbortSignal", async () => {
      const listFiles = createWorkerListFiles("test-root");
      const controller = new AbortController();
      controller.abort();

      await assert.rejects(() => listFiles({ signal: controller.signal }), {
        message: "scan: aborted",
      });
    });
  });

  describe("edge cases", () => {
    it("handles undefined fallback result", async () => {
      const fallback = mock.fn(async () => undefined);

      const result = await scanOpfsAsync({
        useWorker: false,
        fallbackListFiles: fallback,
      });

      // undefined 被视为非数组，返回空数组
      assert.deepEqual(result, []);
    });

    it("handles object fallback result", async () => {
      const fallback = mock.fn(async () => ({ files: ["a.txt"] }));

      const result = await scanOpfsAsync({
        useWorker: false,
        fallbackListFiles: fallback,
      });

      assert.deepEqual(result, []);
    });

    it("handles empty string prefix", async () => {
      const fallback = mock.fn(async (prefix) => {
        assert.equal(prefix, "");
        return ["root.txt"];
      });

      const result = await scanOpfsAsync({
        prefix: "",
        useWorker: false,
        fallbackListFiles: fallback,
      });

      assert.deepEqual(result, ["root.txt"]);
    });

    it("handles deeply nested prefix", async () => {
      const fallback = mock.fn(async (prefix) => {
        return [`${prefix}/file.txt`];
      });

      const result = await scanOpfsAsync({
        prefix: "a/b/c/d/e",
        useWorker: false,
        fallbackListFiles: fallback,
      });

      assert.deepEqual(result, ["a/b/c/d/e/file.txt"]);
    });

    it("handles large file list with maxFiles", async () => {
      const largeList = Array.from({ length: 10000 }, (_, i) => `file${i}.txt`);
      const fallback = mock.fn(async () => largeList);

      const result = await scanOpfsAsync({
        maxFiles: 100,
        useWorker: false,
        fallbackListFiles: fallback,
      });

      assert.equal(result.length, 100);
      assert.equal(result[0], "file0.txt");
      assert.equal(result[99], "file99.txt");
    });

    it("handles concurrent scans", async () => {
      let callCount = 0;
      const fallback = mock.fn(async (prefix) => {
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

      assert.equal(fallback.mock.calls.length, 3);
      // 结果应该都是独立的
      assert.ok(result1[0].startsWith("a/"));
      assert.ok(result2[0].startsWith("b/"));
      assert.ok(result3[0].startsWith("c/"));
    });

    it("handles fallback throwing non-Error", async () => {
      const fallback = mock.fn(async () => {
        throw "string error";
      });

      const result = await scanOpfsAsync({
        useWorker: false,
        fallbackListFiles: fallback,
      });

      // 非 abort 错误静默降级为空数组
      assert.deepEqual(result, []);
    });

    it("handles fallback returning frozen array", async () => {
      const frozen = Object.freeze(["a.txt", "b.txt"]);
      const fallback = mock.fn(async () => frozen);

      const result = await scanOpfsAsync({
        maxFiles: 1,
        useWorker: false,
        fallbackListFiles: fallback,
      });

      assert.deepEqual(result, ["a.txt"]);
    });
  });

  describe("useWorker flag", () => {
    it("disables worker when useWorker=false", async () => {
      const fallback = mock.fn(async () => ["test.txt"]);

      const result = await scanOpfsAsync({
        useWorker: false,
        fallbackListFiles: fallback,
      });

      // 应该使用 fallback
      assert.equal(fallback.mock.calls.length, 1);
      assert.deepEqual(result, ["test.txt"]);
    });

    it("tries worker first when useWorker=true (falls back in Node.js)", async () => {
      const fallback = mock.fn(async () => ["test.txt"]);

      // Node.js 环境 Worker 不可用，会回退
      const result = await scanOpfsAsync({
        useWorker: true,
        fallbackListFiles: fallback,
      });

      // 由于 Worker 不可用，应该使用 fallback
      assert.equal(fallback.mock.calls.length, 1);
      assert.deepEqual(result, ["test.txt"]);
    });

    it("returns empty when useWorker=true and no fallback in Node.js", async () => {
      const result = await scanOpfsAsync({
        useWorker: true,
      });

      // Worker 不可用，无 fallback，静默返回空数组
      assert.deepEqual(result, []);
    });
  });

  describe("progress callback (fallback mode)", () => {
    it("does not call onProgress in fallback mode", async () => {
      const onProgress = mock.fn();
      const fallback = mock.fn(async () => ["a.txt", "b.txt"]);

      await scanOpfsAsync({
        useWorker: false,
        fallbackListFiles: fallback,
        onProgress,
      });

      // fallback 模式不触发 progress 回调
      assert.equal(onProgress.mock.calls.length, 0);
    });
  });

  describe("rootDirName parameter", () => {
    it("passes rootDirName to worker (ignored in fallback)", async () => {
      // 在 Node.js 环境，rootDirName 会被传递但 fallback 不使用它
      const fallback = mock.fn(async () => ["test.txt"]);

      const result = await scanOpfsAsync({
        rootDirName: "my-opfs-root",
        useWorker: false,
        fallbackListFiles: fallback,
      });

      assert.deepEqual(result, ["test.txt"]);
    });
  });
});
