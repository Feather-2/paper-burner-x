/**
 * 任务队列
 * 管理长时间运行的任务（如图片生成、导出等）
 */
class TaskQueue extends EventEmitter {
    static STATUS = {
        PENDING: 'pending',
        RUNNING: 'running',
        PAUSED: 'paused',
        COMPLETED: 'completed',
        FAILED: 'failed',
        CANCELLED: 'cancelled',
    };

    static PRIORITY = {
        LOW: 0,
        NORMAL: 1,
        HIGH: 2,
        CRITICAL: 3,
    };

    constructor(options = {}) {
        super();
        this.maxConcurrent = options.maxConcurrent || 3;
        this.queue = [];           // 待执行队列
        this.running = new Map();  // 执行中的任务
        this.completed = [];       // 已完成的任务（最近 50 个）
        this.taskHandlers = new Map(); // 任务处理器
    }

    /**
     * 注册任务处理器
     */
    registerHandler(taskType, handler) {
        this.taskHandlers.set(taskType, handler);
    }

    /**
     * 添加任务
     */
    add(task) {
        const fullTask = {
            id: task.id || this._generateId(),
            type: task.type,
            priority: task.priority ?? TaskQueue.PRIORITY.NORMAL,
            status: TaskQueue.STATUS.PENDING,
            progress: { current: 0, total: 100, message: '等待中...' },
            created: Date.now(),
            input: task.input,
            output: null,
            error: null,
            cancellable: task.cancellable ?? true,
            retryable: task.retryable ?? true,
            maxRetries: task.maxRetries ?? 2,
            retryCount: 0,
            _resolve: null,
            _reject: null,
        };

        // 按优先级插入队列
        const insertIndex = this.queue.findIndex(t => t.priority < fullTask.priority);
        if (insertIndex === -1) {
            this.queue.push(fullTask);
        } else {
            this.queue.splice(insertIndex, 0, fullTask);
        }

        this.emit('task:add', fullTask);
        this._processQueue();

        // 返回 Promise
        return new Promise((resolve, reject) => {
            fullTask._resolve = resolve;
            fullTask._reject = reject;
        });
    }

    /**
     * 取消任务
     */
    cancel(taskId) {
        // 检查队列中
        const queueIndex = this.queue.findIndex(t => t.id === taskId);
        if (queueIndex !== -1) {
            const task = this.queue.splice(queueIndex, 1)[0];
            task.status = TaskQueue.STATUS.CANCELLED;
            task._reject?.(new Error('任务已取消'));
            this.emit('task:cancel', task);
            return true;
        }

        // 检查运行中
        const runningTask = this.running.get(taskId);
        if (runningTask && runningTask.cancellable) {
            runningTask.status = TaskQueue.STATUS.CANCELLED;
            // 处理器需要检查状态并停止
            return true;
        }

        return false;
    }

    /**
     * 暂停任务
     */
    pause(taskId) {
        const task = this.running.get(taskId);
        if (task) {
            task.status = TaskQueue.STATUS.PAUSED;
            this.emit('task:pause', task);
        }
    }

    /**
     * 恢复任务
     */
    resume(taskId) {
        const task = this.running.get(taskId);
        if (task && task.status === TaskQueue.STATUS.PAUSED) {
            task.status = TaskQueue.STATUS.RUNNING;
            this.emit('task:resume', task);
        }
    }

    /**
     * 获取任务状态
     */
    getTask(taskId) {
        return this.queue.find(t => t.id === taskId)
            || this.running.get(taskId)
            || this.completed.find(t => t.id === taskId);
    }

    /**
     * 获取所有任务
     */
    getAllTasks() {
        return {
            pending: [...this.queue],
            running: [...this.running.values()],
            completed: [...this.completed],
        };
    }

    /**
     * 更新任务进度
     */
    updateProgress(taskId, progress) {
        const task = this.running.get(taskId);
        if (task) {
            task.progress = { ...task.progress, ...progress };
            this.emit('task:progress', task);
        }
    }

