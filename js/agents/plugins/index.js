/**
 * Plugins Index - 插件注册表
 *
 * 提供插件的统一加载入口
 */

// 插件映射表 — 通过 _registry 间接引用，支持 DI 替换
const _initialKeys = new Set();
/** @type {Record<string, () => Promise<any>>} */
let _registry = {
  // Compression
  'compression/cicada': () => import('./compression/cicada.js'),
  'compression/watchdog': () => import('./compression/watchdog.js'),

  // Analysis
  'analysis/fingerprint': () => import('./analysis/fingerprint.js'),
  'analysis/convergence': () => import('./analysis/convergence-detector.js'),
  'analysis/behavior': () => import('./analysis/behavior-fingerprint.js'),

  // Telemetry
  'telemetry/token-tracker': () => import('./telemetry/token-tracker.js'),
  'telemetry/trace': () => import('./telemetry/trace-context.js'),
  'telemetry/replay': () => import('./telemetry/replay-controller.js'),

  // Memory
  'memory/store': () => import('./memory/memory-store.impl.js'),
  'memory/state-engine': () => import('./memory/state-engine.js'),
  'memory/retrieval': () => import('./memory/retrieval-engine.js'),

  // Coordination
  'coordination/tab': () => import('./coordination/tab-coordinator.js'),
  'coordination/process': () => import('./coordination/process-coordinator.js'),

  // Checkpoints
  'checkpoints/store': () => import('./checkpoints/agent-checkpoint-store.js'),

  // Deps (Python)
  'deps/python': () => import('./deps/index.js'),

  // Plan
  'plan/store': () => import('./plan/plan-store.js'),
  'plan/structured': () => import('./plan/structured-plan.js'),

  // Policy
  'policy/engine': () => import('./policy/engine.js'),
  'policy/manager': () => import('./policy/manager.js'),

  // Routing
  'routing/performance': () => import('./routing/performance-router.js'),

  // Transports
  'transports/process': () => import('./transports/index.js'),

  // Side Effects
  'side-effects/journal': () => import('./side-effects/side-effect-journal.js'),

  // Resilience
  'resilience/retry': () => import('./resilience/retry.js'),
  'resilience/level': () => import('./resilience/degradation-matrix.js'),

  // Stages
  'stage/deepsearch': () => import('./stages/deepsearch.js'),

  // Services
  'service/llm': () => import('./services/llm.js'),
  'service/mcp': () => import('./services/mcp.js'),
  'service/scheduler': () => import('./services/scheduler.js'),
  'service/vfs': () => import('./services/vfs.js'),

  // Sandbox
  'sandbox': () => import('../core/sandbox/plugin.js'),

  // Debug
  'debug/logger': () => import('./debug/logger.js'),
  'debug/inspector': () => import('./debug/inspector.js'),
};

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
