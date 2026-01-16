/**
 * Skills Loader Tests (node:test)
 *
 * Tests for js/agents/skills/loader.js and loader.node.js
 * Focus: SkillLoader class, skill parsing, three-tier loading priority
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

// Direct import of loader.node.js for Node-specific tests
const loaderNodePath = "../../../js/agents/skills/loader.node.js";

/**
 * Helper to write a SKILL.md file in the standard structure
 */
async function writeSkillFile(rootDir, name, body, frontmatter = null) {
  const skillsDir = path.join(rootDir, ".paper-burner", "skills", name);
  await fs.mkdir(skillsDir, { recursive: true });
  const filePath = path.join(skillsDir, "SKILL.md");
  const fm = frontmatter || {
    name,
    description: `Description for ${name}`,
    keywords: "test,example",
    "keywords-all": "required",
    priority: "50",
  };
  const lines = [
    "---",
    ...Object.entries(fm).map(([k, v]) => `${k}: ${v}`),
    "---",
    "",
    body,
    "",
  ];
  await fs.writeFile(filePath, lines.join("\n"), "utf8");
  return filePath;
}

/**
 * Helper to create a temp directory
 */
async function createTempDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), `paperburner-${prefix}-`));
}

/**
 * Helper to clean up temp directory
 */
async function cleanupDir(dir) {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
}

describe("loader.node.js - loadSkills", async () => {
  let mod;

  beforeEach(async () => {
    mod = await import(loaderNodePath);
  });

  it("returns empty outcome when no roots provided", async () => {
    const out = await mod.loadSkills();
    expect(out).toEqual({ skills: [], errors: [] });
  });

  it("returns empty outcome for missing .paper-burner/skills directory", async () => {
    const cwd = await createTempDir("missing");
    try {
      const out = await mod.loadSkills({ cwd, homeDir: null });
      expect(out).toEqual({ skills: [], errors: [] });
    } finally {
      await cleanupDir(cwd);
    }
  });

  it("loads skills from repo root", async () => {
    const cwd = await createTempDir("repo");
    try {
      await writeSkillFile(cwd, "TestSkill", "Skill body content");
      const out = await mod.loadSkills({ cwd, homeDir: null });

      expect(out.errors.length).toBe(0);
      expect(out.skills.length).toBe(1);
      expect(out.skills[0].metadata.name).toBe("TestSkill");
      expect(out.skills[0].metadata.scope).toBe("repo");
      expect(out.skills[0].body.includes("Skill body content")).toBeTruthy();
    } finally {
      await cleanupDir(cwd);
    }
  });

  it("loads skills from user home directory", async () => {
    const home = await createTempDir("home");
    try {
      await writeSkillFile(home, "UserSkill", "User skill body");
      const out = await mod.loadSkills({ cwd: null, homeDir: home });

      expect(out.errors.length).toBe(0);
      expect(out.skills.length).toBe(1);
      expect(out.skills[0].metadata.name).toBe("UserSkill");
      expect(out.skills[0].metadata.scope).toBe("user");
    } finally {
      await cleanupDir(home);
    }
  });

  it("deduplicates skills by name, repo takes priority over user", async () => {
    const cwd = await createTempDir("cwd");
    const home = await createTempDir("home");
    try {
      await writeSkillFile(cwd, "SharedSkill", "from repo", {
        name: "SharedSkill",
        description: "repo version",
      });
      await writeSkillFile(home, "SharedSkill", "from user", {
        name: "SharedSkill",
        description: "user version",
      });

      const out = await mod.loadSkills({ cwd, homeDir: home });

      expect(out.skills.length).toBe(1);
      expect(out.skills[0].metadata.name).toBe("SharedSkill");
      expect(out.skills[0].metadata.scope).toBe("repo");
      expect(out.skills[0].metadata.description).toBe("repo version");
      expect(out.skills[0].body.includes("from repo")).toBeTruthy();
    } finally {
      await cleanupDir(cwd);
      await cleanupDir(home);
    }
  });

  it("loads multiple skills from both roots and sorts by name", async () => {
    const cwd = await createTempDir("cwd");
    const home = await createTempDir("home");
    try {
      await writeSkillFile(cwd, "ZetaSkill", "zeta body", {
        name: "ZetaSkill",
        description: "zeta",
      });
      await writeSkillFile(cwd, "AlphaSkill", "alpha body", {
        name: "AlphaSkill",
        description: "alpha",
      });
      await writeSkillFile(home, "BetaSkill", "beta body", {
        name: "BetaSkill",
        description: "beta",
      });

      const out = await mod.loadSkills({ cwd, homeDir: home });

      expect(out.skills.length).toBe(3);
      expect(out.skills.map((s) => s.metadata.name)).toEqual(["AlphaSkill", "BetaSkill", "ZetaSkill"]
      );
    } finally {
      await cleanupDir(cwd);
      await cleanupDir(home);
    }
  });

  it("skips hidden directories (starting with .)", async () => {
    const cwd = await createTempDir("hidden");
    try {
      await writeSkillFile(cwd, "VisibleSkill", "visible");
      const hiddenDir = path.join(cwd, ".paper-burner", "skills", ".hidden");
      await fs.mkdir(hiddenDir, { recursive: true });
      await fs.writeFile(
        path.join(hiddenDir, "SKILL.md"),
        "---\nname: Hidden\ndescription: h\n---\n",
        "utf8"
      );

      const out = await mod.loadSkills({ cwd, homeDir: null });

      expect(out.skills.length).toBe(1);
      expect(out.skills[0].metadata.name).toBe("VisibleSkill");
    } finally {
      await cleanupDir(cwd);
    }
  });

  it("records parse errors for invalid SKILL.md files", async () => {
    const cwd = await createTempDir("bad");
    try {
      const badDir = path.join(cwd, ".paper-burner", "skills", "BadSkill");
      await fs.mkdir(badDir, { recursive: true });
      await fs.writeFile(path.join(badDir, "SKILL.md"), "no frontmatter here", "utf8");

      const out = await mod.loadSkills({ cwd, homeDir: null });

      expect(out.skills.length).toBe(0);
      expect(out.errors.length).toBe(1);
      expect(out.errors[0].message.toLowerCase().includes("frontmatter")).toBeTruthy();
    } finally {
      await cleanupDir(cwd);
    }
  });

  it("handles directory read errors gracefully", async () => {
    const cwd = await createTempDir("unreadable");
    try {
      const skillsDir = path.join(cwd, ".paper-burner", "skills");
      await fs.mkdir(skillsDir, { recursive: true });
      // Create a file where we expect a directory (causes readdir to fail on subdirs)
      await fs.writeFile(path.join(skillsDir, "NotADir"), "test");

      const out = await mod.loadSkills({ cwd, homeDir: null });

      // Should not throw, just return empty or with errors
      expect(Array.isArray(out.skills)).toBeTruthy();
      expect(Array.isArray(out.errors)).toBeTruthy();
    } finally {
      await cleanupDir(cwd);
    }
  });
});

