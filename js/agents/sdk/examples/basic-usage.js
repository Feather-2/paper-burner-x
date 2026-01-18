/**
 * SDK 使用示例
 *
 * 展示如何使用 @paper-burner/agents SDK 构建自定义 Agent
 * 注意：此示例已更新为使用 useCapability API
 *
 * @module sdk/examples/basic-usage
 */

import { createAgent, createLogger } from "../index.js";

/** @type {ReturnType<typeof createLogger>} */
const logger = createLogger("sdk/examples/basic-usage");

// ============================================================================
// 示例 1: 基础用法 - 流式构建
// ============================================================================

const basicAgent = createAgent({ actor: "demo" })
    .useCapability("echo", async (args) => {
        const text = typeof args.text === "string" ? args.text : "";
        return {
            success: true,
            data: { echoed: text },
        };
    })
    .useCapability("greet", {
        definition: {
            name: "greet",
            description: "向用户问好",
            activation: { keywords: ["hello", "hi", "你好"] },
        },
        handler: async (args) => {
            const name = typeof args.name === "string" ? args.name : "World";
            return {
                success: true,
                data: { message: `Hello, ${name}!` },
            };
        },
    })
    .onEvent("demo:*", (event) => {
        console.log("[Event]", event);
    })
    .build();

// ============================================================================
// 示例 2: 带 Hook 的 Agent
// ============================================================================

const auditLogger = createLogger({ actor: "audit" });

const agentWithHooks = createAgent({ actor: "audited" })
    .useCapability("search", async (args) => {
        const query = typeof args.query === "string" ? args.query : "";
        return {
            success: true,
            data: { results: [`Result for: ${query}`] },
        };
    })
    // Before hook: 记录所有工具调用
    .useHook("before", async ({ tool, params }) => {
        auditLogger.info(`Calling tool: ${tool}`, { params });
        // 返回 undefined 继续执行
    })
    // Before hook: 可以跳过某些调用
    .useHook("before", async ({ tool, params }) => {
        if (params.blocked) {
            return { skip: true, value: { blocked: true } };
        }
    })
    // After hook: 添加执行时间戳
    .useHook("after", async ({ tool, result }) => {
        return { ...result, _timestamp: Date.now() };
    })
    .build();

// ============================================================================
// 示例 3: 懒加载 Capability
// ============================================================================

const lazyAgent = createAgent({ actor: "lazy" })
    .useCapability("heavy-task", {
        definition: {
            name: "heavy-task",
            description: "需要懒加载的重型任务",
            lazy: true, // 默认就是 true
        },
        module: "./heavy-task-handler.js", // 按需加载
    })
    .build();

// ============================================================================
// 运行示例
// ============================================================================

/**
 * 运行所有示例
 * @returns {Promise<void>} 执行示例并输出日志
 */
async function runExamples() {
    console.log("=== Basic Agent ===");
    console.log("Capabilities:", basicAgent.getCapabilityDefinitions());

    console.log("\n=== Agent with Hooks ===");
    const hookResult = await agentWithHooks.run({ query: "test" });
    console.log("Result:", hookResult);

    console.log("\n=== Lazy Agent ===");
    console.log("Lazy capabilities:", lazyAgent.getCapabilityDefinitions());
}

// 导出供测试使用
export { basicAgent, agentWithHooks, lazyAgent, runExamples };

// 如果直接运行 (Node.js 环境)
if (
    typeof process !== "undefined" &&
    process.argv &&
    import.meta.url === `file://${process.argv[1]}`
) {
    runExamples().catch((error) => logger.error("runExamples failed", { error }));
}
