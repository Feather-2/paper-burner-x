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

export class ErrorHandler {
  constructor({ maxRetries = 3, retryDelayMs = 1000, exponentialBackoff = true } = {}) {
    this.config = { maxRetries, retryDelayMs, exponentialBackoff };
  }

  async withRetry(fn, { retries = this.config.maxRetries, onRetry } = {}) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        if (attempt < retries && this.isRetryable(err)) {
          const delay = this.getDelay(attempt);
          onRetry?.({ attempt, delay, error: err });
          await this.sleep(delay);
        } else break;
      }
    }
    throw lastError;
  }

  isRetryable(err) {
    if (err instanceof DeepSearchError) return err.canRetry || err.level === ErrorLevel.RETRYABLE;
    const msg = String(err?.message || "").toLowerCase();
    return msg.includes("timeout") || msg.includes("rate limit") || msg.includes("429") || msg.includes("503");
  }

  getDelay(attempt) {
    return this.config.exponentialBackoff ? this.config.retryDelayMs * Math.pow(2, attempt) : this.config.retryDelayMs;
  }

  sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
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

