// chatbot-core.js

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

// 聊天历史（上下文）
/** @type {Array<{role: string, content: string}>} */
let chatHistory = [];
let isChatbotLoading = false;

// =============== 新增：对话历史持久化 ===============
/**
 * 保存当前文档的聊天历史到 localStorage
 * @param {string} docId
 * @param {Array} history
 */
function saveChatHistory(docId, history) {
  try {
    //console.log(`[saveChatHistory] Saving history for docId: "${docId}". History:`, JSON.stringify(history));
    localStorage.setItem('chatHistory_' + docId, JSON.stringify(history));
  } catch (e) {
    console.error('[saveChatHistory] Error saving chat history:', e);
    // 忽略
  }
}
/**
 * 加载当前文档的聊天历史
 * @param {string} docId
 * @returns {Array}
 */
function loadChatHistory(docId) {
  try {
    const raw = localStorage.getItem('chatHistory_' + docId);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return [];
}
/**
 * 清空当前文档的聊天历史
 * @param {string} docId
 */
function clearChatHistory(docId) {
  try {
    localStorage.removeItem('chatHistory_' + docId);
  } catch (e) {}
}

/**
 * 重新加载当前文档的聊天历史，并刷新UI
 * @param {function} updateChatbotUI
 */
function reloadChatHistoryAndUpdateUI(updateChatbotUI) {
  const docId = getCurrentDocId();
  const loaded = loadChatHistory(docId);
  chatHistory.length = 0;
  loaded.forEach(m => chatHistory.push(m));
  if (typeof updateChatbotUI === 'function') updateChatbotUI();
}

// =============== 新增：清空当前文档对话历史 ===============
/**
 * 清空当前文档的聊天历史（内存和localStorage），并刷新UI
 * @param {function} updateChatbotUI - 更新UI的回调函数
 */
function clearCurrentDocChatHistory(updateChatbotUI) {
  const docId = getCurrentDocId();
  chatHistory.length = 0; // 清空内存中的历史
  clearChatHistory(docId); // 从 localStorage 清除
  console.log(`Chat history for docId '${docId}' cleared.`);
  if (typeof updateChatbotUI === 'function') {
    updateChatbotUI(); // 刷新UI
  }
}

// =============== 新增：删除指定索引的聊天消息 ===============
/**
 * 删除指定索引的聊天消息。
 * @param {string} docId 当前文档的ID。
 * @param {number} index 要删除消息的索引。
 * @param {function} updateUIAfterDelete 删除后更新UI的回调函数。
 */
function deleteMessageFromHistory(docId, index, updateUIAfterDelete) {
  if (index >= 0 && index < chatHistory.length) {
    chatHistory.splice(index, 1); // 从数组中移除消息
    saveChatHistory(docId, chatHistory); // 保存更新后的历史记录
    console.log(`Message at index ${index} for docId '${docId}' deleted.`);
    if (typeof updateUIAfterDelete === 'function') {
      updateUIAfterDelete(); // 调用回调更新UI
    }
  } else {
    console.error(`[deleteMessageFromHistory] Invalid index: ${index} for chatHistory of length ${chatHistory.length}`);
  }
}

// 读取主页面配置（API Key、模型等）
/**
 * 读取聊天机器人配置。
 * 该函数负责从 localStorage (或外部传入的配置) 中加载与聊天机器人相关的设置。
 *
 * 主要步骤：
 * 1. 如果提供了 `externalConfig`，则直接返回该配置。
 * 2. 否则，尝试从 localStorage 加载 `paperBurnerSettings`。
 * 3. 获取当前选择的翻译模型 (`selectedTranslationModel`)，默认为 'mistral'。
 * 4. 如果选择的模型是 'custom' 并且存在 `selectedCustomSourceSiteId`：
 *    - 尝试加载所有自定义源站点配置 (`loadAllCustomSourceSites`)。
 *    - 找到对应的站点配置，并将其作为 `cms` (customModelSettings)。
 *    - 更新 `model` 名称为 `custom_source_{siteId}` 格式。
 *    - 获取该站点的可用模型列表 `siteSpecificAvailableModels`。
 * 5. 加载当前模型可用的 API Key (`loadModelKeys`)：
 *    - 筛选出状态为 'valid' 或 'untested' 的 Key。
 *    - 如果存在可用 Key，则选择第一个作为 `activeApiKey` 和 `activeKeyId`。
 * 6. 返回包含 `model`, `apiKey`, `apiKeyId`, `cms`, `settings`, `siteSpecificAvailableModels` 的配置对象。
 *
 * @param {object} [externalConfig=null] 可选的外部配置对象，如果提供，则直接使用此配置。
 * @returns {object} 包含模型、API Key、自定义模型设置等的配置对象。
 */
function getChatbotConfig(externalConfig = null) {
  if (externalConfig) return externalConfig;
  const settings = (typeof loadSettings === 'function') ? loadSettings() : JSON.parse(localStorage.getItem('paperBurnerSettings') || '{}');
  let model = settings.selectedTranslationModel || 'mistral';
  let cms = settings.customModelSettings || {};
  let siteSpecificAvailableModels = [];

  if (model === 'custom' && settings.selectedCustomSourceSiteId) {
    const allSites = typeof loadAllCustomSourceSites === 'function' ? loadAllCustomSourceSites() : {};
    const site = allSites[settings.selectedCustomSourceSiteId];
    if (site) {
      cms = site;
      model = `custom_source_${settings.selectedCustomSourceSiteId}`;
      siteSpecificAvailableModels = site.availableModels || [];
    }
  }

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
    siteSpecificAvailableModels
  };
}

// 获取当前文档内容（OCR/翻译）
/**
 * 获取当前文档的相关内容。
 * 该函数从全局 `window.data` 对象中提取 OCR 文本、翻译文本、图片列表和文档名称。
 * 这些信息将用于构建聊天机器人的上下文。
 *
 * @returns {object} 包含 `ocr`, `translation`, `images`, `name`, `semanticGroups` 的文档内容对象。
 *                   如果 `window.data` 不存在或内容为空，则返回相应的空值。
 */
function getCurrentDocContent() {
  if (window.data) {
    return {
      ocr: window.data.ocr || '',
      translation: window.data.translation || '',
      images: window.data.images || [],
      name: window.data.name || '',
      // 新增：传递意群数据
      semanticGroups: window.data.semanticGroups || null,
      ocrChunks: window.data.ocrChunks || null,
      translatedChunks: window.data.translatedChunks || null
    };
  }
  return { ocr: '', translation: '', images: [], name: '', semanticGroups: null, ocrChunks: null, translatedChunks: null };
}

// 组装对话消息格式
/**
 * 根据聊天历史和用户当前输入构建对话消息列表。
 * 消息格式遵循大语言模型 API 的标准，通常是 `{ role: 'user'/'assistant', content: '...' }`。
 *
 * @param {Array<object>} history 包含先前对话的数组，每个元素是一个消息对象。
 * @param {string} userInput 用户当前的输入文本。
 * @returns {Array<object>} 构建好的完整消息列表，准备发送给大模型。
 */
function buildChatMessages(history, userInput) {
  const messages = history.map(m => ({ role: m.role, content: m.content }));
  messages.push({ role: 'user', content: userInput });
  return messages;
}

// =============== 新增：智能分段函数 ===============
/**
 * 智能分段函数，用于将长文本内容分割成适合模型处理的块。
 *
 * 主要策略：
 * 1. 限制总长度：如果内容超过 50000 字符，则截取前 50000 字符。
 * 2. 短内容直接返回：如果内容长度小于等于 `maxChunk`，则直接返回包含单个块的数组。
 * 3. 长内容分割：
 *    - 迭代处理内容，每次尝试分割出一个 `maxChunk` 大小的块。
 *    - 优先在块的后半部分（`maxChunk * 0.3` 之后）寻找 Markdown 标题 (`#`, `##`, `###`) 作为分割点，
 *      以保持段落完整性。如果找到，则在该标题前分割。
 *    - 如果未找到合适的 Markdown 标题，则按 `maxChunk` 长度硬分割。
 * 4. 返回分割后的文本块数组。
 *
 * @param {string} content 需要分割的文本内容。
 * @param {number} [maxChunk=8192] 每个分块的最大字符数。
 * @returns {Array<string>} 分割后的文本块数组。
 */
function splitContentSmart(content, maxChunk = 8192) {
  // 最多只取前5万字
  if (content.length > 50000) content = content.slice(0, 50000);
  if (content.length <= maxChunk) return [content];
  const chunks = [];
  let start = 0;
  while (start < content.length) {
    let end = Math.min(start + maxChunk, content.length);
    // 优先在靠近中间的 markdown 标题处分割
    if (end < content.length) {
      const sub = content.slice(start, end);
      // 查找靠近结尾的 markdown 标题
      let idx = sub.lastIndexOf('\n#');
      if (idx === -1) idx = sub.lastIndexOf('\n##');
      if (idx === -1) idx = sub.lastIndexOf('\n###');
      if (idx > maxChunk * 0.3) {
        end = start + idx + 1; // +1补回\n
      }
    }
    chunks.push(content.slice(start, end));
    start = end;
  }
  return chunks;
}

// =============== 新增：文档唯一ID生成 ===============
/**
 * 生成当前文档的唯一 ID。
 * 该 ID 用于区分不同文档的聊天上下文或相关数据存储 (如思维导图数据)。
 * ID 的生成基于文档名称、图片数量、OCR 文本长度和翻译文本长度的组合，
 * 以期在实际使用中具有足够的唯一性。
 *
 * @returns {string} 当前文档的唯一 ID。
 */
function getCurrentDocId() {
  const doc = getCurrentDocContent();
  // 用文件名+图片数量+ocr长度+translation长度做唯一性（可根据实际情况调整）
  return `${doc.name || 'unknown'}_${(doc.images||[]).length}_${(doc.ocr||'').length}_${(doc.translation||'').length}`;
}

/**
 * 确保向量索引和BM25索引已建立
 * @param {Array} chunks - enrichedChunks数组
 * @param {Array} groups - 意群数组
 * @param {string} docId - 文档ID
 * @param {boolean} async - 是否异步建立索引（不阻塞）
 */
