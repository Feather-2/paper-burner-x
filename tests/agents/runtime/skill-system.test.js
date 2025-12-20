const test = require("node:test");
const assert = require("node:assert/strict");

test("SkillDefinition: validates required fields", async () => {
  const { validateSkillDefinition, createSkillDefinition, SkillLayer } = await import(
    "../../../js/agents/shared/skill-definition.js"
  );

  // Missing required fields
  const result1 = validateSkillDefinition({});
  assert.equal(result1.valid, false);
  assert.ok(result1.errors.some((e) => e.includes("name")));
  assert.ok(result1.errors.some((e) => e.includes("description")));
  assert.ok(result1.errors.some((e) => e.includes("layer")));

  // Valid minimal definition
  const result2 = validateSkillDefinition({
    name: "test.skill",
    description: "Test skill",
    layer: 0,
  });
  assert.equal(result2.valid, true);
  assert.equal(result2.errors.length, 0);

  // Invalid layer
  const result3 = validateSkillDefinition({
    name: "test.skill",
    description: "Test skill",
    layer: 5,
  });
  assert.equal(result3.valid, false);

  // Layer > 0 requires loader or handler
  const result4 = validateSkillDefinition({
    name: "test.skill",
    description: "Test skill",
    layer: 2,
  });
  assert.equal(result4.valid, false);
  assert.ok(result4.errors.some((e) => e.includes("loader")));

  // Valid with loader
  const result5 = validateSkillDefinition({
    name: "test.skill",
    description: "Test skill",
    layer: 2,
    loader: () => Promise.resolve({}),
  });
  assert.equal(result5.valid, true);
});

test("SkillDefinition: createSkillDefinition normalizes values", async () => {
  const { createSkillDefinition } = await import("../../../js/agents/shared/skill-definition.js");

  const skill = createSkillDefinition({
    name: "text.process",
    description: "Process text",
    layer: 0,
  });

  assert.equal(skill.name, "text.process");
  assert.equal(skill.version, "1.0.0");
  assert.equal(skill.layer, 0);
  assert.deepEqual(skill.activation.keywords, []);
  assert.deepEqual(skill.activation.tags, []);
  assert.equal(skill.requires.mcpNexus, false);
  assert.equal(skill.fallback, null);
  assert.equal(skill.estimatedCost, 0); // layer * 20

  // With custom values
  const skill2 = createSkillDefinition({
    name: "web.search",
    description: "Web search",
    layer: 2,
    version: "2.0.0",
    activation: { keywords: ["search", "find"] },
    fallback: "text.process",
    loader: () => Promise.resolve({}),
  });

  assert.equal(skill2.version, "2.0.0");
  assert.deepEqual(skill2.activation.keywords, ["search", "find"]);
  assert.equal(skill2.fallback, "text.process");
  assert.equal(skill2.estimatedCost, 40); // layer 2 * 20
});

test("SkillDefinition: buildSkillCatalogPrompt formats correctly", async () => {
  const { createSkillDefinition, buildSkillCatalogPrompt } = await import(
    "../../../js/agents/shared/skill-definition.js"
  );

  const skills = [
    createSkillDefinition({
      name: "text.process",
      description: "Process text",
      layer: 0,
      activation: { keywords: ["text", "process"] },
    }),
    createSkillDefinition({
      name: "web.search",
      description: "Search the web",
      layer: 2,
      fallback: "text.process",
      loader: () => Promise.resolve({}),
    }),
  ];

  const prompt = buildSkillCatalogPrompt(skills);
  assert.ok(prompt.includes("## Available Skills"));
  assert.ok(prompt.includes("Layer 0: Native"));
  assert.ok(prompt.includes("Layer 2: MCP Local"));
  assert.ok(prompt.includes("**text.process**"));
  assert.ok(prompt.includes("**web.search**"));
  assert.ok(prompt.includes("Keywords: text, process"));
  assert.ok(prompt.includes("Fallback: text.process"));

  // Empty list
  const emptyPrompt = buildSkillCatalogPrompt([]);
  assert.ok(emptyPrompt.includes("No skills available"));
});

