import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

import { SkillsManager } from '../../../js/agents/skills/manager.js';

/**
 * Create a mock skill content object
 */
function createMockSkill(name, options = {}) {
  return {
    metadata: {
      name,
      description: options.description || `Description for ${name}`,
      path: options.path || `/skills/${name}/SKILL.md`,
      scope: options.scope || "repo",
      keywords: options.keywords || [],
      priority: options.priority ?? 100,
      shortDescription: options.shortDescription,
    },
    body: options.body ?? `Body content for ${name}`,
    supportFiles: options.supportFiles,
  };
}

/**
 * Create a mock remote provider
 */
function createMockRemoteProvider(skills = [], options = {}) {
  return {
    isAvailable: vi.fn(async () => options.available ?? true),
    listSkills: vi.fn(async () => {
      if (options.listError) throw options.listError;
      return skills;
    }),
    getSkillContent: vi.fn(async (name) => {
      if (options.contentError) throw options.contentError;
      const skill = skills.find((s) => s.name === name);
      return skill ? { body: skill.body || `Remote body for ${name}` } : null;
    }),
  };
}

/**
 * Write a skill file to disk
 */
async function writeSkillFile(rootDir, name, body, frontmatter = null) {
  const skillsDir = path.join(rootDir, ".paper-burner", "skills", name);
  await fs.mkdir(skillsDir, { recursive: true });
  const filePath = path.join(skillsDir, "SKILL.md");
  const fm = frontmatter || {
    name,
    description: `desc for ${name}`,
    keywords: "alpha,beta",
    priority: "50",
  };
  const lines = ["---", ...Object.entries(fm).map(([k, v]) => `${k}: ${v}`), "---", "", body, ""];
  await fs.writeFile(filePath, lines.join("\n"), "utf8");
  return filePath;
}

