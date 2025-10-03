// api-config-builder.js
// API配置构建模块

(function() {
  'use strict';

  // =====================
  // buildCustomApiConfig: 兼容自定义模型调用
  // =====================
  /**
   * 构建自定义 API 访问配置。
   * 该函数负责根据传入的参数，生成一个完整的 API 请求配置对象，
   * 包括请求端点、模型ID、请求头、请求体构建器、响应提取器以及流式支持等。
   *
   * 主要逻辑：
   * 1. 端点处理：如果 `window.modelDetector` 存在且能提供完整端点，则优先使用。
   *    否则，如果提供的 `customApiEndpoint` 不规范（不含 `/v1/` 或 `/v1` 结尾），
   *    会自动拼接 `/v1/chat/completions`。
   * 2. 请求格式自动推断：如果 `customRequestFormat` 为空且端点以 `/v1/chat/completions` 结尾，
   *    则自动设置为 `openai` 格式。
   * 3. 模型ID获取：如果 `window.modelDetector` 存在，则尝试获取当前选择的模型ID。
   * 4. 根据 `customRequestFormat` (如 'openai', 'anthropic', 'gemini' 等) 构建特定配置：
   *    - 设置认证头 (Authorization, x-api-key)。
   *    - 定义 `bodyBuilder` 用于构建非流式请求的请求体。
   *    - 定义 `streamBodyBuilder` 用于构建流式请求的请求体。
   *    - 定义 `responseExtractor` 用于从 API 响应中提取所需内容。
   *    - 设置 `streamSupport` 标记是否支持流式响应。
   *    - 为 Gemini 等特殊模型处理端点参数 (如 `alt=sse`)。
   * 5. 对于不支持的 `customRequestFormat`，会抛出错误。
   * 6. 最终返回构建好的 `config` 对象。
   *
   * @param {string} key API 密钥。
   * @param {string} customApiEndpoint 自定义 API 端点基础 URL。
   * @param {string} customModelId 自定义模型 ID。
   * @param {string} customRequestFormat 自定义请求格式 (例如 'openai', 'anthropic', 'gemini')。
   * @param {number} [temperature] 模型温度参数，控制生成文本的随机性。
   * @param {number} [max_tokens] 模型最大输出 token 数。
   * @returns {object} 构建好的 API 配置对象，包含 endpoint, modelName, headers, bodyBuilder, responseExtractor, streamSupport, streamBodyBuilder 等。
   * @throws {Error} 如果 customRequestFormat 不被支持。
   */

  // 辅助函数：如果 userContent 是数组，则提取其中的文本内容
  const extractTextFromUserContent = (userContent) => {
    if (Array.isArray(userContent)) {
      const textPart = userContent.find(part => part.type === 'text');
      return textPart ? textPart.text : '';
    }
    return userContent; // 假设已经是字符串
  };

  // 辅助函数：将 OpenAI 风格的 userContent 转换为 Gemini 格式
  const convertOpenAIToGeminiParts = (userContent) => {
    if (Array.isArray(userContent)) {
      return userContent.map(part => {
        if (part.type === 'text') {
          return { text: part.text };
        } else if (part.type === 'image_url' && part.image_url && part.image_url.url) {
          const base64Data = part.image_url.url.split(',')[1];
          if (!base64Data) return null;
          const mimeType = part.image_url.url.match(/^data:(image\/\w+);base64,/)?.[1] || 'image/jpeg';
          return { inlineData: { mimeType: mimeType, data: base64Data } };
        }
        return null;
      }).filter(p => p);
    }
    return [{ text: userContent }]; // 假设为字符串
  };

  // 辅助函数：将 OpenAI 风格的 userContent 转换为 Anthropic 格式
  const convertOpenAIToAnthropicContent = (userContent) => {
    if (Array.isArray(userContent)) {
      return userContent.map(part => {
        if (part.type === 'text') {
          return { type: 'text', text: part.text };
        } else if (part.type === 'image_url' && part.image_url && part.image_url.url) {
          const base64Data = part.image_url.url.split(',')[1];
          if (!base64Data) return null;
          const mediaType = part.image_url.url.match(/^data:(image\/\w+);base64,/)?.[1] || 'image/jpeg';
          return { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } };
        }
        return null;
      }).filter(p => p);
    }
    return [{ type: 'text', text: userContent }]; // 假设为字符串
  };

  const appendPathSegment = (base, segment) => {
    if (!base) return segment || '';
    if (!segment) return base;
    const hasTrailingSlash = base.endsWith('/');
    const hasLeadingSlash = segment.startsWith('/');
    if (hasTrailingSlash && hasLeadingSlash) {
      return base + segment.slice(1);
    }
    if (!hasTrailingSlash && !hasLeadingSlash) {
      return `${base}/${segment}`;
    }
    return base + segment;
  };

  const normalizeOpenAIEndpointForChatbot = (baseApiUrlInput, format, endpointMode = 'auto', targetSegment) => {
    if (!baseApiUrlInput || typeof baseApiUrlInput !== 'string') {
      throw new Error('自定义模型需要提供 API Base URL');
    }

    const trimmed = baseApiUrlInput.trim();
    if (!trimmed) {
      throw new Error('自定义模型需要提供 API Base URL');
    }

    const mode = endpointMode || 'auto';
    const normalizedSegment = (targetSegment
      ? targetSegment
      : ((format || '').toLowerCase() === 'anthropic' ? 'messages' : 'chat/completions'))
      .replace(/^\/+/, '');

    const lower = trimmed.toLowerCase();
    const base = trimmed.replace(/\/+$/, '');
    const v1Segment = normalizedSegment.startsWith('v1/') ? normalizedSegment : `v1/${normalizedSegment}`;

    const terminalPaths = [
      normalizedSegment,
      `/${normalizedSegment}`,
      v1Segment,
      `/${v1Segment}`
    ];

    if (terminalPaths.some(path => lower.endsWith(path))) {
      return base;
    }

    if (mode === 'manual') {
      return base;
    }

    if (mode === 'chat') {
      return appendPathSegment(base, normalizedSegment);
    }

    if (/\/v1$/.test(lower)) {
      return appendPathSegment(base, normalizedSegment);
    }

    return appendPathSegment(base, v1Segment);
  };

  function buildCustomApiConfig(key, customApiEndpoint, customModelId, customRequestFormat, temperature, max_tokens, options = {}) {
    let apiEndpoint = customApiEndpoint;
    let modelId = customModelId;
    const endpointMode = options.endpointMode || 'auto';
    let resolvedRequestFormat = customRequestFormat;

    // 检查是否有模型检测模块，如果有则使用其提供的完整端点
    if (typeof window.modelDetector !== 'undefined' && typeof window.modelDetector.getFullApiEndpoint === 'function') {
      const fullEndpoint = window.modelDetector.getFullApiEndpoint();
      if (fullEndpoint) {
        apiEndpoint = fullEndpoint;
      } else {
        apiEndpoint = normalizeOpenAIEndpointForChatbot(apiEndpoint, resolvedRequestFormat, endpointMode);
      }
    } else {
      apiEndpoint = normalizeOpenAIEndpointForChatbot(apiEndpoint, resolvedRequestFormat, endpointMode);
    }

    // 新增：如果 customRequestFormat 为空且 endpoint 以 /v1/chat/completions 结尾，则自动设为 openai
    if ((!resolvedRequestFormat || resolvedRequestFormat === '') && apiEndpoint && apiEndpoint.endsWith('/v1/chat/completions')) {
      resolvedRequestFormat = 'openai';
    }

    // 获取当前选择的模型ID（如果有模型检测模块）
    if (typeof window.modelDetector !== 'undefined') {
      const currentModelId = window.modelDetector.getCurrentModelId();
      if (currentModelId) {
        modelId = currentModelId;
      }
    }

    const config = {
      endpoint: apiEndpoint,
      modelName: modelId, // 使用最新获取的modelId
      headers: { 'Content-Type': 'application/json' },
      bodyBuilder: null,
      responseExtractor: null,
      streamSupport: false, // 默认不支持流式
      streamBodyBuilder: null // 流式请求构建器
    };

    const normalizedFormat = (resolvedRequestFormat || 'openai').toLowerCase();

    switch (normalizedFormat) {
      case 'openai':
      case 'openai-vision': // Add a specific format for vision-enabled OpenAI
        config.headers['Authorization'] = `Bearer ${key}`;
        config.bodyBuilder = (sys_prompt, user_content) => ({ // user_content can be string or array
          model: modelId,
          messages: [{ role: "system", content: sys_prompt }, { role: "user", content: user_content }],
          temperature: temperature ?? 0.5,
          max_tokens: max_tokens ?? 8000
        });
        config.streamBodyBuilder = (sys, msgs, user_content) => ({ // user_content can be string or array
          model: modelId,
          messages: [
            { role: 'system', content: sys },
            ...msgs,
            { role: 'user', content: user_content }
          ],
          temperature: temperature ?? 0.5,
          max_tokens: max_tokens ?? 8000,
          stream: true
        });
        config.responseExtractor = (data) => data?.choices?.[0]?.message?.content;
        config.streamSupport = true;
        break;
      case 'anthropic':
        config.headers['x-api-key'] = key;
        config.headers['anthropic-version'] = '2023-06-01';
        config.bodyBuilder = (sys_prompt, user_content) => ({
          model: modelId,
          system: sys_prompt,
          messages: [{ role: "user", content: convertOpenAIToAnthropicContent(user_content) }],
          temperature: temperature ?? 0.5,
          max_tokens: max_tokens ?? 8000
        });
        config.streamBodyBuilder = (sys, msgs, user_content) => {
          return {
            model: modelId,
            system: sys,
            messages: msgs.length ?
              [...msgs, { role: 'user', content: convertOpenAIToAnthropicContent(user_content) }] :
              [{ role: 'user', content: convertOpenAIToAnthropicContent(user_content) }],
            max_tokens: max_tokens ?? 8000,
            temperature: temperature ?? 0.5,
            stream: true
          };
        };
        config.responseExtractor = (data) => data?.content?.[0]?.text;
        config.streamSupport = true;
        config.streamHandler = 'claude';
        break;
      case 'gemini':
      case 'gemini-preview': // Assuming gemini-preview also supports this
        let baseUrl = config.endpoint.split('?')[0];
        config.endpoint = `${baseUrl}?key=${key}`;
        config.streamEndpoint = `${baseUrl}?key=${key}&alt=sse`;
        const geminiModelIdToUse = modelId || (normalizedFormat === 'gemini-preview' ? 'gemini-1.5-flash-latest' : 'gemini-pro'); // Updated default for preview
        config.modelName = geminiModelIdToUse;

        config.bodyBuilder = (sys_prompt, user_content) => ({
          contents: [{ role: "user", parts: convertOpenAIToGeminiParts(user_content) }],
          generationConfig: { temperature: temperature ?? 0.5, maxOutputTokens: max_tokens ?? 8192 },
          ...(sys_prompt && { systemInstruction: { parts: [{ text: sys_prompt }] }})
        });
        config.streamBodyBuilder = (sys, msgs, user_content) => {
          const geminiMessages = [];
          if (msgs.length) {
            for (const msg of msgs) {
              geminiMessages.push({ role: msg.role === 'assistant' ? 'model' : 'user', parts: convertOpenAIToGeminiParts(msg.content) });
            }
          }
          geminiMessages.push({ role: 'user', parts: convertOpenAIToGeminiParts(user_content) });
          return {
            contents: geminiMessages,
            generationConfig: {
              temperature: temperature ?? 0.5,
              maxOutputTokens: max_tokens ?? 8192,
              ...(normalizedFormat === 'gemini-preview' && { responseModalities: ["TEXT"], responseMimeType: "text/plain" })
            },
            ...(sys && { systemInstruction: { parts: [{ text: sys }] }})
          };
        };
        config.responseExtractor = (data) => {
          if (data?.candidates && data.candidates.length > 0 && data.candidates[0].content) {
            const parts = data.candidates[0].content.parts;
            return parts && parts.length > 0 ? parts.map(p => p.text).join('') : ''; // Join text parts
          }
          return '';
        };
        config.streamSupport = true;
        config.streamHandler = 'gemini';
        break;
      case 'volcano':
      case 'tongyi':
        config.headers['Authorization'] = `Bearer ${key}`;
        let specificModelId = '';
        // 读取保存的默认模型ID作为具体模型
        try {
          const cfg = (customRequestFormat === 'volcano') ? (window.loadModelConfig && loadModelConfig('volcano')) : (window.loadModelConfig && loadModelConfig('tongyi'));
          if (cfg && (cfg.preferredModelId || cfg.modelId)) specificModelId = cfg.preferredModelId || cfg.modelId;
        } catch {}

        config.bodyBuilder = (sys_prompt, user_content) => ({
          model: modelId || specificModelId,
          messages: [
            { role: 'system', content: sys_prompt },
            { role: 'user', content: extractTextFromUserContent(user_content) }
          ],
          temperature: temperature ?? 0.5,
          max_tokens: max_tokens ?? 8192,
          stream: true
        });
        config.streamBodyBuilder = (sys, msgs, user_content) => ({
          model: modelId || specificModelId,
          messages: [
            { role: 'system', content: sys },
            ...msgs.map(m => ({ role: m.role, content: extractTextFromUserContent(m.content) })),
            { role: 'user', content: extractTextFromUserContent(user_content) }
          ],
          temperature: temperature ?? 0.5,
          max_tokens: max_tokens ?? 8192,
          stream: true
        });
        config.responseExtractor = (data) => data?.choices?.[0]?.message?.content;
        config.streamSupport = true;
        config.streamHandler = true;
        break;
      default:
        config.headers['Authorization'] = `Bearer ${key}`;
        config.bodyBuilder = (sys_prompt, user_content) => ({
          model: modelId,
          messages: [{ role: "system", content: sys_prompt }, { role: "user", content: extractTextFromUserContent(user_content) }],
          temperature: temperature ?? 0.5,
          max_tokens: max_tokens ?? 8000
        });
        config.streamBodyBuilder = (sys, msgs, user_content) => ({
          model: modelId,
          messages: [
            { role: 'system', content: sys },
            ...msgs.map(m => ({ role: m.role, content: extractTextFromUserContent(m.content) })),
            { role: 'user', content: extractTextFromUserContent(user_content) }
          ],
          stream: true,
          temperature: temperature ?? 0.5,
          max_tokens: max_tokens ?? 8000,
        });
        config.responseExtractor = (data) => data?.choices?.[0]?.message?.content;
        config.streamSupport = true;
        console.warn(`Custom request format "${resolvedRequestFormat}" is not explicitly handled for multimodal input. Defaulting to text-only for user messages if images are provided.`);
    }
    console.log('buildCustomApiConfig:', {
      customRequestFormat: resolvedRequestFormat,
      endpoint: apiEndpoint,
      modelId,
      streamSupport: config.streamSupport,
      hasStreamBodyBuilder: !!config.streamBodyBuilder
    });
    return config;
  }

  // 导出到全局
  window.ApiConfigBuilder = {
    buildCustomApiConfig
  };

})();