describe("loader.node.js - YAML parsing", async () => {
  let mod;

  beforeEach(async () => {
    mod = await import(loaderNodePath);
  });

  it("parses basic YAML frontmatter", async () => {
    const cwd = await createTempDir("yaml-basic");
    try {
      const filePath = await writeSkillFile(cwd, "BasicSkill", "body", {
        name: "BasicSkill",
        description: "A basic skill",
        keywords: "a,b,c",
        priority: "42",
      });

      const skill = await mod.loadSkillFromPath(filePath, "user");

      expect(skill.metadata.name).toBe("BasicSkill");
      expect(skill.metadata.description).toBe("A basic skill");
      expect(skill.metadata.keywords).toEqual(["a", "b", "c"]);
      expect(skill.metadata.priority).toBe(42);
    } finally {
      await cleanupDir(cwd);
    }
  });

  it("parses multiline YAML values", async () => {
    const cwd = await createTempDir("yaml-multiline");
    try {
      const filePath = await writeSkillFile(cwd, "MultilineSkill", "body content", {
        name: "MultilineSkill",
        description: "|-\n  line1\n  line2",
      });

      const skill = await mod.loadSkillFromPath(filePath, "user");

      expect(skill.metadata.name).toBe("MultilineSkill");
      expect(skill.metadata.description).toBe("line1 line2");
    } finally {
      await cleanupDir(cwd);
    }
  });

  it("converts dash-case keys to camelCase", async () => {
    const cwd = await createTempDir("yaml-camel");
    try {
      const filePath = await writeSkillFile(cwd, "CamelSkill", "body", {
        name: "CamelSkill",
        description: "test",
        "short-description": "short",
        "keywords-all": "x,y",
        "allowed-tools": "tool1,tool2",
      });

      const skill = await mod.loadSkillFromPath(filePath, "user");

      expect(skill.metadata.shortDescription).toBe("short");
      expect(skill.metadata.keywordsAll).toEqual(["x", "y"]);
      expect(skill.metadata.allowedTools).toBe("tool1,tool2");
    } finally {
      await cleanupDir(cwd);
    }
  });

  it("parses tags as key:value pairs", async () => {
    const cwd = await createTempDir("yaml-tags");
    try {
      const filePath = await writeSkillFile(cwd, "TaggedSkill", "body", {
        name: "TaggedSkill",
        description: "test",
        tags: "env:prod,tier:premium",
      });

      const skill = await mod.loadSkillFromPath(filePath, "user");

      expect(skill.metadata.tags).toEqual({ env: "prod", tier: "premium" });
    } finally {
      await cleanupDir(cwd);
    }
  });

  it("parses traits as array", async () => {
    const cwd = await createTempDir("yaml-traits");
    try {
      const filePath = await writeSkillFile(cwd, "TraitSkill", "body", {
        name: "TraitSkill",
        description: "test",
        traits: "fast,reliable,secure",
      });

      const skill = await mod.loadSkillFromPath(filePath, "user");

      expect(skill.metadata.traits).toEqual(["fast", "reliable", "secure"]);
    } finally {
      await cleanupDir(cwd);
    }
  });

  it("handles quoted values", async () => {
    const cwd = await createTempDir("yaml-quoted");
    try {
      const filePath = await writeSkillFile(cwd, "QuotedSkill", "body", {
        name: '"Quoted Name"',
        description: "'Single quoted'",
      });

      const skill = await mod.loadSkillFromPath(filePath, "user");

      expect(skill.metadata.name).toBe("Quoted Name");
      expect(skill.metadata.description).toBe("Single quoted");
    } finally {
      await cleanupDir(cwd);
    }
  });

  it("normalizes whitespace in name and description", async () => {
    const cwd = await createTempDir("yaml-whitespace");
    try {
      const filePath = await writeSkillFile(cwd, "SpacySkill", "body", {
        name: "  Spacy   Skill  ",
        description: "  Multiple   spaces  ",
      });

      const skill = await mod.loadSkillFromPath(filePath, "user");

      expect(skill.metadata.name).toBe("Spacy Skill");
      expect(skill.metadata.description).toBe("Multiple spaces");
    } finally {
      await cleanupDir(cwd);
    }
  });

  it("extracts body content after frontmatter", async () => {
    const cwd = await createTempDir("yaml-body");
    try {
      const bodyContent = "# Instructions\n\nDo this and that.\n\n```js\ncode();\n```";
      const filePath = await writeSkillFile(cwd, "BodySkill", bodyContent, {
        name: "BodySkill",
        description: "test",
      });

      const skill = await mod.loadSkillFromPath(filePath, "user");

      expect(skill.body.includes("# Instructions")).toBeTruthy();
      expect(skill.body.includes("code().toBeTruthy()"));
    } finally {
      await cleanupDir(cwd);
    }
  });

  it("handles CRLF line endings", async () => {
    const cwd = await createTempDir("yaml-crlf");
    try {
      const skillsDir = path.join(cwd, ".paper-burner", "skills", "CrlfSkill");
      await fs.mkdir(skillsDir, { recursive: true });
      const filePath = path.join(skillsDir, "SKILL.md");
      const content = "---\r\nname: CrlfSkill\r\ndescription: test\r\n---\r\nBody";
      await fs.writeFile(filePath, content, "utf8");

      const skill = await mod.loadSkillFromPath(filePath, "user");

      expect(skill.metadata.name).toBe("CrlfSkill");
      expect(skill.metadata.description).toBe("test");
    } finally {
      await cleanupDir(cwd);
    }
  });
});

