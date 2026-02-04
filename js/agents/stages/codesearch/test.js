/**
 * CodeSearch Stage 测试
 *
 * 运行: node js/agents/stages/codesearch/test.js
 *
 * @fileoverview Node.js-only test file. DO NOT bundle for browser.
 * @node-only
 */

import { createToolExecutor, formatToolDefinitionsForLLM } from "./code-tools.js";
import { createLogger } from "../../shared/index.js";

const logger = createLogger("stages/codesearch/test");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/**
 * @returns {Promise<void>}
 */
async function testTools() {
  console.log("=== CodeSearch Tools Test ===\n");

  // @ts-ignore - this tsconfig is browser-first (no @types/node)
  const { readFile, readdir, stat } = await import("node:fs/promises");
  // @ts-ignore - this tsconfig is browser-first (no @types/node)
  const { fileURLToPath } = await import("node:url");
  // @ts-ignore - this tsconfig is browser-first (no @types/node)
  const { dirname, join } = await import("node:path");

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const projectRoot = join(__dirname, "../../../..");

  // 创建工具执行器
  const tools = createToolExecutor({
    fs: { readFile, readdir, stat },
    basePath: projectRoot,
  });

  // 测试 1: list_dir
  console.log("--- Test: list_dir ---");
  const listResult = await tools.list_dir({ path: "js/agents/stages" });
  console.log("list_dir result:", JSON.stringify(listResult, null, 2));
  assert(!listResult.error, "list_dir should not error");
  assert(Array.isArray(listResult.entries), "list_dir should return entries array");
  assert(listResult.entries.length > 0, "list_dir should return at least one entry");

  // 测试 2: tree
  console.log("\n--- Test: tree ---");
  const treeResult = await tools.tree({ path: "js/agents/stages/codesearch", depth: 2 });
  console.log("tree result:\n", treeResult.tree);
  console.log("stats:", treeResult.stats);
  assert(typeof treeResult.tree === "string" && treeResult.tree.length > 0, "tree should return output");
  assert(treeResult.stats && treeResult.stats.dirs >= 0, "tree should return stats");

  // 测试 3: read_file
  console.log("\n--- Test: read_file ---");
  const readResult = await tools.read_file({
    path: "js/agents/stages/codesearch/index.js",
    startLine: 1,
    endLine: 10,
  });
  console.log("read_file result:\n", readResult.content);
  assert(readResult.content.includes("export"), "read_file should return file content");

  // 测试 3b: read_file path traversal
  let traversalBlocked = false;
  try {
    await tools.read_file({ path: "../package.json" });
  } catch (err) {
    traversalBlocked = true;
  }
  assert(traversalBlocked, "read_file should block path traversal");

  // 测试 3c: list_dir missing path
  const missingDir = await tools.list_dir({ path: "no_such_dir" });
  assert(!!missingDir.error, "list_dir should report missing path errors");

  // 测试 4: 工具定义格式化
  console.log("\n--- Test: Tool Definitions ---");
  const defs = formatToolDefinitionsForLLM();
  console.log("Tool definitions length:", defs.length, "chars");
  console.log("First 500 chars:\n", defs.slice(0, 500));
  assert(defs.includes("read_file"), "tool definitions should include read_file");

  console.log("\n=== All Tools Tests Passed ===");
}

/**
 * @returns {Promise<void>}
 */
async function testMockAgentLoop() {
  console.log("\n=== Mock Agent Loop Test ===\n");

  // @ts-ignore - this tsconfig is browser-first (no @types/node)
  const { readFile, readdir, stat } = await import("node:fs/promises");
  // @ts-ignore - this tsconfig is browser-first (no @types/node)
  const { fileURLToPath } = await import("node:url");
  // @ts-ignore - this tsconfig is browser-first (no @types/node)
  const { dirname, join } = await import("node:path");

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const projectRoot = join(__dirname, "../../../..");

  const tools = createToolExecutor({
    fs: { readFile, readdir, stat },
    basePath: projectRoot,
  });

  // 模拟 Agent Loop 的几个步骤
  const steps = [
    { tool: "tree", args: { depth: 2 } },
    { tool: "list_dir", args: { path: "js/agents/stages" } },
    { tool: "read_file", args: { path: "package.json", startLine: 1, endLine: 20 } },
  ];

  const observations = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    console.log(`Step ${i + 1}: ${step.tool}(${JSON.stringify(step.args)})`);

    const result = await tools.execute(step.tool, step.args);

    if (result.error) {
      console.log(`  Error: ${result.error}`);
    } else {
      const summary = step.tool === "tree"
        ? `${result.stats?.files} files, ${result.stats?.dirs} dirs`
        : step.tool === "list_dir"
          ? `${result.entries?.length} entries`
          : `${result.totalLines} lines`;
      console.log(`  Result: ${summary}`);
    }

    assert(!result.error, `mock step ${i + 1} should not error`);
    observations.push({ step: i + 1, tool: step.tool, result });
  }

  console.log(`\nCompleted ${observations.length} steps`);
  console.log("\n=== Mock Agent Loop Test Passed ===");
}

// 运行测试
/**
 * @returns {Promise<void>}
 */
async function main() {
  try {
    await testTools();
    await testMockAgentLoop();
  } catch (err) {
    logger.error("Test failed:", { error: err?.message || String(err), stack: err?.stack });
    (/** @type {typeof globalThis & { process?: { exit?: (code?: number) => void } }} */ (globalThis)).process?.exit?.(1);
  }
}

main();
