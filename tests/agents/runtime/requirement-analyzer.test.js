const test = require("node:test");
const assert = require("node:assert/strict");

function makeManifest(name, { capabilities = [] } = {}) {
  return {
    name,
    version: "1.0.0",
    description: `${name} block`,
    capabilities,
    input: { type: "object", properties: {} },
    output: { type: "object", properties: {} },
    whenToUse: `Use ${name} when needed.`,
    dependsOn: [],
    incompatibleWith: [],
    estimatedCost: "low",
    estimatedTokens: 100,
    timeoutMs: 1000,
    retryable: true,
  };
}

async function makeBlockRegistry() {
  const { BlockRegistry } = await import("../../../js/agents/runtime/block-registry.js");
  const registry = new BlockRegistry();
  registry.register(makeManifest("retrieve", { capabilities: ["search"] }), () => {});
  registry.register(makeManifest("scan", { capabilities: ["scan"] }), () => {});
  return registry;
}

async function makeSkillRegistry() {
  const { SkillRegistry } = await import("../../../js/agents/runtime/skill-registry.js");
  const registry = new SkillRegistry();
  registry.register({
    name: "web.search",
    description: "Search the web",
    layer: 0,
    activation: { keywords: ["search"] },
  });
  registry.register({
    name: "text.summary",
    description: "Summarize content",
    layer: 0,
    activation: { keywords: ["summary"] },
  });
  return registry;
}

test("RequirementAnalyzer parses explicit requests", async () => {
  const { RequirementAnalyzer } = await import("../../../js/agents/runtime/requirement-analyzer.js");
  const analyzer = new RequirementAnalyzer();
  const explicit = analyzer._parseExplicitRequest(
    { requiresWebSearch: "true", requiresStrong: 1 },
    { forceDAG: "yes", forceStrong: "true" }
  );

  assert.equal(explicit.requiresWebSearch, true);
  assert.equal(explicit.requiresStrong, true);
  assert.equal(explicit.forceDAG, true);
  assert.equal(explicit.needsExternalSearch, true);
  assert.equal(explicit.needsStrongModel, true);
});

test("RequirementAnalyzer uses shadow model assessment and normalizes fields", async () => {
  const { RequirementAnalyzer, ComplexityLevel } = await import("../../../js/agents/runtime/requirement-analyzer.js");
  let seenPayload = null;
  const shadowModel = {
    evaluate: async (payload) => {
      seenPayload = payload;
      return { complexity: 4, recommendedLevel: "2", capabilities: ["scan"] };
    },
  };

  const analyzer = new RequirementAnalyzer({ shadowModel });
  const assessment = await analyzer._assessWithShadowModel(
    { goal: "Check sources" },
    { sources: [{ kind: "pdf" }, { name: "notes.doc" }] }
  );

  assert.equal(assessment.complexity, ComplexityLevel.HEAVY);
  assert.equal(assessment.recommendedLevel, 2);
  assert.deepEqual(assessment.requiredCapabilities, ["scan"]);
  assert.equal(seenPayload.sourceCount, 2);
  assert.ok(seenPayload.sourceTypes.includes("pdf"));
});

test("RequirementAnalyzer falls back to heuristics when shadow model fails", async () => {
  const { RequirementAnalyzer, ComplexityLevel } = await import("../../../js/agents/runtime/requirement-analyzer.js");
  const shadowModel = {
    evaluate: async () => {
      throw new Error("boom");
    },
  };
  const analyzer = new RequirementAnalyzer({ shadowModel });
  const assessment = await analyzer._assessWithShadowModel({ goal: "Hi?" }, { sources: [] });

  assert.equal(assessment.complexity, ComplexityLevel.TRIVIAL);
  assert.equal(assessment.recommendedLevel, 0);
});

test("RequirementAnalyzer matches capabilities against registries", async () => {
  const { RequirementAnalyzer } = await import("../../../js/agents/runtime/requirement-analyzer.js");
  const blockRegistry = await makeBlockRegistry();
  const skillRegistry = await makeSkillRegistry();

  const analyzer = new RequirementAnalyzer({ blockRegistry, skillRegistry });
  const requiredCapabilities = ["search"];

  const blockMatches = analyzer._matchCapabilities({ requiredCapabilities }, blockRegistry);
  const skillMatches = analyzer._matchCapabilities({ requiredCapabilities }, skillRegistry);

  assert.deepEqual(blockMatches, ["retrieve"]);
  assert.deepEqual(skillMatches, ["web.search"]);
});

test("RequirementAnalyzer.analyze combines explicit request and MCP tools", async () => {
  const { RequirementAnalyzer, ComplexityLevel } = await import("../../../js/agents/runtime/requirement-analyzer.js");
  const skillRegistry = await makeSkillRegistry();
  const shadowModel = {
    evaluate: async () => ({ complexity: "simple", recommendedLevel: 1, requiredCapabilities: ["scan"] }),
  };
  const mcpNexus = {
    listTools: async () => [
      { name: "search", description: "web search" },
      { name: "code_execute", description: "run code" },
    ],
  };

  const analyzer = new RequirementAnalyzer({ shadowModel, mcpNexus, skillRegistry });
  const result = await analyzer.analyze({ goal: "Find sources", requiresWebSearch: true }, { sources: [] });

  assert.equal(result.complexity, ComplexityLevel.SIMPLE);
  assert.equal(result.level, 2);
  assert.ok(result.requiredCapabilities.includes("web_search"));
  assert.ok(result.mcpTools.some((tool) => tool.name === "search"));
  assert.ok(!result.mcpTools.some((tool) => tool.name === "code_execute"));
  assert.deepEqual(result.skills, ["web.search"]);
});

test("RequirementAnalyzer.analyze returns all MCP tools when no filter applies", async () => {
  const { RequirementAnalyzer } = await import("../../../js/agents/runtime/requirement-analyzer.js");
  const mcpNexus = {
    listAvailableTools: async () => [{ name: "tool_a" }, { name: "tool_b" }],
  };

  const analyzer = new RequirementAnalyzer({ mcpNexus });
  const result = await analyzer.analyze({ goal: "Ping" }, { sources: [] });

  assert.equal(result.mcpTools.length, 2);
});
