/**
 * ToolExecutor - 统一工具执行器
 *
 * 提供统一的工具执行抽象层:
 * - 统一的日志记录
 * - 超时保护
 * - 重试机制
 * - 标准化结果格式
 *
 * 所有 Agent 应通过此类执行工具，而非直接调用 handler。
 */

export class ToolExecutor {
  constructor(options = {}) {
    this.tools = options.tools || {};
    this.logger = options.logger || null;
    this.defaultTimeoutMs = options.timeoutMs || 30000;
    this.maxRetries = options.maxRetries || 1;
    this.emitFn = options.emit || null;
  }

  /**
   * 注册工具
   */
  register(name, tool) {
    this.tools[name] = tool;
  }

  /**
   * 批量注册工具
   */
  registerAll(tools) {
    Object.assign(this.tools, tools);
  }

  /**
   * 获取工具定义（用于 prompt 注入）
   */
  getToolDefinitions() {
    return Object.entries(this.tools).map(([name, tool]) => ({
      name,
      description: tool.description || "",
      parameters: tool.parameters || tool.definition?.parameters || {},
    }));
  }

  /**
   * 执行单个工具
   * @param {string} name - 工具名称
   * @param {Object} args - 工具参数
   * @param {Object} context - 执行上下文
   * @param {Object} options - 执行选项
   * @returns {Promise<ToolResult>}
   */
  async execute(name, args, context, options = {}) {
    const tool = this.tools[name];
    if (!tool) {
      return this._buildResult(false, null, `Unknown tool: ${name}`);
    }

    const handler = typeof tool === "function" ? tool : tool.handler;
    if (typeof handler !== "function") {
      return this._buildResult(false, null, `Tool ${name} has no handler`);
    }

    const timeoutMs = options.timeoutMs || this.defaultTimeoutMs;
    const retries = options.retries ?? this.maxRetries;
    const startTime = Date.now();

    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const result = await this._executeWithTimeout(handler, args, context, timeoutMs);
        const duration = Date.now() - startTime;

        this._log("debug", `Tool ${name} completed`, { duration, attempt });
        this._emit("tool.completed", { tool: name, args, result, duration });

        return this._normalizeResult(result);
      } catch (err) {
        lastError = err;
        this._log("warn", `Tool ${name} failed (attempt ${attempt + 1})`, { error: err.message });

        if (attempt < retries) {
          await this._delay(100 * (attempt + 1)); // Exponential backoff
        }
      }
    }

    const duration = Date.now() - startTime;
    this._emit("tool.failed", { tool: name, args, error: lastError?.message, duration });
    return this._buildResult(false, null, lastError?.message || "Unknown error");
  }

  /**
   * 批量执行工具 (并发)
   */
  async executeBatch(actions, context, options = {}) {
    const promises = actions.map(item =>
      this.execute(item.action || item.name, item.args || {}, context, options)
        .then(result => ({ tool: item.action || item.name, ...result }))
        .catch(err => ({ tool: item.action || item.name, success: false, error: err.message }))
    );
    return Promise.all(promises);
  }

  async _executeWithTimeout(handler, args, context, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Tool execution timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      Promise.resolve(handler(args, context))
        .then(result => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch(err => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  _normalizeResult(result) {
    if (result === null || result === undefined) {
      return this._buildResult(true, null);
    }

    if (typeof result === "object") {
      const success = result.success ?? result.ok ?? !result.error;
      const data = result.data ?? result.result ?? result;
      const error = result.error ?? null;
      return { success: Boolean(success), data, error, raw: result };
    }

    return this._buildResult(true, result);
  }

  _buildResult(success, data, error = null) {
    return { success, data, error };
  }

  _log(level, message, data = {}) {
    if (this.logger && typeof this.logger[level] === "function") {
      this.logger[level](`[ToolExecutor] ${message}`, data);
    }
  }

  _emit(name, payload) {
    if (typeof this.emitFn === "function") {
      this.emitFn(name, payload);
    }
  }

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * 创建工具执行器的工厂函数
 */
export function createToolExecutor(options = {}) {
  return new ToolExecutor(options);
}

/**
 * 简单执行函数（向后兼容）
 */
export async function executeTool(tools, name, args, context) {
  const executor = new ToolExecutor({ tools });
  return executor.execute(name, args, context);
}

export default ToolExecutor;