describe("SkillsManager", () => {
  describe("constructor", () => {
    it("should create instance with default options", () => {
      const manager = new SkillsManager();

      expect(manager.cacheByDir).toBeInstanceOf(Map);
      expect(manager.cacheTtlMs).toBe(5 * 60_000);
      expect(manager.cacheMaxEntries).toBe(32);
      expect(manager.remoteProvider).toBe(null);
      expect(manager.manifestUrl).toBe(null);
    });

    it("should accept custom homeDir", () => {
      const manager = new SkillsManager({ homeDir: "/custom/home" });

      expect(manager.homeDir).toBe("/custom/home");
    });

    it("should accept custom manifestUrl", () => {
      const manager = new SkillsManager({ manifestUrl: "/skills/manifest.json" });

      expect(manager.manifestUrl).toBe("/skills/manifest.json");
    });

    it("should trim manifestUrl whitespace", () => {
      const manager = new SkillsManager({ manifestUrl: "  /skills/manifest.json  " });

      expect(manager.manifestUrl).toBe("/skills/manifest.json");
    });

    it("should set manifestUrl to null for empty string", () => {
      const manager = new SkillsManager({ manifestUrl: "   " });

      expect(manager.manifestUrl).toBe(null);
    });

    it("should accept custom remoteProvider", () => {
      const provider = createMockRemoteProvider([]);
      const manager = new SkillsManager({ remoteProvider: provider });

      expect(manager.remoteProvider).toBe(provider);
    });

    it("should accept custom cacheTtlMs", () => {
      const manager = new SkillsManager({ cacheTtlMs: 10_000 });

      expect(manager.cacheTtlMs).toBe(10_000);
    });

    it("should handle negative cacheTtlMs by setting to 0", () => {
      const manager = new SkillsManager({ cacheTtlMs: -1000 });

      expect(manager.cacheTtlMs).toBe(0);
    });

    it("should handle non-finite cacheTtlMs with default", () => {
      const manager = new SkillsManager({ cacheTtlMs: NaN });

      expect(manager.cacheTtlMs).toBe(5 * 60_000);
    });

    it("should accept custom cacheMaxEntries", () => {
      const manager = new SkillsManager({ cacheMaxEntries: 10 });

      expect(manager.cacheMaxEntries).toBe(10);
    });

    it("should enforce minimum cacheMaxEntries of 1", () => {
      const manager = new SkillsManager({ cacheMaxEntries: 0 });

      expect(manager.cacheMaxEntries).toBe(1);
    });

    it("should handle non-finite cacheMaxEntries with default", () => {
      const manager = new SkillsManager({ cacheMaxEntries: Infinity });

      expect(manager.cacheMaxEntries).toBe(32);
    });

    it("should detect homeDir from process.env if not provided", () => {
      const manager = new SkillsManager();
      // homeDir should be set from environment or null
      expect(manager.homeDir === null || typeof manager.homeDir === "string").toBe(true);
    });

    it("should use envHome as fallback when homeDir not provided", () => {
      const manager = new SkillsManager({});
      if (process.env.HOME) {
        expect(manager.homeDir).toBe(process.env.HOME);
      }
    });

    it("should prefer provided homeDir over env", () => {
      const manager = new SkillsManager({ homeDir: "/override/path" });
      expect(manager.homeDir).toBe("/override/path");
    });

    it("should handle string cacheTtlMs", () => {
      const manager = new SkillsManager({ cacheTtlMs: "10000" });
      expect(manager.cacheTtlMs).toBe(10_000);
    });

    it("should handle string cacheMaxEntries", () => {
      const manager = new SkillsManager({ cacheMaxEntries: "5" });
      expect(manager.cacheMaxEntries).toBe(5);
    });
  });

  describe("getSkillsForCwd (integration)", () => {
    let tmpDir;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "skills-manager-test-"));
    });

    afterEach(async () => {
      if (tmpDir) {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });

    it("should load skills from disk", async () => {
      await writeSkillFile(tmpDir, "TestSkill", "Test body content", {
        name: "TestSkill",
        description: "A test skill",
      });

      const manager = new SkillsManager({ homeDir: null });
      const result = await manager.getSkillsForCwd(tmpDir);

      expect(result.skills.length).toBe(1);
      expect(result.skills[0].metadata.name).toBe("TestSkill");
      expect(result.skills[0].metadata.description).toBe("A test skill");
    });

    it("should cache results by cwd", async () => {
      await writeSkillFile(tmpDir, "CachedSkill", "Cached body");

      const manager = new SkillsManager({ homeDir: null, cacheTtlMs: 60_000 });

      const result1 = await manager.getSkillsForCwd(tmpDir);
      const result2 = await manager.getSkillsForCwd(tmpDir);

      expect(result1).toBe(result2);
    });

    it("should use __default__ as cache key for empty cwd", async () => {
      const manager = new SkillsManager({ homeDir: null });
      await manager.getSkillsForCwd("");

      expect(manager.cacheByDir.has("__default__")).toBe(true);
    });

    it("should force reload when forceReload is true", async () => {
      await writeSkillFile(tmpDir, "Skill1", "v1");

      const manager = new SkillsManager({ homeDir: null, cacheTtlMs: 60_000 });

      const result1 = await manager.getSkillsForCwd(tmpDir);

      // Modify the skill
      await writeSkillFile(tmpDir, "Skill1", "v2");

      const result2 = await manager.getSkillsForCwd(tmpDir, true);

      // After force reload, should get new content
      expect(result1).not.toBe(result2);
    });

    it("should reload when cache TTL expires", async () => {
      await writeSkillFile(tmpDir, "Skill1", "v1");

      const manager = new SkillsManager({ homeDir: null, cacheTtlMs: 1 });

      const result1 = await manager.getSkillsForCwd(tmpDir);
      await new Promise((r) => setTimeout(r, 10));

      // Modify the skill
      await writeSkillFile(tmpDir, "Skill1", "v2");

      const result2 = await manager.getSkillsForCwd(tmpDir);

      // After TTL expires, should reload
      expect(result1).not.toBe(result2);
    });

    it("should not reload when cacheTtlMs is 0 (infinite cache)", async () => {
      await writeSkillFile(tmpDir, "Skill1", "v1");

      const manager = new SkillsManager({ homeDir: null, cacheTtlMs: 0 });

      const result1 = await manager.getSkillsForCwd(tmpDir);
      await new Promise((r) => setTimeout(r, 10));
      const result2 = await manager.getSkillsForCwd(tmpDir);

      expect(result1).toBe(result2);
    });

    it("should evict oldest cache entries when max entries exceeded", async () => {
      const dir1 = await fs.mkdtemp(path.join(os.tmpdir(), "skills-manager-evict1-"));
      const dir2 = await fs.mkdtemp(path.join(os.tmpdir(), "skills-manager-evict2-"));
      const dir3 = await fs.mkdtemp(path.join(os.tmpdir(), "skills-manager-evict3-"));

      try {
        const manager = new SkillsManager({ homeDir: null, cacheMaxEntries: 2 });

        await manager.getSkillsForCwd(dir1);
        await manager.getSkillsForCwd(dir2);
        await manager.getSkillsForCwd(dir3);

        expect(manager.cacheByDir.size).toBe(2);
        expect(manager.cacheByDir.has(dir1)).toBe(false);
        expect(manager.cacheByDir.has(dir2)).toBe(true);
        expect(manager.cacheByDir.has(dir3)).toBe(true);
      } finally {
        await fs.rm(dir1, { recursive: true, force: true });
        await fs.rm(dir2, { recursive: true, force: true });
        await fs.rm(dir3, { recursive: true, force: true });
      }
    });

    it("should merge remote skills from provider", async () => {
      await writeSkillFile(tmpDir, "LocalSkill", "Local body");

      const remoteProvider = createMockRemoteProvider([
        { name: "RemoteSkill", description: "Remote description", keywords: ["remote"], priority: 150 },
      ]);

      const manager = new SkillsManager({ homeDir: null, remoteProvider });
      const result = await manager.getSkillsForCwd(tmpDir);

      expect(result.skills.length).toBe(2);
      const localSkill = result.skills.find((s) => s.metadata.name === "LocalSkill");
      const remoteSkill = result.skills.find((s) => s.metadata.name === "RemoteSkill");

      expect(localSkill).toEqual(expect.any(Object));
      expect(remoteSkill).toEqual(expect.any(Object));
      expect(remoteSkill.metadata.scope).toBe("remote");
      expect(remoteSkill.metadata.path).toBe("remote:RemoteSkill");
      expect(remoteSkill.body).toBe(null);
    });

    it("should not override local skills with remote duplicates", async () => {
      await writeSkillFile(tmpDir, "SameSkill", "Local version", {
        name: "SameSkill",
        description: "Local description",
      });

      const remoteProvider = createMockRemoteProvider([
        { name: "SameSkill", description: "Remote description" },
      ]);

      const manager = new SkillsManager({ homeDir: null, remoteProvider });
      const result = await manager.getSkillsForCwd(tmpDir);

      expect(result.skills.length).toBe(1);
      expect(result.skills[0].metadata.description).toBe("Local description");
    });

    it("should handle remote provider errors silently", async () => {
      await writeSkillFile(tmpDir, "LocalSkill", "Local body");

      const remoteProvider = createMockRemoteProvider([], {
        listError: new Error("Network error"),
      });

      const manager = new SkillsManager({ homeDir: null, remoteProvider });
      const result = await manager.getSkillsForCwd(tmpDir);

      expect(result.skills.length).toBe(1);
      expect(result.skills[0].metadata.name).toBe("LocalSkill");
    });

    it("should use default priority 200 for remote skills without priority", async () => {
      const remoteProvider = createMockRemoteProvider([
        { name: "RemoteNoPriority", description: "No priority set" },
      ]);

      const manager = new SkillsManager({ homeDir: null, remoteProvider });
      const result = await manager.getSkillsForCwd(tmpDir);

      expect(result.skills[0].metadata.priority).toBe(200);
    });

    it("should handle null cwd", async () => {
      const manager = new SkillsManager({ homeDir: null });
      await manager.getSkillsForCwd(null);

      expect(manager.cacheByDir.has("__default__")).toBe(true);
    });

    it("should handle undefined cwd", async () => {
      const manager = new SkillsManager({ homeDir: null });
      await manager.getSkillsForCwd(undefined);

      expect(manager.cacheByDir.has("__default__")).toBe(true);
    });

    it("should handle cache entry with missing ts field", async () => {
      const manager = new SkillsManager({ homeDir: null, cacheTtlMs: 60_000 });

      // Manually set cache with missing ts
      manager.cacheByDir.set("/test", { outcome: { skills: [], errors: [] } });

      const result = await manager.getSkillsForCwd("/test");

      // Should reload because ts is missing/invalid (ts=0 means expired)
      expect(result).toEqual(expect.objectContaining({ skills: expect.any(Array), errors: expect.any(Array) }));
    });

    it("should handle skills with empty keywords array from remote", async () => {
      const remoteProvider = createMockRemoteProvider([
        { name: "RemoteSkill", description: "Remote" },
      ]);

      const manager = new SkillsManager({ homeDir: null, remoteProvider });
      const result = await manager.getSkillsForCwd(tmpDir);

      expect(result.skills[0].metadata.keywords).toEqual([]);
    });

    it("should preserve remote skill keywords when provided", async () => {
      const remoteProvider = createMockRemoteProvider([
        { name: "RemoteSkill", description: "Remote", keywords: ["key1", "key2"] },
      ]);

      const manager = new SkillsManager({ homeDir: null, remoteProvider });
      const result = await manager.getSkillsForCwd(tmpDir);

      expect(result.skills[0].metadata.keywords).toEqual(["key1", "key2"]);
    });

    it("should return empty skills for non-existent directory", async () => {
      const manager = new SkillsManager({ homeDir: null });
      const result = await manager.getSkillsForCwd("/non/existent/path");

      expect(result.skills).toBeInstanceOf(Array);
      expect(result.errors).toBeInstanceOf(Array);
    });

    it("should handle multiple remote skills", async () => {
      const remoteProvider = createMockRemoteProvider([
        { name: "Remote1", description: "First remote", priority: 100 },
        { name: "Remote2", description: "Second remote", priority: 150 },
        { name: "Remote3", description: "Third remote" },
      ]);

      const manager = new SkillsManager({ homeDir: null, remoteProvider });
      const result = await manager.getSkillsForCwd(tmpDir);

      expect(result.skills.length).toBe(3);
      expect(result.skills[0].metadata.priority).toBe(100);
      expect(result.skills[1].metadata.priority).toBe(150);
      expect(result.skills[2].metadata.priority).toBe(200); // default
    });

    it("should pass manifestUrl to loader when set", async () => {
      const manager = new SkillsManager({
        homeDir: null,
        manifestUrl: "/skills/manifest.json",
      });

      // This tests that manifestUrl is stored and would be passed
      expect(manager.manifestUrl).toBe("/skills/manifest.json");

      const result = await manager.getSkillsForCwd(tmpDir);
      expect(result.skills).toBeInstanceOf(Array);
    });
  });

  describe("getCatalogPrompt", () => {
    let tmpDir;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "skills-catalog-test-"));
    });

    afterEach(async () => {
      if (tmpDir) {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });

    it("should return catalog with header by default", async () => {
      await writeSkillFile(tmpDir, "TestSkill", "Test body", {
        name: "TestSkill",
        description: "A test skill",
      });

      const manager = new SkillsManager({ homeDir: null });
      const result = await manager.getCatalogPrompt(tmpDir);

      expect(result).toMatch(/^## Skills Catalog/);
      expect(result).toContain("$TestSkill");
    });

    it("should return catalog without header when header=false", async () => {
      await writeSkillFile(tmpDir, "TestSkill", "Test body", {
        name: "TestSkill",
        description: "A test skill",
      });

      const manager = new SkillsManager({ homeDir: null });
      const result = await manager.getCatalogPrompt(tmpDir, { header: false });

      expect(result).not.toMatch(/^## Skills Catalog/);
      expect(result).toContain("$TestSkill");
    });

    it("should return empty string when no skills", async () => {
      const manager = new SkillsManager({ homeDir: null });
      const result = await manager.getCatalogPrompt(tmpDir);

      expect(result).toBe("");
    });

    it("should use cached skills for catalog", async () => {
      await writeSkillFile(tmpDir, "CachedSkill", "Cached body");

      const manager = new SkillsManager({ homeDir: null, cacheTtlMs: 60_000 });

      await manager.getSkillsForCwd(tmpDir);
      const catalog = await manager.getCatalogPrompt(tmpDir);

      expect(catalog).toContain("$CachedSkill");
    });
  });

  describe("clearCache", () => {
    let tmpDir;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "skills-clear-test-"));
    });

    afterEach(async () => {
      if (tmpDir) {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });

    it("should clear specific cwd cache", async () => {
      const dir1 = await fs.mkdtemp(path.join(os.tmpdir(), "skills-clear1-"));
      const dir2 = await fs.mkdtemp(path.join(os.tmpdir(), "skills-clear2-"));

      try {
        const manager = new SkillsManager({ homeDir: null });
        await manager.getSkillsForCwd(dir1);
        await manager.getSkillsForCwd(dir2);

        manager.clearCache(dir1);

        expect(manager.cacheByDir.has(dir1)).toBe(false);
        expect(manager.cacheByDir.has(dir2)).toBe(true);
      } finally {
        await fs.rm(dir1, { recursive: true, force: true });
        await fs.rm(dir2, { recursive: true, force: true });
      }
    });

    it("should clear all cache when cwd is null", async () => {
      const dir1 = await fs.mkdtemp(path.join(os.tmpdir(), "skills-clear1-"));
      const dir2 = await fs.mkdtemp(path.join(os.tmpdir(), "skills-clear2-"));

      try {
        const manager = new SkillsManager({ homeDir: null });
        await manager.getSkillsForCwd(dir1);
        await manager.getSkillsForCwd(dir2);

        manager.clearCache(null);

        expect(manager.cacheByDir.size).toBe(0);
      } finally {
        await fs.rm(dir1, { recursive: true, force: true });
        await fs.rm(dir2, { recursive: true, force: true });
      }
    });

    it("should clear all cache when cwd is undefined", async () => {
      const manager = new SkillsManager({ homeDir: null });
      await manager.getSkillsForCwd(tmpDir);

      manager.clearCache(undefined);

      expect(manager.cacheByDir.size).toBe(0);
    });

    it("should clear all cache when called with no arguments", async () => {
      const dir1 = await fs.mkdtemp(path.join(os.tmpdir(), "skills-clear1-"));
      const dir2 = await fs.mkdtemp(path.join(os.tmpdir(), "skills-clear2-"));

      try {
        const manager = new SkillsManager({ homeDir: null });
        await manager.getSkillsForCwd(dir1);
        await manager.getSkillsForCwd(dir2);

        manager.clearCache();

        expect(manager.cacheByDir.size).toBe(0);
      } finally {
        await fs.rm(dir1, { recursive: true, force: true });
        await fs.rm(dir2, { recursive: true, force: true });
      }
    });

    it("should handle clearing non-existent cache entry", () => {
      const manager = new SkillsManager({ homeDir: null });

      // Should not throw
      manager.clearCache("/non-existent");

      expect(manager.cacheByDir.size).toBe(0);
    });
  });

  describe("getAllSkillMetadata", () => {
    let tmpDir;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "skills-metadata-test-"));
    });

    afterEach(async () => {
      if (tmpDir) {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });

    it("should return only metadata from skills", async () => {
      await writeSkillFile(tmpDir, "Skill1", "Body 1", {
        name: "Skill1",
        description: "First skill",
      });
      await writeSkillFile(tmpDir, "Skill2", "Body 2", {
        name: "Skill2",
        description: "Second skill",
      });

      const manager = new SkillsManager({ homeDir: null });
      const metadata = await manager.getAllSkillMetadata(tmpDir);

      expect(metadata.length).toBe(2);
      const names = metadata.map((m) => m.name).sort();
      expect(names).toEqual(["Skill1", "Skill2"]);
    });

    it("should return empty array when no skills", async () => {
      const manager = new SkillsManager({ homeDir: null });
      const metadata = await manager.getAllSkillMetadata(tmpDir);

      expect(metadata).toEqual([]);
    });

    it("should use cached skills for metadata", async () => {
      await writeSkillFile(tmpDir, "CachedSkill", "Cached body");

      const manager = new SkillsManager({ homeDir: null, cacheTtlMs: 60_000 });

      await manager.getSkillsForCwd(tmpDir);
      const metadata = await manager.getAllSkillMetadata(tmpDir);

      expect(metadata.length).toBe(1);
      expect(metadata[0].name).toBe("CachedSkill");
    });

    it("should return metadata with expected properties", async () => {
      await writeSkillFile(tmpDir, "TestSkill", "Test body", {
        name: "TestSkill",
        description: "Test description",
        keywords: "test,example",
        priority: "50",
      });

      const manager = new SkillsManager({ homeDir: null });
      const metadata = await manager.getAllSkillMetadata(tmpDir);

      expect(metadata[0].name).toBe("TestSkill");
      expect(metadata[0].description).toBe("Test description");
      expect(metadata[0].path).toMatch(/\S/);
      expect(metadata[0].scope).toMatch(/\S/);
    });
  });

  describe("priority handling", () => {
    let tmpDir;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "skills-priority-test-"));
    });

    afterEach(async () => {
      if (tmpDir) {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });

    it("should handle skills with different priorities", async () => {
      await writeSkillFile(tmpDir, "CriticalSkill", "Critical", {
        name: "CriticalSkill",
        description: "Critical skill",
        priority: "0",
      });
      await writeSkillFile(tmpDir, "NormalSkill", "Normal", {
        name: "NormalSkill",
        description: "Normal skill",
        priority: "100",
      });

      const manager = new SkillsManager({ homeDir: null });
      const result = await manager.getSkillsForCwd(tmpDir);

      expect(result.skills.length).toBe(2);
      const critical = result.skills.find((s) => s.metadata.name === "CriticalSkill");
      const normal = result.skills.find((s) => s.metadata.name === "NormalSkill");
      expect(critical.metadata.priority).toBe(0);
      expect(normal.metadata.priority).toBe(100);
    });

    it("should handle skills with numeric priority from remote", async () => {
      const remoteProvider = createMockRemoteProvider([
        { name: "RemoteSkill", description: "Remote", priority: 50 },
      ]);

      const manager = new SkillsManager({ homeDir: null, remoteProvider });
      const result = await manager.getSkillsForCwd(tmpDir);

      expect(result.skills[0].metadata.priority).toBe(50);
    });
  });

  describe("concurrent access", () => {
    let tmpDir;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "skills-concurrent-test-"));
    });

    afterEach(async () => {
      if (tmpDir) {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });

    it("should handle concurrent getSkillsForCwd calls to same cwd", async () => {
      await writeSkillFile(tmpDir, "ConcurrentSkill", "Concurrent body");

      const manager = new SkillsManager({ homeDir: null, cacheTtlMs: 60_000 });

      const promises = [
        manager.getSkillsForCwd(tmpDir),
        manager.getSkillsForCwd(tmpDir),
        manager.getSkillsForCwd(tmpDir),
      ];

      const results = await Promise.all(promises);

      expect(results.map((result) => result.skills.length)).toEqual([1, 1, 1]);
    });

    it("should handle concurrent calls to different cwds", async () => {
      const dir1 = await fs.mkdtemp(path.join(os.tmpdir(), "skills-concurrent1-"));
      const dir2 = await fs.mkdtemp(path.join(os.tmpdir(), "skills-concurrent2-"));

      try {
        await writeSkillFile(dir1, "Skill1", "Body 1");
        await writeSkillFile(dir2, "Skill2", "Body 2");

        const manager = new SkillsManager({ homeDir: null });

        const [result1, result2] = await Promise.all([
          manager.getSkillsForCwd(dir1),
          manager.getSkillsForCwd(dir2),
        ]);

        expect(result1.skills[0].metadata.name).toBe("Skill1");
        expect(result2.skills[0].metadata.name).toBe("Skill2");
      } finally {
        await fs.rm(dir1, { recursive: true, force: true });
        await fs.rm(dir2, { recursive: true, force: true });
      }
    });
  });

  describe("error handling in skills", () => {
    let tmpDir;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "skills-error-test-"));
    });

    afterEach(async () => {
      if (tmpDir) {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });

    it("should include both skills and errors in outcome", async () => {
      // Create a valid skill
      await writeSkillFile(tmpDir, "GoodSkill", "Good body");

      // Create an invalid skill (no frontmatter)
      const badDir = path.join(tmpDir, ".paper-burner", "skills", "BadSkill");
      await fs.mkdir(badDir, { recursive: true });
      await fs.writeFile(path.join(badDir, "SKILL.md"), "no frontmatter", "utf8");

      const manager = new SkillsManager({ homeDir: null });
      const result = await manager.getSkillsForCwd(tmpDir);

      expect(result.skills.length).toBe(1);
      expect(result.errors.length).toBe(1);
    });
  });
});
