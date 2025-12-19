const test = require("node:test");
const assert = require("node:assert/strict");

test("ToolChain: grep-only strategy", async () => {
  const { search, clearGlobCache } = await import("../../../js/agents/retrieval/tool-chain.js");
  clearGlobCache();

  const chunks = [
    { chunkId: "c1", text: "function hello() { return 'world'; }", sourceId: "file1.js" },
    { chunkId: "c2", text: "const API_KEY = 'secret';", sourceId: "file2.js" },
    { chunkId: "c3", text: "module.exports = { hello };", sourceId: "file3.js" },
  ];

  const result = await search(
    chunks,
    { strategy: "grep-only", keywords: ["hello", "API_KEY"] },
    { caseSensitive: false }
  );

  assert.equal(result.strategy, "grep-only");
  assert.equal(result.results.length, 3); // hello 在 c1, c3; API_KEY 在 c2
  assert.ok(result.stats.grepCalls >= 2);
  assert.ok(result.stats.hits >= 3);
});

test("ToolChain: normalizeToolChainStrategy", async () => {
  const { ToolChainStrategy, normalizeToolChainStrategy } = await import("../../../js/agents/retrieval/tool-chain.js");

  assert.equal(normalizeToolChainStrategy("GLOB-THEN-GREP"), ToolChainStrategy.GLOB_THEN_GREP);
  assert.equal(normalizeToolChainStrategy("grep-only"), ToolChainStrategy.GREP_ONLY);
  assert.equal(normalizeToolChainStrategy("auto"), ToolChainStrategy.AUTO);
  assert.equal(normalizeToolChainStrategy("unknown"), undefined);
});

test("ToolChain: glob-then-grep with cache", async () => {
  const { search, clearGlobCache, getGlobCacheStats } = await import("../../../js/agents/retrieval/tool-chain.js");
  clearGlobCache();

  const chunks = [
    { chunkId: "c1", text: "import React from 'react';", sourceId: "src/App.js" },
    { chunkId: "c2", text: "export default App;", sourceId: "src/App.js" },
    { chunkId: "c3", text: "# README", sourceId: "README.md" },
  ];

  const mockGlobTool = async ({ pattern }) => {
    if (pattern === "**/*.js") return ["src/App.js"];
    return [];
  };

  // 第一次调用：应该调用 glob
  const result1 = await search(
    chunks,
    { strategy: "glob-then-grep", patterns: ["**/*.js"], keywords: ["React", "export"] },
    { globTool: mockGlobTool, caseSensitive: false }
  );

  assert.equal(result1.strategy, "glob-then-grep");
  assert.ok(result1.results.length >= 2); // React 和 export 都在 App.js 中
  assert.equal(result1.stats.globCalls, 1);
  assert.equal(result1.stats.cached, 0); // 第一次没有缓存

  // 第二次调用：应该使用缓存
  const result2 = await search(
    chunks,
    { strategy: "glob-then-grep", patterns: ["**/*.js"], keywords: ["React"] },
    { globTool: mockGlobTool, caseSensitive: false }
  );

  assert.equal(result2.stats.globCalls, 1);
  assert.equal(result2.stats.cached, 1); // 第二次使用缓存

  const cacheStats = getGlobCacheStats();
  assert.ok(cacheStats.size >= 1);

  clearGlobCache();
});

test("ToolChain: auto strategy with patterns falls back to glob-then-grep", async () => {
  const { search, clearGlobCache } = await import("../../../js/agents/retrieval/tool-chain.js");
  clearGlobCache();

  const chunks = [
    { chunkId: "c1", text: "def main(): pass", sourceId: "main.py" },
    { chunkId: "c2", text: "import sys", sourceId: "utils.py" },
  ];

  const mockGlobTool = async ({ pattern }) => {
    if (pattern === "**/*.py") return ["main.py", "utils.py"];
    return [];
  };

  const result = await search(
    chunks,
    { strategy: "auto", patterns: ["**/*.py"], keywords: ["main", "import"] },
    { globTool: mockGlobTool }
  );

  // auto + patterns 应该选择 glob-then-grep
  assert.equal(result.strategy, "glob-then-grep");
  assert.ok(result.results.length >= 2);

  clearGlobCache();
});

test("ToolChain: fallback to grep-only when glob fails", async () => {
  const { search, clearGlobCache } = await import("../../../js/agents/retrieval/tool-chain.js");
  clearGlobCache();

  const chunks = [
    { chunkId: "c1", text: "hello world", sourceId: "file1.txt" },
    { chunkId: "c2", text: "goodbye world", sourceId: "file2.txt" },
  ];

  const failingGlobTool = async () => {
    throw new Error("glob failed");
  };

  const result = await search(
    chunks,
    { strategy: "glob-then-grep", patterns: ["**/*.txt"], keywords: ["world"] },
    { globTool: failingGlobTool }
  );

  // 应该降级到 grep-only
  assert.equal(result.strategy, "grep-only");
  assert.ok(result.fallbackReason);
  assert.ok(result.fallbackReason.includes("glob_failed"));
  assert.equal(result.results.length, 2); // grep-only 能找到两个 world

  clearGlobCache();
});

test("ToolChain: no keywords returns empty results", async () => {
  const { search, clearGlobCache } = await import("../../../js/agents/retrieval/tool-chain.js");
  clearGlobCache();

  const chunks = [{ chunkId: "c1", text: "hello", sourceId: "file.txt" }];

  const result = await search(chunks, { strategy: "grep-only", keywords: [] }, {});

  assert.equal(result.strategy, "none");
  assert.equal(result.results.length, 0);
  assert.equal(result.fallbackReason, "no_keywords");
});

