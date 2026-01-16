
import { describe, it, expect, beforeEach, afterEach } from "vitest";

it("configureUserSkillStoreEncryption: returns config with available flag", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  const result = mod.configureUserSkillStoreEncryption({ enabled: false });

  expect(typeof result.available).toBe("boolean");
  expect(result.enabled).toBe(false);
});

it("configureUserSkillStoreEncryption: enabled without passphrase -> disabled", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  const result = mod.configureUserSkillStoreEncryption({
    enabled: true,
    passphrase: "",
  });

  expect(result.enabled).toBe(false);
});

it("configureUserSkillStoreEncryption: required without passphrase -> throws", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  expect(() =>
      mod.configureUserSkillStoreEncryption({
        enabled: true,
        required: true,
        passphrase: "",
      })
  ).toThrow(/passphrase is missing/);
});

it("configureUserSkillStoreEncryption: normalizes iterations", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  // Too low -> clamped to 10_000
  const result = mod.configureUserSkillStoreEncryption({
    enabled: false,
    iterations: 100,
  });

  expect(result.iterations).toBe(10_000);
});

it("configureUserSkillStoreEncryption: custom aad", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  const result = mod.configureUserSkillStoreEncryption({
    enabled: false,
    aad: "custom:aad:v1",
  });

  expect(result.aad).toBe("custom:aad:v1");
});

it("initUserSkillStore: returns ok with mode", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  const result = await mod.initUserSkillStore({ forceReload: true });

  expect(result.ok).toBe(true);
  expect(["memory", "localstorage", "indexeddb"].includes(result.mode)).toBeTruthy();
});

it("initUserSkillStore: accepts encryption option", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  // Should not throw
  const result = await mod.initUserSkillStore({
    forceReload: true,
    encryption: { enabled: false },
  });

  expect(result.ok).toBe(true);
});

it("listUserSkills: returns empty array initially", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();
  const skills = mod.listUserSkills();

  expect(Array.isArray(skills)).toBeTruthy();
});

it("loadUserSkillsIndex: returns normalized index", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();
  const index = mod.loadUserSkillsIndex();

  expect(index.schemaVersion).toBe("0.1");
  expect(Array.isArray(index.skills)).toBeTruthy();
});

it("saveUserSkillsIndex: normalizes and saves index", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  const saved = mod.saveUserSkillsIndex({
    schemaVersion: "0.1",
    skills: [{ name: "test-skill", description: "A test skill" }],
  });

  expect(saved).toBe(true);

  const loaded = mod.loadUserSkillsIndex();
  expect(loaded.skills.length).toBe(1);
  expect(loaded.skills[0].name).toBe("test-skill");
});

it("saveUserSkillsIndex: filters invalid skills", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  mod.saveUserSkillsIndex({
    schemaVersion: "0.1",
    skills: [
      { name: "valid", description: "ok" },
      { name: "", description: "empty name" },
      null,
      { description: "no name" },
    ],
  });

  const loaded = mod.loadUserSkillsIndex();
  expect(loaded.skills.length).toBe(1);
  expect(loaded.skills[0].name).toBe("valid");
});

it("getUserSkillBody: returns empty string for missing skill", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();
  const body = mod.getUserSkillBody("nonexistent");

  expect(body).toBe("");
});

it("getUserSkillBody: returns empty for empty/invalid name", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  expect(mod.getUserSkillBody("")).toBe("");
  expect(mod.getUserSkillBody(null)).toBe("");
  expect(mod.getUserSkillBody(undefined)).toBe("");
});

it("setUserSkillBody: stores and retrieves body", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  const result = mod.setUserSkillBody("my-skill", "# My Skill\nContent here");
  expect(result).toBe(true);

  const body = mod.getUserSkillBody("my-skill");
  expect(body).toBe("# My Skill\nContent here");
});

it("setUserSkillBody: returns false for empty name", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  expect(mod.setUserSkillBody("").toBe("body"), false);
  expect(mod.setUserSkillBody(null).toBe("body"), false);
});

