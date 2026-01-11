// chat-history-manager.js
// 聊天历史管理模块 - 支持前端 localStorage 和后端 API 双模式

(function() {
  'use strict';

  // =============== 存储模式检测 ===============

  /**
   * 判断是否为后端模式
   * @returns {boolean}
   */
  function isBackendMode() {
    return window.storageAdapter && window.storageAdapter.isFrontendMode === false;
  }

  function getDomPurify() {
    const purifier = globalThis.DOMPurify || globalThis.window?.DOMPurify;
    return purifier && typeof purifier.sanitize === 'function' ? purifier : null;
  }

  function sanitizeHtmlFragment(html, options = null) {
    const raw = String(html ?? '');
    if (!raw) return '';
    const purifier = getDomPurify();
    if (!purifier) {
      return raw
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/\bon\w+\s*=/gi, 'data-removed-handler=');
    }
    try {
      return purifier.sanitize(raw, {
        SAFE_FOR_TEMPLATES: true,
        KEEP_CONTENT: true,
        ALLOW_DATA_ATTR: true,
        ...(options || {})
      });
    } catch {
      return raw;
    }
  }

  // =============== 对话历史持久化 ===============

  /**
   * 保存当前文档的聊天历史
   * @param {string} docId
   * @param {Array} history
   */
  async function saveChatHistory(docId, history) {
    try {
      if (isBackendMode()) {
        // 后端模式：使用 API
        // 注意：为避免频繁请求，这里只是在内存中更新
        // 真正的保存发生在每条消息添加时（saveSingleMessage）
        // 或者在清空历史时
        console.log(`[saveChatHistory] Backend mode - history tracked in memory`);
      } else {
        // 前端模式：localStorage
        localStorage.setItem('chatHistory_' + docId, JSON.stringify(history));
      }
    } catch (e) {
      console.error('[saveChatHistory] Error saving chat history:', e);
    }
  }

  /**
   * 保存单条聊天消息（优化版，用于后端模式）
   * @param {string} docId
   * @param {Object} message - { role, content, metadata }
   */
  async function saveSingleMessage(docId, message) {
    if (!isBackendMode()) {
      // 前端模式不需要单独保存，使用 saveChatHistory 即可
      return;
    }

    try {
      await window.storageAdapter.saveChatMessage(docId, {
        role: message.role,
        content: message.content,
        metadata: message.metadata || {}
      });
    } catch (e) {
      console.error('[saveSingleMessage] Error saving message to backend:', e);
    }
  }

  /**
   * 加载当前文档的聊天历史
   * @param {string} docId
   * @returns {Promise<Array>}
   */
  async function loadChatHistory(docId) {
    try {
      let history = [];

      if (isBackendMode()) {
        // 后端模式：从 API 加载
        history = await window.storageAdapter.loadChatHistory(docId);
      } else {
        // 前端模式：localStorage
        const raw = localStorage.getItem('chatHistory_' + docId);
        if (raw) {
          history = JSON.parse(raw);
        }
      }

      // 清理可能包含未正确格式化的toolCallHtml（修复旧版本的兼容性问题）
      history.forEach(msg => {
        if (msg.toolCallHtml && typeof msg.toolCallHtml === 'string') {
          const rawToolCallHtml = msg.toolCallHtml;
          // 检查是否包含超大的未格式化JSON数据（可能导致显示问题）
          const hasLargeJsonData = rawToolCallHtml.includes('tool-step-detail">{') &&
                                   rawToolCallHtml.length > 10000;

          // 检查是否有HTML结构被破坏的迹象（如不匹配的div标签）
          const openDivs = (rawToolCallHtml.match(/<div/g) || []).length;
          const closeDivs = (rawToolCallHtml.match(/<\/div>/g) || []).length;
          const structureBroken = Math.abs(openDivs - closeDivs) > 2;

          if (hasLargeJsonData || structureBroken) {
            console.warn('[loadChatHistory] 检测到有问题的toolCallHtml，已清除', {
              hasLargeJsonData,
              structureBroken,
              length: rawToolCallHtml.length
            });
            delete msg.toolCallHtml;
            return;
          }

          // 安全处理：防止历史记录中的 HTML 注入
          msg.toolCallHtml = sanitizeHtmlFragment(rawToolCallHtml);
        }
      });

      return history;
    } catch (e) {
      console.error('[loadChatHistory] Error loading chat history:', e);
      return [];
    }
  }

  /**
   * 清空当前文档的聊天历史
   * @param {string} docId
   */
  async function clearChatHistory(docId) {
    try {
      if (isBackendMode()) {
        // 后端模式：调用 API 清空
        await window.storageAdapter.clearChatHistory(docId);
      } else {
        // 前端模式：清空 localStorage
        localStorage.removeItem('chatHistory_' + docId);
      }
    } catch (e) {
      console.error('[clearChatHistory] Error clearing chat history:', e);
    }
  }

  /**
   * 重新加载当前文档的聊天历史，并刷新UI
   * @param {function} updateChatbotUI
   * @param {function} getCurrentDocId - 获取当前文档ID的函数
   * @param {Array} chatHistory - 聊天历史数组的引用
   */
  async function reloadChatHistoryAndUpdateUI(updateChatbotUI, getCurrentDocId, chatHistory) {
    const docId = getCurrentDocId();
    const loaded = await loadChatHistory(docId);
    chatHistory.length = 0;
    loaded.forEach(m => chatHistory.push(m));
    if (typeof updateChatbotUI === 'function') updateChatbotUI();
  }

  /**
   * 清空当前文档的聊天历史（内存和存储），并刷新UI
   * @param {function} updateChatbotUI - 更新UI的回调函数
   * @param {function} getCurrentDocId - 获取当前文档ID的函数
   * @param {Array} chatHistory - 聊天历史数组的引用
   */
  async function clearCurrentDocChatHistory(updateChatbotUI, getCurrentDocId, chatHistory) {
    const docId = getCurrentDocId();
    chatHistory.length = 0; // 清空内存中的历史
    await clearChatHistory(docId); // 清除存储
    console.log(`Chat history for docId '${docId}' cleared.`);
    if (typeof updateChatbotUI === 'function') {
      updateChatbotUI(); // 刷新UI
    }
  }

  /**
   * 删除指定索引的聊天消息
   * @param {string} docId 当前文档的ID
   * @param {number} index 要删除消息的索引
   * @param {function} updateUIAfterDelete 删除后更新UI的回调函数
   * @param {Array} chatHistory - 聊天历史数组的引用
   */
  async function deleteMessageFromHistory(docId, index, updateUIAfterDelete, chatHistory) {
    if (index >= 0 && index < chatHistory.length) {
      chatHistory.splice(index, 1); // 从数组中移除消息

      if (isBackendMode()) {
        // 后端模式：重新同步整个历史（简化实现）
        // TODO: 可优化为删除单条 API
        await clearChatHistory(docId);
        for (const msg of chatHistory) {
          await saveSingleMessage(docId, msg);
        }
      } else {
        // 前端模式：保存到 localStorage
        await saveChatHistory(docId, chatHistory);
      }

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
    saveSingleMessage, // 新增：用于后端模式逐条保存
    loadChatHistory,
    clearChatHistory,
    reloadChatHistoryAndUpdateUI,
    clearCurrentDocChatHistory,
    deleteMessageFromHistory
  };

})();

// ESM 导出
