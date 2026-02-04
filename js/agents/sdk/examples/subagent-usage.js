/**
 * Subagent 使用示例
 *
 * 展示主 Agent 如何通过 Task 工具启动和使用子代理
 *
 * @module sdk/examples/subagent-usage
 */

import { createAgent, createLogger } from "../index.js";

/** @type {ReturnType<typeof createLogger>} */
const logger = createLogger("sdk/examples/subagent-usage");

/**
 * @typedef {import('../AgentBuilder.js').AgentInstance} BuiltAgent
 */

/**
 * 创建探索子代理
 * @param {object} options - 子代理创建参数
 * @param {string} options.prompt - 子代理执行的提示词
 * @param {string} options.model - 使用的模型标识
 * @returns {Promise<BuiltAgent>} 构建完成的探索子代理实例
 */
const createExplorer = async (options) => {
    return createAgent({ actor: "explorer" })
        .useCapability("search", async (args) => {
            const query = typeof args.query === "string" ? args.query : "";
            return { success: true, results: [`Search results for "${query}"`] };
        })
        .build();
};

/**
 * 创建写作子代理
 * @param {object} options - 子代理创建参数
 * @param {string} options.prompt - 子代理执行的提示词
 * @param {string} options.model - 使用的模型标识
 * @returns {Promise<BuiltAgent>} 构建完成的写作子代理实例
 */
const createWriter = async (options) => {
    return createAgent({ actor: "writer" })
        .useCapability("write", async (args) => {
            const topic = typeof args.topic === "string" ? args.topic : "";
            return { success: true, text: `Drafting content: ${topic}` };
        })
        .build();
};

// 2. 构建主代理并注册子代理
const bossAgent = createAgent({ actor: "boss" })
    .useSubagent("Explore", createExplorer, "在代码库中搜索和探索上下文")
    .useSubagent("Writer", createWriter, "基于搜索结果撰写文档")
    .build();

/**
 * 运行子代理演示
 * @returns {Promise<void>} 执行子代理演示并输出日志
 */
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

// 如果直接运行 (Node.js 环境)
if (
    typeof process !== "undefined" &&
    process.argv &&
    import.meta.url === `file://${process.argv[1]}`
) {
    runDemo().catch((error) => logger.error("runDemo failed", { error }));
}

export { bossAgent, runDemo };