describe("loader.node.js - validation", async () => {
  let mod;

  beforeEach(async () => {
    mod = await import(loaderNodePath);
  });

  it("throws on missing YAML frontmatter", async () => {
    const cwd = await createTempDir("val-no-fm");
    try {
      const skillsDir = path.join(cwd, ".paper-burner", "skills", "NoFmSkill");
      await fs.mkdir(skillsDir, { recursive: true });
      const filePath = path.join(skillsDir, "SKILL.md");
      await fs.writeFile(filePath, "Just plain text, no frontmatter", "utf8");

      await expect(() => mod.loadSkillFromPath(filePath, "user"),
        /frontmatter/i
      );
    } finally {
      await cleanupDir(cwd);
    }
  });

  it("throws on missing name field", async () => {
    const cwd = await createTempDir("val-no-name");
    try {
      const skillsDir = path.join(cwd, ".paper-burner", "skills", "NoNameSkill");
      await fs.mkdir(skillsDir, { recursive: true });
      const filePath = path.join(skillsDir, "SKILL.md");
      await fs.writeFile(filePath, "---\ndescription: has desc\n---\nBody", "utf8");

      await expect(() => mod.loadSkillFromPath(filePath, "user"),
        /missing field.*name/i
      );
    } finally {
      await cleanupDir(cwd);
    }
  });

  it("throws on missing description field", async () => {
    const cwd = await createTempDir("val-no-desc");
    try {
      const skillsDir = path.join(cwd, ".paper-burner", "skills", "NoDescSkill");
      await fs.mkdir(skillsDir, { recursive: true });
      const filePath = path.join(skillsDir, "SKILL.md");
      await fs.writeFile(filePath, "---\nname: HasName\n---\nBody", "utf8");

      await expect(() => mod.loadSkillFromPath(filePath, "user"),
        /missing field.*description/i
      );
    } finally {
      await cleanupDir(cwd);
    }
  });

  it("throws on name exceeding max length (64 chars)", async () => {
    const cwd = await createTempDir("val-long-name");
    try {
      const skillsDir = path.join(cwd, ".paper-burner", "skills", "LongNameSkill");
      await fs.mkdir(skillsDir, { recursive: true });
      const filePath = path.join(skillsDir, "SKILL.md");
      const longName = "A".repeat(65);
      await fs.writeFile(
        filePath,
        `---\nname: ${longName}\ndescription: test\n---\nBody`,
        "utf8"
      );

      await expect(() => mod.loadSkillFromPath(filePath, "user"),
        /name exceeds maximum length/i
      );
    } finally {
      await cleanupDir(cwd);
    }
  });

  it("throws on description exceeding max length (1024 chars)", async () => {
    const cwd = await createTempDir("val-long-desc");
    try {
      const skillsDir = path.join(cwd, ".paper-burner", "skills", "LongDescSkill");
      await fs.mkdir(skillsDir, { recursive: true });
      const filePath = path.join(skillsDir, "SKILL.md");
      const longDesc = "D".repeat(1025);
      await fs.writeFile(
        filePath,
        `---\nname: Valid\ndescription: ${longDesc}\n---\nBody`,
        "utf8"
      );

      await expect(() => mod.loadSkillFromPath(filePath, "user"),
        /description exceeds maximum length/i
      );
    } finally {
      await cleanupDir(cwd);
    }
  });

  it("allows name at exactly max length (64 chars)", async () => {
    const cwd = await createTempDir("val-exact-name");
    try {
      const filePath = await writeSkillFile(cwd, "ExactNameSkill", "body", {
        name: "A".repeat(64),
        description: "test",
      });

      const skill = await mod.loadSkillFromPath(filePath, "user");
      expect(skill.metadata.name.length).toBe(64);
    } finally {
      await cleanupDir(cwd);
    }
  });

  it("allows description at exactly max length (1024 chars)", async () => {
    const cwd = await createTempDir("val-exact-desc");
    try {
      const filePath = await writeSkillFile(cwd, "ExactDescSkill", "body", {
        name: "Valid",
        description: "D".repeat(1024),
      });

      const skill = await mod.loadSkillFromPath(filePath, "user");
      expect(skill.metadata.description.length).toBe(1024);
    } finally {
      await cleanupDir(cwd);
    }
  });
});

