/**
 * URL 查询参数白名单协议
 *
 * 安全策略（P3.2）：
 * - 默认拒绝所有 query 参数
 * - 仅透传显式白名单中的无害参数
 * - 任何未知参数都被剥离
 */

/**
 * 默认安全参数白名单
 * 这些参数被认为是无害的搜索/分页参数
 */
export const DEFAULT_SAFE_PARAMS = Object.freeze([
  // 搜索查询
  "q",
  "query",
  "search",
  "keyword",
  "keywords",
  "term",
  "text",

  // 分页
  "page",
  "p",
  "offset",
  "start",
  "from",
  "limit",
  "size",
  "count",
  "per_page",
  "pagesize",

  // 排序
  "sort",
  "order",
  "orderby",
  "sortby",
  "dir",
  "direction",

  // 筛选（通用）
  "type",
  "category",
  "cat",
  "filter",
  "lang",
  "language",
  "locale",
  "region",

  // 时间范围
  "time",
  "date",
  "period",
  "range",
  "df", // DuckDuckGo time filter

  // 格式
  "format",
  "output",
  "view",
]);

/**
 * 创建参数白名单集合
 * @param {string[]} [additionalParams] - 额外允许的参数
 * @returns {Set<string>}
 */
export function createWhitelist(additionalParams = []) {
  const set = new Set(DEFAULT_SAFE_PARAMS.map((p) => p.toLowerCase()));
  if (Array.isArray(additionalParams)) {
    for (const p of additionalParams) {
      if (typeof p === "string" && p) set.add(p.toLowerCase());
    }
  }
  return set;
}

/**
 * 检查参数是否在白名单中
 * @param {string} key - 参数名
 * @param {Set<string>} [whitelist] - 白名单集合
 * @returns {boolean}
 */
export function isAllowedParam(key, whitelist = null) {
  const k = String(key || "").toLowerCase().trim();
  if (!k) return false;
  const wl = whitelist instanceof Set ? whitelist : createWhitelist();
  return wl.has(k);
}

/**
 * 过滤 URL 中的查询参数，仅保留白名单中的参数
 * @param {string} url - 原始 URL
 * @param {object} [options]
 * @param {string[]} [options.additionalParams] - 额外允许的参数
 * @param {boolean} [options.logStripped=false] - 是否记录被剥离的参数
 * @returns {{ url: string, strippedParams: string[] }}
 */
export function filterUrlParams(url, { additionalParams, logStripped = false } = {}) {
  const strippedParams = [];

  if (!url || typeof url !== "string") {
    return { url: url || "", strippedParams };
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    // 无效 URL，原样返回
    return { url, strippedParams };
  }

  const whitelist = createWhitelist(additionalParams);
  const keysToRemove = [];

  for (const key of parsed.searchParams.keys()) {
    if (!isAllowedParam(key, whitelist)) {
      keysToRemove.push(key);
      strippedParams.push(key);
    }
  }

  for (const key of keysToRemove) {
    parsed.searchParams.delete(key);
  }

  // 同时清除 hash（可能包含敏感信息，如 OAuth implicit flow）
  if (parsed.hash) {
    strippedParams.push("#hash");
    parsed.hash = "";
  }

  // 清除 credentials
  if (parsed.username || parsed.password) {
    strippedParams.push("@credentials");
    parsed.username = "";
    parsed.password = "";
  }

  if (logStripped && strippedParams.length > 0) {
    console.warn(`[url-whitelist] Stripped params from URL: ${strippedParams.join(", ")}`);
  }

  return { url: parsed.toString(), strippedParams };
}

/**
 * 严格模式：完全剥离所有查询参数
 * @param {string} url - 原始 URL
 * @returns {string}
 */
export function stripAllParams(url) {
  if (!url || typeof url !== "string") return url || "";

  try {
    const parsed = new URL(url);
    parsed.search = "";
    parsed.hash = "";
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    // 无效 URL，尝试简单处理
    const [base] = url.split("?");
    const [noHash] = (base || url).split("#");
    return noHash || url;
  }
}

/**
 * 审计 URL 安全性
 * @param {string} url - 要检查的 URL
 * @returns {{ safe: boolean, issues: string[], sanitizedUrl: string }}
 */
export function auditUrl(url) {
  const issues = [];

  if (!url || typeof url !== "string") {
    return { safe: false, issues: ["Invalid URL"], sanitizedUrl: "" };
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { safe: false, issues: ["Malformed URL"], sanitizedUrl: url };
  }

  // 检查协议
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    issues.push(`Unsafe protocol: ${parsed.protocol}`);
  }

  // 检查 credentials
  if (parsed.username || parsed.password) {
    issues.push("URL contains credentials");
  }

  // 检查 hash
  if (parsed.hash) {
    issues.push("URL contains hash fragment");
  }

  // 检查非白名单参数
  const whitelist = createWhitelist();
  const suspiciousParams = [];
  for (const key of parsed.searchParams.keys()) {
    if (!isAllowedParam(key, whitelist)) {
      suspiciousParams.push(key);
    }
  }
  if (suspiciousParams.length > 0) {
    issues.push(`Non-whitelisted params: ${suspiciousParams.join(", ")}`);
  }

  // 生成清理后的 URL
  const { url: sanitizedUrl } = filterUrlParams(url);

  return {
    safe: issues.length === 0,
    issues,
    sanitizedUrl,
  };
}

/**
 * 为 MCP 代理创建安全的请求 URL
 * @param {string} url - 原始 URL
 * @param {object} [options]
 * @param {boolean} [options.strict=true] - 严格模式（剥离所有非白名单参数）
 * @param {string[]} [options.additionalParams] - 额外允许的参数
 * @returns {{ url: string, audit: { safe: boolean, issues: string[] } }}
 */
export function prepareUrlForProxy(url, { strict = true, additionalParams } = {}) {
  const audit = auditUrl(url);

  if (strict) {
    const { url: filteredUrl } = filterUrlParams(url, { additionalParams });
    return { url: filteredUrl, audit };
  }

  return { url: audit.sanitizedUrl, audit };
}

export default {
  DEFAULT_SAFE_PARAMS,
  createWhitelist,
  isAllowedParam,
  filterUrlParams,
  stripAllParams,
  auditUrl,
  prepareUrlForProxy,
};
