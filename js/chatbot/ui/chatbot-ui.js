// chatbot-ui.js

/**
 * 全局函数，强制聊天机器人界面弹出（或切换到）模型选择器。
 *
 * 主要逻辑：
 * 1. 设置 `window.isModelSelectorOpen = true`。
 * 2. 调用 `ChatbotUI.updateChatbotUI()` 刷新界面以显示模型选择器。
 */
window.showModelSelectorForChatbot = function() {
  window.isModelSelectorOpen = true;
  if (typeof window.ChatbotUI === 'object' && typeof window.ChatbotUI.updateChatbotUI === 'function') {
    window.ChatbotUI.updateChatbotUI();
  }
};

// 全局状态变量
window.isChatbotPositionedLeft = localStorage.getItem('chatbotPosition') === 'left' || false;
window.isPresetQuestionsCollapsed = false; // 预设问题默认展开
window.presetAutoCollapseTriggeredForDoc = {}; // 记录文档是否已触发自动收起

// 全屏和宽度管理状态
window.isChatbotFullscreen = localStorage.getItem('chatbotFullscreen') === 'true' || false;
window.forceChatbotWidthReset = false; // 是否强制重置聊天窗口宽度
window.lastIsChunkCompareActive = undefined; // 上一次 Chunk Compare 标签页的激活状态
window.chatbotInitialLoad = true; // 是否为首次加载

// 浮动模式状态
window.isChatbotFloating = localStorage.getItem('chatbotFloating') === 'true' || false;
window.chatbotFloatingPosition = JSON.parse(localStorage.getItem('chatbotFloatingPosition') || '{"x": 100, "y": 100}');
window.chatbotFloatingSize = JSON.parse(localStorage.getItem('chatbotFloatingSize') || '{"width": 420, "height": 580}');

// 高级聊天功能选项
window.chatbotActiveOptions = {
  useContext: true, // 是否使用上下文
  enableSemanticFeatures: true, // 是否启用意群和向量搜索功能（默认开启）
  multiHopRetrieval: false, // 是否启用多轮取材（先选片段再回答）
  contentLengthStrategy: 'default', // 内容长度策略: 'default', 'segmented'
  summarySource: 'ocr',   // 总结来源: 'ocr', 'none', 'translation'
  interestPointsActive: false,    // 兴趣点功能 (占位)
  memoryManagementActive: false   // 记忆管理功能 (占位)
};

/**
 * 处理暂停对话按钮的点击事件。
 *
 * 主要逻辑：
 * 1. 调用中止控制器来停止正在进行的请求。
 * 2. 更新UI状态。
 */
function handleChatbotStop() {
  if (window.chatbotAbortController) {
    window.chatbotAbortController.abort();
    console.log('[Chatbot] 用户中止了对话');
  }
}

/**
 * 处理聊天机器人发送按钮的点击事件。
 *
 * 主要逻辑：
 * 1. 获取输入框内容和已选图片。
 * 2. 如果文本和图片均为空，则不发送。
 * 3. 构造消息内容 (支持文本和图片混合)。
 * 4. 若使用 PromptConstructor，则增强用户输入。
 * 5. 清空输入框和已选图片预览。
 * 6. 调用 `ChatbotCore.sendChatbotMessage` 发送消息。
 */
function handleChatbotSend() {
  const input = document.getElementById('chatbot-input');
  if (!input) return;
  let val = input.value.trim();

  const selectedImages = window.ChatbotImageUtils.selectedChatbotImages || [];

  if (!val && selectedImages.length === 0) return;

  let messageContent = [];
  let displayMessageContent = []; // 用于UI显示，可能包含缩略图

  if (val) {
    messageContent.push({ type: 'text', text: val });
    displayMessageContent.push({ type: 'text', text: val });
  }

  selectedImages.forEach(img => {
    if (img.fullBase64) {
      messageContent.push({
        type: 'image_url',
        image_url: { url: img.fullBase64 }
      });
      displayMessageContent.push({
        type: 'image_url',
        image_url: {
          url: img.thumbnailBase64 || img.fullBase64, // 优先用缩略图显示
          fullUrl: img.fullBase64, // 点击放大用原图
          originalSrc: img.originalSrc
        }
      });
    }
  });

  // 兼容旧的单模态模型，如果只有一个文本部分，则直接发送文本字符串
  let sendVal = messageContent.length === 1 && messageContent[0].type === 'text' ? messageContent[0].text : messageContent;
  let displayVal = displayMessageContent.length === 1 && displayMessageContent[0].type === 'text' ? displayMessageContent[0].text : displayMessageContent;

  if (window.PromptConstructor && typeof window.PromptConstructor.enhanceUserPrompt === 'function') {
    sendVal = window.PromptConstructor.enhanceUserPrompt(sendVal);
  }

  input.value = '';
  window.ChatbotImageUtils.selectedChatbotImages = [];
  window.ChatbotImageUtils.updateSelectedImagesPreview();

  window.ChatbotCore.sendChatbotMessage(sendVal, updateChatbotUI, null, displayVal);
}

/**
 * 处理预设问题的点击事件 (UI层面)。
 *
 * 主要逻辑：
 * 1. 将预设问题填充到输入框。
 * 2. 调用 `handleChatbotSend` 发送。
 *
 * @param {string} q - 预设问题文本。
 */
function handlePresetQuestion(q) {
  const input = document.getElementById('chatbot-input');
  if (!input) return;
  input.value = q;
  handleChatbotSend();
}

/**
 * 更新聊天机器人界面的核心函数。
 *
 * 主要逻辑：
 * 1. **显隐控制**：根据 `isChatbotOpen` 控制 modal 和 fab。
 * 2. **宽度/全屏管理**：根据 `isChatbotFullscreen` 和 `forceChatbotWidthReset` 等状态调整窗口大小和样式。
 * 3. **模型信息获取**：从 `ChatbotCore` 获取模型配置。
 * 4. **模型选择器模式** (`isModelSelectorOpen`)：
 *    - 若为自定义模型且 `isModelSelectorOpen` 为 true，则调用 `ChatbotModelSelectorUI.render` 显示模型选择器。
 *    - 否则，确保模型选择器被移除，聊天区和预设问题区可见。
 * 5. **预设问题区渲染**：调用 `ChatbotPresetQuestionsUI.render`。
 * 6. **聊天消息渲染**：调用 `ChatbotMessageRenderer` 模块渲染历史消息和加载指示器。
 * 7. **滚动行为**：智能滚动聊天区域，确保新消息可见或保持用户当前视口。
 * 8. **Mermaid图渲染**：调用 `ChatbotRenderingUtils.renderAllMermaidBlocks`。
 * 9. **输入框与发送按钮状态更新**：根据加载状态启用/禁用。
 * 10. **免责声明与清空历史按钮更新**。
 * 11. **浮动高级选项按钮更新**：调用 `_updateFloatingOptionsDisplay`。
 */
