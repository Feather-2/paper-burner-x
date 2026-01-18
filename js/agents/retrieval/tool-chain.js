/**
 * Tool Chain: 封装 Grep/Glob/Read 工具链，提供多策略文件系统搜索能力
 *
 * 策略：
 * - glob-then-grep: 先 glob 定位文件范围，再 grep 精确匹配
 * - grep-only: 直接 grep（适用于小型代码库或无文件过滤需求）
 * - bm25-fallback: 工具链失败时回退到 BM25 语义搜索
 *
 * 性能优化：
 * - glob 结果缓存（避免重复文件扫描）
 * - 超时控制（单次调用≤200ms）
 * - 自动降级策略
 * - Fail-fast schema 校验
 */

import { grepChunks, grepChunksAsync } from "./grep.js";
import { isPlainObject, toNonEmptyString } from "../shared/utils/value-utils.js";
import {
  validateChunks,
  validateSearchQuery,
  ValidationErrorCode,
  createValidationError,
} from "../shared/utils/schema-validator.js";

function stripQueryAndHash(value) {
  const s = String(value ?? "");
  if (!s) return "";
  const hashIdx = s.indexOf("#");
  const queryIdx = s.indexOf("?");
  let cut = s.length;
  if (hashIdx >= 0) cut = Math.min(cut, hashIdx);
  if (queryIdx >= 0) cut = Math.min(cut, queryIdx);
  return s.slice(0, cut);
}

function normalizePathLike(value) {
  let s = stripQueryAndHash(value);
  if (!s) return "";

  if (s.startsWith("file://")) {
    try {
      s = new URL(s).pathname || s;
    } catch {
      // ignore
    }
  }

  s = s.replace(/\\/g, "/");
  while (s.startsWith("./")) s = s.slice(2);

  const parts = [];
  for (const seg of s.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (parts.length && parts[parts.length - 1] !== "..") parts.pop();
      else parts.push("..");
      continue;
    }
    parts.push(seg);
  }
  return parts.join("/");
}

