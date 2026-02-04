/**
 * Prompt Loader - 加载 markdown 格式的提示词文件
 *
 * 支持浏览器和 Node.js 环境
 */

import { createLogger } from "../shared/index.js";

import { isPlainObject, toNonEmptyString } from "../shared/index.js";
import { isNodeLike } from "../shared/index.js";
const logger = createLogger("prompts/prompt-loader");

// === 跨环境缓存适配器 ===
// Web Worker 中 localStorage 不可用，使用内存缓存降级
const isWorkerEnv = typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope;
const memoryCache = new Map();

function getCacheItem(key) {
  if (isWorkerEnv) return memoryCache.get(key) ?? null;
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
  } catch {
    return memoryCache.get(key) ?? null;
  }
}

function setCacheItem(key, value) {
  if (isWorkerEnv) {
    memoryCache.set(key, value);
    return;
  }
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
  } catch {
    memoryCache.set(key, value);
  }
}

function getNodeProcess() {
  return /** @type {NodeProcessLike | undefined} */ (/** @type {Record<string, unknown>} */ (globalThis).process);
}

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
 * Minimal fs/promises subset used by this module (avoid @types/node).
 * @typedef {{
 *   realpath: (path: string) => Promise<string>,
 *   stat: (path: string) => Promise<{ size?: number }>,
 *   readFile: (path: string, encoding: string) => Promise<string>,
 * }} FsPromisesLike
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

/**
 * @typedef {object} PromptLoaderOptions
 * @property {number=} maxEntries
 * @property {number=} manifestTtlMs
 * @property {number=} maxManifestBytes
 * @property {number=} maxPromptBytes
 * @property {string=} basePath
 * @property {typeof fetch=} fetchImpl
 */

/**
 * @typedef {object} PromptCacheConfig
 * @property {number=} maxEntries
 * @property {number=} manifestTtlMs
 */

/**
 * @typedef {object} LoadPromptOptions
 * @property {boolean=} cache
 * @property {string=} manifestUrl
 */

/**
 * @typedef {Map<string, unknown> | Record<string, unknown>} PromptTemplateVars
 */

/**
 * @typedef {object} RenderPromptTemplateOptions
 * @property {PromptTemplateVars=} vars
 * @property {Record<string, string>=} appendIfMissing
 * @property {boolean=} keepUnresolved
 * @property {boolean=} warnOnUnresolved
 * @property {boolean=} failOnUnresolved
 * @property {(names: string[]) => void=} onUnresolved
 * @property {boolean=} escapeVars
 */

/**
 * @typedef {{name: string, path: string}} PromptManifestEntry
 */

/**
 * @typedef {{url: string, ts: number, byName: Map<string, PromptManifestEntry>}} PromptManifest
 */

const PROMPT_CACHE_KEY_SEPARATOR = "::";

const DEFAULT_MAX_MANIFEST_BYTES = 512 * 1024; // 512 KiB
const DEFAULT_MAX_PROMPT_BYTES = 2 * 1024 * 1024; // 2 MiB

function normalizeMaxBytes(value, fallback) {
  if (value === Infinity) return Infinity;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const n = Math.floor(parsed);
  return n > 0 ? n : fallback;
}

function createResponseTooLargeError(context, maxBytes, observedBytes) {
  const err = /** @type {Error & { code?: string, maxBytes?: number, observedBytes?: number }} */ (
    new Error(`${context} exceeds limit (${observedBytes} > ${maxBytes} bytes)`)
  );
  err.name = "ResponseTooLargeError";
  err.code = "ERESPONSE_TOO_LARGE";
  err.maxBytes = maxBytes;
  err.observedBytes = observedBytes;
  return err;
}

function tryGetHeader(response, name) {
  try {
    const headers = response?.headers;
    if (headers && typeof headers.get === "function") return headers.get(name);
  } catch {
    // ignore
  }
  return null;
}

async function tryReadTextWithLimit(
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

function resolvePromptCacheMaxEntries() {
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
  } catch { /* intentional: localStorage may be blocked */ }

  return 128;
}

function resolvePromptManifestCacheTtlMs() {
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
  } catch { /* intentional: localStorage may be blocked */ }

  return 300_000;
}