async function ensureIndexesBuilt(chunks, groups, docId, async = false) {
  if (!chunks || !Array.isArray(chunks) || chunks.length === 0) {
    return;
  }

  // 检查是否启用多轮检索
  const multiHopEnabled = (window.chatbotActiveOptions && window.chatbotActiveOptions.multiHopRetrieval === true);

  // 读取文档配置
  const docConfig = window.data?.multiHopConfig?.[docId];
  const useVectorSearch = docConfig?.useVectorSearch !== false; // 默认true

  // 异步建立向量索引（仅在启用多轮检索、用户配置允许且启用了向量搜索时）
  const buildVectorIndex = async () => {
    try {
      if (!multiHopEnabled) {
        console.log('[ChatbotCore] 多轮检索未启用，跳过向量索引生成');
        return;
      }

      if (!useVectorSearch) {
        console.log('[ChatbotCore] 用户选择不使用向量搜索，跳过向量索引生成');
        return;
      }

      if (window.EmbeddingClient?.config?.enabled && window.SemanticVectorSearch) {
        console.log(`[ChatbotCore] 检测到向量搜索已启用，开始为 ${chunks.length} 个chunks建立索引...`);
        await window.SemanticVectorSearch.indexChunks(chunks, docId, {
          showProgress: true,
          forceRebuild: false
        });
        // 更新UI显示
        if (window.ChatbotFloatingOptionsUI?.updateDisplay) {
          window.ChatbotFloatingOptionsUI.updateDisplay();
        }
      }
    } catch (vectorErr) {
      console.warn('[ChatbotCore] 建立向量索引失败（不影响意群功能）:', vectorErr);
    }
  };

  // 始终建立BM25索引（轻量级，无需API，作为fallback）
  try {
    if (window.SemanticBM25Search) {
      console.log('[ChatbotCore] 为chunks建立BM25索引...');
      window.SemanticBM25Search.indexChunks(chunks, docId);
      console.log('[ChatbotCore] BM25索引建立完成');
    }
  } catch (bm25Err) {
    console.warn('[ChatbotCore] 建立BM25索引失败:', bm25Err);
  }

  // 如果是异步模式，向量索引在后台进行
  if (async) {
    buildVectorIndex(); // 不await，让它在后台运行
    if (multiHopEnabled && useVectorSearch) {
      console.log('[ChatbotCore] 向量索引将在后台生成，不阻塞当前流程');
    }
  } else {
    await buildVectorIndex(); // 同步等待完成
  }
}

// 发送消息到大模型（支持思维导图请求）
/**
 * 发送消息到大语言模型并处理响应，支持思维导图生成请求。
 *
 * @param {string|Array<object>} userInput 用户输入的查询或指令 (can be a string for text, or an array for multimodal content).
 * @param {function} updateChatbotUI 更新聊天界面显示的回调函数。
 * @param {object} [externalConfig=null] 可选的外部配置对象，用于覆盖默认配置加载逻辑。
 * @param {string|Array<object>} [displayUserInput=null] Optional. The content to display in chat history for the user's turn. If null, userInput is used.
 * @returns {Promise<void>} 无明确返回值，主要通过回调更新 UI 和内部状态。
 */
