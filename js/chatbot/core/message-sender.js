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

  // 使用新的 ChatbotConfigManager 获取配置
  if (typeof window !== 'undefined' && window.ChatbotConfigManager) {
    try {
      const chatbotConfig = window.ChatbotConfigManager.getChatbotModelConfig();
      const convertedConfig = window.ChatbotConfigManager.convertChatbotConfigToMessageSenderFormat(chatbotConfig);

      console.log('[getChatbotConfig] 使用chatbot专用配置:', {
        chatbotConfig,
        convertedConfig
      });

      return convertedConfig;
    } catch (error) {
      console.error('[getChatbotConfig] 使用chatbot配置失败，回退到翻译模型配置:', error);
    }
  }

  // 回退逻辑：如果 ChatbotConfigManager 不可用，使用原有的翻译模型配置
  console.warn('[getChatbotConfig] ChatbotConfigManager 不可用，使用翻译模型配置');
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

  // 提取原始纯文本输入（可能带有控制前缀，如 [加入配图]）
  let rawPlainTextInput = '';
  if (typeof userInput === 'string') {
    rawPlainTextInput = userInput;
  } else if (Array.isArray(userInput)) {
    const textPart = userInput.find(part => part.type === 'text');
    if (textPart) {
      rawPlainTextInput = textPart.text;
    }
  }

  // 识别思维导图请求（基于原始输入）
  const isMindMapRequest = rawPlainTextInput.includes('思维导图') || rawPlainTextInput.includes('脑图');

  // 识别配图（draw.io）请求 - 基于前缀 [加入配图]（使用原始输入做检测，避免前缀被提前剥离）
  let isDrawioPicturesRequest = false;
  if (window.ChatbotPreset && typeof window.ChatbotPreset.isDrawioPicturesRequest === 'function') {
    isDrawioPicturesRequest = window.ChatbotPreset.isDrawioPicturesRequest(rawPlainTextInput);
  } else if (rawPlainTextInput) {
    isDrawioPicturesRequest = rawPlainTextInput.trim().startsWith('[加入配图]');
  }

  // 构造发给模型看的“干净”用户文本：如果是配图请求，则去掉前缀 [加入配图]
  let cleanedPlainTextInput = rawPlainTextInput;
  if (isDrawioPicturesRequest && cleanedPlainTextInput) {
    cleanedPlainTextInput = cleanedPlainTextInput.replace(/^\[加入配图]\s*/, '');
  }
  const config = getChatbotConfig(externalConfig);
  let docContentInfo = getCurrentDocContent();

  // ===== 新增：智能分段预处理 =====
  // 在首次对话时，检测是否需要生成意群
  await ensureSemanticGroupsReady(docContentInfo);
  // 重要：生成后重新获取文档内容以拿到 semanticGroups（避免使用旧的 docContentInfo 快照）
  docContentInfo = getCurrentDocContent();

  // ===== 新增：ReAct模式支持 =====
  // 检查是否启用ReAct模式（优先级高于传统多轮检索）
  const useReActMode = !!(window.chatbotActiveOptions && window.chatbotActiveOptions.useReActMode);

  if (useReActMode && window.ReActEngine) {
    console.log('[ChatbotCore] 使用 ReAct 模式');

    // 提前创建助手消息占位符
    chatHistory.push({ role: 'assistant', content: '🤔 启动 ReAct 推理引擎...' });
    const earlyAssistantMsgIndex = chatHistory.length - 1;
    if (typeof updateChatbotUI === 'function') updateChatbotUI();

    // 开始工具调用会话
    if (window.ChatbotToolTraceUI?.startSession) {
      window.ChatbotToolTraceUI.startSession();
    }

    try {
      // 创建ReAct引擎实例
      const reactEngine = new window.ReActEngine({
        maxIterations: (window.chatbotActiveOptions.reactMaxIterations) || 5,
        llmConfig: config,
        tokenBudget: {
          totalBudget: 32000,
          systemTokens: 2000,
          historyTokens: 8000,
          contextTokens: 18000,
          responseTokens: 4000
        }
      });

      // 简化系统提示词：ReActEngine 会自动注入完整的 ReAct 指令
      // 这里只需要提供文档上下文信息
      let reactSystemPrompt = `你正在协助用户理解文档"${docContentInfo.name || '当前文档'}"。
严格按照 ReAct 流程工作，始终以 JSON 格式返回决策。`;

      // 构建对话历史
      const conversationHistory = chatHistory.slice(0, -1).map(msg => ({
        role: msg.role,
        content: msg.content
      }));

      // 执行ReAct循环
      let finalAnswer = null;
      let toolCallHtml = '';

      for await (const event of reactEngine.run(
        cleanedPlainTextInput,
        docContentInfo,
        reactSystemPrompt,
        conversationHistory
      )) {
        console.log('[MessageSender] 收到事件:', event.type, event);

        // 1. 捕获 ReAct 日志用于新版可视化
        if (event.reactLog) {
          chatHistory[earlyAssistantMsgIndex].reactLog = event.reactLog;
        }

        // 2. 仍然通知旧版 UI 组件 (保持兼容性，防止报错)，但不使用其生成的 HTML
        if (window.ChatbotToolTraceUI?.handleReActEvent) {
          window.ChatbotToolTraceUI.handleReActEvent(event);
        }

        // 3. 强制刷新 UI
        if (typeof updateChatbotUI === 'function') {
          updateChatbotUI();
        }

        // 保存最终答案
        if (event.type === 'final_answer') {
          console.log('[MessageSender] ✓ 收到 final_answer 事件，立即清除 loading 状态');
          finalAnswer = event.answer;

          // ⚠️ 关键：必须先清除 loading 状态，再更新 UI
          // 因为 updateChatbotUI() 会检查 isChatbotLoading 来决定是否显示 typing indicator
          isChatbotLoadingRef.value = false;
          console.log('[MessageSender] ✓ loading 状态已清除，isChatbotLoadingRef.value =', isChatbotLoadingRef.value);

          // 更新消息内容并刷新UI
          chatHistory[earlyAssistantMsgIndex].content = finalAnswer;
          // chatHistory[earlyAssistantMsgIndex].toolCallHtml = toolCallHtml; // 不再使用旧版 HTML
          if (typeof updateChatbotUI === 'function') updateChatbotUI();
          saveChatHistory(getCurrentDocId(), chatHistory);

          return; // 立即返回，终止循环
        }
      }

      // 备份：如果循环正常结束但没有final_answer（不应该发生）
      if (finalAnswer) {
        chatHistory[earlyAssistantMsgIndex].content = finalAnswer;
        chatHistory[earlyAssistantMsgIndex].toolCallHtml = toolCallHtml;
        if (typeof updateChatbotUI === 'function') updateChatbotUI();
        saveChatHistory(getCurrentDocId(), chatHistory);
        isChatbotLoadingRef.value = false;
        return; // 完成，直接返回
      } else {
        // 没有得到答案，降级到传统模式
        console.warn('[ChatbotCore] ReAct模式未能产生答案，降级到传统模式');
        chatHistory.splice(earlyAssistantMsgIndex, 1); // 移除占位消息
      }

    } catch (error) {
      console.error('[ChatbotCore] ReAct模式执行失败:', error);
      chatHistory[earlyAssistantMsgIndex].content = `ReAct模式执行失败: ${error.message}`;
      if (typeof updateChatbotUI === 'function') updateChatbotUI();
      saveChatHistory(getCurrentDocId(), chatHistory);
      isChatbotLoadingRef.value = false;
      return;
    }
  }

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

        const stream = window.streamingMultiHopRetrieve(cleanedPlainTextInput, docContentInfo, config, { maxRounds: userSet.maxRounds || 3 });

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
    // 注意：这里传入原始 plainTextInput，以便 PromptConstructor 能看到控制前缀（如 [加入配图]），正确注入对应提示词
    systemPrompt = window.PromptConstructor.buildSystemPrompt(docContentInfo, isMindMapRequest, rawPlainTextInput);
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
    // Chatbot 独立配置：优先使用 Chatbot 配置，可回退到翻译模型配置（单向隔离）
    let selectedModelId = '';
    try {
      // 1. 【最高优先级】Chatbot 专用配置的模型ID（cms.modelId）
      if (config.cms && config.cms.modelId) {
        selectedModelId = config.cms.modelId;
        console.log('[Chatbot] ✓ 使用 Chatbot 独立配置:', selectedModelId);
      }
      // 2. 【回退】翻译模型配置（仅读取，Chatbot 保存时不会修改翻译配置）
      if (!selectedModelId && config.settings && config.settings.selectedCustomModelId) {
        selectedModelId = config.settings.selectedCustomModelId;
        console.log('[Chatbot] ↩ 回退到翻译模型配置:', selectedModelId);
      }
      // 3. 【进一步回退】可用模型列表的第一个
      if (!selectedModelId && Array.isArray(config.siteSpecificAvailableModels) && config.siteSpecificAvailableModels.length > 0) {
        selectedModelId = typeof config.siteSpecificAvailableModels[0] === 'object'
          ? config.siteSpecificAvailableModels[0].id
          : config.siteSpecificAvailableModels[0];
        console.log('[Chatbot] ↩ 使用可用模型列表的第一个:', selectedModelId);
      }
    } catch (e) {
      console.error('[Chatbot] ✗ 获取模型ID失败:', e);
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
          const ttlRaw = config?.cms?.promptCachingTtl ?? config?.cms?.promptCachingTTL ?? config?.settings?.promptCachingTtl ?? config?.settings?.promptCachingTTL;
          const ttl = ttlRaw === '5m' || ttlRaw === '1h' ? ttlRaw : null;
          const addCacheBreakpoint = (blocks) => {
            const list = Array.isArray(blocks) ? blocks : [];
            for (let i = list.length - 1; i >= 0; i--) {
              const block = list[i];
              if (!block || typeof block !== 'object') continue;
              if (block.type !== 'text') continue;
              block.cache_control = ttl ? { type: 'ephemeral', ttl } : { type: 'ephemeral' };
              return true;
            }
            return false;
          };

          const systemBlocks = sys ? [{ type: 'text', text: sys }] : [];
          const history = Array.isArray(msgs)
            ? msgs
                .map(m => {
                  if (!m || typeof m !== 'object') return null;
                  if (m.role === 'system') {
                    return { role: 'user', content: [{ type: 'text', text: String(m.content ?? '') }] };
                  }
                  const role = m.role === 'assistant' ? 'assistant' : 'user';
                  return { role, content: convertOpenAIToAnthropicContent(m.content) };
                })
                .filter(Boolean)
            : [];

          // Prompt caching: cache stable prefix (system + prior conversation history), exclude final user message.
          if (history.length > 0) addCacheBreakpoint(history[history.length - 1]?.content);
          else if (systemBlocks.length > 0) addCacheBreakpoint(systemBlocks);

          return {
            model: apiConfig.modelName || 'claude-3-sonnet-20240229',
            ...(systemBlocks.length ? { system: systemBlocks } : {}),
            messages: history.length
              ? [...history, { role: 'user', content: convertOpenAIToAnthropicContent(user_content) }]
              : [{ role: 'user', content: convertOpenAIToAnthropicContent(user_content) }],
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
      // Phase 3.5 超级降频: 大幅降低更新频率 + 智能跳帧（使用统一配置）
      const intervals = window.PerformanceConfig?.UPDATE_INTERVALS || {
        FOREGROUND: 800,
        BACKGROUND: 3000
      };
      const BASE_UPDATE_INTERVAL = intervals.FOREGROUND;
      const BACKGROUND_UPDATE_INTERVAL = intervals.BACKGROUND;

      // Phase 3.5 智能跳帧: 监测渲染性能（使用统一配置）
      const perfConfig = window.PerformanceConfig?.ADAPTIVE_RENDER || {
        HEAVY_THRESHOLD: 200,
        MIN_MULTIPLIER: 1,
        MAX_MULTIPLIER: 4,
        DECAY_THRESHOLD: 100
      };

      // 使用全局状态管理，避免变量作用域问题
      if (!window.ChatbotRenderState) {
        window.ChatbotRenderState = { adaptiveMultiplier: 1, lastRenderDuration: 0 };
      }

      const getUpdateInterval = () => {
        const baseInterval = (typeof document !== 'undefined' && document.hidden)
          ? BACKGROUND_UPDATE_INTERVAL
          : BASE_UPDATE_INTERVAL;

        // 智能跳帧: 使用衰减机制而非立即重置
        const lastDuration = window.ChatbotRenderState.lastRenderDuration;

        if (lastDuration > perfConfig.HEAVY_THRESHOLD) {
          // 渲染慢：逐步增加倍数（最多到 MAX_MULTIPLIER）；仅在倍数实际变化时输出日志
          const oldMultiplier = window.ChatbotRenderState.adaptiveMultiplier;
          const nextMultiplier = Math.min(
            perfConfig.MAX_MULTIPLIER,
            oldMultiplier * 2
          );
          window.ChatbotRenderState.adaptiveMultiplier = nextMultiplier;

          if (nextMultiplier !== oldMultiplier && window.PerfLogger) {
            window.PerfLogger.warn(
              `跳帧: 检测到重渲染(${lastDuration.toFixed(0)}ms)，降频×${window.ChatbotRenderState.adaptiveMultiplier}`
            );
          }
        } else if (lastDuration < perfConfig.DECAY_THRESHOLD && lastDuration > 0) {
          // 渲染快：逐步恢复倍数（最少到 MIN_MULTIPLIER）
          const oldMultiplier = window.ChatbotRenderState.adaptiveMultiplier;
          window.ChatbotRenderState.adaptiveMultiplier = Math.max(
            perfConfig.MIN_MULTIPLIER,
            window.ChatbotRenderState.adaptiveMultiplier / 2
          );
          if (oldMultiplier !== window.ChatbotRenderState.adaptiveMultiplier && window.PerfLogger) {
            window.PerfLogger.debug(
              `跳帧: 渲染恢复(${lastDuration.toFixed(0)}ms)，降频×${window.ChatbotRenderState.adaptiveMultiplier}`
            );
          }
        }

        return baseInterval * window.ChatbotRenderState.adaptiveMultiplier;
      };

      let collectedReasoning = '';
      let debounceTimer = null;  // Phase 3 优化: 防抖计时器，避免流式结束时的多次渲染
      let isCollectingDrawioXml = false; // 标志位：是否正在收集 draw.io XML（避免显示原始 XML）

      // Phase 3.5 性能监控版 debouncedUpdateUI（使用统一配置）
      const debounceDelay = window.PerformanceConfig?.UPDATE_INTERVALS?.DEBOUNCE || 150;
      const debouncedUpdateUI = () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          const renderStart = performance.now();
          if (typeof updateChatbotUI === 'function') updateChatbotUI();
          const renderEnd = performance.now();
          window.ChatbotRenderState.lastRenderDuration = renderEnd - renderStart;

          // 使用统一的性能日志工具
          if (window.PerfLogger) {
            window.PerfLogger.perf('渲染耗时', window.ChatbotRenderState.lastRenderDuration);
          }
        }, debounceDelay);
      };

      // 输出智能降频状态
      const initialInterval = getUpdateInterval();
      if (window.PerfLogger) {
        window.PerfLogger.info(
          `超级降频: 流式更新间隔 ${initialInterval}ms (${document.hidden ? '后台标签页' : '前台标签页'})`
        );
      }

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

                // 🔥 实时拦截 draw.io XML 输出
                // 如果是配图请求，且检测到 XML 内容，立即替换为友好提示
                if (isDrawioPicturesRequest && !isCollectingDrawioXml) {
                  // 检测是否包含 XML 特征
                  const hasXmlContent = collectedContent.includes('<?xml') ||
                                       collectedContent.includes('<mxfile') ||
                                       collectedContent.includes('<mxGraphModel');

                  if (hasXmlContent) {
                    // 立即替换为友好提示，避免用户看到大量 XML 代码
                    isCollectingDrawioXml = true;
                    chatHistory[assistantMsgIndex].content = '⏳ 正在生成配图，请稍候...';
                    debouncedUpdateUI();
                    console.log('[Draw.io] 检测到 XML 输出，已隐藏原始内容');
                  }
                }

                // 如果正在收集 draw.io XML，跳过常规的 UI 更新
                if (isCollectingDrawioXml) {
                  continue;
                }

                const now = Date.now();
                const currentInterval = getUpdateInterval();  // Phase 3.5: 智能跳帧
                if (now - lastUpdateTime > currentInterval) {
                  chatHistory[assistantMsgIndex].content = collectedContent;
                  debouncedUpdateUI();  // Phase 3.5: 性能监控版
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
              const currentInterval = getUpdateInterval();  // Phase 3.5: 智能跳帧
              if (now - lastUpdateTime > currentInterval) {
                debouncedUpdateUI();  // Phase 3.5: 性能监控版
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
      // 将用户输入中的文本部分替换为清洗后的 plain text（去掉控制前缀）
      let userInputForApi = userInput;
      if (Array.isArray(userInputForApi)) {
        userInputForApi = userInputForApi.map(part => {
          if (part.type === 'text' && typeof cleanedPlainTextInput === 'string') {
            return Object.assign({}, part, { text: cleanedPlainTextInput });
          }
          return part;
        });
      } else if (typeof userInputForApi === 'string' && typeof cleanedPlainTextInput === 'string') {
        userInputForApi = cleanedPlainTextInput;
      }

      const requestBody = apiConfig.bodyBuilder(systemPrompt, userInputForApi);
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

    // 收集完内容后处理配图（draw.io XML）
    if (isDrawioPicturesRequest && chatHistory[assistantMsgIndex].content) {
      try {
        const assistantResponseContent = chatHistory[assistantMsgIndex].content || '';

        // 标志：XML 是否已经过布局优化（来自 DrawioLite）
        let isAlreadyOptimized = false;

        // 提取并修复 XML 内容（直接从响应中提取标准 XML）
        const extractAndFixDrawioXml = (raw) => {
          let text = raw || '';

          // 优先检测 DrawioLite DSL 并转换
          if (window.DrawioLitePrompt && window.DrawioLitePrompt.isDrawioLiteDSL(text)) {
            console.log('[Draw.io] 检测到 DrawioLite DSL，开始转换...');
            try {
              if (window.DrawioLiteParser && window.DrawioLiteParser.convertDrawioLite) {
                text = window.DrawioLiteParser.convertDrawioLite(text);
                isAlreadyOptimized = true;  // 标记为已优化
                console.log('[Draw.io] ✅ DrawioLite → XML 转换成功（已包含布局优化，跳过后续优化）');
                return text; // DSL已在parser中优化，直接返回，避免重复优化
              } else {
                console.error('[Draw.io] ❌ DrawioLite Parser 未加载');
              }
            } catch (error) {
              console.error('[Draw.io] ❌ DrawioLite 转换失败:', error);
              // 转换失败，继续尝试 XML 提取
            }
          }

          // 清理文本：移除 Markdown 代码块标记（如果 AI 违规使用了）
          text = text.replace(/```xml\s*/gi, '').replace(/```\s*/g, '');

          // 1) 尝试提取 <mxfile> ... </mxfile>
          let start = text.search(/<mxfile\b/i);
          let end = text.search(/<\/mxfile>/i);
          if (start !== -1 && end !== -1 && end > start) {
            text = text.slice(start, end + '</mxfile>'.length).trim();
          } else {
            // 2) 尝试提取 <mxGraphModel> ... </mxGraphModel>，并自动包裹为完整 mxfile
            start = text.search(/<mxGraphModel\b/i);
            end = text.search(/<\/mxGraphModel>/i);
            if (start !== -1 && end !== -1 && end > start) {
              const inner = text.slice(start, end + '</mxGraphModel>'.length).trim();
              text = `<mxfile><diagram name="diagram">${inner}</diagram></mxfile>`;
            } else {
              throw new Error('未检测到有效的 <mxfile> 或 <mxGraphModel> 片段');
            }
          }

          // 如果没有 XML 声明，自动添加
          if (!text.trim().startsWith('<?xml')) {
            text = '<?xml version="1.0" encoding="UTF-8"?>\n' + text;
          }

          return text;
        };

        // XML 清理函数：修复常见的 XML 格式问题
        const cleanDrawioXml = (xmlString) => {
          let cleaned = xmlString;

          // 步骤 1: 移除 XML 声明前的空白字符
          cleaned = cleaned.trim();

          // 步骤 2: 确保有 XML 声明（有助于正确解析）
          if (!cleaned.startsWith('<?xml')) {
            cleaned = '<?xml version="1.0" encoding="UTF-8"?>\n' + cleaned;
          }

          // 步骤 3: 修复属性值中的换行符和制表符（最常见的问题）
          // 使用 /gs 标志支持多行匹配
          cleaned = cleaned.replace(/(\w+)=["']([^"']*?)["']/gs, (match, attrName, attrValue) => {
            let fixedValue = attrValue
              .replace(/[\r\n\t]+/g, ' ')           // 换行和制表符 → 空格
              .replace(/\s{2,}/g, ' ')              // 多个空格 → 单个空格
              .trim();                               // 去除首尾空格

            // 转义属性值中的特殊字符
            fixedValue = fixedValue
              .replace(/&(?!(amp|lt|gt|quot|apos);)/g, '&amp;')  // & → &amp;
              .replace(/</g, '&lt;')                               // < → &lt;
              .replace(/>/g, '&gt;');                              // > → &gt;

            // 检查属性值中是否有未转义的引号
            if (fixedValue.includes('"')) {
              fixedValue = fixedValue.replace(/"/g, '&quot;');
              return `${attrName}='${fixedValue}'`;  // 使用单引号包裹
            }

            return `${attrName}="${fixedValue}"`;
          });

          // 步骤 4: 修复非法的属性名（移除属性名中的非法字符）
          cleaned = cleaned.replace(/([^\s<>="']+)\s*=\s*["']/g, (match, attrName) => {
            // 只保留字母、数字、连字符、下划线、冒号（XML 命名空间）
            const fixedAttrName = attrName.replace(/[^\w:.-]/g, '');
            if (!fixedAttrName) return ''; // 如果属性名被完全移除，删除整个属性
            const quoteChar = match.slice(-1); // 保留原始引号
            return `${fixedAttrName}=${quoteChar}`;
          });

          // 步骤 5: 移除注释中的双连字符（-- 在注释中是非法的）
          cleaned = cleaned.replace(/<!--([\s\S]*?)-->/g, (match, content) => {
            const fixedContent = content.replace(/--/g, '- -');
            return `<!--${fixedContent}-->`;
          });

          // 步骤 6: 修复自闭合标签格式
          cleaned = cleaned.replace(/<(\w+)([^>]*?)\/>/g, (match, tagName, attrs) => {
            // 确保 /> 前有空格
            return `<${tagName}${attrs.trimEnd()} />`;
          });

          return cleaned;
        };

        // XML 验证函数：检查 XML 是否可以被解析
        const validateDrawioXml = (xmlString) => {
          try {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xmlString, 'text/xml');

            // 检查解析错误
            const parserError = xmlDoc.querySelector('parsererror');
            if (parserError) {
              const errorText = parserError.textContent || parserError.innerText || '';
              throw new Error(`XML 解析错误: ${errorText.substring(0, 200)}`);
            }

            // 检查必要的元素
            const mxfile = xmlDoc.querySelector('mxfile');
            if (!mxfile) {
              throw new Error('缺少 <mxfile> 根元素');
            }

            const diagram = mxfile.querySelector('diagram');
            if (!diagram) {
              throw new Error('缺少 <diagram> 元素');
            }

            return true;
          } catch (error) {
            throw new Error(`XML 验证失败: ${error.message}`);
          }
        };

        // 提取原始 XML
        let xml = extractAndFixDrawioXml(assistantResponseContent);

        // 多轮修复策略：尝试不同的修复方法
        const repairStrategies = [
          // 策略 1: 标准清理（处理换行、转义等）
          (xmlStr) => cleanDrawioXml(xmlStr),

          // 策略 2: 激进清理（移除所有属性中的问题字符）
          (xmlStr) => {
            let fixed = cleanDrawioXml(xmlStr);
            // 移除属性值中的所有控制字符
            fixed = fixed.replace(/(\w+)=["']([^"']*?)["']/gs, (match, attrName, attrValue) => {
              const cleanValue = attrValue
                .replace(/[\x00-\x1F\x7F-\x9F]/g, ' ')  // 移除控制字符
                .replace(/\s+/g, ' ')                    // 合并空格
                .trim();
              return `${attrName}="${cleanValue}"`;
            });
            return fixed;
          },

          // 策略 3: 最小化修复（只处理关键问题）
          (xmlStr) => {
            let fixed = xmlStr.trim();
            // 只修复最关键的问题：换行符
            fixed = fixed.replace(/(\w+)=["']([^"']*?)["']/gs, (match, attrName, attrValue) => {
              const cleanValue = attrValue.replace(/[\r\n]+/g, ' ').trim();
              return `${attrName}="${cleanValue}"`;
            });
            return fixed;
          },

          // 策略 4: 结构修复（补全缺失的结束标签）
          (xmlStr) => {
            let fixed = cleanDrawioXml(xmlStr);

            // 检测并补全缺失的结束标签（常见错误：AI 忘记关闭结构标签）
            const requiredEndTags = [
              { start: '<root>', end: '</root>' },
              { start: '<mxGraphModel', end: '</mxGraphModel>' },
              { start: '<diagram', end: '</diagram>' },
              { start: '<mxfile', end: '</mxfile>' }
            ];

            for (const { start, end } of requiredEndTags) {
              // 如果有开始标签但缺少结束标签
              if (fixed.includes(start) && !fixed.includes(end)) {
                console.log(`[Draw.io] 检测到缺失的结束标签: ${end}，尝试自动补全`);
                fixed = fixed + '\n' + end;
              }
            }

            return fixed;
          },

          // 策略 5: 属性错误修复（专门处理 attributes construct error）
          (xmlStr) => {
            let fixed = cleanDrawioXml(xmlStr);

            try {
              // 尝试解析，捕获错误信息
              const parser = new DOMParser();
              const testDoc = parser.parseFromString(fixed, 'text/xml');
              const parserError = testDoc.querySelector('parsererror');

              if (parserError) {
                const errorText = parserError.textContent;
                const lineMatch = errorText.match(/error on line (\d+)/);

                if (lineMatch) {
                  const errorLine = parseInt(lineMatch[1]);
                  console.log(`[Draw.io] 检测到第 ${errorLine} 行有错误，尝试智能修复`);

                  const lines = fixed.split('\n');
                  if (errorLine <= lines.length) {
                    let problematicLine = lines[errorLine - 1];
                    const originalLine = problematicLine;

                    console.log(`[Draw.io] 错误行 ${errorLine} 原始内容:`, problematicLine.substring(0, 150));

                    // 通用属性格式修复策略（按顺序执行）

                    // 1. 修复未闭合的引号（导致后续内容被误认为属性名）
                    // 统计引号数量，如果是奇数则在行尾补上引号
                    const quoteCount = (problematicLine.match(/"/g) || []).length;
                    if (quoteCount % 2 !== 0) {
                      // 找到最后一个 = 的位置，在该值的末尾（下一个空格或 > 之前）补引号
                      problematicLine = problematicLine.replace(/(=")([^"]*?)(\s|>|$)/g, '$1$2"$3');
                    }

                    // 2. 移除属性名中的非法字符（属性名只能包含字母、数字、下划线、冒号、连字符）
                    // 例如：width 220 → width220，然后后续步骤会处理
                    problematicLine = problematicLine.replace(
                      /\s+([a-zA-Z_:][\w:.-]*)\s+=/g,
                      ' $1='
                    );

                    // 3. 修复属性名后直接跟数字的情况（缺少等号和引号）
                    // 例如：width220 → width="220"
                    problematicLine = problematicLine.replace(
                      /\b(width|height|x|y|relative|vertex|edge)(\d+(?:\.\d+)?)/gi,
                      '$1="$2"'
                    );

                    // 4. 修复属性名后跟字母但缺少等号的情况
                    // 例如：as geometry → as="geometry"
                    problematicLine = problematicLine.replace(
                      /\s(as|value|style|id|parent|source|target)\s+([a-zA-Z_][\w.-]*)/g,
                      ' $1="$2"'
                    );

                    // 5. 修复等号后缺少引号的情况
                    // 例如：width=220 → width="220"
                    problematicLine = problematicLine.replace(
                      /\b(width|height|x|y|as|relative|vertex|edge|source|target|parent|id)=([0-9.]+|[a-zA-Z_]\w*)(?!\s*")/g,
                      '$1="$2"'
                    );

                    // 6. 修复 style 属性中缺少值的情况
                    problematicLine = problematicLine.replace(/;(\w+);/g, ';$1=0;');
                    problematicLine = problematicLine.replace(/;(\w+)"/g, ';$1=0"');

                    // 7. 修复多余的分号和空格
                    problematicLine = problematicLine.replace(/;;+/g, ';');
                    problematicLine = problematicLine.replace(/;"/g, '"');
                    problematicLine = problematicLine.replace(/\s+>/g, '>');

                    // 8. 修复重复的等号
                    problematicLine = problematicLine.replace(/="+/g, '="');
                    problematicLine = problematicLine.replace(/=\s*=/g, '=');

                    // 9. 移除孤立的引号（不在属性值内的引号）
                    // 这一步要谨慎，只移除明显错误的引号
                    problematicLine = problematicLine.replace(/"\s+"/g, '');

                    lines[errorLine - 1] = problematicLine;
                    fixed = lines.join('\n');

                    if (originalLine !== problematicLine) {
                      console.log(`[Draw.io] 已修复第 ${errorLine} 行`);
                      console.log(`  修复前:`, originalLine.substring(0, 150));
                      console.log(`  修复后:`, problematicLine.substring(0, 150));
                    } else {
                      console.log(`[Draw.io] 第 ${errorLine} 行无法自动修复，可能需要手动检查`);
                    }
                  }
                }
              }
            } catch (e) {
              console.warn('[Draw.io] 属性错误修复失败:', e.message);
            }

            return fixed;
          },

          // 策略 6: 智能截断修复（定位错误行并尝试移除）
          (xmlStr) => {
            try {
              // 尝试解析，捕获错误信息
              const parser = new DOMParser();
              const testDoc = parser.parseFromString(xmlStr, 'text/xml');
              const parserError = testDoc.querySelector('parsererror');

              if (parserError) {
                const errorText = parserError.textContent;
                // 提取错误行号：error on line 142
                const lineMatch = errorText.match(/error on line (\d+)/);

                if (lineMatch) {
                  const errorLine = parseInt(lineMatch[1]);
                  console.log(`[Draw.io] 检测到第 ${errorLine} 行有错误，尝试智能修复`);

                  // 获取所有行
                  const lines = xmlStr.split('\n');

                  // 如果错误行存在，尝试移除或修复它
                  if (errorLine <= lines.length) {
                    const problematicLine = lines[errorLine - 1];

                    // 如果这一行只是个多余的结束标签，直接移除
                    if (problematicLine.trim().match(/^<\/\w+>$/)) {
                      console.log(`[Draw.io] 移除多余的结束标签: ${problematicLine.trim()}`);
                      lines.splice(errorLine - 1, 1);
                      let fixed = lines.join('\n');

                      // 补全可能缺失的必要结束标签
                      const requiredEndTags = ['</root>', '</mxGraphModel>', '</diagram>', '</mxfile>'];
                      for (const tag of requiredEndTags) {
                        if (!fixed.includes(tag)) {
                          fixed = fixed + '\n' + tag;
                        }
                      }

                      return fixed;
                    }
                  }
                }
              }
            } catch (e) {
              console.warn('[Draw.io] 智能截断修复失败:', e.message);
            }

            // 如果智能修复失败，返回清理后的原始 XML
            return cleanDrawioXml(xmlStr);
          },

          // 策略 7: 使用原始 XML（不做任何处理）
          (xmlStr) => xmlStr
        ];

        let validXml = null;
        let usedStrategy = -1;

        // 依次尝试每个修复策略
        for (let i = 0; i < repairStrategies.length; i++) {
          try {
            const repairedXml = repairStrategies[i](xml);
            validateDrawioXml(repairedXml);
            validXml = repairedXml;
            usedStrategy = i;
            console.log(`[Draw.io] 使用修复策略 ${i + 1} 成功`);
            break;
          } catch (error) {
            console.warn(`[Draw.io] 修复策略 ${i + 1} 失败:`, error.message);
          }
        }

        // 如果所有策略都失败，保存原始 XML 并显示友好的错误信息
        if (!validXml) {
          console.error('[Draw.io] 所有修复策略均失败，保存原始 XML 供手动编辑');

          // 仍然保存原始 XML 到 localStorage（用户可以手动修复）
          window.localStorage.setItem('drawioData_' + docIdForThisMessage, xml);
          console.log('[Draw.io] 原始 XML 已保存到 localStorage (需要手动修复), key:', 'drawioData_' + docIdForThisMessage);

          // 显示友好的错误提示，包含手动编辑选项
          const errorHtml = `
            <div style="background:#fff3cd;border:1px solid #ffc107;border-radius:8px;padding:16px;margin-top:16px;">
              <div style="display:flex;align-items:start;gap:12px;">
                <div style="font-size:24px;">⚠️</div>
                <div style="flex:1;">
                  <div style="font-weight:600;color:#856404;margin-bottom:8px;">配图 XML 需要手动修复</div>
                  <div style="font-size:14px;color:#856404;margin-bottom:12px;">
                    AI 生成的 XML 包含格式错误，自动修复失败。您可以：
                  </div>
                  <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    <button onclick="window.open((window.location.pathname.endsWith('/history_detail.html') ? '../drawio/drawio.html' : 'views/drawio/drawio.html') + '?docId=${encodeURIComponent(docIdForThisMessage)}', '_blank')"
                            style="padding:8px 16px;background:#3b82f6;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;">
                      🛠️ 在编辑器中手动修复
                    </button>
                    <button onclick="navigator.clipboard.writeText(\`${xml.replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`);this.textContent='✓ 已复制'"
                            style="padding:8px 16px;background:#6c757d;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;">
                      📋 复制 XML
                    </button>
                    <button onclick="if(window.ChatbotActions && window.ChatbotActions.deleteMessage) window.ChatbotActions.deleteMessage(${assistantMsgIndex})"
                            style="padding:8px 16px;background:#dc3545;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;">
                      🗑️ 删除此消息
                    </button>
                  </div>
                  <div style="font-size:12px;color:#856404;margin-top:8px;line-height:1.4;">
                    💡 提示：点击"在编辑器中手动修复"可以在左侧文本框中编辑 XML，修复后刷新右侧预览。
                  </div>
                </div>
              </div>
            </div>
          `;

          chatHistory[assistantMsgIndex].content = errorHtml;
          chatHistory[assistantMsgIndex].isDrawioPictures = false; // 不显示成功的卡片
          chatHistory[assistantMsgIndex].isRawHtml = true; // 标记为纯 HTML，不进行 Markdown 解析
          return; // 不抛出错误，避免进入 catch 块
        }

        // 使用修复成功的 XML
        xml = validXml;

        // 🎨 应用布局优化（网格对齐、间距、连接等）
        // 注意：DrawioLite DSL 已在 parser 中优化，这里只处理 AI 直接生成的 XML
        if (!isAlreadyOptimized) {
          try {
            if (window.DrawioLayoutOptimizer && typeof window.DrawioLayoutOptimizer.optimizeDrawioLayout === 'function') {
              console.log('[Draw.io] 🎨 正在应用布局优化（多页支持）...');
              xml = window.DrawioLayoutOptimizer.optimizeDrawioLayout(xml, {
                dagreLayout: true,    // 使用 Dagre 算法（现已支持多页）
                gridAlignment: true,  // 网格对齐
                spacing: false,       // 禁用间距优化（Dagre 已处理）
                connections: true,    // 连接优化
                styles: false         // 不统一样式（保留 AI 的颜色选择）
              });
              console.log('[Draw.io] ✅ 布局优化完成');
            } else {
              console.warn('[Draw.io] 布局优化模块未加载，跳过优化');
            }
          } catch (optimizeError) {
            console.warn('[Draw.io] 布局优化失败，使用原始 XML:', optimizeError);
            // 优化失败不影响主流程，继续使用未优化的 XML
          }
        } else {
          console.log('[Draw.io] ⏭️ 跳过布局优化（DrawioLite 已优化）');
        }

        // 🎓 应用学术增强（Paper Burner 专属：语义配色 + 学术规范）
        // 注意：DrawioLite DSL 已有颜色规范，此处主要针对 AI 直接生成的 XML
        if (!isAlreadyOptimized) {
          try {
            if (window.DrawioAcademicEnhancer && typeof window.DrawioAcademicEnhancer.enhanceAcademicDiagram === 'function') {
              console.log('[Draw.io] 🎓 正在应用学术增强...');
              xml = window.DrawioAcademicEnhancer.enhanceAcademicDiagram(xml, {
                level: 2,           // Level 2: 基础 + 语义配色（默认）
                autoDetect: true    // 自动检测图表类型
              });
              console.log('[Draw.io] ✅ 学术增强完成');
            } else {
              console.warn('[Draw.io] 学术增强模块未加载，跳过增强');
            }
          } catch (enhanceError) {
            console.warn('[Draw.io] 学术增强失败，使用原始 XML:', enhanceError);
            // 增强失败不影响主流程
          }
        } else {
          console.log('[Draw.io] ⏭️ 跳过学术增强（DrawioLite 已含颜色规范）');
        }

        // 存到 localStorage，key 与 mindmap 一致风格
        window.localStorage.setItem('drawioData_' + docIdForThisMessage, xml);
        console.log('[Draw.io] XML 已保存到 localStorage, key:', 'drawioData_' + docIdForThisMessage);

        // 用一个轻量占位内容替换聊天正文，后续由 MessageRenderer 渲染卡片
        chatHistory[assistantMsgIndex].content = '[DRAWIO_XML_EMBED]';
        chatHistory[assistantMsgIndex].isDrawioPictures = true;
      } catch (error) {
        console.error('[Draw.io] XML 处理失败:', error);
        chatHistory[assistantMsgIndex].content += '\n\n<div style="color:#e53e3e;background:#fee;padding:12px;border-radius:6px;margin-top:16px;">⚠️ 配图 XML 处理失败: ' + error.message + '</div>';
        chatHistory[assistantMsgIndex].isDrawioPictures = false;
        chatHistory[assistantMsgIndex].isRawHtml = true; // 标记为纯 HTML，不进行 Markdown 解析
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
          reactLog: chatHistory[assistantMsgIndex].reactLog, // 保存 ReAct 日志
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
    // 与 sendChatbotMessage 对齐：Chatbot 独立配置，可回退到翻译模型配置（单向隔离）
    let selectedModelId = '';
    try {
      // 1. 【最高优先级】Chatbot 专用配置的模型ID
      if (config.cms && config.cms.modelId) {
        selectedModelId = config.cms.modelId;
      }
      // 2. 【回退】翻译模型配置（仅读取）
      if (!selectedModelId && config.settings && config.settings.selectedCustomModelId) {
        selectedModelId = config.settings.selectedCustomModelId;
      }
      // 3. 【进一步回退】可用模型列表的第一个
      if (!selectedModelId && Array.isArray(config.siteSpecificAvailableModels) && config.siteSpecificAvailableModels.length > 0) {
        selectedModelId = typeof config.siteSpecificAvailableModels[0] === 'object' ? config.siteSpecificAvailableModels[0].id : config.siteSpecificAvailableModels[0];
      }
    } catch (e) {
      console.error('[Chatbot/Summary] 获取模型ID失败:', e);
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
          const ttlRaw = config?.cms?.promptCachingTtl ?? config?.cms?.promptCachingTTL ?? config?.settings?.promptCachingTtl ?? config?.settings?.promptCachingTTL;
          const ttl = ttlRaw === '5m' || ttlRaw === '1h' ? ttlRaw : null;
          const addCacheBreakpoint = (blocks) => {
            const list = Array.isArray(blocks) ? blocks : [];
            for (let i = list.length - 1; i >= 0; i--) {
              const block = list[i];
              if (!block || typeof block !== 'object') continue;
              if (block.type !== 'text') continue;
              block.cache_control = ttl ? { type: 'ephemeral', ttl } : { type: 'ephemeral' };
              return true;
            }
            return false;
          };

          const systemBlocks = sys ? [{ type: 'text', text: sys }] : [];
          const history = Array.isArray(msgs)
            ? msgs
                .map(m => {
                  if (!m || typeof m !== 'object') return null;
                  if (m.role === 'system') {
                    return { role: 'user', content: [{ type: 'text', text: String(m.content ?? '') }] };
                  }
                  const role = m.role === 'assistant' ? 'assistant' : 'user';
                  return { role, content: convertOpenAIToAnthropicContent(m.content) };
                })
                .filter(Boolean)
            : [];

          // Prompt caching: cache stable prefix (system + prior conversation history), exclude final user message.
          if (history.length > 0) addCacheBreakpoint(history[history.length - 1]?.content);
          else if (systemBlocks.length > 0) addCacheBreakpoint(systemBlocks);

          return {
            model: apiConfig.modelName || 'claude-3-sonnet-20240229',
            ...(systemBlocks.length ? { system: systemBlocks } : {}),
            messages: history.length
              ? [...history, { role: 'user', content: convertOpenAIToAnthropicContent(user_content) }]
              : [{ role: 'user', content: convertOpenAIToAnthropicContent(user_content) }],
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