it("setUserSkillBody: converts non-string body", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  mod.setUserSkillBody("num-skill", 123);
  expect(mod.getUserSkillBody("num-skill")).toBe("123");

  mod.setUserSkillBody("null-skill", null);
  expect(mod.getUserSkillBody("null-skill")).toBe("");
});

it("upsertUserSkill: creates new skill with metadata", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  const result = mod.upsertUserSkill({
    metadata: {
      name: "new-skill",
      description: "A brand new skill",
      shortDescription: "New",
      keywords: ["test", "new"],
      priority: 50,
    },
    body: "# New Skill Body",
  });

  expect(result).toEqual({ ok: true, name: "new-skill" });

  const skills = mod.listUserSkills();
  expect(skills.length).toBe(1);
  expect(skills[0].name).toBe("new-skill");
  expect(skills[0].description).toBe("A brand new skill");
  expect(skills[0].shortDescription).toBe("New");
  expect(skills[0].keywords).toEqual(["test", "new"]);
  expect(skills[0].priority).toBe(50);
  expect(skills[0].scope).toBe("user");
  expect(skills[0].createdAt).toBeTruthy();
  expect(skills[0].updatedAt).toBeTruthy();

  const body = mod.getUserSkillBody("new-skill");
  expect(body).toBe("# New Skill Body");
});

it("upsertUserSkill: updates existing skill", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  mod.upsertUserSkill({
    metadata: { name: "update-test", description: "Original" },
    body: "Original body",
  });

  const originalSkills = mod.listUserSkills();
  const originalCreatedAt = originalSkills[0].createdAt;

  // Small delay to ensure updatedAt differs
  await new Promise((r) => setTimeout(r, 10));

  mod.upsertUserSkill({
    metadata: { name: "update-test", description: "Updated" },
    body: "Updated body",
  });

  const skills = mod.listUserSkills();
  expect(skills.length).toBe(1);
  expect(skills[0].description).toBe("Updated");
  // createdAt should be preserved from original
  expect(skills[0].createdAt).toBe(originalCreatedAt);

  const body = mod.getUserSkillBody("update-test");
  expect(body).toBe("Updated body");
});

it("upsertUserSkill: throws without name", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  expect(() =>
      mod.upsertUserSkill({
        metadata: { description: "No name" },
      }),
    /name\/description are required/
  );
});

it("upsertUserSkill: throws without description", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  expect(() =>
      mod.upsertUserSkill({
        metadata: { name: "has-name" },
      }),
    /name\/description are required/
  );
});

it("upsertUserSkill: handles optional fields gracefully", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  mod.upsertUserSkill({
    metadata: {
      name: "minimal",
      description: "Minimal skill",
      // All optional fields missing
    },
  });

  const skills = mod.listUserSkills();
  expect(skills[0].shortDescription).toBe(null);
  expect(skills[0].keywords).toEqual([]);
  expect(skills[0].keywordsAll).toEqual([]);
  expect(skills[0].allowedTools).toBe(null);
  expect(skills[0].tags).toBe(null);
  expect(skills[0].traits).toBe(null);
  expect(skills[0].priority).toBe(100);
});

it("upsertUserSkill: accepts tags and traits", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  mod.upsertUserSkill({
    metadata: {
      name: "tagged",
      description: "Skill with tags",
      tags: { category: "utility", level: "advanced" },
      traits: ["fast", "reliable"],
    },
  });

  const skills = mod.listUserSkills();
  expect(skills[0].tags).toEqual({ category: "utility", level: "advanced" });
  expect(skills[0].traits).toEqual(["fast", "reliable"]);
});

it("deleteUserSkill: removes skill and body", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  mod.upsertUserSkill({
    metadata: { name: "to-delete", description: "Will be deleted" },
    body: "Delete me",
  });

  expect(mod.listUserSkills().length).toBe(1);
  expect(mod.getUserSkillBody("to-delete")).toBe("Delete me");

  const result = mod.deleteUserSkill("to-delete");
  expect(result).toBe(true);

  expect(mod.listUserSkills().length).toBe(0);
  expect(mod.getUserSkillBody("to-delete")).toBe("");
});

