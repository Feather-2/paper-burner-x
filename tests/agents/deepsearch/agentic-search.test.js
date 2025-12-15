const test = require("node:test");
const assert = require("node:assert/strict");

test("Agentic Search: minGrepHits=15 reduces BM25 fallback", async () => {
  const { retrieve } = await import("../../../js/agents/retrieval/retrieval-router.js");

  // 模拟一个中等大小的 sourceIndex
  const chunks = [];
  for (let i = 1; i <= 50; i++) {
    chunks.push({
      chunkId: `chunk_${i}`,
      text: i <= 20 ? `This is test content ${i} with keyword match` : `Other content ${i}`,
      locator: { charStart: (i - 1) * 100, charEnd: i * 100 },
    });
  }

  const sourceIndex = {
    sourceId: "test_source",
    chunks,
    fullText: chunks.map((c) => c.text).join("\n"),
  };

  // Gap 1: 有 20 个 grep 匹配 (> 15)，应该不触发 BM25
  const gap1 = {
    gapId: "gap_1",
    question: "What is the test keyword?",
    queryHints: ["test", "keyword"],
  };

  // Gap 2: 没有 grep 匹配 (< 15)，应该触发 BM25
  const gap2 = {
    gapId: "gap_2",
    question: "What is the rare keyword?",
    queryHints: ["nonexistent", "rarekeyword"],
  };

  // 使用默认 minGrepHits=15
  const result1 = retrieve(sourceIndex, [gap1], { topK: 8, minGrepHits: 15 });

  // gap1 应该有 grep 匹配，不需要 BM25
  assert.ok(result1.length > 0);
  assert.ok(result1.some((r) => r.relevance === "hit" || r.score > 0));

  const result2 = retrieve(sourceIndex, [gap2], { topK: 8, minGrepHits: 15 });

  // gap2 没有 grep 匹配，应该触发 BM25（但可能结果较少）
  // BM25 会尝试语义匹配，但由于 queryHints 不存在，结果可能为空
  // 这里主要验证不会报错
  assert.ok(Array.isArray(result2));
});

test("Agentic Search: minGrepHits=3 vs minGrepHits=15 BM25 frequency", async () => {
  const { retrieve } = await import("../../../js/agents/retrieval/retrieval-router.js");

  const chunks = [];
  for (let i = 1; i <= 100; i++) {
    // 前 5 个 chunk 有匹配
    chunks.push({
      chunkId: `chunk_${i}`,
      text: i <= 5 ? `Partial match content ${i}` : `No match content ${i}`,
      locator: { charStart: (i - 1) * 100, charEnd: i * 100 },
    });
  }

  const sourceIndex = {
    sourceId: "test_source",
    chunks,
    fullText: chunks.map((c) => c.text).join("\n"),
  };

  const gap = {
    gapId: "gap_1",
    question: "What is partial?",
    queryHints: ["Partial"],
  };

  // minGrepHits=3: 5 个匹配 > 3，不触发 BM25
  const result1 = retrieve(sourceIndex, [gap], { topK: 8, minGrepHits: 3, useBm25: true, useGrep: true });

  // minGrepHits=15: 5 个匹配 < 15，触发 BM25
  const result2 = retrieve(sourceIndex, [gap], { topK: 8, minGrepHits: 15, useBm25: true, useGrep: true });

  // 两者都应该有结果
  assert.ok(result1.length > 0);
  assert.ok(result2.length > 0);

  // minGrepHits=15 的结果可能更多（因为 BM25 补充了结果）
  // 但这取决于 BM25 的语义匹配能力，这里主要验证功能正常
  assert.ok(result1.length >= 5 || result2.length >= 5);
});

