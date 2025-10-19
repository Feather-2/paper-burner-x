// js/chatbot/chatbot-actions.js

window.ChatbotActions = {
  /**
   * 删除指定索引的消息。
   * @param {number} index - 要删除消息的索引。
   */
  deleteMessage: function(index) {
    if (confirm('确定要删除这条消息吗？此操作无法撤销。')) {
      if (window.ChatbotCore && typeof window.ChatbotCore.deleteMessageFromHistory === 'function' && typeof window.ChatbotCore.getCurrentDocId === 'function') {
        const docId = window.ChatbotCore.getCurrentDocId();
        window.ChatbotCore.deleteMessageFromHistory(docId, index, window.ChatbotUI.updateChatbotUI);
      } else {
        console.error('ChatbotActions: ChatbotCore.deleteMessageFromHistory or ChatbotCore.getCurrentDocId function is not defined.');
        alert('删除消息的功能暂未完全配置，请联系管理员。');
      }
    }
  },

  /**
   * 重新发送指定索引的用户消息。
   * 将删除此消息之后的所有历史记录，然后重新发送此消息。
   * @param {number} index - 要重发消息的索引。
   */
  resendUserMessage: function(index) {
    if (!window.ChatbotCore || !window.ChatbotCore.chatHistory || !window.ChatbotCore.chatHistory[index] || typeof window.ChatbotCore.getCurrentDocId !== 'function' || typeof window.ChatbotCore.saveChatHistory !== 'function') {
      console.error('ChatbotActions: Cannot resend message, core functions or history/message index is invalid.');
      alert('无法重发消息，核心功能或聊天记录无效。');
      return;
    }

    const docId = window.ChatbotCore.getCurrentDocId();
    const messageToResend = { ...window.ChatbotCore.chatHistory[index] }; // 浅拷贝以防意外修改

    if (messageToResend.role !== 'user') {
      alert('只能重发您发送的消息。');
      return;
    }

    let textContent = '';
    let hasNonTextContent = false;
    let originalUserMessageParts = []; // 用于重新发送

    if (Array.isArray(messageToResend.content)) {
      originalUserMessageParts = messageToResend.content.map(part => ({ ...part })); // 深拷贝parts
      const textPart = originalUserMessageParts.find(part => part.type === 'text');
      if (textPart) {
        textContent = textPart.text;
      }
      if (originalUserMessageParts.some(part => part.type === 'image_url')) {
        hasNonTextContent = true;
      }
    } else if (typeof messageToResend.content === 'string') {
      textContent = messageToResend.content;
      originalUserMessageParts = [{ type: 'text', text: textContent }];
    }

    if (hasNonTextContent && textContent) {
      if (!confirm('此消息包含图片。目前重发功能仅支持文本部分。是否继续重发文本内容？（此操作将删除后续所有对话）')) {
        return;
      }
      // 如果用户确认，我们只重发文本部分
      originalUserMessageParts = [{ type: 'text', text: textContent }];
    } else if (hasNonTextContent && !textContent) {
      alert('此消息仅包含图片，目前无法直接重发。请尝试重新上传图片并输入文本。');
      return;
    } else {
      // 纯文本消息，或用户已确认仅重发文本
      if (!confirm('确定要重发这条消息吗？此操作将删除该消息之后的所有对话记录。')) {
        return;
      }
    }

    if (!textContent.trim() && !hasNonTextContent) { // 如果清除了图片后没有文本了
        alert('没有可重发的文本内容。');
        return;
    }


    // 删除此消息之后的所有历史记录
    if (index < window.ChatbotCore.chatHistory.length -1) { // 确保不是最后一条消息
        window.ChatbotCore.chatHistory.splice(index + 1);
    }
    // 注意：此时 messageToResend 自身还在 chatHistory 中，我们会在 sendChatbotMessage 前将其移除，或者 sendChatbotMessage 内部会处理好上下文。
    // 为了简化，我们先从历史记录中移除旧的这条，sendChatbotMessage 会重新添加它。
    window.ChatbotCore.chatHistory.splice(index, 1);


    // 更新并保存被截断的历史记录
    window.ChatbotCore.saveChatHistory(docId, window.ChatbotCore.chatHistory);
    window.ChatbotUI.updateChatbotUI(); // 更新UI以反映历史记录的变化


    // 清空当前输入框（如果用户正在输入）
    const inputField = document.getElementById('chatbot-input');
    if (inputField) inputField.value = '';

    // 清空已选图片 (因为我们只重发提取的文本或原始消息的图片)
    if (window.ChatbotImageUtils) {
        window.ChatbotImageUtils.selectedChatbotImages = [];
        window.ChatbotImageUtils.updateSelectedImagesPreview();
    }

    // 准备发送内容，可以是字符串或数组
    let sendVal = originalUserMessageParts.length === 1 && originalUserMessageParts[0].type === 'text'
                  ? originalUserMessageParts[0].text
                  : originalUserMessageParts;
    let displayVal = sendVal; // 简单起见，让显示值和发送值一致

    if (window.PromptConstructor && typeof window.PromptConstructor.enhanceUserPrompt === 'function') {
      sendVal = window.PromptConstructor.enhanceUserPrompt(sendVal);
    }

    // 确保 ChatbotCore.sendChatbotMessage 的参数和行为
    // 第三个参数是 onComplete (通常是null), 第四个是 displayVal
    window.ChatbotCore.sendChatbotMessage(sendVal, window.ChatbotUI.updateChatbotUI, null, displayVal);
  }
};