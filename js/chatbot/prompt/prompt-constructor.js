/**
 * @file Manages the construction of prompts and message payloads for the chatbot.
 */

window.PromptConstructor = (function() {

  /**
   * Builds the system prompt string based on document information and request type.
   * @param {object} docContentInfo - Object containing document details (name, ocr, translation).
   * @param {boolean} isMindMapRequest - Flag indicating if the request is for a mind map.
   * @param {string} plainTextInput - The user's plain text input (used to check for mind map keywords if isMindMapRequest is not directly passed).
   * @returns {string} The constructed system prompt.
   */
  function buildSystemPrompt(docContentInfo, isMindMapRequest, plainTextInput) {
    // 使用 ChatbotPreset 中的基础系统提示词
    let basePrompt = window.ChatbotPreset && window.ChatbotPreset.BASE_SYSTEM_PROMPT
      ? window.ChatbotPreset.BASE_SYSTEM_PROMPT
      : `你现在是 PDF 文档智能助手，用户正在查看文档"{docName}"。\n你的回答应该：\n1. 基于PDF文档内容\n2. 简洁清晰\n3. 学术准确`;

    // 替换文档名称占位符
    let systemPrompt = basePrompt.replace('{docName}', docContentInfo.name || '当前文档');

    // 检查是否是思维导图请求
    let actuallyIsMindMapRequest = isMindMapRequest;

    // 如果未明确指定是思维导图请求，则检查输入文本中是否包含相关关键词
    if (!actuallyIsMindMapRequest && window.ChatbotPreset && typeof window.ChatbotPreset.isMindMapRequest === 'function') {
      actuallyIsMindMapRequest = window.ChatbotPreset.isMindMapRequest(plainTextInput);
    } else if (!actuallyIsMindMapRequest && plainTextInput) {
      // 后备逻辑：如果 ChatbotPreset 不可用，使用内置检测
      actuallyIsMindMapRequest = plainTextInput.includes('思维导图') || plainTextInput.includes('脑图');
    }

    // 添加思维导图提示
    if (actuallyIsMindMapRequest) {
      const mindMapPrompt = window.ChatbotPreset && window.ChatbotPreset.MINDMAP_PROMPT
        ? window.ChatbotPreset.MINDMAP_PROMPT
        : `\n\n请注意：用户请求生成思维导图。请按照以下Markdown格式返回思维导图结构：
# 文档主题（根节点）
## 一级主题1
### 二级主题1.1
### 二级主题1.2
## 一级主题2
### 二级主题2.1
#### 三级主题2.1.1

只需提供思维导图的结构，不要添加额外的解释。结构应该清晰反映文档的层次关系和主要内容。`;

      systemPrompt += mindMapPrompt;
    }

    // 获取文档内容（优先翻译，没有就用OCR）
    let content = '';
    // Read the active summary source from global options, default to 'translation'
    const activeSummarySource = (window.chatbotActiveOptions && window.chatbotActiveOptions.summarySource) || 'translation';

    if (activeSummarySource === 'translation') {
      content = docContentInfo.translation || docContentInfo.ocr || '';
      // console.log('[PromptConstructor] Using translation or fallback to OCR for content.');
    } else if (activeSummarySource === 'ocr') {
      content = docContentInfo.ocr || docContentInfo.translation || '';
      // console.log('[PromptConstructor] Using OCR or fallback to translation for content.');
    } else if (activeSummarySource === 'none') {
      content = ''; // Explicitly no content from document
      // console.log('[PromptConstructor] Content source is NONE. No document content will be used.');
    }

    // ===== 新增：智能分段策略 =====
    // 检查是否启用智能分段模式（contentLengthStrategy === 'segmented'）
    const contentStrategy = (window.chatbotActiveOptions && window.chatbotActiveOptions.contentLengthStrategy) || 'default';

    if (contentStrategy === 'segmented' && content.length >= 50000) {
      // 智能分段模式：使用意群摘要
      console.log('[PromptConstructor] 文档较长且启用智能分段，使用意群模式');

      if (docContentInfo.semanticGroups && docContentInfo.semanticGroups.length > 0) {
        // 已有意群，构建意群摘要
        const docGist = (docContentInfo.semanticDocGist && typeof docContentInfo.semanticDocGist === 'string')
          ? `文档总览：${docContentInfo.semanticDocGist}\n\n` : '';
        if (docContentInfo.selectedGroupContext) {
          // 多轮取材：已选择意群上下文，优先提供所选上下文
          content = `${docGist}已根据用户问题聚焦以下意群上下文：\n\n${docContentInfo.selectedGroupContext}\n\n如需更多细节，可继续请求深入具体意群。`;
          console.log('[PromptConstructor] 使用已选择意群上下文模式');
        } else {
          const groupSummaries = docContentInfo.semanticGroups.map((group, idx) => {
            return `【意群${idx + 1}】${group.summary}\n关键词: ${(group.keywords || []).join(', ')}`;
          }).join('\n\n');
          content = `${docGist}文档已分为 ${docContentInfo.semanticGroups.length} 个意群，以下是各意群概要：\n\n${groupSummaries}\n\n如需深入了解某个意群，请明确指出。`;
          console.log('[PromptConstructor] 使用意群摘要模式，共', docContentInfo.semanticGroups.length, '个意群');
        }
      } else {
        // 未生成意群，降级到截断
        console.warn('[PromptConstructor] 启用了分段模式但未找到意群数据，降级到截断模式');
        if (content.length > 50000) {
          content = content.slice(0, 50000) + '\n\n[文档过长，已截断]';
        }
      }
    } else {
      // 全文模式：传统截断
      if (content.length > 50000) {
        content = content.slice(0, 50000);
      }
    }

    if (content) { // Only add "文档内容" section if content is not empty
      systemPrompt += `\n\n文档内容：\n${content}`;
    }
    // 追加回答行为规范，避免模型输出“没有外部工具”等无关免责声明
    systemPrompt += `\n\n回答规则补充：\n- 不要声明你是否具备外部工具/联网等能力，也不要输出与回答无关的免责声明。\n- 优先依据文档内容回答；若文档信息不足，请基于常识给出概览性解答并明确不确定之处。`;
    // console.log('[PromptConstructor.buildSystemPrompt] Final systemPrompt:', systemPrompt);
    return systemPrompt;
  }

  /**
   * 增强用户输入的提示词
   * 整合各种提示词增强逻辑，目前主要处理流程图提示词
   *
   * @param {string|Array} userInput - 用户输入，可能是字符串或多模态消息数组
   * @returns {string|Array} - 增强后的用户输入
   */
  function enhanceUserPrompt(userInput) {
    // 如果ChatbotPreset已加载并提供了enhanceUserPrompt函数，则使用它
    if (window.ChatbotPreset && typeof window.ChatbotPreset.enhanceUserPrompt === 'function') {
      return window.ChatbotPreset.enhanceUserPrompt(userInput);
    }

    // 如果没有 ChatbotPreset 或其函数不可用，则返回原始输入
    return userInput;
  }

  /**
   * 构建完整的消息负载
   * 处理系统提示词和用户输入增强
   *
   * @param {object} docContentInfo - 文档内容信息对象
   * @param {string|Array} userInput - 用户输入
   * @param {object} options - 额外选项
   * @returns {object} 包含系统提示词和增强用户输入的消息负载
   */
  function buildMessagePayload(docContentInfo, userInput, options = {}) {
    const { isMindMapRequest } = options;

    // 获取原始的文本输入(用于系统提示词中检测思维导图关键词)
    let plainTextInput = '';
    if (typeof userInput === 'string') {
      plainTextInput = userInput;
    } else if (Array.isArray(userInput)) {
      const textPart = userInput.find(p => p.type === 'text');
      plainTextInput = textPart ? textPart.text : '';
    }

    // 构建系统提示词
    const systemPrompt = buildSystemPrompt(docContentInfo, isMindMapRequest, plainTextInput);

    // 增强用户输入
    const enhancedUserInput = enhanceUserPrompt(userInput);

    return {
      systemPrompt,
      userInput: enhancedUserInput
    };
  }

  // Future functions for more complex context management can be added here.
  // For example:
  // function buildContextualizedUserInput(userInput, interestPoints, memory) { ... }
  // function manageConversationHistory(history, contextPolicy) { ... }

  return {
    buildSystemPrompt,
    enhanceUserPrompt,
    buildMessagePayload
    // expose other functions as needed
  };

})();