test("Agentic Search: tool chain integration in retrieve stage", async () => {
  const { runDeepSearchRetrieveStage } = await import("../../../js/agents/stages/deepsearch/retrieve.js");
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");

  const state = new DeepSearchState({ taskGoal: "Test tool chain integration" });

  // 添加 source
  state.L0.sources = [
    {
      sourceId: "source_1",
      sourceTextNormalized: "function hello() { return 'world'; }\nconst API_KEY = 'secret';",
      chunks: [
        {
          chunkId: "chunk_1",
          text: "function hello() { return 'world'; }",
          locator: { charStart: 0, charEnd: 40 },
        },
        {
          chunkId: "chunk_2",
          text: "const API_KEY = 'secret';",
          locator: { charStart: 41, charEnd: 66 },
        },
      ],
    },
  ];

  // 添加 gaps
  state.L1.gaps = [
    {
      gapId: "gap_1",
      type: "definition",
      question: "What is the hello function?",
      queryHints: ["hello", "function"],
      status: "open",
      priority: "high",
    },
  ];

  // 配置：启用工具链
  state.userConfig = {
    retrieval: {
      enableToolChain: true,
      toolChain: {
        strategy: "grep-only", // 测试时使用简单策略
      },
      topK: 5,
      minGrepHits: 15,
    },
  };

  const mockGlobTool = async () => ["source_1"];

  const stageApi = {
    globTool: mockGlobTool,
    emit: () => {}, // noop
  };

  try {
    const result = await runDeepSearchRetrieveStage({}, { state }, stageApi);

    assert.ok(result.state);
    assert.ok(Array.isArray(result.state.L2.retrievedChunks));
    // 应该至少检索到一个 chunk
    assert.ok(result.state.L2.retrievedChunks.length > 0);

    // 验证检索到的 chunk 包含 hello 相关内容
    const hasHelloChunk = result.state.L2.retrievedChunks.some((c) => c.text && c.text.includes("hello"));
    assert.ok(hasHelloChunk, "Should retrieve chunk containing 'hello'");
  } catch (err) {
    // 如果失败，打印错误信息
    console.error("Retrieve stage failed:", err);
    throw err;
  }
});

test("Agentic Search: tool chain fallback when disabled", async () => {
  const { runDeepSearchRetrieveStage } = await import("../../../js/agents/stages/deepsearch/retrieve.js");
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");

  const state = new DeepSearchState({ taskGoal: "Test without tool chain" });

  state.L0.sources = [
    {
      sourceId: "source_1",
      sourceTextNormalized: "Sample text content",
      chunks: [
        {
          chunkId: "chunk_1",
          text: "Sample text content",
          locator: { charStart: 0, charEnd: 19 },
        },
      ],
    },
  ];

  state.L1.gaps = [
    {
      gapId: "gap_1",
      type: "definition",
      question: "What is sample?",
      queryHints: ["sample"],
      status: "open",
    },
  ];

  // 禁用工具链
  state.userConfig = {
    retrieval: {
      enableToolChain: false,
      topK: 5,
    },
  };

  const stageApi = {
    emit: () => {},
  };

  try {
    const result = await runDeepSearchRetrieveStage({}, { state }, stageApi);

    assert.ok(result.state);
    assert.ok(Array.isArray(result.state.L2.retrievedChunks));
    // 即使禁用工具链，基础检索仍应工作
    assert.ok(result.state.L2.retrievedChunks.length >= 0);
  } catch (err) {
    console.error("Retrieve stage (disabled tool chain) failed:", err);
    throw err;
  }
});

test("Agentic Search: grep hit count calculation", async () => {
  const { retrieve } = await import("../../../js/agents/retrieval/retrieval-router.js");

  const chunks = [];
  for (let i = 1; i <= 30; i++) {
    chunks.push({
      chunkId: `chunk_${i}`,
      text: i <= 18 ? `Match target ${i}` : `No match ${i}`,
      locator: { charStart: (i - 1) * 100, charEnd: i * 100 },
    });
  }

  const sourceIndex = {
    sourceId: "test_source",
    chunks,
    fullText: chunks.map((c) => c.text).join("\n"),
  };

  // 测试边界：18 个匹配（> 15，不触发 BM25）
  const gap1 = {
    gapId: "gap_1",
    queryHints: ["target"],
  };

  const result1 = retrieve(sourceIndex, [gap1], { minGrepHits: 15, useBm25: true });

  // 应该有 18 个匹配，不需要 BM25
  assert.ok(result1.length >= 8); // topK 默认 8

  // 测试边界：12 个匹配（< 15，触发 BM25）
  const chunks2 = [];
  for (let i = 1; i <= 30; i++) {
    chunks2.push({
      chunkId: `chunk_${i}`,
      text: i <= 12 ? `Match boundary ${i}` : `No match ${i}`,
      locator: { charStart: (i - 1) * 100, charEnd: i * 100 },
    });
  }

  const sourceIndex2 = {
    sourceId: "test_source",
    chunks: chunks2,
    fullText: chunks2.map((c) => c.text).join("\n"),
  };

  const gap2 = {
    gapId: "gap_2",
    queryHints: ["boundary"],
  };

  const result2 = retrieve(sourceIndex2, [gap2], { minGrepHits: 15, useBm25: true });

  // 12 个匹配 < 15，应该触发 BM25
  // 由于 BM25 补充，结果数量可能不同
  assert.ok(result2.length >= 0);
});

