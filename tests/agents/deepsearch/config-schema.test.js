const test = require("node:test");
const assert = require("node:assert/strict");

async function loadModule() {
  return await import("../../../js/agents/stages/deepsearch/config-schema.js");
}

function issuesFor(issues, path) {
  return (Array.isArray(issues) ? issues : []).filter((i) => i && typeof i === "object" && i.path === path);
}

test("config-schema: getDefaultConfig returns expected defaults", async () => {
  const { getDefaultConfig } = await loadModule();
  const cfg = getDefaultConfig();

  assert.equal(cfg.maxIterations, 5);

  assert.deepEqual(cfg.retrieval, {
    chunkSize: 1600,
    overlap: 180,
    topK: 6,
    windowSize: 3,
    maxChunks: 200,
    useBm25: true,
    useGrep: true,
    enableToolChain: false,
    rerank: { enabled: false, topK: 10, timeoutMs: 12000, minChunksToRerank: 4 },
    shadow: { enabled: false, budgetPerIteration: 5 },
  });

  assert.deepEqual(cfg.gaps, { maxGaps: 10, blockAfterMisses: 3, minEvidenceToFill: 2 });
  assert.deepEqual(cfg.budget, { maxInputTokens: 500000, maxOutputTokens: 200000, maxTotalTokens: 700000, degradeThreshold: 0.8 });
  assert.deepEqual(cfg.externalSearch, { enabled: false, provider: "tavily", maxResults: 5, timeoutMs: 10000 });
  assert.deepEqual(cfg.write, { maxSections: 10, maxWordsPerSection: 1000, style: "professional" });
  assert.deepEqual(cfg.trajectory, { enabled: false, n: 3, mergeStrategy: "vote" });
});

test("config-schema: validates int/float/bool/enum/object and clamps ranges", async () => {
  const { validateUserConfig, getDefaultConfig } = await loadModule();
  const defaults = getDefaultConfig();

  const { config, issues } = validateUserConfig({
    maxIterations: 999,
    retrieval: {
      chunkSize: "3000",
      overlap: -999,
      topK: "not-a-number",
      useGrep: "yes",
      rerank: { enabled: "nope", timeoutMs: 999999, minChunksToRerank: 0 },
    },
    budget: { degradeThreshold: "2.5" },
    externalSearch: { provider: "SERPER", timeoutMs: 999999 },
    trajectory: { n: 1, mergeStrategy: "unknown" },
  });

  assert.equal(config.maxIterations, 20);
  assert.ok(issuesFor(issues, "maxIterations").length >= 1);

  assert.equal(config.retrieval.chunkSize, 3000);
  assert.equal(config.retrieval.overlap, 0);
  assert.equal(config.retrieval.topK, defaults.retrieval.topK);
  assert.equal(config.retrieval.useGrep, defaults.retrieval.useGrep);
  assert.equal(config.retrieval.rerank.enabled, defaults.retrieval.rerank.enabled);
  assert.equal(config.retrieval.rerank.timeoutMs, 60000);
  assert.equal(config.retrieval.rerank.minChunksToRerank, 1);

  assert.equal(config.budget.degradeThreshold, 0.99);
  assert.equal(config.externalSearch.provider, "serper");
  assert.equal(config.externalSearch.timeoutMs, 60000);

  assert.equal(config.trajectory.n, 2);
  assert.equal(config.trajectory.mergeStrategy, defaults.trajectory.mergeStrategy);
});

test("config-schema: invalid nested object falls back to defaults and reports issues", async () => {
  const { validateUserConfig, getDefaultConfig } = await loadModule();
  const defaults = getDefaultConfig();

  const { config, issues } = validateUserConfig({
    retrieval: "nope",
    gaps: 1,
    budget: null,
  });

  assert.deepEqual(config.retrieval, defaults.retrieval);
  assert.deepEqual(config.gaps, defaults.gaps);
  assert.deepEqual(config.budget, defaults.budget);
  assert.ok(issuesFor(issues, "retrieval").length === 1);
  assert.ok(issuesFor(issues, "gaps").length === 1);
});

test("config-schema: strict mode + emit/logger hooks", async () => {
  const { validateUserConfig } = await loadModule();

  const events = [];
  const loggerCalls = [];

  const emit = (name, payload) => {
    events.push({ name, payload });
  };
  const logger = {
    warn: (msg, data) => loggerCalls.push({ msg, data }),
  };

  const out = validateUserConfig({ maxIterations: "bad" }, { strict: true, emit, logger });
  assert.equal(out.valid, false);
  assert.ok(out.issues.length >= 1);
  assert.equal(events.length, 1);
  assert.equal(events[0].name, "deepsearch.config.validation");
  assert.equal(loggerCalls.length, 1);
});

test("config-schema: string/array/default type branches via schema extension", async () => {
  const { CONFIG_SCHEMA, validateUserConfig } = await loadModule();

  const prev = {
    __testString: CONFIG_SCHEMA.__testString,
    __testArray: CONFIG_SCHEMA.__testArray,
    __testUnknown: CONFIG_SCHEMA.__testUnknown,
  };

  try {
    CONFIG_SCHEMA.__testString = { type: "string", default: "x", required: true };
    CONFIG_SCHEMA.__testArray = { type: "array", default: [1, 2, 3] };
    CONFIG_SCHEMA.__testUnknown = { type: "unknown_type", default: "fallback" };

    const { config, issues } = validateUserConfig({ __testString: "", __testArray: 1, __testUnknown: "ignored" }, { strict: true });

    assert.equal(config.__testString, "x");
    assert.ok(issuesFor(issues, "__testString").length === 1);

    assert.deepEqual(config.__testArray, [1, 2, 3]);
    assert.ok(issuesFor(issues, "__testArray").length === 1);

    assert.equal(config.__testUnknown, "fallback");
  } finally {
    if (prev.__testString === undefined) delete CONFIG_SCHEMA.__testString;
    else CONFIG_SCHEMA.__testString = prev.__testString;
    if (prev.__testArray === undefined) delete CONFIG_SCHEMA.__testArray;
    else CONFIG_SCHEMA.__testArray = prev.__testArray;
    if (prev.__testUnknown === undefined) delete CONFIG_SCHEMA.__testUnknown;
    else CONFIG_SCHEMA.__testUnknown = prev.__testUnknown;
  }
});

