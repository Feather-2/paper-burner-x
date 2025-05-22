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
 * @param {string} customRequestFormat 自定义请求格式 (e.g., 'openai', 'anthropic', 'gemini')。
 * @param {number} [temperature] 模型温度参数，控制生成文本的随机性。
 * @param {number} [max_tokens] 模型最大输出 token 数。
 * @returns {object} 构建好的 API 配置对象，包含 endpoint, modelName, headers, bodyBuilder, responseExtractor, streamSupport, streamBodyBuilder 等。
 * @throws {Error} 如果 customRequestFormat 不被支持。
 */
function buildCustomApiConfig(key, customApiEndpoint, customModelId, customRequestFormat, temperature, max_tokens) {
  let apiEndpoint = customApiEndpoint;
  let modelId = customModelId;

  // 检查是否有模型检测模块，如果有则使用其提供的完整端点
  if (typeof window.modelDetector !== 'undefined') {
    const fullEndpoint = window.modelDetector.getFullApiEndpoint();
    if (fullEndpoint) {
      apiEndpoint = fullEndpoint;
    }
  } else {
    if (apiEndpoint && !apiEndpoint.includes('/v1/') && !apiEndpoint.endsWith('/v1')) {
      const cleanBaseUrl = apiEndpoint.endsWith('/') ? apiEndpoint.slice(0, -1) : apiEndpoint;
      apiEndpoint = `${cleanBaseUrl}/v1/chat/completions`;
    }
  }

  // 新增：如果 customRequestFormat 为空且 endpoint 以 /v1/chat/completions 结尾，则自动设为 openai
  if ((!customRequestFormat || customRequestFormat === '') && apiEndpoint && apiEndpoint.endsWith('/v1/chat/completions')) {
    customRequestFormat = 'openai';
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
  switch (customRequestFormat) {
    case 'openai':
      config.headers['Authorization'] = `Bearer ${key}`;
      config.bodyBuilder = (sys_prompt, user_prompt) => ({
        model: modelId,
        messages: [{ role: "system", content: sys_prompt }, { role: "user", content: user_prompt }],
        temperature: temperature ?? 0.5,
        max_tokens: max_tokens ?? 8000
      });
      config.streamBodyBuilder = (sys, msgs, user) => ({
        model: modelId,
        messages: [
          { role: 'system', content: sys },
          ...msgs,
          { role: 'user', content: user }
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
      config.bodyBuilder = (sys_prompt, user_prompt) => ({
        model: modelId,
        system: sys_prompt,
        messages: [{ role: "user", content: user_prompt }],
        temperature: temperature ?? 0.5,
        max_tokens: max_tokens ?? 8000
      });
      config.streamBodyBuilder = (sys, msgs, user) => {
        return {
          model: modelId,
          system: sys,
          messages: msgs.length ?
            [...msgs, { role: 'user', content: user }] :
            [{ role: 'user', content: user }],
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
      let baseUrl = config.endpoint.split('?')[0];
      // 为非流式请求添加 key 参数
      config.endpoint = `${baseUrl}?key=${key}`;
      // 为流式请求使用不同的端点，添加 alt=sse 参数
      config.streamEndpoint = `${baseUrl}?key=${key}&alt=sse`;
      // 默认使用 gemini-2.0-flash，除非特别指定
      const geminiModelId = modelId || 'gemini-2.0-flash';
      config.bodyBuilder = (sys_prompt, user_prompt) => ({
        contents: [{ role: "user", parts: [{ text: user_prompt }] }],
        generationConfig: { temperature: temperature ?? 0.5, maxOutputTokens: max_tokens ?? 8192 }
      });
      config.streamBodyBuilder = (sys, msgs, user) => {
        const geminiMessages = [];
        if (msgs.length) {
          for (const msg of msgs) {
            geminiMessages.push({ role: msg.role === 'assistant' ? 'model' : 'user', parts: [{ text: msg.content }] });
          }
        }
        geminiMessages.push({ role: 'user', parts: [{ text: user }] });
        return {
          contents: geminiMessages,
          generationConfig: {
            temperature: temperature ?? 0.5,
            maxOutputTokens: max_tokens ?? 8192
          },
          systemInstruction: { parts: [{ text: sys }] }
          // 移除 stream 参数，改用 URL 参数 alt=sse
        };
      };
      config.responseExtractor = (data) => {
        if (data?.candidates && data.candidates.length > 0 && data.candidates[0].content) {
          const parts = data.candidates[0].content.parts;
          return parts && parts.length > 0 ? parts[0].text : '';
        }
        return '';
      };
      config.streamSupport = true;
      config.streamHandler = 'gemini';
      break;
    case 'gemini-preview':
      let baseUrlPreview = config.endpoint.split('?')[0];
      // 为非流式请求添加 key 参数
      config.endpoint = `${baseUrlPreview}?key=${key}`;
      // 为流式请求使用不同的端点，添加 alt=sse 参数
      config.streamEndpoint = `${baseUrlPreview}?key=${key}&alt=sse`;
      // 默认使用 gemini-2.5-flash-preview-04-17，除非特别指定
      const previewModelId = modelId || 'gemini-2.5-flash-preview-04-17';
      config.bodyBuilder = (sys_prompt, user_prompt) => ({
        contents: [{ role: "user", parts: [{ text: user_prompt }] }],
        generationConfig: {
          temperature: temperature ?? 0.5,
          maxOutputTokens: max_tokens ?? 8192,
          responseModalities: ["TEXT"],
          responseMimeType: "text/plain"
        }
      });
      config.streamBodyBuilder = (sys, msgs, user) => {
        const geminiMessages = [];
        if (msgs.length) {
          for (const msg of msgs) {
            geminiMessages.push({ role: msg.role === 'assistant' ? 'model' : 'user', parts: [{ text: msg.content }] });
          }
        }
        geminiMessages.push({ role: 'user', parts: [{ text: user }] });
        return {
          contents: geminiMessages,
          generationConfig: {
            temperature: temperature ?? 0.5,
            maxOutputTokens: max_tokens ?? 8192,
            responseModalities: ["TEXT"],
            responseMimeType: "text/plain"
          },
          systemInstruction: { parts: [{ text: sys }] }
        };
      };
      config.responseExtractor = (data) => {
        if (data?.candidates && data.candidates.length > 0 && data.candidates[0].content) {
          const parts = data.candidates[0].content.parts;
          return parts && parts.length > 0 ? parts[0].text : '';
        }
        return '';
      };
      config.streamSupport = true;
      config.streamHandler = 'gemini';
      break;
    case 'volcano-deepseek-v3':
      config.headers['Authorization'] = `Bearer ${key}`;
      config.bodyBuilder = (sys_prompt, user_prompt) => ({
        model: 'deepseek-v3-250324',
        messages: [
          { role: 'system', content: sys_prompt },
          { role: 'user', content: user_prompt }
        ],
        temperature: 0.5,
        max_tokens: 8192,
        stream: true
      });
      config.streamBodyBuilder = (sys, msgs, user) => ({
        model: 'deepseek-v3-250324',
        messages: [
          { role: 'system', content: sys },
          ...msgs,
          { role: 'user', content: user }
        ],
        temperature: temperature ?? 0.5,
        max_tokens: max_tokens ?? 8192,
        stream: true
      });
      config.responseExtractor = (data) => data?.choices?.[0]?.message?.content;
      config.streamSupport = true;
      config.streamHandler = true;
      break;
    case 'volcano-doubao':
      config.headers['Authorization'] = `Bearer ${key}`;
      config.bodyBuilder = (sys_prompt, user_prompt) => ({
        model: 'doubao-1-5-pro-32k-250115',
        messages: [
          { role: 'system', content: sys_prompt },
          { role: 'user', content: user_prompt }
        ],
        temperature: 0.5,
        max_tokens: 8192,
        stream: true
      });
      config.streamBodyBuilder = (sys, msgs, user) => ({
        model: 'doubao-1-5-pro-32k-250115',
        messages: [
          { role: 'system', content: sys },
          ...msgs,
          { role: 'user', content: user }
        ],
        temperature: temperature ?? 0.5,
        max_tokens: max_tokens ?? 8192,
        stream: true
      });
      config.responseExtractor = (data) => data?.choices?.[0]?.message?.content;
      config.streamSupport = true;
      config.streamHandler = true;
      break;
    case 'tongyi-deepseek-v3':
      config.headers['Authorization'] = `Bearer ${key}`;
      config.bodyBuilder = (sys_prompt, user_prompt) => ({
        model: 'deepseek-v3',
        messages: [
          { role: 'system', content: sys_prompt },
          { role: 'user', content: user_prompt }
        ],
        temperature: 0.5,
        max_tokens: 8192,
        stream: true
      });
      config.streamBodyBuilder = (sys, msgs, user) => ({
        model: 'deepseek-v3',
        messages: [
          { role: 'system', content: sys },
          ...msgs,
          { role: 'user', content: user }
        ],
        temperature: temperature ?? 0.5,
        max_tokens: max_tokens ?? 8192,
        stream: true
      });
      config.responseExtractor = (data) => data?.choices?.[0]?.message?.content;
      config.streamSupport = true;
      config.streamHandler = true;
      break;
    case 'tongyi-qwen-turbo':
      config.headers['Authorization'] = `Bearer ${key}`;
      config.bodyBuilder = (sys_prompt, user_prompt) => ({
        model: 'qwen-turbo-latest',
        messages: [
          { role: 'system', content: sys_prompt },
          { role: 'user', content: user_prompt }
        ],
        temperature: 0.5,
        max_tokens: 8192,
        stream: true
      });
      config.streamBodyBuilder = (sys, msgs, user) => ({
        model: 'qwen-turbo-latest',
        messages: [
          { role: 'system', content: sys },
          ...msgs,
          { role: 'user', content: user }
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
      throw new Error(`不支持的自定义请求格式: ${customRequestFormat}`);
  }
  console.log('buildCustomApiConfig:', {
    customRequestFormat,
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
 * @returns {object} 包含 `ocr`, `translation`, `images`, `name` 的文档内容对象。
 *                   如果 `window.data` 不存在或内容为空，则返回相应的空值。
 */
function getCurrentDocContent() {
  if (window.data) {
    return {
      ocr: window.data.ocr || '',
      translation: window.data.translation || '',
      images: window.data.images || [],
      name: window.data.name || ''
    };
  }
  return { ocr: '', translation: '', images: [], name: '' };
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
 *    - 优先在块的后半部分（`maxChunk * 0.3` 之后）寻找 Markdown 标题 (`
#`, `
##`, `
###`) 作为分割点，
 *      以保持段落完整性。如果找到，则在该标题前分割。
 *    - 如果未找到合适的 Markdown 标题，则按 `maxChunk` 长度硬分割。
 * 4. 返回分割后的文本块数组。
 *
 * @param {string} content 需要分割的文本内容。
 * @param {number} [maxChunk=20000] 每个分块的最大字符数。
 * @returns {Array<string>} 分割后的文本块数组。
 */
function splitContentSmart(content, maxChunk = 20000) {
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

// 发送消息到大模型（支持思维导图请求）
/**
 * 发送消息到大语言模型并处理响应，支持思维导图生成请求。
 *
 * 核心流程：
 * 1. 状态检查与准备：
 *    - 如果 `isChatbotLoading` 为 true，则不执行，防止重复请求。
 *    - 将用户输入 (`userInput`) 添加到 `chatHistory`。
 *    - 调用 `updateChatbotUI` 更新界面。
 * 2. 配置加载与内容获取：
 *    - 判断是否为思维导图请求 (`isMindMapRequest`)。
 *    - 获取聊天机器人配置 (`getChatbotConfig`)，优先使用 `externalConfig`。
 *    - 获取当前文档内容 (`getCurrentDocContent`) 和文档 ID (`getCurrentDocId`)。
 *    - 提取文档内容（优先翻译，其次 OCR），并限制长度。
 * 3. 构建 System Prompt：
 *    - 基础提示告知模型其角色为 PDF 文档助手，并强调回答需基于文档、简洁、学术准确。
 *    - 如果是思维导图请求，追加特定格式要求。
 *    - 如果存在文档内容，将其附加到 System Prompt。
 * 4. API Key 检查：
 *    - 如果没有有效的 API Key，则添加错误消息到 `chatHistory` 并返回。
 * 5. 构建 API 请求配置 (`apiConfig`)：
 *    - 如果模型为 'custom' 或以 'custom_source_' 开头，则调用 `buildCustomApiConfig`。
 *      - 优先顺序获取模型 ID：`settings.selectedCustomModelId` -> `localStorage.lastSelectedCustomModel` -> `cms.modelId` -> `siteSpecificAvailableModels[0]`。
 *      - 如果最终无模型 ID，则提示用户选择并返回。
 *    - 否则，从预定义的 `predefinedConfigs` 中获取配置。
 *    - 判断是否使用流式 API (`useStreamApi`)。
 * 6. 发送请求与处理响应（流式优先）：
 *    - 添加一个空的助手消息到 `chatHistory`，用于后续填充流式内容。
 *    - 如果 `useStreamApi` 为 true：
 *      - 构建流式请求体 (`apiConfig.streamBodyBuilder` 或 `apiConfig.bodyBuilder`)。
 *      - 确定请求端点 (Gemini 等模型可能使用特定流式端点)。
 *      - 发起 `fetch` 请求。
 *      - 处理响应流：使用 `TextDecoder` 解码，根据 `apiConfig.streamHandler` (如 'claude', 'gemini') 解析每个数据块，
 *        逐步更新 `chatHistory` 中的助手消息内容，并定时刷新 UI。
 *    - 如果 `useStreamApi` 为 false (或流式请求失败回退)：
 *      - 构建非流式请求体 (`apiConfig.bodyBuilder`)。
 *      - 发起 `fetch` 请求，获取完整 JSON 响应。
 *      - 使用 `apiConfig.responseExtractor` 提取答案。
 * 7. 思维导图后处理：
 *    - 如果是思维导图请求且成功获取到内容：
 *      - 尝试从模型回复中提取 Markdown 格式的思维导图数据 (优先代码块内容)。
 *      - 对 Markdown 数据进行安全检查 (确保有根节点和二级节点)。
 *      - 将安全的 Markdown 数据存储到 `localStorage` (键名包含 `docId`)。
 *      - 更新 `chatHistory` 中的助手消息，替换为包含思维导图预览和放大按钮的 HTML 结构。
 *      - 设置 `hasMindMap` 和 `mindMapData` 属性。
 * 8. 错误处理：
 *    - 捕获 API 请求错误、流处理错误、内容解析错误等。
 *    - 对于特定错误 (如流不支持、429/401/403 状态码)，提供更具体的错误信息。
 *    - 如果流式请求失败且是自定义模型，尝试以非流式方式重试一次。
 * 9. 清理与 UI 更新：
 *    - 设置 `isChatbotLoading` 为 false。
 *    - 调用 `updateChatbotUI` 刷新界面。
 *    - 如果是思维导图请求且成功，延迟渲染思维导图预览 (使用 `window.MindMap.render`)。
 *
 * @param {string} userInput 用户输入的查询或指令。
 * @param {function} updateChatbotUI 更新聊天界面显示的回调函数。
 * @param {object} [externalConfig=null] 可选的外部配置对象，用于覆盖默认配置加载逻辑。
 * @returns {Promise<void>} 无明确返回值，主要通过回调更新 UI 和内部状态。
 */
async function sendChatbotMessage(userInput, updateChatbotUI, externalConfig = null) {
  if (isChatbotLoading) return;
  isChatbotLoading = true;
  chatHistory.push({ role: 'user', content: userInput });
  if (typeof updateChatbotUI === 'function') updateChatbotUI();

  const isMindMapRequest = userInput.includes('思维导图') || userInput.includes('脑图');
  // 优先用外部传入的 config
  const config = getChatbotConfig(externalConfig);
  const doc = getCurrentDocContent();
  const docId = getCurrentDocId();

  // 获取文档内容（优先翻译，没有就用OCR）
  let content = doc.translation || doc.ocr || '';
  if (content.length > 50000) {
    content = content.slice(0, 50000);
  }

  // 组装 systemPrompt
  let systemPrompt = `你现在是 PDF 文档智能助手，用户正在查看文档\"${doc.name}\"。\n你的回答应该：\n1. 基于PDF文档内容\n2. 简洁清晰\n3. 学术准确`;
  if (isMindMapRequest) {
    systemPrompt += `\n\n请注意：用户请求生成思维导图。请按照以下Markdown格式返回思维导图结构：\n# 文档主题（根节点）\n## 一级主题1\n### 二级主题1.1\n### 二级主题1.2\n## 一级主题2\n### 二级主题2.1\n#### 三级主题2.1.1\n\n只需提供思维导图的结构，不要添加额外的解释。结构应该清晰反映文档的层次关系和主要内容。`;
  }
  if (content) {
    systemPrompt += `\n\n文档内容：\n${content}`;
  }

  const conversationHistory = chatHistory.slice(0, -1);
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
      config.cms.max_tokens
    );
    useStreamApi = apiConfig.streamSupport && apiConfig.streamBodyBuilder;
    console.log('最终模型ID:', selectedModelId);
  } else {
    const predefinedConfigs = {
      'mistral': {
        endpoint: 'https://api.mistral.ai/v1/chat/completions',
        modelName: 'mistral-large-latest',
        headers: { 'Content-Type': 'application/json' },
        bodyBuilder: (sys, msgs, user) => ({
          model: 'mistral-large-latest',
          messages: [
            { role: 'system', content: sys },
            ...msgs,
            { role: 'user', content: user }
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
        bodyBuilder: (sys, msgs, user) => ({
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: sys },
            ...msgs,
            { role: 'user', content: user }
          ],
          stream: true
        }),
        streamHandler: true,
        responseExtractor: (data) => data?.choices?.[0]?.message?.content
      },
      'volcano-deepseek-v3': {
        endpoint: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
        modelName: '火山引擎 DeepSeek v3',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        bodyBuilder: (sys, msgs, user) => ({
          model: 'deepseek-v3-250324',
          messages: [
            { role: 'system', content: sys },
            ...msgs,
            { role: 'user', content: user }
          ],
          temperature: 0.5,
          max_tokens: 8192,
          stream: true
        }),
        streamHandler: true,
        responseExtractor: (data) => data?.choices?.[0]?.message?.content
      },
      'volcano-doubao': {
        endpoint: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
        modelName: '火山引擎 豆包',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        bodyBuilder: (sys, msgs, user) => ({
          model: 'doubao-1-5-pro-32k-250115',
          messages: [
            { role: 'system', content: sys },
            ...msgs,
            { role: 'user', content: user }
          ],
          temperature: 0.5,
          max_tokens: 8192,
          stream: true
        }),
        streamHandler: true,
        responseExtractor: (data) => data?.choices?.[0]?.message?.content
      },
      'tongyi-deepseek-v3': {
        endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
        modelName: '阿里云通义百炼 DeepSeek v3',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        bodyBuilder: (sys, msgs, user) => ({
          model: 'deepseek-v3',
          messages: [
            { role: 'system', content: sys },
            ...msgs,
            { role: 'user', content: user }
          ],
          temperature: 0.5,
          max_tokens: 8192,
          stream: true
        }),
        streamHandler: true,
        responseExtractor: (data) => data?.choices?.[0]?.message?.content
      },
      'tongyi-qwen-turbo': {
        endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
        modelName: '阿里云通义百炼 Qwen Turbo',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        bodyBuilder: (sys, msgs, user) => ({
          model: 'qwen-turbo-latest',
          messages: [
            { role: 'system', content: sys },
            ...msgs,
            { role: 'user', content: user }
          ],
          temperature: 0.5,
          max_tokens: 8192,
          stream: true
        }),
        streamHandler: true,
        responseExtractor: (data) => data?.choices?.[0]?.message?.content
      },
      'claude': {
        endpoint: 'https://api.anthropic.com/v1/messages',
        modelName: 'claude-3-sonnet-20240229',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        bodyBuilder: (sys, msgs, user) => {
          return {
            model: 'claude-3-sonnet-20240229',
            system: sys,
            messages: msgs.length ?
              [...msgs, { role: 'user', content: user }] :
              [{ role: 'user', content: user }],
            max_tokens: 2048,
            stream: true
          };
        },
        streamHandler: 'claude',
        responseExtractor: (data) => data?.content?.[0]?.text
      },
      'gemini': {
        // 基本端点
        endpoint: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
        // 流式端点（添加 alt=sse 参数）
        streamEndpoint: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}&alt=sse`,
        modelName: 'gemini-2.0-flash',
        headers: { 'Content-Type': 'application/json' },
        bodyBuilder: (sys, msgs, user) => {
          const geminiMessages = [];
          if (msgs.length) {
            for (const msg of msgs) {
              geminiMessages.push({ role: msg.role === 'assistant' ? 'model' : 'user', parts: [{ text: msg.content }] });
            }
          }
          geminiMessages.push({ role: 'user', parts: [{ text: user }] });
          return {
            contents: geminiMessages,
            generationConfig: { temperature: 0.5, maxOutputTokens: 2048 },
            systemInstruction: { parts: [{ text: sys }] }
            // 移除 stream 参数，使用 URL 参数 alt=sse
          };
        },
        streamHandler: 'gemini',
        responseExtractor: (data) => {
          if (data?.candidates && data.candidates.length > 0 && data.candidates[0].content) {
            const parts = data.candidates[0].content.parts;
            return parts && parts.length > 0 ? parts[0].text : '';
          }
          return '';
        }
      },
      'gemini-preview': {
        // 基本端点
        endpoint: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-04-17:generateContent?key=${apiKey}`,
        // 流式端点（添加 alt=sse 参数）
        streamEndpoint: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-04-17:generateContent?key=${apiKey}&alt=sse`,
        modelName: 'gemini-2.5-flash-preview-04-17',
        headers: { 'Content-Type': 'application/json' },
        bodyBuilder: (sys, msgs, user) => {
          const geminiMessages = [];
          if (msgs.length) {
            for (const msg of msgs) {
              geminiMessages.push({ role: msg.role === 'assistant' ? 'model' : 'user', parts: [{ text: msg.content }] });
            }
          }
          geminiMessages.push({ role: 'user', parts: [{ text: user }] });
          return {
            contents: geminiMessages,
            generationConfig: {
              temperature: 0.5,
              maxOutputTokens: 2048,
              responseModalities: ["TEXT"],
              responseMimeType: "text/plain"
            },
            systemInstruction: { parts: [{ text: sys }] }
            // 移除 stream 参数，使用 URL 参数 alt=sse
          };
        },
        streamHandler: 'gemini',
        responseExtractor: (data) => {
          if (data?.candidates && data.candidates.length > 0 && data.candidates[0].content) {
            const parts = data.candidates[0].content.parts;
            return parts && parts.length > 0 ? parts[0].text : '';
          }
          return '';
        }
      }
    };
    apiConfig = predefinedConfigs[config.model] || predefinedConfigs['mistral'];
    if (config.model === 'mistral') {
      apiConfig.headers['Authorization'] = `Bearer ${apiKey}`;
    }
  }

  const formattedHistory = conversationHistory.map(msg => ({
    role: msg.role,
    content: msg.content
  }));

  chatHistory.push({ role: 'assistant', content: '' });
  const assistantMsgIndex = chatHistory.length - 1;

  try {
    if (typeof updateChatbotUI === 'function') updateChatbotUI();
    if (useStreamApi) {
      // 修正：只要有 streamBodyBuilder 就用它，支持 custom_source_xxx
      const requestBody = apiConfig.streamBodyBuilder
        ? apiConfig.streamBodyBuilder(systemPrompt, formattedHistory, userInput)
        : apiConfig.bodyBuilder(systemPrompt, formattedHistory, userInput);
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
        parseChunk = (chunk) => {
          try {
            if (!chunk.trim() || !chunk.startsWith('data:')) return '';
            const data = JSON.parse(chunk.replace(/^data: /, ''));
            return data.choices?.[0]?.delta?.content || '';
          } catch (e) {
            if (!chunk.includes('[DONE]') && chunk.trim() && !chunk.trim().startsWith(':')) {
              //console.warn("解析流式回复块错误:", chunk, e);
            }
            return '';
          }
        };
      }
      let lastUpdateTime = Date.now();
      const UPDATE_INTERVAL = 100;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');
          for (const line of lines) {
            const content = parseChunk(line);
            if (content) {
              collectedContent += content;
              const now = Date.now();
              if (now - lastUpdateTime > UPDATE_INTERVAL) {
                chatHistory[assistantMsgIndex].content = collectedContent;
                if (typeof updateChatbotUI === 'function') updateChatbotUI();
                lastUpdateTime = now;
              }
            }
          }
        }
      } catch (streamError) {
        //console.warn("流式读取错误:", streamError);
      }
      chatHistory[assistantMsgIndex].content = collectedContent || '流式回复处理出错，请重试';
    } else {
      // fallback 到非流式分支
      console.log('[流式] 走了 bodyBuilder 分支');
      const requestBody = apiConfig.bodyBuilder(systemPrompt, userInput);
      console.log('API Endpoint:', apiConfig.endpoint);
      console.log('Headers:', apiConfig.headers);
      console.log('Request Body:', requestBody);
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
    }
    // 收集完内容后处理思维导图
    if (isMindMapRequest && chatHistory[assistantMsgIndex].content) {
      try {
        const content = chatHistory[assistantMsgIndex].content;
        let mindMapMarkdown = content;
        const codeBlockMatch = content.match(/```(?:markdown)?\s*([\s\S]+?)```/);
        if (codeBlockMatch && codeBlockMatch[1]) {
          mindMapMarkdown = codeBlockMatch[1].trim();
        }
        const originalContent = content;
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
        }
        console.log('存储到localStorage的思维导图内容:', safeMindMapMarkdown);
        window.localStorage.setItem('mindmapData_' + docId, safeMindMapMarkdown);
        chatHistory[assistantMsgIndex].content =
          `<div style="position:relative;">
            <div id=\"mindmap-container\" style=\"width:100%;height:400px;margin-top:20px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc;overflow:auto;filter:blur(2.5px);transition:filter 0.3s;\"></div>
            <div style=\"position:absolute;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;z-index:2;\">
              <button onclick=\"window.open('mindmap.html?docId=${encodeURIComponent(docId)}','_blank')\" style=\"padding:12px 28px;font-size:18px;background:rgba(59,130,246,0.92);color:#fff;border:none;border-radius:8px;box-shadow:0 2px 8px rgba(59,130,246,0.12);cursor:pointer;\">放大查看/编辑思维导图</button>
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
    if (e.message === "stream_not_supported" && config.model === 'custom') {
      try {
        chatHistory[assistantMsgIndex].content = '正在重试...';
        if (typeof updateChatbotUI === 'function') updateChatbotUI();
        const requestBody = apiConfig.bodyBuilder(systemPrompt, userInput);
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
      chatHistory[assistantMsgIndex].content = errorMessage;
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
  if (config.model === 'custom') {
    apiConfig = buildCustomApiConfig(
      apiKey,
      config.cms.apiEndpoint,
      config.cms.modelId,
      config.cms.requestFormat,
      config.cms.temperature,
      config.cms.max_tokens
    );
  } else {
    const predefinedConfigs = {
      'mistral': {
        endpoint: 'https://api.mistral.ai/v1/chat/completions',
        modelName: 'mistral-large-latest',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        bodyBuilder: (sys, msgs, user) => ({
          model: 'mistral-large-latest',
          messages: [
            { role: 'system', content: sys },
            { role: 'user', content: user }
          ]
        }),
        responseExtractor: (data) => data?.choices?.[0]?.message?.content
      },
      'deepseek': {
        endpoint: 'https://api.deepseek.com/v1/chat/completions',
        modelName: 'deepseek-chat',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        bodyBuilder: (sys, msgs, user) => ({
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: sys },
            { role: 'user', content: user }
          ]
        }),
        responseExtractor: (data) => data?.choices?.[0]?.message?.content
      },
      'volcano-deepseek-v3': {
        endpoint: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
        modelName: '火山引擎 DeepSeek v3',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        bodyBuilder: (sys, msgs, user) => ({
          model: 'deepseek-v3-250324',
          messages: [
            { role: 'system', content: sys },
            ...msgs,
            { role: 'user', content: user }
          ],
          temperature: 0.5,
          max_tokens: 8192,
          stream: true
        }),
        streamHandler: true,
        responseExtractor: (data) => data?.choices?.[0]?.message?.content
      },
      'volcano-doubao': {
        endpoint: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
        modelName: '火山引擎 豆包',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        bodyBuilder: (sys, msgs, user) => ({
          model: 'doubao-1-5-pro-32k-250115',
          messages: [
            { role: 'system', content: sys },
            ...msgs,
            { role: 'user', content: user }
          ],
          temperature: 0.5,
          max_tokens: 8192,
          stream: true
        }),
        streamHandler: true,
        responseExtractor: (data) => data?.choices?.[0]?.message?.content
      },
      'tongyi-deepseek-v3': {
        endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
        modelName: '阿里云通义百炼 DeepSeek v3',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        bodyBuilder: (sys, msgs, user) => ({
          model: 'deepseek-v3',
          messages: [
            { role: 'system', content: sys },
            ...msgs,
            { role: 'user', content: user }
          ],
          temperature: 0.5,
          max_tokens: 8192,
          stream: true
        }),
        streamHandler: true,
        responseExtractor: (data) => data?.choices?.[0]?.message?.content
      },
      'tongyi-qwen-turbo': {
        endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
        modelName: '阿里云通义百炼 Qwen Turbo',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        bodyBuilder: (sys, msgs, user) => ({
          model: 'qwen-turbo-latest',
          messages: [
            { role: 'system', content: sys },
            { role: 'user', content: user }
          ],
          temperature: 0.5,
          max_tokens: 8192,
          stream: true
        }),
        streamHandler: true,
        responseExtractor: (data) => data?.choices?.[0]?.message?.content
      },
      'claude': {
        endpoint: 'https://api.anthropic.com/v1/messages',
        modelName: 'claude-3-sonnet-20240229',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        bodyBuilder: (sys, msgs, user) => ({
          model: 'claude-3-sonnet-20240229',
          system: sys,
          messages: [{ role: 'user', content: user }],
          max_tokens: 2048
        }),
        responseExtractor: (data) => data?.content?.[0]?.text
      },
      'gemini': {
        endpoint: `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`,
        modelName: 'gemini-pro',
        headers: { 'Content-Type': 'application/json' },
        bodyBuilder: (sys, msgs, user) => ({
          contents: [
            { role: 'user', parts: [{ text: user }] }
          ],
          generationConfig: { temperature: 0.5, maxOutputTokens: 2048 },
          systemInstruction: { parts: [{ text: sys }] }
        }),
        responseExtractor: (data) => data?.candidates?.[0]?.content?.parts?.[0]?.text
      }
    };
    apiConfig = predefinedConfigs[config.model] || predefinedConfigs['mistral'];
  }
  const requestBody = apiConfig.bodyBuilder(sysPrompt, [], userInput);
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
  if (!answer) throw new Error('API 响应解析失败，未能提取内容');
  return answer;
}

// 导出核心对象
window.ChatbotCore = {
  chatHistory,
  isChatbotLoading,
  getChatbotConfig,
  getCurrentDocContent,
  buildChatMessages,
  sendChatbotMessage
};