/**
 * Prompt Loader - 加载 markdown 格式的提示词文件
 *
 * 支持浏览器和 Node.js 环境
 */

// 缓存已加载的提示词
const promptCache = new Map();

/**
 * 获取提示词目录的基础路径
 */
function getBasePath() {
  // 浏览器环境
  if (typeof window !== "undefined") {
    // 尝试从 import.meta.url 获取
    try {
      const url = new URL(".", import.meta.url);
      return url.pathname;
    } catch {
      return "/js/agents/prompts/";
    }
  }
  // Node.js 环境
  if (typeof __dirname !== "undefined") {
    return __dirname;
  }
  // ESM Node.js
  try {
    return new URL(".", import.meta.url).pathname;
  } catch {
    return "./";
  }
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

  if (cache && promptCache.has(key)) {
    return promptCache.get(key);
  }

  const basePath = getBasePath();
  const filePath = `${basePath}${key}.md`.replace(/\/+/g, "/");

  let content;

  // 浏览器环境 - 使用 fetch
  if (typeof window !== "undefined" || typeof fetch === "function") {
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
      const path = await import("path");
      const fullPath = path.resolve(basePath, `${key}.md`);
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
 * 同步加载提示词 (仅 Node.js 环境)
 * @param {string} name - 提示词名称
 * @param {object} options - 选项
 * @returns {string} 提示词内容
 */
export function loadPromptSync(name, { cache = true } = {}) {
  const key = String(name).replace(/\.md$/i, "");

  if (cache && promptCache.has(key)) {
    return promptCache.get(key);
  }

  // 仅支持 Node.js
  if (typeof window !== "undefined") {
    throw new Error("loadPromptSync is not supported in browser environment");
  }

  try {
    // 动态 require fs
    const fs = require("fs");
    const path = require("path");
    const basePath = getBasePath();
    const fullPath = path.resolve(basePath, `${key}.md`);
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
