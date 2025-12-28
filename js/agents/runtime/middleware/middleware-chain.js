/**
 * Middleware Chain - AgentLoop 中间件系统
 *
 * 将 AgentLoop 的横切关注点（影子系统注入、黑板摘要更新、Telemetry 记录等）
 * 从主循环中剥离，提升模块间解耦度。
 *
 * 中间件签名: async (ctx, next) => result
 * - ctx: { input, state, emit, signal, ... }
 * - next: 调用下一个中间件
 */

/**
 * 中间件链执行器
 */
export class MiddlewareChain {
  constructor() {
    this._middlewares = [];
  }

  /**
   * 添加中间件
   * @param {Function} middleware - async (ctx, next) => result
   * @returns {MiddlewareChain}
   */
  use(middleware) {
    if (typeof middleware !== "function") {
      throw new TypeError("Middleware must be a function");
    }
    this._middlewares.push(middleware);
    return this;
  }

  /**
   * 批量添加中间件
   * @param {Function[]} middlewares
   * @returns {MiddlewareChain}
   */
  useAll(middlewares) {
    for (const mw of middlewares) {
      this.use(mw);
    }
    return this;
  }

  /**
   * 在指定位置插入中间件
   * @param {number} index
   * @param {Function} middleware
   * @returns {MiddlewareChain}
   */
  insertAt(index, middleware) {
    if (typeof middleware !== "function") {
      throw new TypeError("Middleware must be a function");
    }
    this._middlewares.splice(index, 0, middleware);
    return this;
  }

  /**
   * 移除中间件
   * @param {Function} middleware
   * @returns {boolean}
   */
  remove(middleware) {
    const idx = this._middlewares.indexOf(middleware);
    if (idx >= 0) {
      this._middlewares.splice(idx, 1);
      return true;
    }
    return false;
  }

  /**
   * 执行中间件链
   * @param {Object} ctx - 上下文对象
   * @param {Function} [finalHandler] - 最终处理函数
   * @returns {Promise<any>}
   */
  async execute(ctx, finalHandler) {
    const middlewares = this._middlewares;

    const dispatch = async (index) => {
      if (index < middlewares.length) {
        const mw = middlewares[index];
        // 每次调用 next 都创建新的 dispatch，支持重试
        return mw(ctx, () => dispatch(index + 1));
      }
      if (typeof finalHandler === "function") {
        return finalHandler(ctx);
      }
      return ctx;
    };

    return dispatch(0);
  }

  /**
   * 获取中间件数量
   */
  get length() {
    return this._middlewares.length;
  }

  /**
   * 清空所有中间件
   */
  clear() {
    this._middlewares = [];
  }
}

// ===== 内置中间件 =====

/**
 * 日志中间件 - 记录执行时间和状态
 */
export function createLoggingMiddleware(options = {}) {
  const { logger, prefix = "[AgentLoop]" } = options;

  return async (ctx, next) => {
    const startTime = Date.now();
    const stepName = ctx.stepName || ctx.phase || "step";

    logger?.debug?.(`${prefix} ${stepName} started`);

    try {
      const result = await next();
      const duration = Date.now() - startTime;
      logger?.debug?.(`${prefix} ${stepName} completed in ${duration}ms`);
      return result;
    } catch (err) {
      const duration = Date.now() - startTime;
      logger?.error?.(`${prefix} ${stepName} failed after ${duration}ms: ${err.message}`);
      throw err;
    }
  };
}

/**
 * Telemetry 中间件 - 发射事件用于监控
 */
export function createTelemetryMiddleware(options = {}) {
  const { emit, actor = "agent", stageName = "agent" } = options;

  return async (ctx, next) => {
    const emitFn = ctx.emit || emit;
    const stepName = ctx.stepName || ctx.phase || "step";
    const startTime = Date.now();

    emitFn?.(`${stageName}.middleware.${stepName}.started`, {
      actor,
      status: "progress",
      payload: { timestamp: startTime },
    });

    try {
      const result = await next();
      const duration = Date.now() - startTime;

      emitFn?.(`${stageName}.middleware.${stepName}.completed`, {
        actor,
        status: "success",
        payload: { duration, timestamp: Date.now() },
      });

      return result;
    } catch (err) {
      const duration = Date.now() - startTime;

      emitFn?.(`${stageName}.middleware.${stepName}.failed`, {
        actor,
        status: "error",
        payload: { duration, error: err.message, timestamp: Date.now() },
      });

      throw err;
    }
  };
}

/**
 * 取消检查中间件 - 在每个步骤前检查 signal
 */
export function createCancellationMiddleware() {
  return async (ctx, next) => {
    const signal = ctx.signal;
    if (signal?.aborted) {
      const reason = signal.reason;
      throw new Error(typeof reason === "string" ? reason : "Run cancelled");
    }
    return next();
  };
}