async function sendChatbotMessage(userInput, updateChatbotUI, externalConfig = null, displayUserInput = null) {
  // 1. 在函数最开始获取 docId，并打印
  const docIdForThisMessage = getCurrentDocId();
  // console.log('[sendChatbotMessage] START - docId being used:', docIdForThisMessage);

  if (isChatbotLoading) {
    // console.log('[sendChatbotMessage] Chatbot is loading, returning.');
    return;
  }
  isChatbotLoading = true;

  // 2. 打印推入前的 chatHistory
  // console.log('[sendChatbotMessage] chatHistory BEFORE user message push:', JSON.stringify(chatHistory));
  chatHistory.push({ role: 'user', content: displayUserInput || userInput });
  // 3. 打印推入后的 chatHistory
  // console.log('[sendChatbotMessage] chatHistory AFTER user message push:', JSON.stringify(chatHistory));

  // 4. 在第一次 saveChatHistory 前打印将要保存的内容和 docId
  // console.log(`[sendChatbotMessage] Attempting to save USER message with docId: "${docIdForThisMessage}" and history:`, JSON.stringify(chatHistory)); // 这行由 saveChatHistory 内部日志替代
  saveChatHistory(docIdForThisMessage, chatHistory); // 使用在函数开始时获取的 docId

  if (typeof updateChatbotUI === 'function') updateChatbotUI();

  let plainTextInput = '';
  if (typeof userInput === 'string') {
    plainTextInput = userInput;
  } else if (Array.isArray(userInput)) {
    const textPart = userInput.find(part => part.type === 'text');
    if (textPart) {
      plainTextInput = textPart.text;
    }
  }

  const isMindMapRequest = plainTextInput.includes('思维导图') || plainTextInput.includes('脑图');
  const config = getChatbotConfig(externalConfig);
  let docContentInfo = getCurrentDocContent(); // <--- 获取当前文档的实际内容（初次）

  // ===== 新增：智能分段预处理 =====
  // 在首次对话时，检测是否需要生成意群
  await ensureSemanticGroupsReady(docContentInfo);
  // 重要：生成后重新获取文档内容以拿到 semanticGroups（避免使用旧的 docContentInfo 快照）
  docContentInfo = getCurrentDocContent();

  // 如果启用多轮取材，先让模型选择意群并附加上下文
  try {
    const multiHop = !!(window.chatbotActiveOptions && window.chatbotActiveOptions.multiHopRetrieval);
    // 智能检索开启时，自动启用智能分段和流式显示
    const segmented = multiHop ? true : ((window.chatbotActiveOptions && window.chatbotActiveOptions.contentLengthStrategy) === 'segmented');

    // 计算文档长度（与ensureSemanticGroupsReady保持一致）
    const translationText = docContentInfo.translation || '';
    const ocrText = docContentInfo.ocr || '';
    const chunkCandidates = [];
    if (Array.isArray(docContentInfo.translatedChunks)) {
      chunkCandidates.push(...docContentInfo.translatedChunks);
    }
    if (Array.isArray(docContentInfo.ocrChunks)) {
      chunkCandidates.push(...docContentInfo.ocrChunks);
    }
    let contentLength = Math.max(translationText.length, ocrText.length);
    if (contentLength < 50000 && chunkCandidates.length > 0) {
      const chunkLength = chunkCandidates.reduce((sum, chunk) => sum + (typeof chunk === 'string' ? chunk.length : 0), 0);
      contentLength = Math.max(contentLength, chunkLength);
    }
    const longDoc = contentLength >= 50000;

    console.log(`[ChatbotCore] 多轮检索条件检查: multiHop=${multiHop}, segmented=${segmented}, longDoc=${longDoc} (contentLength=${contentLength}), hasGroups=${Array.isArray(docContentInfo.semanticGroups) && docContentInfo.semanticGroups.length > 0}`);

    // 智能检索开启时，自动启用流式显示
    const useStreaming = multiHop ? true : ((window.chatbotActiveOptions && typeof window.chatbotActiveOptions.streamingRetrieval === 'boolean') ? window.chatbotActiveOptions.streamingRetrieval : true);

    // 多轮检索条件：启用了多轮检索 && 文档足够长
    // 注意：即使没有意群数据，仍然可以使用grep工具进行多轮检索
    if (multiHop && longDoc) {
      const userSet = window.semanticGroupsSettings || {};

      // 使用流式多轮取材（如果启用）
      if (useStreaming && typeof window.streamingMultiHopRetrieve === 'function') {
        console.log('[ChatbotCore] 使用流式多轮取材');

        // 提前创建助手消息占位符
        chatHistory.push({ role: 'assistant', content: '正在检索相关内容...' });
        const earlyAssistantMsgIndex = chatHistory.length - 1;
        if (typeof updateChatbotUI === 'function') updateChatbotUI();

        // 开始新的工具调用会话
        if (window.ChatbotToolTraceUI?.startSession) {
          window.ChatbotToolTraceUI.startSession();
        }

        const stream = window.streamingMultiHopRetrieve(plainTextInput, docContentInfo, config, { maxRounds: userSet.maxRounds || 3 });

        let selection = null;
        for await (const event of stream) {
          // 实时更新UI
          if (window.ChatbotToolTraceUI?.handleStreamEvent) {
            window.ChatbotToolTraceUI.handleStreamEvent(event);

            // 每次事件后实时更新HTML到消息对象
            if (window.ChatbotToolTraceUI?.generateBlockHtml) {
              const toolCallHtml = window.ChatbotToolTraceUI.generateBlockHtml();
              chatHistory[earlyAssistantMsgIndex].toolCallHtml = toolCallHtml;
              chatHistory[earlyAssistantMsgIndex].content = ''; // 清空占位文本

              // 触发UI刷新
              if (typeof updateChatbotUI === 'function') {
                updateChatbotUI();
              }
            }
          }

          // 保存最终结果
          if (event.type === 'complete' || (event.type === 'fallback' && event.context)) {
            selection = event.type === 'complete'
              ? { context: event.context, groups: event.summary.groups, detail: event.summary.detail }
              : event;
          }
        }

        if (selection && selection.context) {
          docContentInfo = Object.assign({}, docContentInfo, {
            selectedGroupContext: selection.context,
            selectedGroupsMeta: selection
          });
          console.log('[ChatbotCore] 流式多轮取材完成，组数', (selection.detail||selection.groups||[]).length);
        }

        // 标记这个消息索引，后续使用
        window._earlyAssistantMsgIndex = earlyAssistantMsgIndex;
      }
    }
  } catch (e) {
    console.warn('[ChatbotCore] 多轮取材选择失败：', e);
  }

  // 使用新的 PromptConstructor 来构建 systemPrompt
  let systemPrompt = '';
  if (window.PromptConstructor && typeof window.PromptConstructor.buildSystemPrompt === 'function') {
    systemPrompt = window.PromptConstructor.buildSystemPrompt(docContentInfo, isMindMapRequest, plainTextInput);
  } else {
    // Fallback or error handling if PromptConstructor is not available
    console.error("PromptConstructor.buildSystemPrompt is not available. Using basic prompt.");
    systemPrompt = `你现在是 PDF 文档智能助手，用户正在查看文档\"${docContentInfo.name || '当前文档'}\"。`;
    if (docContentInfo.translation || docContentInfo.ocr) {
      systemPrompt += `\n\n文档内容：\n${(docContentInfo.translation || docContentInfo.ocr || '').slice(0, 50000)}`;
    }
  }


  // console.log('[sendChatbotMessage] Final systemPrompt to be used:', systemPrompt);
  // console.log('[sendChatbotMessage] Content length passed to systemPrompt (via docContentInfo in PromptConstructor):', (docContentInfo.translation || docContentInfo.ocr || '').length);
  // console.log('[sendChatbotMessage] docContentInfo at the time of systemPrompt build:', JSON.stringify(docContentInfo));
  // console.log('[sendChatbotMessage] window.data at the time of systemPrompt build:', JSON.stringify(window.data)); // 直接检查 window.data

  // conversationHistory should map its content to handle potential arrays correctly for non-OpenAI models if needed by their bodyBuilders
  // However, bodyBuilders are now designed to handle rich 'userInput' and rich 'msg.content' from history.
  let conversationHistory = []; // Initialize as empty
  // Check the global option for using context. Default to true if the option or its parent is not defined.
  if (window.chatbotActiveOptions && typeof window.chatbotActiveOptions.useContext === 'boolean' && window.chatbotActiveOptions.useContext === false) {
    // If useContext is explicitly false, conversationHistory remains empty (no context).
    // console.log('[sendChatbotMessage] Context is OFF. Sending no history.');
  } else {
    // Default behavior or if useContext is true: use chat history.
    conversationHistory = chatHistory.slice(0, -1).map(msg => ({
      role: msg.role,
      content: msg.content // This content can be rich (text or array of parts)
    }));
    // console.log('[sendChatbotMessage] Context is ON. Sending history:', JSON.stringify(conversationHistory));
  }

  const apiKey = config.apiKey;

  if (!apiKey) {
    chatHistory.push({ role: 'assistant', content: '未检测到有效的 API Key，请先在主页面配置。' });
    isChatbotLoading = false;
    if (typeof updateChatbotUI === 'function') updateChatbotUI();
    return;
  }

  // 构建 API 请求参数
  let apiConfig;
  let useStreamApi = true; // 默认使用流式API

  // 修正：支持 custom_source_xxx 也走自定义分支
  if (
    config.model === 'custom' ||
    (typeof config.model === 'string' && config.model.startsWith('custom_source_'))
  ) {
    // 优先读取 index.html 选择的模型ID（settings.selectedCustomModelId）
    let selectedModelId = '';
    try {
      // 1. index.html 选择的模型（settings.selectedCustomModelId）
      if (config.settings && config.settings.selectedCustomModelId) {
        selectedModelId = config.settings.selectedCustomModelId;
      }
      // 2. 浮窗选择的模型（lastSelectedCustomModel）
      if (!selectedModelId) {
        selectedModelId = localStorage.getItem('lastSelectedCustomModel') || '';
      }
    } catch (e) {}
    // 3. 站点配置的默认模型
    if (!selectedModelId && config.cms && config.cms.modelId) {
      selectedModelId = config.cms.modelId;
    }
    // 4. 可用模型列表的第一个
    if (!selectedModelId && Array.isArray(config.siteSpecificAvailableModels) && config.siteSpecificAvailableModels.length > 0) {
      selectedModelId = typeof config.siteSpecificAvailableModels[0] === 'object'
        ? config.siteSpecificAvailableModels[0].id
        : config.siteSpecificAvailableModels[0];
    }
    // 新增：如果还是没有模型ID，弹出模型选择界面并阻止对话
    if (!selectedModelId) {
      if (typeof window.showModelSelectorForChatbot === 'function') {
        window.showModelSelectorForChatbot();
      }
      chatHistory.push({ role: 'assistant', content: '请先选择一个可用模型后再进行对话。' });
      isChatbotLoading = false;
      if (typeof updateChatbotUI === 'function') updateChatbotUI();
      return;
    }
    apiConfig = buildCustomApiConfig(
      apiKey,
      config.cms.apiEndpoint || config.cms.apiBaseUrl,
      selectedModelId,
      config.cms.requestFormat,
      config.cms.temperature,
      config.cms.max_tokens,
      {
        endpointMode: (config.cms && config.cms.endpointMode) || 'auto'
      }
    );
    useStreamApi = apiConfig.streamSupport && apiConfig.streamBodyBuilder;
    console.log('最终模型ID:', selectedModelId);
  } else {
    const predefinedConfigs = {
      'mistral': {
        endpoint: 'https://api.mistral.ai/v1/chat/completions',
        modelName: 'mistral-large-latest',
        headers: { 'Content-Type': 'application/json' },
        bodyBuilder: (sys, msgs, user_content) => ({ // user_content can be string or array
          model: 'mistral-large-latest',
          messages: [
            { role: 'system', content: sys },
            ...msgs.map(m => ({ role: m.role, content: extractTextFromUserContent(m.content) })), // Ensure history content is text
            { role: 'user', content: extractTextFromUserContent(user_content) } // Mistral (standard) expects text
          ],
          stream: true
        }),
        streamHandler: true,
        responseExtractor: (data) => data?.choices?.[0]?.message?.content
      },
      'deepseek': {
        endpoint: 'https://api.deepseek.com/v1/chat/completions',
        modelName: 'deepseek-chat',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        bodyBuilder: (sys, msgs, user_content) => ({
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: sys },
            ...msgs.map(m => ({ role: m.role, content: extractTextFromUserContent(m.content) })),
            { role: 'user', content: extractTextFromUserContent(user_content) } // Deepseek expects text
          ],
          stream: true
        }),
        streamHandler: true,
        responseExtractor: (data) => data?.choices?.[0]?.message?.content
      },
      'volcano': {
        endpoint: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
        modelName: '火山引擎',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        bodyBuilder: (sys, msgs, user_content) => ({
          model: (function(){ try{ const cfg = loadModelConfig && loadModelConfig('volcano'); if (cfg && (cfg.preferredModelId||cfg.modelId)) return cfg.preferredModelId||cfg.modelId; }catch(e){} return 'doubao-1-5-pro-32k-250115'; })(),
          messages: [
            { role: 'system', content: sys },
            ...msgs.map(m => ({ role: m.role, content: extractTextFromUserContent(m.content) })),
            { role: 'user', content: extractTextFromUserContent(user_content) }
          ],
          temperature: 0.5, max_tokens: 8192, stream: true
        }),
        streamHandler: true, responseExtractor: (data) => data?.choices?.[0]?.message?.content
      },
      'tongyi': {
        endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
        modelName: '阿里云通义百炼',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        bodyBuilder: (sys, msgs, user_content) => ({
          model: (function(){ try{ const cfg = loadModelConfig && loadModelConfig('tongyi'); if (cfg && (cfg.preferredModelId||cfg.modelId)) return cfg.preferredModelId||cfg.modelId; }catch(e){} return 'qwen-turbo-latest'; })(),
          messages: [
            { role: 'system', content: sys },
            ...msgs.map(m => ({ role: m.role, content: extractTextFromUserContent(m.content) })),
            { role: 'user', content: extractTextFromUserContent(user_content) }
          ],
          temperature: 0.5, max_tokens: 8192, stream: true
        }),
        streamHandler: true, responseExtractor: (data) => data?.choices?.[0]?.message?.content
      },
      'claude': {
        endpoint: 'https://api.anthropic.com/v1/messages',
        modelName: 'claude-3-sonnet-20240229', // Default, can be overridden
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        bodyBuilder: (sys, msgs, user_content) => { // user_content can be string or OpenAI array
          return {
            model: apiConfig.modelName || 'claude-3-sonnet-20240229', // Use specific model from apiConfig if available
            system: sys,
            messages: msgs.length ?
              [...msgs.map(m => ({role: m.role, content: convertOpenAIToAnthropicContent(m.content)})),
               { role: 'user', content: convertOpenAIToAnthropicContent(user_content) }] :
              [{ role: 'user', content: convertOpenAIToAnthropicContent(user_content) }],
            max_tokens: 2048, // Default, can be overridden
            stream: true
          };
        },
        streamHandler: 'claude',
        responseExtractor: (data) => data?.content?.[0]?.text
      },
      'gemini': {
        endpoint: `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`, // Default, gemini-pro
        streamEndpoint: `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:streamGenerateContent?key=${apiKey}&alt=sse`, // Default, gemini-pro for stream
        modelName: 'gemini-pro', // Default model, can be overridden by selected model
        headers: { 'Content-Type': 'application/json' },
        bodyBuilder: (sys, msgs, user_content) => { // user_content can be string or OpenAI array
          const geminiMessages = [];
          if (msgs.length) {
            for (const msg of msgs) {
              geminiMessages.push({ role: msg.role === 'assistant' ? 'model' : 'user', parts: convertOpenAIToGeminiParts(msg.content) });
            }
          }
          geminiMessages.push({ role: 'user', parts: convertOpenAIToGeminiParts(user_content) });
          return {
            contents: geminiMessages,
            generationConfig: { temperature: 0.5, maxOutputTokens: 2048 }, // Default, can be overridden
            ...(sys && { systemInstruction: { parts: [{ text: sys }] }})
          };
        },
        streamHandler: 'gemini',
        responseExtractor: (data) => {
          if (data?.candidates && data.candidates.length > 0 && data.candidates[0].content) {
            const parts = data.candidates[0].content.parts;
            return parts && parts.length > 0 ? parts.map(p=>p.text).join('') : '';
          }
          return '';
        }
      },
      'gemini-preview': { // Specific for gemini-preview, e.g., gemini-1.5-flash-latest
        endpoint: `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`,
        streamEndpoint: `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:streamGenerateContent?key=${apiKey}&alt=sse`,
        modelName: 'gemini-1.5-flash-latest',
        headers: { 'Content-Type': 'application/json' },
        bodyBuilder: (sys, msgs, user_content) => {
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
              temperature: 0.5, maxOutputTokens: 2048, // Default, can be overridden
              responseModalities: ["TEXT"], responseMimeType: "text/plain"
            },
            ...(sys && { systemInstruction: { parts: [{ text: sys }] }})
          };
        },
        streamHandler: 'gemini',
        responseExtractor: (data) => {
          if (data?.candidates && data.candidates.length > 0 && data.candidates[0].content) {
            const parts = data.candidates[0].content.parts;
            return parts && parts.length > 0 ? parts.map(p=>p.text).join('') : '';
          }
          return '';
        }
      }
    };
    apiConfig = predefinedConfigs[config.model] || predefinedConfigs['mistral']; // Default to mistral if model not found

    // Special handling for API keys for certain predefined models
    if (config.model === 'mistral') {
      apiConfig.headers['Authorization'] = `Bearer ${apiKey}`;
    } else if (config.model === 'claude') {
       apiConfig.headers['x-api-key'] = apiKey;
       // Potentially update modelName in bodyBuilder if a specific Claude model was selected via custom UI
       if (config.cms && config.cms.modelId) {
           apiConfig.modelName = config.cms.modelId; // To be used by bodyBuilder
       }
    } else if (config.model.startsWith('gemini')) {
        // Endpoint already includes API key.
        // Update modelName and endpoints if a specific Gemini model was selected.
        let geminiModelId = 'gemini-pro'; // Default for 'gemini'
        if (config.model === 'gemini-preview') geminiModelId = 'gemini-1.5-flash-latest'; // Default for 'gemini-preview'

        // If a specific model was selected via custom model UI for a "Gemini" type source
        if (config.settings && config.settings.selectedCustomModelId &&
            (config.model === 'gemini' || config.model === 'gemini-preview' || (config.cms && config.cms.requestFormat && config.cms.requestFormat.startsWith('gemini')) )
           ) {
           geminiModelId = config.settings.selectedCustomModelId;
        } else if (config.cms && config.cms.modelId && (config.cms.requestFormat && config.cms.requestFormat.startsWith('gemini'))) {
            geminiModelId = config.cms.modelId;
        } else {
            // 从全局配置中读取翻译设置里选定的默认 Gemini 模型
            try {
              if (typeof loadModelConfig === 'function') {
                const gcfg = loadModelConfig('gemini');
                if (gcfg && (gcfg.preferredModelId || gcfg.modelId)) {
                  geminiModelId = gcfg.preferredModelId || gcfg.modelId;
                }
              }
            } catch (e) { /* ignore */ }
        }


        apiConfig.modelName = geminiModelId; // To be used by bodyBuilder
        // Update endpoint for the specific model if not default
        // Note: Gemini model names in URLs are like 'gemini-1.5-flash-latest' not 'models/gemini-1.5-flash-latest'
        const modelPath = geminiModelId.startsWith('models/') ? geminiModelId.substring(7) : geminiModelId;
        apiConfig.endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelPath}:generateContent?key=${apiKey}`;
        apiConfig.streamEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelPath}:streamGenerateContent?key=${apiKey}&alt=sse`;
    }
  }

  const formattedHistory = conversationHistory; // Already in the right {role, content: rich_content} format

  // 检查是否已经提前创建了助手消息（在工具调用时）
  let assistantMsgIndex = window._earlyAssistantMsgIndex;

  if (assistantMsgIndex !== undefined && assistantMsgIndex >= 0 && chatHistory[assistantMsgIndex]) {
    // 使用已创建的消息
    console.log('[ChatbotCore] 使用已创建的助手消息，索引:', assistantMsgIndex);
    window._earlyAssistantMsgIndex = undefined; // 清除标记
  } else {
    // 正常创建助手消息
    chatHistory.push({ role: 'assistant', content: '' });
    assistantMsgIndex = chatHistory.length - 1;
  }

  try {
    if (typeof updateChatbotUI === 'function') updateChatbotUI();
    if (useStreamApi) {
      const requestBody = apiConfig.streamBodyBuilder
        ? apiConfig.streamBodyBuilder(systemPrompt, formattedHistory, userInput) // userInput is rich
        : apiConfig.bodyBuilder(systemPrompt, formattedHistory, userInput); // userInput is rich
      // console.log('[sendChatbotMessage] STREAM API Request Body:', JSON.stringify(requestBody, null, 2)); // 打印格式化的JSON
      let collectedContent = '';

      // 为 Gemini 使用特定的流式端点（如果有）
      const requestEndpoint = ((config.model === 'gemini' || config.model === 'gemini-preview' ||
                              (apiConfig.streamHandler === 'gemini'))
                             && apiConfig.streamEndpoint) ? apiConfig.streamEndpoint : apiConfig.endpoint;

      const response = await fetch(requestEndpoint, {
        method: 'POST',
        headers: apiConfig.headers,
        body: JSON.stringify(requestBody)
      });
      if (!response.ok) {
        if (response.status === 400 || response.status === 404 || response.status === 501) {
          throw new Error("stream_not_supported");
        } else {
          const errText = await response.text();
          throw new Error(`API 错误 (${response.status}): ${errText}`);
        }
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let parseChunk;
      if (apiConfig.streamHandler === 'claude') {
        parseChunk = (chunk) => {
          try {
            if (!chunk.trim()) return '';
            if (chunk.includes('"type":"content_block_delta"')) {
              const data = JSON.parse(chunk.replace(/^data: /, ''));
              return data.delta?.text || '';
            }
            return '';
          } catch (e) {
            return '';
          }
        };
      } else if (apiConfig.streamHandler === 'gemini') {
        parseChunk = (chunk) => {
          try {
            if (!chunk.trim()) return '';

            // 尝试解析 JSON
            let data;
            try {
              data = JSON.parse(chunk);
            } catch (e) {
              // 如果是行前缀为 "data: "，尝试提取 JSON 部分
              if (chunk.startsWith('data: ')) {
                try {
                  data = JSON.parse(chunk.substring(6));
                } catch (e2) {
                  return '';
                }
              } else {
                return '';
              }
            }

            // 检查是否是 Gemini 格式的响应
            if (data.candidates && data.candidates.length > 0) {
              const candidate = data.candidates[0];

              // 检查常规内容格式
              if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
                return candidate.content.parts[0].text || '';
              }

              // 检查增量更新格式
              if (candidate.delta && candidate.delta.textDelta) {
                return candidate.delta.textDelta || '';
              }

              // 处理特定格式：候选词中的 parts 直接包含文本
              if (candidate.parts && candidate.parts.length > 0) {
                return candidate.parts[0].text || '';
              }
            }

            return '';
          } catch (e) {
            console.log("Gemini 解析错误:", e);
            return '';
          }
        };
      } else {
        // 修改：支持 reasoning_content 流式输出
        parseChunk = (chunk) => {
          try {
            if (!chunk.trim() || !chunk.startsWith('data:')) return { content: '', reasoning: '' };
            const data = JSON.parse(chunk.replace(/^data: /, ''));
            const delta = data.choices?.[0]?.delta || {};
            return {
              content: delta.content || '',
              reasoning: delta.reasoning_content || ''
            };
          } catch (e) {
            if (!chunk.includes('[DONE]') && chunk.trim() && !chunk.trim().startsWith(':')) {
              //console.warn("解析流式回复块错误:", chunk, e);
            }
            return { content: '', reasoning: '' };
          }
        };
      }
      let lastUpdateTime = Date.now();
      const UPDATE_INTERVAL = 100;
      // 新增：reasoning_content 流式收集
      let collectedReasoning = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');
          for (const line of lines) {
            // 修改：parseChunk 返回对象
            const parsed = parseChunk(line);
            if (typeof parsed === 'string') {
              // 兼容旧逻辑
              if (parsed) {
                collectedContent += parsed;
                const now = Date.now();
                if (now - lastUpdateTime > UPDATE_INTERVAL) {
                  chatHistory[assistantMsgIndex].content = collectedContent;
                  if (typeof updateChatbotUI === 'function') updateChatbotUI();
                  lastUpdateTime = now;
                }
              }
            } else if (parsed && (parsed.content || parsed.reasoning)) {
              if (parsed.reasoning) {
                collectedReasoning += parsed.reasoning;
                chatHistory[assistantMsgIndex].reasoningContent = collectedReasoning;
              }
              if (parsed.content) {
                collectedContent += parsed.content;
                chatHistory[assistantMsgIndex].content = collectedContent;
              }
              const now = Date.now();
              if (now - lastUpdateTime > UPDATE_INTERVAL) {
                if (typeof updateChatbotUI === 'function') updateChatbotUI();
                lastUpdateTime = now;
              }
            }
          }
        }
      } catch (streamError) {
        //console.warn("流式读取错误:", streamError);
      }
      // 最终赋值
      chatHistory[assistantMsgIndex].content = collectedContent || '流式回复处理出错，请重试';
      if (collectedReasoning) chatHistory[assistantMsgIndex].reasoningContent = collectedReasoning;
    } else {
      // fallback 到非流式分支
      console.log('[非流式] 调用 bodyBuilder');
      const requestBody = apiConfig.bodyBuilder(systemPrompt, userInput); // userInput is rich
      // console.log('[sendChatbotMessage] NON-STREAM API Request Body:', JSON.stringify(requestBody, null, 2)); // 打印格式化的JSON
      console.log('API Endpoint:', apiConfig.endpoint);
      console.log('Headers:', apiConfig.headers);
      const response = await fetch(apiConfig.endpoint, {
        method: 'POST',
        headers: apiConfig.headers,
        body: JSON.stringify(requestBody)
      });
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`API 错误 (${response.status}): ${errText}`);
      }
      const data = await response.json();
      const answer = apiConfig.responseExtractor(data);
      console.log("[sendChatbotMessage] Raw AI response (non-streamed):", answer); // Added log for raw non-streamed content
      if (!answer) {
        throw new Error("API 响应解析失败，未能提取回复内容");
      }
      chatHistory[assistantMsgIndex].content = answer;
    }
    // 收集完内容后处理思维导图
    if (isMindMapRequest && chatHistory[assistantMsgIndex].content) {
      try {
        const assistantResponseContent = chatHistory[assistantMsgIndex].content;
        console.log("[sendChatbotMessage] Mind Map: assistantResponseContent (before processing):", assistantResponseContent); // Log for Mind Map raw content

        let mindMapMarkdown = assistantResponseContent;
        const codeBlockMatch = assistantResponseContent.match(/```(?:markdown)?\s*([\s\S]+?)```/);
        if (codeBlockMatch && codeBlockMatch[1]) {
          mindMapMarkdown = codeBlockMatch[1].trim();
        }
        console.log("[sendChatbotMessage] Mind Map: mindMapMarkdown after extraction:", mindMapMarkdown); // Log for Mind Map after regex extraction

        const originalContent = assistantResponseContent;
        let displayContent = originalContent;
        if (displayContent.length > 800) {
          const firstHeadingMatch = displayContent.match(/\n#+\s+.+/);
          if (firstHeadingMatch && firstHeadingMatch.index > 0) {
            const beforeHeading = displayContent.substring(0, firstHeadingMatch.index).trim();
            if (beforeHeading.length > 300) {
              displayContent = '以下是文档的思维导图结构:\n\n' + displayContent.substring(firstHeadingMatch.index).trim();
            }
          }
        }
        // 新增：思维导图模糊和放大按钮
        // 存储思维导图数据到localStorage前做兜底，必须有二级标题
        let safeMindMapMarkdown = mindMapMarkdown;
        if (!safeMindMapMarkdown.trim() || !/^#/.test(safeMindMapMarkdown.trim()) || !/\n##?\s+/.test(safeMindMapMarkdown)) {
          safeMindMapMarkdown = '# 思维导图\n\n暂无结构化内容';
          console.log("[sendChatbotMessage] Mind Map: Content defaulted to '暂无结构化内容'. Original mindMapMarkdown was:", mindMapMarkdown); // Log if defaulting
        }
        console.log('存储到localStorage的思维导图内容:', safeMindMapMarkdown);
        window.localStorage.setItem('mindmapData_' + docIdForThisMessage, safeMindMapMarkdown);
        chatHistory[assistantMsgIndex].content =
          `<div style="position:relative;">
            <div id="mindmap-container" style="width:100%;height:400px;margin-top:20px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc;overflow:auto;filter:blur(2.5px);transition:filter 0.3s;"></div>
            <div style="position:absolute;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;z-index:2;">
              <button onclick="window.open((window.location.pathname.endsWith('/history_detail.html') ? '../mindmap/mindmap.html' : 'views/mindmap/mindmap.html') + '?docId=${encodeURIComponent(docIdForThisMessage)}','_blank')" style="padding:12px 28px;font-size:18px;background:rgba(59,130,246,0.92);color:#fff;border:none;border-radius:8px;box-shadow:0 2px 8px rgba(59,130,246,0.12);cursor:pointer;">放大查看/编辑思维导图</button>
            </div>
          </div>`;
        chatHistory[assistantMsgIndex].hasMindMap = true;
        chatHistory[assistantMsgIndex].mindMapData = safeMindMapMarkdown;
      } catch (error) {
        chatHistory[assistantMsgIndex].content +=
          '\n\n<div style="color:#e53e3e;background:#fee;padding:12px;border-radius:6px;margin-top:16px;">思维导图数据处理失败: ' + error.message + '</div>';
      }
    }
  } catch (e) {
    if (e.message === "stream_not_supported" && (
          config.model === 'custom' ||
          (typeof config.model === 'string' && (
             config.model.startsWith('custom_source_') ||
             config.model === 'gemini' || config.model === 'gemini-preview' || config.model.startsWith('gemini')
          )))) {
      try {
        chatHistory[assistantMsgIndex].content = '流式请求失败，尝试以非流式发送...';
        if (typeof updateChatbotUI === 'function') updateChatbotUI();
        // Non-stream bodyBuilder for custom might take (sys_prompt, user_input)
        const requestBody = apiConfig.bodyBuilder(systemPrompt, userInput); // userInput is rich
        const response = await fetch(apiConfig.endpoint, {
          method: 'POST',
          headers: apiConfig.headers,
          body: JSON.stringify(requestBody)
        });
        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`API 错误 (${response.status}): ${errText}`);
        }
        const data = await response.json();
        const answer = apiConfig.responseExtractor(data);
        if (!answer) {
          throw new Error("API 响应解析失败，未能提取回复内容");
        }
        chatHistory[assistantMsgIndex].content = answer;
      } catch (fallbackError) {
        chatHistory[assistantMsgIndex].content = `对话失败: 当前模型配置可能有误。错误细节: ${fallbackError.message}`;
      }
    } else {
      let errorMessage = '对话失败';
      if (e.message.includes('429')) {
        errorMessage += ': 请求频率超限，请稍后再试';
      } else if (e.message.includes('401') || e.message.includes('403')) {
        errorMessage += ': API Key 无效或无权限';
      } else if (e.message.includes('bad_response_status_code')) {
        errorMessage += ': 模型可能不支持流式回复，请在主页面修改为其他模型';
      } else {
        errorMessage += ': ' + e.message;
      }
      // 确保assistantMsgIndex有效
      if (chatHistory[assistantMsgIndex]) {
        chatHistory[assistantMsgIndex].content = errorMessage;
      }
    }
  } finally {
    isChatbotLoading = false;
    if (typeof updateChatbotUI === 'function') updateChatbotUI();
    if (isMindMapRequest && chatHistory[assistantMsgIndex].hasMindMap) {
      setTimeout(() => {
        try {
          const mindmapContainer = document.getElementById('mindmap-container');
          if (mindmapContainer && window.MindMap) {
            const mindMapData = window.MindMap.parse(chatHistory[assistantMsgIndex].mindMapData);
            if (mindMapData) {
              window.MindMap.render('mindmap-container', mindMapData);
            } else {
              mindmapContainer.innerHTML = '<div style="padding:20px;color:#e53e3e;text-align:center;">思维导图生成失败，请重试</div>';
            }
          }
        } catch (err) {
          const container = document.getElementById('mindmap-container');
          if (container) {
            container.innerHTML = '<div style="padding:20px;color:#e53e3e;text-align:center;">思维导图渲染出错: ' + err.message + '</div>';
          }
        }
      }, 800);
    }

    // 确保在 finally 块中保存最新的 chatHistory，包含AI的回复
    // console.log(`[sendChatbotMessage] FINALLY - Attempting to save with docId: "${docIdForThisMessage}" and history:`, JSON.stringify(chatHistory));
    saveChatHistory(docIdForThisMessage, chatHistory); // 确保使用一致的 docId
  }
}