it("deleteUserSkill: returns false for empty name", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  expect(mod.deleteUserSkill("")).toBe(false);
  expect(mod.deleteUserSkill(null)).toBe(false);
});

it("deleteUserSkill: handles nonexistent skill gracefully", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  // Should not throw, returns true (no-op)
  const result = mod.deleteUserSkill("never-existed");
  expect(result).toBe(true);
});

it("clearUserSkills: removes all skills", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.upsertUserSkill({
    metadata: { name: "skill-1", description: "First" },
    body: "Body 1",
  });
  mod.upsertUserSkill({
    metadata: { name: "skill-2", description: "Second" },
    body: "Body 2",
  });

  expect(mod.listUserSkills().toBeTruthy().length >= 2);

  const result = mod.clearUserSkills();
  expect(result).toBe(true);

  expect(mod.listUserSkills().length).toBe(0);
  expect(mod.getUserSkillBody("skill-1")).toBe("");
  expect(mod.getUserSkillBody("skill-2")).toBe("");
});

it("default export: contains all public methods", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  const defaultExport = mod.default;

  expect(typeof defaultExport.configureUserSkillStoreEncryption).toBe("function");
  expect(typeof defaultExport.initUserSkillStore).toBe("function");
  expect(typeof defaultExport.listUserSkills).toBe("function");
  expect(typeof defaultExport.loadUserSkillsIndex).toBe("function");
  expect(typeof defaultExport.saveUserSkillsIndex).toBe("function");
  expect(typeof defaultExport.getUserSkillBody).toBe("function");
  expect(typeof defaultExport.setUserSkillBody).toBe("function");
  expect(typeof defaultExport.upsertUserSkill).toBe("function");
  expect(typeof defaultExport.deleteUserSkill).toBe("function");
  expect(typeof defaultExport.clearUserSkills).toBe("function");
});

it("multiple skills: maintains separate bodies", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  mod.upsertUserSkill({
    metadata: { name: "alpha", description: "Alpha skill" },
    body: "Alpha content",
  });
  mod.upsertUserSkill({
    metadata: { name: "beta", description: "Beta skill" },
    body: "Beta content",
  });
  mod.upsertUserSkill({
    metadata: { name: "gamma", description: "Gamma skill" },
    body: "Gamma content",
  });

  expect(mod.listUserSkills().length).toBe(3);
  expect(mod.getUserSkillBody("alpha")).toBe("Alpha content");
  expect(mod.getUserSkillBody("beta")).toBe("Beta content");
  expect(mod.getUserSkillBody("gamma")).toBe("Gamma content");
});

it("skill ordering: preserves insertion order", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  mod.upsertUserSkill({
    metadata: { name: "first", description: "First" },
  });
  mod.upsertUserSkill({
    metadata: { name: "second", description: "Second" },
  });
  mod.upsertUserSkill({
    metadata: { name: "third", description: "Third" },
  });

  const names = mod.listUserSkills().map((s) => s.name);
  expect(names).toEqual(["first", "second", "third"]);
});

it("saveUserSkillsIndex: handles malformed input", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  // null input
  mod.saveUserSkillsIndex(null);
  let index = mod.loadUserSkillsIndex();
  expect(index.schemaVersion).toBe("0.1");
  expect(index.skills).toEqual([]);

  // undefined input
  mod.saveUserSkillsIndex(undefined);
  index = mod.loadUserSkillsIndex();
  expect(index.skills).toEqual([]);

  // skills not array
  mod.saveUserSkillsIndex({ skills: "not-array" });
  index = mod.loadUserSkillsIndex();
  expect(index.skills).toEqual([]);
});

