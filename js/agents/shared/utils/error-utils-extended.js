/**
 * 错误处理工具函数
 * @module shared/utils/error-utils
 */

/**
 * 提取错误消息（统一处理各种错误类型）
 * @param {unknown} err
 * @returns {string}
 */
export function toErrorMessage(err) {
  if (err === null || err === undefined) return "Unknown error";
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (typeof err === "object") {
    // 尝试常见的错误属性
    const obj = /** @type {Record<string, unknown>} */ (err);
    if (typeof obj.message === "string") return obj.message;
    if (typeof obj.error === "string") return obj.error;
    if (typeof obj.reason === "string") return obj.reason;
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

/**
 * 提取错误堆栈
 * @param {unknown} err
 * @returns {string | undefined}
 */
export function toErrorStack(err) {
  if (err instanceof Error) return err.stack;
  return undefined;
}

/**
 * 包装错误（添加上下文信息）
 * @param {unknown} err
 * @param {string} context
 * @returns {Error}
 */
export function wrapError(err, context) {
  const message = `${context}: ${toErrorMessage(err)}`;
  const wrapped = new Error(message);
  if (err instanceof Error) {
    wrapped.cause = err;
    if (err.stack) {
      wrapped.stack = `${wrapped.stack}\nCaused by: ${err.stack}`;
    }
  }
  return wrapped;
}

/**
 * 安全执行函数（捕获异常返回 Result）
 * @template T
 * @param {() => T} fn
 * @returns {{ ok: true, value: T } | { ok: false, error: string }}
 */
export function safeExec(fn) {
  try {
    const value = fn();
    return { ok: true, value };
  } catch (e) {
    return { ok: false, error: toErrorMessage(e) };
  }
}

/**
 * 安全执行异步函数（捕获异常返回 Result）
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<{ ok: true, value: T } | { ok: false, error: string }>}
 */
export async function safeExecAsync(fn) {
  try {
    const value = await fn();
    return { ok: true, value };
  } catch (e) {
    return { ok: false, error: toErrorMessage(e) };
  }
}

/**
 * 捕获并记录错误（不抛出）
 * @template T
 * @param {() => T} fn
 * @param {Object} [options]
 * @param {string} [options.context] - 上下文描述
 * @param {T} [options.fallback] - 失败时的返回值
 * @param {(error: Error) => void} [options.onError] - 错误回调
 * @returns {T | undefined}
 */
export function catchAndLog(fn, options = {}) {
  try {
    return fn();
  } catch (e) {
    const error = e instanceof Error ? e : new Error(toErrorMessage(e));
    if (options.onError) {
      options.onError(error);
    } else {
      const ctx = options.context ? `[${options.context}] ` : "";
      console.warn(`${ctx}${error.message}`);
    }
    return options.fallback;
  }
}

/**
 * 创建安全包装函数（不抛出异常）
 * @template {(...args: any[]) => any} F
 * @param {F} fn
 * @param {Object} [options]
 * @param {string} [options.context]
 * @param {ReturnType<F>} [options.fallback]
 * @returns {F}
 */
export function makeSafe(fn, options = {}) {
  return /** @type {F} */ (
    function (...args) {
      return catchAndLog(() => fn(...args), options);
    }
  );
}

/**
 * 聚合多个错误
 * @param {Error[]} errors
 * @param {string} [message]
 * @returns {Error | null}
 */
export function aggregateErrors(errors, message) {
  if (!errors || errors.length === 0) return null;
  if (errors.length === 1) return errors[0];
  return new AggregateError(errors, message || `${errors.length} errors occurred`);
}

/**
 * 错误边界包装器
 * @template T
 * @param {() => Promise<T>} fn
 * @param {Object} options
 * @param {() => T | Promise<T>} options.fallback - 失败时的兜底
 * @param {(error: Error) => void} [options.onError] - 错误回调
 * @returns {Promise<T>}
 */
export async function withErrorBoundary(fn, options) {
  try {
    return await fn();
  } catch (e) {
    const error = e instanceof Error ? e : new Error(toErrorMessage(e));
    if (options.onError) {
      try {
        options.onError(error);
      } catch {
        // 忽略 onError 自身的错误
      }
    }
    return await options.fallback();
  }
}

/**
 * 带重试的错误边界
 * @template T
 * @param {() => Promise<T>} fn
 * @param {Object} options
 * @param {number} [options.maxRetries=3]
 * @param {number} [options.delayMs=1000]
 * @param {(error: Error, attempt: number) => boolean} [options.shouldRetry]
 * @param {(error: Error, attempt: number) => void} [options.onRetry]
 * @returns {Promise<T>}
 */
export async function withRetry(fn, options = {}) {
  const { maxRetries = 3, delayMs = 1000, shouldRetry, onRetry } = options;
  let lastError;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(toErrorMessage(e));

      if (attempt > maxRetries) break;

      const shouldContinue = shouldRetry ? shouldRetry(lastError, attempt) : true;
      if (!shouldContinue) break;

      if (onRetry) {
        try {
          onRetry(lastError, attempt);
        } catch {
          // 忽略
        }
      }

      await new Promise((r) => setTimeout(r, delayMs * attempt));
    }
  }

  throw lastError;
}