describe("loader.node.js - fingerprint caching", async () => {
  let mod;

  beforeEach(async () => {
    mod = await import(loaderNodePath);
  });

  it("returns cached skill object for unchanged file", async () => {
    const cwd = await createTempDir("cache-hit");
    try {
      const filePath = await writeSkillFile(cwd, "CacheSkill", "body v1", {
        name: "CacheSkill",
        description: "cached",
      });

      const first = await mod.loadSkillFromPath(filePath, "user");
      const second = await mod.loadSkillFromPath(filePath, "user");

      // Same object reference due to cache
      expect(first).toBe(second);
    } finally {
      await cleanupDir(cwd);
    }
  });

  it("returns new skill object when file content changes", async () => {
    const cwd = await createTempDir("cache-miss");
    try {
      const filePath = await writeSkillFile(cwd, "ChangeSkill", "body v1", {
        name: "ChangeSkill",
        description: "version1",
      });

      const first = await mod.loadSkillFromPath(filePath, "user");
      expect(first.body.includes("body v1")).toBeTruthy();

      // Modify the file
      await fs.writeFile(
        filePath,
        "---\nname: ChangeSkill\ndescription: version2\n---\nbody v2",
        "utf8"
      );

      const second = await mod.loadSkillFromPath(filePath, "user");

      expect(first).not.toBe(second);
      expect(second.body.includes("body v2")).toBeTruthy();
      expect(second.metadata.description).toBe("version2");
    } finally {
      await cleanupDir(cwd);
    }
  });
});

