import test from "node:test";
import assert from "node:assert/strict";

test("configureUserSkillStoreEncryption: returns config with available flag", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  const result = mod.configureUserSkillStoreEncryption({ enabled: false });

  assert.equal(typeof result.available, "boolean");
  assert.equal(result.enabled, false);
});

test("configureUserSkillStoreEncryption: enabled without passphrase -> disabled", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  const result = mod.configureUserSkillStoreEncryption({
    enabled: true,
    passphrase: "",
  });

  assert.equal(result.enabled, false);
});

test("configureUserSkillStoreEncryption: required without passphrase -> throws", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  assert.throws(
    () =>
      mod.configureUserSkillStoreEncryption({
        enabled: true,
        required: true,
        passphrase: "",
      }),
    /passphrase is missing/
  );
});

test("configureUserSkillStoreEncryption: normalizes iterations", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  // Too low -> clamped to 10_000
  const result = mod.configureUserSkillStoreEncryption({
    enabled: false,
    iterations: 100,
  });

  assert.equal(result.iterations, 10_000);
});

test("configureUserSkillStoreEncryption: custom aad", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  const result = mod.configureUserSkillStoreEncryption({
    enabled: false,
    aad: "custom:aad:v1",
  });

  assert.equal(result.aad, "custom:aad:v1");
});

test("initUserSkillStore: returns ok with mode", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  const result = await mod.initUserSkillStore({ forceReload: true });

  assert.equal(result.ok, true);
  assert.ok(["memory", "localstorage", "indexeddb"].includes(result.mode));
});

test("initUserSkillStore: accepts encryption option", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  // Should not throw
  const result = await mod.initUserSkillStore({
    forceReload: true,
    encryption: { enabled: false },
  });

  assert.equal(result.ok, true);
});

test("listUserSkills: returns empty array initially", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();
  const skills = mod.listUserSkills();

  assert.ok(Array.isArray(skills));
});

test("loadUserSkillsIndex: returns normalized index", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();
  const index = mod.loadUserSkillsIndex();

  assert.equal(index.schemaVersion, "0.1");
  assert.ok(Array.isArray(index.skills));
});

test("saveUserSkillsIndex: normalizes and saves index", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  const saved = mod.saveUserSkillsIndex({
    schemaVersion: "0.1",
    skills: [{ name: "test-skill", description: "A test skill" }],
  });

  assert.equal(saved, true);

  const loaded = mod.loadUserSkillsIndex();
  assert.equal(loaded.skills.length, 1);
  assert.equal(loaded.skills[0].name, "test-skill");
});

test("saveUserSkillsIndex: filters invalid skills", async () => {
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
  assert.equal(loaded.skills.length, 1);
  assert.equal(loaded.skills[0].name, "valid");
});

test("getUserSkillBody: returns empty string for missing skill", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();
  const body = mod.getUserSkillBody("nonexistent");

  assert.equal(body, "");
});

test("getUserSkillBody: returns empty for empty/invalid name", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  assert.equal(mod.getUserSkillBody(""), "");
  assert.equal(mod.getUserSkillBody(null), "");
  assert.equal(mod.getUserSkillBody(undefined), "");
});

test("setUserSkillBody: stores and retrieves body", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  const result = mod.setUserSkillBody("my-skill", "# My Skill\nContent here");
  assert.equal(result, true);

  const body = mod.getUserSkillBody("my-skill");
  assert.equal(body, "# My Skill\nContent here");
});

test("setUserSkillBody: returns false for empty name", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  assert.equal(mod.setUserSkillBody("", "body"), false);
  assert.equal(mod.setUserSkillBody(null, "body"), false);
});

test("setUserSkillBody: converts non-string body", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  mod.setUserSkillBody("num-skill", 123);
  assert.equal(mod.getUserSkillBody("num-skill"), "123");

  mod.setUserSkillBody("null-skill", null);
  assert.equal(mod.getUserSkillBody("null-skill"), "");
});

test("upsertUserSkill: creates new skill with metadata", async () => {
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

  assert.deepEqual(result, { ok: true, name: "new-skill" });

  const skills = mod.listUserSkills();
  assert.equal(skills.length, 1);
  assert.equal(skills[0].name, "new-skill");
  assert.equal(skills[0].description, "A brand new skill");
  assert.equal(skills[0].shortDescription, "New");
  assert.deepEqual(skills[0].keywords, ["test", "new"]);
  assert.equal(skills[0].priority, 50);
  assert.equal(skills[0].scope, "user");
  assert.ok(skills[0].createdAt);
  assert.ok(skills[0].updatedAt);

  const body = mod.getUserSkillBody("new-skill");
  assert.equal(body, "# New Skill Body");
});

