/**
 * Prompt Loader Helpers - extracted utility functions for prompt-loader.
 */

import { isNodeLike, toNonEmptyString } from "../shared/index.js";

const PROMPT_CACHE_KEY_SEPARATOR = "::";

// Web Worker 中 localStorage 不可用，使用内存缓存降级
const isWorkerEnv = typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope;
const memoryCache = new Map();

/**
 * `require` is a CommonJS-only global. This file is ESM, but we keep `typeof require`
 * checks for compatibility; declare it so TypeScript can typecheck without @types/node.
 * @type {((id: string) => unknown) | undefined}
 */
// eslint-disable-next-line no-var
var require;

/**
 * `__dirname` is a CommonJS-only global. This file is ESM, but we keep `typeof __dirname`
 * checks for compatibility; declare it so TypeScript can typecheck without @types/node.
 * @type {string|undefined}
 */
// eslint-disable-next-line no-var
var __dirname;

/**
 * Minimal Node-like process type (avoid @types/node).
 * @typedef {{ env?: Record<string, string | undefined>, platform?: string }} NodeProcessLike
 */

/**
 * Minimal sync fs subset used by this module (avoid @types/node).
 * @typedef {{
 *   realpathSync: (path: string) => string,
 *   statSync: (path: string) => { size?: number },
 *   readFileSync: (path: string, encoding: string) => string,
 * }} FsSyncLike
 */

/**
 * Minimal path module subset used by this module (avoid @types/node).
 * @typedef {{
 *   resolve: (...paths: string[]) => string,
 *   relative: (from: string, to: string) => string,
 *   isAbsolute: (path: string) => boolean,
 * }} PathLike
 */

/**
 * @typedef {{ fs: FsSyncLike, path: PathLike }} SyncNodeModules
 */

export function getCacheItem(key) {
  if (isWorkerEnv) return memoryCache.get(key) ?? null;
  try {
    return typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
  } catch {
    return memoryCache.get(key) ?? null;
  }
}

export function setCacheItem(key, value) {
  if (isWorkerEnv) {
    memoryCache.set(key, value);
    return;
  }
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(key, value);
  } catch {
    memoryCache.set(key, value);
  }
}

export function getNodeProcess() {
  return /** @type {NodeProcessLike | undefined} */ (
    /** @type {Record<string, unknown>} */ (globalThis).process
  );
}

export function normalizeMaxBytes(value, fallback) {
  if (value === Infinity) return Infinity;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const n = Math.floor(parsed);
  return n > 0 ? n : fallback;
}

export function createResponseTooLargeError(context, maxBytes, observedBytes) {
  const err = /** @type {Error & { code?: string, maxBytes?: number, observedBytes?: number }} */ (
    new Error(`${context} exceeds limit (${observedBytes} > ${maxBytes} bytes)`)
  );
  err.name = "ResponseTooLargeError";
  err.code = "ERESPONSE_TOO_LARGE";
  err.maxBytes = maxBytes;
  err.observedBytes = observedBytes;
  return err;
}

export function tryGetHeader(response, name) {
  try {
    const headers = response?.headers;
    if (headers && typeof headers.get === "function") return headers.get(name);
  } catch {
    // ignore
  }
  return null;
}

