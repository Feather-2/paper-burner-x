// chatbot-core.js
// 主入口模块 - 整合所有子模块并导出统一接口

// =============== 全局状态 ===============
let chatHistory = [];
let isChatbotLoading = false;

// 包装 isChatbotLoading 为引用对象，以便传递给子模块
const isChatbotLoadingRef = {
  get value() { return isChatbotLoading; },
  set value(v) { isChatbotLoading = v; }
};

// =============== 从各模块导入函数 ===============

// API 配置构建模块
const buildCustomApiConfig = window.ApiConfigBuilder?.buildCustomApiConfig;

// 聊天历史管理模块
const saveChatHistory = window.ChatHistoryManager?.saveChatHistory;
const loadChatHistory = window.ChatHistoryManager?.loadChatHistory;
const clearChatHistory = window.ChatHistoryManager?.clearChatHistory;
const reloadChatHistoryAndUpdateUI = window.ChatHistoryManager?.reloadChatHistoryAndUpdateUI;
const clearCurrentDocChatHistory = window.ChatHistoryManager?.clearCurrentDocChatHistory;
const deleteMessageFromHistory = window.ChatHistoryManager?.deleteMessageFromHistory;

// 内容处理模块
const getCurrentDocContent = window.ContentProcessor?.getCurrentDocContent;
const buildChatMessages = window.ContentProcessor?.buildChatMessages;
const splitContentSmart = window.ContentProcessor?.splitContentSmart;
const getCurrentDocId = window.ContentProcessor?.getCurrentDocId;
const attachSelectedContextToDoc = window.ContentProcessor?.attachSelectedContextToDoc;
const buildFallbackSemanticContext = window.ContentProcessor?.buildFallbackSemanticContext;

// 语义意群管理模块
const showMultiHopConfigDialog = window.SemanticGroupsManager?.showMultiHopConfigDialog;
const ensureIndexesBuilt = window.SemanticGroupsManager?.ensureIndexesBuilt;

// 消息发送模块
const getChatbotConfig = window.MessageSender?.getChatbotConfig;
const singleChunkSummary = window.MessageSender?.singleChunkSummary;

// =============== 包装函数 ===============

/**
 * 包装 ensureSemanticGroupsReady，注入依赖
 */
async function ensureSemanticGroupsReady(docContentInfo) {
  if (!window.SemanticGroupsManager?.ensureSemanticGroupsReady) {
    console.warn('[ChatbotCore] SemanticGroupsManager.ensureSemanticGroupsReady not loaded');
    return;
  }
  return window.SemanticGroupsManager.ensureSemanticGroupsReady(
    docContentInfo,
    getCurrentDocId,
    getChatbotConfig,
    singleChunkSummary
  );
}

/**
 * 包装 sendChatbotMessage，注入依赖
 */
async function sendChatbotMessage(userInput, updateChatbotUI, externalConfig = null, displayUserInput = null) {
  if (!window.MessageSender?.sendChatbotMessage) {
    console.error('[ChatbotCore] MessageSender.sendChatbotMessage not loaded');
    return;
  }
  return window.MessageSender.sendChatbotMessage(
    userInput,
    updateChatbotUI,
    externalConfig,
    displayUserInput,
    chatHistory,
    isChatbotLoadingRef,
    getCurrentDocId,
    getCurrentDocContent,
    saveChatHistory,
    ensureSemanticGroupsReady
  );
}

/**
 * 包装 reloadChatHistoryAndUpdateUI，注入依赖
 */
function reloadChatHistoryAndUpdateUIWrapper(updateChatbotUI) {
  if (!window.ChatHistoryManager?.reloadChatHistoryAndUpdateUI) {
    console.warn('[ChatbotCore] ChatHistoryManager.reloadChatHistoryAndUpdateUI not loaded');
    return;
  }
  return reloadChatHistoryAndUpdateUI(updateChatbotUI, getCurrentDocId, chatHistory);
}

/**
 * 包装 clearCurrentDocChatHistory，注入依赖
 */
function clearCurrentDocChatHistoryWrapper(updateChatbotUI) {
  if (!window.ChatHistoryManager?.clearCurrentDocChatHistory) {
    console.warn('[ChatbotCore] ChatHistoryManager.clearCurrentDocChatHistory not loaded');
    return;
  }
  return clearCurrentDocChatHistory(updateChatbotUI, getCurrentDocId, chatHistory);
}

/**
 * 包装 deleteMessageFromHistory，注入依赖
 */
function deleteMessageFromHistoryWrapper(docId, index, updateUIAfterDelete) {
  if (!window.ChatHistoryManager?.deleteMessageFromHistory) {
    console.warn('[ChatbotCore] ChatHistoryManager.deleteMessageFromHistory not loaded');
    return;
  }
  return deleteMessageFromHistory(docId, index, updateUIAfterDelete, chatHistory);
}

// 导出核心对象
window.ChatbotCore = {
  chatHistory,
  get isChatbotLoading() { return isChatbotLoading; },
  set isChatbotLoading(v) { isChatbotLoading = v; },
  getChatbotConfig,
  getCurrentDocContent,
  buildChatMessages,
  sendChatbotMessage,
  saveChatHistory,
  loadChatHistory,
  clearChatHistory,
  clearCurrentDocChatHistory: clearCurrentDocChatHistoryWrapper,
  deleteMessageFromHistory: deleteMessageFromHistoryWrapper,
  getCurrentDocId,
  reloadChatHistoryAndUpdateUI: reloadChatHistoryAndUpdateUIWrapper,
  // 导出给意群聚合模块使用的单轮摘要工具
  singleChunkSummary,
  // 导出内容处理工具
  splitContentSmart,
  attachSelectedContextToDoc,
  buildFallbackSemanticContext,
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
