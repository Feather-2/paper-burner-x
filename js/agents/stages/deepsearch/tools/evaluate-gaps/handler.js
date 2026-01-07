/**
 * evaluate-gaps skill handler
 * 
 * 解决模式 1-2 (分析深度不足) 和 2-3 (信息整合失败)
 */

import { DiscoveryStatus } from "../../../../sdk/DiscoveryManager.js";
import { GapStatus } from "../../states.js";

function mapDiscoveryStatusToGapStatus(status) {
    if (status === DiscoveryStatus.SATISFIED) return GapStatus.FILLED;
    if (status === DiscoveryStatus.BLOCKED) return GapStatus.BLOCKED;
    return GapStatus.OPEN;
}

export const definition = {
    name: "evaluate-gaps",
    description: "评估信息缺口 (Gap) 的满足程度。通过阅读已发现的证据，决定是完成任务、继续挖掘还是标记冲突。",
    layer: 0,
    activation: {
        keywords: ["评估", "核实", "check", "verify", "status"],
        phases: ["executing"],
    },
};

/**
 * @param {Object} args
 * @param {string} args.gapId - 缺口 ID
 * @param {string} args.status - "satisfied" | "partial" | "contradicted" | "blocked"
 * @param {string} args.analysis - 评估理由（为什么得出此状态）
 * @param {string} [args.hint] - 针对下一步的提示
 * @param {Object} context - { state, emit, discoveryManager }
 */
export async function handler(args, context) {
    const { state, emit, discoveryManager } = context;
    const { gapId, status, analysis, hint } = args;

    if (!gapId) return { success: false, error: "gapId is required" };
    if (!status || !Object.values(DiscoveryStatus).includes(/** @type {any} */ (status))) {
        return { success: false, error: "Invalid status" };
    }

    // 1. 获取当前缺口
    const gap = state.L1?.gaps?.find(g => g.gapId === gapId);
    if (!gap) return { success: false, error: "Gap not found" };

    // 2. 获取相关证据
    const evidences = discoveryManager ? discoveryManager.getEvidences(gapId) : [];

    // 3. 更新状态
    const gapStatus = mapDiscoveryStatusToGapStatus(status);
    gap.status = gapStatus;
    gap.evaluation = {
        discoveryStatus: status,
        gapStatus,
        analysis,
        evidenceIds: evidences.map(e => e.id),
        updatedAt: new Date().toISOString()
    };

    // 如果状态是 satisfied，同步更新 todo 状态
    if (status === DiscoveryStatus.SATISFIED && state.todos) {
        const todo = state.todos.find(t => t.relatedGapId === gapId);
        if (todo) {
            if (typeof state?.updateTodo === "function") state.updateTodo(todo.todoId || todo.id, { status: "completed" });
            else todo.status = "completed";
        }
    }

    // 4. 同步到 DiscoveryManager (黑板)
    if (discoveryManager) {
        discoveryManager.upsertDiscovery(gapId, {
            status,
            analysis: analysis?.slice(0, 100),
            hint
        });
    }

    emit?.("deepsearch.gap.evaluated", { gapId, status, gapStatus, analysis });

    return {
        success: true,
        gapId,
        discoveryStatus: status,
        newStatus: gapStatus,
        evidenceCount: evidences.length,
        message: `Gap ${gapId} evaluated as ${status} (${gapStatus}).`
    };
}

export default { definition, handler };
