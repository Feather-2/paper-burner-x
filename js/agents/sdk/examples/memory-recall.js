/**
 * Memory Recall (记忆回想) 使用示例
 *
 * 展示 Agent 如何通过 Recall 工具检索之前的历史细节
 *
 * @module sdk/examples/memory-recall
 */

import { createAgent, createLogger } from "../index.js";

/** @type {ReturnType<typeof createLogger>} */
const logger = createLogger("sdk/examples/memory-recall");

// 1. 构建带记忆功能的 Agent
const agent = createAgent({ actor: "historian" })
    .useCicada({
        maxTokens: 1000,
        // 模拟一个简单的存档适配器（内存中）
        archive: {
            store: async (key, data) => {
                console.log(`[Archive] Saved snapshot: ${key}`);
                return key;
            }
        }
    })
    .build();

/**
 * 运行记忆演示
 * @returns {Promise<void>} 执行记忆检索演示并输出日志
 */
async function runDemo() {
    console.log("=== Historian Agent Skill Catalog ===");
    console.log(agent.getSkillCatalogPrompt());

    const compressor = agent.memory;

    // 手动预置一些“记忆”快照
    await compressor.archive("brainstorm_v1", {
        summary: "讨论了三种前端框架的优劣：React, Vue, Svelte",
        timestamp: Date.now() - 3600000,
        context: {
            detail: "React 社区大，Vue 易上手，Svelte 性能高。最终决定用 React。"
        }
    });

    await compressor.archive("db_design", {
        summary: "确定了数据库表结构，使用 PostgreSQL",
        timestamp: Date.now() - 1800000,
        context: {
            tables: ["users", "posts", "comments"],
            indexing_strategy: "B-Tree on user_id"
        }
    });

    console.log("\n=== Demo 1: List Memories ===");
    const listResult = await agent.toolExecutor("Recall", { action: "list" }, {
        state: {},
        signal: new AbortController().signal
    });
    console.log(listResult.data);

    console.log("\n=== Demo 2: Search Memories (Grep 'PostgreSQL') ===");
    const searchResult = await agent.toolExecutor("Recall", { action: "search", query: "PostgreSQL" }, {
        state: {},
        signal: new AbortController().signal
    });
    console.log(searchResult.data);

    console.log("\n=== Demo 3: Get Detailed Memory ('db_design') ===");
    const getResult = await agent.toolExecutor("Recall", { action: "get", archive_id: "db_design" }, {
        state: {},
        signal: new AbortController().signal
    });
    console.log("Detailed info:", JSON.stringify(getResult.data, null, 2));
}

// 如果直接运行 (Node.js 环境)
if (
    typeof process !== "undefined" &&
    process.argv &&
    import.meta.url === `file://${process.argv[1]}`
) {
    runDemo().catch((error) => logger.error("runDemo failed", { error }));
}

export { agent, runDemo };