function enforcePromptCacheLimit(promptCache, limit) {
  if (!Number.isFinite(limit) || limit <= 0) return;
  while (promptCache.size > limit) {
    const oldest = promptCache.keys().next().value;
    promptCache.delete(oldest);
  }
}

function lruGet(promptCache, key) {
  if (!promptCache.has(key)) return null;
  const value = promptCache.get(key);
  // Refresh insertion order (Map iteration order) to approximate LRU.
  promptCache.delete(key);
  promptCache.set(key, value);
  return value;
}

function lruSet(promptCache, key, value, limit) {
  if (promptCache.has(key)) promptCache.delete(key);
  promptCache.set(key, value);
  enforcePromptCacheLimit(promptCache, limit);
}

function makePromptCacheKey({ basePath, manifestUrl, promptKey }) {
  const base = toNonEmptyString(basePath);
  const manifest = toNonEmptyString(manifestUrl);
  const ns = `${base || ""}|${manifest || ""}`;
  return `${ns}${PROMPT_CACHE_KEY_SEPARATOR}${promptKey}`;
}

export class PromptLoader {
  /**
   * @param {PromptLoaderOptions} [options]
   */
  constructor({ maxEntries, manifestTtlMs, maxManifestBytes, maxPromptBytes, basePath, fetchImpl } = {}) {
    this._promptCache = new Map();
    this._promptCacheMaxEntries =
      maxEntries !== undefined ? this._normalizeMaxEntries(maxEntries) : resolvePromptCacheMaxEntries();
    this._promptManifestCacheTtlMs =
      manifestTtlMs !== undefined ? this._normalizeManifestTtlMs(manifestTtlMs) : resolvePromptManifestCacheTtlMs();
    this._manifestCacheByUrl = new Map(); // url -> { url, ts, byName: Map }
    this._maxManifestBytes = normalizeMaxBytes(maxManifestBytes, DEFAULT_MAX_MANIFEST_BYTES);
    this._maxPromptBytes = normalizeMaxBytes(maxPromptBytes, DEFAULT_MAX_PROMPT_BYTES);
    this._basePathOverride = toNonEmptyString(basePath) || null;
    this._fetchImpl = typeof fetchImpl === "function" ? fetchImpl : null;
  }

  /**
   * @param {unknown} value
   * @returns {number}
   */
  _normalizeMaxEntries(value) {
    const parsed = parseInt(String(value), 10);
    if (!Number.isFinite(parsed)) {
      throw new Error("PromptLoader: maxEntries must be a finite integer");
    }
    return Math.max(0, parsed);
  }

  /**
   * @param {unknown} value
   * @returns {number}
   */
  _normalizeManifestTtlMs(value) {
    const parsed = parseInt(String(value), 10);
    if (!Number.isFinite(parsed)) {
      throw new Error("PromptLoader: manifestTtlMs must be a finite integer");
    }
    return Math.max(0, parsed);
  }

  /**
   * @param {PromptCacheConfig} [options]
   * @returns {{ maxEntries: number, manifestTtlMs: number, size: number }}
   */
  configureCache({ maxEntries, manifestTtlMs } = {}) {
    if (maxEntries !== undefined) {
      this._promptCacheMaxEntries = this._normalizeMaxEntries(maxEntries);
      enforcePromptCacheLimit(this._promptCache, this._promptCacheMaxEntries);
    }
    if (manifestTtlMs !== undefined) {
      this._promptManifestCacheTtlMs = this._normalizeManifestTtlMs(manifestTtlMs);
    }
    return { maxEntries: this._promptCacheMaxEntries, manifestTtlMs: this._promptManifestCacheTtlMs, size: this._promptCache.size };
  }

  /**
   * @param {string=} name
   * @returns {void}
   */
  clearPromptCache(name) {
    if (name) {
      const suffix = `${PROMPT_CACHE_KEY_SEPARATOR}${String(name).replace(/\.md$/i, "")}`;
      for (const k of Array.from(this._promptCache.keys())) {
        if (String(k).endsWith(suffix)) this._promptCache.delete(k);
      }
      return;
    }
    this._promptCache.clear();
  }

