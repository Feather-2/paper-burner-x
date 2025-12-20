const test = require("node:test");
const assert = require("node:assert/strict");

test("CapabilityLoader: loadRequired uses registries and tracks loaded", async () => {
  const { CapabilityLoader } = await import("../../../js/agents/runtime/capability-loader.js");

  const calls = { blocks: [], skills: [], mcp: [] };

  const blockRegistry = {
    getManifests: () => [
      { name: "scan-block", capabilities: ["scan"] },
      { name: "write-block", capabilities: ["write"] },
    ],
    ensureLoaded: async (capability) => {
      calls.blocks.push(capability);
    },
  };

  const skillRegistry = {
    getAllDefinitions: () => [
      { name: "bm25-skill", traits: ["BM25"] },
      { name: "summarize-skill", capabilities: ["summarize"] },
    ],
    load: async (name) => {
      calls.skills.push(name);
    },
  };

  const mcpNexus = {
    listAvailableTools: async () => [
      { name: "web_search", categories: ["search"] },
      { name: "fetch_content", categories: ["fetch"] },
    ],
    activate: async (capability) => {
      calls.mcp.push(capability);
    },
  };

  const loader = new CapabilityLoader({ blockRegistry, skillRegistry, mcpNexus });

  await loader.loadRequired(["scan", "BM25", "web_search", "unknown"]);

  assert.deepEqual(calls.blocks, ["scan"]);
  assert.deepEqual(calls.skills, ["bm25-skill"]);
  assert.deepEqual(calls.mcp, ["web_search"]);
  assert.deepEqual(loader.getLoadedCapabilities(), ["scan", "BM25", "web_search"]);

  await loader.loadRequired(["scan", "BM25"]);
  assert.deepEqual(calls.blocks, ["scan"]);
  assert.deepEqual(calls.skills, ["bm25-skill"]);
});

test("CapabilityLoader: hasCapability detects blocks, skills, and mcp", async () => {
  const { CapabilityLoader } = await import("../../../js/agents/runtime/capability-loader.js");

  const blockRegistry = {
    getManifests: () => [{ name: "scan-block", capabilities: ["scan"] }],
  };

  const skillRegistry = {
    getAllDefinitions: () => [{ name: "bm25-skill", traits: ["BM25"] }],
  };

  const mcpNexus = {
    tools: [{ name: "web_search", categories: ["search"] }],
  };

  const loader = new CapabilityLoader({ blockRegistry, skillRegistry, mcpNexus });

  assert.equal(loader.hasCapability("scan"), true);
  assert.equal(loader.hasCapability("BM25"), true);
  assert.equal(loader.hasCapability("web_search"), true);
  assert.equal(loader.hasCapability("search"), true);
  assert.equal(loader.hasCapability("unknown"), false);
});

test("CapabilityLoader: buildCatalogPrompt formats loaded capabilities", async () => {
  const { CapabilityLoader } = await import("../../../js/agents/runtime/capability-loader.js");

  const blockRegistry = {
    getManifests: () => [
      { name: "scan-block", capabilities: ["scan", "analyze"] },
      { name: "write-block", capabilities: ["write"] },
    ],
  };

  const skillRegistry = {
    getAllDefinitions: () => [
      { name: "bm25-skill", traits: ["BM25"] },
      { name: "summary-skill", capabilities: ["summarize"] },
    ],
  };

  const mcpNexus = {
    tools: [{ name: "web_search", categories: ["search"] }],
  };

  const loader = new CapabilityLoader({ blockRegistry, skillRegistry, mcpNexus });
  await loader.loadRequired(["scan", "BM25", "web_search"]);

  const prompt = loader.buildCatalogPrompt();
  assert.ok(prompt.includes("## Block Capabilities"));
  assert.ok(prompt.includes("- scan: scan-block"));
  assert.ok(!prompt.includes("analyze"));
  assert.ok(prompt.includes("## Skill Capabilities"));
  assert.ok(prompt.includes("- BM25: bm25-skill"));
  assert.ok(prompt.includes("## MCP Capabilities"));
  assert.ok(prompt.includes("web_search"));

  const filtered = loader.buildCatalogPrompt({ filter: ["scan", "web_search"] });
  assert.ok(filtered.includes("scan"));
  assert.ok(filtered.includes("web_search"));
  assert.ok(!filtered.includes("BM25"));
});

test("CapabilityLoader: reset clears loaded and allows reload", async () => {
  const { CapabilityLoader } = await import("../../../js/agents/runtime/capability-loader.js");

  const calls = { blocks: [] };
  const blockRegistry = {
    getManifests: () => [{ name: "scan-block", capabilities: ["scan"] }],
    ensureLoaded: async (capability) => {
      calls.blocks.push(capability);
    },
  };

  const loader = new CapabilityLoader({ blockRegistry });

  await loader.loadRequired(["scan"]);
  assert.equal(loader.isLoaded("scan"), true);
  assert.deepEqual(calls.blocks, ["scan"]);

  loader.reset();
  assert.deepEqual(loader.getLoadedCapabilities(), []);
  assert.equal(loader.isLoaded("scan"), false);

  await loader.loadRequired(["scan"]);
  assert.deepEqual(calls.blocks, ["scan", "scan"]);
});

test("CapabilityLoader: handles missing registries gracefully", async () => {
  const { CapabilityLoader } = await import("../../../js/agents/runtime/capability-loader.js");

  const loader = new CapabilityLoader();
  await loader.loadRequired(["scan"]);

  assert.equal(loader.hasCapability("scan"), false);
  assert.deepEqual(loader.getLoadedCapabilities(), []);
  assert.equal(loader.buildCatalogPrompt(), "");
});
