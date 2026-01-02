import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isScanWorkerAvailable,
  terminateScanWorker,
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
});
