/**
 * CodeSearch 完整 Agent Loop 测试（Mock LLM）
 *
 * 运行: node js/agents/stages/codesearch/test-agent-loop.js
 */

import { CodeSearchStage } from "./codesearch-stage.js";
import { readFile, readdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "../../../..");

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
const mockStageApi = {
  modelRouter: mockModelRouter,
  fs: { readFile, readdir, stat },
  emit: (event, payload) => {
    console.log(`  [Event] ${event}:`, typeof payload === 'object' ? JSON.stringify(payload).slice(0, 100) : payload);
  },
  signal: null,
};

async function testAgentLoop() {
  console.log("=== CodeSearch Agent Loop Test (Mock LLM) ===\n");

  const stage = new CodeSearchStage({ maxSteps: 10 });

  const runContext = { runId: "test-001" };
  const input = {
    query: "分析 codesearch 模块的结构",
    basePath: projectRoot,
  };

  console.log("Starting CodeSearch...\n");
  mockCallIndex = 0;

  try {
    const result = await stage.execute(runContext, input, mockStageApi);

    console.log("\n=== Result ===");
    console.log("Query:", result.query);
    console.log("Total Steps:", result.totalSteps);
    console.log("Steps executed:", result.steps.map(s => `${s.step}:${s.tool}`).join(" → "));
    console.log("\nSummary preview:", result.summary.slice(0, 200) + "...");

    console.log("\n✅ Agent Loop Test Passed!");
  } catch (err) {
    console.error("\n❌ Test Failed:", err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

testAgentLoop();