test("SkillRegistry: register and query", async () => {
  const { SkillRegistry, SkillStatus } = await import(
    "../../../js/agents/runtime/skill-registry.js"
  );

  const registry = new SkillRegistry();

  // Register valid skill
  const success = registry.register({
    name: "test.skill",
    description: "Test skill",
    layer: 0,
  });
  assert.equal(success, true);
  assert.equal(registry.has("test.skill"), true);

  // Register invalid skill
  const fail = registry.register({ name: "" });
  assert.equal(fail, false);

  // Get skill
  const skill = registry.get("test.skill");
  assert.ok(skill);
  assert.equal(skill.status, SkillStatus.REGISTERED);
  assert.equal(skill.definition.name, "test.skill");

  // Get definition
  const def = registry.getDefinition("test.skill");
  assert.equal(def.name, "test.skill");

  // Get non-existent
  assert.equal(registry.get("nonexistent"), null);
  assert.equal(registry.getDefinition("nonexistent"), null);

  // Get all names
  const names = registry.getAllNames();
  assert.deepEqual(names, ["test.skill"]);
});

test("SkillRegistry: batch register and filter", async () => {
  const { SkillRegistry } = await import("../../../js/agents/runtime/skill-registry.js");

  const registry = new SkillRegistry();
  const result = registry.registerAll([
    { name: "skill.l0", description: "Layer 0", layer: 0 },
    { name: "skill.l1", description: "Layer 1", layer: 1, loader: () => {} },
    { name: "skill.l2", description: "Layer 2", layer: 2, loader: () => {} },
    { name: "invalid" }, // Invalid
  ]);

  assert.equal(result.success, 3);
  assert.equal(result.failed, 1);

  // Filter by max layer
  const l1Skills = registry.getByMaxLayer(1);
  assert.equal(l1Skills.length, 2);
  assert.ok(l1Skills.every((s) => s.layer <= 1));

  // Get stats
  const stats = registry.getStats();
  assert.equal(stats.total, 3);
  assert.equal(stats.byLayer[0], 1);
  assert.equal(stats.byLayer[1], 1);
  assert.equal(stats.byLayer[2], 1);
});

test("SkillRegistry: status management", async () => {
  const { SkillRegistry, SkillStatus } = await import(
    "../../../js/agents/runtime/skill-registry.js"
  );

  const registry = new SkillRegistry();
  registry.register({ name: "test.skill", description: "Test", layer: 0 });

  // Set status
  registry.setStatus("test.skill", SkillStatus.LOADING);
  assert.equal(registry.get("test.skill").status, SkillStatus.LOADING);

  registry.setStatus("test.skill", SkillStatus.READY, { instance: { handler: () => {} } });
  const skill = registry.get("test.skill");
  assert.equal(skill.status, SkillStatus.READY);
  assert.ok(skill.instance);
  assert.ok(skill.loadedAt);

  // Disable/enable
  registry.disable("test.skill");
  assert.equal(registry.get("test.skill").status, SkillStatus.DISABLED);

  registry.enable("test.skill");
  assert.equal(registry.get("test.skill").status, SkillStatus.READY);

  // Get by status
  const ready = registry.getByStatus(SkillStatus.READY);
  assert.equal(ready.length, 1);
});

test("SkillRegistry: unregister and clear", async () => {
  const { SkillRegistry } = await import("../../../js/agents/runtime/skill-registry.js");

  const registry = new SkillRegistry();
  registry.register({ name: "skill1", description: "Skill 1", layer: 0 });
  registry.register({ name: "skill2", description: "Skill 2", layer: 0 });

  assert.equal(registry.getAllNames().length, 2);

  registry.unregister("skill1");
  assert.equal(registry.has("skill1"), false);
  assert.equal(registry.getAllNames().length, 1);

  registry.clear();
  assert.equal(registry.getAllNames().length, 0);
});

