/**
 * Task skill handler - 启动独立 SubAgent 处理子任务
 *
 * 支持两种模式：
 * - async: true (默认) - 异步启动，立即返回 taskId，主代理可继续工作
 * - async: false - 同步等待，阻塞直到子代理完成
 */

import { globalSubagentRegistry } from "../../../../sdk/SubagentRegistry.js";
// 确保子代理已注册
import "../../subagents.js";

// 运行中的任务注册表
const runningTasks = new Map();

export const definition = {
  name: "Task",
  description: "启动一个专项子代理来处理复杂的子任务。默认异步执行，主代理可继续工作。",
  priority: "important",
  parameters: {
    subagent_type: "子代理类型: researcher(快速研究,10轮) | analyzer(深度分析,15轮)",
    prompt: "任务描述（必需）",
    sourceIds: "要处理的文档ID列表（可选）",
    async: "是否异步执行（默认true）- true则立即返回taskId，false则等待完成",
  },
  layer: 1,
  activation: {
    keywords: ["子任务", "并行", "subagent", "task", "delegate"],
    phases: ["researching", "analyzing"],
  },
};

/**
 * @param {Object} args
 * @param {string} args.subagent_type - 子代理类型 (researcher, analyzer)
 * @param {string} args.prompt - 任务描述
 * @param {string[]} [args.sourceIds] - 要处理的文档 ID 列表
 * @param {boolean} [args.async=true] - 是否异步执行
 * @param {Object} context - { state, emit, stageApi, sharedContext }
 */
export async function handler(args, context) {
  const { state, emit, stageApi, sharedContext } = context;
  const { subagent_type = "researcher", prompt, sourceIds, async: isAsync = true } = args;

  if (!prompt) {
    return { success: false, error: "prompt is required" };
  }

  // 获取子代理工厂
  const factory = globalSubagentRegistry.getFactory(subagent_type);
  if (!factory) {
    const available = globalSubagentRegistry.getAvailableTypes().map(t => t.type).join(", ");
    return {
      success: false,
      error: `Unknown subagent type: ${subagent_type}. Available: ${available || "none"}`,
    };
  }

  // 准备文档子集
  const sources = Array.isArray(state?.L0?.sources) ? state.L0.sources : [];
  const targetSources = sourceIds?.length
    ? sources.filter(s => sourceIds.includes(s.sourceId))
    : sources;

  // 生成任务 ID
  const taskId = `task_${subagent_type}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  emit?.("deepsearch.subagent.started", { taskId, type: subagent_type, prompt, sourceCount: targetSources.length, async: isAsync });

  // 创建执行函数
  const executeTask = async () => {
    try {
      // 创建独立子代理实例
      const subagent = await factory({
        prompt,
        modelTier: subagent_type === "analyzer" ? "normal" : "fast",
        parentStageApi: stageApi,
        inheritedContext: {
          sharedContext,
          L0: { sources: targetSources },
        },
      });

      if (!subagent || typeof subagent.run !== "function") {
        throw new Error(`Factory for "${subagent_type}" did not return a valid agent`);
      }

      // 运行子代理
      const result = await subagent.run(
        { task: prompt, L0: { sources: targetSources } },
        { signal: stageApi?.signal, stageApi }
      );

      // 存储结果
      const taskResult = {
        taskId,
        type: subagent_type,
        prompt,
        status: "completed",
        result,
        summary: result?.summary || result?.report?.slice(0, 300) || "Completed",
        completedAt: Date.now(),
      };

      // 存储到 sharedContext
      if (sharedContext?.store) {
        sharedContext.store(taskId, taskResult);
        sharedContext.setSummary?.(taskId, taskResult.summary);
      }

      // 更新任务注册表
      runningTasks.set(taskId, taskResult);

      emit?.("deepsearch.subagent.completed", { taskId, type: subagent_type, ok: result?.ok !== false });

      return taskResult;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const taskResult = {
        taskId,
        type: subagent_type,
        prompt,
        status: "failed",
        error,
        completedAt: Date.now(),
      };

      runningTasks.set(taskId, taskResult);
      if (sharedContext?.store) {
        sharedContext.store(taskId, taskResult);
      }

      emit?.("deepsearch.subagent.failed", { taskId, type: subagent_type, error });

      return taskResult;
    }
  };

  if (isAsync) {
    // 异步模式：立即返回，后台执行
    const taskPromise = executeTask();
    runningTasks.set(taskId, {
      taskId,
      type: subagent_type,
      prompt,
      status: "running",
      promise: taskPromise,
      startedAt: Date.now(),
    });

    return {
      success: true,
      taskId,
      status: "running",
      message: `子代理 ${subagent_type} 已启动，使用 get-task-result 获取结果`,
      hint: "主代理可继续执行其他任务，稍后通过 get-task-result 获取结果",
    };
  } else {
    // 同步模式：等待完成
    const result = await executeTask();
    return {
      success: result.status === "completed",
      taskId,
      status: result.status,
      summary: result.summary,
      error: result.error,
    };
  }
}

/**
 * 获取任务状态（供 get-task-result 使用）
 */
export function getTaskStatus(taskId) {
  return runningTasks.get(taskId);
}

/**
 * 等待任务完成
 */
export async function waitForTask(taskId, timeout = 60000) {
  const task = runningTasks.get(taskId);
  if (!task) return null;

  if (task.status !== "running") {
    return task;
  }

  if (task.promise) {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Task timeout")), timeout)
    );
    try {
      return await Promise.race([task.promise, timeoutPromise]);
    } catch (err) {
      return { ...task, status: "timeout", error: err.message };
    }
  }

  return task;
}

export default { definition, handler, getTaskStatus, waitForTask };
