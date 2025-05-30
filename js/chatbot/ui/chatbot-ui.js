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

// 高级聊天功能选项
window.chatbotActiveOptions = {
  useContext: true, // 是否使用上下文
  contentLengthStrategy: 'default', // 内容长度策略: 'default', 'segmented'
  summarySource: 'ocr',   // 总结来源: 'ocr', 'none', 'translation'
  interestPointsActive: false,    // 兴趣点功能 (占位)
  memoryManagementActive: false   // 记忆管理功能 (占位)
};

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
        chatbotWindow.style.borderRadius = '24px';
        chatbotWindow.style.padding = '';
        chatbotWindow.style.margin = '';
        chatbotWindow.style.border = '';
        chatbotWindow.style.boxSizing = 'border-box';
        chatbotWindow.style.overflow = 'auto';
        chatbotWindow.style.resize = 'both';

        if (window.isChatbotPositionedLeft) {
          chatbotWindow.style.left = '44px';
          chatbotWindow.style.right = 'auto';
        } else {
          chatbotWindow.style.right = '44px';
          chatbotWindow.style.left = 'auto';
        }
        chatbotWindow.style.top = 'auto';
        chatbotWindow.style.bottom = '44px';

        if (fullscreenButton) {
          fullscreenButton.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"></path></svg>`;
          fullscreenButton.title = "全屏模式";
        }
      }
    }
  } else {
    modal.style.display = 'none';
    fab.style.display = 'block';
  }
  window.forceChatbotWidthReset = false;
  window.lastIsChunkCompareActive = currentChunkCompareActive;

  const posToggleBtn = document.getElementById('chatbot-position-toggle-btn');
  if (posToggleBtn) {
    if (window.isChatbotPositionedLeft) {
      posToggleBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline><path d="M20 4v16"></path></svg>`;
      posToggleBtn.title = "切换到右下角";
    } else {
      posToggleBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline><path d="M4 4v16"></path></svg>`;
      posToggleBtn.title = "切换到左下角";
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
    const config = window.ChatbotCore.getChatbotConfig();
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

    const isUserInitiallyAtBottom = oldScrollHeight - oldClientHeight <= oldScrollTop + 5;

    if (window.ChatbotCore.isChatbotLoading || isUserInitiallyAtBottom) {
      chatBody.scrollTop = chatBody.scrollHeight;
    }

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
  }

  const input = document.getElementById('chatbot-input');
  const sendBtn = document.getElementById('chatbot-send-btn');
  if (input && sendBtn) {
    input.disabled = window.ChatbotCore.isChatbotLoading;
    sendBtn.disabled = window.ChatbotCore.isChatbotLoading;
    if (window.ChatbotCore.isChatbotLoading) {
      sendBtn.style.opacity = '0.6';
      sendBtn.style.cursor = 'not-allowed';
    } else {
      sendBtn.style.opacity = '1';
      sendBtn.style.cursor = 'pointer';
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
    // FAB 内部的按钮 HTML，包含一个机器人图标和悬浮放大效果
    fab.innerHTML = `
      <button style="width:62px;height:62px;border:none;outline:none;background:linear-gradient(135deg,#3b82f6,#1d4ed8);border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;transform:scale(1);transition:transform 0.2s;color:white;"
        onmouseover="this.style.transform='scale(1.05)';"
        onmouseout="this.style.transform='scale(1)';">
        <i class="fa-solid fa-robot" style="font-size: 24px;"></i>
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
      <div class="chatbot-window" style="background:var(--chat-bg,#ffffff);max-width:720px;width:92vw;min-height:520px;max-height:85vh;border-radius:24px;box-shadow:0 10px 40px rgba(0,0,0,0.18),0 0 0 1px rgba(0,0,0,0.05);position:absolute;bottom:44px;display:flex;flex-direction:column;overflow:auto;/* 允许拖拽调整大小 */resize:both;pointer-events:auto;transition: width 0.3s ease-out, height 0.3s ease-out, top 0.3s ease-out, left 0.3s ease-out, right 0.3s ease-out, bottom 0.3s ease-out, border-radius 0.3s ease-out;">
        <!-- 全屏切换按钮 -->
        <div style="position:absolute;top:18px;right:58px;z-index:11;">
          <button id="chatbot-fullscreen-toggle-btn" title="全屏模式" style="width:32px;height:32px;border-radius:16px;border:none;background:rgba(0,0,0,0.06);color:#666;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all 0.2s;box-shadow:0 2px 6px rgba(0,0,0,0.06);" onmouseover="this.style.background='rgba(0,0,0,0.1)';this.style.transform='scale(1.05)'" onmouseout="this.style.background='rgba(0,0,0,0.06)';this.style.transform='scale(1)'">
            {/* 图标由 updateChatbotUI 动态设置 */}
          </button>
        </div>
        <!-- 位置切换按钮 -->
        <div style="position:absolute;top:18px;right:98px;z-index:11;">
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
        <!-- 标题栏 -->
        <div id="chatbot-title-bar" style="padding:20px 24px 16px 24px;display:flex;align-items:center;gap:8px;border-bottom:1px dashed rgba(0,0,0,0.1);flex-shrink:0;">
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
        }
        /* 暗黑模式样式 */
        body.dark .chatbot-window {background:#1a1c23 !important;color:#e5e7eb !important;}
        body.dark #chatbot-input {background:#2a2d36 !important;border-color:rgba(255,255,255,0.1) !important;color:#e5e7eb !important;}
        body.dark #chatbot-close-btn {background:rgba(255,255,255,0.1) !important;color:#aaa !important;}
        body.dark #chatbot-preset button {background:linear-gradient(to bottom, rgba(30,41,59,0.9), rgba(15,23,42,0.9)) !important;color:#7dd3fc !important;border-color:rgba(14,165,233,0.2) !important;}
        body.dark .message-actions button {background:rgba(255,255,255,0.1) !important;color:#aaa !important;}
        body.dark #chatbot-toast {background:rgba(30,41,59,0.9) !important;}
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

  updateChatbotUI(); // 首次完整渲染或更新UI
}

// 将核心函数挂载到 window 对象和 ChatbotUI 命名空间下，便于外部调用
window.handleChatbotSend = handleChatbotSend;
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