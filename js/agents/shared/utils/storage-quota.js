/**
 * Storage Quota Utilities
 *
 * 提供 localStorage/IndexedDB 存储配额检查和安全写入功能。
 * 浏览器端友好，避免静默失败。
 */

const DEFAULT_WARN_THRESHOLD = 0.8; // 80%
const DEFAULT_CRITICAL_THRESHOLD = 0.95; // 95%

/**
 * 检查 localStorage 是否可用
 */
export function hasLocalStorage() {
  try {
    return typeof localStorage !== "undefined" && !!localStorage && typeof localStorage.getItem === "function";
  } catch {
    return false;
  }
}

/**
 * 估算 localStorage 使用量（字节）
 * 注：localStorage 字符串按 UTF-16 存储，每个字符 2 字节
 */
export function estimateLocalStorageUsage() {
  if (!hasLocalStorage()) return { used: 0, keys: 0 };

  let total = 0;
  let keys = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key === null) continue;
      const value = localStorage.getItem(key);
      total += (key.length + (value?.length || 0)) * 2; // UTF-16
      keys++;
    }
  } catch {
    // 可能遇到配额错误
  }
  return { used: total, keys };
}

/**
 * 估算 localStorage 配额限制（字节）
 * 大多数浏览器限制为 5MB，但可能因浏览器/模式而异
 */
export function estimateLocalStorageQuota() {
  // 常见限制：5MB（Chrome/Firefox/Safari）, 10MB（某些 IE 版本）
  // 隐私模式可能更低
  return 5 * 1024 * 1024; // 5MB 保守估计
}

/**
 * 获取 localStorage 配额状态
 * @returns {{used: number, quota: number, ratio: number, status: 'ok'|'warn'|'critical'|'unavailable'}}
 */
export function getLocalStorageQuotaStatus({
  warnThreshold = DEFAULT_WARN_THRESHOLD,
  criticalThreshold = DEFAULT_CRITICAL_THRESHOLD,
} = {}) {
  if (!hasLocalStorage()) {
    return { used: 0, quota: 0, ratio: 0, status: "unavailable" };
  }

  const { used } = estimateLocalStorageUsage();
  const quota = estimateLocalStorageQuota();
  const ratio = quota > 0 ? used / quota : 0;

  let status = "ok";
  if (ratio >= criticalThreshold) status = "critical";
  else if (ratio >= warnThreshold) status = "warn";

  return { used, quota, ratio, status };
}

/**
 * 安全写入 localStorage，带配额检查
 * @param {string} key
 * @param {string} value
 * @param {Object} options
 * @returns {{ok: boolean, error?: string, quotaStatus?: object}}
 */
export function safeLocalStorageSet(key, value, {
  warnThreshold = DEFAULT_WARN_THRESHOLD,
  criticalThreshold = DEFAULT_CRITICAL_THRESHOLD,
  allowOverwrite = true,
  onQuotaWarn = null,
  onQuotaExceeded = null,
} = {}) {
  if (!hasLocalStorage()) {
    return { ok: false, error: "localStorage unavailable" };
  }

  const keyStr = String(key);
  const valueStr = String(value);
  const itemSize = (keyStr.length + valueStr.length) * 2;

  // 检查当前配额状态
  const quotaStatus = getLocalStorageQuotaStatus({ warnThreshold, criticalThreshold });

  // 预估写入后的使用量
  const existingValue = localStorage.getItem(keyStr);
  const existingSize = existingValue ? (keyStr.length + existingValue.length) * 2 : 0;
  const deltaSize = itemSize - existingSize;
  const projectedUsed = quotaStatus.used + deltaSize;
  const projectedRatio = quotaStatus.quota > 0 ? projectedUsed / quotaStatus.quota : 0;

  // 警告回调
  if (projectedRatio >= warnThreshold && projectedRatio < criticalThreshold) {
    if (typeof onQuotaWarn === "function") {
      onQuotaWarn({ key: keyStr, itemSize, quotaStatus, projectedRatio });
    }
  }

  // 临界阈值检查
  if (projectedRatio >= criticalThreshold && !allowOverwrite) {
    if (typeof onQuotaExceeded === "function") {
      onQuotaExceeded({ key: keyStr, itemSize, quotaStatus, projectedRatio });
    }
    return {
      ok: false,
      error: "quota_exceeded",
      quotaStatus: { ...quotaStatus, projectedRatio },
    };
  }

  // 尝试写入
  try {
    localStorage.setItem(keyStr, valueStr);
    return { ok: true, quotaStatus };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const isQuotaError = errorMsg.includes("quota") || errorMsg.includes("QuotaExceededError");

    if (isQuotaError && typeof onQuotaExceeded === "function") {
      onQuotaExceeded({ key: keyStr, itemSize, quotaStatus, error: errorMsg });
    }

    return {
      ok: false,
      error: isQuotaError ? "quota_exceeded" : errorMsg,
      quotaStatus,
    };
  }
}

