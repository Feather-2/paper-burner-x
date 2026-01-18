/**
 * Presets - 预设配置
 *
 * 预设定义了插件组合和默认配置，实现"丰俭由人"
 */

/**
 * 预设定义
 */
export const presets = {
  /**
   * 最小配置 - 仅核心功能
   */
  minimal: {
    description: '最小配置，仅包含基础压缩',
    plugins: [
      'compression/cicada',
    ],
    config: {
      'compression/cicada': { aggressive: false },
    },
  },

  /**
   * 标准配置 - 平衡功能与性能
   */
  standard: {
    description: '标准配置，适合大多数场景',
    plugins: [
      'compression/cicada',
      'compression/watchdog',
      'resilience/retry',
      'service/scheduler',
    ],
    config: {
      'compression/cicada': { aggressive: false },
      'compression/watchdog': { threshold: 0.75 },
      'resilience/retry': { maxRetries: 3 },
    },
  },

  /**
   * 完整服务配置
   */
  full: {
    description: '包含所有核心服务',
    extends: 'standard',
    plugins: [
      'service/llm',
      'service/vfs',
      'sandbox',
    ],
    config: {},
  },

  /**
   * DeepSearch 专用配置
   */
  deepsearch: {
    description: 'DeepSearch 阶段专用配置',
    extends: 'full',
    plugins: [
      'analysis/fingerprint',
      'stage/deepsearch',
    ],
    config: {
      'analysis/fingerprint': { windowSize: 5 },
    },
  },

  /**
   * Design 专用配置
   */
  design: {
    description: 'Design 阶段专用配置',
    extends: 'full',
    plugins: [
      'analysis/fingerprint',
    ],
    config: {},
  },

  /**
   * CodeSearch 专用配置
   */
  codesearch: {
    description: 'CodeSearch 阶段专用配置',
    extends: 'full',
    plugins: [
      'analysis/fingerprint',
    ],
    config: {},
  },

  /**
   * 生产配置 - 全功能
   */
  production: {
    description: '生产环境配置，包含完整功能',
    extends: 'full',
    plugins: [
      'analysis/fingerprint',
      'service/mcp',
    ],
    config: {
      'compression/cicada': { aggressive: true },
    },
  },

  /**
   * 开发配置 - 调试友好
   */
  development: {
    description: '开发环境配置，便于调试',
    extends: 'full',
    plugins: [
      'debug/inspector',
      'debug/logger',
    ],
    config: {
      'debug/logger': { level: 'debug', pretty: true },
      'debug/inspector': { enabled: true, exposeGlobal: true },
    },
  },

  /**
   * 测试配置 - 最小外部依赖
   */
  test: {
    description: '测试环境配置',
    plugins: [
      'compression/cicada',
    ],
    config: {
      'compression/cicada': { aggressive: false },
    },
  },
};

/**
 * 解析预设 - 处理继承关系
 * @param {string} presetName - 预设名称
 * @returns {Object} 解析后的配置
 */
export function resolvePreset(presetName) {
  const preset = presets[presetName];
  if (!preset) {
    throw new Error(`Unknown preset: ${presetName}`);
  }

  // 处理继承
  let plugins = [...(preset.plugins || [])];
  let config = { ...(preset.config || {}) };

  if (preset.extends) {
    const parent = resolvePreset(preset.extends);
    plugins = [...parent.plugins, ...plugins];
    config = { ...parent.config, ...config };
  }

  // 去重
  plugins = [...new Set(plugins)];

  return {
    name: presetName,
    description: preset.description,
    plugins,
    config,
  };
}

/**
 * 合并预设与用户配置
 *
 * @param {string} presetName - 预设名称 (如 'minimal', 'standard', 'deepsearch')
 * @param {Object} [userConfig={}] - 用户自定义配置
 * @param {string[]} [userConfig.plugins] - 额外添加的插件列表
 * @param {string[]} [userConfig.disablePlugins] - 要禁用的插件列表
 * @param {Record<string, Record<string, unknown>>} [userConfig.config] - 插件配置覆盖
 * @returns {{ name: string, description: string, plugins: string[], config: Record<string, Record<string, unknown>> }} 合并后的预设配置
 */
export function mergePresetConfig(presetName, userConfig = {}) {
  const resolved = resolvePreset(presetName);

  // 合并插件列表
  const additionalPlugins = userConfig.plugins || [];
  const disabledPlugins = new Set(userConfig.disablePlugins || []);

  const plugins = [
    ...resolved.plugins.filter(p => !disabledPlugins.has(p)),
    ...additionalPlugins,
  ];

  // 合并配置
  const config = { ...resolved.config };
  for (const [key, value] of Object.entries(userConfig.config || {})) {
    config[key] = { ...(config[key] || {}), ...value };
  }

  return {
    ...resolved,
    plugins: [...new Set(plugins)],
    config,
  };
}

/**
 * 列出所有预设
 *
 * @returns {Array<{ name: string, description: string, extends: string | null, pluginCount: number }>} 预设摘要列表
 */
export function listPresets() {
  return Object.entries(presets).map(([name, preset]) => ({
    name,
    description: preset.description,
    extends: preset.extends || null,
    pluginCount: preset.plugins?.length || 0,
  }));
}

export default presets;