function updateChatbotUI() {
  const modal = document.getElementById('chatbot-modal');
  const fab = document.getElementById('chatbot-fab');
  if (!modal || !fab) return;

  // 检测沉浸式模式
  const inImmersive = !!(window.ImmersiveLayout && typeof window.ImmersiveLayout.isActive === 'function' && window.ImmersiveLayout.isActive());
  // 在沉浸式模式下强制禁用浮动模式
  if (inImmersive && window.isChatbotFloating) {
    window.isChatbotFloating = false;
  }

  const currentDocId = window.ChatbotCore && typeof window.ChatbotCore.getCurrentDocId === 'function' ? window.ChatbotCore.getCurrentDocId() : 'default_doc';
  const fullscreenButton = document.getElementById('chatbot-fullscreen-toggle-btn');

  // --- 宽度重置逻辑 ---
  if (window.chatbotInitialLoad) {
    window.forceChatbotWidthReset = true;
    window.chatbotInitialLoad = false;
  }
  const chatbotWindowForCheck = modal.querySelector('.chatbot-window');
  const isOnHistoryDetailForCheck = window.location.pathname.includes('history_detail.html');
  const chunkCompareTabElementForCheck = document.getElementById('tab-chunk-compare');
  const currentChunkCompareActive = isOnHistoryDetailForCheck && chunkCompareTabElementForCheck && chunkCompareTabElementForCheck.classList.contains('active');
  if (window.lastIsChunkCompareActive !== undefined && window.lastIsChunkCompareActive !== currentChunkCompareActive) {
    window.forceChatbotWidthReset = true;
  }

  // --- 聊天窗口显隐与样式调整 ---
  if (window.isChatbotOpen) {
    fab.style.display = 'none';
    const chatbotWindow = modal.querySelector('.chatbot-window');
    if (chatbotWindow) {
      if (window.isChatbotFullscreen) {
        // 全屏样式
        modal.style.display = 'block';
        modal.style.position = 'fixed';
        modal.style.width = '100vw';
        modal.style.height = '100vh';
        modal.style.top = '0px';
        modal.style.left = '0px';
        modal.style.bottom = '0px';
        modal.style.right = '0px';
        modal.style.padding = '0px';
        modal.style.margin = '0px';
        modal.style.border = 'none';
        modal.style.background = 'var(--chat-bg,#ffffff)';
        modal.style.pointerEvents = 'auto';
        modal.style.zIndex = '100000';

        chatbotWindow.style.position = 'absolute';
        chatbotWindow.style.width = '100%';
        chatbotWindow.style.height = '100%';
        chatbotWindow.style.minWidth = '100%';
        chatbotWindow.style.minHeight = '100%';
        chatbotWindow.style.maxWidth = '100%';
        chatbotWindow.style.maxHeight = '100%';
        chatbotWindow.style.top = '0px';
        chatbotWindow.style.left = '0px';
        chatbotWindow.style.right = '0px';
        chatbotWindow.style.bottom = '0px';
        chatbotWindow.style.borderRadius = '0px';
        chatbotWindow.style.padding = '0px';
        chatbotWindow.style.margin = '0px';
        chatbotWindow.style.border = 'none';
        chatbotWindow.style.boxSizing = 'border-box';
        chatbotWindow.style.overflow = 'hidden';
        chatbotWindow.style.resize = 'none';

        if (fullscreenButton) {
          fullscreenButton.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>`;
          fullscreenButton.title = "退出全屏";
        }
      } else {
        // 非全屏样式
        modal.style.display = 'flex';
        modal.style.position = 'fixed';
        modal.style.width = 'auto';
        modal.style.height = 'auto';
        modal.style.top = '0';
        modal.style.left = '0';
        modal.style.bottom = '0';
        modal.style.right = '0';
        modal.style.padding = '0px';
        modal.style.margin = '0px';
        modal.style.border = 'none';
        modal.style.background = 'transparent';
        modal.style.pointerEvents = 'none';

        if (window.isChatbotFloating) {
          // 浮动模式
          chatbotWindow.style.position = 'fixed';
          chatbotWindow.style.left = window.chatbotFloatingPosition.x + 'px';
          chatbotWindow.style.top = window.chatbotFloatingPosition.y + 'px';
          chatbotWindow.style.right = 'auto';
          chatbotWindow.style.bottom = 'auto';
          chatbotWindow.style.width = window.chatbotFloatingSize.width + 'px';
          chatbotWindow.style.height = window.chatbotFloatingSize.height + 'px';
          chatbotWindow.style.maxWidth = '90vw';
          chatbotWindow.style.maxHeight = '90vh';
          chatbotWindow.style.minWidth = '320px';
          chatbotWindow.style.minHeight = '400px';
          chatbotWindow.style.borderRadius = '16px';
          chatbotWindow.style.boxShadow = '0 20px 60px rgba(0,0,0,0.25), 0 0 0 1px rgba(0,0,0,0.1)';
          chatbotWindow.style.zIndex = '100001';
          chatbotWindow.classList.add('floating-mode');
        } else {
          // 固定位置模式
          chatbotWindow.classList.remove('floating-mode');
          chatbotWindow.style.position = 'absolute';
          let newMaxWidth = '720px';
          let newWidth = '92vw';
          let newMinHeight = 'calc(520px * 1.1)';
          let newMaxHeight = 'calc(85vh * 1.1)';

          const isOnHistoryDetail = window.location.pathname.includes('history_detail.html');
          const chunkCompareTabElement = document.getElementById('tab-chunk-compare');
          const isChunkCompareActive = isOnHistoryDetail && chunkCompareTabElement && chunkCompareTabElement.classList.contains('active');

          if (isChunkCompareActive) {
            newMinHeight = 'calc(520px * 1.25)';
            newMaxHeight = '99vh';
            newMaxWidth = 'calc(720px * 0.90)';
            newWidth = 'calc(92vw * 0.90)';
          }

          if (window.forceChatbotWidthReset || !chatbotWindow.style.width.endsWith('px')) {
            chatbotWindow.style.width = newWidth;
          }
          chatbotWindow.style.maxWidth = newMaxWidth;
          chatbotWindow.style.minWidth = `calc(${newWidth} * 0.32)`;
          chatbotWindow.style.minHeight = newMinHeight;
          chatbotWindow.style.maxHeight = newMaxHeight;
          if (window.forceChatbotWidthReset || !chatbotWindow.style.height.endsWith('px')) {
              chatbotWindow.style.height = '';
          }

          if (window.isChatbotPositionedLeft) {
            chatbotWindow.style.left = '44px';
            chatbotWindow.style.right = 'auto';
          } else {
            chatbotWindow.style.right = '44px';
            chatbotWindow.style.left = 'auto';
          }
          chatbotWindow.style.top = 'auto';
          chatbotWindow.style.bottom = '44px';
          chatbotWindow.style.borderRadius = '24px';
          chatbotWindow.style.boxShadow = '0 10px 40px rgba(0,0,0,0.18),0 0 0 1px rgba(0,0,0,0.05)';
        }

        chatbotWindow.style.padding = '';
        chatbotWindow.style.margin = '';
        chatbotWindow.style.border = '';
        chatbotWindow.style.boxSizing = 'border-box';
        chatbotWindow.style.overflow = 'auto';
        chatbotWindow.style.resize = 'none'; // 禁用默认resize，使用自定义拖拽

        if (fullscreenButton) {
          fullscreenButton.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"></path></svg>`;
          fullscreenButton.title = "全屏模式";
        }
      }
    }
  } else {
    modal.style.display = 'none';
    // 在沉浸式模式下不显示 FAB，以免与沉浸布局冲突
    fab.style.display = inImmersive ? 'none' : 'block';
  }
  window.forceChatbotWidthReset = false;
  window.lastIsChunkCompareActive = currentChunkCompareActive;

  const posToggleBtn = document.getElementById('chatbot-position-toggle-btn');
  if (posToggleBtn) {
    if (window.isChatbotFloating) {
      // 浮动模式下隐藏位置切换按钮
      posToggleBtn.style.display = 'none';
    } else {
      posToggleBtn.style.display = 'flex';
      if (window.isChatbotPositionedLeft) {
        posToggleBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline><path d="M20 4v16"></path></svg>`;
        posToggleBtn.title = "切换到右下角";
      } else {
        posToggleBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline><path d="M4 4v16"></path></svg>`;
        posToggleBtn.title = "切换到左下角";
      }
    }
  }

  const floatToggleBtn = document.getElementById('chatbot-float-toggle-btn');
  if (floatToggleBtn) {
    // 在沉浸式模式隐藏浮动切换按钮
    if (inImmersive) {
      floatToggleBtn.style.display = 'none';
    } else {
      floatToggleBtn.style.display = 'flex';
    }
    if (window.isChatbotFloating) {
      floatToggleBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4"></path><path d="M16 2v4"></path><rect width="18" height="18" x="3" y="4" rx="2"></rect><path d="M3 10h18"></path></svg>`;
      floatToggleBtn.title = "固定模式";
    } else {
      floatToggleBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>`;
      floatToggleBtn.title = "浮动模式";
    }
  }

  const chatBody = document.getElementById('chatbot-body');
  const chatbotPresetHeader = document.getElementById('chatbot-preset-header');
  const chatbotPresetBody = document.getElementById('chatbot-preset-body');
  let modelSelectorDiv = document.getElementById('chatbot-model-selector');

  const existingPresetContainer = document.getElementById('chatbot-preset-container');
  if (existingPresetContainer) existingPresetContainer.remove();

  const chatbotWindow = modal.querySelector('.chatbot-window');
  if (!chatbotWindow) {
    console.error("Chatbot UI: .chatbot-window not found for preset container.");
    return;
  }

  let isCustomModel = false;
  let availableModels = [];
  let currentSettings = {};
  try {
    // 缓存配置,避免流式更新时频繁加载
    // 只在模型选择器打开或缓存失效时重新获取
    if (!window._cachedChatbotConfig || window.isModelSelectorOpen) {
      window._cachedChatbotConfig = window.ChatbotCore.getChatbotConfig();
    }
    const config = window._cachedChatbotConfig;
    currentSettings = config.settings || {};
    isCustomModel = config.model === 'custom' || (typeof config.model === 'string' && config.model.startsWith('custom_source_'));
    availableModels = config.siteSpecificAvailableModels || [];
  } catch (e) {
    console.error("Error getting chatbot config for UI:", e);
  }

  const presetContainer = window.ChatbotPresetQuestionsUI.render(
    chatbotWindow,
    isCustomModel,
    currentDocId,
    updateChatbotUI,
    window.handlePresetQuestion
  );

  chatbotWindow.appendChild(presetContainer);

  let userMessageCount = 0;
  if (window.ChatbotCore && window.ChatbotCore.chatHistory) {
    userMessageCount = window.ChatbotCore.chatHistory.filter(m => m.role === 'user').length;
  }

  if (userMessageCount >= 3 &&
      !window.presetAutoCollapseTriggeredForDoc[currentDocId] &&
      !window.isPresetQuestionsCollapsed &&
      !window.isModelSelectorOpen) {
    window.isPresetQuestionsCollapsed = true;
    window.presetAutoCollapseTriggeredForDoc[currentDocId] = true;
    const presetToggleBtn = presetContainer.querySelector('#chatbot-preset-toggle-btn');
    if (presetToggleBtn) {
      presetToggleBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';
      presetToggleBtn.title = "展开快捷指令";
    }
  }

  // 获取 mainContentArea 元素
  const mainContentArea = document.getElementById('chatbot-main-content-area');

  if (mainContentArea) {
    let current_padding_top_for_main_content_area = 12;
    if (presetContainer && presetContainer.style.display !== 'none' && presetContainer.offsetHeight) {
        current_padding_top_for_main_content_area = presetContainer.offsetHeight;
    }
    mainContentArea.style.paddingTop = current_padding_top_for_main_content_area + 'px';

    // 仅在“固定模式”下根据内容自适应高度；浮动/全屏不改动用户设置的尺寸
    if (!window.isChatbotFloating && !window.isChatbotFullscreen) {
      const titleBar = document.getElementById('chatbot-title-bar');
      const inputContainer = document.getElementById('chatbot-input-container');

      if (titleBar && inputContainer && chatbotWindow) {
          const h_title_bar = titleBar.offsetHeight;
          const h_input_container = inputContainer.offsetHeight;
          const h_chat_body_target = 250;

          const desired_window_height = h_title_bar + current_padding_top_for_main_content_area + h_chat_body_target + h_input_container;

          const min_win_h_px = parseFloat(getComputedStyle(chatbotWindow).minHeight) || 520;
          const max_win_h_px = parseFloat(getComputedStyle(chatbotWindow).maxHeight) || (0.85 * window.innerHeight);

          chatbotWindow.style.height = Math.max(min_win_h_px, Math.min(max_win_h_px, desired_window_height)) + 'px';
      }
    }
  }

  if (isCustomModel && window.isModelSelectorOpen) {
    if (window.ChatbotModelSelectorUI && typeof window.ChatbotModelSelectorUI.render === 'function') {
      window.ChatbotModelSelectorUI.render(mainContentArea, chatBody, availableModels, currentSettings, updateChatbotUI);
    } else {
      console.error("ChatbotModelSelectorUI.render is not available.");
    }
    return;
  } else {
    const existingModelSelectorDiv = document.getElementById('chatbot-model-selector');
    if (existingModelSelectorDiv) existingModelSelectorDiv.remove();
    if (presetContainer) presetContainer.style.display = '';
    if (chatBody) chatBody.style.display = '';
  }
  if (chatBody) {
    const oldScrollTop = chatBody.scrollTop;
    const oldScrollHeight = chatBody.scrollHeight;
    const oldClientHeight = chatBody.clientHeight;

    // Phase 3.5 提前定义消息计数（用于后续滚动逻辑）
    // 使用统一的状态管理对象，避免全局变量污染
    if (!window.ChatbotRenderState) {
      window.ChatbotRenderState = { lastRenderedMessageCount: 0 };
    }
    const currentMessageCount = window.ChatbotCore.chatHistory.length;
    const lastRenderedCount = window.ChatbotRenderState.lastRenderedMessageCount || 0;

    let docName = 'unknown_doc';
    let dataForMindmap = { images: [], ocr: '', translation: '' };
    if (window.ChatbotCore && typeof window.ChatbotCore.getCurrentDocContent === 'function') {
        const currentDoc = window.ChatbotCore.getCurrentDocContent();
        if (currentDoc) {
            docName = currentDoc.name || 'unknown_doc';
            dataForMindmap = {
                images: currentDoc.images || [],
                ocr: currentDoc.ocr || '',
                translation: currentDoc.translation || ''
            };
        }
    }

    if (window.ChatbotMessageRenderer) {
        // Phase 3.5 增量渲染: 只渲染变化的消息，避免重新渲染整个历史

        // 如果是流式更新（消息数量没变），只更新最后一条消息
        if (window.ChatbotCore.isChatbotLoading && currentMessageCount === lastRenderedCount && currentMessageCount > 0) {
          const lastMessage = window.ChatbotCore.chatHistory[currentMessageCount - 1];
          const lastMessageContainer = chatBody.querySelector(`.assistant-message[data-message-index="${currentMessageCount - 1}"]`);

          // 检查是否需要完整渲染（reasoning 第一次出现）
          let needFullRender = false;
          if (lastMessage.reasoningContent && lastMessageContainer) {
            const reasoningBlockId = `reasoning-block-${currentMessageCount - 1}`;
            const reasoningBlock = lastMessageContainer.querySelector(`#${reasoningBlockId}`);
            if (!reasoningBlock) {
              needFullRender = true; // reasoning 块不存在，需要完整渲染
            }
          }

          // 如果需要完整渲染，跳过增量更新
          if (!needFullRender && lastMessageContainer && lastMessage.role === 'assistant') {
            // 1. 更新思考过程 (reasoning)
            if (lastMessage.reasoningContent) {
              const reasoningBlockId = `reasoning-block-${currentMessageCount - 1}`;
              let reasoningBlock = lastMessageContainer.querySelector(`#${reasoningBlockId}`);

              // 更新 reasoning 内容
              // Phase 4.x 修复：使用更快的选择器（优先使用类名，回退到子元素选择器）
              const reasoningContentDiv = reasoningBlock
                ? (reasoningBlock.querySelector('.reasoning-content') || reasoningBlock.querySelector(':scope > div:last-child'))
                : null;
              if (reasoningContentDiv) {
                const newReasoningLength = lastMessage.reasoningContent.length;
                const lastReasoningLength = parseInt(reasoningBlock.dataset.lastReasoningLength || '0', 10);

                if (newReasoningLength !== lastReasoningLength) {
                  try {
                    if (typeof renderWithKatexStreaming === 'function') {
                      reasoningContentDiv.innerHTML = renderWithKatexStreaming(lastMessage.reasoningContent);
                    } else {
                      reasoningContentDiv.innerHTML = lastMessage.reasoningContent.replace(/\n/g, '<br>');
                    }
                    reasoningBlock.dataset.lastReasoningLength = newReasoningLength.toString();
                  } catch (e) {
                    if (window.PerfLogger) {
                      window.PerfLogger.error('Reasoning 增量渲染失败:', e);
                    }
                    reasoningContentDiv.textContent = lastMessage.reasoningContent;
                  }
                }
              }
            }

            // 2. 更新主内容 (content)
            const contentDiv = lastMessageContainer.querySelector('.markdown-content');
            if (contentDiv && lastMessage.content) {
              // 使用内容长度与内容本身判断是否有变化
              const newContent = String(lastMessage.content);
              const newContentLength = newContent.length;
              const lastContentLength = parseInt(contentDiv.dataset.lastLength || '0', 10);
              const lastContent = contentDiv.dataset.lastContent || '';

              if (newContentLength !== lastContentLength) {
                try {
                  const isPureExtension =
                    newContentLength > lastContentLength &&
                    lastContent &&
                    newContent.indexOf(lastContent) === 0;
                  const appendedText = isPureExtension ? newContent.slice(lastContent.length) : '';

                  const canUseIncrementalAppend =
                    isPureExtension &&
                    isChatbotSafePlainAppend(lastContent, appendedText);

                  let didIncrementalUpdate = false;

                  if (canUseIncrementalAppend && typeof renderWithKatexStreaming === 'function') {
                    // Phase 4.2: 简单增量渲染（纯文本追加场景）
                    const appendedHtml = renderWithKatexStreaming(appendedText);
                    const temp = document.createElement('div');
                    temp.innerHTML = appendedHtml;
                    while (temp.firstChild) {
                      contentDiv.appendChild(temp.firstChild);
                    }
                    didIncrementalUpdate = true;
                  } else if (
                    isPureExtension &&
                    appendedText &&
                    window.ChatbotMathStreaming &&
                    typeof window.ChatbotMathStreaming.renderIncremental === 'function'
                  ) {
                    // Phase 4.2（原型）: 长公式增量渲染，仅在扩展场景下启用
                    let prevState = null;
                    const stateRaw = contentDiv.dataset.mathStreamingState || '';
                    if (stateRaw) {
                      try {
                        prevState = JSON.parse(stateRaw);
                      } catch (e) {
                        prevState = null;
                      }
                    }

                    const result = window.ChatbotMathStreaming.renderIncremental(prevState, appendedText);
                    if (result && typeof result.html === 'string' && result.html) {
                      const temp = document.createElement('div');
                      temp.innerHTML = result.html;
                      while (temp.firstChild) {
                        contentDiv.appendChild(temp.firstChild);
                      }
                      if (result.state) {
                        try {
                          contentDiv.dataset.mathStreamingState = JSON.stringify(result.state);
                        } catch (e) {
                          contentDiv.dataset.mathStreamingState = '';
                        }
                      }
                      didIncrementalUpdate = true;
                    }
                  }

                  if (!didIncrementalUpdate) {
                    // 回退：完整重渲染
                    if (typeof renderWithKatexStreaming === 'function') {
                      contentDiv.innerHTML = renderWithKatexStreaming(newContent);
                    } else if (typeof marked !== 'undefined') {
                      contentDiv.innerHTML = marked.parse(newContent);
                    } else {
                      contentDiv.textContent = newContent;
                    }
                    // 重渲染后清理流式状态，避免状态与内容不一致
                    delete contentDiv.dataset.mathStreamingState;
                  }

                  contentDiv.dataset.lastLength = newContentLength.toString();
                  contentDiv.dataset.lastContent = newContent;
                } catch (e) {
                  if (window.PerfLogger) {
                    window.PerfLogger.error('增量渲染失败:', e);
                  }
                  contentDiv.textContent = newContent;
                }
              }
            }

            // 3. 更新工具调用块 (toolCallHtml) - 支持流式多轮取材实时更新
            if (lastMessage.toolCallHtml) {
              const toolCallBlockContainer = lastMessageContainer.querySelector('.tool-thinking-block');
              const newToolCallHtml = String(lastMessage.toolCallHtml);

              // 检查是否需要更新（比较HTML内容）
              if (toolCallBlockContainer) {
                const currentHtml = toolCallBlockContainer.outerHTML;
                if (currentHtml !== newToolCallHtml) {
                  // 更新工具调用块HTML
                  const tempDiv = document.createElement('div');
                  tempDiv.innerHTML = newToolCallHtml;
                  const newToolCallBlock = tempDiv.firstElementChild;
                  if (newToolCallBlock) {
                    toolCallBlockContainer.replaceWith(newToolCallBlock);
                  }
                }
              } else if (newToolCallHtml) {
                // 工具调用块不存在，插入新的块（在主内容之前）
                const contentDiv = lastMessageContainer.querySelector('.markdown-content');
                if (contentDiv && contentDiv.parentNode) {
                  const tempDiv = document.createElement('div');
                  tempDiv.innerHTML = newToolCallHtml;
                  const newToolCallBlock = tempDiv.firstElementChild;
                  if (newToolCallBlock) {
                    contentDiv.parentNode.insertBefore(newToolCallBlock, contentDiv);
                  }
                }
              }
            }
          }

          // Phase 3.5 智能滚动：流式更新时保持用户阅读位置
          // 只有在用户主动停留在底部附近时才自动滚动
          if (!needFullRender) {
            const scrollThreshold = window.PerformanceConfig?.SCROLL?.BOTTOM_THRESHOLD || 50;
            const isUserAtBottom = oldScrollHeight - oldClientHeight <= oldScrollTop + scrollThreshold;
            if (isUserAtBottom) {
              chatBody.scrollTop = chatBody.scrollHeight;
            }
            // 如果用户正在查看上方内容，不做任何滚动操作
            return; // 跳过完整重新渲染
          }
          // needFullRender = true 时，继续执行完整渲染（不 return）
        }

        // 完整渲染：新消息或非流式更新
        let messagesHtml = window.ChatbotCore.chatHistory.map((m, index) => {
            if (m.role === 'segment-summary') {
                return '';
            }
            if (m.role === 'final-summary') {
                return window.ChatbotMessageRenderer.renderFinalSummaryMessage(m);
            }
            if (m.role === 'user') {
                return window.ChatbotMessageRenderer.renderUserMessage(m, index);
            }
            return window.ChatbotMessageRenderer.renderAssistantMessage(m, index, docName, dataForMindmap);
        }).join('');

        if (window.ChatbotCore.isChatbotLoading) {
            messagesHtml += window.ChatbotMessageRenderer.renderTypingIndicator();
        }

        chatBody.innerHTML = messagesHtml + window.ChatbotMessageRenderer.getMarkdownStyles();
        window.ChatbotRenderState.lastRenderedMessageCount = currentMessageCount;
        if (window.PerfLogger) {
          window.PerfLogger.debug(`增量渲染: 完整渲染 ${currentMessageCount} 条消息`);
        }
    } else {
        console.error("ChatbotMessageRenderer is not loaded!");
        chatBody.innerHTML = "<p style='color:red;'>错误：消息渲染模块加载失败。</p>";
    }

    setTimeout(() => {
      if (!window.ChatbotCore.isChatbotLoading) {
        chatBody.querySelectorAll('code.language-mermaid, pre code.language-mermaid').forEach(block => {
          block.setAttribute('data-mermaid-final', 'true');
        });
      }
    }, 0);

    // Phase 3.5 智能滚动：完整渲染时保持用户阅读位置
    const isUserAtBottom = oldScrollHeight - oldClientHeight <= oldScrollTop + 50; // 增加容差到 50px
    const isNewMessageArrival = currentMessageCount > lastRenderedCount; // 检测是否有新消息到达

    // 自动滚动到底部的条件：
    // 1. 有新消息到达（用户发送消息或助手开始回复）
    // 2. 或者用户已经停留在底部附近
    if (isNewMessageArrival || isUserAtBottom) {
      chatBody.scrollTop = chatBody.scrollHeight;
    }
    // 否则保持用户当前的阅读位置（即使正在加载也不强制滚动）

    if (window.ChatbotRenderingUtils && typeof window.ChatbotRenderingUtils.renderAllMermaidBlocks === 'function') {
      if (window.mermaidLoaded && typeof window.mermaid !== 'undefined') {
        window.ChatbotRenderingUtils.renderAllMermaidBlocks(chatBody);
      } else {
        setTimeout(() => {
          if (window.ChatbotRenderingUtils && typeof window.ChatbotRenderingUtils.renderAllMermaidBlocks === 'function') {
            window.ChatbotRenderingUtils.renderAllMermaidBlocks(chatBody);
          }
        }, 600);
        setTimeout(() => {
          if (window.ChatbotRenderingUtils && typeof window.ChatbotRenderingUtils.renderAllMermaidBlocks === 'function') {
            window.ChatbotRenderingUtils.renderAllMermaidBlocks(chatBody);
          }
        }, 1200);
      }
    } else {
      console.warn('ChatbotUI: ChatbotRenderingUtils.renderAllMermaidBlocks is not available.');
    }

    // Phase 4.1: 表格滚动性能优化 - 使用 IntersectionObserver 优先，回退到 requestAnimationFrame 节流
    setupChatbotTableScrollHints(chatBody);
  }

  const input = document.getElementById('chatbot-input');
  const sendBtn = document.getElementById('chatbot-send-btn');
  const stopBtn = document.getElementById('chatbot-stop-btn');

  if (input && sendBtn) {
    input.disabled = window.ChatbotCore.isChatbotLoading;
    sendBtn.disabled = window.ChatbotCore.isChatbotLoading;

    if (window.ChatbotCore.isChatbotLoading) {
      sendBtn.style.display = 'none';
      if (stopBtn) stopBtn.style.display = 'flex';
    } else {
      sendBtn.style.display = 'flex';
      if (stopBtn) stopBtn.style.display = 'none';
    }
  }

  const disclaimerDiv = document.querySelector('#chatbot-input-container > div[style*="text-align:center"]');
  if (disclaimerDiv) {
    const currentChatHistory = window.ChatbotCore && window.ChatbotCore.chatHistory ? window.ChatbotCore.chatHistory : [];
    if (currentChatHistory.length > 0) {
      disclaimerDiv.innerHTML = '<span>AI助手可能会犯错。请核实重要信息。</span>丨<span id="chatbot-clear-history-btn" style="color:#2563eb;cursor:pointer;font-weight:500;">删除对话记录</span>';
      const clearBtn = document.getElementById('chatbot-clear-history-btn');
      if (clearBtn) {
        clearBtn.onclick = function() {
          if (confirm('确定要删除当前对话的所有记录吗？')) {
            if (window.ChatbotCore && typeof window.ChatbotCore.clearCurrentDocChatHistory === 'function') {
              const docIdToClear = window.ChatbotCore.getCurrentDocId ? window.ChatbotCore.getCurrentDocId() : 'default_doc';
              window.ChatbotCore.clearCurrentDocChatHistory(updateChatbotUI);
              window.isPresetQuestionsCollapsed = false;
              if (window.presetAutoCollapseTriggeredForDoc) {
                delete window.presetAutoCollapseTriggeredForDoc[docIdToClear];
              }
            } else {
              console.error("clearCurrentDocChatHistory function not found on ChatbotCore");
            }
          }
        };
      }
    } else {
      disclaimerDiv.innerHTML = '<p style="margin:0;">AI助手可能会犯错。请核实重要信息。</p>';
    }
  }

  // 将调用 _updateFloatingOptionsDisplay() 改为调用独立模块
  if (window.ChatbotFloatingOptionsUI && typeof window.ChatbotFloatingOptionsUI.updateDisplay === 'function') {
    window.ChatbotFloatingOptionsUI.updateDisplay();
  }
}