test("SkillRegistry: buildCatalogPrompt with filters", async () => {
  const { SkillRegistry, SkillStatus } = await import(
    "../../../js/agents/runtime/skill-registry.js"
  );

  const registry = new SkillRegistry();
  registry.register({ name: "skill.l0", description: "Layer 0", layer: 0 });
  registry.register({ name: "skill.l2", description: "Layer 2", layer: 2, loader: () => {} });
  registry.disable("skill.l2");

  // Max layer filter
  const prompt1 = registry.buildCatalogPrompt({ maxLayer: 1 });
  assert.ok(prompt1.includes("skill.l0"));
  assert.ok(!prompt1.includes("skill.l2"));

  // Enabled only filter
  const prompt2 = registry.buildCatalogPrompt({ maxLayer: 4, enabledOnly: true });
  assert.ok(prompt2.includes("skill.l0"));
  assert.ok(!prompt2.includes("skill.l2"));
});

test("SkillRegistry: exportSnapshot", async () => {
  const { SkillRegistry, SkillStatus } = await import(
    "../../../js/agents/runtime/skill-registry.js"
  );

  const registry = new SkillRegistry();
  registry.register({ name: "test.skill", description: "Test", layer: 1, loader: () => {} });
  registry.setStatus("test.skill", SkillStatus.READY, { instance: {} });

  const snapshot = registry.exportSnapshot();
  assert.ok(snapshot["test.skill"]);
  assert.equal(snapshot["test.skill"].layer, 1);
  assert.equal(snapshot["test.skill"].status, SkillStatus.READY);
  assert.equal(snapshot["test.skill"].hasInstance, true);
});

test("SkillMatchers: keywordMatcher", async () => {
  const { keywordMatcher } = await import("../../../js/agents/runtime/skill-matchers.js");

  const skill = {
    activation: { keywords: ["search", "find", "query"] },
  };

  // Match
  const result1 = keywordMatcher(skill, { query: "I want to search for something" });
  assert.equal(result1.matched, true);
  assert.ok(result1.matchedKeywords.includes("search"));
  assert.ok(result1.score > 0);

  // No match
  const result2 = keywordMatcher(skill, { query: "hello world" });
  assert.equal(result2.matched, false);
  assert.equal(result2.score, 0);

  // Empty keywords
  const result3 = keywordMatcher({ activation: {} }, { query: "search" });
  assert.equal(result3.matched, false);
});

test("SkillMatchers: tagMatcher", async () => {
  const { tagMatcher } = await import("../../../js/agents/runtime/skill-matchers.js");

  const skill = {
    activation: { tags: ["research", "academic"] },
  };

  // Match
  const result1 = tagMatcher(skill, { tags: ["research", "deepsearch"] });
  assert.equal(result1.matched, true);
  assert.ok(result1.matchedTags.includes("research"));

  // No match
  const result2 = tagMatcher(skill, { tags: ["design", "creative"] });
  assert.equal(result2.matched, false);
});

test("SkillMatchers: traitMatcher", async () => {
  const { traitMatcher } = await import("../../../js/agents/runtime/skill-matchers.js");

  const skill = {
    activation: { traits: ["needs_external_search", "scholarly"] },
  };

  // Match
  const result1 = traitMatcher(skill, { traits: ["scholarly", "complex"] });
  assert.equal(result1.matched, true);

  // No match
  const result2 = traitMatcher(skill, { traits: ["simple"] });
  assert.equal(result2.matched, false);
});

test("SkillMatchers: phaseMatcher", async () => {
  const { phaseMatcher } = await import("../../../js/agents/runtime/skill-matchers.js");

  const skill = {
    activation: { phases: ["understanding", "writing"] },
  };

  // Match
  const result1 = phaseMatcher(skill, { currentPhase: "understanding" });
  assert.equal(result1.matched, true);
  assert.ok(result1.score > 0);

  // No match
  const result2 = phaseMatcher(skill, { currentPhase: "scanning" });
  assert.equal(result2.matched, false);
});

test("SkillMatchers: budgetMatcher", async () => {
  const { budgetMatcher } = await import("../../../js/agents/runtime/skill-matchers.js");

  const skill = {
    requires: { minBudget: 50 },
  };

  // Affordable
  const result1 = budgetMatcher(skill, { availableBudget: 100 });
  assert.equal(result1.affordable, true);

  // Not affordable
  const result2 = budgetMatcher(skill, { availableBudget: 30 });
  assert.equal(result2.affordable, false);
  assert.ok(result2.score < 0);

  // No budget info
  const result3 = budgetMatcher(skill, {});
  assert.equal(result3.affordable, true);
});

