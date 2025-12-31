/**
 * Prompt Loader - 加载 markdown 格式的提示词文件
 *
 * 支持浏览器和 Node.js 环境
 */

// 缓存已加载的提示词（LRU：避免长期运行内存无限增长）
const promptCache = new Map();
let promptCacheMaxEntries = 128;

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
  } catch {}

  return 128;
}

promptCacheMaxEntries = resolvePromptCacheMaxEntries();

function enforcePromptCacheLimit() {
  const limit = promptCacheMaxEntries;
  if (!Number.isFinite(limit) || limit <= 0) return;
  while (promptCache.size > limit) {
    const oldest = promptCache.keys().next().value;
    promptCache.delete(oldest);
  }
}

function lruGet(key) {
  if (!promptCache.has(key)) return undefined;
  const value = promptCache.get(key);
  // Refresh insertion order (Map iteration order) to approximate LRU.
  promptCache.delete(key);
  promptCache.set(key, value);
  return value;
}

function lruSet(key, value) {
  if (promptCache.has(key)) promptCache.delete(key);
  promptCache.set(key, value);
  enforcePromptCacheLimit();
}

export function configurePromptCache({ maxEntries } = {}) {
  if (maxEntries !== undefined) {
    const parsed = parseInt(String(maxEntries), 10);
    if (!Number.isFinite(parsed)) {
      throw new Error("configurePromptCache({ maxEntries }): maxEntries must be a finite integer");
    }
    promptCacheMaxEntries = Math.max(0, parsed);
    enforcePromptCacheLimit();
  }
  return { maxEntries: promptCacheMaxEntries, size: promptCache.size };
}

/**
 * 获取提示词目录的基础路径
 * 
 * 修复 Windows 路径问题：使用 fileURLToPath 正确转换
 */
function getBasePath() {
  // 浏览器环境
  if (typeof window !== "undefined") {
    try {
      const url = new URL(".", import.meta.url);
      return url.pathname;
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

/**
 * 异步加载提示词文件
 * @param {string} name - 提示词名称，如 "dsl/ppt-html-dsl" (不需要 .md 后缀)
 * @param {object} options - 选项
 * @param {boolean} options.cache - 是否使用缓存，默认 true
 * @returns {Promise<string>} 提示词内容
 */
export async function loadPrompt(name, { cache = true } = {}) {
  const key = String(name).replace(/\.md$/i, "");

  if (!validateKey(key)) {
    throw new Error(`Invalid prompt key: "${name}". Path traversal is forbidden.`);
  }

  if (cache && promptCache.has(key)) {
    return lruGet(key);
  }

  const basePath = getBasePath();
  let content;

  // 浏览器环境 - 使用 fetch
  if (typeof window !== "undefined") {
    const filePath = `${basePath}${key}.md`.replace(/\/+/g, "/");
    try {
      const resp = await fetch(filePath);
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

      // 进一步确保路径安全
      const fullPath = pathModule.resolve(basePath, `${key}.md`);
      if (!fullPath.startsWith(pathModule.resolve(basePath))) {
        throw new Error("Path security violation: resulting path is outside base directory");
      }

      content = await fs.readFile(fullPath, "utf-8");
    } catch (e) {
      throw new Error(`Failed to load prompt "${name}": ${e.message}`);
    }
  }

  const trimmed = content.trim();
  if (cache) {
    lruSet(key, trimmed);
  }
  return trimmed;
}

/**
 * 获取 Node.js 模块（安全处理 ESM/CJS 兼容性）
 */
function getSyncNodeModules() {
  if (typeof window !== "undefined") return null;
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
  const key = String(name).replace(/\.md$/i, "");

  if (!validateKey(key)) {
    throw new Error(`Invalid prompt key: "${name}". Path traversal is forbidden.`);
  }

  if (cache && promptCache.has(key)) {
    return lruGet(key);
  }

  // 浏览器环境检查
  if (typeof window !== "undefined") {
    throw new Error("loadPromptSync is not supported in browser environment");
  }

  const modules = getSyncNodeModules();
  if (!modules) {
    throw new Error("loadPromptSync failed: Sync file access is unavailable in this environment (likely native ESM without require shim). Use async loadPrompt instead.");
  }

  try {
    const { fs, path } = modules;
    const basePath = getBasePath();
    const fullPath = path.resolve(basePath, `${key}.md`);

    if (!fullPath.startsWith(path.resolve(basePath))) {
      throw new Error("Path security violation");
    }

    const content = fs.readFileSync(fullPath, "utf-8").trim();

    if (cache) {
      lruSet(key, content);
    }
    return content;
  } catch (e) {
    throw new Error(`Failed to load prompt "${name}": ${e.message}`);
  }
}

/**
 * 预加载多个提示词
 * @param {string[]} names - 提示词名称列表
 * @returns {Promise<Map<string, string>>} 名称到内容的映射
 */
export async function preloadPrompts(names) {
  const results = await Promise.all(
    names.map(async (name) => {
      try {
        const content = await loadPrompt(name);
        return [name, content];
      } catch (e) {
        console.warn(`[prompt-loader] Failed to preload "${name}":`, e.message);
        return [name, null];
      }
    })
  );
  return new Map(results.filter(([, v]) => v !== null));
}

/**
 * 清除缓存
 * @param {string} name - 可选，指定要清除的提示词名称；不传则清除全部
 */
export function clearPromptCache(name) {
  if (name) {
    promptCache.delete(String(name).replace(/\.md$/i, ""));
  } else {
    promptCache.clear();
  }
}

/**
 * 获取已缓存的提示词列表
 * @returns {string[]}
 */
export function getCachedPromptNames() {
  return [...promptCache.keys()];
}

function escapeRegExp(s) {
  return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeTemplateVars(vars) {
  const map = new Map();

  if (!vars) return map;

  if (vars instanceof Map) {
    for (const [k, v] of vars.entries()) {
      const key = typeof k === "string" ? k.trim().toLowerCase() : "";
      if (!key) continue;
      map.set(key, v);
    }
    return map;
  }

  if (typeof vars === "object") {
    for (const [k, v] of Object.entries(vars)) {
      const key = typeof k === "string" ? k.trim().toLowerCase() : "";
      if (!key) continue;
      map.set(key, v);
    }
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
export function renderPromptTemplate(template, { vars, appendIfMissing, keepUnresolved = true } = {}) {
  const input = typeof template === "string" ? template : String(template ?? "");
  const varMap = normalizeTemplateVars(vars);

  let rendered = input.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (match, rawName) => {
    const key = String(rawName || "").trim().toLowerCase();
    if (!key) return keepUnresolved ? match : "";
    if (!varMap.has(key)) return keepUnresolved ? match : "";

    const value = varMap.get(key);
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
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
