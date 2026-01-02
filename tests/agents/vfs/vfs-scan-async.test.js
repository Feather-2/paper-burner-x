import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isScanWorkerAvailable,
  terminateScanWorker,
  scanOpfsAsync,
} from "../../../js/agents/vfs/vfs-scan-async.js";

describe("vfs-scan-async", () => {
  describe("isScanWorkerAvailable", () => {
    it("should return false in Node.js environment", () => {
      // Node.js doesn't have Worker + navigator.storage.getDirectory
      const available = isScanWorkerAvailable();
      assert.strictEqual(available, false);
    });
  });

  describe("terminateScanWorker", () => {
    it("should not throw when called multiple times", () => {
      assert.doesNotThrow(() => {
        terminateScanWorker();
        terminateScanWorker();
      });
    });
  });

  describe("scanOpfsAsync fallback", () => {
    it("should use fallbackListFiles when Worker unavailable", async () => {
      const mockFiles = ["a.txt", "b.txt", "dir/c.txt"];
      const fallbackListFiles = async (prefix, recursive) => {
        return mockFiles.filter((f) => !prefix || f.startsWith(prefix));
      };

      const result = await scanOpfsAsync({
        rootDirName: "test-root",
        prefix: "",
        recursive: true,
        fallbackListFiles,
      });

      assert.deepStrictEqual(result, mockFiles);
    });

    it("should return empty array when no fallback provided", async () => {
      const result = await scanOpfsAsync({
        rootDirName: "test-root",
        prefix: "",
        recursive: true,
      });

      assert.deepStrictEqual(result, []);
    });

    it("should respect maxFiles in fallback mode", async () => {
      const mockFiles = ["a.txt", "b.txt", "c.txt", "d.txt", "e.txt"];
      const fallbackListFiles = async () => mockFiles;

      const result = await scanOpfsAsync({
        rootDirName: "test-root",
        maxFiles: 3,
        fallbackListFiles,
      });

      assert.strictEqual(result.length, 3);
      assert.deepStrictEqual(result, ["a.txt", "b.txt", "c.txt"]);
    });

    it("should throw on aborted signal", async () => {
      const ac = new AbortController();
      ac.abort();

      await assert.rejects(
        scanOpfsAsync({
          rootDirName: "test-root",
          signal: ac.signal,
        }),
        /aborted/
      );
    });

    it("should handle fallback function errors gracefully", async () => {
      const fallbackListFiles = async () => {
        throw new Error("fallback failed");
      };

      const result = await scanOpfsAsync({
        rootDirName: "test-root",
        fallbackListFiles,
      });

      // 回退失败时返回空数组，不抛错
      assert.deepStrictEqual(result, []);
    });

    it("should propagate abort error from fallback", async () => {
      const fallbackListFiles = async () => {
        throw new Error("scan: aborted");
      };

      await assert.rejects(
        scanOpfsAsync({
          rootDirName: "test-root",
          fallbackListFiles,
        }),
        /aborted/
      );
    });
  });
});