describe("loader.node.js - loadSkillsFromNexus", async () => {
  let mod;

  beforeEach(async () => {
    mod = await import(loaderNodePath);
  });

  it("returns empty outcome when provider is null", async () => {
    const out = await mod.loadSkillsFromNexus(null);
    expect(out).toEqual({ skills: [], errors: [] });
  });

  it("returns empty outcome when provider is unavailable", async () => {
    const provider = {
      isAvailable: async () => false,
    };
    const out = await mod.loadSkillsFromNexus(provider);
    expect(out).toEqual({ skills: [], errors: [] });
  });

  it("loads skills from available Nexus provider", async () => {
    const provider = {
      isAvailable: async () => true,
      listSkills: async () => [
        { name: "RemoteSkill", description: "remote desc", allowedTools: ["t1", "t2"], priority: 150 },
      ],
      getSkillContent: async () => ({
        body: "return 42;",
        supportFiles: { "helper.js": "export const x = 1;" },
      }),
    };

    const out = await mod.loadSkillsFromNexus(provider);

    expect(out.errors.length).toBe(0);
    expect(out.skills.length).toBe(1);
    expect(out.skills[0].metadata.name).toBe("RemoteSkill");
    expect(out.skills[0].metadata.scope).toBe("remote");
    expect(out.skills[0].metadata.path).toBe("nexus://RemoteSkill");
    expect(out.skills[0].metadata.allowedTools).toBe("t1,t2");
    expect(out.skills[0].metadata.priority).toBe(150);
    expect(out.skills[0].body).toBe("return 42;");
    expect(out.skills[0].supportFiles).toEqual({ "helper.js": "export const x = 1;" });
  });

  it("records per-skill errors from Nexus", async () => {
    const provider = {
      isAvailable: async () => true,
      listSkills: async () => [
        { name: "GoodSkill", description: "good" },
        { name: "BadSkill", description: "bad" },
      ],
      getSkillContent: async (name) => {
        if (name === "BadSkill") throw new Error("content unavailable");
        return { body: "ok", supportFiles: {} };
      },
    };

    const out = await mod.loadSkillsFromNexus(provider);

    expect(out.skills.length).toBe(1);
    expect(out.skills[0].metadata.name).toBe("GoodSkill");
    expect(out.errors.length).toBe(1);
    expect(out.errors[0].path).toBe("nexus://BadSkill");
    expect(out.errors[0].message.includes("content unavailable")).toBeTruthy();
  });

  it("records connection error when isAvailable throws", async () => {
    const provider = {
      isAvailable: async () => {
        throw new Error("network down");
      },
    };

    const out = await mod.loadSkillsFromNexus(provider);

    expect(out.skills.length).toBe(0);
    expect(out.errors.length).toBe(1);
    expect(out.errors[0].path).toBe("nexus://");
    expect(out.errors[0].message.includes("Failed to connect to Nexus")).toBeTruthy();
  });

  it("uses default priority 200 for remote skills without priority", async () => {
    const provider = {
      isAvailable: async () => true,
      listSkills: async () => [{ name: "NoPrioSkill", description: "no prio" }],
      getSkillContent: async () => ({ body: "x" }),
    };

    const out = await mod.loadSkillsFromNexus(provider);

    expect(out.skills[0].metadata.priority).toBe(200);
  });
});