    /**
     * 处理队列
     */
    async _processQueue() {
        while (this.running.size < this.maxConcurrent && this.queue.length > 0) {
            const task = this.queue.shift();
            this._runTask(task);
        }
    }

    /**
     * 执行任务
     */
    async _runTask(task) {
        const handler = this.taskHandlers.get(task.type);
        if (!handler) {
            task.status = TaskQueue.STATUS.FAILED;
            task.error = new Error(`未知任务类型: ${task.type}`);
            task._reject?.(task.error);
            this.emit('task:error', task);
            return;
        }

        task.status = TaskQueue.STATUS.RUNNING;
        task.started = Date.now();
        this.running.set(task.id, task);
        this.emit('task:start', task);

        try {
            const result = await handler(task, {
                updateProgress: (progress) => this.updateProgress(task.id, progress),
                isCancelled: () => task.status === TaskQueue.STATUS.CANCELLED,
                isPaused: () => task.status === TaskQueue.STATUS.PAUSED,
            });

            if (task.status === TaskQueue.STATUS.CANCELLED) {
                task._reject?.(new Error('任务已取消'));
            } else {
                task.status = TaskQueue.STATUS.COMPLETED;
                task.output = result;
                task.completed = Date.now();
                task._resolve?.(result);
                this.emit('task:complete', task);
            }
        } catch (error) {
            if (task.retryable && task.retryCount < task.maxRetries) {
                task.retryCount++;
                task.status = TaskQueue.STATUS.PENDING;
                task.progress.message = `重试中 (${task.retryCount}/${task.maxRetries})...`;
                this.queue.unshift(task);
                this.emit('task:retry', task);
            } else {
                task.status = TaskQueue.STATUS.FAILED;
                task.error = error;
                task.completed = Date.now();
                task._reject?.(error);
                this.emit('task:error', task);
            }
        } finally {
            this.running.delete(task.id);
            this._addToCompleted(task);
            this._processQueue();
        }
    }

    _addToCompleted(task) {
        this.completed.unshift(task);
        if (this.completed.length > 50) {
            this.completed.pop();
        }
    }

    _generateId() {
        return 'task_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
    }

    /**
     * 清空已完成任务
     */
    clearCompleted() {
        this.completed = [];
    }
}

// ═══════════════════════════════════════════════════════════════
// 内置任务处理器
// ═══════════════════════════════════════════════════════════════

/**
 * 图片生成任务处理器（示例）
 */
async function imageGenerationHandler(task, context) {
    const { prompt, options } = task.input;

    context.updateProgress({ current: 0, message: '正在连接生图服务...' });

    // 这里调用实际的生图 API
    // 示例：使用 chatbot 的生图功能
    if (window.chatbot?.generateImage) {
        const result = await window.chatbot.generateImage(prompt, {
            ...options,
            onProgress: (progress) => {
                if (context.isCancelled()) throw new Error('任务已取消');
                context.updateProgress(progress);
            },
        });
        return result;
    }

    // 模拟生图过程
    for (let i = 0; i <= 100; i += 10) {
        if (context.isCancelled()) throw new Error('任务已取消');
        await new Promise(r => setTimeout(r, 500));
        context.updateProgress({ current: i, message: `生成中 ${i}%...` });
    }

    // 返回模拟结果
    return {
        assetId: 'mock_' + Date.now(),
        url: 'https://via.placeholder.com/512',
    };
}

/**
 * 导出任务处理器
 */
async function exportHandler(task, context) {
    const { format, slides } = task.input;
    const generator = window.pptGenerator;

    if (!generator) throw new Error('PPT 生成器未初始化');

    context.updateProgress({ current: 0, message: '准备导出...' });

    switch (format) {
        case 'pptx':
            await generator._exportPPTX();
            break;
        case 'pdf':
            await generator._exportPDF();
            break;
        case 'images':
            await generator._exportImages();
            break;
        default:
            throw new Error(`不支持的导出格式: ${format}`);
    }

    return { success: true };
}

// 全局任务队列实例
window.taskQueue = new TaskQueue();
window.taskQueue.registerHandler('image-generation', imageGenerationHandler);
window.taskQueue.registerHandler('export', exportHandler);
