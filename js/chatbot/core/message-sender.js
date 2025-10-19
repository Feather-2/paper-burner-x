// message-sender.js
// 消息发送模块

(function() {
  'use strict';

  /**
   * 获取聊天机器人配置
   * 该函数负责从用户设置中加载并返回当前聊天机器人所需的配置信息。
   * 主要包括模型选择、API Key 加载、自定义模型设置的处理等。
   *
   * 主要逻辑：
   * 1. 如果提供了 `externalConfig`，则直接返回该配置，用于外部注入的特定配置。
   * 2. 加载用户设置：通过 `loadSettings` 函数（如果可用）或从 `localStorage` 加载。
   * 3. 读取翻译模型设置 (`selectedTranslationModel`)，默认为 'mistral'。
   * 4. 自定义模型处理：
   * 5. API Key 加载：
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

// 发送消息到大模型（支持思维导图请求）
/**
 * 发送消息到大语言模型并处理响应，支持思维导图生成请求。
 *
 * @param {string|Array<object>} userInput 用户输入的查询或指令 (can be a string for text, or an array for multimodal content).
 * @param {function} updateChatbotUI 更新聊天界面显示的回调函数。
 * @param {object} [externalConfig=null] 可选的外部配置对象，用于覆盖默认配置加载逻辑。
 * @param {string|Array<object>} [displayUserInput=null] Optional. The content to display in chat history for the user's turn. If null, userInput is used.
 * @param {Array} chatHistory - 聊天历史数组的引用
 * @param {object} isChatbotLoadingRef - isChatbotLoading的引用对象 {value: boolean}
 * @param {Function} getCurrentDocId - 获取当前文档ID的函数
 * @param {Function} getCurrentDocContent - 获取当前文档内容的函数
 * @param {Function} saveChatHistory - 保存聊天历史的函数
 * @param {Function} ensureSemanticGroupsReady - 确保意群准备就绪的函数
 * @returns {Promise<void>} 无明确返回值，主要通过回调更新 UI 和内部状态。
 */
async function sendChatbotMessage(userInput, updateChatbotUI, externalConfig = null, displayUserInput = null, chatHistory, isChatbotLoadingRef, getCurrentDocId, getCurrentDocContent, saveChatHistory, ensureSemanticGroupsReady) {
  // 创建中止控制器
  window.chatbotAbortController = new AbortController();

  // 辅助函数需要从外部引入
  const extractTextFromUserContent = window.ApiConfigBuilder ?
    ((userContent) => {
      if (Array.isArray(userContent)) {
        const textPart = userContent.find(part => part.type === 'text');
        return textPart ? textPart.text : '';
      }
      return userContent;
    }) : null;

  const convertOpenAIToGeminiParts = window.ApiConfigBuilder ?
    ((userContent) => {
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
      return [{ text: userContent }];
    }) : null;

  const convertOpenAIToAnthropicContent = window.ApiConfigBuilder ?
    ((userContent) => {
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
      return [{ type: 'text', text: userContent }];
    }) : null;

  const buildCustomApiConfig = window.ApiConfigBuilder?.buildCustomApiConfig;

  // 1. 在函数最开始获取 docId，并打印
  const docIdForThisMessage = getCurrentDocId();

  if (isChatbotLoadingRef.value) {
    return;
  }
  isChatbotLoadingRef.value = true;

  chatHistory.push({ role: 'user', content: displayUserInput || userInput });

  // 保存聊天历史（前端 localStorage / 后端 API）
  await saveChatHistory(docIdForThisMessage, chatHistory);

  // 后端模式：立即保存用户消息
  if (window.ChatHistoryManager && window.ChatHistoryManager.saveSingleMessage) {
    await window.ChatHistoryManager.saveSingleMessage(docIdForThisMessage, {
      role: 'user',
      content: displayUserInput || userInput
    });
  }

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
  let docContentInfo = getCurrentDocContent();

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
              // 仅在有内容时覆盖占位文本，避免空串刷屏
              if (toolCallHtml && toolCallHtml.length > 0) {
                chatHistory[earlyAssistantMsgIndex].toolCallHtml = toolCallHtml;
                chatHistory[earlyAssistantMsgIndex].content = '';
                if (typeof updateChatbotUI === 'function') {
                  updateChatbotUI();
                }
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

  let conversationHistory = []; // Initialize as empty
  // Check the global option for using context. Default to true if the option or its parent is not defined.
  if (window.chatbotActiveOptions && typeof window.chatbotActiveOptions.useContext === 'boolean' && window.chatbotActiveOptions.useContext === false) {
    // If useContext is explicitly false, conversationHistory remains empty (no context).
  } else {
    // Default behavior or if useContext is true: use chat history.
    conversationHistory = chatHistory.slice(0, -1).map(msg => ({
      role: msg.role,
      content: msg.content // This content can be rich (text or array of parts)
    }));
  }

  const apiKey = config.apiKey;

  if (!apiKey) {
    chatHistory.push({ role: 'assistant', content: '未检测到有效的 API Key，请先在主页面配置。' });
    isChatbotLoadingRef.value = false;
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
      isChatbotLoadingRef.value = false;
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
        bodyBuilder: (sys, msgs, user_content) => ({
          model: 'mistral-large-latest',
          messages: [
            { role: 'system', content: sys },
            ...msgs.map(m => ({ role: m.role, content: extractTextFromUserContent(m.content) })),
            { role: 'user', content: extractTextFromUserContent(user_content) }
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
            { role: 'user', content: extractTextFromUserContent(user_content) }
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
        modelName: 'claude-3-sonnet-20240229',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        bodyBuilder: (sys, msgs, user_content) => {
          return {
            model: apiConfig.modelName || 'claude-3-sonnet-20240229',
            system: sys,
            messages: msgs.length ?
              [...msgs.map(m => ({role: m.role, content: convertOpenAIToAnthropicContent(m.content)})),
               { role: 'user', content: convertOpenAIToAnthropicContent(user_content) }] :
              [{ role: 'user', content: convertOpenAIToAnthropicContent(user_content) }],
            max_tokens: 2048,
            stream: true
          };
        },
        streamHandler: 'claude',
        responseExtractor: (data) => data?.content?.[0]?.text
      },
      'gemini': {
        endpoint: `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`,
        streamEndpoint: `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:streamGenerateContent?key=${apiKey}&alt=sse`,
        modelName: 'gemini-pro',
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
            generationConfig: { temperature: 0.5, maxOutputTokens: 2048 },
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
      'gemini-preview': {
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
              temperature: 0.5, maxOutputTokens: 2048,
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
    apiConfig = predefinedConfigs[config.model] || predefinedConfigs['mistral'];

    // Special handling for API keys for certain predefined models
    if (config.model === 'mistral') {
      apiConfig.headers['Authorization'] = `Bearer ${apiKey}`;
    } else if (config.model === 'claude') {
       apiConfig.headers['x-api-key'] = apiKey;
       if (config.cms && config.cms.modelId) {
           apiConfig.modelName = config.cms.modelId;
       }
    } else if (config.model.startsWith('gemini')) {
        let geminiModelId = 'gemini-pro';
        if (config.model === 'gemini-preview') geminiModelId = 'gemini-1.5-flash-latest';

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

        apiConfig.modelName = geminiModelId;
        const modelPath = geminiModelId.startsWith('models/') ? geminiModelId.substring(7) : geminiModelId;
        apiConfig.endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelPath}:generateContent?key=${apiKey}`;
        apiConfig.streamEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelPath}:streamGenerateContent?key=${apiKey}&alt=sse`;
    }
  }

  const formattedHistory = conversationHistory;

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
        body: JSON.stringify(requestBody),
        signal: window.chatbotAbortController?.signal
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

            let data;
            try {
              data = JSON.parse(chunk);
            } catch (e) {
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

            if (data.candidates && data.candidates.length > 0) {
              const candidate = data.candidates[0];

              if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
                return candidate.content.parts[0].text || '';
              }

              if (candidate.delta && candidate.delta.textDelta) {
                return candidate.delta.textDelta || '';
              }

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
      let collectedReasoning = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');
          for (const line of lines) {
            const parsed = parseChunk(line);
            if (typeof parsed === 'string') {
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
      chatHistory[assistantMsgIndex].content = collectedContent || '流式回复处理出错，请重试';
      if (collectedReasoning) chatHistory[assistantMsgIndex].reasoningContent = collectedReasoning;
    } else {
      // fallback 到非流式分支
      console.log('[非流式] 调用 bodyBuilder');
      const requestBody = apiConfig.bodyBuilder(systemPrompt, userInput);
      console.log('API Endpoint:', apiConfig.endpoint);
      console.log('Headers:', apiConfig.headers);
      const response = await fetch(apiConfig.endpoint, {
        method: 'POST',
        headers: apiConfig.headers,
        body: JSON.stringify(requestBody),
        signal: window.chatbotAbortController?.signal
      });
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`API 错误 (${response.status}): ${errText}`);
      }
      const data = await response.json();
      const answer = apiConfig.responseExtractor(data);
      console.log("[sendChatbotMessage] Raw AI response (non-streamed):", answer);
      if (!answer) {
        throw new Error("API 响应解析失败，未能提取回复内容");
      }
      chatHistory[assistantMsgIndex].content = answer;
    }
    // 收集完内容后处理思维导图
    if (isMindMapRequest && chatHistory[assistantMsgIndex].content) {
      try {
        const assistantResponseContent = chatHistory[assistantMsgIndex].content;
        console.log("[sendChatbotMessage] Mind Map: assistantResponseContent (before processing):", assistantResponseContent);

        let mindMapMarkdown = assistantResponseContent;
        const codeBlockMatch = assistantResponseContent.match(/```(?:markdown)?\s*([\s\S]+?)```/);
        if (codeBlockMatch && codeBlockMatch[1]) {
          mindMapMarkdown = codeBlockMatch[1].trim();
        }
        console.log("[sendChatbotMessage] Mind Map: mindMapMarkdown after extraction:", mindMapMarkdown);

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
        let safeMindMapMarkdown = mindMapMarkdown;
        if (!safeMindMapMarkdown.trim() || !/^#/.test(safeMindMapMarkdown.trim()) || !/\n##?\s+/.test(safeMindMapMarkdown)) {
          safeMindMapMarkdown = '# 思维导图\n\n暂无结构化内容';
          console.log("[sendChatbotMessage] Mind Map: Content defaulted to '暂无结构化内容'. Original mindMapMarkdown was:", mindMapMarkdown);
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
    // 处理用户中止的情况
    if (e.name === 'AbortError') {
      chatHistory[assistantMsgIndex].content = '对话已被用户中止。';
      isChatbotLoadingRef.value = false;
      if (typeof updateChatbotUI === 'function') updateChatbotUI();
      saveChatHistory(docIdForThisMessage, chatHistory);
      return;
    }

    if (e.message === "stream_not_supported" && (
          config.model === 'custom' ||
          (typeof config.model === 'string' && (
             config.model.startsWith('custom_source_') ||
             config.model === 'gemini' || config.model === 'gemini-preview' || config.model.startsWith('gemini')
          )))) {
      try {
        chatHistory[assistantMsgIndex].content = '流式请求失败，尝试以非流式发送...';
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
      if (chatHistory[assistantMsgIndex]) {
        chatHistory[assistantMsgIndex].content = errorMessage;
      }
    }
  } finally {
    // 清理中止控制器
    window.chatbotAbortController = null;

    isChatbotLoadingRef.value = false;
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

    saveChatHistory(docIdForThisMessage, chatHistory);

    // 后端模式：保存助手消息
    if (window.ChatHistoryManager && window.ChatHistoryManager.saveSingleMessage) {
      await window.ChatHistoryManager.saveSingleMessage(docIdForThisMessage, {
        role: 'assistant',
        content: chatHistory[assistantMsgIndex].content,
        metadata: {
          toolCallHtml: chatHistory[assistantMsgIndex].toolCallHtml,
          hasMindMap: chatHistory[assistantMsgIndex].hasMindMap,
          mindMapData: chatHistory[assistantMsgIndex].mindMapData,
          reasoningContent: chatHistory[assistantMsgIndex].reasoningContent
        }
      });
    }
  }
}

// =============== 新增：分段整理辅助函数 ===============
/**
 * 针对单个文本块进行摘要或处理的辅助函数。
 * 主要用于长文本分块处理的场景，例如对每个文档分块进行初步总结。
 * 此函数不依赖聊天历史，仅进行单轮请求。
 *
 * @param {string} sysPrompt 系统提示，指导模型如何处理输入。
 * @param {string} userInput 需要处理的文本块内容。
 * @param {object} config 聊天机器人配置对象 (通常来自 `getChatbotConfig`)。
 * @param {string} apiKey API 密钥。
 * @returns {Promise<string>} 模型处理后的文本结果。
 * @throws {Error} 如果 API 请求失败或响应解析失败。
 */
async function singleChunkSummary(sysPrompt, userInput, config, apiKey) {
  const extractTextFromUserContent = (userContent) => {
    if (Array.isArray(userContent)) {
      const textPart = userContent.find(part => part.type === 'text');
      return textPart ? textPart.text : '';
    }
    return userContent;
  };

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
    return [{ text: userContent }];
  };

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
    return [{ type: 'text', text: userContent }];
  };

  const buildCustomApiConfig = window.ApiConfigBuilder?.buildCustomApiConfig;

  // 只做单轮整理，不带历史
  let apiConfig;
  const isCustomLike = config.model === 'custom' || (typeof config.model === 'string' && config.model.startsWith('custom_source_'));

  if (isCustomLike) {
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
        headers: { 'Content-Type': 'application/json' },
        bodyBuilder: (sys, msgs, user_content) => ({
          model: 'mistral-large-latest',
          messages: [
            { role: 'system', content: sys },
            ...msgs.map(m => ({ role: m.role, content: extractTextFromUserContent(m.content) })),
            { role: 'user', content: extractTextFromUserContent(user_content) }
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
            { role: 'user', content: extractTextFromUserContent(user_content) }
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
        modelName: 'claude-3-sonnet-20240229',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        bodyBuilder: (sys, msgs, user_content) => {
          return {
            model: apiConfig.modelName || 'claude-3-sonnet-20240229',
            system: sys,
            messages: msgs.length ?
              [...msgs, { role: 'user', content: convertOpenAIToAnthropicContent(user_content) }] :
              [{ role: 'user', content: convertOpenAIToAnthropicContent(user_content) }],
            max_tokens: 2048,
            stream: true
          };
        },
        streamHandler: 'claude',
        responseExtractor: (data) => data?.content?.[0]?.text
      },
      'gemini': {
        endpoint: `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`,
        streamEndpoint: `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:streamGenerateContent?key=${apiKey}&alt=sse`,
        modelName: 'gemini-pro',
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
            generationConfig: { temperature: 0.5, maxOutputTokens: 2048 },
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
      'gemini-preview': {
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
              temperature: 0.5, maxOutputTokens: 2048,
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
    apiConfig = predefinedConfigs[config.model] || predefinedConfigs['mistral'];

    // Special handling for API keys for certain predefined models
    if (config.model === 'mistral') {
      apiConfig.headers['Authorization'] = `Bearer ${apiKey}`;
    } else if (config.model === 'claude') {
       apiConfig.headers['x-api-key'] = apiKey;
       if (config.cms && config.cms.modelId) {
           apiConfig.modelName = config.cms.modelId;
       }
    } else if (config.model.startsWith('gemini')) {
        let geminiModelId = 'gemini-pro';
        if (config.model === 'gemini-preview') geminiModelId = 'gemini-1.5-flash-latest';

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

        apiConfig.modelName = geminiModelId;
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

  // 导出
  window.MessageSender = {
    getChatbotConfig,
    sendChatbotMessage,
    singleChunkSummary
  };

})();
