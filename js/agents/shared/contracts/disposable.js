/**
 * Disposable 契约 - 统一资源生命周期管理
 * @module shared/contracts/disposable
 */

/**
 * @typedef {Object} Disposable
 * @property {() => void | Promise<void>} dispose - 释放所有资源
 * @property {boolean} [disposed] - 是否已释放
 */

/**
 * 检查对象是否实现 Disposable 接口
 * @param {any} obj
 * @returns {obj is Disposable}
 */
export function isDisposable(obj) {
  return (
    obj !== null &&
    obj !== undefined &&
    typeof obj === "object" &&
    typeof obj.dispose === "function"
  );
}

/**
 * 安全调用 dispose（已释放则跳过，异常不抛出）
 * @param {any} obj
 * @param {Object} [options]
 * @param {(error: Error) => void} [options.onError] - 错误回调
 * @returns {Promise<boolean>} 是否成功释放
 */
export async function safeDispose(obj, options = {}) {
  if (!isDisposable(obj)) return false;
  if (obj.disposed === true) return true;

  try {
    await obj.dispose();
    return true;
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    if (typeof options.onError === "function") {
      try {
        options.onError(error);
      } catch {
        // 吞掉 onError 回调异常，保持 safeDispose 永不抛错
      }
    } else {
      console.warn("[safeDispose] error:", error.message);
    }
    return false;
  }
}

/**
 * 批量 dispose（并行执行，全部完成后返回）
 * @param {Iterable<any>} items
 * @param {Object} [options]
 * @param {(error: Error, item: any) => void} [options.onError]
 * @returns {Promise<{total: number, success: number, failed: number}>}
 */
export async function disposeAll(items, options = {}) {
  const results = { total: 0, success: 0, failed: 0 };
  const promises = [];

  for (const item of items) {
    results.total++;
    promises.push(
      safeDispose(item, {
        onError: (e) => options.onError?.(e, item),
      }).then((ok) => {
        if (ok) results.success++;
        else results.failed++;
      })
    );
  }

  await Promise.allSettled(promises);
  return results;
}

/**
 * 使用资源后自动释放（类似 Python with 语句）
 * @template T
 * @param {T & Disposable} resource
 * @param {(resource: T) => Promise<any>} fn
 * @returns {Promise<any>}
 */
export async function using(resource, fn) {
  try {
    return await fn(resource);
  } finally {
    await safeDispose(resource);
  }
}

/**
 * @typedef {Object} CompositeDisposable
 * @property {boolean} disposed - 是否已释放
 * @property {() => Promise<void>} dispose - 释放所有资源
 * @property {(d: Disposable | (() => void | Promise<void>)) => void} add - 添加新的 disposable
 */

/**
 * 创建复合 Disposable（组合多个资源）
 * @param {Array<Disposable | (() => void | Promise<void>)>} disposables
 * @returns {CompositeDisposable}
 */
export function createCompositeDisposable(disposables) {
  let disposed = false;

  return {
    get disposed() {
      return disposed;
    },

    async dispose() {
      if (disposed) return;
      disposed = true;

      // 倒序释放
      for (let i = disposables.length - 1; i >= 0; i--) {
        const d = disposables[i];
        try {
          if (typeof d === "function") {
            await d();
          } else if (isDisposable(d)) {
            await d.dispose();
          }
        } catch (e) {
          console.warn("[CompositeDisposable] error:", e);
        }
      }
    },

    /**
     * 添加新的 disposable
     * @param {Disposable | (() => void | Promise<void>)} d
     */
    add(d) {
      if (!disposed) {
        disposables.push(d);
      }
    },
  };
}
