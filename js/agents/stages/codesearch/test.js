/**
 * CodeSearch Stage 测试
 *
 * 运行: node js/agents/stages/codesearch/test.js
 */

import { createToolExecutor, formatToolDefinitionsForLLM } from "./code-tools.js";
import { readFile, readdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createLogger } from "../../shared/utils/logger.js";

const logger = createLogger("stages/codesearch/test");

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "../../../..");

async function testTools() {
  console.log("=== CodeSearch Tools Test ===\n");

  // 创建工具执行器
  const tools = createToolExecutor({
    fs: { readFile, readdir, stat },
    basePath: projectRoot,
  });

  // 测试 1: list_dir
  console.log("--- Test: list_dir ---");
  const listResult = await tools.list_dir({ path: "js/agents/stages" });
  console.log("list_dir result:", JSON.stringify(listResult, null, 2));

  // 测试 2: tree
  console.log("\n--- Test: tree ---");
  const treeResult = await tools.tree({ path: "js/agents/stages/codesearch", depth: 2 });
  console.log("tree result:\n", treeResult.tree);
  console.log("stats:", treeResult.stats);

  // 测试 3: read_file
  console.log("\n--- Test: read_file ---");
  const readResult = await tools.read_file({
    path: "js/agents/stages/codesearch/index.js",
    startLine: 1,
    endLine: 10,
  });
  console.log("read_file result:\n", readResult.content);

  // 测试 4: 工具定义格式化
  console.log("\n--- Test: Tool Definitions ---");
  const defs = formatToolDefinitionsForLLM();
  console.log("Tool definitions length:", defs.length, "chars");
  console.log("First 500 chars:\n", defs.slice(0, 500));

  console.log("\n=== All Tools Tests Passed ===");
}

async function testMockAgentLoop() {
  console.log("\n=== Mock Agent Loop Test ===\n");

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

    observations.push({ step: i + 1, tool: step.tool, result });
  }

  console.log(`\nCompleted ${observations.length} steps`);
  console.log("\n=== Mock Agent Loop Test Passed ===");
}

// 运行测试
async function main() {
  try {
    await testTools();
    await testMockAgentLoop();
  } catch (err) {
    logger.error("Test failed:", { error: err?.message || String(err), stack: err?.stack });
    process.exit(1);
  }
}

main();
