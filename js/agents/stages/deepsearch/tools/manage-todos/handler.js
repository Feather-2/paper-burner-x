/**
 * manage-todos skill handler
 */

import { createTodo, transitionTodoStatus, validateTodo } from "../../utils/todo-utils.js";
import { TodoStatus } from "../../states.js";

export const definition = {
  name: "manage-todos",
  description: "管理研究任务列表。用于创建、更新、完成任务，进行任务分解。",
  layer: 0, // Native
  activation: {
    keywords: ["任务", "todo", "计划", "规划", "分解"],
    phases: ["planning", "executing"],
  },
};

/**
 * @param {Object} args
 * @param {string} args.action - create | update | complete | cancel | list
 * @param {Object} [args.todo] - 任务数据
 * @param {string} [args.todoId] - 任务 ID
 * @param {Object} context - { state, emit }
 */
export async function handler(args, context) {
  const { state, emit } = context;
  const { action } = args;

  switch (action) {
    case "create": {
      const text = args.todo?.text ?? args.text ?? args.todo?.content ?? args.content ?? args.todo?.title ?? args.title;
      if (!text || typeof text !== "string" || !text.trim()) {
        return { success: false, error: "text is required for creating a todo" };
      }

      const draft = createTodo({
        ...(args.todo && typeof args.todo === "object" ? args.todo : {}),
        todoId: args.todoId ?? args.todo?.todoId ?? args.todo?.id,
        text: text.trim(),
        priority: args.todo?.priority ?? args.priority ?? "medium",
        queryHints: args.todo?.queryHints ?? args.queryHints ?? [],
        status: args.todo?.status ?? args.status ?? TodoStatus.OPEN,
        source: args.todo?.source ?? "user",
      });
      const { valid, issues } = validateTodo(draft);
      if (!valid) return { success: false, error: issues.join("; "), issues };

      const todo =
        typeof state?.addTodo === "function"
          ? state.addTodo(draft)
          : (state.todos = Array.isArray(state.todos) ? state.todos : [], state.todos.push(draft), draft);
      emit?.("deepsearch.todo.created", { todoId: todo.todoId, text: todo.text });
      return { success: true, todo };
    }

    case "update": {
      const todoId = args.todoId ?? args.todo?.todoId ?? args.todo?.id;
      if (!todoId) return { success: false, error: "todoId is required" };

      const todos = state.todos || [];
      const todo = todos.find((t) => t.todoId === todoId);
      if (!todo) return { success: false, error: "Todo not found" };

      const nextText = args.text ?? args.todo?.text;
      const nextStatus = args.status ?? args.todo?.status;

      if (typeof state?.updateTodo === "function") {
        const updates = {};
        if (typeof nextText === "string" && nextText.trim()) updates.text = nextText.trim();
        if (typeof nextStatus === "string" && nextStatus.trim()) updates.status = nextStatus.trim();
        const updated = Object.keys(updates).length ? state.updateTodo(todoId, updates, emit) : todo;
        if (!updated) return { success: false, error: "Todo not found" };

        const { valid, issues } = validateTodo(updated);
        if (!valid) return { success: false, error: issues.join("; "), issues };

        emit?.("deepsearch.todo.updated", {
          todoId: updated.todoId,
          status: updated.status,
          ...(updated.text ? { text: updated.text } : {}),
        });
        return { success: true, todo: updated };
      }

      if (typeof nextText === "string" && nextText.trim()) {
        todo.text = nextText.trim();
        todo.updatedAt = new Date().toISOString();
      }

      if (typeof nextStatus === "string" && nextStatus.trim()) {
        transitionTodoStatus(todo, nextStatus, emit);
      }

      const { valid, issues } = validateTodo(todo);
      if (!valid) return { success: false, error: issues.join("; "), issues };

      emit?.("deepsearch.todo.updated", { todoId: todo.todoId, status: todo.status, ...(todo.text ? { text: todo.text } : {}) });
      return { success: true, todo };
    }

    case "complete": {
      const todos = state.todos || [];
      const todo = todos.find((t) => t.todoId === args.todoId);
      if (!todo) return { success: false, error: "Todo not found" };

      const updated = typeof state?.updateTodo === "function" ? state.updateTodo(todo.todoId, { status: TodoStatus.COMPLETED }, emit) : null;
      if (!updated) transitionTodoStatus(todo, TodoStatus.COMPLETED, emit);
      emit?.("deepsearch.todo.completed", { todoId: todo.todoId });
      return { success: true, todo: updated || todo };
    }

    case "cancel": {
      const todos = state.todos || [];
      const todo = todos.find((t) => t.todoId === args.todoId);
      if (!todo) return { success: false, error: "Todo not found" };

      const updated = typeof state?.updateTodo === "function" ? state.updateTodo(todo.todoId, { status: TodoStatus.CANCELLED }, emit) : null;
      if (!updated) transitionTodoStatus(todo, TodoStatus.CANCELLED, emit);
      emit?.("deepsearch.todo.cancelled", { todoId: todo.todoId });
      return { success: true, todo: updated || todo };
    }

    case "list": {
      const todos = state.todos || [];
      return {
        success: true,
        todos: todos.map((t) => ({
          todoId: t.todoId,
          text: t.text,
          status: t.status,
          priority: t.priority,
        })),
      };
    }

    default:
      return { success: false, error: `Unknown action: ${action}` };
  }
}

export default { definition, handler };