test("SkillMatchers: combinedMatcher and matchSkills", async () => {
  const { combinedMatcher, matchSkills } = await import(
    "../../../js/agents/runtime/skill-matchers.js"
  );

  const skill = {
    name: "web.search",
    activation: {
      keywords: ["search", "find"],
      tags: ["research"],
      traits: ["needs_external"],
    },
    requires: { minBudget: 20 },
  };

  // Combined match
  const result = combinedMatcher(skill, {
    query: "search for papers",
    tags: ["research"],
    traits: ["needs_external"],
    availableBudget: 100,
  });
  assert.equal(result.matched, true);
  assert.ok(result.score > 0);

  // Budget insufficient
  const result2 = combinedMatcher(skill, {
    query: "search",
    availableBudget: 10,
  });
  assert.equal(result2.matched, false);
  // reason 现在包含所有匹配器结果，budget_insufficient 应该在其中
  assert.ok(result2.details.reason.includes("budget|required=20|available=10"));

  // Match multiple skills
  const skills = [
    { name: "skill1", activation: { keywords: ["analyze"] }, requires: {} },
    { name: "skill2", activation: { keywords: ["compare"] }, requires: {} },
    { name: "skill3", activation: { keywords: ["search", "find"] }, requires: {} },
  ];

  const matches = matchSkills(skills, { query: "search for data and find results" });
  assert.ok(matches.length >= 1);
  // skill3 should rank higher (more keyword matches)
  assert.equal(matches[0].skill.name, "skill3");
});

test("SkillLoader: load and execute", async () => {
  const { SkillRegistry, SkillStatus } = await import(
    "../../../js/agents/runtime/skill-registry.js"
  );
  const { SkillLoader } = await import("../../../js/agents/runtime/skill-loader.js");

  const registry = new SkillRegistry();
  registry.register({
    name: "test.handler",
    description: "Test with handler",
    layer: 0,
    handler: (params) => `Hello ${params.name}`,
  });

  registry.register({
    name: "test.loader",
    description: "Test with loader",
    layer: 1,
    loader: async () => ({
      execute: (params) => `Loaded ${params.value}`,
    }),
  });

  const loader = new SkillLoader({ registry, maxLayer: 2 });

  // Load handler skill
  const instance1 = await loader.load("test.handler");
  assert.ok(instance1);

  // Execute
  const result1 = await loader.execute("test.handler", { name: "World" });
  assert.equal(result1, "Hello World");

  // Load async skill
  const instance2 = await loader.load("test.loader");
  assert.ok(instance2);

  const result2 = await loader.execute("test.loader", { value: 42 });
  assert.equal(result2, "Loaded 42");

  // Already loaded (cache)
  const instance3 = await loader.load("test.handler");
  assert.strictEqual(instance3, instance1);
});

test("SkillLoader: canLoad checks", async () => {
  const { SkillRegistry } = await import("../../../js/agents/runtime/skill-registry.js");
  const { SkillLoader } = await import("../../../js/agents/runtime/skill-loader.js");

  const registry = new SkillRegistry();
  registry.register({
    name: "layer3.skill",
    description: "Layer 3 skill",
    layer: 3,
    requires: { mcpNexus: true },
    loader: () => Promise.resolve({}),
  });

  const loader = new SkillLoader({ registry, maxLayer: 2, mcpNexusEnabled: false });

  // Layer exceeded
  const check1 = loader.canLoad("layer3.skill");
  assert.equal(check1.canLoad, false);
  assert.equal(check1.reason, "layer_exceeded");

  // Not registered
  const check2 = loader.canLoad("nonexistent");
  assert.equal(check2.canLoad, false);
  assert.equal(check2.reason, "not_registered");

  // With MCP-Nexus enabled but layer still exceeded
  loader.updateConfig({ mcpNexusEnabled: true });
  const check3 = loader.canLoad("layer3.skill");
  assert.equal(check3.canLoad, false);
  assert.equal(check3.reason, "layer_exceeded");

  // Now allow layer 3
  loader.updateConfig({ maxLayer: 3 });
  const check4 = loader.canLoad("layer3.skill");
  assert.equal(check4.canLoad, true);
});

