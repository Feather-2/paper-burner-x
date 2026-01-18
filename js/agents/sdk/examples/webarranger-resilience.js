/**
 * WebArranger Resilience Example (针对 OPPO 提出的 14 种失败模式)
 *
 * 演示场景:
 * 1. Arranger (主 Loop) 分配两个子代理 (Subagent) 调查同一家公司的收入。
 * 2. 子代理 A 在 2023 年报中发现收入为 $10B。
 * 3. 子代理 B 在 2024 展望中发现收入预测为 $8B。
 * 4. 子代理将结果通过 Shared Blackboard (DiscoveryManager) 同步。
 * 5. Arranger 发现冲突，启动 cross-verify 进行语义核对。
 * 6. 最终得出结论：由于市场波动，2024 预测低于 2023 实际。
 *
 * @module sdk/examples/webarranger-resilience
 */

import { createAgent, createLogger } from "../index.js";
import { DiscoveryStatus } from "../DiscoveryManager.js";

/** @type {ReturnType<typeof createLogger>} */
const logger = createLogger("sdk/examples/webarranger-resilience");

/**
 * 主演示函数
 * @returns {Promise<void>} 执行韧性编排演示并输出日志
 */
async function main() {
    console.log("🚀 Starting Resilient WebArranger Workflow...");

    // 1. 创建具备韧性机制的 Agent
    const arranger = createAgent()
        .useCicada({ maxTokens: 4000 })
        .useBacktrack({ maxBacktracks: 3 })
        .build();

    // 模拟初始化 DiscoveryManager (在真实 Loop 中由 AgentBuilder/Loop 自动完成)
    // 这里我们通过 mock 消息流来演示 Arranger 的决策过程

    console.log("\n--- Step 1: Planning ---");
    console.log("Arranger: 我需要调查 [Project X] 的财务状况。");
    console.log("Action: manage-todos(create, text='调查 2023 实际收入与 2024 预测')");

    console.log("\n--- Step 2: Delegation (Subagents at work) ---");
    // 模拟子代理 A 写入黑板
    console.log("Subagent_A: 发现 2023 年报事实：Revenue = $10B (Source: Annual_Report_2023.pdf)");
    // discoveryManager.addEvidence('gap_revenue', { sourceId: 'doc_2023', snippet: '10 billion' });

    // 模拟子代理 B 写入黑板
    console.log("Subagent_B: 发现 2024 预测：Revenue = $8B (Source: Market_Outlook_2024.pdf)");
    // discoveryManager.addEvidence('gap_revenue', { sourceId: 'doc_2024', snippet: '8 billion' });

    console.log("\n--- Step 3: Conflict Discovery (Resilience in action) ---");
    console.log("Arranger: 检测到 Gap [gap_revenue] 存在潜在矛盾 (10B vs 8B)。");

    // 模型调用 cross-verify
    console.log("Action: cross-verify(factId='gap_revenue', contradiction='同一项目在不同文档中金额不一致')");

    console.log("\n--- Step 4: Semantic Evaluation ---");
    // 模型调用 evaluate-gaps
    const evaluationResult = {
        status: DiscoveryStatus.CONTRADICTED,
        analysis: "2023 实际数据（10B）与 2024 展望数据（8B）存在时间轴上的偏差，并非简单的错误。",
        hint: "请在报告中明确区分'实际'与'预测'，并解释下滑原因。"
    };
    console.log(`Arranger Evaluation: ${evaluationResult.analysis}`);

    console.log("\n--- Step 5: Final Report (Solving Pattern 3-2) ---");
    console.log("Arranger: 生成结构化报告，包含风险提示和数据来源对比。");

    console.log("\n✅ Resilience demonstration completed.");
    console.log("Key failure modes addressed:");
    console.log("- 2-3 (Information Integration Failure): Resolved via Shared Blackboard conflict detection.");
    console.log("- 2-5 (Verification Mechanism Failure): Resolved via forced cross-verify skill.");
    console.log("- 3-2 (Structural Organization Dysfunction): Managed by the 'Arranger' role focusing on coherence.");
}

main().catch((error) => logger.error("main failed", { error }));
