/**
 * DependencyManager 测试
 */

import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert";

import {
  DependencyManager,
  PYODIDE_BUILTIN,
  parsePackageName,
  sha256,
} from "../../../js/agents/runtime/deps/dependency-manager.js";

describe("DependencyManager", () => {
  describe("parsePackageName", () => {
    it("should parse simple package name", () => {
      assert.strictEqual(parsePackageName("numpy"), "numpy");
    });

    it("should strip version constraints", () => {
      assert.strictEqual(parsePackageName("pandas>=1.0"), "pandas");
      assert.strictEqual(parsePackageName("scipy<2.0"), "scipy");
      assert.strictEqual(parsePackageName("pyyaml==6.0"), "pyyaml");
      assert.strictEqual(parsePackageName("requests~=2.28"), "requests");
    });

    it("should handle extras", () => {
      assert.strictEqual(parsePackageName("package[extra]>=1.0"), "package");
    });

    it("should lowercase package names", () => {
      assert.strictEqual(parsePackageName("NumPy"), "numpy");
    });
  });

  describe("PYODIDE_BUILTIN", () => {
    it("should include common scientific packages", () => {
      assert.ok(PYODIDE_BUILTIN.has("numpy"));
      assert.ok(PYODIDE_BUILTIN.has("pandas"));
      assert.ok(PYODIDE_BUILTIN.has("scipy"));
      assert.ok(PYODIDE_BUILTIN.has("matplotlib"));
    });

    it("should not include non-builtin packages", () => {
      assert.ok(!PYODIDE_BUILTIN.has("transformers"));
      assert.ok(!PYODIDE_BUILTIN.has("torch"));
    });
  });

  describe("sha256", () => {
    it("should compute hash for Uint8Array", async () => {
      const data = new Uint8Array([1, 2, 3, 4]);
      const hash = await sha256(data);
      assert.strictEqual(typeof hash, "string");
      assert.strictEqual(hash.length, 64); // SHA-256 = 64 hex chars
    });

    it("should produce consistent results", async () => {
      const data = new Uint8Array([1, 2, 3, 4]);
      const hash1 = await sha256(data);
      const hash2 = await sha256(data);
      assert.strictEqual(hash1, hash2);
    });
  });

  describe("constructor", () => {
    it("should create with defaults", () => {
      const mgr = new DependencyManager();
      assert.strictEqual(mgr.vfs, null);
      assert.strictEqual(mgr.cacheDir, "/cache/pyodide-wheels");
      assert.strictEqual(mgr.maxCacheBytes, 500 * 1024 * 1024);
    });

    it("should accept custom options", () => {
      const vfs = { readFile: () => {} };
      const mgr = new DependencyManager({
        vfs,
        cacheDir: "/custom/cache",
        maxCacheBytes: 100 * 1024 * 1024,
      });
      assert.strictEqual(mgr.vfs, vfs);
      assert.strictEqual(mgr.cacheDir, "/custom/cache");
      assert.strictEqual(mgr.maxCacheBytes, 100 * 1024 * 1024);
    });
  });

  describe("isBuiltin", () => {
    it("should return true for builtin packages", () => {
      const mgr = new DependencyManager();
      assert.strictEqual(mgr.isBuiltin("numpy"), true);
      assert.strictEqual(mgr.isBuiltin("pandas>=1.0"), true);
    });

    it("should return false for non-builtin packages", () => {
      const mgr = new DependencyManager();
      assert.strictEqual(mgr.isBuiltin("my-custom-package"), false);
    });
  });

  describe("resolve", () => {
    it("should categorize builtin packages", async () => {
      const mgr = new DependencyManager();
      const plan = await mgr.resolve({
        builtin: ["numpy", "pandas"],
      });

      assert.deepStrictEqual(plan.builtin, ["numpy", "pandas"]);
      assert.deepStrictEqual(plan.micropip, []);
      assert.deepStrictEqual(plan.wheels, []);
    });

    it("should categorize micropip packages", async () => {
      const mgr = new DependencyManager();
      const plan = await mgr.resolve({
        micropip: ["tabulate>=0.9", "pyyaml"],
      });

      assert.deepStrictEqual(plan.builtin, []);
      assert.deepStrictEqual(plan.micropip, ["tabulate>=0.9", "pyyaml"]);
    });

    it("should fallback non-builtin to micropip", async () => {
      const mgr = new DependencyManager();
      const plan = await mgr.resolve({
        builtin: ["unknown-package"],
      });

      assert.deepStrictEqual(plan.builtin, []);
      assert.deepStrictEqual(plan.micropip, ["unknown-package"]);
    });

    it("should not duplicate already loaded packages", async () => {
      const mgr = new DependencyManager();
      mgr.markLoaded(["numpy"]);

      const plan = await mgr.resolve({
        builtin: ["numpy", "pandas"],
      });

      assert.deepStrictEqual(plan.builtin, ["pandas"]);
    });

    it("should pass through wheels", async () => {
      const mgr = new DependencyManager();
      const plan = await mgr.resolve({
        wheels: [{ url: "https://example.com/pkg.whl" }],
      });

      assert.strictEqual(plan.wheels.length, 1);
      assert.strictEqual(plan.wheels[0].url, "https://example.com/pkg.whl");
    });
  });

  describe("generateLoadScript", () => {
    it("should generate builtin load script", () => {
      const mgr = new DependencyManager();
      const script = mgr.generateLoadScript({
        builtin: ["numpy", "pandas"],
        micropip: [],
        wheels: [],
      });

      assert.ok(script.includes('pyodide.loadPackage(["numpy","pandas"])'));
    });

    it("should generate micropip install script", () => {
      const mgr = new DependencyManager();
      const script = mgr.generateLoadScript({
        builtin: [],
        micropip: ["tabulate"],
        wheels: [],
      });

      assert.ok(script.includes("pyodide.loadPackage('micropip')"));
      assert.ok(script.includes("micropip.install('tabulate')"));
    });

    it("should generate wheel install script", () => {
      const mgr = new DependencyManager();
      const script = mgr.generateLoadScript({
        builtin: [],
        micropip: [],
        wheels: [{ url: "https://example.com/pkg.whl" }],
      });

      assert.ok(script.includes("micropip.install('https://example.com/pkg.whl')"));
    });

    it("should use local path for cached wheels", () => {
      const mgr = new DependencyManager();
      const script = mgr.generateLoadScript({
        builtin: [],
        micropip: [],
        wheels: [{ url: "https://example.com/pkg.whl", cached: true, localPath: "/cache/pkg.whl" }],
      });

      assert.ok(script.includes("emfs:/cache/pkg.whl"));
    });

    it("should return empty string for no dependencies", () => {
      const mgr = new DependencyManager();
      const script = mgr.generateLoadScript({
        builtin: [],
        micropip: [],
        wheels: [],
      });

      assert.strictEqual(script, "");
    });
  });

  describe("markLoaded / isLoaded", () => {
    it("should track loaded packages", () => {
      const mgr = new DependencyManager();

      assert.strictEqual(mgr.isLoaded("numpy"), false);

      mgr.markLoaded(["numpy", "pandas>=1.0"]);

      assert.strictEqual(mgr.isLoaded("numpy"), true);
      assert.strictEqual(mgr.isLoaded("pandas"), true);
      assert.strictEqual(mgr.isLoaded("scipy"), false);
    });
  });

  describe("getCacheStats", () => {
    it("should return unavailable when no vfs", async () => {
      const mgr = new DependencyManager();
      const stats = await mgr.getCacheStats();

      assert.strictEqual(stats.available, false);
      assert.strictEqual(stats.totalSize, 0);
      assert.strictEqual(stats.fileCount, 0);
    });

    it("should return stats with vfs", async () => {
      const mockVfs = {
        list: mock.fn(() => [
          { name: "pkg1.whl", kind: "file" },
          { name: "pkg2.whl", kind: "file" },
        ]),
        stat: mock.fn(() => ({ size: 1024, mtime: Date.now() })),
      };

      const mgr = new DependencyManager({ vfs: mockVfs });
      const stats = await mgr.getCacheStats();

      assert.strictEqual(stats.available, true);
      assert.strictEqual(stats.fileCount, 2);
      assert.strictEqual(stats.totalSize, 2048);
    });
  });
});
