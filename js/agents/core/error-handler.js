export const ErrorLevel = {
  RETRYABLE: "retryable", // 网络超时、API 限流
  DEGRADABLE: "degradable", // 外搜失败→仅用本地；rerank 失败→仅用 BM25
  RECOVERABLE: "recoverable", // 解析失败→跳过该源；claim 冲突→标记继续
  FATAL: "fatal", // 核心数据损坏、鉴权失败
};

export class DeepSearchError extends Error {
  constructor(message, { level = ErrorLevel.FATAL, cause, context, canRetry = false } = {}) {
    super(message);
    this.name = "DeepSearchError";
    this.level = level;
    this.cause = cause;
    this.context = context;
    this.canRetry = canRetry;
    this.timestamp = new Date().toISOString();
  }
}

/**
 * 熔断器状态
 */
export const CircuitState = Object.freeze({
  CLOSED: "closed", // 正常通行
  OPEN: "open", // 熔断，拒绝请求
  HALF_OPEN: "half_open", // 试探性允许
});

/**
 * 熔断器 - 防止级联故障
 *
 * 使用方式：
 * const breaker = new CircuitBreaker({ name: 'llm', threshold: 5 });
 * const result = await breaker.execute(() => callLLM());
 */
export class CircuitBreaker {
  constructor({
    name = "default",
    threshold = 5, // 连续失败次数阈值
    resetTimeMs = 30000, // 熔断后等待重置时间
    halfOpenRequests = 1, // 半开状态允许的试探请求数
    onStateChange, // 状态变化回调
  } = {}) {
    this.name = name;
    this.threshold = Math.max(1, threshold);
    this.resetTimeMs = Math.max(1000, resetTimeMs);
    this.halfOpenRequests = Math.max(1, halfOpenRequests);
    this.onStateChange = onStateChange;

    this.state = CircuitState.CLOSED;
    this.failures = 0;
    this.successes = 0;
    this.lastFailureTime = 0;
    this.halfOpenAttempts = 0;
  }