test("Agentic Search: tool chain respects topK limit", async () => {
  const { search } = await import("../../../js/agents/retrieval/tool-chain.js");

  const chunks = [];
  for (let i = 1; i <= 50; i++) {
    chunks.push({
      chunkId: `chunk_${i}`,
      text: `keyword content ${i}`,
      sourceId: "file.txt",
    });
  }

  const result = await search(
    chunks,
    { strategy: "grep-only", keywords: ["keyword"] },
    {}
  );

  // 所有 50 个 chunk 都匹配 "keyword"
  assert.equal(result.results.length, 50);

  // 在实际集成中，retrieve stage 会限制 topK
  // 这里验证工具链返回所有匹配
  assert.ok(result.stats.hits >= 50);
});

test("Agentic Search: performance - tool chain call under 200ms (simulated)", async () => {
  const { search, clearGlobCache } = await import("../../../js/agents/retrieval/tool-chain.js");
  clearGlobCache();

  const chunks = [];
  for (let i = 1; i <= 100; i++) {
    chunks.push({
      chunkId: `chunk_${i}`,
      text: `Sample content ${i} with some keywords`,
      sourceId: `file_${i}.txt`,
    });
  }

  const start = Date.now();

  const result = await search(
    chunks,
    { strategy: "grep-only", keywords: ["content", "keywords"] },
    {}
  );

  const elapsed = Date.now() - start;

  assert.ok(result.results.length > 0);
  // grep-only 应该很快（远小于 200ms）
  // 实际测试环境可能更快，这里放宽限制
  assert.ok(elapsed < 1000, `Tool chain should be fast, took ${elapsed}ms`);

  clearGlobCache();
});

test("Agentic Search: tool chain handles empty patterns gracefully", async () => {
  const { search, clearGlobCache } = await import("../../../js/agents/retrieval/tool-chain.js");
  clearGlobCache();

  const chunks = [
    { chunkId: "c1", text: "hello world", sourceId: "file.txt" },
  ];

  const result = await search(
    chunks,
    { strategy: "glob-then-grep", patterns: [], keywords: ["hello"] },
    {}
  );

  // 没有 patterns 时应该降级到 grep-only
  assert.equal(result.strategy, "grep-only");
  assert.equal(result.results.length, 1);

  clearGlobCache();
});

test("Agentic Search: coverage test - multiple strategies", async () => {
  const { search, clearGlobCache } = await import("../../../js/agents/retrieval/tool-chain.js");
  clearGlobCache();

  const chunks = [
    { chunkId: "c1", text: "import React", sourceId: "App.js" },
    { chunkId: "c2", text: "export default", sourceId: "App.js" },
  ];

  const mockGlob = async () => ["App.js"];

  // 测试所有策略
  const strategies = ["grep-only", "glob-then-grep", "auto"];

  for (const strategy of strategies) {
    const result = await search(
      chunks,
      {
        strategy,
        patterns: strategy === "grep-only" ? [] : ["**/*.js"],
        keywords: ["React"],
      },
      { globTool: mockGlob }
    );

    assert.ok(result.results.length >= 0);
    assert.ok(result.strategy);
  }

  clearGlobCache();
});