export async function tryReadTextWithLimit(
  response,
  { maxBytes, context } = /** @type {{ maxBytes?: number, context?: string }} */ ({})
) {
  const limit = normalizeMaxBytes(maxBytes, Infinity);
  const label = typeof context === "string" && context.trim() ? context.trim() : "Response body";

  if (limit !== Infinity) {
    const declared = (() => {
      const raw = tryGetHeader(response, "content-length");
      const n = raw ? Number.parseInt(String(raw), 10) : NaN;
      return Number.isFinite(n) ? n : null;
    })();
    if (declared !== null && declared > limit) {
      throw createResponseTooLargeError(label, limit, declared);
    }
  }

  const body = response?.body;
  if (body && typeof body.getReader === "function" && typeof TextDecoder === "function") {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    const parts = [];

    try {
      while (true) {
        // eslint-disable-next-line no-await-in-loop
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;

        bytes += value.byteLength || 0;
        if (limit !== Infinity && bytes > limit) {
          try {
            await reader.cancel();
          } catch {
            // ignore cancel errors
          }
          throw createResponseTooLargeError(label, limit, bytes);
        }

        parts.push(decoder.decode(value, { stream: true }));
      }
    } finally {
      parts.push(decoder.decode());
    }

    return parts.join("");
  }

  if (typeof response?.text === "function") {
    const text = await response.text();
    if (limit !== Infinity && text.length > limit) {
      throw createResponseTooLargeError(label, limit, text.length);
    }
    return text;
  }

  return null;
}

export function resolvePromptCacheMaxEntries() {
  const nodeProcess = getNodeProcess();
  const env = nodeProcess && typeof nodeProcess === "object" ? nodeProcess.env : null;
  const fromEnv = env?.PB_PROMPT_CACHE_MAX_ENTRIES;
  if (fromEnv !== undefined && fromEnv !== null) {
    const parsed = parseInt(String(fromEnv), 10);
    if (Number.isFinite(parsed)) return Math.max(0, parsed);
  }

  try {
    const raw = getCacheItem("pb_promptCacheMaxEntries");
    if (raw) {
      const parsed = parseInt(String(raw), 10);
      if (Number.isFinite(parsed)) return Math.max(0, parsed);
    }
  } catch {
    /* intentional: localStorage may be blocked */
  }

  return 128;
}

export function resolvePromptManifestCacheTtlMs() {
  const nodeProcess = getNodeProcess();
  const env = nodeProcess && typeof nodeProcess === "object" ? nodeProcess.env : null;
  const fromEnv = env?.PB_PROMPT_MANIFEST_CACHE_TTL_MS;
  if (fromEnv !== undefined && fromEnv !== null) {
    const parsed = parseInt(String(fromEnv), 10);
    if (Number.isFinite(parsed)) return Math.max(0, parsed);
  }

  try {
    const raw = getCacheItem("pb_promptManifestCacheTtlMs");
    if (raw) {
      const parsed = parseInt(String(raw), 10);
      if (Number.isFinite(parsed)) return Math.max(0, parsed);
    }
  } catch {
    /* intentional: localStorage may be blocked */
  }

  return 300_000;
}

export function enforcePromptCacheLimit(promptCache, limit) {
  if (!Number.isFinite(limit) || limit <= 0) return;
  while (promptCache.size > limit) {
    const oldest = promptCache.keys().next().value;
    promptCache.delete(oldest);
  }
}

export function lruGet(promptCache, key) {
  if (!promptCache.has(key)) return null;
  const value = promptCache.get(key);
  // Refresh insertion order (Map iteration order) to approximate LRU.
  promptCache.delete(key);
  promptCache.set(key, value);
  return value;
}

export function lruSet(promptCache, key, value, limit) {
  if (promptCache.has(key)) promptCache.delete(key);
  promptCache.set(key, value);
  enforcePromptCacheLimit(promptCache, limit);
}

export function makePromptCacheKey({ basePath, manifestUrl, promptKey }) {
  const base = toNonEmptyString(basePath);
  const manifest = toNonEmptyString(manifestUrl);
  const ns = `${base || ""}|${manifest || ""}`;
  return `${ns}${PROMPT_CACHE_KEY_SEPARATOR}${promptKey}`;
}

/**
 * 获取提示词目录的基础路径
 *
 * 修复 Windows 路径问题：使用 fileURLToPath 正确转换
 */
