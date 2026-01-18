/**
 * advise-task skill handler - 主代理给子代理发送建议
 *
 * 通过 SharedContext 的信号机制实现主代理和子代理的协作：
 * - 主代理可以发送建议、指令、优先级调整
 * - 子代理在每轮迭代时检查来自主代理的信号
 */

import { getTaskStatus } from "../task/handler.js";

export const definition = {
  name: "advise-task",
  description: "给运行中的子代理发送建议或指令。子代理会在下一轮迭代时收到并处理。",
  priority: "important",
  parameters: {
    taskId: "目标任务 ID（必需）",
    advice: "建议内容（必需）- 子代理会在下一轮看到",
    priority: "建议优先级: high | normal | low（默认 normal）",
    type: "建议类型: hint | redirect | stop（默认 hint）",
  },
  layer: 0,
  activation: {
    keywords: ["建议", "指导", "advise", "hint", "子代理"],
    phases: ["researching", "analyzing"],
  },
};

/**
 * @param {Object} args
 * @param {string} args.taskId - 目标任务 ID
 * @param {string} args.advice - 建议内容
 * @param {string} [args.priority="normal"] - 建议优先级
 * @param {string} [args.type="hint"] - 建议类型
 * @param {Object} context - { state, emit, sharedContext }
 */
export async function handler(args, context) {
  const { sharedContext, emit } = context;
  const { taskId, advice, priority = "normal", type = "hint" } = args;

  if (!taskId) {
    return { success: false, error: "taskId is required" };
  }

  if (!advice) {
    return { success: false, error: "advice is required" };
  }

  // 检查任务是否存在
  const task = getTaskStatus(taskId);
  if (!task) {
    return {
      success: false,
      error: `Task not found: ${taskId}`,
      hint: "任务可能尚未启动或已完成",
    };
  }

  if (task.status !== "running") {
    return {
      success: false,
      error: `Task ${taskId} is not running (status: ${task.status})`,
      hint: "只能给运行中的任务发送建议",
    };
  }

  // 通过 SharedContext 发送信号
  if (!sharedContext) {
    return { success: false, error: "sharedContext not available" };
  }

  const signal = sharedContext.signal("advice", {
    type: "advice",
    targetTaskId: taskId,
    adviceType: type,
    priority,
    message: advice,
    from: "main_agent",
    ts: Date.now(),
  });

  emit?.("deepsearch:advice_sent", { taskId, advice, priority, type });

  return {
    success: true,
    taskId,
    signalId: signal.id,
    message: `建议已发送给任务 ${taskId}`,
    adviceType: type,
    priority,
    hint: type === "stop" ? "子代理将在下一轮停止" : "子代理将在下一轮收到建议",
  };
}

export default { definition, handler };
