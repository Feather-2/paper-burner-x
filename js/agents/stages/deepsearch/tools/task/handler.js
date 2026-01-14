/**
 * Task skill handler - 启动独立 SubAgent 处理子任务
 *
 * 支持两种模式：
 * - async: true (默认) - 异步启动，立即返回 taskId，主代理可继续工作
 * - async: false - 同步等待，阻塞直到子代理完成
 */

import { globalSubagentRegistry } from "../../../../sdk/SubagentRegistry.js";
import { DisposableBase } from "../../../../shared/base/disposable-base.js";

// 延迟注册子代理，避免循环依赖
let _subagentsRegistered = false;
async function ensureSubagentsRegistered() {
  if (_subagentsRegistered) return;
  _subagentsRegistered = true;
  try {
    await import("../../subagents.js");
  } catch (e) {
    console.warn("[task/handler] subagents registration failed:", e);
  }
}
import SourceManager from "../../source-manager.js";
import { makeSecureTimestampedId } from "../../../../shared/utils/secure-id.js";
import { toPositiveInt } from "../../../../shared/utils/value-utils.js";

// 运行中的任务注册表（含已完成任务的短暂缓存）
/** @type {any} */
const nodeProcess = /** @type {any} */ (globalThis).process;
const env = nodeProcess?.env || {};
const MAX_RUNNING_TASKS = toPositiveInt(env.DEEPSEARCH_MAX_RUNNING_TASKS, 50);
const COMPLETED_TASK_TTL_MS = toPositiveInt(env.DEEPSEARCH_TASK_TTL_MS, 30 * 60 * 1000);
const CLEANUP_INTERVAL_MS = toPositiveInt(env.DEEPSEARCH_TASK_CLEANUP_INTERVAL_MS, 5 * 60 * 1000);
const RESULT_PREVIEW_CHARS = toPositiveInt(env.DEEPSEARCH_TASK_RESULT_PREVIEW_CHARS, 2000);

// ─────────────────────────────────────────────────────────────────────────────
// TaskManager Class - 替代模块级全局状态，支持 dispose
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 任务管理器 - 管理运行中的任务和定时清理
 * @extends DisposableBase
 */
class TaskManager extends DisposableBase {
  constructor() {
    super();
    /** @type {Map<string, any>} */
    this._runningTasks = new Map();
    /** @type {ReturnType<typeof setInterval> | null} */
    this._timer = null;

    // 启动定时清理
    if (typeof setInterval === "function" && CLEANUP_INTERVAL_MS > 0) {
      this._timer = setInterval(() => this._prune(), CLEANUP_INTERVAL_MS);
      /** @type {any} */ (this._timer).unref?.();
      this._registerDisposable(() => {
        if (this._timer) clearInterval(this._timer);
      });
    }
  }

  get size() {
    return this._runningTasks.size;
  }

  get(taskId) {
    return this._runningTasks.get(taskId);
  }

  set(taskId, task) {
    this._runningTasks.set(taskId, task);
  }

  _prune(options = {}) {
    const now = options.now ?? Date.now();
    // TTL: 清理已完成/失败任务
    for (const [taskId, task] of this._runningTasks) {
      if (!task || task.status === "running") continue;
      const expiresAt = Number(task.expiresAt);
      if (!Number.isNaN(expiresAt) && expiresAt < now) {
        this._runningTasks.delete(taskId);
      }
    }
    // Capacity: 超过上限时移除最老的已完成任务
    while (this._runningTasks.size > MAX_RUNNING_TASKS * 2) {
      let oldest = null;
      let oldestId = null;
      for (const [taskId, task] of this._runningTasks) {
        if (task.status === "running") continue;
        if (!oldest || task.completedAt < oldest.completedAt) {
          oldest = task;
          oldestId = taskId;
        }
      }
      if (oldestId) {
        this._runningTasks.delete(oldestId);
      } else {
        break;
      }
    }
  }

  prune(options) {
    this._prune(options);
  }
}

// Singleton with lazy init
/** @type {TaskManager | null} */
let _taskManager = null;

/**
 * 获取 TaskManager 单例（懒加载）
 * @returns {TaskManager}
 */
export function getTaskManager() {
  if (!_taskManager) {
    _taskManager = new TaskManager();
  }
  return _taskManager;
}

/**
 * 重置 TaskManager（测试/HMR 时使用）
 * @returns {Promise<void>}
 */