/**
 * Phase 4.1 - 表格滚动提示性能优化
 * 目标：在保持现有视觉行为（滚动到最右侧隐藏渐变阴影）的前提下，减少滚动事件压力。
 *
 * 策略：
 * 1. 优先使用 IntersectionObserver 观察表格中“最右侧单元格”是否完全进入视口。
 *    - root: table，自身作为滚动容器。
 *    - threshold: 1.0，仅当最后单元格完全可见时认为滚动到末尾。
 * 2. 当浏览器不支持 IntersectionObserver 时，回退到 requestAnimationFrame 节流的 scroll 监听。
 * 3. 每次调用都会清理旧的监听器和观察器，避免重复绑定和内存泄漏。
 */
function setupChatbotTableScrollHints(chatBody) {
  if (!chatBody) return;

  const tables = chatBody.querySelectorAll('.markdown-content table');
  tables.forEach(function(table) {
    // 清理旧的 IntersectionObserver（如有）
    if (table._scrollObserver && typeof table._scrollObserver.disconnect === 'function') {
      try {
        table._scrollObserver.disconnect();
      } catch (e) {
        if (window.PerfLogger) {
          window.PerfLogger.warn('ChatbotUI: disconnect table._scrollObserver failed', e);
        }
      }
    }
    table._scrollObserver = null;

    // 清理旧的 scroll 监听器（如有）
    if (table._scrollListener) {
      table.removeEventListener('scroll', table._scrollListener);
    }
    table._scrollListener = null;

    // 如果浏览器支持 IntersectionObserver，则优先使用
    if (window.IntersectionObserver) {
      let lastCell = table.querySelector('tr:last-child td:last-child');
      if (!lastCell) {
        lastCell = table.querySelector('td:last-child, th:last-child');
      }

      // 如果找不到可观察的单元格，则直接视为已滚动到底部（不显示渐变阴影）
      if (!lastCell) {
        table.classList.add('scrolled-to-end');
        return;
      }

      const observer = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
          // 当最后一个单元格完全进入视口时，认为滚动到了最右端
          const isEnd = entry.isIntersecting && entry.intersectionRatio >= 1;
          if (isEnd) {
            table.classList.add('scrolled-to-end');
          } else {
            table.classList.remove('scrolled-to-end');
          }
        });
      }, {
        root: table,
        threshold: 1.0
      });

      observer.observe(lastCell);
      table._scrollObserver = observer;
      return;
    }

    // 回退方案：使用 requestAnimationFrame 节流 scroll 事件
    let scrollRAF = null;
    const scrollListener = function() {
      if (scrollRAF) return;
      // 若浏览器不支持 requestAnimationFrame，则直接同步执行
      if (typeof window.requestAnimationFrame !== 'function') {
        const isScrolledToEnd = table.scrollLeft >= (table.scrollWidth - table.clientWidth - 5);
        if (isScrolledToEnd) {
          table.classList.add('scrolled-to-end');
        } else {
          table.classList.remove('scrolled-to-end');
        }
        return;
      }

      scrollRAF = window.requestAnimationFrame(function() {
        const isScrolledToEnd = table.scrollLeft >= (table.scrollWidth - table.clientWidth - 5);
        if (isScrolledToEnd) {
          table.classList.add('scrolled-to-end');
        } else {
          table.classList.remove('scrolled-to-end');
        }
        scrollRAF = null;
      });
    };

    table._scrollListener = scrollListener;
    table.addEventListener('scroll', scrollListener);

    // 初始检查（表格首次渲染时）
    scrollListener();
  });
}