  /**
   * @returns {string[]}
   */
  getCachedPromptNames() {
    const names = new Set();
    for (const k of this._promptCache.keys()) {
      const s = String(k);
      const idx = s.lastIndexOf(PROMPT_CACHE_KEY_SEPARATOR);
      if (idx === -1) continue;
      const name = s.slice(idx + PROMPT_CACHE_KEY_SEPARATOR.length);
      if (name) names.add(name);
    }
    return Array.from(names.values());
  }

  /**
   * @returns {(typeof fetch) | null}
   */
  _getFetch() {
    if (this._fetchImpl) return this._fetchImpl;
    return typeof fetch === "function" ? fetch : null;
  }

  /**
   * @param {string} url
   * @returns {Promise<any>}
   */
  async _fetchJson(url) {
    const fetchFn = this._getFetch();
    if (!fetchFn) throw new Error("fetch is not available in this environment");
    const resp = await fetchFn(url, { cache: "no-store" });
    if (!resp.ok) throw new Error(`Failed to fetch ${url}: ${resp.status}`);
    const text = await tryReadTextWithLimit(resp, { maxBytes: this._maxManifestBytes, context: "Prompt manifest" });
    if (typeof text === "string") {
      try {
        return JSON.parse(text);
      } catch (err) {
        throw new Error(`Failed to parse JSON from ${url}: ${err?.message || String(err)}`);
      }
    }
    return await resp.json();
  }

  /**
   * @param {string=} manifestUrl
   * @returns {Promise<PromptManifest|null>}
   */
  async _loadPromptManifest(manifestUrl) {
    if (isNodeLike()) return null;

    const primary = resolveUrl(manifestUrl || DEFAULT_PROMPT_MANIFEST_URL);
    const fallback = resolveUrl(DEFAULT_PROMPT_MANIFEST_URL_FALLBACK);
    const candidates = [primary, fallback].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);

    const now = Date.now();
    const cachedPrimary = this._manifestCacheByUrl.get(primary);
    if (cachedPrimary && now - cachedPrimary.ts < this._promptManifestCacheTtlMs) return cachedPrimary;

    for (const url of candidates) {
      const cached = this._manifestCacheByUrl.get(url);
      if (cached && now - cached.ts < this._promptManifestCacheTtlMs) return cached;
      try {
        const data = await this._fetchJson(url);
        const list = Array.isArray(data?.prompts) ? data.prompts : Array.isArray(data?.files) ? data.files : [];
        const byName = new Map();
        for (const entry of list) {
          const row = isPlainObject(entry) ? entry : null;
          const name = toNonEmptyString(row?.name || row?.key);
          const path = toNonEmptyString(row?.path || row?.file || row?.url);
          if (!name || !path) continue;
          byName.set(name.replace(/\.md$/i, ""), { name: name.replace(/\.md$/i, ""), path });
        }
        const manifest = { url, ts: now, byName };
        this._manifestCacheByUrl.set(url, manifest);
        return manifest;
      } catch (err) {
        logger.debug(`[prompt-loader] Failed to load prompt manifest from "${url}": ${err?.message || String(err)}`);
      }
    }