test("SkillLoader: fallback on load failure", async () => {
  const { SkillRegistry } = await import("../../../js/agents/runtime/skill-registry.js");
  const { SkillLoader } = await import("../../../js/agents/runtime/skill-loader.js");

  const registry = new SkillRegistry();
  registry.register({
    name: "primary.skill",
    description: "Primary skill",
    layer: 2,
    fallback: "fallback.skill",
    loader: () => Promise.reject(new Error("Load failed")),
  });

  registry.register({
    name: "fallback.skill",
    description: "Fallback skill",
    layer: 0,
    handler: () => "fallback result",
  });

  const loader = new SkillLoader({ registry, maxLayer: 2 });

  // Should fallback
  const instance = await loader.load("primary.skill");
  assert.ok(instance);

  const result = await loader.execute("fallback.skill", {});
  assert.equal(result, "fallback result");
});

test("SkillLoader: loadMatching", async () => {
  const { SkillRegistry } = await import("../../../js/agents/runtime/skill-registry.js");
  const { SkillLoader } = await import("../../../js/agents/runtime/skill-loader.js");

  const registry = new SkillRegistry();
  registry.register({
    name: "search.skill",
    description: "Search skill",
    layer: 0,
    activation: { keywords: ["search", "find"] },
    handler: () => "search",
  });

  registry.register({
    name: "analyze.skill",
    description: "Analyze skill",
    layer: 0,
    activation: { keywords: ["analyze", "examine"] },
    handler: () => "analyze",
  });

  const loader = new SkillLoader({ registry, maxLayer: 2 });

  const matches = await loader.loadMatching({ query: "search for information" });
  assert.ok(matches.length >= 1);
  assert.equal(matches[0].skill.name, "search.skill");
});

test("SkillLoader: preloadLayer", async () => {
  const { SkillRegistry } = await import("../../../js/agents/runtime/skill-registry.js");
  const { SkillLoader } = await import("../../../js/agents/runtime/skill-loader.js");

  const registry = new SkillRegistry();
  registry.register({ name: "l0.skill", description: "L0", layer: 0 });
  registry.register({ name: "l1.skill", description: "L1", layer: 1, loader: () => ({}) });
  registry.register({ name: "l2.skill", description: "L2", layer: 2, loader: () => ({}) });

  const loader = new SkillLoader({ registry, maxLayer: 2 });

  const result = await loader.preloadLayer(1);
  assert.ok(result.loaded.includes("l0.skill"));
  assert.ok(result.loaded.includes("l1.skill"));
  assert.ok(!result.loaded.includes("l2.skill"));
});

test("SkillLoader: loadAll batch loading", async () => {
  const { SkillRegistry } = await import("../../../js/agents/runtime/skill-registry.js");
  const { SkillLoader } = await import("../../../js/agents/runtime/skill-loader.js");

  const registry = new SkillRegistry();
  registry.register({ name: "good.skill", description: "Good", layer: 0, handler: () => {} });
  registry.register({
    name: "bad.skill",
    description: "Bad",
    layer: 1,
    loader: () => Promise.reject(new Error("fail")),
  });

  const loader = new SkillLoader({ registry, maxLayer: 1 });

  const results = await loader.loadAll(["good.skill", "bad.skill", "nonexistent"]);
  assert.equal(results.get("good.skill").success, true);
  assert.equal(results.get("bad.skill").success, false);
  assert.equal(results.get("nonexistent").success, false);
});

test("SkillRegistry: singleton pattern", async () => {
  const { getSkillRegistry, resetSkillRegistry } = await import(
    "../../../js/agents/runtime/skill-registry.js"
  );

  resetSkillRegistry();

  const registry1 = getSkillRegistry();
  const registry2 = getSkillRegistry();
  assert.strictEqual(registry1, registry2);

  resetSkillRegistry();
  const registry3 = getSkillRegistry();
  assert.notStrictEqual(registry1, registry3);
});
