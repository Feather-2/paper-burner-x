/**
 * Plugins Index - 插件注册表
 *
 * 提供插件的统一加载入口
 */

// 插件映射表
const pluginRegistry = {
  // Compression
  'compression/cicada': () => import('./compression/cicada.js'),
  'compression/watchdog': () => import('./compression/watchdog.js'),

  // Analysis
  'analysis/fingerprint': () => import('./analysis/fingerprint.js'),

  // Resilience
  'resilience/retry': () => import('./resilience/retry.js'),

  // Stages
  'stage/deepsearch': () => import('./stages/deepsearch.js'),

  // Services
  'service/llm': () => import('./services/llm.js'),
  'service/mcp': () => import('./services/mcp.js'),
  'service/scheduler': () => import('./services/scheduler.js'),
  'service/vfs': () => import('./services/vfs.js'),

  // Debug
  'debug/logger': () => import('./debug/logger.js'),
  'debug/inspector': () => import('./debug/inspector.js'),
};

/**
 * 加载插件
 * @param {string} name - 插件名称
 * @returns {Promise<Object>} 插件对象
 */
export async function loadPlugin(name) {
  const loader = pluginRegistry[name];
  if (!loader) {
    throw new Error(`Unknown plugin: ${name}`);
  }

  const mod = await loader();
  return mod.default || mod;
}

/**
 * 检查插件是否存在
 */
export function hasPlugin(name) {
  return name in pluginRegistry;
}

/**
 * 列出所有可用插件
 */
export function listAvailablePlugins() {
  return Object.keys(pluginRegistry);
}

/**
 * 注册自定义插件
 */
export function registerPlugin(name, loader) {
  pluginRegistry[name] = loader;
}

/**
 * 创建插件加载器（供 Kernel 使用）
 */
export function createPluginLoader() {
  return async (name) => {
    return loadPlugin(name);
  };
}

export default {
  load: loadPlugin,
  has: hasPlugin,
  list: listAvailablePlugins,
  register: registerPlugin,
  createLoader: createPluginLoader,
};