function normalizeSafeRelativePath(value) {
  const raw = toNonEmptyString(value);
  if (!raw) return null;
  if (raw.includes("\0")) return null;
  if (/^[a-zA-Z]+:\/\//.test(raw)) return null;

  const normalized = normalizePathLike(raw);
  if (!normalized) return null;
  if (normalized === ".." || normalized.startsWith("../")) return null;
  return normalized;
}

function chunkMatchesFileFilter(chunk, fileFilter) {
  if (!fileFilter || fileFilter.size === 0) return true;
  const sourceRaw = toNonEmptyString(chunk?.sourceId) || toNonEmptyString(chunk?.chunkId) || "";
  const sourceId = normalizePathLike(sourceRaw);
  if (!sourceId) return false;

  for (const f of fileFilter) {
    if (sourceId === f) return true;
    if (sourceId.endsWith(`/${f}`)) return true;
  }
  return false;
}

/**
 * ToolChain 策略枚举
 * @readonly
 * @enum {string}
 */
export const ToolChainStrategy = Object.freeze({
  AUTO: "auto",
  GLOB_THEN_GREP: "glob-then-grep",
  GREP_ONLY: "grep-only",
});

/**
 * 规范化 ToolChain 策略
 */
export function normalizeToolChainStrategy(value) {
  const s = toNonEmptyString(value)?.toLowerCase();
  if (!s) return null;
  return Object.values(ToolChainStrategy).includes(s) ? s : null;
}

// 全局 glob 缓存（避免重复扫描）
const globCache = new Map();
const GLOB_CACHE_TTL = 60000; // 60s

/**
 * 清理过期的 glob 缓存
 */
function pruneGlobCache() {
  const now = Date.now();
  for (const [key, entry] of globCache.entries()) {
    if (now - entry.timestamp > GLOB_CACHE_TTL) {
      globCache.delete(key);
    }
  }
}

/**
 * 获取缓存的 glob 结果
 */
function getCachedGlob(pattern, path) {
  pruneGlobCache();
  const key = `${pattern}::${path || ""}`;
  const entry = globCache.get(key);
  if (entry && Date.now() - entry.timestamp < GLOB_CACHE_TTL) {
    return entry.files;
  }
  return null;
}

/**
 * 设置 glob 缓存
 */
function setCachedGlob(pattern, path, files) {
  const key = `${pattern}::${path || ""}`;
  globCache.set(key, { files, timestamp: Date.now() });
}

/**
 * 执行 glob 搜索（文件系统级别）
 * @param {string} pattern - glob 模式，如 "**\/*.md"
 * @param {object} options
 * @param {string=} options.basePath - 搜索基础路径
 * @param {Function=} options.globTool - 外部 glob 工具（测试注入）
 * @param {number=} options.timeoutMs - 超时时间
 * @returns {Promise<{files: string[], fromCache: boolean, error?: string}>}
 */
async function executeGlob(pattern, options = {}) {
  const basePath = toNonEmptyString(options.basePath) || "";
  const timeoutMs = typeof options.timeoutMs === "number" ? options.timeoutMs : 200;
  const globTool = options.globTool;
  const signal = options.signal;

  // 检查缓存
  const cached = getCachedGlob(pattern, basePath);
  if (cached) {
    return { files: cached, fromCache: true };
  }

  if (!globTool) {
    return { files: [], fromCache: false, error: "no_glob_tool" };
  }

  if (signal?.aborted) return { files: [], fromCache: false, error: "aborted" };

  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const abort = () => controller?.abort();
  if (signal && controller) signal.addEventListener?.("abort", abort, { once: true });

  let timeoutId = null;
  try {
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        controller?.abort();
        reject(new Error("glob_timeout"));
      }, timeoutMs);
    });

    const globPromise = (async () => {
      const result = await globTool({
        pattern,
        path: basePath,
        ...(controller?.signal ? { signal: controller.signal } : signal ? { signal } : {}),
      });
      return result;
    })();

    const result = await Promise.race([globPromise, timeoutPromise]);
    if (!Array.isArray(result)) {
      return { files: [], fromCache: false, error: "invalid_glob_result" };
    }
    const files = result.filter((f) => typeof f === "string");

    // 缓存结果
    setCachedGlob(pattern, basePath, files);

    return { files, fromCache: false };
  } catch (err) {
    const msg = err?.message || String(err);
    if (msg.includes("timeout")) {
      return { files: [], fromCache: false, error: "timeout" };
    }
    if (msg.includes("aborted")) {
      return { files: [], fromCache: false, error: "aborted" };
    }
    return { files: [], fromCache: false, error: "glob_failed" };
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
    if (signal && controller) signal.removeEventListener?.("abort", abort);
  }
}

/**
 * 执行 grep 搜索（内容级别）
 * @param {Array<{chunkId:string,text:string}>} chunks
 * @param {string} keyword
 * @param {object} options
 * @returns {{matches: Array, error?: string}}
 */
function executeGrep(chunks, keyword, options = {}) {
  if (!Array.isArray(chunks) || chunks.length === 0) {
    return { matches: [], error: "no_chunks" };
  }

  try {
    const matches = grepChunks(chunks, keyword, {
      regex: Boolean(options.regex),
      caseSensitive: Boolean(options.caseSensitive),
    });
    return { matches, error: undefined };
  } catch (err) {
    return { matches: [], error: String(err?.message || err) };
  }
}

function shouldUseAsyncGrep(chunks, keywords, tools = {}) {
  const opts = tools && typeof tools === "object" ? tools : {};
  if (opts.async === true || opts.asyncGrep === true) return true;
  if (opts.signal && typeof opts.signal === "object") return true;
  const yieldEvery = opts.grepYieldEvery ?? opts.yieldEvery;
  if (typeof yieldEvery === "number" && Number.isFinite(yieldEvery) && yieldEvery > 0) return true;

  const c = Array.isArray(chunks) ? chunks.length : 0;
  const k = Array.isArray(keywords) ? keywords.length : 0;
  const threshold = typeof opts.grepAsyncThreshold === "number" && Number.isFinite(opts.grepAsyncThreshold) ? Math.max(0, Math.floor(opts.grepAsyncThreshold)) : 2000;
  return c >= threshold || c * Math.max(1, k) >= threshold * 2;
}