// =============== 新增：分段整理辅助函数 ===============
/**
 * 针对单个文本块进行摘要或处理的辅助函数。
 * 主要用于长文本分块处理的场景，例如对每个文档分块进行初步总结。
 * 此函数不依赖聊天历史，仅进行单轮请求。
 *
 * 主要步骤：
 * 1. API 配置构建：
 *    - 如果 `config.model` 是 'custom'，调用 `buildCustomApiConfig` 生成配置。
 *    - 否则，从简化的 `predefinedConfigs` (仅包含非流式配置) 中获取配置。
 * 2. 构建请求体：调用 `apiConfig.bodyBuilder`，传入系统提示 (`sysPrompt`) 和用户输入 (`userInput`)，
 *    注意历史记录参数为空数组 `[]`。
 * 3. 发送请求：使用 `fetch` 发送 POST 请求。
 * 4. 处理响应：
 *    - 检查响应状态，如果非 OK 则抛出错误。
 *    - 解析 JSON 响应。
 *    - 使用 `apiConfig.responseExtractor` 提取所需内容。
 *    - 如果提取失败，抛出错误。
 * 5. 返回提取到的内容 (通常是文本摘要)。
 *
 * @param {string} sysPrompt 系统提示，指导模型如何处理输入。
 * @param {string} userInput 需要处理的文本块内容。
 * @param {object} config 聊天机器人配置对象 (通常来自 `getChatbotConfig`)。
 * @param {string} apiKey API 密钥。
 * @returns {Promise<string>} 模型处理后的文本结果。
 * @throws {Error} 如果 API 请求失败或响应解析失败。
 */
