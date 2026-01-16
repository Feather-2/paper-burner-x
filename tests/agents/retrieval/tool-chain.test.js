import { describe, it, expect, beforeEach, afterEach } from "vitest";

const assert = require("node:assert/strict");

it("ToolChain: grep-only strategy", async () => {
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

  expect(result.strategy).toBe("grep-only");
  expect(result.results.length).toBe(3); // hello 在 c1, c3; API_KEY 在 c2
  expect(result.stats.grepCalls >= 2).toBeTruthy();
  expect(result.stats.hits >= 3).toBeTruthy();
});

it("ToolChain: normalizeToolChainStrategy", async () => {
  const { ToolChainStrategy, normalizeToolChainStrategy } = await import("../../../js/agents/retrieval/tool-chain.js");

  expect(normalizeToolChainStrategy("GLOB-THEN-GREP")).toBe(ToolChainStrategy.GLOB_THEN_GREP);
  expect(normalizeToolChainStrategy("grep-only")).toBe(ToolChainStrategy.GREP_ONLY);
  expect(normalizeToolChainStrategy("auto")).toBe(ToolChainStrategy.AUTO);
  expect(normalizeToolChainStrategy("unknown")).toBe(undefined);
});

it("ToolChain: glob-then-grep with cache", async () => {
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

  expect(result1.strategy).toBe("glob-then-grep");
  expect(result1.results.length >= 2).toBeTruthy(); // React 和 export 都在 App.js 中
  expect(result1.stats.globCalls).toBe(1);
  expect(result1.stats.cached).toBe(0); // 第一次没有缓存

  // 第二次调用：应该使用缓存
  const result2 = await search(
    chunks,
    { strategy: "glob-then-grep", patterns: ["**/*.js"], keywords: ["React"] },
    { globTool: mockGlobTool, caseSensitive: false }
  );

  expect(result2.stats.globCalls).toBe(1);
  expect(result2.stats.cached).toBe(1); // 第二次使用缓存

  const cacheStats = getGlobCacheStats();
  expect(cacheStats.size >= 1).toBeTruthy();

  clearGlobCache();
});

it("ToolChain: glob file filter uses normalized exact match (no substring)", async () => {
  const { search, clearGlobCache } = await import("../../../js/agents/retrieval/tool-chain.js");
  clearGlobCache();

  const chunks = [
    { chunkId: "c1", text: "import React from 'react';", sourceId: "src/App.js" },
    { chunkId: "c2", text: "import React from 'react';", sourceId: "src/App.js.bak" },
    { chunkId: "c3", text: "export default App;", sourceId: "src/App.js" },
  ];

  const mockGlobTool = async ({ pattern }) => {
    if (pattern === "**/*.js") return ["src\\App.js"];
    return [];
  };

  const result = await search(
    chunks,
    { strategy: "glob-then-grep", patterns: ["**/*.js"], keywords: ["React"] },
    { globTool: mockGlobTool, caseSensitive: false }
  );

  expect(result.strategy).toBe("glob-then-grep");
  expect(result.results.length).toBe(1);
  expect(result.results[0].chunkId).toBe("c1");
});

it("ToolChain: auto strategy with patterns falls back to glob-then-grep", async () => {
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
  expect(result.strategy).toBe("glob-then-grep");
  expect(result.results.length >= 2).toBeTruthy();

  clearGlobCache();
});

it("ToolChain: fallback to grep-only when glob fails", async () => {
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
  expect(result.strategy).toBe("grep-only");
  expect(result.fallbackReason).toBeTruthy();
  expect(result.fallbackReason.includes("glob_failed")).toBeTruthy();
  expect(result.results.length).toBe(2); // grep-only 能找到两个 world

  clearGlobCache();
});

it("ToolChain: no keywords returns empty results", async () => {
  const { search, clearGlobCache } = await import("../../../js/agents/retrieval/tool-chain.js");
  clearGlobCache();

  const chunks = [{ chunkId: "c1", text: "hello", sourceId: "file.txt" }];

  const result = await search(chunks, { strategy: "grep-only", keywords: [] }, {});

  // New structure: fail-fast validation error
  expect(result.ok).toBe(false);
  expect(result.error?.code).toBe("NO_KEYWORDS");
  expect(result.results.length).toBe(0);
});

it("ToolChain: regex support", async () => {
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

  expect(result.strategy).toBe("grep-only");
  expect(result.results.length >= 2).toBeTruthy(); // 匹配 test123 和 test456
  expect(result.results.every(r => ["c1", "c2"].includes(r.chunkId)));

  clearGlobCache();
});

it("ToolChain: case sensitive search", async () => {
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

  expect(result1.results.length).toBe(1);
  expect(result1.results[0].chunkId).toBe("c1");

  // 大小写不敏感
  const result2 = await search(
    chunks,
    { strategy: "grep-only", keywords: ["hello"] },
    { caseSensitive: false }
  );

  expect(result2.results.length).toBe(2);

  clearGlobCache();
});

it("ToolChain: glob timeout fallback", async () => {
  const { search, clearGlobCache } = await import("../../../js/agents/retrieval/tool-chain.js");
  clearGlobCache();

  const chunks = [
    { chunkId: "c1", text: "test content", sourceId: "file.txt" },
  ];

  const slowGlobTool = async () => new Promise(() => {});

  const result = await search(
    chunks,
    { strategy: "glob-then-grep", patterns: ["**/*.txt"], keywords: ["test"] },
    { globTool: slowGlobTool, timeoutMs: 5 }
  );

  // 应该降级到 grep-only（因为 glob 超时）
  expect(result.strategy).toBe("grep-only");
  expect(result.fallbackReason).toBeTruthy();
  expect(result.fallbackReason.includes("timeout")).toBeTruthy() || result.fallbackReason.includes("glob_failed"));
  expect(result.results.length).toBe(1);

  clearGlobCache();
});

it("ToolChain: empty chunks returns empty results", async () => {
  const { search, clearGlobCache } = await import("../../../js/agents/retrieval/tool-chain.js");
  clearGlobCache();

  const result = await search([], { strategy: "grep-only", keywords: ["test"] }, {});

  expect(result.results.length).toBe(0);
});

it("ToolChain: glob filters chunks correctly", async () => {
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

  expect(result.strategy).toBe("glob-then-grep");
  // 应该只匹配 c1 和 c3（JS 文件）
  expect(result.results.length >= 2).toBeTruthy();
  expect(result.results.every(r => ["c1", "c3"].includes(r.chunkId)));

  clearGlobCache();
});

it("ToolChain: multiple keywords accumulate results", async () => {
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

  expect(result.strategy).toBe("grep-only");
  expect(result.results.length >= 3).toBeTruthy(); // 每个 keyword 至少匹配一个 chunk
  expect(result.stats.grepCalls >= 3).toBeTruthy();

  clearGlobCache();
});

it("ToolChain: matchCount scoring", async () => {
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

  expect(c1Result).toBeTruthy();
  expect(c2Result).toBeTruthy();
  expect(c1Result.matchCount).toBe(3);
  expect(c2Result.matchCount).toBe(1);

  clearGlobCache();
});