describe("loader.node.js - loadAllSkills", async () => {
  let mod;

  beforeEach(async () => {
    mod = await import(loaderNodePath);
  });

  it("merges local and remote skills", async () => {
    const cwd = await createTempDir("merge");
    try {
      await writeSkillFile(cwd, "LocalSkill", "local body", {
        name: "LocalSkill",
        description: "local",
      });

      const provider = {
        isAvailable: async () => true,
        listSkills: async () => [{ name: "RemoteSkill", description: "remote" }],
        getSkillContent: async () => ({ body: "remote body" }),
      };

      const out = await mod.loadAllSkills({ cwd, homeDir: null, nexusProvider: provider });

      expect(out.skills.length).toBe(2);
      const names = out.skills.map((s) => s.metadata.name).sort();
      expect(names).toEqual(["LocalSkill", "RemoteSkill"]);
    } finally {
      await cleanupDir(cwd);
    }
  });

  it("local skills override remote skills with same name", async () => {
    const cwd = await createTempDir("override");
    try {
      await writeSkillFile(cwd, "SharedSkill", "local version", {
        name: "SharedSkill",
        description: "local wins",
      });

      const provider = {
        isAvailable: async () => true,
        listSkills: async () => [{ name: "SharedSkill", description: "remote loses" }],
        getSkillContent: async () => ({ body: "remote version" }),
      };

      const out = await mod.loadAllSkills({ cwd, homeDir: null, nexusProvider: provider });

      expect(out.skills.length).toBe(1);
      expect(out.skills[0].metadata.name).toBe("SharedSkill");
      expect(out.skills[0].metadata.scope).toBe("repo");
      expect(out.skills[0].body.includes("local version")).toBeTruthy();
    } finally {
      await cleanupDir(cwd);
    }
  });

  it("combines errors from local and remote loading", async () => {
    const cwd = await createTempDir("errors");
    try {
      const badDir = path.join(cwd, ".paper-burner", "skills", "BadLocal");
      await fs.mkdir(badDir, { recursive: true });
      await fs.writeFile(path.join(badDir, "SKILL.md"), "invalid", "utf8");

      const provider = {
        isAvailable: async () => true,
        listSkills: async () => [{ name: "BadRemote", description: "bad" }],
        getSkillContent: async () => {
          throw new Error("remote error");
        },
      };

      const out = await mod.loadAllSkills({ cwd, homeDir: null, nexusProvider: provider });

      expect(out.skills.length).toBe(0);
      expect(out.errors.length).toBe(2);
      expect(out.errors.some(e => e.message.includes("frontmatter"))).toBeTruthy();
      expect(out.errors.some(e => e.message.includes("remote error"))).toBeTruthy();
    } finally {
      await cleanupDir(cwd);
    }
  });

  it("works without nexus provider", async () => {
    const cwd = await createTempDir("no-nexus");
    try {
      await writeSkillFile(cwd, "OnlyLocal", "body", {
        name: "OnlyLocal",
        description: "test",
      });

      const out = await mod.loadAllSkills({ cwd, homeDir: null });

      expect(out.skills.length).toBe(1);
      expect(out.skills[0].metadata.name).toBe("OnlyLocal");
    } finally {
      await cleanupDir(cwd);
    }
  });
});

