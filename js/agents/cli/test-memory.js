#!/usr/bin/env node
/**
 * MemoryStore 集成测试（非交互）
 */

import DeepSearchAgentLoop from "../stages/deepsearch/deepsearch-agent-loop.js";
import { DeepSearchState } from "../stages/deepsearch/state.js";
import { EventBus } from "../runtime/events/event-bus.js";
import { CliModelRouter } from "./model-client.js";

// 创建事件总线
const eventBus = new EventBus();
eventBus.subscribe("*", (payload, meta) => {
  const name = meta?.name || "unknown";
  if (name.includes("iteration") || name.includes("completed") || name.includes("started")) {
    console.log(`[Event] ${name}`);
  }
});

// 加载简单测试文档
const testDoc = {
  id: "test-doc-1",
  name: "测试文档.md",
  content: `# 测试文档

## 概述
这是一个用于测试 MemoryStore 集成的简单文档。

## 关键信息
- 项目名称: Paper Burner
- 版本: 1.0.0
- 功能: 文档分析

## 结论
MemoryStore 应该能正确追踪这些信息。
`,
  type: "markdown",
};

async function main() {
  console.log("=== MemoryStore 集成测试 ===\n");

  // 创建模型路由
  const modelRouter = new CliModelRouter();

  // 创建 stageApi - modelRouter 需要有 call 方法
  const stageApi = {
    signal: new AbortController().signal,
    modelRouter: {
      call: async (messages, opts = {}) => {
        const client = modelRouter.getClient(opts.usage || "agent");
        return client.chat({ messages, ...opts });
      },
    },
    emit: (name, payload) => eventBus.emit(name, payload),
    eventBus,
  };

  // 创建初始状态
  const state = new DeepSearchState({
    taskGoal: "分析测试文档的关键信息",
    L0: { sources: [testDoc] },
  });

  console.log("任务:", state.taskGoal);
  console.log("文档:", testDoc.name);
  console.log("模式: quick (5轮)\n");
  console.log("--- 开始运行 ---\n");

  try {
    const agent = new DeepSearchAgentLoop({
      eventBus,
      mode: "quick",
      maxIterations: 5,
    });

    const result = await agent.run(state, { stageApi });

    console.log("\n--- 运行完成 ---");
    console.log("状态:", result.status);
    console.log("报告:", result.report ? "已生成" : "无");
  } catch (err) {
    console.error("错误:", err.message);
    console.error(err.stack);
  }

  process.exit(0);
}

main();
