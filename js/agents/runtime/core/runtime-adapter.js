/**
 * RuntimeAdapter Interface
 * 
 * 定义统一的运行时抽象，支持 JS, Python (Pyodide) 等。
 */

export const RuntimeType = {
  JS: 'js',
  PYTHON: 'python',
  R: 'r'
};

/**
 * @typedef {Object} ExecutionContext
 * @property {Object} vfs - 虚拟文件系统句柄
 * @property {Object} state - 当前状态快照 (Readonly)
 * @property {Function} [emit] - 事件发送函数 (to EventBus)
 * @property {AbortSignal} [signal] - 中止信号
 */

/**
 * @typedef {Object} ExecutionResult
 * @property {boolean} success - 是否成功
 * @property {any} [data] - 执行结果数据
 * @property {string} [error] - 错误信息
 * @property {Object} [metrics] - 执行度量 (duration, memory, etc.)
 */

export class RuntimeAdapter {
  constructor(options = {}) {
    this.type = options.type || RuntimeType.JS;
    this.id = options.id || `${this.type}_${Date.now()}`;
  }

  /**
   * 初始化运行时环境
   * @returns {Promise<any>}
   */
  async initialize() {
    throw new Error('Not implemented');
  }

  /**
   * 执行代码
   * @param {string} code 
   * @param {ExecutionContext} context 
   * @returns {Promise<ExecutionResult>}
   */
  async execute(code, context) {
    throw new Error('Not implemented');
  }

  /**
   * 预加载依赖 (针对 Python packages 等)
   * @param {string[]} dependencies 
   */
  async preload(dependencies) {
    // Default: do nothing
  }

  /**
   * 销毁运行时
   */
  async terminate() {
    // Default: do nothing
  }
}
