/**
 * Scheduler Plugin
 *
 * 任务调度器，提供优先级队列和并发控制
 */

import { createPlugin } from '../../core/plugin.js';

/** @typedef {import('../../core/plugin.js').PluginContext} PluginContext */

/** @readonly @enum {number} */
export const TaskPriority = {
  LOW: 0,
  NORMAL: 1,
  HIGH: 2,
  CRITICAL: 3,
};

export default createPlugin({
  name: 'service/scheduler',
  version: '1.0.0',
  description: '任务调度器',

  defaultConfig: {
    maxConcurrent: 5,
    defaultTimeout: 60000,
    maxQueueSize: 10000,
  },

  /**
   * @param {PluginContext} ctx
   * @returns {void}
   */
  install(ctx) {
    const queues = {
      [TaskPriority.CRITICAL]: [],
      [TaskPriority.HIGH]: [],
      [TaskPriority.NORMAL]: [],
      [TaskPriority.LOW]: [],
    };

    const validPriorities = new Set(Object.values(TaskPriority));
    const maxQueueSizeRaw = Number.isFinite(ctx.config.maxQueueSize) ? ctx.config.maxQueueSize : 10000;
    const maxQueueSize = Math.max(0, Math.floor(maxQueueSizeRaw));

    let running = 0;
    let taskId = 0;
    const tasks = new Map();

    const globalWithSetImmediate = /** @type {{ setImmediate?: unknown }} */ (/** @type {unknown} */ (globalThis));

    /** @type {(callback: (...args: unknown[]) => void, ...args: unknown[]) => unknown} */
    const setImmediate =
      typeof globalWithSetImmediate.setImmediate === 'function'
        ? /** @type {(callback: (...args: unknown[]) => void, ...args: unknown[]) => unknown} */ (globalWithSetImmediate.setImmediate)
        : (callback, ...args) => setTimeout(callback, 0, ...args);

    const getQueuedCount = () => Object.values(queues).reduce((sum, q) => sum + q.length, 0);

    const updateQueuedStats = ({ incrementTotal = false, incrementRejected = false } = {}) => {
      const current = ctx.state.get('stats') || {};
      const next = {
        queued: getQueuedCount(),
        totalQueued: (current.totalQueued || 0) + (incrementTotal ? 1 : 0),
      };
      if (incrementRejected) {
        next.rejected = (current.rejected || 0) + 1;
      } else if (typeof current.rejected === 'number') {
        next.rejected = current.rejected;
      }
      ctx.state.merge('stats', next);
    };

    const processQueue = async () => {
      if (running >= ctx.config.maxConcurrent) return;

      // 按优先级取任务
      let task = null;
      for (const priority of [TaskPriority.CRITICAL, TaskPriority.HIGH, TaskPriority.NORMAL, TaskPriority.LOW]) {
        if (queues[priority].length > 0) {
          task = queues[priority].shift();
          break;
        }
      }

      if (!task) return;
      updateQueuedStats();

      running++;
      ctx.state.set('running', running);

      try {
        ctx.events.emit('scheduler:task:start', { id: task.id, priority: task.priority });

        // Issue #3: 保存 timeout 句柄并在任务完成后清理
        let timeoutHandle;
        const timeoutError = /** @type {Error & { code?: string }} */ (new Error('Task timeout'));
        timeoutError.code = 'SCHEDULER_TASK_TIMEOUT';
        const timeoutPromise = new Promise((_, reject) => {
          timeoutHandle = setTimeout(() => {
            if (task.controller && typeof task.controller.abort === 'function') {
              try {
                task.controller.abort(timeoutError);
              } catch {
                task.controller.abort();
              }
            }
            reject(timeoutError);
          }, task.timeout);
        });

        try {
          const result = await Promise.race([task.execute(), timeoutPromise]);
          task.resolve(result);
          ctx.events.emit('scheduler:task:complete', { id: task.id });
        } finally {
          clearTimeout(timeoutHandle);
        }
      } catch (error) {
        task.reject(error);
        if (error?.code === 'SCHEDULER_TASK_TIMEOUT') {
          ctx.events.emit('scheduler:task:timeout', { id: task.id, timeout: task.timeout });
        }
        ctx.events.emit('scheduler:task:error', { id: task.id, error: error.message });
      } finally {
        running--;
        ctx.state.set('running', running);
        tasks.delete(task.id);

        // 继续处理队列
        setImmediate(processQueue);
      }
    };

    ctx.registerService('scheduler', {
      /**
       * 调度任务
       * @param {(() => any) | any} taskFn
       * @param {number} [priority]
       * @returns {Promise<any>}
       */
      schedule(taskFn, priority = TaskPriority.NORMAL) {
        if (!validPriorities.has(priority)) {
          return Promise.reject(new Error('Invalid priority'));
        }

        const queued = getQueuedCount();
        if (queued >= maxQueueSize) {
          updateQueuedStats({ incrementRejected: true });
          ctx.events.emit('scheduler:task:rejected', {
            reason: 'queue_full',
            priority,
            maxQueueSize,
          });
          return Promise.reject(new Error(`Task queue overflow (maxQueueSize=${maxQueueSize})`));
        }

        const id = ++taskId;
        const controller = typeof AbortController === 'function' ? new AbortController() : null;

        return new Promise((resolve, reject) => {
          const task = {
            id,
            priority,
            timeout: ctx.config.defaultTimeout,
            execute: () => (typeof taskFn === 'function' ? taskFn(controller?.signal) : taskFn),
            resolve,
            reject,
            createdAt: Date.now(),
            controller,
          };

          tasks.set(id, task);
          queues[priority].push(task);

          updateQueuedStats({ incrementTotal: true });

          ctx.events.emit('scheduler:task:queued', { id, priority });
          setImmediate(processQueue);
        });
      },

      /**
       * 取消任务
       * @param {number} taskId
       * @returns {boolean}
       */
      cancel(taskId) {
        const task = tasks.get(taskId);
        if (!task) return false;

        // 从队列移除
        const queue = queues[task.priority];
        const idx = queue.findIndex(t => t.id === taskId);
        if (idx >= 0) {
          queue.splice(idx, 1);
          task.reject(new Error('Task cancelled'));
          tasks.delete(taskId);
          updateQueuedStats();
          ctx.events.emit('scheduler:task:cancelled', { id: taskId });
          return true;
        }

        return false;
      },

      /**
       * 获取状态
       * @returns {{ running: number, queued: number, maxConcurrent: number, maxQueueSize: number }}
       */
      getStatus() {
        return {
          running,
          queued: getQueuedCount(),
          maxConcurrent: ctx.config.maxConcurrent,
          maxQueueSize,
        };
      },

      /**
       * 获取队列长度
       * @param {number} [priority]
       * @returns {number}
       */
      getQueueLength(priority) {
        if (priority !== undefined) {
          return queues[priority]?.length || 0;
        }
        return getQueuedCount();
      },
    });

    ctx.log.info('Scheduler plugin installed');
  },
});
