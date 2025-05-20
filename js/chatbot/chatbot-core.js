// chatbot-core.js

// =====================
// buildCustomApiConfig: 兼容自定义模型调用
// =====================
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
let chatHistory = [];
let isChatbotLoading = false;

// 读取主页面配置（API Key、模型等）
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
function buildChatMessages(history, userInput) {
  const messages = history.map(m => ({ role: m.role, content: m.content }));
  messages.push({ role: 'user', content: userInput });
  return messages;
}

// =============== 新增：智能分段函数 ===============
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
function getCurrentDocId() {
  const doc = getCurrentDocContent();
  // 用文件名+图片数量+ocr长度+translation长度做唯一性（可根据实际情况调整）
  return `${doc.name || 'unknown'}_${(doc.images||[]).length}_${(doc.ocr||'').length}_${(doc.translation||'').length}`;
}

// 发送消息到大模型（支持思维导图请求）
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