/**
 * 批量清理过期或低优先级的 localStorage 条目
 * @param {Object} options
 * @returns {{removed: number, freedBytes: number}}
 */
export function cleanupLocalStorage({
  prefixes = [],
  olderThanMs = null,
  maxItems = Infinity,
  keepKeys = [],
} = {}) {
  if (!hasLocalStorage()) return { removed: 0, freedBytes: 0 };

  const keepSet = new Set(keepKeys);
  const candidates = [];

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key === null || keepSet.has(key)) continue;

    // 检查前缀匹配
    const matchesPrefix = prefixes.length === 0 || prefixes.some((p) => key.startsWith(p));
    if (!matchesPrefix) continue;

    const value = localStorage.getItem(key);
    const size = (key.length + (value?.length || 0)) * 2;

    // 尝试解析时间戳（如果值是 JSON 且包含 ts/updatedAt）
    let timestamp = 0;
    try {
      const parsed = JSON.parse(value || "");
      timestamp = parsed?.ts || parsed?.updatedAt || parsed?.createdAt || 0;
      if (typeof timestamp === "string") timestamp = new Date(timestamp).getTime() || 0;
    } catch {
      // 非 JSON，无法获取时间戳
    }

    candidates.push({ key, size, timestamp });
  }

  // 按时间戳排序（旧的优先删除）
  candidates.sort((a, b) => a.timestamp - b.timestamp);

  let removed = 0;
  let freedBytes = 0;
  const now = Date.now();

  for (const { key, size, timestamp } of candidates) {
    if (removed >= maxItems) break;

    // 检查时间过滤
    if (olderThanMs !== null && timestamp > 0) {
      if (now - timestamp < olderThanMs) continue;
    }

    try {
      localStorage.removeItem(key);
      removed++;
      freedBytes += size;
    } catch {
      // 忽略删除错误
    }
  }

  return { removed, freedBytes };
}

/**
 * 获取 IndexedDB 存储估算（如果可用）
 * 使用 Storage API (navigator.storage.estimate)
 * @returns {Promise<{used: number, quota: number, ratio: number, status: string}>}
 */
export async function getIndexedDBQuotaStatus({
  warnThreshold = DEFAULT_WARN_THRESHOLD,
  criticalThreshold = DEFAULT_CRITICAL_THRESHOLD,
} = {}) {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) {
    return { used: 0, quota: 0, ratio: 0, status: "unavailable" };
  }

  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    const ratio = quota > 0 ? usage / quota : 0;

    let status = "ok";
    if (ratio >= criticalThreshold) status = "critical";
    else if (ratio >= warnThreshold) status = "warn";

    return { used: usage, quota, ratio, status };
  } catch {
    return { used: 0, quota: 0, ratio: 0, status: "error" };
  }
}

export default {
  hasLocalStorage,
  estimateLocalStorageUsage,
  estimateLocalStorageQuota,
  getLocalStorageQuotaStatus,
  safeLocalStorageSet,
  cleanupLocalStorage,
  getIndexedDBQuotaStatus,
};
