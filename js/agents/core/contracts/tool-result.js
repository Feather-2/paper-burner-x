/**
 * Tool Result Contracts - 工具结果契约
 */

/**
 * @typedef {Object} ToolResult
 * @property {boolean} ok
 * @property {boolean} success - 兼容旧格式
 * @property {unknown} [data]
 * @property {string} [error]
 * @property {Record<string, unknown>} [meta]
 */

/**
 * @typedef {{ ok: true, value: T }} ValidResult
 * @template T
 */

/**
 * @typedef {{ ok: false, error: string }} InvalidResult
 */

/**
 * @typedef {ValidResult<T> | InvalidResult} ValidationResult
 * @template T
 */

/**
 * 验证工具结果
 * @param {unknown} result
 * @returns {ValidationResult<ToolResult>}
 */
export function validateToolResult(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return { ok: false, error: "ToolResult: expected object" };
  }

  const obj = /** @type {Record<string, unknown>} */ (result);

  // ok/success 二选一，互相兼容
  const ok = obj.ok === true || obj.success === true;
  const hasExplicitFailure = obj.ok === false || obj.success === false;

  return {
    ok: true,
    value: {
      ok: hasExplicitFailure ? false : ok,
      success: hasExplicitFailure ? false : ok,
      data: obj.data,
      error: typeof obj.error === "string" ? obj.error : undefined,
      meta: typeof obj.meta === "object" && obj.meta !== null && !Array.isArray(obj.meta)
        ? /** @type {Record<string, unknown>} */ (obj.meta)
        : undefined,
    },
  };
}

/**
 * 将任意返回值标准化为 ToolResult
 * @param {unknown} raw
 * @returns {ToolResult}
 */
export function normalizeToolResult(raw) {
  // 已经是 ToolResult 格式
  if (raw && typeof raw === "object") {
    const obj = /** @type {Record<string, unknown>} */ (raw);
    if ("ok" in obj || "success" in obj) {
      const validated = validateToolResult(raw);
      if (validated.ok) return validated.value;
    }
    if (typeof obj.error === "string") {
      return {
        ok: false,
        success: false,
        data: obj.data,
        error: obj.error,
        meta: typeof obj.meta === "object" && obj.meta !== null && !Array.isArray(obj.meta)
          ? /** @type {Record<string, unknown>} */ (obj.meta)
          : undefined,
      };
    }
    if ("data" in obj) {
      return {
        ok: true,
        success: true,
        data: obj.data,
        error: undefined,
        meta: typeof obj.meta === "object" && obj.meta !== null && !Array.isArray(obj.meta)
          ? /** @type {Record<string, unknown>} */ (obj.meta)
          : undefined,
      };
    }
  }

  // Error 对象
  if (raw instanceof Error) {
    return {
      ok: false,
      success: false,
      error: raw.message,
      data: undefined,
      meta: { stack: raw.stack },
    };
  }

  // null/undefined
  if (raw === null || raw === undefined) {
    return {
      ok: true,
      success: true,
      data: null,
    };
  }

  // 原始值或未知对象 - 包装为 data
  return {
    ok: true,
    success: true,
    data: raw,
  };
}
