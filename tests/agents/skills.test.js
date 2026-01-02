import { describe, it } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import { SkillScope } from "../../js/agents/skills/model.js";
import { loadSkills } from "../../js/agents/skills/loader.js";
import { buildSkillInjections, formatSkillInjections } from "../../js/agents/skills/injection.js";
import { SkillsManager } from "../../js/agents/skills/manager.js";

async function writeSkillFile(rootDir, scope, name, body, frontmatter) {
  const skillsDir = path.join(rootDir, ".paper-burner", "skills", name);
  await fs.mkdir(skillsDir, { recursive: true });
  const filePath = path.join(skillsDir, "SKILL.md");
  const fm = frontmatter || {
    name,
    description: `desc for ${name} (${scope})`,
    keywords: "alpha,beta",
    "keywords-all": "must",
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

describe("skills/loader.node", () => {
  it("loads skills from repo/user roots and dedups by priority", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "paperburner-skills-cwd-"));
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "paperburner-skills-home-"));
    try {
      await writeSkillFile(home, SkillScope.USER, "SameSkill", "from user", { name: "SameSkill", description: "user", keywords: "user" });
      const repoPath = await writeSkillFile(cwd, SkillScope.REPO, "SameSkill", "from repo", { name: "SameSkill", description: "repo", keywords: "repo" });
      await writeSkillFile(cwd, SkillScope.REPO, "OtherSkill", "other", { name: "OtherSkill", description: "other", keywords: "alpha" });

      const outcome = await loadSkills({ cwd, homeDir: home });
      assert.equal(outcome.errors.length, 0);
      const names = outcome.skills.map((s) => s.metadata.name);
      assert.deepEqual(names, ["OtherSkill", "SameSkill"]);

      const same = outcome.skills.find((s) => s.metadata.name === "SameSkill");
      assert.equal(same.metadata.scope, SkillScope.REPO);
      assert.equal(same.metadata.path, repoPath);
      assert.equal(same.body.includes("from repo"), true);
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
      await fs.rm(home, { recursive: true, force: true });
    }
  });

  it("records parse errors for invalid SKILL.md files", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "paperburner-skills-bad-"));
    try {
      const badDir = path.join(cwd, ".paper-burner", "skills", "BadSkill");
      await fs.mkdir(badDir, { recursive: true });
      await fs.writeFile(path.join(badDir, "SKILL.md"), "no frontmatter", "utf8");

      const outcome = await loadSkills({ cwd, homeDir: null });
      assert.equal(outcome.skills.length, 0);
      assert.equal(outcome.errors.length, 1);
      assert.ok(String(outcome.errors[0].message).includes("frontmatter"));
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });
});

describe("skills/injection + manager", () => {
  it("builds and formats injections without leaking absolute paths", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "paperburner-skills-inject-"));
    try {
      await writeSkillFile(cwd, SkillScope.REPO, "AlphaSkill", "Body A", {
        name: "AlphaSkill",
        description: "alpha description",
        keywords: "alpha",
      });

      const outcome = await loadSkills({ cwd, homeDir: null });
      const injections = await buildSkillInjections("please use alpha", outcome);
      assert.equal(injections.items.length, 1);
      assert.equal(injections.items[0].name, "AlphaSkill");
      assert.equal(injections.items[0].path.includes(cwd.replaceAll("\\", "/")), false);

      const prompt = formatSkillInjections(injections);
      assert.ok(prompt.includes("## Skill Instructions"));
      assert.ok(prompt.includes("### AlphaSkill"));

      const manager = new SkillsManager({ cacheTtlMs: 60_000 });
      const a = await manager.getSkillsForCwd(cwd);
      const b = await manager.getSkillsForCwd(cwd);
      assert.equal(a, b);
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });
});

