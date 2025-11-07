// chatbot/core/chatbot-config-manager.js
// Chatbot 独立配置管理器 - 将chatbot模型配置与翻译模型解耦

/**
 * Chatbot配置结构：
 * {
 *   sourceType: 'predefined' | 'custom',  // 模型来源类型
 *   model: string,                        // 预设模型名称（mistral/deepseek等）或'custom'
 *   customSourceSiteId: string,           // 自定义源站点ID（当sourceType='custom'时）
 *   selectedModelId: string,              // 选择的具体模型ID
 *   temperature: number,                  // 温度参数
 *   max_tokens: number,                   // 最大token数
 *   concurrency: number                   // 并发数
 * }
 */

const CHATBOT_CONFIG_KEY = 'chatbotModelConfig';

/**
 * 保存chatbot配置到localStorage
 * @param {Object} config - chatbot配置对象
 */
function saveChatbotConfig(config) {
  try {
    const configToSave = {
      sourceType: config.sourceType || 'predefined',
      model: config.model || 'mistral',
      customSourceSiteId: config.customSourceSiteId || null,
      selectedModelId: config.selectedModelId || '',
      temperature: config.temperature !== undefined ? config.temperature : 0.5,
      max_tokens: config.max_tokens || 8000,
      concurrency: config.concurrency || 10
    };

    localStorage.setItem(CHATBOT_CONFIG_KEY, JSON.stringify(configToSave));
    console.log('[Chatbot Config] 配置已保存:', configToSave);
    return true;
  } catch (e) {
    console.error('[Chatbot Config] 保存配置失败:', e);
    return false;
  }
}

/**
 * 从localStorage加载chatbot配置
 * @returns {Object|null} - chatbot配置对象，如果不存在则返回null
 */
function loadChatbotConfig() {
  try {
    const configStr = localStorage.getItem(CHATBOT_CONFIG_KEY);
    if (!configStr) {
      return null;
    }

    const config = JSON.parse(configStr);
    console.log('[Chatbot Config] 配置已加载:', config);
    return config;
  } catch (e) {
    console.error('[Chatbot Config] 加载配置失败:', e);
    return null;
  }
}

/**
 * 从翻译模型配置初始化chatbot配置（首次使用时的回退逻辑）
 * @returns {Object} - 初始化后的chatbot配置
 */
function initializeChatbotConfigFromTranslation() {
  console.log('[Chatbot Config] 首次初始化，从翻译模型配置回退...');

  // 加载系统设置
  const settings = (typeof loadSettings === 'function')
    ? loadSettings()
    : JSON.parse(localStorage.getItem('paperBurnerSettings') || '{}');

  const translationModel = settings.selectedTranslationModel || 'mistral';
  const customModelSettings = settings.customModelSettings || {};

  let config = {
    sourceType: 'predefined',
    model: translationModel,
    customSourceSiteId: null,
    selectedModelId: '',
    temperature: customModelSettings.temperature !== undefined ? customModelSettings.temperature : 0.5,
    max_tokens: customModelSettings.max_tokens || 8000,
    concurrency: 10
  };

  // 如果翻译模型是自定义源站点
  if (translationModel === 'custom' && settings.selectedCustomSourceSiteId) {
    config.sourceType = 'custom';
    config.customSourceSiteId = settings.selectedCustomSourceSiteId;

    // 尝试加载源站点的可用模型列表，选择第一个作为默认
    const allSites = (typeof loadAllCustomSourceSites === 'function')
      ? loadAllCustomSourceSites()
      : {};
    const site = allSites[settings.selectedCustomSourceSiteId];

    if (site) {
      // 从源站点加载配置
      config.temperature = site.temperature !== undefined ? site.temperature : 0.5;
      config.max_tokens = site.max_tokens || 8000;

      // 如果有可用模型列表，选择第一个
      if (site.availableModels && site.availableModels.length > 0) {
        const firstModel = site.availableModels[0];
        // 处理对象和字符串两种情况
        if (typeof firstModel === 'string') {
          config.selectedModelId = firstModel;
        } else if (typeof firstModel === 'object' && firstModel !== null) {
          config.selectedModelId = firstModel.id || firstModel.modelId || firstModel.value || '';
        }
      } else if (site.modelId) {
        config.selectedModelId = site.modelId;
      }
    }
  }

  // 保存初始化的配置
  saveChatbotConfig(config);

  console.log('[Chatbot Config] 初始化完成:', config);
  return config;
}