describe("loader.node.js - loadSkillFromPath", async () => {
  let mod;

  beforeEach(async () => {
    mod = await import(loaderNodePath);
  });

  it("loads skill from absolute path", async () => {
    const cwd = await createTempDir("abs-path");
    try {
      const filePath = await writeSkillFile(cwd, "AbsSkill", "absolute body", {
        name: "AbsSkill",
        description: "loaded by path",
      });

      const skill = await mod.loadSkillFromPath(filePath, "user");

      expect(skill.metadata.name).toBe("AbsSkill");
      expect(skill.metadata.scope).toBe("user");
      expect(skill.metadata.path).toBe(filePath);
    } finally {
      await cleanupDir(cwd);
    }
  });

  it("respects provided scope parameter", async () => {
    const cwd = await createTempDir("scope-param");
    try {
      const filePath = await writeSkillFile(cwd, "ScopeSkill", "body", {
        name: "ScopeSkill",
        description: "test",
      });

      const asRepo = await mod.loadSkillFromPath(filePath, "repo");
      // Note: The cache returns the same object, but scope is set on first load
      // To properly test scope, we need different file paths or clear cache

      expect(asRepo.metadata.scope).toBe("repo");
    } finally {
      await cleanupDir(cwd);
    }
  });

  it("uses default scope when not provided", async () => {
    const cwd = await createTempDir("default-scope");
    try {
      // Create a unique file to avoid cache issues
      const skillsDir = path.join(cwd, ".paper-burner", "skills", "DefaultScopeSkill");
      await fs.mkdir(skillsDir, { recursive: true });
      const filePath = path.join(skillsDir, "SKILL.md");
      await fs.writeFile(
        filePath,
        "---\nname: DefaultScopeSkill\ndescription: test\n---\nBody",
        "utf8"
      );

      const skill = await mod.loadSkillFromPath(filePath);

      expect(skill.metadata.scope).toBe("user");
    } finally {
      await cleanupDir(cwd);
    }
  });
});

describe("loader.node.js - three-tier priority", async () => {
  let mod;

  beforeEach(async () => {
    mod = await import(loaderNodePath);
  });

  it("repo > user priority: repo skill wins", async () => {
    const cwd = await createTempDir("prio-repo");
    const home = await createTempDir("prio-user");
    try {
      await writeSkillFile(cwd, "PrioSkill", "repo wins", {
        name: "PrioSkill",
        description: "from repo",
      });
      await writeSkillFile(home, "PrioSkill", "user loses", {
        name: "PrioSkill",
        description: "from user",
      });

      const out = await mod.loadSkills({ cwd, homeDir: home });

      expect(out.skills.length).toBe(1);
      expect(out.skills[0].metadata.scope).toBe("repo");
      expect(out.skills[0].body.includes("repo wins")).toBeTruthy();
    } finally {
      await cleanupDir(cwd);
      await cleanupDir(home);
    }
  });

  it("user > remote priority: user skill wins over remote", async () => {
    const home = await createTempDir("prio-user-remote");
    try {
      await writeSkillFile(home, "UserRemoteSkill", "user wins", {
        name: "UserRemoteSkill",
        description: "from user",
      });

      const provider = {
        isAvailable: async () => true,
        listSkills: async () => [{ name: "UserRemoteSkill", description: "from remote" }],
        getSkillContent: async () => ({ body: "remote loses" }),
      };

      const out = await mod.loadAllSkills({ cwd: null, homeDir: home, nexusProvider: provider });

      const skill = out.skills.find((s) => s.metadata.name === "UserRemoteSkill");
      expect(skill.metadata.scope).toBe("user");
      expect(skill.body.includes("user wins")).toBeTruthy();
    } finally {
      await cleanupDir(home);
    }
  });

  it("repo > user > remote complete priority chain", async () => {
    const cwd = await createTempDir("prio-chain-repo");
    const home = await createTempDir("prio-chain-home");
    try {
      // Same skill in all three locations
      await writeSkillFile(cwd, "ChainSkill", "repo body", {
        name: "ChainSkill",
        description: "repo",
      });
      await writeSkillFile(home, "ChainSkill", "user body", {
        name: "ChainSkill",
        description: "user",
      });

      const provider = {
        isAvailable: async () => true,
        listSkills: async () => [{ name: "ChainSkill", description: "remote" }],
        getSkillContent: async () => ({ body: "remote body" }),
      };

      const out = await mod.loadAllSkills({ cwd, homeDir: home, nexusProvider: provider });

      const skill = out.skills.find((s) => s.metadata.name === "ChainSkill");
      expect(skill.metadata.scope).toBe("repo");
      expect(skill.body.includes("repo body")).toBeTruthy();
    } finally {
      await cleanupDir(cwd);
      await cleanupDir(home);
    }
  });
});