/**
 * Phase 4.2 - 简单增量追加判定（纯文本场景）
 * 仅在追加内容较为“安全”时启用增量渲染：
 * - newContent 以 oldContent 为前缀（纯追加，而非回退/编辑）
 * - 追加部分不包含明显的结构/公式标记（如 ```、$$、\[…\] 等）
 * 复杂 Markdown / LaTeX 场景仍回退到完整重渲染，避免破坏结构。
 */
function isChatbotSafePlainAppend(oldContent, appendedText) {
  if (!appendedText) return false;

  // 边界检查 1：若旧内容末尾处位于未闭合的块级结构中（代码块/公式等），则不做增量。
  // 这里采用“保守策略”：一旦存在疑似未闭合结构，就直接回退完整渲染，以换取更高的渲染正确性。
  try {
    if (isChatbotInsideUnclosedBlock(oldContent)) {
      return false;
    }
  } catch (e) {
    // 检测异常时同样回退完整渲染
    if (window.PerfLogger) {
      window.PerfLogger.warn('ChatbotUI: isChatbotInsideUnclosedBlock failed, fallback to full render.', e);
    }
    return false;
  }

  // 若追加部分包含明显的代码块/公式/复杂结构标记，则不做增量
  const riskyPatterns = [
    /```/,          // 代码块
    /\$\$/,         // 块级公式
    /\\\[/,         // \[ ... \]
    /\\\(/,         // \( ... \)
    /<\/?[a-zA-Z]/, // HTML 标签
    /^#{1,6}\s/m,   // 标题
    /^\s{0,3}[-*+]\s/m, // 无序列表
    /^\s{0,3}\d+\.\s/m, // 有序列表
    /^\s{0,3}>\s/m  // 引用
  ];

  for (let i = 0; i < riskyPatterns.length; i++) {
    if (riskyPatterns[i].test(appendedText)) {
      return false;
    }
  }

  return true;
}

/**
 * Phase 4.2.2 - Markdown 结构边界检测
 * 检测 oldContent 末尾是否位于未闭合的 Markdown 块级结构中：
 * - ``` fenced code block
 * - $$ 块级公式
 * - \[ \] / \( \) LaTeX 公式包裹
 *
 * 为保证性能：
 * - 优先仅分析结尾一段文本（TAIL_WINDOW），减少在极长消息上的全量扫描开销；
 * - 对 fenced code / $$ 使用“奇偶计数”策略；对 \[ / \] 与 \( / \) 使用“数量差值”近似判断；
 * - 一旦存在“不确定”或“可能未闭合”的结构，则视为不安全，回退完整渲染。
 */
function isChatbotInsideUnclosedBlock(oldContent) {
  if (!oldContent || typeof oldContent !== 'string') return false;

  // 限制分析窗口，避免在超长内容上多次全量扫描
  const TAIL_WINDOW = 4000;
  const text = oldContent.length > TAIL_WINDOW
    ? oldContent.slice(-TAIL_WINDOW)
    : oldContent;

  // 辅助函数：统计匹配次数
  function countMatches(pattern) {
    const re = new RegExp(pattern, 'g');
    let count = 0;
    while (re.exec(text) !== null) {
      count++;
    }
    return count;
  }

  // 1) Fenced code block: ``` ... ```
  // 使用出现次数的奇偶性近似判断是否在未闭合的代码块中。
  const codeFenceCount = countMatches('```');
  if (codeFenceCount % 2 === 1) {
    return true;
  }

  // 2) Block math: $$ ... $$
  const blockMathCount = countMatches('\\$\\$');
  if (blockMathCount % 2 === 1) {
    return true;
  }

  // 3) LaTeX-style delimiters: \[ ... \], \( ... \)
  const openBracket = countMatches('\\\\\\[');
  const closeBracket = countMatches('\\\\\\]');
  if (openBracket > closeBracket) {
    return true;
  }

  const openParen = countMatches('\\\\\\(');
  const closeParen = countMatches('\\\\\\)');
  if (openParen > closeParen) {
    return true;
  }

  return false;
}

/**
 * 初始化聊天机器人浮动按钮 (FAB) 和主弹窗 (Modal) 的 UI。
 *
 * 主要步骤：
 * 1. **FAB 初始化**：创建 FAB，设置样式和点击事件（打开聊天弹窗）。
 * 2. **Modal 初始化**：创建 Modal，包含头部、预设区、聊天内容区、输入区等。
 *    - 头部：标题、全屏/位置切换/关闭按钮。
 *    - 主内容区：承载预设区和聊天内容区。
 *    - 输入区：图片添加、文本输入、发送按钮、免责声明。
 *    - 注入基础 CSS (滚动条、响应式、暗黑模式等)。
 * 3. **浮动高级选项初始化**：调用 `_createFloatingOptionsBar` 创建选项按钮并插入到输入区。
 * 4. **事件绑定**：为全屏、位置切换、关闭按钮绑定事件。
 * 5. **初始UI更新**：调用 `updateChatbotUI`。
 */
function initChatbotUI() {
  // --- FAB (浮动操作按钮) 初始化 ---
  let fab = document.getElementById('chatbot-fab');
  if (!fab) {
    fab = document.createElement('div');
    fab.id = 'chatbot-fab';
    // 设置 FAB 的固定定位、初始位置（根据 isChatbotPositionedLeft 决定左右）和层级
    fab.style.position = 'fixed';
    fab.style.bottom = '32px';
    if (window.isChatbotPositionedLeft) {
      fab.style.left = '32px';
      fab.style.right = 'auto';
    } else {
      fab.style.right = '32px';
      fab.style.left = 'auto';
    }
    fab.style.zIndex = '99999';
    // FAB 内部的按钮 HTML，使用响应式尺寸和CSS变量
    fab.innerHTML = `
      <button class="chatbot-fab-button"
        onmouseover="this.style.transform='scale(1.05)';"
        onmouseout="this.style.transform='scale(1)';">
        <i class="fa-solid fa-robot"></i>
      </button>
    `;
    document.body.appendChild(fab);
  }
  // FAB 点击事件：打开聊天窗口，默认展开预设问题，并强制重置窗口宽度
  fab.onclick = function() {
    window.isChatbotOpen = true;
    window.isPresetQuestionsCollapsed = false;
    window.forceChatbotWidthReset = true;
    updateChatbotUI();
  };

  // --- Modal (主聊天窗口) 初始化 ---
  let modal = document.getElementById('chatbot-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'chatbot-modal';
    // Modal 作为聊天窗口的容器，初始隐藏，通过 flex 布局控制 chatbot-window 的居中（非全屏时）
    modal.style.position = 'fixed';
    modal.style.inset = '0'; // 等同于 top:0, left:0, bottom:0, right:0
    modal.style.zIndex = '100000';
    modal.style.background = 'transparent'; // 背景透明，依赖内部 chatbot-window 的背景
    modal.style.display = 'none'; // 初始隐藏
    modal.style.pointerEvents = 'none'; // 自身不接收鼠标事件，允许穿透
    // Modal 内部的 HTML 结构
    modal.innerHTML = `
      <div class="chatbot-window" style="background:var(--chat-bg,#ffffff);max-width:720px;width:92vw;min-height:520px;max-height:85vh;border-radius:24px;box-shadow:0 10px 40px rgba(0,0,0,0.18),0 0 0 1px rgba(0,0,0,0.05);position:absolute;bottom:44px;display:flex;flex-direction:column;overflow:auto;/* 禁用默认resize，使用自定义拖拽 */resize:none;pointer-events:auto;transition: width 0.3s ease-out, height 0.3s ease-out, top 0.3s ease-out, left 0.3s ease-out, right 0.3s ease-out, bottom 0.3s ease-out, border-radius 0.3s ease-out;">
        <!-- 拖拽调整大小的句柄 -->
        <div class="chatbot-resize-handles">
          <div class="chatbot-resize-handle chatbot-resize-n" data-direction="n"></div>
          <div class="chatbot-resize-handle chatbot-resize-s" data-direction="s"></div>
          <div class="chatbot-resize-handle chatbot-resize-w" data-direction="w"></div>
          <div class="chatbot-resize-handle chatbot-resize-e" data-direction="e"></div>
          <div class="chatbot-resize-handle chatbot-resize-nw" data-direction="nw"></div>
          <div class="chatbot-resize-handle chatbot-resize-ne" data-direction="ne"></div>
          <div class="chatbot-resize-handle chatbot-resize-sw" data-direction="sw"></div>
          <div class="chatbot-resize-handle chatbot-resize-se" data-direction="se"></div>
        </div>
        <!-- 浮动切换按钮 -->
        <div style="position:absolute;top:18px;right:138px;z-index:11;">
          <button id="chatbot-float-toggle-btn" title="浮动模式" style="width:32px;height:32px;border-radius:16px;border:none;background:rgba(0,0,0,0.06);color:#666;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all 0.2s;box-shadow:0 2px 6px rgba(0,0,0,0.06);" onmouseover="this.style.background='rgba(0,0,0,0.1)';this.style.transform='scale(1.05)'" onmouseout="this.style.background='rgba(0,0,0,0.06)';this.style.transform='scale(1)'">
            {/* 图标由 updateChatbotUI 动态设置 */}
          </button>
        </div>
        <!-- 全屏切换按钮 -->
        <div style="position:absolute;top:18px;right:98px;z-index:11;">
          <button id="chatbot-fullscreen-toggle-btn" title="全屏模式" style="width:32px;height:32px;border-radius:16px;border:none;background:rgba(0,0,0,0.06);color:#666;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all 0.2s;box-shadow:0 2px 6px rgba(0,0,0,0.06);" onmouseover="this.style.background='rgba(0,0,0,0.1)';this.style.transform='scale(1.05)'" onmouseout="this.style.background='rgba(0,0,0,0.06)';this.style.transform='scale(1)'">
            {/* 图标由 updateChatbotUI 动态设置 */}
          </button>
        </div>
        <!-- 位置切换按钮 -->
        <div style="position:absolute;top:18px;right:58px;z-index:11;">
          <button id="chatbot-position-toggle-btn" title="切换位置" style="width:32px;height:32px;border-radius:16px;border:none;background:rgba(0,0,0,0.06);color:#666;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all 0.2s;box-shadow:0 2px 6px rgba(0,0,0,0.06);" onmouseover="this.style.background='rgba(0,0,0,0.1)';this.style.transform='scale(1.05)'" onmouseout="this.style.background='rgba(0,0,0,0.06)';this.style.transform='scale(1)'">
            {/* 图标由 updateChatbotUI 动态设置 */}
          </button>
        </div>
        <!-- 关闭按钮 -->
        <div style="position:absolute;top:18px;right:18px;z-index:10;">
          <button id="chatbot-close-btn" style="width:32px;height:32px;border-radius:16px;border:none;background:rgba(0,0,0,0.06);color:#666;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all 0.2s;box-shadow:0 2px 6px rgba(0,0,0,0.06);" onmouseover="this.style.background='rgba(0,0,0,0.1)';this.style.transform='scale(1.05)'" onmouseout="this.style.background='rgba(0,0,0,0.06)';this.style.transform='scale(1)'">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        <!-- 标题栏 (可拖拽移动窗口) -->
        <div id="chatbot-title-bar" class="chatbot-draggable-header" style="padding:20px 24px 16px 24px;display:flex;align-items:center;gap:8px;border-bottom:1px dashed rgba(0,0,0,0.1);flex-shrink:0;">
          <div style="width:36px;height:36px;border-radius:18px;background:linear-gradient(135deg,#3b82f6,#1d4ed8);display:flex;align-items:center;justify-content:center;">
            <i class="fa-solid fa-robot" style="font-size: 16px; color: white;"></i>
          </div>
          <span style="font-weight:600;font-size:1.15em;color:#111;">AI 智能助手</span>
        </div>
        <!-- 主内容区域，包含聊天记录和可能的预设问题区 -->
        <div id="chatbot-main-content-area" style="padding:12px 20px 0 20px;flex:1;display:flex;flex-direction:column;overflow:hidden;transition: padding-top 0.4s ease-out;">
          <!-- 聊天消息显示主体 -->
          <div id="chatbot-body" style="flex:1;overflow-y:auto;padding-right:6px;margin-right:-6px;padding-bottom:10px;scrollbar-width:thin;scrollbar-color:#ddd transparent;scroll-behavior:smooth;position:relative;z-index:0;"></div>
        </div>
        <!-- 输入区域容器 -->
        <div id="chatbot-input-container" style="padding:0px 20px 16px 20px;border-top:1px dashed rgba(0,0,0,0.1);background:rgba(249,250,251,0.7);flex-shrink:0;">
          <!-- 浮动高级选项将由JS插入此处 -->
          <!-- 已选图片预览区 -->
          <div id="chatbot-selected-images-preview" style="display:none;gap:8px;padding-bottom:8px;flex-wrap:wrap;">
            {/* 图片预览由 ChatbotImageUtils.updateSelectedImagesPreview 更新 */}
          </div>
          <!-- 输入框和发送按钮的 flex 容器 -->
          <div style="display:flex;align-items:center;gap:12px;">
            <!-- 添加图片按钮 -->
            <button id="chatbot-add-image-btn" title="添加图片"
              style="background:transparent; border:2px dashed #e2e8f0; color:#3b82f6; height:44px; width:44px; border-radius:22px; display:flex; align-items:center; justify-content:center; cursor:pointer; transition:all 0.2s; flex-shrink:0;"
              onmouseover="this.style.borderColor='#3b82f6';"
              onmouseout="this.style.borderColor='#e2e8f0';"
              onclick="window.ChatbotImageUtils.openImageSelectionModal()">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
            </button>
            <!-- 文本输入框容器 -->
            <div style="position:relative;flex:1;">
              <input id="chatbot-input" type="text" placeholder="请输入问题..."
                style="width:100%;height:44px;border-radius:22px;border:2px dashed #e2e8f0;background:white;padding:0 16px;font-size:15px;transition:all 0.2s;outline:none;box-sizing:border-box;"
                onkeydown="if(event.key==='Enter'){window.handleChatbotSend();}"
                onfocus="this.style.borderColor='#3b82f6';this.style.boxShadow='0 0 0 3px rgba(59,130,246,0.25)'"
                onblur="this.style.borderColor='#e2e8f0';this.style.boxShadow='none'"
              />
            </div>
            <!-- 发送按钮 -->
            <button id="chatbot-send-btn"
              style="background:linear-gradient(135deg,#3b82f6,#2563eb);color:white;border:2px solid #2563eb;height:44px;min-width:44px;border-radius:22px;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all 0.2s;flex-shrink:0;"
              onmouseover="this.style.transform='translateY(-1px)';"
              onmouseout="this.style.transform='translateY(0)';"
              onclick="window.handleChatbotSend()"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
              </svg>
            </button>
            <!-- 暂停按钮 -->
            <button id="chatbot-stop-btn"
              style="background:linear-gradient(135deg,#f97316,#ea580c);color:white;border:2px solid #ea580c;height:44px;min-width:44px;border-radius:22px;display:none;align-items:center;justify-content:center;cursor:pointer;transition:all 0.3s cubic-bezier(0.4, 0, 0.2, 1);flex-shrink:0;box-shadow:0 4px 12px rgba(249,115,22,0.4);position:relative;overflow:hidden;"
              onmouseover="this.style.transform='translateY(-2px) scale(1.05)';this.style.boxShadow='0 6px 20px rgba(249,115,22,0.5)';"
              onmouseout="this.style.transform='translateY(0) scale(1)';this.style.boxShadow='0 4px 12px rgba(249,115,22,0.4)';"
              onclick="window.handleChatbotStop()"
              title="停止对话"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="position:relative;z-index:1;">
                <circle cx="12" cy="12" r="10"></circle>
                <rect x="9" y="9" width="6" height="6" fill="currentColor"></rect>
              </svg>
              <span style="position:absolute;top:0;left:0;width:100%;height:100%;background:linear-gradient(135deg,rgba(255,255,255,0.2),transparent);pointer-events:none;"></span>
            </button>
          </div>
          <!-- 免责声明 -->
          <div style="margin-top:10px;text-align:center;font-size:11px;color:#6b7280;padding:0 10px;">
            <p style="margin:0;">AI助手可能会犯错。请核实重要信息。</p>
          </div>
        </div>
      </div>
      <!-- 内部 CSS 样式 -->
      <style>
        /* 聊天内容区滚动条样式 */
        #chatbot-body::-webkit-scrollbar {width:6px;background:transparent;}
        #chatbot-body::-webkit-scrollbar-thumb {background:rgba(0,0,0,0.1);border-radius:6px;}
        #chatbot-body::-webkit-scrollbar-thumb:hover {background:rgba(0,0,0,0.15);}

        /* 拖拽调整大小句柄样式 */
        .chatbot-resize-handles {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          pointer-events: none;
          z-index: 5;
          display: none; /* 默认隐藏 */
        }

        /* 只有在浮动模式下才显示调整大小句柄 */
        .chatbot-window.floating-mode .chatbot-resize-handles {
          display: block;
        }

        /* 浮动模式下标题栏可拖拽 */
        .chatbot-window.floating-mode .chatbot-draggable-header {
          cursor: move;
        }

        .chatbot-resize-handle {
          position: absolute;
          pointer-events: auto;
          background: transparent;
          transition: background-color 0.2s ease;
        }

        .chatbot-resize-handle:hover {
          background-color: rgba(59, 130, 246, 0.2);
        }

        /* 上下边缘 */
        .chatbot-resize-n, .chatbot-resize-s {
          left: 8px;
          right: 8px;
          height: 8px;
          cursor: ns-resize;
        }
        .chatbot-resize-n { top: 0; }
        .chatbot-resize-s { bottom: 0; }

        /* 左右边缘 */
        .chatbot-resize-w, .chatbot-resize-e {
          top: 8px;
          bottom: 8px;
          width: 8px;
          cursor: ew-resize;
        }
        .chatbot-resize-w { left: 0; }
        .chatbot-resize-e { right: 0; }

        /* 四个角 */
        .chatbot-resize-nw, .chatbot-resize-ne, .chatbot-resize-sw, .chatbot-resize-se {
          width: 16px;
          height: 16px;
        }
        .chatbot-resize-nw { top: 0; left: 0; cursor: nw-resize; }
        .chatbot-resize-ne { top: 0; right: 0; cursor: ne-resize; }
        .chatbot-resize-sw { bottom: 0; left: 0; cursor: sw-resize; }
        .chatbot-resize-se { bottom: 0; right: 0; cursor: se-resize; }

        /* 拖拽移动时的样式 */
        .chatbot-dragging {
          user-select: none;
          pointer-events: none;
        }

        .chatbot-dragging .chatbot-window {
          pointer-events: auto;
        }

        /* 响应式：小屏幕下窗口占满底部 */
        @media (max-width:600px) {
          .chatbot-window {
            right:0 !important;
            left:0 !important;
            bottom:0 !important;
            width:100% !important;
            max-width:100% !important;
            max-height:100% !important;
            border-radius:20px 20px 0 0 !important;
          }
          .message-actions { /* 消息操作按钮在小屏幕下更明显 */
            opacity: 0.9 !important;
          }
          .chatbot-resize-handles {
            display: none; /* 移动端禁用拖拽调整大小 */
          }
        }
        /* 暗黑模式样式 */
        body.dark .chatbot-window {background:#1a1c23 !important;color:#e5e7eb !important;}
        body.dark #chatbot-input {background:#2a2d36 !important;border-color:rgba(255,255,255,0.1) !important;color:#e5e7eb !important;}
        body.dark #chatbot-close-btn {background:rgba(255,255,255,0.1) !important;color:#aaa !important;}
        body.dark #chatbot-preset button {background:linear-gradient(to bottom, rgba(30,41,59,0.9), rgba(15,23,42,0.9)) !important;color:#7dd3fc !important;border-color:rgba(14,165,233,0.2) !important;}
        body.dark .message-actions button {background:rgba(255,255,255,0.1) !important;color:#aaa !important;}
        body.dark #chatbot-toast {background:rgba(30,41,59,0.9) !important;}

        /* 暂停按钮脉动动画 */
        @keyframes chatbot-stop-pulse {
          0%, 100% {
            box-shadow: 0 4px 12px rgba(249,115,22,0.4), 0 0 0 0 rgba(249,115,22,0.7);
          }
          50% {
            box-shadow: 0 4px 12px rgba(249,115,22,0.4), 0 0 0 8px rgba(249,115,22,0);
          }
        }

        #chatbot-stop-btn {
          animation: chatbot-stop-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }

        #chatbot-stop-btn:hover {
          animation: none;
        }
      </style>
    `;
    document.body.appendChild(modal);
  }

  // --- 浮动高级选项初始化 ---
  const inputContainerElement = document.getElementById('chatbot-input-container');
  if (window.ChatbotFloatingOptionsUI && typeof window.ChatbotFloatingOptionsUI.createBar === 'function') {
    window.ChatbotFloatingOptionsUI.createBar(inputContainerElement, updateChatbotUI);
  }

  // --- 核心控制按钮事件绑定 ---
  // 浮动模式切换按钮点击事件
  document.getElementById('chatbot-float-toggle-btn').onclick = function() {
    // 沉浸式模式下禁用浮动模式切换
    if (window.ImmersiveLayout && typeof window.ImmersiveLayout.isActive === 'function' && window.ImmersiveLayout.isActive()) {
      return; // 直接忽略
    }
    window.isChatbotFloating = !window.isChatbotFloating;
    localStorage.setItem('chatbotFloating', String(window.isChatbotFloating));

    if (window.isChatbotFloating) {
      // 切换到浮动模式时，记录当前位置和大小
      const chatbotWindow = modal.querySelector('.chatbot-window');
      if (chatbotWindow) {
        const rect = chatbotWindow.getBoundingClientRect();
        window.chatbotFloatingPosition = { x: rect.left, y: rect.top };
        window.chatbotFloatingSize = { width: rect.width, height: rect.height };
        localStorage.setItem('chatbotFloatingPosition', JSON.stringify(window.chatbotFloatingPosition));
        localStorage.setItem('chatbotFloatingSize', JSON.stringify(window.chatbotFloatingSize));
      }
    }
    updateChatbotUI();
  };

  // 全屏切换按钮点击事件
  document.getElementById('chatbot-fullscreen-toggle-btn').onclick = function() {
    const wasFullscreen = window.isChatbotFullscreen;
    window.isChatbotFullscreen = !window.isChatbotFullscreen; // 切换全屏状态
    localStorage.setItem('chatbotFullscreen', String(window.isChatbotFullscreen)); // 保存到localStorage
    if (wasFullscreen && !window.isChatbotFullscreen) { // 如果是从全屏退出
      window.forceChatbotWidthReset = true; // 强制重置宽度
    }
    updateChatbotUI();
  };

  // 位置切换按钮点击事件
  document.getElementById('chatbot-position-toggle-btn').onclick = function() {
    window.isChatbotPositionedLeft = !window.isChatbotPositionedLeft; // 切换左右位置状态
    localStorage.setItem('chatbotPosition', window.isChatbotPositionedLeft ? 'left' : 'right'); // 保存到localStorage
    window.forceChatbotWidthReset = true; // 位置变化也应重置宽度
    updateChatbotUI();
  };

  // 关闭按钮点击事件
  document.getElementById('chatbot-close-btn').onclick = function() {
    window.isChatbotOpen = false; // 关闭聊天窗口
    updateChatbotUI();
  };

  // --- 拖拽和调整大小功能初始化 ---
  initChatbotDragAndResize();

  updateChatbotUI(); // 首次完整渲染或更新UI
}

/**
 * 初始化聊天机器人的拖拽移动和调整大小功能
 */
function initChatbotDragAndResize() {
  const modal = document.getElementById('chatbot-modal');
  if (!modal) return;

  let isDragging = false;
  let isResizing = false;
  let dragStartX, dragStartY;
  let initialX, initialY, initialWidth, initialHeight;
  let resizeDirection = '';

  // 拖拽移动功能 (仅在浮动模式下生效)
  function handleDragStart(e) {
    if (!window.isChatbotFloating || window.isChatbotFullscreen) return;

    const chatbotWindow = modal.querySelector('.chatbot-window');
    if (!chatbotWindow) return;

    isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;

    const rect = chatbotWindow.getBoundingClientRect();
    initialX = rect.left;
    initialY = rect.top;

    document.body.classList.add('chatbot-dragging');
    e.preventDefault();
  }

  function handleDragMove(e) {
    if (!isDragging || !window.isChatbotFloating) return;

    const deltaX = e.clientX - dragStartX;
    const deltaY = e.clientY - dragStartY;

    const newX = Math.max(0, Math.min(window.innerWidth - 320, initialX + deltaX));
    const newY = Math.max(0, Math.min(window.innerHeight - 200, initialY + deltaY));

    window.chatbotFloatingPosition = { x: newX, y: newY };
    localStorage.setItem('chatbotFloatingPosition', JSON.stringify(window.chatbotFloatingPosition));

    const chatbotWindow = modal.querySelector('.chatbot-window');
    if (chatbotWindow) {
      chatbotWindow.style.left = newX + 'px';
      chatbotWindow.style.top = newY + 'px';
    }
  }

  function handleDragEnd() {
    if (isDragging) {
      isDragging = false;
      document.body.classList.remove('chatbot-dragging');
    }
  }

  // 调整大小功能
  function handleResizeStart(e) {
    if (window.isChatbotFullscreen || !window.isChatbotFloating) return;

    const chatbotWindow = modal.querySelector('.chatbot-window');
    if (!chatbotWindow) return;

    isResizing = true;
    resizeDirection = e.target.dataset.direction;
    dragStartX = e.clientX;
    dragStartY = e.clientY;

    const rect = chatbotWindow.getBoundingClientRect();
    initialX = rect.left;
    initialY = rect.top;
    initialWidth = rect.width;
    initialHeight = rect.height;

    document.body.classList.add('chatbot-dragging');
    e.preventDefault();
    e.stopPropagation();
  }

  function handleResizeMove(e) {
    if (!isResizing || !window.isChatbotFloating) return;

    const deltaX = e.clientX - dragStartX;
    const deltaY = e.clientY - dragStartY;

    let newX = initialX;
    let newY = initialY;
    let newWidth = initialWidth;
    let newHeight = initialHeight;

    // 根据拖拽方向调整大小和位置
    if (resizeDirection.includes('n')) {
      newY = initialY + deltaY;
      newHeight = initialHeight - deltaY;
    }
    if (resizeDirection.includes('s')) {
      newHeight = initialHeight + deltaY;
    }
    if (resizeDirection.includes('w')) {
      newX = initialX + deltaX;
      newWidth = initialWidth - deltaX;
    }
    if (resizeDirection.includes('e')) {
      newWidth = initialWidth + deltaX;
    }

    // 应用最小和最大尺寸限制
    newWidth = Math.max(320, Math.min(window.innerWidth * 0.9, newWidth));
    newHeight = Math.max(400, Math.min(window.innerHeight * 0.9, newHeight));

    // 确保窗口不会超出屏幕边界
    newX = Math.max(0, Math.min(window.innerWidth - newWidth, newX));
    newY = Math.max(0, Math.min(window.innerHeight - newHeight, newY));

    // 更新全局状态
    window.chatbotFloatingPosition = { x: newX, y: newY };
    window.chatbotFloatingSize = { width: newWidth, height: newHeight };
    localStorage.setItem('chatbotFloatingPosition', JSON.stringify(window.chatbotFloatingPosition));
    localStorage.setItem('chatbotFloatingSize', JSON.stringify(window.chatbotFloatingSize));

    // 应用新的位置和大小
    const chatbotWindow = modal.querySelector('.chatbot-window');
    if (chatbotWindow) {
      chatbotWindow.style.left = newX + 'px';
      chatbotWindow.style.top = newY + 'px';
      chatbotWindow.style.width = newWidth + 'px';
      chatbotWindow.style.height = newHeight + 'px';
    }
  }

  function handleResizeEnd() {
    if (isResizing) {
      isResizing = false;
      resizeDirection = '';
      document.body.classList.remove('chatbot-dragging');
    }
  }

  // 绑定拖拽移动事件 (标题栏)
  modal.addEventListener('mousedown', function(e) {
    if (e.target.closest('.chatbot-draggable-header')) {
      handleDragStart(e);
    } else if (e.target.closest('.chatbot-resize-handle')) {
      handleResizeStart(e);
    }
  });

  // 全局鼠标移动和释放事件
  document.addEventListener('mousemove', function(e) {
    if (isDragging) {
      handleDragMove(e);
    } else if (isResizing) {
      handleResizeMove(e);
    }
  });

  document.addEventListener('mouseup', function() {
    handleDragEnd();
    handleResizeEnd();
  });

  // ==========================================
  // Phase 3: 初始化消息事件管理器（事件委托）
  // ==========================================
  if (window.ChatMessageEventManager) {
    try {
      window.chatMessageEventManager = new ChatMessageEventManager('#chatbot-body');
      console.log('[ChatbotUI] ✅ Phase 3: 消息事件管理器已初始化（事件委托模式）');
    } catch (error) {
      console.error('[ChatbotUI] ❌ Phase 3: 消息事件管理器初始化失败:', error);
    }
  } else {
    console.warn('[ChatbotUI] ⚠️ Phase 3: ChatMessageEventManager 类未加载，将使用内联事件（回滚模式）');
  }
}

// 将核心函数挂载到 window 对象和 ChatbotUI 命名空间下，便于外部调用
window.handleChatbotSend = handleChatbotSend;
window.handleChatbotStop = handleChatbotStop;
window.handlePresetQuestion = handlePresetQuestion;
window.ChatbotUI = {
  updateChatbotUI,
  initChatbotUI
};

// 当DOM内容加载完成后，执行初始化函数
// 这是确保所有需要的DOM元素都已存在后再进行操作的标准做法
if (document.readyState === 'loading') {
  // 如果文档仍在加载中，则等待 DOMContentLoaded 事件
  document.addEventListener('DOMContentLoaded', initChatbotUI);
} else {
  // 如果文档已经加载完毕，则直接执行初始化
  initChatbotUI();
}
