#!/usr/bin/env node
/**
 * DeepSearch 测试脚本（交互模式）
 *
 * 用法:
 *   node js/agents/cli/test-deepsearch.js [md文件路径...]
 *   node js/agents/cli/test-deepsearch.js  # 默认使用 docs/agents 下的 md
 */

import { runDeepSearchAgent, DeepSearchState } from "../stages/deepsearch/index.js";
import { EventBus } from "../core/event-bus.js";
import { CliModelRouter, createAiApiServiceAdapter } from "./model-client.js";
import { readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { join, basename } from "path";
import { createInterface } from "readline";
import { smartChunk, detectChunkStrategy } from "../stages/textprep/chunk.js";

// 创建 readline 接口
const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Promise 化的问答
function askQuestion(prompt) {
  return new Promise(resolve => {
    rl.question(prompt, answer => resolve(answer.trim()));
  });
}

// 用户输入等待队列
let pendingUserInput = null;

// 创建事件总线，监听所有事件
const eventBus = new EventBus();
eventBus.subscribe("*", (payload, meta) => {
  const name = meta?.name || "unknown";
  const ts = new Date().toISOString().slice(11, 19);

  // 详细显示关键事件
  if (name.includes("iteration")) {
    console.log(`\n[${ts}] 🔄 迭代 ${payload?.iteration || "?"}`);
  } else if (name.includes("model.responded")) {
    const usage = payload?.usage || {};
    console.log(`[${ts}] 🤖 模型响应: ${usage.total || 0} tokens`);
  } else if (name.includes("todo")) {
    console.log(`[${ts}] 📋 Todo: ${name.split(".").pop()} - ${JSON.stringify(payload?.payload || payload).slice(0, 100)}`);
  } else if (name.includes("watchdog")) {
    console.log(`[${ts}] 🐕 Watchdog: ${JSON.stringify(payload?.payload || payload).slice(0, 100)}`);
  } else if (name.includes("report")) {
    console.log(`[${ts}] 📝 Report: ${name}`);
  } else if (name.includes("finding.claim")) {
    // 详细显示 claim 形成
    console.log(`[${ts}] 💡 CLAIM: ${payload?.content || JSON.stringify(payload).slice(0, 100)}`);
  } else if (name.includes("finding.gap")) {
    // 详细显示 gap 形成
    console.log(`[${ts}] ❓ GAP: ${payload?.content || JSON.stringify(payload).slice(0, 100)}`);
  } else if (name.includes("finding.conflict")) {
    // 详细显示 conflict 形成
    console.log(`[${ts}] ⚡ CONFLICT: ${payload?.content || JSON.stringify(payload).slice(0, 100)}`);
  } else if (name.includes("evidence") || name.includes("claim")) {
    console.log(`[${ts}] 🔍 ${name.split(".").pop()}: ${JSON.stringify(payload?.payload || payload).slice(0, 80)}`);
  } else if (name.includes("started") || name.includes("completed")) {
    console.log(`[${ts}] ✅ ${name}`);
  } else if (name.includes("user.input.required")) {
    // 用户输入请求事件 - 由 waitForUserInput 处理
  }
});

// 递归查找 md 文件
function findMdFiles(dir, files = []) {
  try {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        findMdFiles(fullPath, files);
      } else if (entry.endsWith(".md")) {
        files.push(fullPath);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = err && typeof err === "object" && "code" in err ? err.code : undefined;
    console.warn(`无法读取目录 ${dir}: ${message}`);
    if (code !== "EACCES" && code !== "EPERM") {
      throw err;
    }
  }
  return files;
}

// 加载文件为 source（带分块策略检测）
function loadSource(filePath) {
  try {
    const content = readFileSync(filePath, "utf-8");
    const name = basename(filePath);

    // 检测分块策略
    const chunkResult = smartChunk(content, { maxSize: 2000 });

    return {
      sourceId: name,
      name,
      sourceText: content,
      // 分块元信息
      chunkStrategy: chunkResult.strategy,
      chunkMeta: chunkResult.meta,
      chunks: chunkResult.chunks,
    };
  } catch (err) {
    console.error(`无法读取 ${filePath}: ${err.message}`);
    return null;
  }
}

/**
 * 等待用户输入
 */
async function waitForUserInput({ question, options }) {
  console.log("\n" + "=".repeat(50));
  console.log("🙋 Agent 需要你的输入:");
  console.log("=".repeat(50));
  console.log(`\n${question}\n`);

  if (options?.length) {
    console.log("选项:");
    options.forEach((opt, i) => console.log(`  ${i + 1}. ${opt}`));
    console.log(`  0. 自定义输入`);
    console.log("");

    const choice = await askQuestion("请选择 (输入数字或直接输入内容): ");

    // 如果是数字且在范围内
    const num = parseInt(choice, 10);
    if (!isNaN(num) && num >= 1 && num <= options.length) {
      return options[num - 1];
    } else if (num === 0 || isNaN(num)) {
      // 自定义输入
      if (isNaN(num)) {
        return choice; // 直接使用输入的内容
      }
      return await askQuestion("请输入: ");
    }
    return choice;
  } else {
    const answer = await askQuestion("> ");
    return answer;
  }
}

async function main() {
  console.log("=== DeepSearch 测试 (交互模式) ===\n");

  // 支持环境变量跳过交互
  const envTask = process.env.DEEPSEARCH_TASK;
  const envMode = process.env.DEEPSEARCH_MODE;

  // 获取测试文件
  const args = process.argv.slice(2);
  let mdFiles = args.filter(a => a.endsWith(".md"));

  if (mdFiles.length === 0) {
    // 默认使用 docs/agents 下的 md 文件
    const docsDir = join(process.cwd(), "docs/agents");
    mdFiles = findMdFiles(docsDir);
    console.log(`从 ${docsDir} 找到 ${mdFiles.length} 个 md 文件`);
  }

  if (mdFiles.length === 0) {
    console.error("没有找到 md 文件");
    rl.close();
    process.exit(1);
  }

  // 加载文件
  const sources = mdFiles.map(loadSource).filter(Boolean);

  // 显示文档和分块策略
  console.log("\n📚 加载的文档:");
  const strategyIcon = { markdown: "📑", semantic: "📄", fixed: "📃" };
  for (const s of sources) {
    const icon = strategyIcon[s.chunkStrategy] || "📃";
    console.log(`  ${icon} ${s.name} (${s.chunkStrategy}, ${s.chunks?.length || 0}块, ${s.sourceText.length}字)`);
  }
  console.log("");

  // 非交互模式：环境变量优先
  let taskGoal, mode;
  if (envTask || envMode) {
    taskGoal = envTask || "分析该项目的整体结构，包括：1) 核心模块划分 2) Agent 架构设计 3) 关键数据流 4) 扩展点和接口";
    mode = { "1": "quick", "2": "wider", "3": "deeper", "quick": "quick", "wider": "wider", "deeper": "deeper" }[envMode] || "wider";
    console.log(`[非交互模式] Task: ${taskGoal.slice(0, 50)}...`);
    console.log(`[非交互模式] Mode: ${mode}`);
  } else {
    // 询问用户任务目标
    console.log("\n默认任务: 分析该项目的整体结构");
    const customTask = await askQuestion("输入自定义任务 (回车使用默认): ");
    taskGoal = customTask || "分析该项目的整体结构，包括：1) 核心模块划分 2) Agent 架构设计 3) 关键数据流 4) 扩展点和接口";

    // 询问分析模式
    console.log("\n分析模式:");
    console.log("  1. quick  - 快速概览 (10轮)");
    console.log("  2. wider  - 广度优先 (20轮) [默认]");
    console.log("  3. deeper - 深度优先 (40轮)");
    const modeChoice = await askQuestion("选择模式 (1/2/3 或回车使用默认): ");
    mode = { "1": "quick", "3": "deeper" }[modeChoice] || "wider";
  }

  const runContext = {
    runId: `test_${Date.now()}`,
  };

  const input = {
    taskGoal,
    mode,
    L0: { sources },
    userConfig: {
      contextWindow: 16000,
      compressThreshold: 0.7,
    },
  };

  // 创建模型路由
  const modelRouter = new CliModelRouter();
  const aiApiService = createAiApiServiceAdapter(modelRouter);

  console.log("\n可用模型:", modelRouter.getAvailableModels().join(", ") || "无");

  const stageApi = {
    eventBus,
    emit: (name, payload) => eventBus.emit(name, payload),
    signal: new AbortController().signal,
    modelRouter: {
      call: async ({ usage, messages, signal, ...rest }) => {
        const client = modelRouter.getClient(usage);
        if (!client) {
          throw new Error(`No client for usage: ${usage}`);
        }
        return client.chat({ messages, signal, ...rest });
      }
    },
    aiApiService,
    // 人机交互能力
    waitForUserInput,
  };

  console.log("\nTask:", input.taskGoal);
  console.log("Sources:", sources.length);
  console.log("\n💡 提示: Agent 可能会通过 ask-user 技能向你提问\n");

  try {
    const result = await runDeepSearchAgent(runContext, input, stageApi);

    console.log("\n=== 结果 ===");
    console.log("Status:", result?.status);
    console.log("Iterations:", result?.iteration);

    // 显示上下文状态
    console.log("\n--- Context Status ---");
    console.log("Messages:", result?._messages?.length || "N/A");
    console.log("Token Usage:", JSON.stringify(result?._tokenUsage || {}, null, 2));

    if (result?.report) {
      const reportContent = typeof result.report === "string"
        ? result.report
        : result.report?.markdown || JSON.stringify(result.report, null, 2);

      console.log("\n--- Report (前500字) ---");
      console.log(reportContent.slice(0, 500) + "...");

      // 保存完整报告
      const outputPath = join(process.cwd(), "output", `deepsearch-report-${Date.now()}.md`);
      try {
        const outputDir = join(process.cwd(), "output");
        try { readdirSync(outputDir); } catch {
          const { mkdirSync } = await import("fs");
          mkdirSync(outputDir, { recursive: true });
        }
        writeFileSync(outputPath, reportContent, "utf-8");
        console.log(`\n✅ 完整报告已保存: ${outputPath}`);
      } catch (err) {
        console.error("保存报告失败:", err.message);
      }
    } else {
      console.log("\n⚠️ 没有生成报告");
      console.log("Result keys:", Object.keys(result || {}));
    }

  } catch (err) {
    console.error("Error:", err.message);
    console.error(err.stack);
  } finally {
    rl.close();
  }
}

main().catch(err => {
  console.error("Error:", err.message || err);
  process.exitCode = 1;
});
