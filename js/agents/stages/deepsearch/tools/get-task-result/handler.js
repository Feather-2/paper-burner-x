/**
 * get-task-result skill handler - 读取子代理任务结果
 *
 * 支持：
 * - 检查任务状态
 * - 等待任务完成
 * - 获取完整结果
 */

import { getTaskStatus, waitForTask } from "../task/handler.js";

export const definition = {
  name: "get-task-result",
  description: "读取子代理任务的状态和结果。可以等待任务完成，或只检查当前状态。",
  priority: "important",
  parameters: {
    taskId: "Task 返回的任务 ID（必需）",
    wait: "是否等待任务完成（默认 false，只检查状态）",
    timeout: "等待超时时间（毫秒，默认 60000）",
  },
  layer: 0,
  activation: {
    keywords: ["task", "result", "结果", "子代理", "状态"],
    phases: ["researching", "analyzing"],
  },
};

const TERMINAL_STATUSES = new Set(["completed", "failed", "timeout", "cancelled", "aborted"]);

function normalizeTaskStatus(value) {
  if (typeof value !== "string") return "unknown";
  const normalized = value.trim().toLowerCase();
  return normalized || "unknown";
}

function isTaskDone(status) {
  return TERMINAL_STATUSES.has(normalizeTaskStatus(status));
}

function isTaskSuccessful(status) {
  return normalizeTaskStatus(status) === "completed";
}

/**
 * @param {Object} args
 * @param {string} args.taskId - Task 返回的结果 ID
 * @param {boolean} [args.wait=false] - 是否等待任务完成
 * @param {number} [args.timeout=60000] - 等待超时时间
 * @param {Object} context - { state, emit, sharedContext }
 */
export async function handler(args, context) {
  const ctx = context && typeof context === "object" ? context : {};
  const { sharedContext } = ctx;
  const params = args && typeof args === "object" ? args : {};
  const { taskId, wait = false, timeout = 60000 } = params;

  if (!taskId || typeof taskId !== "string") {
    return { success: false, error: "taskId is required" };
  }

  // 1. 先从任务注册表获取状态
  let task = getTaskStatus(taskId);

  // 2. 如果需要等待且任务正在运行
  if (wait && task?.status === "running") {
    task = await waitForTask(taskId, timeout);
  }

  // 3. 如果任务注册表有结果
  if (task) {
    // 如果 runningTasks 里是压缩结果，优先用 sharedContext 里的完整数据补全
    const detail = sharedContext?.getDetail?.(taskId);
    const merged = detail && typeof detail === "object" ? { ...task, ...detail } : task;
    const status = normalizeTaskStatus(merged.status);
    const done = isTaskDone(status);
    const taskSuccess = isTaskSuccessful(status);
    return {
      success: true,
      taskId,
      status,
      done,
      taskSuccess,
      summary: merged.summary,
      result: merged.result,
      error: merged.error,
      startedAt: merged.startedAt,
      completedAt: merged.completedAt,
    };
  }

  // 4. 尝试从 sharedContext 获取（可能是之前的任务）
  if (sharedContext) {
    const detail = sharedContext.getDetail?.(taskId);
    if (detail) {
      const status = normalizeTaskStatus(detail.status || "completed");
      const done = isTaskDone(status);
      const taskSuccess = isTaskSuccessful(status);
      return {
        success: true,
        taskId,
        status,
        done,
        taskSuccess,
        summary: detail.summary,
        result: detail.result,
        data: detail,
      };
    }
  }

  // 5. 列出可用的任务 ID
  const available = [];
  const storeKeys = sharedContext?.getStoreKeys?.();
  if (Array.isArray(storeKeys)) {
    for (const key of storeKeys) {
      if (typeof key === "string" && key.startsWith("task_")) {
        available.push(key);
      }
    }
  }

  return {
    success: false,
    error: `Task not found: ${taskId}`,
    available: available.length ? available : undefined,
    hint: "任务可能尚未启动或已过期",
  };
}

export default { definition, handler };