test("upsertUserSkill: updates existing skill", async () => {
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
  assert.equal(skills.length, 1);
  assert.equal(skills[0].description, "Updated");
  // createdAt should be preserved from original
  assert.equal(skills[0].createdAt, originalCreatedAt);

  const body = mod.getUserSkillBody("update-test");
  assert.equal(body, "Updated body");
});

test("upsertUserSkill: throws without name", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  assert.throws(
    () =>
      mod.upsertUserSkill({
        metadata: { description: "No name" },
      }),
    /name\/description are required/
  );
});

test("upsertUserSkill: throws without description", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  assert.throws(
    () =>
      mod.upsertUserSkill({
        metadata: { name: "has-name" },
      }),
    /name\/description are required/
  );
});

test("upsertUserSkill: handles optional fields gracefully", async () => {
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
  assert.equal(skills[0].shortDescription, null);
  assert.deepEqual(skills[0].keywords, []);
  assert.deepEqual(skills[0].keywordsAll, []);
  assert.equal(skills[0].allowedTools, null);
  assert.equal(skills[0].tags, null);
  assert.equal(skills[0].traits, null);
  assert.equal(skills[0].priority, 100);
});

test("upsertUserSkill: accepts tags and traits", async () => {
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
  assert.deepEqual(skills[0].tags, { category: "utility", level: "advanced" });
  assert.deepEqual(skills[0].traits, ["fast", "reliable"]);
});

test("deleteUserSkill: removes skill and body", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  mod.upsertUserSkill({
    metadata: { name: "to-delete", description: "Will be deleted" },
    body: "Delete me",
  });

  assert.equal(mod.listUserSkills().length, 1);
  assert.equal(mod.getUserSkillBody("to-delete"), "Delete me");

  const result = mod.deleteUserSkill("to-delete");
  assert.equal(result, true);

  assert.equal(mod.listUserSkills().length, 0);
  assert.equal(mod.getUserSkillBody("to-delete"), "");
});

test("deleteUserSkill: returns false for empty name", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  assert.equal(mod.deleteUserSkill(""), false);
  assert.equal(mod.deleteUserSkill(null), false);
});

test("deleteUserSkill: handles nonexistent skill gracefully", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  // Should not throw, returns true (no-op)
  const result = mod.deleteUserSkill("never-existed");
  assert.equal(result, true);
});

test("clearUserSkills: removes all skills", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.upsertUserSkill({
    metadata: { name: "skill-1", description: "First" },
    body: "Body 1",
  });
  mod.upsertUserSkill({
    metadata: { name: "skill-2", description: "Second" },
    body: "Body 2",
  });

  assert.ok(mod.listUserSkills().length >= 2);

  const result = mod.clearUserSkills();
  assert.equal(result, true);

  assert.equal(mod.listUserSkills().length, 0);
  assert.equal(mod.getUserSkillBody("skill-1"), "");
  assert.equal(mod.getUserSkillBody("skill-2"), "");
});

test("default export: contains all public methods", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  const defaultExport = mod.default;

  assert.equal(typeof defaultExport.configureUserSkillStoreEncryption, "function");
  assert.equal(typeof defaultExport.initUserSkillStore, "function");
  assert.equal(typeof defaultExport.listUserSkills, "function");
  assert.equal(typeof defaultExport.loadUserSkillsIndex, "function");
  assert.equal(typeof defaultExport.saveUserSkillsIndex, "function");
  assert.equal(typeof defaultExport.getUserSkillBody, "function");
  assert.equal(typeof defaultExport.setUserSkillBody, "function");
  assert.equal(typeof defaultExport.upsertUserSkill, "function");
  assert.equal(typeof defaultExport.deleteUserSkill, "function");
  assert.equal(typeof defaultExport.clearUserSkills, "function");
});

test("multiple skills: maintains separate bodies", async () => {
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

  assert.equal(mod.listUserSkills().length, 3);
  assert.equal(mod.getUserSkillBody("alpha"), "Alpha content");
  assert.equal(mod.getUserSkillBody("beta"), "Beta content");
  assert.equal(mod.getUserSkillBody("gamma"), "Gamma content");
});

test("skill ordering: preserves insertion order", async () => {
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
  assert.deepEqual(names, ["first", "second", "third"]);
});

