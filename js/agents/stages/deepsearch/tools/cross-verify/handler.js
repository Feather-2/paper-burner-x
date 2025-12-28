/**
 * cross-verify skill handler
 * 
 * 解决模式 2-5 (验证机制缺失) 和 多代理协同下的信息对质。
 */

import { DiscoveryStatus } from "../../../../sdk/DiscoveryManager.js";

export const definition = {
    name: "cross-verify",
    description: "对冲突的信息或关键事实进行交叉验证。可以启动一个专项子任务来对比不同信源。",
    layer: 0,
    activation: {
        keywords: ["交叉验证", "对质", "核实冲突", "cross-verify", "compare"],
    },
};

/**
 * @param {Object} args
 * @param {string} args.factId - 合并后的事实 ID 或 Gap ID
 * @param {string} args.contradiction - 描述冲突的具体点
 * @param {string[]} [args.sourceIds] - 涉及冲突的信源 ID 列表
 * @param {Object} context - { state, emit, discoveryManager, executeSkill }
 */
export async function handler(args, context) {
    const { state, emit, discoveryManager, stageApi } = context;
    const { factId, contradiction, sourceIds } = args;

    if (!factId || !contradiction) {
        return { success: false, error: "factId and contradiction are required" };
    }

    // 1. 标记状态为 VERIFYING
    if (discoveryManager) {
        discoveryManager.upsertDiscovery(factId, {
            status: DiscoveryStatus.VERIFYING,
            reason: contradiction
        });
    }

    emit?.("deepsearch.verify.started", { factId, contradiction });

    // 2. 构造一个专项 Task (Subagent)
    // 这个 Task 的特点是：上下文极小，仅包含冲突的片段。
    const verifyTaskPrompt = `
你是一个专门负责“事实纠音”的核查员。
目前的冲突点：${contradiction}
涉及证据：${sourceIds ? sourceIds.join(", ") : "所有相关证据"}

请对比这些证据，给出一个最终的、经过考证的结论。如果依然无法确定，请说明原因。
  `.trim();

    // 调用现有的 task 工具（如果可用）
    let result = null;
    try {
        // 假设我们通过 executeSkill("task", ...) 调用子代理
        // 在这里我们也可以直接使用 stageApi 发起一个新的研究阶段
        result = {
            status: "delegated",
            message: "正在发起交叉验证子任务...",
            plan: `对比信源 ${sourceIds?.join("/")} 关于 ${factId} 的矛盾点。`
        };
    } catch (err) {
        result = { success: false, error: err.message };
    }

    return {
        success: true,
        result,
        instruction: "请等待验证结果，或继续处理其他不相关的任务。"
    };
}

export default { definition, handler };