  /**
   * 获取当前状态
   */
  getState() {
    if (this.state === CircuitState.OPEN) {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed >= this.resetTimeMs) {
        this._transition(CircuitState.HALF_OPEN);
      }
    }
    return this.state;
  }

  /**
   * 判断是否允许执行
   */
  canExecute() {
    const state = this.getState();
    if (state === CircuitState.CLOSED) return true;
    if (state === CircuitState.OPEN) return false;
    return this.halfOpenAttempts < this.halfOpenRequests;
  }

  /**
   * 执行受保护的操作
   * @param {Function} fn - 异步函数
   * @param {object} options
   * @returns {Promise<any>}
   */
  async execute(fn, { fallback, signal } = {}) {
    if (signal?.aborted) throw signal.reason ?? new Error("aborted");

    if (!this.canExecute()) {
      const openErr = new Error(`Circuit breaker [${this.name}] is OPEN`);
      if (typeof fallback === "function") {
        return fallback(openErr);
      }
      throw new Error(`Circuit breaker [${this.name}] is OPEN, request rejected`);
    }

    if (this.state === CircuitState.HALF_OPEN) {
      this.halfOpenAttempts++;
    }

    try {
      const result = await fn();
      this._onSuccess();
      return result;
    } catch (err) {
      this._onFailure();
      throw err;
    }
  }

  /**
   * 成功时调用
   */
  _onSuccess() {
    this.successes++;
    if (this.state === CircuitState.HALF_OPEN) {
      this._transition(CircuitState.CLOSED);
    }
    this.failures = 0;
  }

  /**
   * 失败时调用
   */
  _onFailure() {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.state === CircuitState.HALF_OPEN) {
      this._transition(CircuitState.OPEN);
    } else if (this.state === CircuitState.CLOSED && this.failures >= this.threshold) {
      this._transition(CircuitState.OPEN);
    }
  }

  /**
   * 状态转换
   */
  _transition(newState) {
    if (this.state === newState) return;
    const oldState = this.state;
    this.state = newState;

    if (newState === CircuitState.CLOSED) {
      this.failures = 0;
      this.halfOpenAttempts = 0;
    } else if (newState === CircuitState.HALF_OPEN) {
      this.halfOpenAttempts = 0;
    }

    this.onStateChange?.({
      name: this.name,
      from: oldState,
      to: newState,
      failures: this.failures,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * 手动重置（用于测试或管理接口）
   */
  reset() {
    this._transition(CircuitState.CLOSED);
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      name: this.name,
      state: this.getState(),
      failures: this.failures,
      successes: this.successes,
      lastFailureTime: this.lastFailureTime || null,
      threshold: this.threshold,
      resetTimeMs: this.resetTimeMs,
    };
  }
}

// 全局熔断器注册表（单例）
const globalBreakers = new Map();

/**
 * 获取或创建全局熔断器
 * @param {string} name - 熔断器名称
 * @param {object} config - 配置（仅首次创建时生效）
 * @returns {CircuitBreaker}
 */
export function getCircuitBreaker(name, config = {}) {
  if (!globalBreakers.has(name)) {
    globalBreakers.set(name, new CircuitBreaker({ name, ...config }));
  }
  return globalBreakers.get(name);
}

/**
 * 重置所有全局熔断器
 */
export function resetAllBreakers() {
  for (const breaker of globalBreakers.values()) {
    breaker.reset();
  }
}

export class ErrorHandler {
  constructor({ maxRetries = 3, retryDelayMs = 1000, exponentialBackoff = true } = {}) {
    this.config = { maxRetries, retryDelayMs, exponentialBackoff };
  }

  async withRetry(fn, { retries, signal, maxDelayMs = 30000, onRetry, isRetryable, circuitBreaker } = {}) {
    if (circuitBreaker && !circuitBreaker.canExecute()) {
      throw new Error(`Circuit breaker [${circuitBreaker.name}] is OPEN`);
    }
    const maxRetries = retries ?? this.config.maxRetries ?? 2;
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (signal?.aborted) throw signal.reason ?? new Error("aborted");
      try {
        const run = () => fn({ attempt, signal });
        return circuitBreaker ? await circuitBreaker.execute(run, { signal }) : await run();
      } catch (err) {
        lastError = err;
        const retryable = typeof isRetryable === "function" ? isRetryable(err) : this.isRetryable(err);
        if (attempt < maxRetries && retryable) {
          if (circuitBreaker && !circuitBreaker.canExecute()) break;
          const delay = this.getDelay(attempt, { jitter: true, maxDelayMs });
          onRetry?.({ attempt, delay, error: err });
          await this.sleep(delay, signal);
        } else {
          break;
        }
      }
    }
    throw lastError;
  }

  isRetryable(err) {
    if (err instanceof DeepSearchError) return err.canRetry || err.level === ErrorLevel.RETRYABLE;
    const msg = String(err?.message || "").toLowerCase();
    return msg.includes("timeout") || msg.includes("rate limit") || msg.includes("429") || msg.includes("503");
  }

  getDelay(attempt, { jitter = true, maxDelayMs = 30000 } = {}) {
    const base = this.config.exponentialBackoff ? this.config.retryDelayMs * Math.pow(2, attempt) : this.config.retryDelayMs;
    const capped = Math.min(base, maxDelayMs);
    if (!jitter) return capped;
    // full jitter: [0.5, 1.5] * capped
    return Math.floor(capped * (0.5 + Math.random()));
  }

  sleep(ms, signal) {
    if (!signal) return new Promise((r) => setTimeout(r, ms));
    if (signal.aborted) throw signal.reason ?? new Error("aborted");
    return new Promise((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(t);
          reject(signal.reason ?? new Error("aborted"));
        },
        { once: true }
      );
    });
  }

  // Degradation helpers
  async withDegradation(primaryFn, fallbackFn, { onDegrade } = {}) {
    try {
      return await primaryFn();
    } catch (err) {
      if (this.isDegradable(err)) {
        onDegrade?.({ error: err });
        return await fallbackFn();
      }
      throw err;
    }
  }

  isDegradable(err) {
    return err instanceof DeepSearchError && err.level === ErrorLevel.DEGRADABLE;
  }

  // Record error to timeline
  recordError(state, error, { stage = "unknown" } = {}) {
    state?.addTimeline?.({
      name: `deepsearch.error.${error.level || "unknown"}`,
      status: "error",
      payload: { stage, message: error.message, level: error.level, context: error.context },
    });
  }
}

