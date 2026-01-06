/**
 * Scheduler Plugin
 *
 * 任务调度器，兼容旧 MicroKernel.schedule() API
 */

import { createPlugin } from '../../core/plugin.js';

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
  },

  install(ctx) {
    const queues = {
      [TaskPriority.CRITICAL]: [],
      [TaskPriority.HIGH]: [],
      [TaskPriority.NORMAL]: [],
      [TaskPriority.LOW]: [],
    };

    let running = 0;
    let taskId = 0;
    const tasks = new Map();

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

      running++;
      ctx.state.set('running', running);

      try {
        ctx.events.emit('scheduler.task.start', { id: task.id, priority: task.priority });

        const result = await Promise.race([
          task.execute(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Task timeout')), task.timeout)
          ),
        ]);

        task.resolve(result);
        ctx.events.emit('scheduler.task.complete', { id: task.id });
      } catch (error) {
        task.reject(error);
        ctx.events.emit('scheduler.task.error', { id: task.id, error: error.message });
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
       */
      schedule(taskFn, priority = TaskPriority.NORMAL) {
        const id = ++taskId;

        return new Promise((resolve, reject) => {
          const task = {
            id,
            priority,
            timeout: ctx.config.defaultTimeout,
            execute: typeof taskFn === 'function' ? taskFn : () => taskFn,
            resolve,
            reject,
            createdAt: Date.now(),
          };

          tasks.set(id, task);
          queues[priority].push(task);

          ctx.state.merge('stats', {
            queued: (ctx.state.get('stats.queued') || 0) + 1,
          });

          ctx.events.emit('scheduler.task.queued', { id, priority });
          setImmediate(processQueue);
        });
      },

      /**
       * 取消任务
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
          ctx.events.emit('scheduler.task.cancelled', { id: taskId });
          return true;
        }

        return false;
      },

      /**
       * 获取状态
       */
      getStatus() {
        return {
          running,
          queued: Object.values(queues).reduce((sum, q) => sum + q.length, 0),
          maxConcurrent: ctx.config.maxConcurrent,
        };
      },

      /**
       * 获取队列长度
       */
      getQueueLength(priority) {
        if (priority !== undefined) {
          return queues[priority]?.length || 0;
        }
        return Object.values(queues).reduce((sum, q) => sum + q.length, 0);
      },
    });

    ctx.log.info('Scheduler plugin installed');
  },
});