/**
 * 获取chatbot配置，优先使用chatbot专用配置，否则从翻译模型初始化
 * @returns {Object} - chatbot配置对象
 */
function getChatbotModelConfig() {
  let config = loadChatbotConfig();

  // 如果没有chatbot配置，从翻译模型初始化
  if (!config) {
    config = initializeChatbotConfigFromTranslation();
  }

  return config;
}

/**
 * 将chatbot配置转换为message-sender.js需要的格式
 * @param {Object} chatbotConfig - chatbot配置对象
 * @returns {Object} - 包含model, apiKey, apiKeyId, cms, settings等的配置对象
 */
function convertChatbotConfigToMessageSenderFormat(chatbotConfig) {
  const settings = (typeof loadSettings === 'function')
    ? loadSettings()
    : JSON.parse(localStorage.getItem('paperBurnerSettings') || '{}');

  let model = chatbotConfig.model;
  let cms = {
    temperature: chatbotConfig.temperature,
    max_tokens: chatbotConfig.max_tokens
  };
  let siteSpecificAvailableModels = [];

  // 如果是自定义源站点
  if (chatbotConfig.sourceType === 'custom' && chatbotConfig.customSourceSiteId) {
    const allSites = (typeof loadAllCustomSourceSites === 'function')
      ? loadAllCustomSourceSites()
      : {};
    const site = allSites[chatbotConfig.customSourceSiteId];

    if (site) {
      cms = {
        ...site,
        temperature: chatbotConfig.temperature,
        max_tokens: chatbotConfig.max_tokens
      };
      model = `custom_source_${chatbotConfig.customSourceSiteId}`;
      siteSpecificAvailableModels = site.availableModels || [];

      // 如果指定了具体模型ID，覆盖cms.modelId
      if (chatbotConfig.selectedModelId) {
        cms.modelId = chatbotConfig.selectedModelId;
      }
    }
  } else {
    // 预设模型
    cms.modelId = chatbotConfig.selectedModelId;
  }

  // 获取API Key
  let activeApiKey = '';
  let activeKeyId = null;

  if (typeof loadModelKeys === 'function') {
    const keysForModel = loadModelKeys(model);
    if (keysForModel && Array.isArray(keysForModel)) {
      const usableKeys = keysForModel.filter(k => k.status === 'valid' || k.status === 'untested');
      if (usableKeys.length > 0) {
        activeApiKey = usableKeys[0].value;
        activeKeyId = usableKeys[0].id;
      }
    }
  }

  return {
    model,
    apiKey: activeApiKey,
    apiKeyId: activeKeyId,
    cms,
    settings,
    siteSpecificAvailableModels,
    chatbotConcurrency: chatbotConfig.concurrency
  };
}

/**
 * 重置chatbot配置（删除独立配置，下次将从翻译模型重新初始化）
 */
function resetChatbotConfig() {
  try {
    localStorage.removeItem(CHATBOT_CONFIG_KEY);
    console.log('[Chatbot Config] 配置已重置');
    return true;
  } catch (e) {
    console.error('[Chatbot Config] 重置配置失败:', e);
    return false;
  }
}

/**
 * 检查chatbot是否已配置
 * @returns {boolean}
 */
function isChatbotConfigured() {
  const config = loadChatbotConfig();
  return config !== null;
}

// 导出到全局
if (typeof window !== 'undefined') {
  window.ChatbotConfigManager = {
    saveChatbotConfig,
    loadChatbotConfig,
    getChatbotModelConfig,
    initializeChatbotConfigFromTranslation,
    convertChatbotConfigToMessageSenderFormat,
    resetChatbotConfig,
    isChatbotConfigured
  };
}

// ES Module 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    saveChatbotConfig,
    loadChatbotConfig,
    getChatbotModelConfig,
    initializeChatbotConfigFromTranslation,
    convertChatbotConfigToMessageSenderFormat,
    resetChatbotConfig,
    isChatbotConfigured
  };
}
