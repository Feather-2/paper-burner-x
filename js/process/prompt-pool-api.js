// process/prompt-pool-api.js
// 提示词池 - 统一生成调用配置，复用 translation.js 的构建逻辑

(function() {
  /**
   * 构建用于提示词池生成请求的 API 配置。
   * - 预设模型：使用与翻译相同的端点与请求格式（deepseek/mistral/gemini）。
   * - 自定义源站点：复用 buildCustomApiConfig，自动补全兼容端点（/v1/chat/completions 等）。
   *
   * @param {string} apiModel - 预设模型名（mistral/deepseek/gemini）或 "siteId:modelId"。
   * @param {string} apiKey - 对应模型的 API Key。
   * @returns {{endpoint:string, modelName:string, headers:Object, bodyBuilder:Function, responseExtractor:Function}}
   */
  function buildPromptPoolGenerationConfig(apiModel, apiKey) {
    if (!apiModel) throw new Error('未指定模型');
    if (!apiKey) throw new Error('未提供 API Key');

    // 延迟检查，避免初始化时机问题
    const ensureBuilders = () => {
      if (typeof processModule === 'undefined' ||
          typeof processModule.buildCustomApiConfig !== 'function' ||
          typeof processModule.buildPredefinedApiConfig !== 'function') {
        throw new Error('translation.js 尚未加载，无法构建 API 配置');
      }
    };

    // 自定义源站点（格式：siteId:modelId）
    if (apiModel.includes(':')) {
      ensureBuilders();
      const [siteId, modelId] = apiModel.split(':');
      const allSites = (typeof loadAllCustomSourceSites === 'function') ? loadAllCustomSourceSites() : {};
      const site = allSites[siteId];
      if (!site) throw new Error(`未找到源站点配置：${siteId}`);

      // 复用 translation.js 的自定义构建，自动处理端点后缀与请求格式
      return processModule.buildCustomApiConfig(
        apiKey,
        site.apiEndpoint || site.apiBaseUrl,
        modelId || site.modelId,
        site.requestFormat || 'openai',
        site.temperature !== undefined ? site.temperature : 0.5,
        site.max_tokens !== undefined ? site.max_tokens : 8000,
        {
          endpointMode: site.endpointMode || 'auto'
        }
      );
    }

    // 预设模型（与 translateMarkdown 保持一致）
    ensureBuilders();
    const settings = (typeof loadSettings === 'function') ? loadSettings() : {};
    const temperature = (settings.customModelSettings && settings.customModelSettings.temperature) || 0.5;
    const maxTokens = (settings.customModelSettings && settings.customModelSettings.max_tokens) || 8000;

    const predefined = {
      deepseek: {
        endpoint: 'https://api.deepseek.com/v1/chat/completions',
        modelName: 'DeepSeek v3 (deepseek-v3)',
        headers: { 'Content-Type': 'application/json' },
        bodyBuilder: (sys, user) => ({
          model: 'deepseek-chat',
          messages: [ { role: 'system', content: sys }, { role: 'user', content: user } ],
          temperature, max_tokens: maxTokens
        }),
        responseExtractor: d => d?.choices?.[0]?.message?.content
      },
      gemini: {
        endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
        modelName: 'Google Gemini 2.0 Flash',
        headers: { 'Content-Type': 'application/json' },
        bodyBuilder: (sys, user) => ({
          contents: [ { role: 'user', parts: [{ text: `${sys}\n\n${user}` }] } ],
          generationConfig: { temperature, maxOutputTokens: maxTokens }
        }),
        responseExtractor: d => d?.candidates?.[0]?.content?.parts?.[0]?.text || ''
      },
      mistral: {
        endpoint: 'https://api.mistral.ai/v1/chat/completions',
        modelName: 'Mistral Large (mistral-large-latest)',
        headers: { 'Content-Type': 'application/json' },
        bodyBuilder: (sys, user) => ({
          model: 'mistral-large-latest',
          messages: [ { role: 'system', content: sys }, { role: 'user', content: user } ],
          temperature, max_tokens: maxTokens
        }),
        responseExtractor: d => d?.choices?.[0]?.message?.content
      }
    };

    if (!predefined[apiModel]) throw new Error(`不支持的模型：${apiModel}`);
    return processModule.buildPredefinedApiConfig(predefined[apiModel], apiKey);
  }

  // 暴露到全局
  if (typeof window !== 'undefined') {
    window.buildPromptPoolGenerationConfig = buildPromptPoolGenerationConfig;
  }
})();