async function singleChunkSummary(sysPrompt, userInput, config, apiKey) {
  // 只做单轮整理，不带历史
  let apiConfig;
  if (
    config.model === 'custom' ||
    (typeof config.model === 'string' && config.model.startsWith('custom_source_'))
  ) {
    // 与 sendChatbotMessage 对齐：选择模型ID优先顺序
    let selectedModelId = '';
    try {
      if (config.settings && config.settings.selectedCustomModelId) {
        selectedModelId = config.settings.selectedCustomModelId;
      }
      if (!selectedModelId) {
        selectedModelId = localStorage.getItem('lastSelectedCustomModel') || '';
      }
    } catch (e) {}
    if (!selectedModelId && config.cms && config.cms.modelId) {
      selectedModelId = config.cms.modelId;
    }
    if (!selectedModelId && Array.isArray(config.siteSpecificAvailableModels) && config.siteSpecificAvailableModels.length > 0) {
      selectedModelId = typeof config.siteSpecificAvailableModels[0] === 'object' ? config.siteSpecificAvailableModels[0].id : config.siteSpecificAvailableModels[0];
    }

    apiConfig = buildCustomApiConfig(
      apiKey,
      (config.cms.apiEndpoint || config.cms.apiBaseUrl),
      selectedModelId,
      config.cms.requestFormat,
      config.cms.temperature,
      config.cms.max_tokens,
      {
        endpointMode: (config.cms && config.cms.endpointMode) || 'auto'
      }
    );
  } else {
    const predefinedConfigs = {
      'mistral': {
        endpoint: 'https://api.mistral.ai/v1/chat/completions',
        modelName: 'mistral-large-latest',
        headers: { 'Content-Type': 'application/json' }, // API key added in sendChatbotMessage if model is mistral
        bodyBuilder: (sys, msgs, user_content) => ({ // user_content can be string or array
          model: 'mistral-large-latest',
          messages: [
            { role: 'system', content: sys },
            ...msgs.map(m => ({ role: m.role, content: extractTextFromUserContent(m.content) })), // Ensure history content is text
            { role: 'user', content: extractTextFromUserContent(user_content) } // Mistral (standard) expects text
          ],
          stream: true
        }),
        streamHandler: true,
        responseExtractor: (data) => data?.choices?.[0]?.message?.content
      },
      'deepseek': {
        endpoint: 'https://api.deepseek.com/v1/chat/completions',
        modelName: 'deepseek-chat',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        bodyBuilder: (sys, msgs, user_content) => ({
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: sys },
            ...msgs.map(m => ({ role: m.role, content: extractTextFromUserContent(m.content) })),
            { role: 'user', content: extractTextFromUserContent(user_content) } // Deepseek expects text
          ],
          stream: true
        }),
        streamHandler: true,
        responseExtractor: (data) => data?.choices?.[0]?.message?.content
      },
      // Volcano and Tongyi unified entries; user config determines specific model ID
      'volcano': {
        endpoint: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
        modelName: '火山引擎',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        bodyBuilder: (sys, msgs, user_content) => ({
          model: (function(){ try{ const cfg = loadModelConfig && loadModelConfig('volcano'); if (cfg && (cfg.preferredModelId||cfg.modelId)) return cfg.preferredModelId||cfg.modelId; }catch(e){} return 'doubao-1-5-pro-32k-250115'; })(),
          messages: [
            { role: 'system', content: sys },
            ...msgs.map(m => ({ role: m.role, content: extractTextFromUserContent(m.content) })),
            { role: 'user', content: extractTextFromUserContent(user_content) }
          ],
          temperature: 0.5, max_tokens: 8192, stream: true
        }),
        streamHandler: true, responseExtractor: (data) => data?.choices?.[0]?.message?.content
      },
      'tongyi': {
        endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
        modelName: '阿里云通义百炼',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        bodyBuilder: (sys, msgs, user_content) => ({
          model: (function(){ try{ const cfg = loadModelConfig && loadModelConfig('tongyi'); if (cfg && (cfg.preferredModelId||cfg.modelId)) return cfg.preferredModelId||cfg.modelId; }catch(e){} return 'qwen-turbo-latest'; })(),
          messages: [
            { role: 'system', content: sys },
            ...msgs.map(m => ({ role: m.role, content: extractTextFromUserContent(m.content) })),
            { role: 'user', content: extractTextFromUserContent(user_content) }
          ],
          temperature: 0.5, max_tokens: 8192, stream: true
        }),
        streamHandler: true, responseExtractor: (data) => data?.choices?.[0]?.message?.content
      },
      'claude': {
        endpoint: 'https://api.anthropic.com/v1/messages',
        modelName: 'claude-3-sonnet-20240229', // Default, can be overridden
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        bodyBuilder: (sys, msgs, user_content) => { // user_content can be string or OpenAI array
          return {
            model: apiConfig.modelName || 'claude-3-sonnet-20240229', // Use specific model from apiConfig if available
            system: sys,
            messages: msgs.length ?
              [...msgs.map(m => ({role: m.role, content: convertOpenAIToAnthropicContent(m.content)})),
               { role: 'user', content: convertOpenAIToAnthropicContent(user_content) }] :
              [{ role: 'user', content: convertOpenAIToAnthropicContent(user_content) }],
            max_tokens: 2048, // Default, can be overridden
            stream: true
          };
        },
        streamHandler: 'claude',
        responseExtractor: (data) => data?.content?.[0]?.text
      },
      'gemini': {
        endpoint: `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`, // Default, gemini-pro
        streamEndpoint: `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:streamGenerateContent?key=${apiKey}&alt=sse`, // Default, gemini-pro for stream
        modelName: 'gemini-pro', // Default model, can be overridden by selected model
        headers: { 'Content-Type': 'application/json' },
        bodyBuilder: (sys, msgs, user_content) => { // user_content can be string or OpenAI array
          const geminiMessages = [];
          if (msgs.length) {
            for (const msg of msgs) {
              geminiMessages.push({ role: msg.role === 'assistant' ? 'model' : 'user', parts: convertOpenAIToGeminiParts(msg.content) });
            }
          }
          geminiMessages.push({ role: 'user', parts: convertOpenAIToGeminiParts(user_content) });
          return {
            contents: geminiMessages,
            generationConfig: { temperature: 0.5, maxOutputTokens: 2048 }, // Default, can be overridden
            ...(sys && { systemInstruction: { parts: [{ text: sys }] }})
          };
        },
        streamHandler: 'gemini',
        responseExtractor: (data) => {
          if (data?.candidates && data.candidates.length > 0 && data.candidates[0].content) {
            const parts = data.candidates[0].content.parts;
            return parts && parts.length > 0 ? parts.map(p=>p.text).join('') : '';
          }
          return '';
        }
      },
      'gemini-preview': { // Specific for gemini-preview, e.g., gemini-1.5-flash-latest
        endpoint: `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`,
        streamEndpoint: `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:streamGenerateContent?key=${apiKey}&alt=sse`,
        modelName: 'gemini-1.5-flash-latest',
        headers: { 'Content-Type': 'application/json' },
        bodyBuilder: (sys, msgs, user_content) => {
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
              temperature: 0.5, maxOutputTokens: 2048, // Default, can be overridden
              responseModalities: ["TEXT"], responseMimeType: "text/plain"
            },
            ...(sys && { systemInstruction: { parts: [{ text: sys }] }})
          };
        },
        streamHandler: 'gemini',
        responseExtractor: (data) => {
          if (data?.candidates && data.candidates.length > 0 && data.candidates[0].content) {
            const parts = data.candidates[0].content.parts;
            return parts && parts.length > 0 ? parts.map(p=>p.text).join('') : '';
          }
          return '';
        }
      }
    };
    apiConfig = predefinedConfigs[config.model] || predefinedConfigs['mistral']; // Default to mistral if model not found

    // Special handling for API keys for certain predefined models
    if (config.model === 'mistral') {
      apiConfig.headers['Authorization'] = `Bearer ${apiKey}`;
    } else if (config.model === 'claude') {
       apiConfig.headers['x-api-key'] = apiKey;
       // Potentially update modelName in bodyBuilder if a specific Claude model was selected via custom UI
       if (config.cms && config.cms.modelId) {
           apiConfig.modelName = config.cms.modelId; // To be used by bodyBuilder
       }
    } else if (config.model.startsWith('gemini')) {
        // Endpoint already includes API key.
        // Update modelName and endpoints if a specific Gemini model was selected.
        let geminiModelId = 'gemini-pro'; // Default for 'gemini'
        if (config.model === 'gemini-preview') geminiModelId = 'gemini-1.5-flash-latest'; // Default for 'gemini-preview'

        // If a specific model was selected via custom model UI for a "Gemini" type source
        if (config.settings && config.settings.selectedCustomModelId &&
            (config.model === 'gemini' || config.model === 'gemini-preview' || (config.cms && config.cms.requestFormat && config.cms.requestFormat.startsWith('gemini')) )
           ) {
           geminiModelId = config.settings.selectedCustomModelId;
        } else if (config.cms && config.cms.modelId && (config.cms.requestFormat && config.cms.requestFormat.startsWith('gemini'))) {
            geminiModelId = config.cms.modelId;
        } else {
            try {
              if (typeof loadModelConfig === 'function') {
                const gcfg = loadModelConfig('gemini');
                if (gcfg && (gcfg.preferredModelId || gcfg.modelId)) {
                  geminiModelId = gcfg.preferredModelId || gcfg.modelId;
                }
              }
            } catch (e) { /* ignore */ }
        }


        apiConfig.modelName = geminiModelId; // To be used by bodyBuilder
        // Update endpoint for the specific model if not default
        // Note: Gemini model names in URLs are like 'gemini-1.5-flash-latest' not 'models/gemini-1.5-flash-latest'
        const modelPath = geminiModelId.startsWith('models/') ? geminiModelId.substring(7) : geminiModelId;
        apiConfig.endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelPath}:generateContent?key=${apiKey}`;
        apiConfig.streamEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelPath}:streamGenerateContent?key=${apiKey}&alt=sse`;
    }
  }
  // 兼容不同 bodyBuilder 签名：自定义(2参) vs 预置(3参)
  let requestBody;
  try {
    if (typeof apiConfig.bodyBuilder === 'function') {
      if (apiConfig.bodyBuilder.length <= 2) {
        requestBody = apiConfig.bodyBuilder(sysPrompt, userInput);
      } else {
        requestBody = apiConfig.bodyBuilder(sysPrompt, [], userInput);
      }
    } else {
      throw new Error('apiConfig.bodyBuilder 未定义');
    }
  } catch (e) {
    console.error('[singleChunkSummary] 构建请求体失败:', e);
    throw e;
  }
  try { console.log('[singleChunkSummary] POST', apiConfig.endpoint, apiConfig.headers); } catch(_) {}

  let response;
  try {
    response = await fetch(apiConfig.endpoint, {
      method: 'POST',
      headers: apiConfig.headers,
      body: JSON.stringify(requestBody)
    });
  } catch (networkErr) {
    if (isCustomLike && apiConfig.bodyBuilder && apiConfig.bodyBuilder.length > 2) {
      const retryBody = apiConfig.bodyBuilder(sysPrompt, [], userInput);
      response = await fetch(apiConfig.endpoint, {
        method: 'POST',
        headers: apiConfig.headers,
        body: JSON.stringify(retryBody)
      });
    } else {
      throw networkErr;
    }
  }
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`API 错误 (${response.status}): ${errText}`);
  }
  const data = await response.json();
  const answer = apiConfig.responseExtractor(data);
  if (!answer) throw new Error('API 响应解析失败，未能提取内容');
  return answer;
}