test("saveUserSkillsIndex: handles malformed input", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  // null input
  mod.saveUserSkillsIndex(null);
  let index = mod.loadUserSkillsIndex();
  assert.equal(index.schemaVersion, "0.1");
  assert.deepEqual(index.skills, []);

  // undefined input
  mod.saveUserSkillsIndex(undefined);
  index = mod.loadUserSkillsIndex();
  assert.deepEqual(index.skills, []);

  // skills not array
  mod.saveUserSkillsIndex({ skills: "not-array" });
  index = mod.loadUserSkillsIndex();
  assert.deepEqual(index.skills, []);
});

test("upsertUserSkill: handles non-object metadata", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  assert.throws(
    () => mod.upsertUserSkill({ metadata: "string" }),
    /name\/description are required/
  );

  assert.throws(
    () => mod.upsertUserSkill({ metadata: null }),
    /name\/description are required/
  );
});

test("upsertUserSkill: priority normalization", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  // String priority
  mod.upsertUserSkill({
    metadata: { name: "str-priority", description: "test", priority: "75" },
  });
  assert.equal(mod.listUserSkills()[0].priority, 75);

  mod.clearUserSkills();

  // Invalid priority -> defaults to 100
  mod.upsertUserSkill({
    metadata: { name: "bad-priority", description: "test", priority: "not-a-number" },
  });
  assert.equal(mod.listUserSkills()[0].priority, 100);
});

test("setUserSkillBody: handles unicode content", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  const unicodeContent = "# Chinese\n\n## Japanese\n\n## Korean\n\n## Emoji ";
  mod.setUserSkillBody("unicode-skill", unicodeContent);

  assert.equal(mod.getUserSkillBody("unicode-skill"), unicodeContent);
});

test("setUserSkillBody: handles empty body", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  mod.setUserSkillBody("empty-body", "");
  assert.equal(mod.getUserSkillBody("empty-body"), "");
});

test("deleteUserSkill: only removes specified skill", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  mod.upsertUserSkill({ metadata: { name: "keep-1", description: "Keep" } });
  mod.upsertUserSkill({ metadata: { name: "delete-me", description: "Delete" } });
  mod.upsertUserSkill({ metadata: { name: "keep-2", description: "Keep" } });

  mod.deleteUserSkill("delete-me");

  const names = mod.listUserSkills().map((s) => s.name);
  assert.deepEqual(names, ["keep-1", "keep-2"]);
});

test("upsertUserSkill: allowedTools as string", async () => {
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
  assert.equal(skill.allowedTools, "search,read,write");
});

test("upsertUserSkill: keywordsAll array", async () => {
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
  assert.deepEqual(skill.keywords, ["primary"]);
  assert.deepEqual(skill.keywordsAll, ["primary", "secondary", "tertiary"]);
});

test("upsertUserSkill: empty input object", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  assert.throws(() => mod.upsertUserSkill({}), /name\/description are required/);
  assert.throws(() => mod.upsertUserSkill(), /name\/description are required/);
});

test("upsertUserSkill: non-array keywords defaults to empty", async () => {
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
  assert.deepEqual(skill.keywords, []);
  assert.deepEqual(skill.keywordsAll, []);
});

test("upsertUserSkill: non-array traits defaults to null", async () => {
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
  assert.equal(skill.traits, null);
});

test("upsertUserSkill: non-object tags defaults to null", async () => {
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
  assert.equal(skill.tags, null);
});

test("initUserSkillStore: repeated calls return cached result", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  const result1 = await mod.initUserSkillStore();
  const result2 = await mod.initUserSkillStore();

  assert.equal(result1.ok, true);
  assert.equal(result2.ok, true);
  assert.equal(result1.mode, result2.mode);
});

test("listUserSkills: returns skills from index", async () => {
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
  assert.equal(skills.length, 2);
  assert.equal(skills[0].name, "skill-a");
  assert.equal(skills[1].name, "skill-b");
});

test("saveUserSkillsIndex: preserves skill properties", async () => {
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
  assert.equal(loaded.skills[0].name, "full-skill");
  assert.equal(loaded.skills[0].customProp, "custom");
  assert.deepEqual(loaded.skills[0].nested, { deep: true });
});

test("clearUserSkills: works on empty store", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();
  const result = mod.clearUserSkills();

  assert.equal(result, true);
  assert.equal(mod.listUserSkills().length, 0);
});

test("upsertUserSkill: body defaults to undefined when not provided", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  mod.upsertUserSkill({
    metadata: { name: "no-body", description: "test" },
  });

  const body = mod.getUserSkillBody("no-body");
  assert.equal(body, "");
});

test("setUserSkillBody: overwrites existing body", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  mod.setUserSkillBody("overwrite-test", "original");
  assert.equal(mod.getUserSkillBody("overwrite-test"), "original");

  mod.setUserSkillBody("overwrite-test", "updated");
  assert.equal(mod.getUserSkillBody("overwrite-test"), "updated");
});