async function executeGrepAsync(chunks, keyword, tools = {}) {
  if (!Array.isArray(chunks) || chunks.length === 0) {
    return { matches: [], error: "no_chunks" };
  }

  const opts = tools && typeof tools === "object" ? tools : {};
  const useAsync = shouldUseAsyncGrep(chunks, [keyword], opts);
  const signal = opts.signal;
  const yieldEvery = opts.grepYieldEvery ?? opts.yieldEvery;

  try {
    const matches = useAsync
      ? await grepChunksAsync(chunks, keyword, {
          regex: Boolean(opts.regex),
          caseSensitive: Boolean(opts.caseSensitive),
          signal,
          ...(yieldEvery !== undefined ? { yieldEvery } : {}),
        })
      : grepChunks(chunks, keyword, {
          regex: Boolean(opts.regex),
          caseSensitive: Boolean(opts.caseSensitive),
        });
    return { matches, error: undefined };
  } catch (err) {
    return { matches: [], error: String(err?.message || err) };
  }
}

/**
 * 策略：glob-then-grep
 * 先用 glob 定位文件，再用 grep 搜索内容
 */
async function strategyGlobThenGrep(chunks, { patterns = [], keywords = [] }, tools = {}) {
  const results = [];
  const stats = { globCalls: 0, grepCalls: 0, cached: 0, hits: 0 };

  // 1. Glob 阶段：定位文件范围
  const fileFilter = new Set();
  let hadPatterns = false;
  let rejectedPaths = 0;
  for (const pattern of patterns) {
    const p = toNonEmptyString(pattern);
    if (!p) continue;
    hadPatterns = true;

    stats.globCalls++;
    const { files, fromCache, error } = await executeGlob(p, tools);

    if (error) {
      // glob 失败，降级到 grep-only
      return { results: [], stats, fallbackReason: `glob_failed:${error}` };
    }

    if (fromCache) stats.cached++;

    for (const f of files) {
      const normalized = normalizeSafeRelativePath(f);
      if (normalized) fileFilter.add(normalized);
      else rejectedPaths += 1;
    }
  }

  // patterns 存在但未能产生任何可用文件路径：认为 glob 失败（避免“静默退化”为全量 grep）
  if (hadPatterns && fileFilter.size === 0) {
    return {
      results: [],
      stats,
      fallbackReason: rejectedPaths > 0 ? `glob_invalid_paths:${rejectedPaths}` : "glob_no_matches",
    };
  }

  // 如果有文件过滤，过滤 chunks
  let targetChunks = chunks;
  if (fileFilter.size > 0) {
    targetChunks = chunks.filter((c) => chunkMatchesFileFilter(c, fileFilter));
  }

  if (targetChunks.length === 0) {
    return { results: [], stats, fallbackReason: "no_chunks_after_glob" };
  }

  // 2. Grep 阶段：精确匹配关键词
  for (const keyword of keywords) {
    if (!toNonEmptyString(keyword)) continue;

    stats.grepCalls++;
    const { matches, error } = await executeGrepAsync(targetChunks, keyword, tools);

    if (error) {
      return { results: [], stats, fallbackReason: `grep_failed:${error}` };
    }

    for (const m of matches) {
      results.push({
        chunkId: m.chunkId,
        matchCount: m.matchCount,
        spans: m.spans,
        keyword,
        strategy: "glob-then-grep",
      });
      stats.hits++;
    }
  }

  return { results, stats, fallbackReason: undefined };
}

/**
 * 策略：grep-only
 * 直接 grep 搜索所有 chunks（无文件过滤）
 */
async function strategyGrepOnly(chunks, { keywords = [] }, tools = {}) {
  const results = [];
  const stats = { grepCalls: 0, hits: 0 };

  for (const keyword of keywords) {
    if (!toNonEmptyString(keyword)) continue;

    stats.grepCalls++;
    const { matches, error } = await executeGrepAsync(chunks, keyword, tools);

    if (error) {
      return { results: [], stats, fallbackReason: `grep_failed:${error}` };
    }

    for (const m of matches) {
      results.push({
        chunkId: m.chunkId,
        matchCount: m.matchCount,
        spans: m.spans,
        keyword,
        strategy: "grep-only",
      });
      stats.hits++;
    }
  }

  return { results, stats, fallbackReason: undefined };
}

