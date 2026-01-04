/**
 * refine-planning skill handler
 * 
 * 解决模式 1-4 (规划策略僵化)
 */

import { createTodo, transitionTodoStatus, validateTodo } from "../../utils/todo-utils.js";
import { TodoStatus } from "../../states.js";

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
    const { state, emit } = context;
    const { actions, reason } = args;

    if (!Array.isArray(actions) || actions.length === 0) {
        return { success: false, error: "actions list is required" };
    }

    state.todos = Array.isArray(state.todos) ? state.todos : [];
    const results = [];

    for (const action of actions) {
        const type = String(action?.type || "").toLowerCase();
        switch (type) {
            case "create": {
                const text = action?.text ?? action?.content ?? action?.title;
                if (!text || typeof text !== "string" || !text.trim()) {
                    results.push({ action: "create_failed", error: "text is required", raw: action });
                    break;
                }

                const draft = createTodo({
                    ...(action && typeof action === "object" ? action : {}),
                    todoId: action?.todoId,
                    text: text.trim(),
                    status: action?.status ?? TodoStatus.OPEN,
                    relatedGapId: action?.relatedGapId || undefined,
                    source: action?.source ?? "llm",
                });

                const { valid, issues } = validateTodo(draft);
                if (!valid) {
                    results.push({ action: "create_failed", todoId: draft.todoId, issues });
                    break;
                }

                const created = typeof state?.addTodo === "function" ? state.addTodo(draft) : (state.todos.push(draft), draft);
                results.push({ action: "created", todoId: created.todoId });
                emit?.("deepsearch.todo.created", { todoId: created.todoId, text: created.text });
                break;
            }
            case "update": {
                const todoId = action?.todoId;
                if (!todoId) {
                    results.push({ action: "update_failed", error: "todoId is required", raw: action });
                    break;
                }

                const todo = state.todos.find((t) => t?.todoId === todoId);
                if (!todo) {
                    results.push({ action: "update_skipped", todoId, error: "Todo not found" });
                    break;
                }

                const nextText = action?.text;
                const nextStatus = action?.status;
                let updatedTodo = todo;
                if (typeof state?.updateTodo === "function") {
                    const updates = {};
                    if (typeof nextText === "string" && nextText.trim()) updates.text = nextText.trim();
                    if (typeof nextStatus === "string" && nextStatus.trim()) updates.status = nextStatus.trim();
                    if (Object.keys(updates).length) updatedTodo = state.updateTodo(todoId, updates, emit) || todo;
                } else {
                    if (typeof nextText === "string" && nextText.trim()) {
                        todo.text = nextText.trim();
                        todo.updatedAt = new Date().toISOString();
                    }

                    if (typeof nextStatus === "string" && nextStatus.trim()) {
                        transitionTodoStatus(todo, nextStatus, emit);
                    }
                }

                const { valid, issues } = validateTodo(updatedTodo);
                if (!valid) {
                    results.push({ action: "update_failed", todoId, issues });
                    break;
                }

                results.push({ action: "updated", todoId });
                emit?.("deepsearch.todo.updated", { todoId: updatedTodo.todoId, status: updatedTodo.status, ...(updatedTodo.text ? { text: updatedTodo.text } : {}) });
                break;
            }
            case "delete": {
                const todoId = action?.todoId;
                if (!todoId) {
                    results.push({ action: "delete_failed", error: "todoId is required", raw: action });
                    break;
                }

                if (typeof state?.removeTodo === "function") {
                    const removed = state.removeTodo(todoId);
                    if (removed) results.push({ action: "deleted", todoId });
                } else {
                    const initialLen = state.todos.length;
                    state.todos = state.todos.filter((t) => t?.todoId !== todoId);
                    if (state.todos.length < initialLen) results.push({ action: "deleted", todoId });
                }
                break;
            }
            default: {
                results.push({ action: "skipped", error: `Unknown action type: ${type}`, raw: action });
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
