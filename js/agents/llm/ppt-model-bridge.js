/**
 * PPT Model Bridge - 将 PPT 模型配置桥接到 Agent Runtime
 *
 * 从 localStorage 读取 PPT 模型配置，转换为 aiApiService 可用的格式
 * 支持 usage-based 路由：analyst/planner/writer/vision
 */

const STORAGE_KEYS = {
  lang: 'pptModelConfigLanguage',
  img: 'pptModelConfigImage',
  vision: 'pptModelConfigVision'
};

// Usage 到配置类型的映射
const USAGE_TO_CONFIG = {
  analyst: 'lang',    // DeepSearch 扫描/理解
  planner: 'lang',    // Gap 规划
  writer: 'lang',     // 报告撰写
  worker: 'lang',     // 通用任务
  reviewer: 'lang',   // 审阅
  vision: 'vision',   // 图像理解
  image: 'img'        // 图像生成
};

function loadPptConfig(type) {
  try {
    const key = STORAGE_KEYS[type];
    if (!key) return null;
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * 获取 PPT 配置中指定用途的模型 Key
 * @param {string} usage - analyst/planner/writer/vision/image
 * @returns {{modelKey: string, modelId: string}|null}
 */
export function getPptModelConfig(usage) {
  const configType = USAGE_TO_CONFIG[usage] || 'lang';
  const config = loadPptConfig(configType);
  if (!config || !config.modelKey) return null;
  return {
    modelKey: config.modelKey,
    modelId: config.modelId || ''
  };
}

/**
 * 创建带 PPT 配置的 chat 函数
 * 包装 aiApiService.chat，自动注入 PPT 配置的模型
 * @param {object} aiApiService - window.aiApiService
 * @param {string} usage - analyst/planner/writer/vision/image
 */
export function createPptConfiguredChat(aiApiService, usage = 'worker') {
  if (!aiApiService || typeof aiApiService.chat !== 'function') {
    return null;
  }

  const config = getPptModelConfig(usage);

  return async function chat({ messages, ...opts } = {}) {
    const callOpts = { messages, ...opts };

    // 如果有 PPT 配置，使用配置的 modelKey 和 modelId
    if (config) {
      if (!callOpts.modelId && config.modelKey) {
        // 构建 modelId：对于自定义源站使用 "siteId:modelId" 格式
        if (config.modelKey.startsWith('custom_source_')) {
          callOpts.modelId = config.modelId
            ? `${config.modelKey}:${config.modelId}`
            : config.modelKey;
        } else {
          callOpts.modelId = config.modelKey;
          if (config.modelId) {
            callOpts.model = config.modelId;
          }
        }
      }
    }

    return aiApiService.chat(callOpts);
  };
}

/**
 * 创建 PPT 配置感知的 AI API Service 代理
 * 根据 usage 参数自动选择对应的 PPT 模型配置
 */
export function createPptAwareAiApiService(baseService) {
  if (!baseService) return null;

  return {
    ...baseService,

    /**
     * 增强的 chat 方法，支持 usage 参数
     * @param {object} opts - { messages, usage?, modelId?, ... }
     */
    async chat(opts = {}) {
      const { usage = 'worker', ...rest } = opts;
      const config = getPptModelConfig(usage);

      const callOpts = { ...rest };

      // 如果调用者没有指定 modelId，使用 PPT 配置
      if (!callOpts.modelId && config?.modelKey) {
        if (config.modelKey.startsWith('custom_source_')) {
          callOpts.modelId = config.modelId
            ? `${config.modelKey}:${config.modelId}`
            : config.modelKey;
        } else {
          callOpts.modelId = config.modelKey;
          if (config.modelId) {
            callOpts.model = config.modelId;
          }
        }
      }

      return baseService.chat(callOpts);
    },

    /**
     * 获取当前 PPT 配置状态
     */
    getPptConfigs() {
      return {
        lang: loadPptConfig('lang'),
        img: loadPptConfig('img'),
        vision: loadPptConfig('vision')
      };
    },

    /**
     * 检查指定 usage 是否已配置
     */
    isUsageConfigured(usage) {
      const config = getPptModelConfig(usage);
      return !!(config && config.modelKey);
    }
  };
}

/**
 * 获取当前 PPT 配置摘要（用于调试/显示）
 */
export function getPptConfigSummary() {
  const lang = loadPptConfig('lang');
  const img = loadPptConfig('img');
  const vision = loadPptConfig('vision');

  return {
    lang: lang ? `${lang.modelKey}${lang.modelId ? `:${lang.modelId}` : ''}` : '未配置',
    img: img ? `${img.modelKey}${img.modelId ? `:${img.modelId}` : ''}` : '未配置',
    vision: vision ? `${vision.modelKey}${vision.modelId ? `:${vision.modelId}` : ''}` : '未配置',
    configured: !!(lang?.modelKey || img?.modelKey || vision?.modelKey)
  };
}
