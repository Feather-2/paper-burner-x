/**
 * Backtrack 工具 - 春秋蝉
 *
 * 允许模型在发现错误、死胡同或需要尝试不同路径时，主动回溯到之前的 Checkpoint。
 */

import { normalizeToolResult } from "../../shared/contracts/index.js";

/**
 * @typedef {object} BacktrackManager
 * @property {Function} [getCheckpoints]
 * @property {Function} [rollback]
 * @property {Function} [prepareBacktrack]
 */

/**
 * 创建 Backtrack 工具 Handler
 * @param {Object} options
 * @param {BacktrackManager} options.backtrackManager - 回溯管理器
 * @returns {Function}
 */
export function createBacktrackTool({ backtrackManager }) {
    if (!backtrackManager) {
        throw new Error("BacktrackTool requires a BacktrackManager instance");
    }

    /**
     * Backtrack 工具实现
     * @param {Object} args
     * @param {string} args.reason - 为什么要回溯
     * @param {string} [args.checkpoint_id] - 可选的特定回溯点 ID
     * @param {string} [args.hint] - 给“未来的自己”的建议/修正提示
     */
    return async function backtrackHandler(args, context) {
        const { reason, checkpoint_id, hint } = args;
        const { logger, emit } = context;

        logger.warn(`模型请求回溯: ${reason}`, { checkpoint_id, hint });

        const result = await backtrackManager.prepareBacktrack(checkpoint_id);

        if (!result.success) {
            return { ok: false, error: `Backtrack failed: ${result.reason}` };
        }

        // 这是一个特殊的信号，由 AgentLoop 捕获以便执行真正的状态还原
        const signal = {
            ok: true,
            backtrack: {
                checkpointId: result.checkpointId,
                state: result.state,
                reason,
                hint
            }
        };

        emit("agent.backtrack_requested", signal.backtrack);

        return signal;
    };
}

/**
 * Backtrack 工具定义 (JSON Schema)
 */
export const BACKTRACK_TOOL_DEFINITION = {
    name: "Backtrack",
    description: "Rewind the agent state to a previous checkpoint. Use this as a 'Spring Autumn Cicada' to try a different path when you realize the current one is wrong, stuck, or suboptimal.",
    parameters: {
        type: "object",
        properties: {
            reason: {
                type: "string",
                description: "The reason for backtracking (helps avoid making the same mistake again).",
            },
            checkpoint_id: {
                type: "string",
                description: "Optional: Specific checkpoint ID to return to. If not provided, it goes back to the last stable state.",
            },
            hint: {
                type: "string",
                description: "Optional: Note to yourself to guide the next attempt from the restored state.",
            },
        },
        required: ["reason"],
    },
};
