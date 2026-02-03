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

// ===== Stage 常量 (Agent 生命周期阶段) =====

/**
 * Agent 生命周期阶段常量
 */
export const Stage = Object.freeze({
  BEFORE_AGENT: "beforeAgent",
  BEFORE_MODEL: "beforeModel",
  AFTER_MODEL: "afterModel",
  BEFORE_TOOL: "beforeTool",
  AFTER_TOOL: "afterTool",
  AFTER_AGENT: "afterAgent",
});

// ===== MiddlewareChain =====

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
   * @param {Function[]} middlewares - 中间件函数列表
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
   * @param {number} index - 插入位置
   * @param {Function} middleware - 中间件函数
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
   * @param {Function} middleware - 中间件函数
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
   * @returns {Promise<unknown>}
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
 * @typedef {Object} LoggingMiddlewareOptions
 * @property {Object} [logger] - 日志对象 (需要 debug/error 方法)
 * @property {string} [prefix='[AgentLoop]'] - 日志前缀
 */

/**
 * 日志中间件 - 记录执行时间和状态
 * @param {LoggingMiddlewareOptions} [options] - 日志中间件配置
 * @returns {(ctx: Object, next: () => Promise<unknown>) => Promise<unknown>} 中间件函数
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
 * @typedef {Object} TelemetryMiddlewareOptions
 * @property {(event: string, payload: Object) => void} [emit] - 事件发射函数
 * @property {string} [actor='agent'] - 执行者标识
 * @property {string} [stageName='agent'] - 阶段名称
 */

/**
 * Telemetry 中间件 - 发射事件用于监控
 * @param {TelemetryMiddlewareOptions} [options] - Telemetry 中间件配置
 * @returns {(ctx: Object, next: () => Promise<unknown>) => Promise<unknown>} 中间件函数
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
 * @returns {(ctx: Object, next: () => Promise<unknown>) => Promise<unknown>} 中间件函数
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
 * @typedef {Object} TimeoutMiddlewareOptions
 * @property {number} [timeout=30000] - 超时时间 (ms)
 * @property {(ctx: Object, err: Error) => void} [onTimeout] - 超时回调
 */

/**
 * 超时中间件 - 为步骤添加超时保护
 * @param {TimeoutMiddlewareOptions} [options] - 超时中间件配置
 * @returns {(ctx: Object, next: () => Promise<unknown>) => Promise<unknown>} 中间件函数
 */
