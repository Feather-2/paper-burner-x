/**
 * refine-planning skill handler
 * 
 * 解决模式 1-4 (规划策略僵化)
 */

import { DiscoveryStatus } from "../../../../sdk/DiscoveryManager.js";

export const definition = {
    name: "refine-planning",
    description: "当当前的研究计划无法推行（例如找不到信息）时，通过修改 Todo 列表或 Gap 定义来重排兵布阵。",
    layer: 0,
    activation: {
        keywords: ["修改计划", "调整目标", "refine", "planning", "replan"],
    },
};

/**
 * @param {Object} args
 * @param {Object[]} args.actions - [{ type: 'create'|'update'|'delete', todoId?, text?, relatedGapId? }]
 * @param {string} args.reason - 调整的原因
 * @param {Object} context - { state, emit, discoveryManager }
 */
export async function handler(args, context) {
    const { state, emit, discoveryManager } = context;
    const { actions, reason } = args;

    if (!Array.isArray(actions) || actions.length === 0) {
        return { success: false, error: "actions list is required" };
    }

    const results = [];

    for (const action of actions) {
        switch (action.type) {
            case "create": {
                const newTodo = {
                    id: `todo_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
                    text: action.text,
                    status: "open",
                    relatedGapId: action.relatedGapId || `gap_${Date.now()}`
                };
                state.todos = state.todos || [];
                state.todos.push(newTodo);
                results.push({ action: "created", id: newTodo.id });
                break;
            }
            case "update": {
                const todo = state.todos?.find(t => t.id === action.todoId);
                if (todo) {
                    if (action.text) todo.text = action.text;
                    if (action.status) todo.status = action.status;
                    results.push({ action: "updated", id: action.todoId });
                }
                break;
            }
            case "delete": {
                const initialLen = state.todos?.length || 0;
                state.todos = state.todos?.filter(t => t.id !== action.todoId);
                if (state.todos?.length < initialLen) {
                    results.push({ action: "deleted", id: action.todoId });
                }
                break;
            }
        }
    }

    emit?.("deepsearch.planning.refined", { reason, actions: results });

    return {
        success: true,
        reason,
        results,
        message: `Research plan refined for ${results.length} items.`
    };
}

export default { definition, handler };
