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
    let systemPrompt = `你现在是 PDF 文档智能助手，用户正在查看文档\"${docContentInfo.name || '当前文档'}\"。\n你的回答应该：\n1. 基于PDF文档内容\n2. 简洁清晰\n3. 学术准确`;

    // Check plainTextInput if isMindMapRequest is not explicitly true (e.g. from a direct call)
    const actuallyIsMindMapRequest = isMindMapRequest || (plainTextInput && (plainTextInput.includes('思维导图') || plainTextInput.includes('脑图')));

    if (actuallyIsMindMapRequest) {
      systemPrompt += `\n\n请注意：用户请求生成思维导图。请按照以下Markdown格式返回思维导图结构：
# 文档主题（根节点）
## 一级主题1
### 二级主题1.1
### 二级主题1.2
## 一级主题2
### 二级主题2.1
#### 三级主题2.1.1

只需提供思维导图的结构，不要添加额外的解释。结构应该清晰反映文档的层次关系和主要内容。`;
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

    if (content.length > 50000) {
      content = content.slice(0, 50000);
    }

    if (content) { // Only add "文档内容" section if content is not empty
      systemPrompt += `\n\n文档内容：\n${content}`;
    }
    // console.log('[PromptConstructor.buildSystemPrompt] Final systemPrompt:', systemPrompt);
    return systemPrompt;
  }

  // Future functions for more complex context management can be added here.
  // For example:
  // function buildContextualizedUserInput(userInput, interestPoints, memory) { ... }
  // function manageConversationHistory(history, contextPolicy) { ... }

  return {
    buildSystemPrompt,
    // expose other functions as needed
  };

})();