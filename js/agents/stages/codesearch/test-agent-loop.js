/**
 * CodeSearch 完整 Agent Loop 测试（Mock LLM）
 *
 * 运行: node js/agents/stages/codesearch/test-agent-loop.js
 *
 * @fileoverview Node.js-only test file. DO NOT bundle for browser.
 * @node-only
 */

import { CodeSearchStage } from "./codesearch-stage.js";
import { createLogger } from "../../shared/utils/logger.js";

const logger = createLogger("stages/codesearch/test-agent-loop");

// Mock LLM 响应序列
const MOCK_RESPONSES = [
  // Todo planner
  {
    content: JSON.stringify([
      {
        text: "Analyze CodeSearch module structure",
        priority: "high",
        queryHints: ["codesearch", "entry", "structure"],
        expectedEvidence: "module entry points and layout",
      },
    ]),
  },
  // Step 1: 先看目录结构
  {
    content: JSON.stringify({
      thought: "先了解项目整体结构",
      todoIndex: 1,
      action: "tree",
      args: { path: "js/agents/stages/codesearch", depth: 2 }
    })
  },
  // Step 2: 读取 index.js
  {
    content: JSON.stringify({
      thought: "查看模块入口",
      todoIndex: 1,
      action: "read_file",
      args: { path: "js/agents/stages/codesearch/index.js" }
    })
  },
  // Step 3: 读取主文件
  {
    content: JSON.stringify({
      thought: "查看主逻辑",
      todoIndex: 1,
      action: "read_file",
      args: { path: "js/agents/stages/codesearch/codesearch-stage.js", startLine: 1, endLine: 50 }
    })
  },
  // Step 4: 完成
  {
    content: JSON.stringify({
      thought: "已了解 CodeSearch 模块结构",
      todoIndex: 1,
      todoStatus: "completed",
      action: "done"
    })
  },
];

let mockCallIndex = 0;

// Mock modelRouter
const mockModelRouter = {
  /**
   * @param {any[]} messages
   * @param {any} opts
   * @returns {Promise<{ content: string, usage: { input: number, output: number } }>}
   */
  call: async (messages, opts) => {
    console.log(`  [Mock LLM] Call ${mockCallIndex + 1}, messages: ${messages.length}`);
    const response = MOCK_RESPONSES[mockCallIndex] || MOCK_RESPONSES[MOCK_RESPONSES.length - 1];
    mockCallIndex++;
    return {
      ...response,
      usage: { input: 100, output: 50 }
    };
  }
};

// Mock stageApi
/**
 * @returns {Promise<void>}
 */
async function testAgentLoop() {
  console.log("=== CodeSearch Agent Loop Test (Mock LLM) ===\n");

  // @ts-ignore - this tsconfig is browser-first (no @types/node)
  const { readFile, readdir, stat } = await import("node:fs/promises");
  // @ts-ignore - this tsconfig is browser-first (no @types/node)
  const { fileURLToPath } = await import("node:url");
  // @ts-ignore - this tsconfig is browser-first (no @types/node)
  const { dirname, join } = await import("node:path");

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const projectRoot = join(__dirname, "../../../..");

  /** @type {any} */
  const mockStageApi = {
    modelRouter: mockModelRouter,
    fs: { readFile, readdir, stat },
    emit: (event, payload) => {
      console.log(`  [Event] ${event}:`, typeof payload === "object" ? JSON.stringify(payload).slice(0, 100) : payload);
    },
    signal: null,
  };

  const stage = new CodeSearchStage({ maxSteps: 10 });

  const runContext = { runId: "test-001" };
  const input = {
    query: "分析 codesearch 模块的结构",
    basePath: projectRoot,
  };

  console.log("Starting CodeSearch...\n");
  mockCallIndex = 0;

  try {
    const result = /** @type {any} */ (await stage.execute(runContext, input, mockStageApi));

    console.log("\n=== Result ===");
    console.log("Query:", result.query);
    console.log("Total Steps:", result.totalSteps);
    console.log("Steps executed:", result.steps.map(s => `${s.step}:${s.tool}`).join(" → "));
    console.log("\nSummary preview:", result.summary.slice(0, 200) + "...");

    console.log("\n✅ Agent Loop Test Passed!");
  } catch (err) {
    logger.error("\n❌ Test Failed:", { error: err?.message || String(err), stack: err?.stack });
    /** @type {any} */ (globalThis).process?.exit?.(1);
  }
}

testAgentLoop();