    return null;
  }

  /**
   * @param {string} key
   * @param {{ manifestUrl?: string }} [options]
   * @returns {Promise<string>}
   */
  async _resolvePromptUrlFromManifest(key, { manifestUrl } = {}) {
    const k = toNonEmptyString(key).replace(/\.md$/i, "");
    if (!k) return "";
    const manifest = await this._loadPromptManifest(manifestUrl);
    if (!manifest) return "";

    const entry = manifest.byName.get(k);
    if (!entry) return "";

    try {
      const url = new URL(entry.path, manifest.url).toString();
      return isSafeHttpUrl(url) ? url : "";
    } catch {
      return "";
    }
  }

  /**
   * @param {string} name
   * @param {LoadPromptOptions} [options]
   * @returns {Promise<string>}
   */
  async loadPrompt(name, { cache = true, manifestUrl } = {}) {
    const key = String(name).replace(/\.md$/i, "");

    if (!validateKey(key)) {
      throw new Error(`Invalid prompt key: "${name}". Path traversal is forbidden.`);
    }

    const basePath = this._basePathOverride || getBasePath();
    const cacheKey = makePromptCacheKey({ basePath, manifestUrl: resolveUrl(manifestUrl || ""), promptKey: key });

    if (cache && this._promptCache.has(cacheKey)) {
      return lruGet(this._promptCache, cacheKey);
    }

    let content;

    // Browser/Worker - use fetch
    if (!isNodeLike()) {
      const manifestPath = await this._resolvePromptUrlFromManifest(key, { manifestUrl });
      const filePath =
        manifestPath ||
        (() => {
          try {
            return new URL(`${key}.md`, basePath).toString();
          } catch {
            return `${String(basePath || "/")}${key}.md`.replace(/\/+/g, "/");
          }
        })();
      try {
        const fetchFn = this._getFetch();
        if (!fetchFn) throw new Error("fetch is not available in this environment");
        const resp = await fetchFn(filePath);
        if (!resp.ok) {
          throw new Error(`Failed to load prompt: ${filePath} (${resp.status})`);
        }
        const text = await tryReadTextWithLimit(resp, { maxBytes: this._maxPromptBytes, context: "Prompt content" });
        if (typeof text !== "string") {
          throw new Error("Failed to read prompt content");
        }
        content = text;
      } catch (e) {
        throw new Error(`Failed to load prompt "${name}": ${e.message}`);
      }
    }
    // Node.js 环境 - 使用 fs
    else {
      try {
        const fs = /** @type {FsPromisesLike} */ (/** @type {unknown} */ (
          await import(/* @vite-ignore */ /** @type {string} */ ("fs/promises"))
        ));
        const pathModule = /** @type {PathLike} */ (/** @type {unknown} */ (
          await import(/* @vite-ignore */ /** @type {string} */ ("path"))
        ));

        const baseResolved = pathModule.resolve(basePath);
        const baseReal = await fs.realpath(baseResolved);
        const candidatePath = pathModule.resolve(baseReal, `${key}.md`);
        const candidateReal = await fs.realpath(candidatePath);
        if (!isPathInsideBase(candidateReal, baseReal, pathModule)) {
          throw new Error("Path security violation: resolved path is outside base directory");
        }

        if (this._maxPromptBytes !== Infinity) {
          const st = await fs.stat(candidateReal).catch(() => null);
          if (st && typeof st.size === "number" && st.size > this._maxPromptBytes) {
            throw new Error(`Prompt content exceeds limit (${st.size} > ${this._maxPromptBytes} bytes)`);
          }
        }

        content = await fs.readFile(candidateReal, "utf-8");
      } catch (e) {
        throw new Error(`Failed to load prompt "${name}": ${e.message}`);
      }
    }

    const trimmed = content.trim();
    if (cache) {
      lruSet(this._promptCache, cacheKey, trimmed, this._promptCacheMaxEntries);
    }
    return trimmed;
  }

  /**
   * @param {string} name
   * @param {{ cache?: boolean }} [options]
   * @returns {string}
   */
  loadPromptSync(name, { cache = true } = {}) {
    const key = String(name).replace(/\.md$/i, "");

    if (!validateKey(key)) {
      throw new Error(`Invalid prompt key: "${name}". Path traversal is forbidden.`);
    }

    // 浏览器环境检查
    if (typeof window !== "undefined") {
      throw new Error("loadPromptSync is not supported in browser environment");
    }

    const basePath = this._basePathOverride || getBasePath();
    const cacheKey = makePromptCacheKey({ basePath, manifestUrl: "", promptKey: key });
    if (cache && this._promptCache.has(cacheKey)) {
      return lruGet(this._promptCache, cacheKey);
    }

    const modules = getSyncNodeModules();
    if (!modules) {
      throw new Error(
        "loadPromptSync failed: Sync file access is unavailable in this environment (likely native ESM without require shim). Use async loadPrompt instead."
      );
    }

    try {
      const { fs, path } = modules;

      const baseResolved = path.resolve(basePath);
      const baseReal = fs.realpathSync(baseResolved);
      const candidatePath = path.resolve(baseReal, `${key}.md`);
      const candidateReal = fs.realpathSync(candidatePath);
      if (!isPathInsideBase(candidateReal, baseReal, path)) {
        throw new Error("Path security violation: resolved path is outside base directory");
      }

      if (this._maxPromptBytes !== Infinity) {
        const st = fs.statSync(candidateReal);
        if (st && typeof st.size === "number" && st.size > this._maxPromptBytes) {
          throw new Error(`Prompt content exceeds limit (${st.size} > ${this._maxPromptBytes} bytes)`);
        }
      }

      const content = fs.readFileSync(candidateReal, "utf-8").trim();

      if (cache) {
        lruSet(this._promptCache, cacheKey, content, this._promptCacheMaxEntries);
      }
      return content;
    } catch (e) {
      throw new Error(`Failed to load prompt "${name}": ${e.message}`);
    }
  }

  /**
   * @param {string[]|unknown} names
   * @returns {Promise<Map<string, string>>}
   */
  async preloadPrompts(names) {
    const list = Array.isArray(names) ? names : [];
    const results = await Promise.all(
      list.map(async (name) => {
        try {
          const content = await this.loadPrompt(name);
          return [name, content];
        } catch (e) {
          logger.warn(`[prompt-loader] Failed to preload "${name}": ${e?.message || String(e)}`);
          return [name, null];
        }
      })
    );
    const map = new Map();
    for (const entry of results) {
      if (!Array.isArray(entry) || entry.length < 2) continue;
      const [k, v] = entry;
      if (v === null) continue;
      map.set(String(k), String(v));
    }
    return map;
  }
}