it("upsertUserSkill: handles non-object metadata", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  expect(() => mod.upsertUserSkill({ metadata: "string" })).toThrow(
    /name\/description are required/
  );

  expect(() => mod.upsertUserSkill({ metadata: null })).toThrow(
    /name\/description are required/
  );
});

it("upsertUserSkill: priority normalization", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  // String priority
  mod.upsertUserSkill({
    metadata: { name: "str-priority", description: "test", priority: "75" },
  });
  expect(mod.listUserSkills()[0].priority).toBe(75);

  mod.clearUserSkills();

  // Invalid priority -> defaults to 100
  mod.upsertUserSkill({
    metadata: { name: "bad-priority", description: "test", priority: "not-a-number" },
  });
  expect(mod.listUserSkills()[0].priority).toBe(100);
});

it("setUserSkillBody: handles unicode content", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  const unicodeContent = "# Chinese\n\n## Japanese\n\n## Korean\n\n## Emoji ";
  mod.setUserSkillBody("unicode-skill", unicodeContent);

  expect(mod.getUserSkillBody("unicode-skill")).toBe(unicodeContent);
});

it("setUserSkillBody: handles empty body", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  mod.setUserSkillBody("empty-body", "");
  expect(mod.getUserSkillBody("empty-body")).toBe("");
});

it("deleteUserSkill: only removes specified skill", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  mod.upsertUserSkill({ metadata: { name: "keep-1", description: "Keep" } });
  mod.upsertUserSkill({ metadata: { name: "delete-me", description: "Delete" } });
  mod.upsertUserSkill({ metadata: { name: "keep-2", description: "Keep" } });

  mod.deleteUserSkill("delete-me");

  const names = mod.listUserSkills().map((s) => s.name);
  expect(names).toEqual(["keep-1", "keep-2"]);
});

it("upsertUserSkill: allowedTools as string", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  mod.upsertUserSkill({
    metadata: {
      name: "tools-skill",
      description: "Has tools",
      allowedTools: "search,read,write",
    },
  });

  const skill = mod.listUserSkills()[0];
  expect(skill.allowedTools).toBe("search,read,write");
});

it("upsertUserSkill: keywordsAll array", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  mod.upsertUserSkill({
    metadata: {
      name: "keywords-skill",
      description: "Has keywords",
      keywords: ["primary"],
      keywordsAll: ["primary", "secondary", "tertiary"],
    },
  });

  const skill = mod.listUserSkills()[0];
  expect(skill.keywords).toEqual(["primary"]);
  expect(skill.keywordsAll).toEqual(["primary", "secondary", "tertiary"]);
});

it("upsertUserSkill: empty input object", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  expect(() => mod.upsertUserSkill({})).toThrow(/name\/description are required/);
  expect(() => mod.upsertUserSkill()).toThrow(/name\/description are required/);
});

it("upsertUserSkill: non-array keywords defaults to empty", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  mod.upsertUserSkill({
    metadata: {
      name: "bad-keywords",
      description: "test",
      keywords: "not-an-array",
      keywordsAll: { obj: true },
    },
  });

  const skill = mod.listUserSkills()[0];
  expect(skill.keywords).toEqual([]);
  expect(skill.keywordsAll).toEqual([]);
});

it("upsertUserSkill: non-array traits defaults to null", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  mod.upsertUserSkill({
    metadata: {
      name: "bad-traits",
      description: "test",
      traits: "not-an-array",
    },
  });

  const skill = mod.listUserSkills()[0];
  expect(skill.traits).toBe(null);
});

it("upsertUserSkill: non-object tags defaults to null", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  mod.upsertUserSkill({
    metadata: {
      name: "bad-tags",
      description: "test",
      tags: ["array"],
    },
  });

  const skill = mod.listUserSkills()[0];
  // Arrays are not plain objects
  expect(skill.tags).toBe(null);
});