/**
 * @typedef {object} SearchSuccessResult
 * @property {true} ok - 成功标记
 * @property {Array} results - 搜索结果
 * @property {object} stats - 统计信息
 * @property {string} strategy - 使用的策略
 * @property {string=} fallbackReason - 降级原因（如有）
 * @property {string=} originalStrategy - 原始策略（降级时）
 */

/**
 * @typedef {object} SearchValidationError
 * @property {false} ok - 失败标记
 * @property {string} code - 错误代码
 * @property {string} message - 错误信息
 * @property {object=} details - 错误详情
 */

/**
 * 工具链主入口：多策略搜索
 *
 * @param {Array<{chunkId:string,text:string,sourceId?:string}>} chunks
 * @param {object} query
 * @param {string} query.strategy - 策略：'glob-then-grep' | 'grep-only' | 'auto'
 * @param {string[]=} query.patterns - glob 模式列表
 * @param {string[]=} query.keywords - 关键词列表
 * @param {object=} tools - 工具注入点
 * @param {Function=} tools.globTool - glob 工具
 * @param {string=} tools.basePath - 基础路径
 * @param {boolean=} tools.regex - 是否启用正则
 * @param {boolean=} tools.caseSensitive - 是否大小写敏感
 * @param {number=} tools.timeoutMs - 超时时间
 * @returns {Promise<SearchSuccessResult | SearchValidationError>}
 */
export async function search(chunks, query = {}, tools = {}) {
  // Fail-fast: schema validation
  const chunksValidation = validateChunks(chunks, { allowEmpty: false, maxErrors: 5 });
  if (!chunksValidation.ok) {
    return createValidationError(
      ValidationErrorCode.INVALID_CHUNKS,
      "Invalid chunks structure",
      { errors: chunksValidation.errors }
    );
  }

  const queryValidation = validateSearchQuery(query);
  if (!queryValidation.ok) {
    return createValidationError(
      ValidationErrorCode.INVALID_QUERY,
      "Invalid query structure",
      { errors: queryValidation.errors }
    );
  }

  const validatedChunks = chunksValidation.value;
  const { strategy: rawStrategy, patterns, keywords } = queryValidation.value;

  const strategy = normalizeToolChainStrategy(rawStrategy) || ToolChainStrategy.AUTO;

  if (keywords.length === 0) {
    return createValidationError(
      ValidationErrorCode.NO_KEYWORDS,
      "No keywords provided",
      { strategy: "none" }
    );
  }

  let result;

  // 策略选择
  if (strategy === ToolChainStrategy.GREP_ONLY) {
    result = await strategyGrepOnly(validatedChunks, { keywords }, tools);
    return { ...result, strategy: "grep-only", ok: true };
  }

  // glob-then-grep 需要有 patterns 才有意义，否则降级到 grep-only
  if ((strategy === ToolChainStrategy.GLOB_THEN_GREP || strategy === ToolChainStrategy.AUTO) && patterns.length > 0) {
    result = await strategyGlobThenGrep(validatedChunks, { patterns, keywords }, tools);

    // 如果 glob-then-grep 失败，降级到 grep-only
    if (result.fallbackReason) {
      const fallbackResult = await strategyGrepOnly(validatedChunks, { keywords }, tools);
      return {
        ...fallbackResult,
        ok: true,
        strategy: ToolChainStrategy.GREP_ONLY,
        originalStrategy: ToolChainStrategy.GLOB_THEN_GREP,
        fallbackReason: result.fallbackReason,
      };
    }

    return { ...result, strategy: ToolChainStrategy.GLOB_THEN_GREP, ok: true };
  }

  // 默认：grep-only
  result = await strategyGrepOnly(validatedChunks, { keywords }, tools);
  return { ...result, strategy: ToolChainStrategy.GREP_ONLY, ok: true };
}

/**
 * 清除 glob 缓存（供测试使用）
 */
export function clearGlobCache() {
  globCache.clear();
}

/**
 * 获取缓存统计（供测试使用）
 */
export function getGlobCacheStats() {
  pruneGlobCache();
  return {
    size: globCache.size,
    keys: Array.from(globCache.keys()),
  };
}

export const __test = {
  executeGlob,
  executeGrep,
  executeGrepAsync,
  strategyGlobThenGrep,
  strategyGrepOnly,
  getCachedGlob,
  setCachedGlob,
  pruneGlobCache,
};
