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
 */

import { grepChunks, grepChunksAsync } from "./grep.js";

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function toNonEmptyString(v) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
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
  if (!s) return undefined;
  return Object.values(ToolChainStrategy).includes(s) ? s : undefined;
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

  // 检查缓存
  const cached = getCachedGlob(pattern, basePath);
  if (cached) {
    return { files: cached, fromCache: true };
  }

  if (!globTool) {
    return { files: [], fromCache: false, error: "no_glob_tool" };
  }

  try {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("glob_timeout")), timeoutMs)
    );

    const globPromise = (async () => {
      const result = await globTool({ pattern, path: basePath });
      return result;
    })();

    const result = await Promise.race([globPromise, timeoutPromise]);
    const files = Array.isArray(result) ? result : [];

    // 缓存结果
    setCachedGlob(pattern, basePath, files);

    return { files, fromCache: false };
  } catch (err) {
    const msg = err?.message || String(err);
    if (msg.includes("timeout")) {
      return { files: [], fromCache: false, error: "timeout" };
    }
    return { files: [], fromCache: false, error: "glob_failed" };
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
  for (const pattern of patterns) {
    if (!toNonEmptyString(pattern)) continue;

    stats.globCalls++;
    const { files, fromCache, error } = await executeGlob(pattern, tools);

    if (error) {
      // glob 失败，降级到 grep-only
      return { results: [], stats, fallbackReason: `glob_failed:${error}` };
    }

    if (fromCache) stats.cached++;

    for (const f of files) {
      fileFilter.add(f);
    }
  }

  // 如果有文件过滤，过滤 chunks
  let targetChunks = chunks;
  if (fileFilter.size > 0) {
    targetChunks = chunks.filter((c) => {
      const sourceId = c?.sourceId || c?.chunkId || "";
      for (const f of fileFilter) {
        if (sourceId.includes(f)) return true;
      }
      return false;
    });
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
 * @returns {Promise<{results: Array, stats: object, strategy: string, fallbackReason?: string}>}
 */
export async function search(chunks, query = {}, tools = {}) {
  if (!Array.isArray(chunks)) {
    throw new TypeError("search(chunks, query, tools): chunks must be an array");
  }
  if (!isPlainObject(query)) {
    throw new TypeError("search(chunks, query, tools): query must be an object");
  }

  const strategy = normalizeToolChainStrategy(query.strategy) || ToolChainStrategy.AUTO;
  const patterns = Array.isArray(query.patterns) ? query.patterns : [];
  const keywords = Array.isArray(query.keywords) ? query.keywords : [];

  if (keywords.length === 0) {
    return { results: [], stats: {}, strategy: "none", fallbackReason: "no_keywords" };
  }

  let result;

  // 策略选择
  if (strategy === ToolChainStrategy.GREP_ONLY) {
    result = await strategyGrepOnly(chunks, { keywords }, tools);
    return { ...result, strategy: "grep-only" };
  }

  // glob-then-grep 需要有 patterns 才有意义，否则降级到 grep-only
  if ((strategy === ToolChainStrategy.GLOB_THEN_GREP || strategy === ToolChainStrategy.AUTO) && patterns.length > 0) {
    result = await strategyGlobThenGrep(chunks, { patterns, keywords }, tools);

    // 如果 glob-then-grep 失败，降级到 grep-only
    if (result.fallbackReason) {
      const fallbackResult = strategyGrepOnly(chunks, { keywords }, tools);
      return {
        ...fallbackResult,
        strategy: ToolChainStrategy.GREP_ONLY,
        originalStrategy: ToolChainStrategy.GLOB_THEN_GREP,
        fallbackReason: result.fallbackReason,
      };
    }

    return { ...result, strategy: ToolChainStrategy.GLOB_THEN_GREP };
  }

  // 默认：grep-only
  result = await strategyGrepOnly(chunks, { keywords }, tools);
  return { ...result, strategy: ToolChainStrategy.GREP_ONLY };
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