// ===== 新增：意群自动生成函数 =====

/**
 * 显示多轮检索功能选择对话框
 * @param {string} docId - 文档ID
 * @returns {Promise<Object>} 用户选择 {useSemanticGroups: boolean, useVectorSearch: boolean}
 */
async function showMultiHopConfigDialog(docId) {
  return new Promise((resolve) => {
    // 创建遮罩层
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 100003;
      display: flex;
      align-items: center;
      justify-content: center;
    `;

    // 创建对话框
    const dialog = document.createElement('div');
    dialog.style.cssText = `
      background: white;
      border-radius: 12px;
      padding: 24px;
      max-width: 480px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
    `;

    dialog.innerHTML = `
      <h3 style="margin: 0 0 16px 0; font-size: 18px; color: #1f2937;">多轮智能检索配置</h3>
      <p style="margin: 0 0 20px 0; font-size: 14px; color: #6b7280; line-height: 1.6;">
        这是您首次在此文档使用多轮智能检索。请选择启用的功能：
      </p>

      <div style="margin-bottom: 16px;">
        <label style="display: flex; align-items: flex-start; cursor: pointer; padding: 12px; border-radius: 8px; transition: background 0.2s;"
               onmouseover="this.style.background='#f3f4f6'"
               onmouseout="this.style.background='transparent'">
          <input type="checkbox" id="use-semantic-groups" checked style="margin-top: 2px; margin-right: 12px; cursor: pointer;">
          <div>
            <div style="font-weight: 500; color: #1f2937; margin-bottom: 4px;">意群分析</div>
            <div style="font-size: 13px; color: #6b7280;">将文档智能分割为语义单元，提高检索准确性</div>
          </div>
        </label>
      </div>

      <div style="margin-bottom: 24px;">
        <label style="display: flex; align-items: flex-start; cursor: pointer; padding: 12px; border-radius: 8px; transition: background 0.2s;"
               onmouseover="this.style.background='#f3f4f6'"
               onmouseout="this.style.background='transparent'">
          <input type="checkbox" id="use-vector-search" checked style="margin-top: 2px; margin-right: 12px; cursor: pointer;">
          <div>
            <div style="font-weight: 500; color: #1f2937; margin-bottom: 4px;">向量搜索</div>
            <div style="font-size: 13px; color: #6b7280;">使用AI理解语义进行智能搜索（需消耗API token）</div>
          </div>
        </label>
      </div>

      <div style="display: flex; gap: 12px; justify-content: flex-end;">
        <button id="dialog-cancel" style="
          padding: 8px 16px;
          border: 1px solid #d1d5db;
          background: white;
          border-radius: 6px;
          cursor: pointer;
          font-size: 14px;
          color: #374151;
          transition: all 0.2s;
        " onmouseover="this.style.background='#f9fafb'"
           onmouseout="this.style.background='white'">取消</button>
        <button id="dialog-confirm" style="
          padding: 8px 16px;
          border: none;
          background: #059669;
          color: white;
          border-radius: 6px;
          cursor: pointer;
          font-size: 14px;
          transition: all 0.2s;
        " onmouseover="this.style.background='#047857'"
           onmouseout="this.style.background='#059669'">确认</button>
      </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // 绑定事件
    const confirmBtn = dialog.querySelector('#dialog-confirm');
    const cancelBtn = dialog.querySelector('#dialog-cancel');
    const semanticGroupsCheckbox = dialog.querySelector('#use-semantic-groups');
    const vectorSearchCheckbox = dialog.querySelector('#use-vector-search');

    const closeDialog = (result) => {
      document.body.removeChild(overlay);
      resolve(result);
    };

    confirmBtn.onclick = () => {
      const config = {
        useSemanticGroups: semanticGroupsCheckbox.checked,
        useVectorSearch: vectorSearchCheckbox.checked
      };
      closeDialog(config);
    };

    cancelBtn.onclick = () => {
      closeDialog(null); // 取消返回null
    };
  });
}

/**
 * 确保意群数据已准备好
 * 根据文档大小和用户设置，决定是否需要生成意群
 * @param {Object} docContentInfo - 文档内容信息
 */
