/**
 * Prompt Loader - 加载 markdown 格式的提示词文件
 *
 * 支持浏览器和 Node.js 环境
 */

// 缓存已加载的提示词
const promptCache = new Map();

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
    return promptCache.get(key);
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
    promptCache.set(key, trimmed);
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
    return promptCache.get(key);
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
      promptCache.set(key, content);
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

export default {
  loadPrompt,
  loadPromptSync,
  preloadPrompts,
  clearPromptCache,
  getCachedPromptNames,
};