export function createTimeoutMiddleware(options = {}) {
  const { timeout = 30000, onTimeout } = options;
  const MIN_STEP_TIMEOUT_MS = 1;
  const MAX_STEP_TIMEOUT_MS = 5 * 60 * 1000;
  const baseTimeout = Number.isFinite(timeout) && timeout > 0
    ? Math.min(Math.max(timeout, MIN_STEP_TIMEOUT_MS), MAX_STEP_TIMEOUT_MS)
    : 30000;

  return async (ctx, next) => {
    const rawTimeout = ctx.timeout || baseTimeout;
    const stepTimeout = Number.isFinite(rawTimeout) && rawTimeout > 0
      ? Math.min(Math.max(rawTimeout, MIN_STEP_TIMEOUT_MS), MAX_STEP_TIMEOUT_MS)
      : baseTimeout;

    return new Promise((resolve, reject) => {
	      const timer = setTimeout(() => {
	        /** @type {Error & { code?: string, cause?: Error }} */
	        const err = /** @type {any} */ (new Error(`Step timeout after ${stepTimeout}ms`));
	        err.code = "TIMEOUT";
	        try {
	          onTimeout?.(ctx, err);
	        } catch (callbackErr) {
          err.cause = /** @type {Error} */ (callbackErr);
        }
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
 * @typedef {Object} RetryMiddlewareOptions
 * @property {number} [maxRetries=2] - 最大重试次数
 * @property {number} [retryDelay=100] - 重试延迟基数 (ms)
 * @property {(err: Error, attempt: number) => boolean} [shouldRetry] - 判断是否应该重试
 */

/**
 * 重试中间件 - 失败时自动重试
 * 注意：重试会重新执行整个后续中间件链
 * @param {RetryMiddlewareOptions} [options] - 重试中间件配置
 * @returns {(ctx: Object, next: () => Promise<unknown>) => Promise<unknown>} 中间件函数
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
 * @typedef {Object} SnapshotMiddlewareOptions
 * @property {(ctx: Object) => Promise<unknown>} [onBeforeSnapshot] - 执行前快照回调
 * @property {(ctx: Object, result: unknown) => Promise<unknown>} [onAfterSnapshot] - 执行后快照回调
 */

/**
 * 状态快照中间件 - 在关键步骤前后保存状态
 * @param {SnapshotMiddlewareOptions} [options] - 快照中间件配置
 * @returns {(ctx: Object, next: () => Promise<unknown>) => Promise<unknown>} 中间件函数
 */
export function createSnapshotMiddleware(options = {}) {
  const { onBeforeSnapshot, onAfterSnapshot } = options;

  return async (ctx, next) => {
    // 执行前快照
    if (typeof onBeforeSnapshot === "function") {
      try {
        ctx._beforeSnapshot = await onBeforeSnapshot(ctx);
      } catch (err) {
        ctx._beforeSnapshotError = err;
        ctx.logger?.error?.(`[Snapshot] onBeforeSnapshot failed: ${err?.message || String(err)}`);
      }
    }

    const result = await next();

    // 执行后快照
    if (typeof onAfterSnapshot === "function") {
      try {
        ctx._afterSnapshot = await onAfterSnapshot(ctx, result);
      } catch (err) {
        ctx._afterSnapshotError = err;
        ctx.logger?.error?.(`[Snapshot] onAfterSnapshot failed: ${err?.message || String(err)}`);
      }
    }

    return result;
  };
}

/**
 * @typedef {Object} ShadowSystemMiddlewareOptions
 * @property {(ctx: Object) => Promise<{ system?: string }>} [getShadowHints] - 获取影子提示
 */

/**
 * 影子系统注入中间件 - 注入潜意识提示
 * @param {ShadowSystemMiddlewareOptions} [options] - 影子系统配置
 * @returns {(ctx: Object, next: () => Promise<unknown>) => Promise<unknown>} 中间件函数
 */
export function createShadowSystemMiddleware(options = {}) {
  const { getShadowHints } = options;

  return async (ctx, next) => {
    if (typeof getShadowHints === "function") {
      try {
        const hints = await getShadowHints(ctx);
        if (hints) {
          ctx.shadowHints = hints;
          // 如果有 messages，注入到系统消息
          if (Array.isArray(ctx.messages) && hints.system) {
            const shadowText = String(hints.system || "").trim();
            if (shadowText) {
              // Cache-friendly: do not mutate the historical system[0] prefix in-place.
              // Instead, inject an extra system message near the end (before the last user/tool turn).
              const list = ctx.messages.map((m) => (m && typeof m === "object" ? { ...m } : m));
              const block = `[Shadow System]\n${shadowText}`;

              let alreadyInjected = false;
              for (const msg of list) {
                if (!msg || typeof msg !== "object" || msg.role !== "system") continue;
                const content = typeof msg.content === "string" ? msg.content : String(msg.content ?? "");
                if (content.includes(block)) {
                  alreadyInjected = true;
                  break;
                }
              }

              if (!alreadyInjected) {
                let insertAt = list.length;
                for (let i = list.length - 1; i >= 0; i--) {
                  const msg = list[i];
                  if (!msg || typeof msg !== "object") continue;
                  if (msg.role === "user" || msg.role === "tool") {
                    insertAt = i;
                    break;
                  }
                }
                list.splice(insertAt, 0, { role: "system", content: block });
              }

              ctx.messages = list;
            }
          }
        }
      } catch (err) {
        ctx._shadowHintsError = err;
        ctx.logger?.error?.(`[ShadowHints] getShadowHints failed: ${err?.message || String(err)}`);
      }
    }
    return next();
  };
}

/**
 * @typedef {Object} BlackboardMiddlewareOptions
 * @property {{ set: (key: string, value: unknown) => void }} [blackboard] - 黑板对象
 * @property {string[]} [syncKeys=[]] - 需要同步的 key 列表
 */

/**
 * 黑板更新中间件 - 同步状态到黑板
 * @param {BlackboardMiddlewareOptions} [options] - 黑板中间件配置
 * @returns {(ctx: Object, next: () => Promise<unknown>) => Promise<unknown>} 中间件函数
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
 * @typedef {Object} DefaultMiddlewareChainOptions
 * @property {Object} [logger] - 日志对象
 * @property {(event: string, payload: Object) => void} [emit] - 事件发射函数
 * @property {string} [actor] - 执行者标识
 * @property {string} [stageName] - 阶段名称
 * @property {number} [timeout] - 超时时间 (ms)
 * @property {number} [maxRetries] - 最大重试次数
 * @property {number} [retryDelay] - 重试延迟基数 (ms)
 */

/**
 * 创建预配置的中间件链
 * @param {DefaultMiddlewareChainOptions} [options] - 默认链路配置
 * @returns {MiddlewareChain}
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
  Stage,
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
