/**
 * Task skill handler - 启动独立 SubAgent 处理子任务
 *
 * 支持两种模式：
 * - async: true (默认) - 异步启动，立即返回 taskId，主代理可继续工作
 * - async: false - 同步等待，阻塞直到子代理完成
 */

import { globalSubagentRegistry } from "../../../../sdk/SubagentRegistry.js";
import { DisposableBase } from "../../../../shared/base/disposable-base.js";
import { createLogger } from "../../../../shared/utils/logger.js";

const logger = createLogger("deepsearch/tools/task");

// 延迟注册子代理，避免循环依赖
let _subagentsRegistered = false;
async function ensureSubagentsRegistered() {
  if (_subagentsRegistered) return;
  _subagentsRegistered = true;
  try {
    await import("../../subagents.js");
  } catch (e) {
    logger.warn("subagents registration failed", { error: e?.message || String(e) });
  }
}
import SourceManager from "../../source-manager.js";
import { makeSecureTimestampedId } from "../../../../shared/utils/secure-id.js";
import { toPositiveInt } from "../../../../shared/utils/value-utils.js";

// ─────────────────────────────────────────────────────────────────────────────
// Type Definitions (替代 any)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {'researcher' | 'analyzer'} SubagentType
 */

/**
 * @typedef {'running' | 'completed' | 'failed' | 'timeout'} TaskStatus
 */

/**
 * @typedef {Object} TaskRecord
 * @property {string} taskId - 任务唯一标识
 * @property {SubagentType} type - 子代理类型
 * @property {string} prompt - 任务描述
 * @property {TaskStatus} status - 任务状态
 * @property {string} [summary] - 结果摘要
 * @property {string} [error] - 错误信息
 * @property {number} startedAt - 启动时间戳
 * @property {number} [completedAt] - 完成时间戳
 * @property {number} [expiresAt] - 过期时间戳
 * @property {Promise<TaskRecord>} [promise] - 任务 Promise（仅运行中）
 * @property {TaskResult} [result] - 压缩后的结果预览
 * @property {boolean} [compacted] - 是否已压缩
 */

/**
 * @typedef {Object} TaskResult
 * @property {boolean} [ok] - 是否成功
 * @property {string} [summary] - 摘要
 * @property {string} [reportPreview] - 报告预览
 * @property {string} [analysisPreview] - 分析预览
 * @property {string} [findingsPreview] - 发现预览
 * @property {number} [findingsCount] - 发现数量
 */

/**
 * 允许的子代理类型白名单
 * @type {Set<SubagentType>}
 */
const ALLOWED_SUBAGENT_TYPES = new Set(['researcher', 'analyzer']);

/** 最大 prompt 长度 */
const MAX_PROMPT_LENGTH = 50000;

/** 默认子任务超时时间 (5 分钟) */
const DEFAULT_TASK_TIMEOUT_MS = 5 * 60 * 1000;

// 运行中的任务注册表（含已完成任务的短暂缓存）
// Default configuration values (can be overridden via stageApi.env)
const DEFAULT_MAX_RUNNING_TASKS = 50;
const DEFAULT_COMPLETED_TASK_TTL_MS = 30 * 60 * 1000;
const DEFAULT_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_RESULT_PREVIEW_CHARS = 2000;

/**
 * Resolve task configuration from stageApi or use defaults.
 * Supports browser environments without Node.js process.env.
 * @param {object} [stageApi]
 * @returns {{ maxRunningTasks: number, completedTaskTtlMs: number, cleanupIntervalMs: number, resultPreviewChars: number }}
 */
