/**
 * Backtrack (春秋蝉) 使用示例
 * 
 * 展示 Agent 如何在发现路径错误时利用回溯工具“穿越”回之前的状态。
 */

import { createAgent, createLogger } from "../index.js";

const logger = createLogger("sdk/examples/backtrack-usage");

// 1. 构建支持回溯的 Agent
const agent = createAgent({ actor: "traveler" })
    .useCicada({ maxTokens: 2000 }) // 回溯依赖存档机制
    .useBacktrack({ maxBacktracks: 5 }) // 允许最多回溯 5 次
    .build();

// 2. 模拟运行环境
async function runDemo() {
    console.log("=== Agent Skill Catalog ===");
    console.log(agent.getSkillCatalogPrompt());

    const memory = agent.memory;
    const backtrack = agent.backtrack;

    // 模拟历史：路径 A (最终发现是错的)
    console.log("\n--- 模拟路径 A (错误路径) ---");
    await memory.archive("step_1_start", {
        summary: "开始任务：寻找宝藏",
        context: { location: "起点", path: "未选择" }
    });

    await memory.archive("step_2_mountain", {
        summary: "走向了雪山路径",
        context: { location: "雪山脚下", path: "雪山", temperature: -20 }
    });

    console.log("当前状态: 正在雪山中摸索，即将遭遇雪崩...");

    // 3. 模型意识到错误，决定调用 Backtrack 工具
    console.log("\n--- 模型决策：使用春秋蝉回溯 ---");

    // 模拟模型调用工具
    const backtrackResult = await agent.toolExecutor("Backtrack", {
        reason: "雪山路径太危险，且没有带御寒装备，我需要回滚到起点重新选择森林路径。",
        hint: "不要选雪山，选那条长满蘑菇的森林小径。"
    }, {
        state: {},
        signal: new AbortController().signal
    });

    if (backtrackResult.backtrack) {
        const { checkpointId, state, hint } = backtrackResult.backtrack;
        console.log(`\n[系统回溯中...]`);
        console.log(`成功回滚到存档: ${checkpointId}`);
        console.log(`当时的地点: ${state.location}`);
        console.log(`给未来的提示: "${hint}"`);
        console.log(`剩余回溯次数: ${backtrack.remaining}`);
    }

    // 4. 继续模拟“重来”后的逻辑
    console.log("\n--- 开启新时间线 ---");
    await memory.archive("step_2_forest_new", {
        summary: "选择了森林路径 (基于回溯提示)",
        context: { location: "森林入口", path: "森林", hint_used: true }
    });

    const list = await agent.toolExecutor("Recall", { action: "list" }, { state: {} });
    console.log("\n当前存档列表 (可以看到新旧并存):");
    console.log(list.data);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    runDemo().catch((error) => logger.error("runDemo failed", { error }));
}

export { agent, runDemo };
