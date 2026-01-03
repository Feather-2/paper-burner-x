/**
 * Subagent 使用示例
 * 
 * 展示主 Agent 如何通过 Task 工具启动和使用子代理
 */

import { createAgent, createLogger } from "../index.js";

const logger = createLogger("sdk/examples/subagent-usage");

// 1. 定义子代理工厂
const createExplorer = async ({ prompt, model }) => {
    return createAgent({ actor: "explorer" })
        .useCapability("search", async (args) => {
            return { success: true, results: [`Search results for "${args.query}"`] };
        })
        .build();
};

const createWriter = async ({ prompt, model }) => {
    return createAgent({ actor: "writer" })
        .useCapability("write", async (args) => {
            return { success: true, text: `Drafting content: ${args.topic}` };
        })
        .build();
};

// 2. 构建主代理并注册子代理
const bossAgent = createAgent({ actor: "boss" })
    .useSubagent("Explore", createExplorer, "在代码库中搜索和探索上下文")
    .useSubagent("Writer", createWriter, "基于搜索结果撰写文档")
    .build();

// 3. 运行演示
async function runDemo() {
    console.log("=== Boss Agent Capability Catalog ===");
    console.log(bossAgent.getCapabilityCatalogPrompt());

    console.log("\n=== Example Model Decision ===");
    console.log("Model would call Task tool like this:");
    const taskCall = {
        subagent_type: "Explore",
        prompt: "Find all instances of authentication logic",
        model: "haiku"
    };

    // 模拟工具执行
    const result = await bossAgent.toolExecutor("Task", taskCall, {
        state: {},
        signal: new AbortController().signal
    });

    console.log("Task Result:", JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
    runDemo().catch((error) => logger.error("runDemo failed", { error }));
}

export { bossAgent, runDemo };