async function ensureSemanticGroupsReady(docContentInfo) {
  // 检查是否启用多轮检索（只有启用多轮检索时才需要意群和向量索引）
  const multiHopEnabled = (window.chatbotActiveOptions && window.chatbotActiveOptions.multiHopRetrieval === true);
  if (!multiHopEnabled) {
    console.log('[ChatbotCore] 多轮检索未启用，跳过意群生成');
    return;
  }

  // 检查 window.data 是否存在
  if (!window.data) {
    return;
  }

  const docId = window.data.currentPdfName || 'unknown';

  // 检查是否已经配置过（针对当前文档）
  if (!window.data.multiHopConfig) {
    window.data.multiHopConfig = {};
  }

  // 如果当前文档未配置过，显示选择对话框
  if (!window.data.multiHopConfig[docId]) {
    console.log('[ChatbotCore] 首次使用多轮检索，显示配置对话框');

    const config = await showMultiHopConfigDialog(docId);

    if (!config) {
      // 用户取消了
      console.log('[ChatbotCore] 用户取消了多轮检索配置');
      window.chatbotActiveOptions.multiHopRetrieval = false; // 关闭多轮检索
      if (window.ChatbotFloatingOptionsUI?.updateDisplay) {
        window.ChatbotFloatingOptionsUI.updateDisplay();
      }
      return;
    }

    // 保存配置
    window.data.multiHopConfig[docId] = config;
    console.log('[ChatbotCore] 保存多轮检索配置:', config);
  }

  // 读取文档配置
  const docConfig = window.data.multiHopConfig[docId];
  console.log('[ChatbotCore] 当前文档多轮检索配置:', docConfig);

  // 如果不使用意群，创建简单的enrichedChunks（不分组）然后返回
  if (!docConfig.useSemanticGroups) {
    console.log('[ChatbotCore] 用户选择不使用意群分析，创建简单chunks用于BM25搜索');

    // 获取原始chunks
    const translationText = docContentInfo.translation || '';
    const ocrText = docContentInfo.ocr || '';
    const chunkCandidates = [];
    if (Array.isArray(docContentInfo.translatedChunks)) {
      chunkCandidates.push(...docContentInfo.translatedChunks);
    }
    if (Array.isArray(docContentInfo.ocrChunks)) {
      chunkCandidates.push(...docContentInfo.ocrChunks);
    }

    // 创建简单的enrichedChunks（不带意群分组信息）
    if (chunkCandidates.length > 0) {
      const simpleEnrichedChunks = chunkCandidates.map((text, idx) => ({
        chunkId: `chunk-${idx}`,
        text: typeof text === 'string' ? text : '',
        position: idx,
        charCount: typeof text === 'string' ? text.length : 0,
        belongsToGroup: null  // 不属于任何意群
      })).filter(c => c.text);

      window.data.enrichedChunks = simpleEnrichedChunks;
      console.log(`[ChatbotCore] 创建了 ${simpleEnrichedChunks.length} 个简单chunks（无意群分组）`);

      // 建立BM25索引（轻量级，不需要API）
      const docId = getCurrentDocId();
      await ensureIndexesBuilt(simpleEnrichedChunks, [], docId, false);
    }

    return;
  }

  // 检查 SemanticGrouper 是否加载
  if (!window.SemanticGrouper || typeof window.SemanticGrouper.aggregate !== 'function') {
    console.warn('[ChatbotCore] SemanticGrouper 未加载，跳过意群生成');
    return;
  }

  // 检查 window.data 是否存在
  if (!window.data) {
    return;
  }

  // 如果已经有意群数据，直接返回
  if (window.data.semanticGroups && window.data.semanticGroups.length > 0) {
    console.log('[ChatbotCore] 意群数据已存在，跳过生成');
    return;
  }

  // 获取文档内容和策略
  const translationText = docContentInfo.translation || '';
  const ocrText = docContentInfo.ocr || '';
  const chunkCandidates = [];
  if (Array.isArray(docContentInfo.translatedChunks)) {
    chunkCandidates.push(...docContentInfo.translatedChunks);
  }
  if (Array.isArray(docContentInfo.ocrChunks)) {
    chunkCandidates.push(...docContentInfo.ocrChunks);
  }

  let contentLength = Math.max(translationText.length, ocrText.length);
  if (contentLength < 50000 && chunkCandidates.length > 0) {
    const chunkLength = chunkCandidates.reduce((sum, chunk) => sum + (typeof chunk === 'string' ? chunk.length : 0), 0);
    contentLength = Math.max(contentLength, chunkLength);
  }

  let content = translationText || ocrText;
  if (!content && chunkCandidates.length > 0) {
    content = chunkCandidates.slice(0, 60).join('\n\n');
  }

  const contentStrategy = (window.chatbotActiveOptions && window.chatbotActiveOptions.contentLengthStrategy) || 'default';
  // 智能检索开启时，自动视为智能分段模式
  const strategySegmented = contentStrategy === 'segmented' || multiHopEnabled;

  // 短文档检查：如果文档长度 < 50000 且未明确开启智能分段，跳过意群生成
  if (contentLength < 50000 && contentStrategy !== 'segmented') {
    console.log(`[ChatbotCore] 文档长度 ${contentLength} < 50000 且未明确开启智能分段，跳过意群生成`);
    return;
  }

  if (!strategySegmented) {
    console.log('[ChatbotCore] 当前策略非智能分段且未开启智能检索，跳过意群生成');
    return;
  }

  // 优先尝试从 IndexedDB 读取缓存
  try {
    const docId = getCurrentDocId();
    if (typeof window.loadSemanticGroupsFromDB === 'function') {
      const cached = await window.loadSemanticGroupsFromDB(docId);
      if (cached && Array.isArray(cached.groups) && cached.groups.length > 0) {
        window.data.semanticGroups = cached.groups;
        if (cached.docGist) window.data.semanticDocGist = cached.docGist;

        // 恢复enrichedChunks，如果缓存中没有则从原始chunks重建
        let enrichedChunks = cached.enrichedChunks || [];

        // 兼容旧数据：如果缓存中没有enrichedChunks，从ocrChunks/translatedChunks重建
        if (!enrichedChunks || enrichedChunks.length === 0) {
          // 根据用户设置的 summarySource 选项决定使用哪个chunks
          const summarySource = (window.chatbotActiveOptions && window.chatbotActiveOptions.summarySource) || 'ocr';
          let rawChunks = [];

          if (summarySource === 'translation') {
            // 优先使用translatedChunks，但如果全是空字符串则降级到ocrChunks
            rawChunks = docContentInfo.translatedChunks || [];
            const hasValidTranslation = rawChunks.some(chunk => chunk && typeof chunk === 'string' && chunk.trim().length > 0);
            if (!hasValidTranslation) {
              rawChunks = docContentInfo.ocrChunks || [];
            }
          } else if (summarySource === 'ocr') {
            // 优先使用ocrChunks，如果没有则使用translatedChunks
            rawChunks = docContentInfo.ocrChunks || docContentInfo.translatedChunks || [];
          } else if (summarySource === 'none') {
            // 明确不使用文档内容
            rawChunks = [];
          }

          if (rawChunks.length > 0) {
            enrichedChunks = rawChunks
              .filter(text => text && typeof text === 'string' && text.trim().length > 0)  // 过滤无效chunk
              .map((text, index) => ({
                chunkId: `chunk-${index}`,
                text: text,
                belongsToGroup: null,
                position: index,
                charCount: text.length
              }));
            console.log(`[ChatbotCore] 从原始chunks(${summarySource})重建了 ${enrichedChunks.length} 个enrichedChunks`);
          }
        } else {
          // 验证enrichedChunks的有效性
          enrichedChunks = enrichedChunks.filter(chunk =>
            chunk && typeof chunk.text === 'string' && chunk.text.trim().length > 0
          );
          if (enrichedChunks.length === 0) {
            console.warn('[ChatbotCore] 缓存的enrichedChunks无效，尝试从原始chunks重建');
            // 根据用户设置的 summarySource 选项决定使用哪个chunks
            const summarySource = (window.chatbotActiveOptions && window.chatbotActiveOptions.summarySource) || 'ocr';
            let rawChunks = [];

            if (summarySource === 'translation') {
              rawChunks = docContentInfo.translatedChunks || [];
              const hasValidTranslation = rawChunks.some(chunk => chunk && typeof chunk === 'string' && chunk.trim().length > 0);
              if (!hasValidTranslation) {
                rawChunks = docContentInfo.ocrChunks || [];
              }
            } else if (summarySource === 'ocr') {
              rawChunks = docContentInfo.ocrChunks || docContentInfo.translatedChunks || [];
            }

            if (rawChunks.length > 0) {
              enrichedChunks = rawChunks
                .filter(text => text && typeof text === 'string' && text.trim().length > 0)
                .map((text, index) => ({
                  chunkId: `chunk-${index}`,
                  text: text,
                  belongsToGroup: null,
                  position: index,
                  charCount: text.length
                }));
              console.log(`[ChatbotCore] 重建了 ${enrichedChunks.length} 个enrichedChunks(${summarySource})`);
            }
          }
        }

        window.data.enrichedChunks = enrichedChunks;

        console.log(`[ChatbotCore] 已从缓存读取意群，共 ${cached.groups.length} 个意群，${enrichedChunks.length} 个chunks`);

        // 检测意群-chunks不匹配：比较缓存中的chunks数量和当前实际chunks数量
        const cachedChunkCount = (cached.enrichedChunks && cached.enrichedChunks.length) || 0;
        const isOutdated = cachedChunkCount > 0 && enrichedChunks.length > 0 &&
                          Math.abs(cachedChunkCount - enrichedChunks.length) > Math.max(cachedChunkCount, enrichedChunks.length) * 0.1;

        if (isOutdated) {
          console.warn(`[ChatbotCore] 检测到意群缓存与chunks不匹配（缓存${cachedChunkCount}个chunk，实际${enrichedChunks.length}个），清除缓存并重新生成`);
          // 删除旧缓存
          if (typeof window.deleteSemanticGroupsFromDB === 'function') {
            await window.deleteSemanticGroupsFromDB(docId);
          }
          delete window.data.semanticGroups;
          delete window.data.enrichedChunks;
          // 不要return，继续走下面的重新生成流程
        } else {
          // 检查并建立索引（向量索引和BM25索引），参数顺序：chunks, groups, docId
          await ensureIndexesBuilt(enrichedChunks, cached.groups, docId);
          return;
        }
      }
    }
  } catch (e) {
    console.warn('[ChatbotCore] 读取意群缓存失败，继续生成:', e);
  }

  // 检查是否有现成的分段数据
  // 根据用户设置的 summarySource 选项决定使用哪个chunks
  const summarySource = (window.chatbotActiveOptions && window.chatbotActiveOptions.summarySource) || 'ocr';
  let chunks = [];

  if (summarySource === 'translation') {
    chunks = docContentInfo.translatedChunks || [];
    const hasValidTranslation = chunks.some(chunk => chunk && typeof chunk === 'string' && chunk.trim().length > 0);
    if (!hasValidTranslation) {
      chunks = docContentInfo.ocrChunks || [];
    }
  } else if (summarySource === 'ocr') {
    chunks = docContentInfo.ocrChunks || docContentInfo.translatedChunks || [];
  } else if (summarySource === 'none') {
    chunks = [];
  }

  if (!chunks || !Array.isArray(chunks) || chunks.length === 0) {
    console.warn('[ChatbotCore] 没有可用的分段数据（ocrChunks/translatedChunks），无法生成意群');
    return;
  }

  if (contentLength < 50000) {
    console.log(`[ChatbotCore] 文档估算字数 ${contentLength} < 50000，但已启用智能分段，继续生成意群`);
  }

  console.log(`[ChatbotCore] 开始生成意群，估算字数: ${contentLength}，分段数: ${chunks.length}`);

  try {
    // 显示加载提示
    if (window.ChatbotUtils && typeof window.ChatbotUtils.showToast === 'function') {
      window.ChatbotUtils.showToast('正在生成文档意群，请稍候...', 'info', 3000);
    }

    // 先生成文档总览（前2万字），作为后续分组摘要的背景信息
    try {
      const preview = content.slice(0, 20000);
      const cfg = getChatbotConfig();
      if (!window.data.semanticDocGist && cfg && cfg.apiKey && typeof singleChunkSummary === 'function') {
        const gistPrompt = `你是学术文档分析助手。请基于提供的文档开头部分，生成一段不超过400字的中文总览，涵盖：主题/研究问题、对象/范围、方法/框架、主要结论或结构。尽量客观、概括，不引用无关细节。`;
        const gist = await singleChunkSummary(gistPrompt, preview, cfg, cfg.apiKey);
        window.data.semanticDocGist = (gist || '').trim();
        console.log('[ChatbotCore] 文档总览（前2万字）已生成');
      }
    } catch (e) {
      console.warn('[ChatbotCore] 文档总览生成失败，将跳过：', e);
      if (!window.data.semanticDocGist) {
        window.data.semanticDocGist = content.slice(0, 400);
      }
    }

    // 生成意群（可由用户设置覆盖默认值）
    const s = (window.semanticGroupsSettings || {});

    // 创建进度显示UI元素
    let progressToast = null;
    if (window.ChatbotUtils && typeof window.ChatbotUtils.showProgressToast === 'function') {
      progressToast = window.ChatbotUtils.showProgressToast('生成意群中...', 0);
    }

    const result = await window.SemanticGrouper.aggregate(chunks, {
      targetChars: Number(s.targetChars) > 0 ? Number(s.targetChars) : 5000,
      minChars: Number(s.minChars) > 0 ? Number(s.minChars) : 2500,
      maxChars: Number(s.maxChars) > 0 ? Number(s.maxChars) : 6000,
      concurrency: Number(s.concurrency) > 0 ? Number(s.concurrency) : 20,  // 恢复默认并发数
      docContext: window.data.semanticDocGist || '',
      onProgress: (current, total, message) => {
        const percent = Math.round((current / total) * 100);
        if (progressToast && typeof progressToast.update === 'function') {
          progressToast.update(`${message} (${percent}%)`, percent);
        }
        console.log(`[ChatbotCore] 意群生成进度: ${current}/${total} (${percent}%)`);
      }
    });

    // 关闭进度提示
    if (progressToast && typeof progressToast.close === 'function') {
      progressToast.close();
    }

    const semanticGroups = result.groups || [];
    const enrichedChunks = result.enrichedChunks || [];

    // 保存到 window.data
    window.data.semanticGroups = semanticGroups;
    window.data.enrichedChunks = enrichedChunks; // 保存带元数据的chunks

    console.log(`[ChatbotCore] 意群生成完成，共 ${semanticGroups.length} 个意群，${enrichedChunks.length} 个chunks`);

    // 获取docId（后续索引构建也需要）
    const docId = getCurrentDocId();

    // 持久化到 IndexedDB
    try {
      if (typeof window.saveSemanticGroupsToDB === 'function') {
        await window.saveSemanticGroupsToDB(docId, semanticGroups, {
          version: 3, // 版本号升级
          docGist: window.data.semanticDocGist || '',
          enrichedChunks: enrichedChunks
        });
        console.log('[ChatbotCore] 意群和chunks已写入缓存');
      }
    } catch (e) {
      console.warn('[ChatbotCore] 写入缓存失败:', e);
    }

    // 更新浮动选项栏的显示（出现"意群"按钮）
    try {
      if (window.ChatbotFloatingOptionsUI && typeof window.ChatbotFloatingOptionsUI.updateDisplay === 'function') {
        window.ChatbotFloatingOptionsUI.updateDisplay();
      }
      if (window.SemanticGroupsUI && typeof window.SemanticGroupsUI.update === 'function') {
        window.SemanticGroupsUI.update();
      }
    } catch (_) {}

    // 显示成功提示
    if (window.ChatbotUtils && typeof window.ChatbotUtils.showToast === 'function') {
      window.ChatbotUtils.showToast(`文档已分析完成，生成 ${semanticGroups.length} 个意群`, 'success', 2000);
    }

    // 建立索引（现在索引chunks而不是意群）
    // 如果启用了多轮检索，需要同步等待向量索引建立完成（否则第一轮检索时索引为空）
    // 其他情况下，embedding可以在后台异步生成，不阻塞用户操作
    const shouldWaitForIndex = multiHopEnabled;

    if (shouldWaitForIndex) {
      console.log('[ChatbotCore] 多轮检索已启用，同步等待向量索引建立完成');
    }

    await ensureIndexesBuilt(enrichedChunks, semanticGroups, docId, !shouldWaitForIndex);
  } catch (error) {
    console.error('[ChatbotCore] 生成意群失败:', error);

    // 显示错误提示
    if (window.ChatbotUtils && typeof window.ChatbotUtils.showToast === 'function') {
      window.ChatbotUtils.showToast('意群生成失败，将使用全文模式', 'error', 3000);
    }
  }
}