/**
 * 超时中间件 - 为步骤添加超时保护
 */
export function createTimeoutMiddleware(options = {}) {
  const { timeout = 30000, onTimeout } = options;

  return async (ctx, next) => {
    const stepTimeout = ctx.timeout || timeout;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const err = new Error(`Step timeout after ${stepTimeout}ms`);
        err.code = "TIMEOUT";
        onTimeout?.(ctx, err);
        reject(err);
      }, stepTimeout);

      Promise.resolve(next())
        .then(result => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch(err => {
          clearTimeout(timer);
          reject(err);
        });
    });
  };
}

/**
 * 重试中间件 - 失败时自动重试
 * 注意：重试会重新执行整个后续中间件链
 */
export function createRetryMiddleware(options = {}) {
  const { maxRetries = 2, retryDelay = 100, shouldRetry } = options;

  return async (ctx, next) => {
    let lastError;
    ctx._retryAttempt = 0;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      ctx._retryAttempt = attempt;
      try {
        return await next();
      } catch (err) {
        lastError = err;

        // 检查是否应该重试
        if (shouldRetry && !shouldRetry(err, attempt)) {
          throw err;
        }

        // 最后一次尝试不重试
        if (attempt >= maxRetries) {
          throw err;
        }

        // 等待后重试
        await new Promise(r => setTimeout(r, retryDelay * (attempt + 1)));
      }
    }

    throw lastError;
  };
}

/**
 * 状态快照中间件 - 在关键步骤前后保存状态
 */
export function createSnapshotMiddleware(options = {}) {
  const { onBeforeSnapshot, onAfterSnapshot } = options;

  return async (ctx, next) => {
    // 执行前快照
    if (typeof onBeforeSnapshot === "function") {
      ctx._beforeSnapshot = await onBeforeSnapshot(ctx);
    }

    const result = await next();

    // 执行后快照
    if (typeof onAfterSnapshot === "function") {
      ctx._afterSnapshot = await onAfterSnapshot(ctx, result);
    }

    return result;
  };
}

/**
 * 影子系统注入中间件 - 注入潜意识提示
 */
export function createShadowSystemMiddleware(options = {}) {
  const { getShadowHints } = options;

  return async (ctx, next) => {
    if (typeof getShadowHints === "function") {
      const hints = await getShadowHints(ctx);
      if (hints) {
        ctx.shadowHints = hints;
        // 如果有 messages，注入到系统消息
        if (Array.isArray(ctx.messages) && hints.system) {
          const systemMsg = ctx.messages.find(m => m.role === "system");
          if (systemMsg) {
            systemMsg.content += `\n\n[Shadow System]\n${hints.system}`;
          }
        }
      }
    }
    return next();
  };
}

/**
 * 黑板更新中间件 - 同步状态到黑板
 */
export function createBlackboardMiddleware(options = {}) {
  const { blackboard, syncKeys = [] } = options;

  return async (ctx, next) => {
    const result = await next();

    // 同步指定的 key 到黑板
    if (blackboard && typeof blackboard.set === "function") {
      for (const key of syncKeys) {
        if (ctx[key] !== undefined) {
          blackboard.set(key, ctx[key]);
        }
      }
      if (result !== undefined) {
        blackboard.set("lastResult", result);
      }
    }

    return result;
  };
}

/**
 * 创建预配置的中间件链
 */
export function createDefaultMiddlewareChain(options = {}) {
  const chain = new MiddlewareChain();

  // 1. 取消检查（最先执行）
  chain.use(createCancellationMiddleware());

  // 2. 日志记录
  if (options.logger) {
    chain.use(createLoggingMiddleware({ logger: options.logger }));
  }

  // 3. Telemetry
  if (options.emit) {
    chain.use(createTelemetryMiddleware({
      emit: options.emit,
      actor: options.actor,
      stageName: options.stageName,
    }));
  }

  // 4. 超时保护
  if (options.timeout) {
    chain.use(createTimeoutMiddleware({ timeout: options.timeout }));
  }

  // 5. 重试
  if (options.maxRetries) {
    chain.use(createRetryMiddleware({
      maxRetries: options.maxRetries,
      retryDelay: options.retryDelay,
    }));
  }

  return chain;
}

export default {
  MiddlewareChain,
  createLoggingMiddleware,
  createTelemetryMiddleware,
  createCancellationMiddleware,
  createTimeoutMiddleware,
  createRetryMiddleware,
  createSnapshotMiddleware,
  createShadowSystemMiddleware,
  createBlackboardMiddleware,
  createDefaultMiddlewareChain,
};