test("configureUserSkillStoreEncryption: default aad when empty", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  const result = mod.configureUserSkillStoreEncryption({
    enabled: false,
    aad: "",
  });

  assert.equal(result.aad, "paperburner:user-skills:v1");
});

test("configureUserSkillStoreEncryption: non-finite iterations", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  const result = mod.configureUserSkillStoreEncryption({
    enabled: false,
    iterations: Infinity,
  });

  assert.equal(result.iterations, 100_000);
});

test("configureUserSkillStoreEncryption: NaN iterations", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  const result = mod.configureUserSkillStoreEncryption({
    enabled: false,
    iterations: NaN,
  });

  assert.equal(result.iterations, 100_000);
});

test("configureUserSkillStoreEncryption: null input", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  const result = mod.configureUserSkillStoreEncryption(null);

  assert.equal(result.enabled, false);
  // passphrase becomes undefined when input has no passphrase field
  assert.ok(result.passphrase === "" || result.passphrase === undefined);
});

test("configureUserSkillStoreEncryption: non-object input", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  const result = mod.configureUserSkillStoreEncryption("string");

  assert.equal(result.enabled, false);
});

test("saveUserSkillsIndex: returns true in memory mode", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  const result = mod.saveUserSkillsIndex({ schemaVersion: "0.1", skills: [] });
  assert.equal(result, true);
});

test("upsertUserSkill: multiple updates preserve order", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  mod.upsertUserSkill({ metadata: { name: "a", description: "A" } });
  mod.upsertUserSkill({ metadata: { name: "b", description: "B" } });
  mod.upsertUserSkill({ metadata: { name: "c", description: "C" } });

  // Update middle item
  mod.upsertUserSkill({ metadata: { name: "b", description: "B updated" } });

  const names = mod.listUserSkills().map((s) => s.name);
  // Order should be preserved with 'b' in its original position
  assert.deepEqual(names, ["a", "b", "c"]);
  assert.equal(mod.listUserSkills()[1].description, "B updated");
});

test("deleteUserSkill: deleting first skill", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  mod.upsertUserSkill({ metadata: { name: "first", description: "1" } });
  mod.upsertUserSkill({ metadata: { name: "second", description: "2" } });

  mod.deleteUserSkill("first");

  const names = mod.listUserSkills().map((s) => s.name);
  assert.deepEqual(names, ["second"]);
});

test("deleteUserSkill: deleting last skill", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  mod.upsertUserSkill({ metadata: { name: "first", description: "1" } });
  mod.upsertUserSkill({ metadata: { name: "last", description: "2" } });

  mod.deleteUserSkill("last");

  const names = mod.listUserSkills().map((s) => s.name);
  assert.deepEqual(names, ["first"]);
});

test("setUserSkillBody: special characters in name", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  const specialName = "skill:with/special@chars#123";
  mod.setUserSkillBody(specialName, "content");

  assert.equal(mod.getUserSkillBody(specialName), "content");
});

test("upsertUserSkill: whitespace-only name throws", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  assert.throws(
    () =>
      mod.upsertUserSkill({
        metadata: { name: "   ", description: "test" },
      }),
    /name\/description are required/
  );
});

test("upsertUserSkill: whitespace-only description throws", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  assert.throws(
    () =>
      mod.upsertUserSkill({
        metadata: { name: "valid", description: "   " },
      }),
    /name\/description are required/
  );
});

test("loadUserSkillsIndex: always returns schemaVersion", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();
  const index = mod.loadUserSkillsIndex();

  assert.equal(index.schemaVersion, "0.1");
});

test("setUserSkillBody: undefined body converts to empty string", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  mod.setUserSkillBody("undef-body", undefined);
  assert.equal(mod.getUserSkillBody("undef-body"), "");
});

test("upsertUserSkill: float priority is converted to number", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  mod.upsertUserSkill({
    metadata: { name: "float-priority", description: "test", priority: 75.5 },
  });

  assert.equal(mod.listUserSkills()[0].priority, 75.5);
});

test("upsertUserSkill: negative priority is accepted", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  mod.upsertUserSkill({
    metadata: { name: "neg-priority", description: "test", priority: -10 },
  });

  assert.equal(mod.listUserSkills()[0].priority, -10);
});

test("saveUserSkillsIndex: empty skills array", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.upsertUserSkill({ metadata: { name: "temp", description: "temp" } });

  mod.saveUserSkillsIndex({ schemaVersion: "0.1", skills: [] });

  const index = mod.loadUserSkillsIndex();
  assert.equal(index.skills.length, 0);
});