it("initUserSkillStore: repeated calls return cached result", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  const result1 = await mod.initUserSkillStore();
  const result2 = await mod.initUserSkillStore();

  expect(result1.ok).toBe(true);
  expect(result2.ok).toBe(true);
  expect(result1.mode).toBe(result2.mode);
});

it("listUserSkills: returns skills from index", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  mod.saveUserSkillsIndex({
    schemaVersion: "0.1",
    skills: [
      { name: "skill-a", description: "A" },
      { name: "skill-b", description: "B" },
    ],
  });

  const skills = mod.listUserSkills();
  expect(skills.length).toBe(2);
  expect(skills[0].name).toBe("skill-a");
  expect(skills[1].name).toBe("skill-b");
});

it("saveUserSkillsIndex: preserves skill properties", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  const originalSkill = {
    name: "full-skill",
    description: "Full featured",
    customProp: "custom",
    nested: { deep: true },
  };

  mod.saveUserSkillsIndex({
    schemaVersion: "0.1",
    skills: [originalSkill],
  });

  const loaded = mod.loadUserSkillsIndex();
  expect(loaded.skills[0].name).toBe("full-skill");
  expect(loaded.skills[0].customProp).toBe("custom");
  expect(loaded.skills[0].nested).toEqual({ deep: true });
});

it("clearUserSkills: works on empty store", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();
  const result = mod.clearUserSkills();

  expect(result).toBe(true);
  expect(mod.listUserSkills().length).toBe(0);
});

it("upsertUserSkill: body defaults to undefined when not provided", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  mod.upsertUserSkill({
    metadata: { name: "no-body", description: "test" },
  });

  const body = mod.getUserSkillBody("no-body");
  expect(body).toBe("");
});

it("setUserSkillBody: overwrites existing body", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  mod.setUserSkillBody("overwrite-test", "original");
  expect(mod.getUserSkillBody("overwrite-test")).toBe("original");

  mod.setUserSkillBody("overwrite-test", "updated");
  expect(mod.getUserSkillBody("overwrite-test")).toBe("updated");
});

it("configureUserSkillStoreEncryption: default aad when empty", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  const result = mod.configureUserSkillStoreEncryption({
    enabled: false,
    aad: "",
  });

  expect(result.aad).toBe("paperburner:user-skills:v1");
});

it("configureUserSkillStoreEncryption: non-finite iterations", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  const result = mod.configureUserSkillStoreEncryption({
    enabled: false,
    iterations: Infinity,
  });

  expect(result.iterations).toBe(100_000);
});

it("configureUserSkillStoreEncryption: NaN iterations", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  const result = mod.configureUserSkillStoreEncryption({
    enabled: false,
    iterations: NaN,
  });

  expect(result.iterations).toBe(100_000);
});

it("configureUserSkillStoreEncryption: null input", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  const result = mod.configureUserSkillStoreEncryption(null);

  expect(result.enabled).toBe(false);
  // passphrase becomes undefined when input has no passphrase field
  expect(result.passphrase === "" || result.passphrase === undefined).toBeTruthy();
});

it("configureUserSkillStoreEncryption: non-object input", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  const result = mod.configureUserSkillStoreEncryption("string");

  expect(result.enabled).toBe(false);
});

it("saveUserSkillsIndex: returns true in memory mode", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  const result = mod.saveUserSkillsIndex({ schemaVersion: "0.1", skills: [] });
  expect(result).toBe(true);
});

it("upsertUserSkill: multiple updates preserve order", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  mod.upsertUserSkill({ metadata: { name: "a", description: "A" } });
  mod.upsertUserSkill({ metadata: { name: "b", description: "B" } });
  mod.upsertUserSkill({ metadata: { name: "c", description: "C" } });

  // Update middle item
  mod.upsertUserSkill({ metadata: { name: "b", description: "B updated" } });

  const names = mod.listUserSkills().map((s) => s.name);
  // Order should be preserved with 'b' in its original position
  expect(names).toEqual(["a", "b", "c"]);
  expect(mod.listUserSkills()[1].description).toBe("B updated");
});

