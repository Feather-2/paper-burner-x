/**
 * PPT Model Bridge - 将 PPT 模型配置桥接到 Agent Runtime
 *
 * 从 localStorage 读取 PPT 模型配置，转换为 aiApiService 可用的格式
 * 支持 usage-based 路由：analyst/planner/writer/vision
 */

const STORAGE_KEYS = {
  lang: 'pptModelConfigLanguage',
  img: 'pptModelConfigImage',
  vision: 'pptModelConfigVision',
  modelTags: 'pptModelTags',
  rolePriority: 'pptRolePriority',
  audio: 'pptAudioConfig'
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
    const key = STORAGE_KEYS[type] || (Object.values(STORAGE_KEYS).includes(type) ? type : null);
    if (!key) return null;
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// 标签集合校验
const VALID_CAPABILITY_TAGS = ['lang', 'vision', 'image', 'audio'];

function normalizePptModelTags(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const result = {};
  for (const [k, v] of Object.entries(raw)) {
    if (Array.isArray(v)) {
      result[k] = [...new Set(v.filter(t => VALID_CAPABILITY_TAGS.includes(t)))];
    }
  }
  return result;
}

function normalizePptRolePriority(raw) {
  const roles = ['analyst', 'planner', 'writer', 'reviewer', 'vision', 'worker'];
  const result = {};
  for (const role of roles) {
    const arr = raw?.[role];
    result[role] = Array.isArray(arr)
      ? [...new Set(arr.filter(s => typeof s === 'string' && s))]
      : [];
  }
  return result;
}

function normalizePptAudioConfig(raw) {
  return {
    transcription: {
      provider: raw?.transcription?.provider || 'groq',
      apiKey: raw?.transcription?.apiKey || '',
      model: raw?.transcription?.model || 'whisper-large-v3'
    },
    synthesis: {
      provider: raw?.synthesis?.provider || 'elevenlabs',
      apiKey: raw?.synthesis?.apiKey || '',
      model: raw?.synthesis?.model || 'eleven_turbo_v2_5',
      voice: raw?.synthesis?.voice || ''
    }
  };
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

export function getPptModelTags() {
  return normalizePptModelTags(loadPptConfig('modelTags'));
}

export function getPptRolePriority() {
  return normalizePptRolePriority(loadPptConfig('rolePriority'));
}

export function getPptAudioConfig() {
  return normalizePptAudioConfig(loadPptConfig('audio'));
}

/**
 * 构建 ModelRouter 所需的 usageConfig
 * - 优先使用 pptRolePriority 配置
 * - 回退到旧的单选配置
 * - 按 pptModelTags 软过滤（未标注的模型默认允许）
 */
export function buildPptUsageConfigForModelRouter() {
  const priority = getPptRolePriority();
  const tags = getPptModelTags();
  const legacyLang = loadPptConfig('lang')?.modelKey;
  const legacyVision = loadPptConfig('vision')?.modelKey;

  console.log('[ppt-model-bridge] buildPptUsageConfigForModelRouter:', {
    priority,
    legacyLang,
    legacyVision,
    tagsCount: Object.keys(tags).length
  });

  // 能力过滤：检查模型是否有所需标签（未标注则允许）
  function getTagsForCandidate(key) {
    if (!key) return [];
    const direct = tags[key];
    if (Array.isArray(direct) && direct.length) return direct;

    // 兼容新格式：{ "openai:gpt-4o": ["lang"] }
    const prefix = `${key}:`;
    const agg = new Set();
    for (const [k, v] of Object.entries(tags)) {
      if (!k.startsWith(prefix)) continue;
      if (!Array.isArray(v)) continue;
      for (const t of v) agg.add(t);
    }
    return Array.from(agg);
  }

  function filterByCapability(models, requiredTag) {
    const filtered = models.filter(key => {
      const modelTags = getTagsForCandidate(key);
      if (!modelTags || modelTags.length === 0) return true; // 未标注则允许
      return modelTags.includes(requiredTag);
    });
    // 如果过滤后变空，记录警告
    if (models.length > 0 && filtered.length === 0) {
      console.warn('[ppt-model-bridge] filterByCapability filtered out all models:', {
        models,
        requiredTag,
        modelTagsMap: models.map(m => ({ model: m, tags: getTagsForCandidate(m) }))
      });
    }
    return filtered;
  }

  // 构建 usageConfig
  const result = {};
  const textRoles = ['analyst', 'planner', 'writer', 'reviewer', 'worker'];

  for (const role of textRoles) {
    let candidates = priority[role];
    if (!candidates || candidates.length === 0) {
      candidates = legacyLang ? [legacyLang] : [];
    }
    result[role] = filterByCapability(candidates, 'lang');
  }

  // vision 特殊处理
  let visionCandidates = priority.vision;
  if (!visionCandidates || visionCandidates.length === 0) {
    visionCandidates = legacyVision ? [legacyVision] : [];
  }
  result.vision = filterByCapability(visionCandidates, 'vision');

  console.log('[ppt-model-bridge] usageConfig result:', result);
  return result;
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
    const modelExplicit = typeof callOpts.model === 'string' && callOpts.model.trim();

    // 如果调用者没有指定 model / 或使用 auto，则用 PPT 配置
    if (config?.modelKey && (!modelExplicit || callOpts.model === 'auto')) {
      // 优先走内部 resolve + callApi，确保可用 modelId 生效（包括预设源站）
      if (typeof aiApiService._resolveModelConfig === 'function' && typeof aiApiService._callApi === 'function') {
        const temperature = typeof callOpts.temperature === 'number' ? callOpts.temperature : 0.7;
        const maxTokens = typeof callOpts.maxTokens === 'number' ? callOpts.maxTokens : 4096;
        const apiConfig = aiApiService._resolveModelConfig(config.modelKey, config.modelId || null);
        if (apiConfig) return aiApiService._callApi(apiConfig, messages, temperature, maxTokens);
      }

      // 兼容公开 chat 接口（无法为预设源站指定 modelId 时，退回到源站默认模型）
      if (config.modelKey.startsWith('custom_source_') && config.modelId) {
        const siteId = config.modelKey.slice('custom_source_'.length);
        callOpts.model = `${siteId}:${config.modelId}`;
      } else {
        callOpts.model = config.modelKey;
      }
    }

    // 兼容旧字段：modelId -> model
    if (!callOpts.model && typeof callOpts.modelId === 'string' && callOpts.modelId.trim()) {
      callOpts.model = callOpts.modelId.trim();
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
      const modelExplicit = typeof callOpts.model === 'string' && callOpts.model.trim();

      // 如果调用者没有指定 model / 或使用 auto，则用 PPT 配置
      if (config?.modelKey && (!modelExplicit || callOpts.model === 'auto')) {
        // 优先走内部 resolve + callApi，确保可用 modelId 生效（包括预设源站）
        if (typeof baseService._resolveModelConfig === 'function' && typeof baseService._callApi === 'function' && Array.isArray(callOpts.messages)) {
          const temperature = typeof callOpts.temperature === 'number' ? callOpts.temperature : 0.7;
          const maxTokens = typeof callOpts.maxTokens === 'number' ? callOpts.maxTokens : 4096;
          const apiConfig = baseService._resolveModelConfig(config.modelKey, config.modelId || null);
          if (apiConfig) return baseService._callApi(apiConfig, callOpts.messages, temperature, maxTokens);
        }

        // 兼容公开 chat 接口（无法为预设源站指定 modelId 时，退回到源站默认模型）
        if (config.modelKey.startsWith('custom_source_') && config.modelId) {
          const siteId = config.modelKey.slice('custom_source_'.length);
          callOpts.model = `${siteId}:${config.modelId}`;
        } else {
          callOpts.model = config.modelKey;
        }
      }

      // 兼容旧字段：modelId -> model
      if (!callOpts.model && typeof callOpts.modelId === 'string' && callOpts.modelId.trim()) {
        callOpts.model = callOpts.modelId.trim();
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
        vision: loadPptConfig('vision'),
        modelTags: loadPptConfig('modelTags'),
        rolePriority: loadPptConfig('rolePriority'),
        audio: loadPptConfig('audio')
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
