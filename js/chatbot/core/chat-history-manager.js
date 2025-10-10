// chat-history-manager.js
// 聊天历史管理模块

(function() {
  'use strict';

  // =============== 对话历史持久化 ===============

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
      if (raw) {
        const history = JSON.parse(raw);
        // 清理可能包含未正确格式化的toolCallHtml（修复旧版本的兼容性问题）
        history.forEach(msg => {
          if (msg.toolCallHtml && typeof msg.toolCallHtml === 'string') {
            // 检查是否包含超大的未格式化JSON数据（可能导致显示问题）
            // 如果toolCallHtml中包含大量JSON数据且没有被格式化为摘要，则清除
            const hasLargeJsonData = msg.toolCallHtml.includes('tool-step-detail">{') &&
                                     msg.toolCallHtml.length > 10000;

            // 检查是否有HTML结构被破坏的迹象（如不匹配的div标签）
            const openDivs = (msg.toolCallHtml.match(/<div/g) || []).length;
            const closeDivs = (msg.toolCallHtml.match(/<\/div>/g) || []).length;
            const structureBroken = Math.abs(openDivs - closeDivs) > 2;

            if (hasLargeJsonData || structureBroken) {
              console.warn('[loadChatHistory] 检测到有问题的toolCallHtml，已清除', {
                hasLargeJsonData,
                structureBroken,
                length: msg.toolCallHtml.length
              });
              delete msg.toolCallHtml;
            }
          }
        });
        return history;
      }
    } catch (e) {
      console.error('[loadChatHistory] Error loading chat history:', e);
    }
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
   * @param {function} getCurrentDocId - 获取当前文档ID的函数
   * @param {Array} chatHistory - 聊天历史数组的引用
   */
  function reloadChatHistoryAndUpdateUI(updateChatbotUI, getCurrentDocId, chatHistory) {
    const docId = getCurrentDocId();
    const loaded = loadChatHistory(docId);
    chatHistory.length = 0;
    loaded.forEach(m => chatHistory.push(m));
    if (typeof updateChatbotUI === 'function') updateChatbotUI();
  }

  /**
   * 清空当前文档的聊天历史（内存和localStorage），并刷新UI
   * @param {function} updateChatbotUI - 更新UI的回调函数
   * @param {function} getCurrentDocId - 获取当前文档ID的函数
   * @param {Array} chatHistory - 聊天历史数组的引用
   */
  function clearCurrentDocChatHistory(updateChatbotUI, getCurrentDocId, chatHistory) {
    const docId = getCurrentDocId();
    chatHistory.length = 0; // 清空内存中的历史
    clearChatHistory(docId); // 从 localStorage 清除
    console.log(`Chat history for docId '${docId}' cleared.`);
    if (typeof updateChatbotUI === 'function') {
      updateChatbotUI(); // 刷新UI
    }
  }

  /**
   * 删除指定索引的聊天消息。
   * @param {string} docId 当前文档的ID。
   * @param {number} index 要删除消息的索引。
   * @param {function} updateUIAfterDelete 删除后更新UI的回调函数。
   * @param {Array} chatHistory - 聊天历史数组的引用
   */
  function deleteMessageFromHistory(docId, index, updateUIAfterDelete, chatHistory) {
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

  // 导出
  window.ChatHistoryManager = {
    saveChatHistory,
    loadChatHistory,
    clearChatHistory,
    reloadChatHistoryAndUpdateUI,
    clearCurrentDocChatHistory,
    deleteMessageFromHistory
  };

})();