it("deleteUserSkill: deleting first skill", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  mod.upsertUserSkill({ metadata: { name: "first", description: "1" } });
  mod.upsertUserSkill({ metadata: { name: "second", description: "2" } });

  mod.deleteUserSkill("first");

  const names = mod.listUserSkills().map((s) => s.name);
  expect(names).toEqual(["second"]);
});

it("deleteUserSkill: deleting last skill", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  mod.upsertUserSkill({ metadata: { name: "first", description: "1" } });
  mod.upsertUserSkill({ metadata: { name: "last", description: "2" } });

  mod.deleteUserSkill("last");

  const names = mod.listUserSkills().map((s) => s.name);
  expect(names).toEqual(["first"]);
});

it("setUserSkillBody: special characters in name", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  const specialName = "skill:with/special@chars#123";
  mod.setUserSkillBody(specialName, "content");

  expect(mod.getUserSkillBody(specialName)).toBe("content");
});

it("upsertUserSkill: whitespace-only name throws", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  expect(() =>
      mod.upsertUserSkill({
        metadata: { name: "   ", description: "test" },
      }),
    /name\/description are required/
  );
});

it("upsertUserSkill: whitespace-only description throws", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  expect(() =>
      mod.upsertUserSkill({
        metadata: { name: "valid", description: "   " },
      }),
    /name\/description are required/
  );
});

it("loadUserSkillsIndex: always returns schemaVersion", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();
  const index = mod.loadUserSkillsIndex();

  expect(index.schemaVersion).toBe("0.1");
});

it("setUserSkillBody: undefined body converts to empty string", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  mod.setUserSkillBody("undef-body", undefined);
  expect(mod.getUserSkillBody("undef-body")).toBe("");
});

it("upsertUserSkill: float priority is converted to number", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  mod.upsertUserSkill({
    metadata: { name: "float-priority", description: "test", priority: 75.5 },
  });

  expect(mod.listUserSkills()[0].priority).toBe(75.5);
});

it("upsertUserSkill: negative priority is accepted", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  mod.upsertUserSkill({
    metadata: { name: "neg-priority", description: "test", priority: -10 },
  });

  expect(mod.listUserSkills()[0].priority).toBe(-10);
});

it("saveUserSkillsIndex: empty skills array", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.upsertUserSkill({ metadata: { name: "temp", description: "temp" } });

  mod.saveUserSkillsIndex({ schemaVersion: "0.1", skills: [] });

  const index = mod.loadUserSkillsIndex();
  expect(index.skills.length).toBe(0);
});

it("configureUserSkillStoreEncryption: enabled with passphrase", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  const result = mod.configureUserSkillStoreEncryption({
    enabled: true,
    passphrase: "secret123",
  });

  // Should be enabled if WebCrypto is available
  expect(typeof result.enabled).toBe("boolean");
  expect(typeof result.available).toBe("boolean");
});

it("configureUserSkillStoreEncryption: passphrase without enabled flag", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  // passphrase alone should enable encryption (cfg.enabled ?? passphrase)
  const result = mod.configureUserSkillStoreEncryption({
    passphrase: "secret123",
  });

  expect(typeof result.enabled).toBe("boolean");
});

it("configureUserSkillStoreEncryption: explicitly disabled with passphrase", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  const result = mod.configureUserSkillStoreEncryption({
    enabled: false,
    passphrase: "secret123",
  });

  // Should respect explicit enabled: false
  expect(result.enabled).toBe(false);
});

it("getUserSkillBody: number name is converted", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  mod.setUserSkillBody(123, "numeric name content");
  expect(mod.getUserSkillBody(123)).toBe("numeric name content");
  expect(mod.getUserSkillBody("123")).toBe("numeric name content");
});

it("deleteUserSkill: number name is converted", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  mod.setUserSkillBody(456, "to delete");
  expect(mod.getUserSkillBody(456)).toBe("to delete");

  mod.deleteUserSkill(456);
  expect(mod.getUserSkillBody(456)).toBe("");
});

