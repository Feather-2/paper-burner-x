/**
 * DependencyManager 测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  DependencyManager,
  PYODIDE_BUILTIN,
  parsePackageName,
  sha256,
} from '../../../../../js/agents/runtime/deps/dependency-manager.js';

describe("DependencyManager", () => {
  describe("parsePackageName", () => {
    it("should parse simple package name", () => {
      expect(parsePackageName("numpy")).toBe("numpy");
    });

    it("should strip version constraints", () => {
      expect(parsePackageName("pandas>=1.0")).toBe("pandas");
      expect(parsePackageName("scipy<2.0")).toBe("scipy");
      expect(parsePackageName("pyyaml==6.0")).toBe("pyyaml");
      expect(parsePackageName("requests~=2.28")).toBe("requests");
    });

    it("should handle extras", () => {
      expect(parsePackageName("package[extra]>=1.0")).toBe("package");
    });

    it("should lowercase package names", () => {
      expect(parsePackageName("NumPy")).toBe("numpy");
    });
  });

  describe("PYODIDE_BUILTIN", () => {
    it("should include common scientific packages", () => {
      expect(PYODIDE_BUILTIN.has("numpy")).toBe(true);
      expect(PYODIDE_BUILTIN.has("pandas")).toBe(true);
      expect(PYODIDE_BUILTIN.has("scipy")).toBe(true);
      expect(PYODIDE_BUILTIN.has("matplotlib")).toBe(true);
    });

    it("should not include non-builtin packages", () => {
      expect(PYODIDE_BUILTIN.has("transformers")).toBe(false);
      expect(PYODIDE_BUILTIN.has("torch")).toBe(false);
    });
  });

  describe("sha256", () => {
    it("should compute hash for Uint8Array", async () => {
      const data = new Uint8Array([1, 2, 3, 4]);
      const hash = await sha256(data);
      expect(typeof hash).toBe("string");
      expect(hash.length).toBe(64); // SHA-256 = 64 hex chars
    });

    it("should produce consistent results", async () => {
      const data = new Uint8Array([1, 2, 3, 4]);
      const hash1 = await sha256(data);
      const hash2 = await sha256(data);
      expect(hash1).toBe(hash2);
    });
  });

  describe("constructor", () => {
    it("should create with defaults", () => {
      const mgr = new DependencyManager();
      expect(mgr.vfs).toBe(null);
      expect(mgr.cacheDir).toBe("/cache/pyodide-wheels");
      expect(mgr.maxCacheBytes).toBe(500 * 1024 * 1024);
    });

    it("should accept custom options", () => {
      const vfs = { readFile: () => {} };
      const mgr = new DependencyManager({
        vfs,
        cacheDir: "/custom/cache",
        maxCacheBytes: 100 * 1024 * 1024,
      });
      expect(mgr.vfs).toBe(vfs);
      expect(mgr.cacheDir).toBe("/custom/cache");
      expect(mgr.maxCacheBytes).toBe(100 * 1024 * 1024);
    });
  });

  describe("isBuiltin", () => {
    it("should return true for builtin packages", () => {
      const mgr = new DependencyManager();
      expect(mgr.isBuiltin("numpy")).toBe(true);
      expect(mgr.isBuiltin("pandas>=1.0")).toBe(true);
    });

    it("should return false for non-builtin packages", () => {
      const mgr = new DependencyManager();
      expect(mgr.isBuiltin("my-custom-package")).toBe(false);
    });
  });

  describe("resolve", () => {
    it("should categorize builtin packages", async () => {
      const mgr = new DependencyManager();
      const plan = await mgr.resolve({
        builtin: ["numpy", "pandas"],
      });

      expect(plan.builtin).toEqual(["numpy", "pandas"]);
      expect(plan.micropip).toEqual([]);
      expect(plan.wheels).toEqual([]);
    });

    it("should categorize micropip packages", async () => {
      const mgr = new DependencyManager();
      const plan = await mgr.resolve({
        micropip: ["tabulate>=0.9", "pyyaml"],
      });

      expect(plan.builtin).toEqual([]);
      expect(plan.micropip).toEqual(["tabulate>=0.9", "pyyaml"]);
    });

    it("should fallback non-builtin to micropip", async () => {
      const mgr = new DependencyManager();
      const plan = await mgr.resolve({
        builtin: ["unknown-package"],
      });

      expect(plan.builtin).toEqual([]);
      expect(plan.micropip).toEqual(["unknown-package"]);
    });

    it("should not duplicate already loaded packages", async () => {
      const mgr = new DependencyManager();
      mgr.markLoaded(["numpy"]);

      const plan = await mgr.resolve({
        builtin: ["numpy", "pandas"],
      });

      expect(plan.builtin).toEqual(["pandas"]);
    });

    it("should pass through wheels", async () => {
      const mgr = new DependencyManager();
      const plan = await mgr.resolve({
        wheels: [{ url: "https://example.com/pkg.whl" }],
      });

      expect(plan.wheels.length).toBe(1);
      expect(plan.wheels[0].url).toBe("https://example.com/pkg.whl");
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

      expect(script).toContain('__pb_builtin = ["numpy","pandas"]');
      expect(script).toContain("pyodide.loadPackage(__pb_builtin)");
    });

    it("should generate micropip install script", () => {
      const mgr = new DependencyManager();
      const script = mgr.generateLoadScript({
        builtin: [],
        micropip: ["tabulate"],
        wheels: [],
      });

      expect(script).toContain("pyodide.loadPackage('micropip')");
      expect(script).toContain('__pb_micropip = ["tabulate"]');
    });

    it("should generate wheel install script", () => {
      const mgr = new DependencyManager();
      const script = mgr.generateLoadScript({
        builtin: [],
        micropip: [],
        wheels: [{ url: "https://example.com/pkg.whl" }],
      });

      expect(script).toContain('__pb_wheels = ["https://example.com/pkg.whl"]');
    });

    it("should use local path for cached wheels", () => {
      const mgr = new DependencyManager();
      const script = mgr.generateLoadScript({
        builtin: [],
        micropip: [],
        wheels: [{ url: "https://example.com/pkg.whl", cached: true, localPath: "/cache/pkg.whl" }],
      });

      expect(script).toContain("emfs:/cache/pkg.whl");
    });

    it("should return empty string for no dependencies", () => {
      const mgr = new DependencyManager();
      const script = mgr.generateLoadScript({
        builtin: [],
        micropip: [],
        wheels: [],
      });

      // New implementation always generates template script (safe by design)
      expect(typeof script).toBe("string");
      expect(script).toContain("__pb_builtin = []");
    });
  });

  describe("markLoaded / isLoaded", () => {
    it("should track loaded packages", () => {
      const mgr = new DependencyManager();

      expect(mgr.isLoaded("numpy")).toBe(false);

      mgr.markLoaded(["numpy", "pandas>=1.0"]);

      expect(mgr.isLoaded("numpy")).toBe(true);
      expect(mgr.isLoaded("pandas")).toBe(true);
      expect(mgr.isLoaded("scipy")).toBe(false);
    });
  });

  describe("getCacheStats", () => {
    it("should return unavailable when no vfs", async () => {
      const mgr = new DependencyManager();
      const stats = await mgr.getCacheStats();

      expect(stats.available).toBe(false);
      expect(stats.totalSize).toBe(0);
      expect(stats.fileCount).toBe(0);
    });

    it("should return stats with vfs", async () => {
      const mockVfs = {
        list: vi.fn(() => [
          { name: "pkg1.whl", kind: "file" },
          { name: "pkg2.whl", kind: "file" },
        ]),
        stat: vi.fn(() => ({ size: 1024, mtime: Date.now() })),
      };

      const mgr = new DependencyManager({ vfs: mockVfs });
      const stats = await mgr.getCacheStats();

      expect(stats.available).toBe(true);
      expect(stats.fileCount).toBe(2);
      expect(stats.totalSize).toBe(2048);
    });
  });
});