// 将选中的意群上下文附加到 docContentInfo
function attachSelectedContextToDoc(docContentInfo, selection) {
  if (!selection) return docContentInfo;
  const ids = Array.isArray(selection.groups) ? selection.groups : [];
  const granularity = selection.granularity || 'digest';
  const byId = new Map((docContentInfo.semanticGroups || []).map(g => [g.groupId, g]));
  const parts = [];
  ids.forEach((id, idx) => {
    const g = byId.get(id);
    if (!g) return;
    const gran = (selection.detail && selection.detail.find(d => d.groupId===id)?.granularity) || granularity;
    const body = gran === 'full' ? (g.fullText || '').slice(0, 6000)
               : gran === 'digest' ? (g.digest || '').slice(0, 3000)
               : (g.summary || '').slice(0, 800);
    parts.push(`【意群${idx+1} - ${id}】\n关键词: ${(g.keywords||[]).join('、')}\n内容(${gran}):\n${body}`);
  });
  const ctx = parts.join('\n\n');
  return Object.assign({}, docContentInfo, { selectedGroupContext: ctx, selectedGroupsMeta: selection });
}

// 多轮工具式取材
function buildFallbackSemanticContext(userQuestion, groups) {
  try {
    if (!Array.isArray(groups) || groups.length === 0) return null;
    let picks = [];
    try {
      if (window.SemanticGrouper && typeof window.SemanticGrouper.quickMatch === 'function') {
        picks = window.SemanticGrouper.quickMatch(String(userQuestion || ''), groups) || [];
      }
    } catch (_) {}
    if (!picks || picks.length === 0) {
      picks = groups.slice(0, Math.min(3, groups.length));
    }
    const unique = new Set();
    const detail = [];
    const parts = [];
    picks.forEach(g => {
      if (!g || unique.size >= 3 || unique.has(g.groupId)) return;
      unique.add(g.groupId);
      let fetched = null;
      try {
        if (window.SemanticTools && typeof window.SemanticTools.fetchGroupText === 'function') {
          fetched = window.SemanticTools.fetchGroupText(g.groupId, 'digest');
        }
      } catch (_) {}
      const text = (fetched && fetched.text) || g.digest || g.summary || g.fullText || '';
      if (!text) return;
      const gran = (fetched && fetched.granularity) || 'digest';
      parts.push(`【${g.groupId}】\n关键词: ${(g.keywords || []).join('、')}\n内容(${gran}):\n${text}`);
      detail.push({ groupId: g.groupId, granularity: gran });
    });
    if (parts.length === 0) return null;
    return { groups: Array.from(unique), granularity: 'mixed', detail, context: parts.join('\n\n') };
  } catch (e) {
    console.warn('[buildFallbackSemanticContext] 失败:', e);
    return null;
  }
}

// 导出核心对象
window.ChatbotCore = {
  chatHistory,
  isChatbotLoading,
  getChatbotConfig,
  getCurrentDocContent,
  buildChatMessages,
  sendChatbotMessage,
  saveChatHistory,
  loadChatHistory,
  clearChatHistory,
  clearCurrentDocChatHistory, // <-- 导出
  deleteMessageFromHistory, // <-- 导出新函数
  getCurrentDocId,
  reloadChatHistoryAndUpdateUI,
  // 导出给意群聚合模块使用的单轮摘要工具
  singleChunkSummary,
  // 重新生成意群（清空缓存并根据设置重新生成）
  regenerateSemanticGroups: async function(newSettings) {
    try {
      if (newSettings && typeof newSettings === 'object') {
        window.semanticGroupsSettings = Object.assign({}, window.semanticGroupsSettings || {}, newSettings);
      }
      const docId = getCurrentDocId();
      if (typeof window.deleteSemanticGroupsFromDB === 'function') {
        await window.deleteSemanticGroupsFromDB(docId);
      }
      if (window.data) {
        delete window.data.semanticGroups;
      }
      const docContentInfo = getCurrentDocContent();
      await ensureSemanticGroupsReady(docContentInfo);
      if (window.ChatbotFloatingOptionsUI && typeof window.ChatbotFloatingOptionsUI.updateDisplay === 'function') {
        window.ChatbotFloatingOptionsUI.updateDisplay();
      }
      if (window.SemanticGroupsUI && typeof window.SemanticGroupsUI.update === 'function') {
        window.SemanticGroupsUI.update();
      }
    } catch (e) {
      console.error('[ChatbotCore] regenerateSemanticGroups 失败:', e);
    }
  }
};
