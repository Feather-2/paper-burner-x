/**
 * Plugins Index - 插件注册表
 *
 * 提供插件的统一加载入口，支持从 manifest 自动发现和扩展
 */

import { defaultPluginRegistry } from './registry.js';

// 插件映射表 — 通过 _registry 间接引用，支持 DI 替换
const _initialKeys = new Set();
/** @type {Record<string, () => Promise<any>>} */
let _registry = { ...defaultPluginRegistry };

// Capture initial keys for reset
for (const k of Object.keys(_registry)) _initialKeys.add(k);

/**
 * Get the current plugin registry object (for DI / testing).
 * @returns {Record<string, () => Promise<any>>}
 */
export function getPluginRegistry() {
  return _registry;
}

/**
 * Replace the plugin registry (for DI / testing isolation).
 * @param {Record<string, () => Promise<any>>} registry
 */
export function setPluginRegistry(registry) {
  if (registry && typeof registry === "object") {
    _registry = registry;
  }
}

/**
 * 加载插件
 * @param {string} name - 插件名称
 * @returns {Promise<Object>} 插件对象
 */
export async function loadPlugin(name) {
  const loader = _registry[name];
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
  return name in _registry;
}

/**
 * 列出所有可用插件
 */
export function listAvailablePlugins() {
  return Object.keys(_registry);
}

/**
 * 注册自定义插件
 */
export function registerPlugin(name, loader) {
  _registry[name] = loader;
}

/**
 * 创建插件加载器（供 Kernel 使用）
 */
export function createPluginLoader() {
  return async (name) => {
    return loadPlugin(name);
  };
}

/**
 * Register plugins from a manifest object.
 * Allows external plugin discovery without modifying this file.
 * @param {Record<string, () => Promise<any>>} manifest - plugin name → async loader
 */
export function registerPluginsFromManifest(manifest) {
  if (!manifest || typeof manifest !== "object") return;
  for (const [name, loader] of Object.entries(manifest)) {
    if (typeof loader === "function") _registry[name] = loader;
  }
}

/**
 * Reset plugin registry to initial state (test isolation).
 * Removes dynamically registered plugins, restores original set.
 */
export function resetPluginRegistry() {
  for (const k of Object.keys(_registry)) {
    if (!_initialKeys.has(k)) delete _registry[k];
  }
}

export default {
  load: loadPlugin,
  has: hasPlugin,
  list: listAvailablePlugins,
  register: registerPlugin,
  createLoader: createPluginLoader,
  reset: resetPluginRegistry,
  registerFromManifest: registerPluginsFromManifest,
  getRegistry: getPluginRegistry,
  setRegistry: setPluginRegistry,
};
