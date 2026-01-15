import { describe, expect, it } from "vitest";
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
      expect(available).toBe(false);
    });
  });

  describe("terminateScanWorker", () => {
    it("should not throw when called multiple times", () => {
      expect(() => {
        terminateScanWorker();
        terminateScanWorker();
      }).not.toThrow();
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

      expect(result).toEqual(mockFiles);
    });

    it("should return empty array when no fallback provided", async () => {
      const result = await scanOpfsAsync({
        rootDirName: "test-root",
        prefix: "",
        recursive: true,
      });

      expect(result).toEqual([]);
    });

    it("should respect maxFiles in fallback mode", async () => {
      const mockFiles = ["a.txt", "b.txt", "c.txt", "d.txt", "e.txt"];
      const fallbackListFiles = async () => mockFiles;

      const result = await scanOpfsAsync({
        rootDirName: "test-root",
        maxFiles: 3,
        fallbackListFiles,
      });

      expect(result).toHaveLength(3);
      expect(result).toEqual(["a.txt", "b.txt", "c.txt"]);
    });

    it("should throw on aborted signal", async () => {
      const ac = new AbortController();
      ac.abort();

      await expect(
        scanOpfsAsync({
          rootDirName: "test-root",
          signal: ac.signal,
        })
      ).rejects.toThrow(/aborted/i);
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
      expect(result).toEqual([]);
    });

    it("should propagate abort error from fallback", async () => {
      const fallbackListFiles = async () => {
        throw new Error("scan: aborted");
      };

      await expect(
        scanOpfsAsync({
          rootDirName: "test-root",
          fallbackListFiles,
        })
      ).rejects.toThrow(/aborted/i);
    });
  });
});