describe("loader.node.js - edge cases", async () => {
  let mod;

  beforeEach(async () => {
    mod = await import(loaderNodePath);
  });

  it("handles empty skills directory", async () => {
    const cwd = await createTempDir("empty-skills");
    try {
      const skillsDir = path.join(cwd, ".paper-burner", "skills");
      await fs.mkdir(skillsDir, { recursive: true });

      const out = await mod.loadSkills({ cwd, homeDir: null });

      expect(out).toEqual({ skills: [], errors: [] });
    } finally {
      await cleanupDir(cwd);
    }
  });

  it("handles deeply nested skill directories", async () => {
    const cwd = await createTempDir("nested");
    try {
      const nestedDir = path.join(cwd, ".paper-burner", "skills", "category", "sub", "deep");
      await fs.mkdir(nestedDir, { recursive: true });
      await fs.writeFile(
        path.join(nestedDir, "SKILL.md"),
        "---\nname: DeepSkill\ndescription: deep\n---\nBody",
        "utf8"
      );

      const out = await mod.loadSkills({ cwd, homeDir: null });

      expect(out.skills.length).toBe(1);
      expect(out.skills[0].metadata.name).toBe("DeepSkill");
    } finally {
      await cleanupDir(cwd);
    }
  });

  it("handles skill with empty keywords", async () => {
    const cwd = await createTempDir("empty-kw");
    try {
      const filePath = await writeSkillFile(cwd, "NoKwSkill", "body", {
        name: "NoKwSkill",
        description: "no keywords",
      });

      const skill = await mod.loadSkillFromPath(filePath, "user");

      expect(skill.metadata.keywords).toEqual([]);
      expect(skill.metadata.keywordsAll).toEqual([]);
    } finally {
      await cleanupDir(cwd);
    }
  });

  it("handles skill with empty body", async () => {
    const cwd = await createTempDir("empty-body");
    try {
      const skillsDir = path.join(cwd, ".paper-burner", "skills", "EmptyBodySkill");
      await fs.mkdir(skillsDir, { recursive: true });
      const filePath = path.join(skillsDir, "SKILL.md");
      await fs.writeFile(filePath, "---\nname: EmptyBodySkill\ndescription: test\n---\n", "utf8");

      const skill = await mod.loadSkillFromPath(filePath, "user");

      expect(skill.metadata.name).toBe("EmptyBodySkill");
      expect(skill.body).toBe("");
    } finally {
      await cleanupDir(cwd);
    }
  });

  it("handles frontmatter without closing delimiter", async () => {
    const cwd = await createTempDir("no-close-fm");
    try {
      const skillsDir = path.join(cwd, ".paper-burner", "skills", "NoCloseFmSkill");
      await fs.mkdir(skillsDir, { recursive: true });
      const filePath = path.join(skillsDir, "SKILL.md");
      await fs.writeFile(filePath, "---\nname: Test\ndescription: test\nNo closing", "utf8");

      await expect(() => mod.loadSkillFromPath(filePath, "user"),
        /frontmatter/i
      );
    } finally {
      await cleanupDir(cwd);
    }
  });

  it("handles default priority when not specified", async () => {
    const cwd = await createTempDir("default-prio");
    try {
      const filePath = await writeSkillFile(cwd, "DefaultPrioSkill", "body", {
        name: "DefaultPrioSkill",
        description: "test",
        // no priority specified
      });

      const skill = await mod.loadSkillFromPath(filePath, "user");

      expect(skill.metadata.priority).toBe(100);
    } finally {
      await cleanupDir(cwd);
    }
  });

  it("handles tags with empty values", async () => {
    const cwd = await createTempDir("empty-tag-val");
    try {
      const filePath = await writeSkillFile(cwd, "EmptyTagSkill", "body", {
        name: "EmptyTagSkill",
        description: "test",
        tags: "key1:,key2:value",
      });

      const skill = await mod.loadSkillFromPath(filePath, "user");

      expect(skill.metadata.tags).toEqual({ key1: "", key2: "value" });
    } finally {
      await cleanupDir(cwd);
    }
  });
});