function resolveTaskConfig(stageApi) {
  const env = stageApi?.env || {};
  return {
    maxRunningTasks: toPositiveInt(env.DEEPSEARCH_MAX_RUNNING_TASKS, DEFAULT_MAX_RUNNING_TASKS),
    completedTaskTtlMs: toPositiveInt(env.DEEPSEARCH_TASK_TTL_MS, DEFAULT_COMPLETED_TASK_TTL_MS),
    cleanupIntervalMs: toPositiveInt(env.DEEPSEARCH_TASK_CLEANUP_INTERVAL_MS, DEFAULT_CLEANUP_INTERVAL_MS),
    resultPreviewChars: toPositiveInt(env.DEEPSEARCH_TASK_RESULT_PREVIEW_CHARS, DEFAULT_RESULT_PREVIEW_CHARS),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TaskManager Class - 替代模块级全局状态，支持 dispose
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 任务管理器 - 管理运行中的任务和定时清理
 * @extends DisposableBase
 */
class TaskManager extends DisposableBase {
  /**
   * @param {{ maxRunningTasks?: number, cleanupIntervalMs?: number }} [config]
   */
  constructor(config = {}) {
    super();
    /** @type {Map<string, TaskRecord>} */
    this._runningTasks = new Map();
    /** @type {ReturnType<typeof setInterval> | null} */
    this._timer = null;
    this._maxRunningTasks = toPositiveInt(config.maxRunningTasks, DEFAULT_MAX_RUNNING_TASKS);
    const cleanupInterval = toPositiveInt(config.cleanupIntervalMs, DEFAULT_CLEANUP_INTERVAL_MS);

    // 启动定时清理
    if (typeof setInterval === "function" && cleanupInterval > 0) {
      this._timer = setInterval(() => this._prune(), cleanupInterval);
      /** @type {any} */ (this._timer).unref?.();
      this._registerDisposable(() => {
        if (this._timer) clearInterval(this._timer);
      });
    }
  }

  get size() {
    return this._runningTasks.size;
  }

  get runningCount() {
    let count = 0;
    for (const task of this._runningTasks.values()) {
      if (task?.status === "running") count += 1;
    }
    return count;
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
    while (this._runningTasks.size > this._maxRunningTasks * 2) {
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

/**
 * @param {{ maxRunningTasks?: number }} [config]
 */
function canAcceptNewTask(config = {}) {
  const mgr = getTaskManager();
  const maxTasks = toPositiveInt(config.maxRunningTasks, DEFAULT_MAX_RUNNING_TASKS);
  if (mgr.runningCount >= maxTasks) {
    return {
      ok: false,
      error: `Too many running tasks (${mgr.runningCount}/${maxTasks}). Try again later.`,
    };
  }
  return { ok: true };
}

/**
 * @param {{ maxRunningTasks?: number }} [config]
 */
function reserveRunningTaskSlot(config = {}) {
  pruneRunningTasks();
  return canAcceptNewTask(config);
}

/**
 * @param {any} result
 * @param {{ resultPreviewChars?: number }} [config]
 */
function compactResult(result, config = {}) {
  if (!result || typeof result !== "object") return result;

  const previewChars = toPositiveInt(config.resultPreviewChars, DEFAULT_RESULT_PREVIEW_CHARS);
  const out = {};
  if ("ok" in result) out.ok = result.ok;
  if (typeof result.summary === "string") out.summary = result.summary;

  if (typeof result.report === "string") {
    out.reportPreview = result.report.slice(0, previewChars);
  }
  if (typeof result.analysis === "string") {
    out.analysisPreview = result.analysis.slice(0, previewChars);
  }
  if (typeof result.findings === "string") {
    out.findingsPreview = result.findings.slice(0, previewChars);
  }
  if (Array.isArray(result.findings)) {
    out.findingsCount = result.findings.length;
  }

  return out;
}

/**
 * @param {any} task
 * @param {{ resultPreviewChars?: number }} [config]
 */
function compactTaskRecord(task, config = {}) {
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
    result: task.status === "completed" ? compactResult(task.result, config) : undefined,
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

  // Resolve configuration from stageApi (browser-compatible, no process.env)
  const taskConfig = resolveTaskConfig(stageApi);

  // ─────────────────────────────────────────────────────────────────────────────
  // Issue #1 Fix: 严格输入验证
  // ─────────────────────────────────────────────────────────────────────────────

  // 验证 subagent_type 白名单
  if (!ALLOWED_SUBAGENT_TYPES.has(subagent_type)) {
    return {
      success: false,
      error: `Invalid subagent_type: "${subagent_type}". Allowed: ${[...ALLOWED_SUBAGENT_TYPES].join(', ')}`,
    };
  }

  // 验证 prompt 为非空字符串
  if (typeof prompt !== 'string' || !prompt.trim()) {
    return { success: false, error: "prompt must be a non-empty string" };
  }

  // 验证 prompt 长度上限
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return {
      success: false,
      error: `prompt exceeds maximum length (${prompt.length}/${MAX_PROMPT_LENGTH})`,
    };
  }

  // 验证 sourceIds 为字符串数组并过滤非法项
  let validatedSourceIds = undefined;
  if (sourceIds !== undefined) {
    if (!Array.isArray(sourceIds)) {
      return { success: false, error: "sourceIds must be an array of strings" };
    }
    validatedSourceIds = sourceIds.filter(id => typeof id === 'string' && id.trim());
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

  const targetSources = Array.isArray(validatedSourceIds) && validatedSourceIds.length
    ? validatedSourceIds.map((id) => manager.getSource(id)).filter(Boolean)
    : Array.isArray(state?.L0?.sources)
      ? state.L0.sources
      : [];

  const reservation = reserveRunningTaskSlot({ maxRunningTasks: taskConfig.maxRunningTasks });
  if (!reservation.ok) {
    return {
      success: false,
      error: reservation.error,
      hint: "任务过多时会拒绝新任务，请稍后重试或通过 stageApi.env 调高 DEEPSEARCH_MAX_RUNNING_TASKS",
    };
  }

  // 生成任务 ID
  const taskId = makeSecureTimestampedId(`task_${subagent_type}`);
  const startedAt = Date.now();

  emit?.("deepsearch:subagent.started", { taskId, type: subagent_type, prompt, sourceCount: targetSources.length, async: isAsync });

  // 创建执行函数
  const executeTask = async () => {
    // ─────────────────────────────────────────────────────────────────────────────
    // Issue #2 Fix: 创建带超时的 AbortController
    // ─────────────────────────────────────────────────────────────────────────────
    const taskTimeoutMs = toPositiveInt(stageApi?.env?.DEEPSEARCH_TASK_TIMEOUT_MS, DEFAULT_TASK_TIMEOUT_MS);
    const taskAbortController = new AbortController();
    const timeoutId = setTimeout(() => {
      taskAbortController.abort(new Error(`Task timeout after ${taskTimeoutMs}ms`));
    }, taskTimeoutMs);

    // 如果 stageApi 有外部 signal，链式监听
    const parentSignal = stageApi?.signal;
    const onParentAbort = () => taskAbortController.abort(parentSignal?.reason);
    if (parentSignal?.addEventListener) {
      parentSignal.addEventListener('abort', onParentAbort, { once: true });
    }

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

      // 运行子代理（使用带超时的 signal）
      const result = await subagent.run(
        { task: prompt, L0: { sources: targetSources } },
        { signal: taskAbortController.signal, stageApi, taskId }
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
        expiresAt: completedAt + taskConfig.completedTaskTtlMs,
      };

      // 存储到 sharedContext
      if (sharedContext?.store) {
        sharedContext.store(taskId, taskResult);
        sharedContext.setSummary?.(taskId, taskResult.summary);
      }

      // 更新任务注册表
      getTaskManager().set(taskId, compactTaskRecord(taskResult, { resultPreviewChars: taskConfig.resultPreviewChars }));
      pruneRunningTasks({ now: completedAt });

      emit?.("deepsearch:subagent.completed", { taskId, type: subagent_type, ok: result?.ok !== false });

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
        expiresAt: completedAt + taskConfig.completedTaskTtlMs,
      };

      getTaskManager().set(taskId, compactTaskRecord(taskResult, { resultPreviewChars: taskConfig.resultPreviewChars }));
      pruneRunningTasks({ now: completedAt });
      if (sharedContext?.store) {
        sharedContext.store(taskId, taskResult);
      }

      emit?.("deepsearch:subagent.failed", { taskId, type: subagent_type, error });

      return taskResult;
    } finally {
      // 清理超时定时器和父信号监听器
      clearTimeout(timeoutId);
      if (parentSignal?.removeEventListener) {
        parentSignal.removeEventListener('abort', onParentAbort);
      }
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
 * @param {string} taskId - 任务唯一标识符
 * @returns {TaskRecord | undefined} 任务记录，若不存在返回 undefined
 */
export function getTaskStatus(taskId) {
  pruneRunningTasks();
  return getTaskManager().get(taskId);
}

/**
 * 等待任务完成
 * @param {string} taskId - 任务唯一标识符
 * @param {number} [timeout=60000] - 超时时间（毫秒），默认 60 秒
 * @returns {Promise<TaskRecord | null>} 任务记录，若不存在返回 null，超时返回带 timeout 状态的记录
 * @throws {never} 不抛出异常，超时通过返回值体现
 */
export async function waitForTask(taskId, timeout = 60000) {
  pruneRunningTasks();
  const task = getTaskManager().get(taskId);
  if (!task) return null;

  if (task.status !== "running") {
    return task;
  }

  if (task.promise) {
    // Issue #3 Fix: 保存 timerId 并在任务完成时清理
    let timerId;
    const timeoutPromise = new Promise((_, reject) => {
      timerId = setTimeout(() => reject(new Error("Task timeout")), timeout);
    });
    try {
      const result = await Promise.race([task.promise, timeoutPromise]);
      clearTimeout(timerId);
      return result;
    } catch (err) {
      clearTimeout(timerId);
      return { ...task, status: "timeout", error: err.message };
    }
  }

  return task;
}

export default { definition, handler, getTaskStatus, waitForTask, getTaskManager, resetTaskManager };