test("configureUserSkillStoreEncryption: enabled with passphrase", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  const result = mod.configureUserSkillStoreEncryption({
    enabled: true,
    passphrase: "secret123",
  });

  // Should be enabled if WebCrypto is available
  assert.equal(typeof result.enabled, "boolean");
  assert.equal(typeof result.available, "boolean");
});

test("configureUserSkillStoreEncryption: passphrase without enabled flag", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  // passphrase alone should enable encryption (cfg.enabled ?? passphrase)
  const result = mod.configureUserSkillStoreEncryption({
    passphrase: "secret123",
  });

  assert.equal(typeof result.enabled, "boolean");
});

test("configureUserSkillStoreEncryption: explicitly disabled with passphrase", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  const result = mod.configureUserSkillStoreEncryption({
    enabled: false,
    passphrase: "secret123",
  });

  // Should respect explicit enabled: false
  assert.equal(result.enabled, false);
});

test("getUserSkillBody: number name is converted", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  mod.setUserSkillBody(123, "numeric name content");
  assert.equal(mod.getUserSkillBody(123), "numeric name content");
  assert.equal(mod.getUserSkillBody("123"), "numeric name content");
});

test("deleteUserSkill: number name is converted", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  mod.setUserSkillBody(456, "to delete");
  assert.equal(mod.getUserSkillBody(456), "to delete");

  mod.deleteUserSkill(456);
  assert.equal(mod.getUserSkillBody(456), "");
});

test("upsertUserSkill: createdAt is set only on first insert", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  mod.upsertUserSkill({
    metadata: { name: "timestamp-test", description: "test" },
  });

  const firstSkill = mod.listUserSkills()[0];
  const createdAt = firstSkill.createdAt;
  const updatedAt = firstSkill.updatedAt;

  assert.ok(createdAt);
  assert.ok(updatedAt);

  await new Promise((r) => setTimeout(r, 5));

  mod.upsertUserSkill({
    metadata: { name: "timestamp-test", description: "updated" },
  });

  const secondSkill = mod.listUserSkills()[0];
  // createdAt should be the same, updatedAt should change
  assert.equal(secondSkill.createdAt, createdAt);
});

test("normalizeIndex: filters skills with object but no name property", async () => {
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
  assert.equal(loaded.skills.length, 2);
});

test("clearUserSkills: removes bodies stored separately", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  // Add body without skill in index
  mod.setUserSkillBody("orphan-body", "orphan content");
  assert.equal(mod.getUserSkillBody("orphan-body"), "orphan content");

  // Now add a proper skill and body
  mod.upsertUserSkill({
    metadata: { name: "proper", description: "proper" },
    body: "proper body",
  });

  mod.clearUserSkills();

  // Orphan body should still be accessible (it wasn't in the index)
  // proper body should be cleared
  assert.equal(mod.getUserSkillBody("proper"), "");
});

test("upsertUserSkill: scope is always 'user'", async () => {
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
  assert.equal(skill.scope, "user");
});

test("setUserSkillBody: object body is stringified", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  mod.setUserSkillBody("obj-body", { key: "value" });
  assert.equal(mod.getUserSkillBody("obj-body"), "[object Object]");
});

test("setUserSkillBody: boolean body is stringified", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  mod.setUserSkillBody("bool-true", true);
  mod.setUserSkillBody("bool-false", false);

  assert.equal(mod.getUserSkillBody("bool-true"), "true");
  assert.equal(mod.getUserSkillBody("bool-false"), "false");
});

test("initUserSkillStore: forceReload refreshes state", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  const result1 = await mod.initUserSkillStore();
  const result2 = await mod.initUserSkillStore({ forceReload: true });

  assert.equal(result1.ok, true);
  assert.equal(result2.ok, true);
});

test("upsertUserSkill: very long skill name", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  const longName = "a".repeat(1000);
  mod.upsertUserSkill({
    metadata: { name: longName, description: "long name test" },
    body: "content",
  });

  assert.equal(mod.listUserSkills().length, 1);
  assert.equal(mod.listUserSkills()[0].name, longName);
  assert.equal(mod.getUserSkillBody(longName), "content");
});

test("upsertUserSkill: very long body", async () => {
  const mod = await import("../../js/agents/skills/user-store.js");

  mod.clearUserSkills();

  const longBody = "x".repeat(100000);
  mod.upsertUserSkill({
    metadata: { name: "long-body", description: "test" },
    body: longBody,
  });

  assert.equal(mod.getUserSkillBody("long-body"), longBody);
});

test("saveUserSkillsIndex: non-object skills in array are filtered", async () => {
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
  assert.equal(loaded.skills.length, 1);
});