const _defaultPromptLoader = new PromptLoader();

/**
 * @param {PromptCacheConfig} [options]
 * @returns {{ maxEntries: number, manifestTtlMs: number, size: number }}
 */
export function configurePromptCache({ maxEntries, manifestTtlMs } = {}) {
  return _defaultPromptLoader.configureCache({ maxEntries, manifestTtlMs });
}

/**
 * 获取提示词目录的基础路径
 * 
 * 修复 Windows 路径问题：使用 fileURLToPath 正确转换
 */
function getBasePath() {
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
function validateKey(key) {
  if (typeof key !== "string") return false;
  // 仅允许字母、数字、下划线、中划线和斜杠
  // 严禁 ".." 路径
  if (key.includes("..")) return false;
  return /^[a-zA-Z0-9_\-\/]+$/.test(key);
}

// Browser prompt manifest support:
// - Vite build won't automatically include runtime-fetched .md files unless they live under `public/`.
// - We ship `public/prompts/manifest.json` + prompt markdown under `public/prompts/**`.
const DEFAULT_PROMPT_MANIFEST_URL = "prompts/manifest.json";
const DEFAULT_PROMPT_MANIFEST_URL_FALLBACK = "public/prompts/manifest.json";

function resolveUrl(pathOrUrl) {
  const raw = toNonEmptyString(pathOrUrl);
  if (!raw) return "";
  try {
    return new URL(raw, globalThis.location?.href).toString();
  } catch {
    return raw;
  }
}

function isSafeHttpUrl(url) {
  try {
    const u = new URL(url, globalThis.location?.href);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function isPathInsideBase(resolvedPath, basePath, pathModule) {
  const rel = pathModule.relative(basePath, resolvedPath);
  return rel && !rel.startsWith("..") && !pathModule.isAbsolute(rel);
}

function escapeTemplateDelimiters(value) {
  const s = typeof value === "string" ? value : String(value ?? "");
  if (!s) return s;
  // Prevent user-controlled content from injecting new {{...}} placeholders into subsequent renders.
  // Use split/join for broader browser compatibility (replaceAll requires ES2021+).
  return s.split("{{").join(`{\u200B{`).split("}}").join(`}\u200B}`);
}

/**
 * 异步加载提示词文件
 * @param {string} name - 提示词名称，如 "dsl/ppt-html-dsl" (不需要 .md 后缀)
 * @param {LoadPromptOptions} [options] - 选项
 * @returns {Promise<string>} 提示词内容
 */
export async function loadPrompt(name, { cache = true, manifestUrl } = {}) {
  return _defaultPromptLoader.loadPrompt(name, { cache, manifestUrl });
}

/**
 * 获取 Node.js 模块（安全处理 ESM/CJS 兼容性）
 * @returns {SyncNodeModules | null}
 */
function getSyncNodeModules() {
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

/**
 * 同步加载提示词 (仅 Node.js 环境)
 * @param {string} name - 提示词名称
 * @param {object} options - 选项
 * @returns {string} 提示词内容
 */
export function loadPromptSync(name, { cache = true } = {}) {
  return _defaultPromptLoader.loadPromptSync(name, { cache });
}

/**
 * 预加载多个提示词
 * @param {string[]} names - 提示词名称列表
 * @returns {Promise<Map<string, string>>} 名称到内容的映射
 */
export async function preloadPrompts(names) {
  return _defaultPromptLoader.preloadPrompts(names);
}

/**
 * 清除缓存
 * @param {string} name - 可选，指定要清除的提示词名称；不传则清除全部
 */
export function clearPromptCache(name) {
  _defaultPromptLoader.clearPromptCache(name);
}

/**
 * 获取已缓存的提示词列表
 * @returns {string[]}
 */
export function getCachedPromptNames() {
  return _defaultPromptLoader.getCachedPromptNames();
}

function escapeRegExp(s) {
  return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeTemplateVars(vars) {
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

/**
 * Render a prompt template using {{VAR}} placeholders.
 *
 * Notes:
 * - Placeholder matching is case-insensitive (by lowercasing both sides).
 * - Only exact keys are supported (including dotted keys like "minWords.quick").
 * - Unresolved placeholders are kept by default to make missing variables visible.
 *
 * @param {string} template - The template string containing `{{VAR}}` placeholders
 * @param {RenderPromptTemplateOptions} [options] - Rendering options
 * @returns {string} The rendered template with placeholders replaced
 */
export function renderPromptTemplate(
  template,
  /** @type {RenderPromptTemplateOptions} */ {
    vars,
    appendIfMissing,
    keepUnresolved = true,
    warnOnUnresolved = false,
    failOnUnresolved = false,
    onUnresolved,
    escapeVars = true,
  } = {}
) {
  const input = typeof template === "string" ? template : String(template ?? "");
  const varMap = normalizeTemplateVars(vars);
  const unresolved = warnOnUnresolved || failOnUnresolved || typeof onUnresolved === "function" ? new Set() : null;

  let rendered = input.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (match, rawName) => {
    const key = String(rawName || "").trim().toLowerCase();
    if (!key) return keepUnresolved ? match : "";
    if (!varMap.has(key)) {
      unresolved?.add(key);
      return keepUnresolved ? match : "";
    }

    const value = varMap.get(key);
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return escapeVars ? escapeTemplateDelimiters(value) : value;
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
      const out = String(value);
      return escapeVars ? escapeTemplateDelimiters(out) : out;
    }
    return keepUnresolved ? match : "";
  });

  const extra = [];
  const append = appendIfMissing && typeof appendIfMissing === "object" ? appendIfMissing : null;
  if (append) {
    for (const [name, value] of Object.entries(append)) {
      const placeholderName = typeof name === "string" ? name.trim() : "";
      const content = typeof value === "string" ? value.trim() : String(value ?? "").trim();
      if (!placeholderName || !content) continue;
      const re = new RegExp(`\\{\\{\\s*${escapeRegExp(placeholderName)}\\s*\\}\\}`, "i");
      if (re.test(input)) continue;
      extra.push(content);
    }
  }

  if (extra.length) {
    rendered = `${rendered}\n\n${extra.join("\n\n")}`;
  }

  if (unresolved && unresolved.size) {
    const list = Array.from(unresolved).slice(0, 20);
    if (typeof onUnresolved === "function") {
      try {
        onUnresolved(list);
      } catch {
        // ignore
      }
    } else if (warnOnUnresolved) {
      logger.warn(`[prompt-loader] Unresolved placeholders: ${list.join(", ")}${unresolved.size > list.length ? ", ..." : ""}`);
    }
    if (failOnUnresolved) {
      throw new Error(
        `[prompt-loader] Unresolved placeholders: ${list.join(", ")}${unresolved.size > list.length ? ", ..." : ""}`
      );
    }
  }

  return rendered;
}

export default {
  loadPrompt,
  loadPromptSync,
  preloadPrompts,
  clearPromptCache,
  getCachedPromptNames,
  configurePromptCache,
  renderPromptTemplate,
};