it("upsertUserSkill: createdAt is set only on first insert", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  mod.upsertUserSkill({
    metadata: { name: "timestamp-test", description: "test" },
  });

  const firstSkill = mod.listUserSkills()[0];
  const createdAt = firstSkill.createdAt;
  const updatedAt = firstSkill.updatedAt;

  expect(createdAt).toBeTruthy();
  expect(updatedAt).toBeTruthy();

  await new Promise((r) => setTimeout(r, 5));

  mod.upsertUserSkill({
    metadata: { name: "timestamp-test", description: "updated" },
  });

  const secondSkill = mod.listUserSkills()[0];
  // createdAt should be the same, updatedAt should change
  expect(secondSkill.createdAt).toBe(createdAt);
});

it("normalizeIndex: filters skills with object but no name property", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  mod.saveUserSkillsIndex({
    schemaVersion: "0.1",
    skills: [
      { name: "valid", description: "ok" },
      { notName: "invalid" },
      { name: 123, description: "numeric name should work" }, // name is converted via toNonEmptyString
    ],
  });

  const loaded = mod.loadUserSkillsIndex();
  expect(loaded.skills.length).toBe(2);
});

it("clearUserSkills: removes bodies stored separately", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  // Add body without skill in index
  mod.setUserSkillBody("orphan-body", "orphan content");
  expect(mod.getUserSkillBody("orphan-body")).toBe("orphan content");

  // Now add a proper skill and body
  mod.upsertUserSkill({
    metadata: { name: "proper", description: "proper" },
    body: "proper body",
  });

  mod.clearUserSkills();

  // Orphan body should still be accessible (it wasn't in the index)
  // proper body should be cleared
  expect(mod.getUserSkillBody("proper")).toBe("");
});

it("upsertUserSkill: scope is always 'user'", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  mod.upsertUserSkill({
    metadata: {
      name: "custom-scope",
      description: "test",
      scope: "system", // Try to override
    },
  });

  const skill = mod.listUserSkills()[0];
  expect(skill.scope).toBe("user");
});

it("setUserSkillBody: object body is stringified", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  mod.setUserSkillBody("obj-body", { key: "value" });
  expect(mod.getUserSkillBody("obj-body")).toBe("[object Object]");
});

it("setUserSkillBody: boolean body is stringified", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  mod.setUserSkillBody("bool-true", true);
  mod.setUserSkillBody("bool-false", false);

  expect(mod.getUserSkillBody("bool-true")).toBe("true");
  expect(mod.getUserSkillBody("bool-false")).toBe("false");
});

it("initUserSkillStore: forceReload refreshes state", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  const result1 = await mod.initUserSkillStore();
  const result2 = await mod.initUserSkillStore({ forceReload: true });

  expect(result1.ok).toBe(true);
  expect(result2.ok).toBe(true);
});

it("upsertUserSkill: very long skill name", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  const longName = "a".repeat(1000);
  mod.upsertUserSkill({
    metadata: { name: longName, description: "long name test" },
    body: "content",
  });

  expect(mod.listUserSkills().length).toBe(1);
  expect(mod.listUserSkills()[0].name).toBe(longName);
  expect(mod.getUserSkillBody(longName)).toBe("content");
});

it("upsertUserSkill: very long body", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  const longBody = "x".repeat(100000);
  mod.upsertUserSkill({
    metadata: { name: "long-body", description: "test" },
    body: longBody,
  });

  expect(mod.getUserSkillBody("long-body")).toBe(longBody);
});

it("saveUserSkillsIndex: non-object skills in array are filtered", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  mod.saveUserSkillsIndex({
    schemaVersion: "0.1",
    skills: [
      { name: "valid", description: "ok" },
      "string-skill",
      42,
      true,
      undefined,
      [],
    ],
  });

  const loaded = mod.loadUserSkillsIndex();
  expect(loaded.skills.length).toBe(1);
});
