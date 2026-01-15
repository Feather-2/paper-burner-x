import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

async function writeSkillFile(rootDir, name, body, frontmatter = null) {
  const skillsDir = path.join(rootDir, ".paper-burner", "skills", name);
  await fs.mkdir(skillsDir, { recursive: true });
  const filePath = path.join(skillsDir, "SKILL.md");
  const fm = frontmatter || {
    name,
    description: `desc for ${name}`,
    keywords: "alpha,beta",
    "keywords-all": "must",
    priority: "50",
  };
  const lines = ["---", ...Object.entries(fm).map(([k, v]) => `${k}: ${v}`), "---", "", body, ""];
  await fs.writeFile(filePath, lines.join("\n"), "utf8");
  return filePath;
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
  // Router tests mock these modules; ensure later tests can import the real implementations.
  vi.doUnmock("../../../js/agents/shared/platform.js");
  vi.doUnmock("../../../js/agents/skills/loader.node.js");
  vi.doUnmock("../../../js/agents/skills/loader.browser.js");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("agents/skills/loader (env router)", () => {
  it("routes to loader.node.js when isNodeLike() is true and caches the impl promise", async () => {
    const isNodeLikeMock = vi.fn(() => true);
    const nodeImpl = {
      loadSkills: vi.fn(async (opts) => ({ ok: true, from: "node", opts })),
      loadSkillsFromNexus: vi.fn(async (p) => ({ ok: true, from: "node:nexus", p })),
      loadAllSkills: vi.fn(async (opts) => ({ ok: true, from: "node:all", opts })),
      loadSkillFromPath: vi.fn(async (p, s, o) => ({ ok: true, from: "node:path", p, s, o })),
    };
    const browserImpl = {
      loadSkills: vi.fn(async () => ({ ok: true, from: "browser" })),
      loadSkillsFromNexus: vi.fn(async () => ({ ok: true, from: "browser:nexus" })),
      loadAllSkills: vi.fn(async () => ({ ok: true, from: "browser:all" })),
      loadSkillFromPath: vi.fn(async () => ({ ok: true, from: "browser:path" })),
    };

    vi.doMock("../../../js/agents/shared/platform.js", () => ({ isNodeLike: isNodeLikeMock }));
    vi.doMock("../../../js/agents/skills/loader.node.js", () => nodeImpl);
    vi.doMock("../../../js/agents/skills/loader.browser.js", () => browserImpl);

    const mod = await import("../../../js/agents/skills/loader.js");

    await expect(mod.loadSkills({ cwd: "/x" })).resolves.toEqual({ ok: true, from: "node", opts: { cwd: "/x" } });
    await expect(mod.loadSkillsFromNexus({ n: 1 })).resolves.toEqual({ ok: true, from: "node:nexus", p: { n: 1 } });
    await expect(mod.loadAllSkills({ cwd: "/y" })).resolves.toEqual({ ok: true, from: "node:all", opts: { cwd: "/y" } });
    await expect(mod.loadSkillFromPath("a.md", "repo", { maxSkillBytes: 1 })).resolves.toEqual({
      ok: true,
      from: "node:path",
      p: "a.md",
      s: "repo",
      o: { maxSkillBytes: 1 },
    });

    // getImpl() should consult isNodeLike() only once due to module-level _implPromise cache.
    expect(isNodeLikeMock).toHaveBeenCalledTimes(1);
    expect(nodeImpl.loadSkills).toHaveBeenCalledTimes(1);
    expect(browserImpl.loadSkills).toHaveBeenCalledTimes(0);
  });

  it("routes to loader.browser.js when isNodeLike() is false", async () => {
    const isNodeLikeMock = vi.fn(() => false);
    const nodeImpl = { loadSkills: vi.fn(async () => ({ from: "node" })) };
    const browserImpl = { loadSkills: vi.fn(async () => ({ from: "browser" })) };

    vi.doMock("../../../js/agents/shared/platform.js", () => ({ isNodeLike: isNodeLikeMock }));
    vi.doMock("../../../js/agents/skills/loader.node.js", () => nodeImpl);
    vi.doMock("../../../js/agents/skills/loader.browser.js", () => browserImpl);

    const mod = await import("../../../js/agents/skills/loader.js");
    await expect(mod.loadSkills({ manifestUrl: "/skills/manifest.json" })).resolves.toEqual({
      from: "browser",
    });
    expect(isNodeLikeMock).toHaveBeenCalledTimes(1);
    expect(browserImpl.loadSkills).toHaveBeenCalledTimes(1);
    expect(nodeImpl.loadSkills).toHaveBeenCalledTimes(0);
  });
});

describe("agents/skills/loader.node (skill loading)", () => {
  it("returns an empty outcome when no roots are provided", async () => {
    const { loadSkills } = await import("../../../js/agents/skills/loader.node.js");
    const out = await loadSkills();
    expect(out).toEqual({ skills: [], errors: [] });
  });

  it("ignores missing roots (no .paper-burner/skills) without errors", async () => {
    const { loadSkills } = await import("../../../js/agents/skills/loader.node.js");
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "paperburner-skills-missing-"));
    try {
      const out = await loadSkills({ cwd, homeDir: null });
      expect(out).toEqual({ skills: [], errors: [] });
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  it("loads skills from repo/user roots and dedups by name (repo wins)", async () => {
    const { loadSkills } = await import("../../../js/agents/skills/loader.node.js");
    const { SkillScope } = await import("../../../js/agents/skills/model.js");

    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "paperburner-skills-cwd-"));
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "paperburner-skills-home-"));
    try {
      await writeSkillFile(home, "SameSkill", "from user", { name: "SameSkill", description: "user", keywords: "user" });
      const repoPath = await writeSkillFile(cwd, "SameSkill", "from repo", { name: "SameSkill", description: "repo", keywords: "repo" });
      await writeSkillFile(cwd, "OtherSkill", "other", { name: "OtherSkill", description: "other", keywords: "alpha" });

      // Hidden directories are skipped (should not error, and not appear).
      const hiddenDir = path.join(cwd, ".paper-burner", "skills", ".hidden");
      await fs.mkdir(hiddenDir, { recursive: true });
      await fs.writeFile(path.join(hiddenDir, "SKILL.md"), "---\nname: Hidden\ndescription: h\n---\n", "utf8");

      const outcome = await loadSkills({ cwd, homeDir: home });
      expect(outcome.errors).toEqual([]);
      expect(outcome.skills.map((s) => s.metadata.name)).toEqual(["OtherSkill", "SameSkill"]);

      const same = outcome.skills.find((s) => s.metadata.name === "SameSkill");
      expect(same.metadata.scope).toBe(SkillScope.REPO);
      expect(same.metadata.path).toBe(repoPath);
      expect(same.body).toContain("from repo");
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
      await fs.rm(home, { recursive: true, force: true });
    }
  });

  it("records parse errors for invalid SKILL.md files", async () => {
    const { loadSkills } = await import("../../../js/agents/skills/loader.node.js");

    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "paperburner-skills-bad-"));
    try {
      const badDir = path.join(cwd, ".paper-burner", "skills", "BadSkill");
      await fs.mkdir(badDir, { recursive: true });
      await fs.writeFile(path.join(badDir, "SKILL.md"), "no frontmatter", "utf8");

      const outcome = await loadSkills({ cwd, homeDir: null });
      expect(outcome.skills).toHaveLength(0);
      expect(outcome.errors).toHaveLength(1);
      expect(String(outcome.errors[0].message)).toMatch(/frontmatter/i);
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  it("loadSkillFromPath caches by content fingerprint (same object instance)", async () => {
    const { loadSkillFromPath } = await import("../../../js/agents/skills/loader.node.js");

    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "paperburner-skills-fp-"));
    try {
      const p = await writeSkillFile(cwd, "FpSkill", "v1", { name: "FpSkill", description: "d1" });

      const a = await loadSkillFromPath(p, "user");
      const b = await loadSkillFromPath(p, "user");
      expect(b).toBe(a);

      await fs.writeFile(
        p,
        ["---", "name: FpSkill", "description: d2", "---", "", "v2", ""].join("\n"),
        "utf8"
      );
      const c = await loadSkillFromPath(p, "user");
      expect(c).not.toBe(a);
      expect(c.body).toContain("v2");
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  it("loads skills from Nexus provider and reports per-skill errors", async () => {
    const { loadSkillsFromNexus } = await import("../../../js/agents/skills/loader.node.js");
    const { SkillScope } = await import("../../../js/agents/skills/model.js");

    const provider = {
      isAvailable: vi.fn(async () => true),
      listSkills: vi.fn(async () => [
        { name: "RemoteOk", description: "ok", allowedTools: ["t1", "t2"], priority: 123 },
        { name: "RemoteBad", description: "bad", allowedTools: [], priority: 200 },
      ]),
      getSkillContent: vi.fn(async (name) => {
        if (name === "RemoteBad") throw new Error("boom");
        return { body: "return 1;", supportFiles: { "a.txt": "x" } };
      }),
    };

    const outcome = await loadSkillsFromNexus(provider);
    expect(provider.isAvailable).toHaveBeenCalledTimes(1);
    expect(provider.listSkills).toHaveBeenCalledTimes(1);

    expect(outcome.skills).toHaveLength(1);
    expect(outcome.skills[0].metadata.scope).toBe(SkillScope.REMOTE);
    expect(outcome.skills[0].metadata.path).toBe("nexus://RemoteOk");
    expect(outcome.skills[0].metadata.allowedTools).toBe("t1,t2");
    expect(outcome.skills[0].supportFiles).toEqual({ "a.txt": "x" });

    expect(outcome.errors).toHaveLength(1);
    expect(outcome.errors[0].path).toBe("nexus://RemoteBad");
    expect(outcome.errors[0].message).toBe("boom");
  });

  it("loadAllSkills merges local + remote without overriding local duplicates", async () => {
    const { loadAllSkills } = await import("../../../js/agents/skills/loader.node.js");
    const { SkillScope } = await import("../../../js/agents/skills/model.js");

    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "paperburner-skills-merge-"));
    try {
      await writeSkillFile(cwd, "SameSkill", "local", { name: "SameSkill", description: "local" });

      const provider = {
        isAvailable: vi.fn(async () => true),
        listSkills: vi.fn(async () => [
          { name: "SameSkill", description: "remote dup", allowedTools: [], priority: 200 },
          { name: "RemoteOnly", description: "remote", allowedTools: [], priority: 200 },
        ]),
        getSkillContent: vi.fn(async (name) => ({ body: `return "${name}";`, supportFiles: {} })),
      };

      const outcome = await loadAllSkills({ cwd, homeDir: null, nexusProvider: provider });
      expect(outcome.errors).toEqual([]);

      const names = outcome.skills.map((s) => s.metadata.name).sort();
      expect(names).toEqual(["RemoteOnly", "SameSkill"]);

      const same = outcome.skills.find((s) => s.metadata.name === "SameSkill");
      expect(same.metadata.scope).toBe(SkillScope.REPO);
      expect(same.body).toContain("local");

      const remote = outcome.skills.find((s) => s.metadata.name === "RemoteOnly");
      expect(remote.metadata.scope).toBe(SkillScope.REMOTE);
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  it("parses multiline YAML + dash-case keys and normalizes whitespace", async () => {
    const { loadSkillFromPath } = await import("../../../js/agents/skills/loader.node.js");

    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "paperburner-skills-yaml-"));
    try {
      const filePath = await writeSkillFile(cwd, "YamlSkill", "return 1;", {
        name: "  Yaml  Skill ",
        "short-description": '"short"',
        description: "|-\n  line1\n  line2",
        keywords: " a,  b ",
        "keywords-all": " c, d ",
        "allowed-tools": "t1,t2",
        tags: "k1:v1,k2:v2",
        traits: "x, y",
        priority: "7",
      });

      const skill = await loadSkillFromPath(filePath, "user");
      expect(skill.metadata.name).toBe("Yaml Skill");
      expect(skill.metadata.description).toBe("line1 line2");
      expect(skill.metadata.shortDescription).toBe("short");
      expect(skill.metadata.keywords).toEqual(["a", "b"]);
      expect(skill.metadata.keywordsAll).toEqual(["c", "d"]);
      expect(skill.metadata.allowedTools).toBe("t1,t2");
      expect(skill.metadata.tags).toEqual({ k1: "v1", k2: "v2" });
      expect(skill.metadata.traits).toEqual(["x", "y"]);
      expect(skill.metadata.priority).toBe(7);
      expect(skill.body).toContain("return 1");
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  it("validates required fields and size limits when loading a single skill", async () => {
    const { loadSkillFromPath } = await import("../../../js/agents/skills/loader.node.js");

    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "paperburner-skills-validate-"));
    try {
      const dir = path.join(cwd, ".paper-burner", "skills", "Bad");
      await fs.mkdir(dir, { recursive: true });

      const missingName = path.join(dir, "SKILL.md");
      await fs.writeFile(missingName, "---\ndescription: d\n---\n", "utf8");
      await expect(loadSkillFromPath(missingName, "user")).rejects.toThrow(/missing field `name`/i);

      const missingDesc = path.join(dir, "SKILL2.md");
      await fs.writeFile(missingDesc, "---\nname: N\n---\n", "utf8");
      await expect(loadSkillFromPath(missingDesc, "user")).rejects.toThrow(/missing field `description`/i);

      const longName = path.join(dir, "SKILL3.md");
      await fs.writeFile(longName, ["---", `name: ${"A".repeat(65)}`, "description: d", "---", ""].join("\n"), "utf8");
      await expect(loadSkillFromPath(longName, "user")).rejects.toThrow(/name exceeds maximum length/i);

      const longDesc = path.join(dir, "SKILL4.md");
      await fs.writeFile(longDesc, ["---", "name: Ok", `description: ${"d".repeat(1025)}`, "---", ""].join("\n"), "utf8");
      await expect(loadSkillFromPath(longDesc, "user")).rejects.toThrow(/description exceeds maximum length/i);
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  it("loadSkillsFromNexus returns empty when provider is missing/unavailable, and reports connection errors", async () => {
    const { loadSkillsFromNexus } = await import("../../../js/agents/skills/loader.node.js");

    await expect(loadSkillsFromNexus(null)).resolves.toEqual({ skills: [], errors: [] });

    const unavailable = { isAvailable: vi.fn(async () => false) };
    await expect(loadSkillsFromNexus(unavailable)).resolves.toEqual({ skills: [], errors: [] });

    const failing = { isAvailable: vi.fn(async () => { throw new Error("down"); }) };
    const out = await loadSkillsFromNexus(failing);
    expect(out.skills).toEqual([]);
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0].path).toBe("nexus://");
    expect(out.errors[0].message).toMatch(/Failed to connect to Nexus/i);
  });
});
