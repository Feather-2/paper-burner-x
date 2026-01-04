/**
 * Prompt Loader - 加载 markdown 格式的提示词文件
 *
 * 支持浏览器和 Node.js 环境
 */

import { createLogger } from "../shared/utils/logger.js";

import { isPlainObject, toNonEmptyString } from "../shared/utils/value-utils.js";
const logger = createLogger("prompts/prompt-loader");

const PROMPT_CACHE_KEY_SEPARATOR = "::";

function isNodeLike() {
  return typeof process !== "undefined" && !!process.versions?.node;
}

function resolvePromptCacheMaxEntries() {
  const env = typeof process !== "undefined" ? process.env : null;
  const fromEnv = env?.PB_PROMPT_CACHE_MAX_ENTRIES;
  if (fromEnv !== undefined && fromEnv !== null) {
    const parsed = parseInt(String(fromEnv), 10);
    if (Number.isFinite(parsed)) return Math.max(0, parsed);
  }

  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem("pb_promptCacheMaxEntries") : null;
    if (raw) {
      const parsed = parseInt(String(raw), 10);
      if (Number.isFinite(parsed)) return Math.max(0, parsed);
    }
  } catch { /* intentional: localStorage may be blocked */ }

  return 128;
}

function resolvePromptManifestCacheTtlMs() {
  const env = typeof process !== "undefined" ? process.env : null;
  const fromEnv = env?.PB_PROMPT_MANIFEST_CACHE_TTL_MS;
  if (fromEnv !== undefined && fromEnv !== null) {
    const parsed = parseInt(String(fromEnv), 10);
    if (Number.isFinite(parsed)) return Math.max(0, parsed);
  }

  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem("pb_promptManifestCacheTtlMs") : null;
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
  if (!promptCache.has(key)) return undefined;
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
  constructor({ maxEntries, manifestTtlMs, basePath, fetchImpl } = {}) {
    this._promptCache = new Map();
    this._promptCacheMaxEntries =
      maxEntries !== undefined ? this._normalizeMaxEntries(maxEntries) : resolvePromptCacheMaxEntries();
    this._promptManifestCacheTtlMs =
      manifestTtlMs !== undefined ? this._normalizeManifestTtlMs(manifestTtlMs) : resolvePromptManifestCacheTtlMs();
    this._manifestCacheByUrl = new Map(); // url -> { url, ts, byName: Map }
    this._basePathOverride = toNonEmptyString(basePath) || null;
    this._fetchImpl = typeof fetchImpl === "function" ? fetchImpl : null;
  }

  _normalizeMaxEntries(value) {
    const parsed = parseInt(String(value), 10);
    if (!Number.isFinite(parsed)) {
      throw new Error("PromptLoader: maxEntries must be a finite integer");
    }
    return Math.max(0, parsed);
  }

  _normalizeManifestTtlMs(value) {
    const parsed = parseInt(String(value), 10);
    if (!Number.isFinite(parsed)) {
      throw new Error("PromptLoader: manifestTtlMs must be a finite integer");
    }
    return Math.max(0, parsed);
  }

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

  _getFetch() {
    if (this._fetchImpl) return this._fetchImpl;
    return typeof fetch === "function" ? fetch : null;
  }

  async _fetchJson(url) {
    const fetchFn = this._getFetch();
    if (!fetchFn) throw new Error("fetch is not available in this environment");
    const resp = await fetchFn(url, { cache: "no-store" });
    if (!resp.ok) throw new Error(`Failed to fetch ${url}: ${resp.status}`);
    return await resp.json();
  }

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
      } catch {
        // continue
      }
    }

    return null;
  }

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
        content = await resp.text();
      } catch (e) {
        throw new Error(`Failed to load prompt "${name}": ${e.message}`);
      }
    }
    // Node.js 环境 - 使用 fs
    else {
      try {
        const fs = await import("fs/promises");
        const pathModule = await import("path");

        const baseResolved = pathModule.resolve(basePath);
        const baseReal = await fs.realpath(baseResolved);
        const candidatePath = pathModule.resolve(baseReal, `${key}.md`);
        const candidateReal = await fs.realpath(candidatePath);
        if (!isPathInsideBase(candidateReal, baseReal, pathModule)) {
          throw new Error("Path security violation: resolved path is outside base directory");
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

      const content = fs.readFileSync(candidateReal, "utf-8").trim();

      if (cache) {
        lruSet(this._promptCache, cacheKey, content, this._promptCacheMaxEntries);
      }
      return content;
    } catch (e) {
      throw new Error(`Failed to load prompt "${name}": ${e.message}`);
    }
  }

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
    return new Map(results.filter(([, v]) => v !== null));
  }
}

const _defaultPromptLoader = new PromptLoader();

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
      if (process.platform === "win32" && pathname.startsWith("/")) {
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
  // Use a zero-width break to keep prompts readable while breaking the delimiter sequence.
  return s.replaceAll("{{", `{\u200B{`).replaceAll("}}", `}\u200B}`);
}

/**
 * 异步加载提示词文件
 * @param {string} name - 提示词名称，如 "dsl/ppt-html-dsl" (不需要 .md 后缀)
 * @param {object} options - 选项
 * @param {boolean} options.cache - 是否使用缓存，默认 true
 * @param {string=} options.manifestUrl - Browser-only prompt manifest URL
 * @returns {Promise<string>} 提示词内容
 */
export async function loadPrompt(name, { cache = true, manifestUrl } = {}) {
  return _defaultPromptLoader.loadPrompt(name, { cache, manifestUrl });
}

/**
 * 获取 Node.js 模块（安全处理 ESM/CJS 兼容性）
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
    return {
      fs: require("fs"),
      path: require("path")
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
 */
export function renderPromptTemplate(
  template,
  {
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