test("ToolChain: regex support", async () => {
  const { search, clearGlobCache } = await import("../../../js/agents/retrieval/tool-chain.js");
  clearGlobCache();

  const chunks = [
    { chunkId: "c1", text: "function test123() {}", sourceId: "file.js" },
    { chunkId: "c2", text: "function test456() {}", sourceId: "file.js" },
    { chunkId: "c3", text: "const x = 42;", sourceId: "file.js" },
  ];

  const result = await search(
    chunks,
    { strategy: "grep-only", keywords: ["test\\d+"] },
    { regex: true, caseSensitive: false }
  );

  assert.equal(result.strategy, "grep-only");
  assert.ok(result.results.length >= 2); // 匹配 test123 和 test456
  assert.ok(result.results.every((r) => ["c1", "c2"].includes(r.chunkId)));

  clearGlobCache();
});

test("ToolChain: case sensitive search", async () => {
  const { search, clearGlobCache } = await import("../../../js/agents/retrieval/tool-chain.js");
  clearGlobCache();

  const chunks = [
    { chunkId: "c1", text: "Hello World", sourceId: "file.txt" },
    { chunkId: "c2", text: "hello world", sourceId: "file.txt" },
  ];

  // 大小写敏感
  const result1 = await search(
    chunks,
    { strategy: "grep-only", keywords: ["Hello"] },
    { caseSensitive: true }
  );

  assert.equal(result1.results.length, 1);
  assert.equal(result1.results[0].chunkId, "c1");

  // 大小写不敏感
  const result2 = await search(
    chunks,
    { strategy: "grep-only", keywords: ["hello"] },
    { caseSensitive: false }
  );

  assert.equal(result2.results.length, 2);

  clearGlobCache();
});

test("ToolChain: glob timeout fallback", async () => {
  const { search, clearGlobCache } = await import("../../../js/agents/retrieval/tool-chain.js");
  clearGlobCache();

  const chunks = [
    { chunkId: "c1", text: "test content", sourceId: "file.txt" },
  ];

  const slowGlobTool = async () => {
    await new Promise((resolve) => setTimeout(resolve, 300)); // 超过 200ms 超时
    return ["file.txt"];
  };

  const result = await search(
    chunks,
    { strategy: "glob-then-grep", patterns: ["**/*.txt"], keywords: ["test"] },
    { globTool: slowGlobTool, timeoutMs: 200 }
  );

  // 应该降级到 grep-only（因为 glob 超时）
  assert.equal(result.strategy, "grep-only");
  assert.ok(result.fallbackReason);
  assert.ok(result.fallbackReason.includes("timeout") || result.fallbackReason.includes("glob_failed"));
  assert.equal(result.results.length, 1);

  clearGlobCache();
});

test("ToolChain: empty chunks returns empty results", async () => {
  const { search, clearGlobCache } = await import("../../../js/agents/retrieval/tool-chain.js");
  clearGlobCache();

  const result = await search([], { strategy: "grep-only", keywords: ["test"] }, {});

  assert.equal(result.results.length, 0);
});

test("ToolChain: glob filters chunks correctly", async () => {
  const { search, clearGlobCache } = await import("../../../js/agents/retrieval/tool-chain.js");
  clearGlobCache();

  const chunks = [
    { chunkId: "c1", text: "JavaScript code", sourceId: "app.js" },
    { chunkId: "c2", text: "Python code", sourceId: "main.py" },
    { chunkId: "c3", text: "More JS code", sourceId: "utils.js" },
  ];

  const mockGlobTool = async ({ pattern }) => {
    if (pattern === "**/*.js") return ["app.js", "utils.js"];
    if (pattern === "**/*.py") return ["main.py"];
    return [];
  };

  // 只搜索 .js 文件
  const result = await search(
    chunks,
    { strategy: "glob-then-grep", patterns: ["**/*.js"], keywords: ["code"] },
    { globTool: mockGlobTool }
  );

  assert.equal(result.strategy, "glob-then-grep");
  // 应该只匹配 c1 和 c3（JS 文件）
  assert.ok(result.results.length >= 2);
  assert.ok(result.results.every((r) => ["c1", "c3"].includes(r.chunkId)));

  clearGlobCache();
});

test("ToolChain: multiple keywords accumulate results", async () => {
  const { search, clearGlobCache } = await import("../../../js/agents/retrieval/tool-chain.js");
  clearGlobCache();

  const chunks = [
    { chunkId: "c1", text: "import React from 'react'", sourceId: "App.js" },
    { chunkId: "c2", text: "export default App", sourceId: "App.js" },
    { chunkId: "c3", text: "function Component() {}", sourceId: "Component.js" },
  ];

  const result = await search(
    chunks,
    { strategy: "grep-only", keywords: ["React", "export", "function"] },
    {}
  );

  assert.equal(result.strategy, "grep-only");
  assert.ok(result.results.length >= 3); // 每个 keyword 至少匹配一个 chunk
  assert.ok(result.stats.grepCalls >= 3);

  clearGlobCache();
});

test("ToolChain: matchCount scoring", async () => {
  const { search, clearGlobCache } = await import("../../../js/agents/retrieval/tool-chain.js");
  clearGlobCache();

  const chunks = [
    { chunkId: "c1", text: "test test test", sourceId: "file.txt" }, // 3 次匹配
    { chunkId: "c2", text: "test", sourceId: "file.txt" }, // 1 次匹配
  ];

  const result = await search(
    chunks,
    { strategy: "grep-only", keywords: ["test"] },
    {}
  );

  const c1Result = result.results.find((r) => r.chunkId === "c1");
  const c2Result = result.results.find((r) => r.chunkId === "c2");

  assert.ok(c1Result);
  assert.ok(c2Result);
  assert.equal(c1Result.matchCount, 3);
  assert.equal(c2Result.matchCount, 1);

  clearGlobCache();
});