export async function resetTaskManager() {
  if (_taskManager) {
    await _taskManager.dispose();
    _taskManager = null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Legacy pruneRunningTasks - 委托给 TaskManager
// ─────────────────────────────────────────────────────────────────────────────

function pruneRunningTasks(options) {
  getTaskManager().prune(options);
}

function canAcceptNewTask() {
  const mgr = getTaskManager();
  if (mgr.size >= MAX_RUNNING_TASKS) {
    return {
      ok: false,
      error: `Too many running tasks (${mgr.size}/${MAX_RUNNING_TASKS}). Try again later.`,
    };
  }
  return { ok: true };
}

function compactResult(result) {
  if (!result || typeof result !== "object") return result;

  const out = {};
  if ("ok" in result) out.ok = result.ok;
  if (typeof result.summary === "string") out.summary = result.summary;

  if (typeof result.report === "string") {
    out.reportPreview = result.report.slice(0, RESULT_PREVIEW_CHARS);
  }
  if (typeof result.analysis === "string") {
    out.analysisPreview = result.analysis.slice(0, RESULT_PREVIEW_CHARS);
  }
  if (typeof result.findings === "string") {
    out.findingsPreview = result.findings.slice(0, RESULT_PREVIEW_CHARS);
  }
  if (Array.isArray(result.findings)) {
    out.findingsCount = result.findings.length;
  }

  return out;
}

function compactTaskRecord(task) {
  return {
    taskId: task.taskId,
    type: task.type,
    prompt: task.prompt,
    status: task.status,
    summary: task.summary,
    error: task.error,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    expiresAt: task.expiresAt,
    result: task.status === "completed" ? compactResult(task.result) : undefined,
    compacted: task.status === "completed",
  };
}

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
  // 确保子代理已注册（延迟加载，避免循环依赖）
  await ensureSubagentsRegistered();

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

  const manager = context?.sourceManager instanceof SourceManager ? context.sourceManager : new SourceManager(state?.L0?.sources || []);
  manager.syncSources(state?.L0?.sources);

  const targetSources = Array.isArray(sourceIds) && sourceIds.length
    ? sourceIds.map((id) => manager.getSource(id)).filter(Boolean)
    : Array.isArray(state?.L0?.sources)
      ? state.L0.sources
      : [];

  const reservation = reserveRunningTaskSlot();
  if (!reservation.ok) {
    return {
      success: false,
      error: reservation.error,
      hint: "任务过多时会拒绝新任务，请稍后重试或调高 DEEPSEARCH_MAX_RUNNING_TASKS",
    };
  }

  // 生成任务 ID
  const taskId = makeSecureTimestampedId(`task_${subagent_type}`);
  const startedAt = Date.now();

  emit?.("deepsearch.subagent.started", { taskId, type: subagent_type, prompt, sourceCount: targetSources.length, async: isAsync });

  // 创建执行函数
  const executeTask = async () => {
    try {
      // 创建独立子代理实例
      const subagent = await factory({
        taskId,
        prompt,
        modelTier: subagent_type === "analyzer" ? "normal" : "fast",
        parentStageApi: stageApi,
        inheritedContext: {
          taskId,
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
        { signal: stageApi?.signal, stageApi, taskId }
      );

      // 存储结果
      const completedAt = Date.now();
      const taskResult = {
        taskId,
        type: subagent_type,
        prompt,
        status: "completed",
        result,
        summary: result?.summary || result?.report?.slice(0, 300) || "Completed",
        startedAt,
        completedAt,
        expiresAt: completedAt + COMPLETED_TASK_TTL_MS,
      };

      // 存储到 sharedContext
      if (sharedContext?.store) {
        sharedContext.store(taskId, taskResult);
        sharedContext.setSummary?.(taskId, taskResult.summary);
      }

      // 更新任务注册表
      getTaskManager().set(taskId, compactTaskRecord(taskResult));
      pruneRunningTasks({ now: completedAt });

      emit?.("deepsearch.subagent.completed", { taskId, type: subagent_type, ok: result?.ok !== false });

      return taskResult;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const completedAt = Date.now();
      const taskResult = {
        taskId,
        type: subagent_type,
        prompt,
        status: "failed",
        error,
        startedAt,
        completedAt,
        expiresAt: completedAt + COMPLETED_TASK_TTL_MS,
      };

      getTaskManager().set(taskId, compactTaskRecord(taskResult));
      pruneRunningTasks({ now: completedAt });
      if (sharedContext?.store) {
        sharedContext.store(taskId, taskResult);
      }

      emit?.("deepsearch.subagent.failed", { taskId, type: subagent_type, error });

      return taskResult;
    }
  };

  const taskPromise = executeTask();
  getTaskManager().set(taskId, {
    taskId,
    type: subagent_type,
    prompt,
    status: "running",
    promise: taskPromise,
    startedAt,
  });

  if (isAsync) {
    // 异步模式：立即返回，后台执行
    return {
      success: true,
      taskId,
      status: "running",
      message: `子代理 ${subagent_type} 已启动，使用 get-task-result 获取结果`,
      hint: "主代理可继续执行其他任务，稍后通过 get-task-result 获取结果",
    };
  } else {
    // 同步模式：等待完成
    const result = await taskPromise;
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
  pruneRunningTasks();
  return getTaskManager().get(taskId);
}

/**
 * 等待任务完成
 */
export async function waitForTask(taskId, timeout = 60000) {
  pruneRunningTasks();
  const task = getTaskManager().get(taskId);
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

export default { definition, handler, getTaskStatus, waitForTask, getTaskManager, resetTaskManager };
