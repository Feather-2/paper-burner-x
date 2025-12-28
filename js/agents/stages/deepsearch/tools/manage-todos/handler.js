/**
 * manage-todos skill handler
 */

import { createTodo, validateTodo } from "../../utils/todo-utils.js";
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
      const text = args.todo?.text || args.text;
      if (!text || typeof text !== "string" || !text.trim()) {
        return { success: false, error: "text is required for creating a todo" };
      }
      const todo = state.addTodo({
        text: text.trim(),
        priority: args.todo?.priority || args.priority || "medium",
        queryHints: args.todo?.queryHints || args.queryHints || [],
        status: TodoStatus.OPEN,
      });
      emit?.("deepsearch.todo.created", { todoId: todo.todoId, text: todo.text });
      return { success: true, todo };
    }

    case "update": {
      const todos = state.todos || [];
      const todo = todos.find(t => t.todoId === args.todoId);
      if (!todo) return { success: false, error: "Todo not found" };

      if (args.status) todo.status = args.status;
      if (args.text) todo.text = args.text;
      emit?.("deepsearch.todo.updated", { todoId: todo.todoId, status: todo.status });
      return { success: true, todo };
    }

    case "complete": {
      const todos = state.todos || [];
      const todo = todos.find(t => t.todoId === args.todoId);
      if (!todo) return { success: false, error: "Todo not found" };

      todo.status = TodoStatus.COMPLETED;
      emit?.("deepsearch.todo.completed", { todoId: todo.todoId });
      return { success: true, todo };
    }

    case "cancel": {
      const todos = state.todos || [];
      const todo = todos.find(t => t.todoId === args.todoId);
      if (!todo) return { success: false, error: "Todo not found" };

      todo.status = TodoStatus.CANCELLED;
      emit?.("deepsearch.todo.cancelled", { todoId: todo.todoId });
      return { success: true, todo };
    }

    case "list": {
      const todos = state.todos || [];
      return {
        success: true,
        todos: todos.map(t => ({
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
