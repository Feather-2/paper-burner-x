/**
 * Runtime Scheduler
 * 
 * 微内核架构下的核心调度组件。
 * 职责：
 * 1. 管理多种运行时 (JS, Python, etc.)
 * 2. 分发执行任务
 * 3. 统一上下文构建
 */

export class RuntimeScheduler {
  constructor(options = {}) {
    this.runtimes = new Map();
    this.eventBus = options.eventBus;
    this.vfs = options.vfs;
  }

  /**
   * 注册运行时适配器
   * @param {string} type 
   * @param {RuntimeAdapter} adapter 
   */
  registerRuntime(type, adapter) {
    this.runtimes.set(type, adapter);
  }

  /**
   * 调度执行任务
   * @param {string} type 运行时类型
   * @param {string} code 代码内容
   * @param {Object} inputState 状态快照
   * @param {Object} options 额外选项 (dependencies, etc.)
   */
  async dispatch(type, code, inputState, options = {}) {
    const runtime = this.runtimes.get(type);
    if (!runtime) {
      throw new Error(`Runtime not registered: ${type}`);
    }

    // 构建统一上下文
    const context = {
      vfs: this.vfs,
      state: inputState,
      emit: (name, payload) => this.eventBus?.emit(name, payload),
      signal: options.signal
    };

    // 预加载依赖
    if (options.dependencies && runtime.preload) {
      await runtime.preload(options.dependencies);
    }

    // 执行
    return await runtime.execute(code, context);
  }
}