export function getBasePath() {
  // Browser/Worker
  if (!isNodeLike()) {
    try {
      const url = new URL(".", import.meta.url);
      return url.toString();
    } catch {
      return "/js/agents/prompts/";
    }
  }

  // Node.js CJS 环境
  if (typeof __dirname !== "undefined") {
    return __dirname;
  }

  // Node.js ESM 环境 - 使用 import.meta.url
  try {
    const moduleUrl = new URL(".", import.meta.url);
    // 检查是否是 file:// URL（本地文件）
    if (moduleUrl.protocol === "file:") {
      // 使用 decodeURIComponent 处理 URL 编码的路径
      // 并移除 Windows 路径的前导斜杠（如 /C:/...）
      let pathname = decodeURIComponent(moduleUrl.pathname);
      const nodeProcess = getNodeProcess();
      if (nodeProcess?.platform === "win32" && pathname.startsWith("/")) {
        pathname = pathname.slice(1);
      }
      return pathname;
    }
    return moduleUrl.pathname;
  } catch {
    return "./";
  }
}

/**
 * 验证提示词 Key 是否安全，防止路径穿越
 */
export function validateKey(key) {
  if (typeof key !== "string") return false;
  // 仅允许字母、数字、下划线、中划线和斜杠
  // 严禁 ".." 路径
  if (key.includes("..")) return false;
  return /^[a-zA-Z0-9_\-\/]+$/.test(key);
}

export function resolveUrl(pathOrUrl) {
  const raw = toNonEmptyString(pathOrUrl);
  if (!raw) return "";
  try {
    return new URL(raw, globalThis.location?.href).toString();
  } catch {
    return raw;
  }
}

export function isSafeHttpUrl(url) {
  try {
    const u = new URL(url, globalThis.location?.href);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function isPathInsideBase(resolvedPath, basePath, pathModule) {
  const rel = pathModule.relative(basePath, resolvedPath);
  return rel && !rel.startsWith("..") && !pathModule.isAbsolute(rel);
}

// Re-export the canonical backslash-based escape so callers that import from
// this module get the same implementation used by prompt-template.js's unescape.
export { escapeTemplateDelimiters } from "./formatters/escape-template-delimiters.js";

/**
 * 获取 Node.js 模块（安全处理 ESM/CJS 兼容性）
 * @returns {SyncNodeModules | null}
 */
export function getSyncNodeModules() {
  if (!isNodeLike()) return null;
  try {
    // 使用动态方式获取 fs 和 path，避免在 ESM 环境预加载阶段崩溃
    // 如果 require 不存在，说明是原生 ESM 且未处理兼容，抛出可控错误
    if (typeof require === "undefined") {
      // 在原生 ESM 环境下，通过 import.meta 获取
      return null;
    }
    /** @type {string} */
    const fsModule = "fs";
    /** @type {string} */
    const pathModule = "path";
    return {
      fs: /** @type {FsSyncLike} */ (/** @type {unknown} */ (require(fsModule))),
      path: /** @type {PathLike} */ (/** @type {unknown} */ (require(pathModule))),
    };
  } catch {
    return null;
  }
}

export function escapeRegExp(s) {
  return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeTemplateVars(vars) {
  const map = new Map();

  if (!vars) return map;

  const add = (rawKey, value) => {
    const key = typeof rawKey === "string" ? rawKey.trim().toLowerCase() : "";
    if (!key) return;
    map.set(key, value);
  };

  const flatten = (obj, prefix, depth) => {
    if (!obj || typeof obj !== "object") {
      add(prefix, obj);
      return;
    }
    if (Array.isArray(obj)) {
      add(prefix, obj);
      return;
    }
    if (depth <= 0) {
      add(prefix, obj);
      return;
    }

    for (const [k, v] of Object.entries(obj)) {
      const name = typeof k === "string" ? k.trim() : "";
      if (!name) continue;
      const next = prefix ? `${prefix}.${name}` : name;
      if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, next, depth - 1);
      else add(next, v);
    }
  };

  if (vars instanceof Map) {
    for (const [k, v] of vars.entries()) {
      add(k, v);
    }
    return map;
  }

  if (typeof vars === "object") {
    flatten(vars, "", 4);
  }

  return map;
}
