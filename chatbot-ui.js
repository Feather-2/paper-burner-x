function updateChatbotUI() {
  const modal = document.getElementById('chatbot-modal');
  const fab = document.getElementById('chatbot-fab');
  if (!modal || !fab) return;

  if (window.isChatbotOpen) {
    modal.style.display = 'flex';
    fab.style.display = 'none';

    const chatbotWindow = modal.querySelector('.chatbot-window');
    if (chatbotWindow) {
      // Default styles
      let newMaxWidth = '720px';
      let newWidth = '92vw';
      let newMinHeight = '520px';
      let newMaxHeight = '85vh';

      const isOnHistoryDetail = window.location.pathname.includes('history_detail.html');
      // Check if tab-chunk-compare element exists before trying to access its classList
      const chunkCompareTabElement = document.getElementById('tab-chunk-compare');
      const isChunkCompareActive = isOnHistoryDetail && chunkCompareTabElement && chunkCompareTabElement.classList.contains('active');

      if (isChunkCompareActive) {
        // Taller by ~20%
        newMinHeight = 'calc(520px * 1.2)'; // Approx 624px
        newMaxHeight = '98vh'; // Increased from 85vh. (85vh * 1.2 = 102vh, effectively capped at 98vh for better fit)

        // Narrower by 10% (changed from 15%)
        newMaxWidth = 'calc(720px * 0.90)'; // Approx 648px (was 612px for 15%)
        newWidth = 'calc(92vw * 0.90)';    // Approx 82.8vw (was 78.2vw for 15%)
      }
      // Else, the default values initialized above are used.

      chatbotWindow.style.maxWidth = newMaxWidth;
      chatbotWindow.style.width = newWidth;
      chatbotWindow.style.minHeight = newMinHeight;
      chatbotWindow.style.maxHeight = newMaxHeight;

      if (window.isChatbotPositionedLeft) {
        chatbotWindow.style.left = '44px';
        chatbotWindow.style.right = 'auto';
      } else {
        chatbotWindow.style.right = '44px';
        chatbotWindow.style.left = 'auto';
      }
    }
  } else {
    modal.style.display = 'none';
    fab.style.display = 'block';
    // Update FAB position when chatbot is closed as well
    if (window.isChatbotPositionedLeft) {
      fab.style.left = '32px';
      fab.style.right = 'auto';
    } else {
      fab.style.right = '32px';
      fab.style.left = 'auto';
    }
  }

  const posToggleBtn = document.getElementById('chatbot-position-toggle-btn');
  if (posToggleBtn) {
    if (window.isChatbotPositionedLeft) {
      // Icon for "Switch to Right"
      posToggleBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline><path d="M20 4v16"></path></svg>`;
      posToggleBtn.title = "切换到右下角";
    } else {
      // Icon for "Switch to Left"
      posToggleBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline><path d="M4 4v16"></path></svg>`;
      posToggleBtn.title = "切换到左下角";
    }
  }

  const chatBody = document.getElementById('chatbot-body');
  const chatbotPreset = document.getElementById('chatbot-preset');
  let modelSelectorDiv = document.getElementById('chatbot-model-selector');
  // 先移除旧的
  if (modelSelectorDiv) modelSelectorDiv.remove();

  // 新增：根据对话历史判断是否显示预设问题
  // 计算用户已提问的次数
  let userMessageCount = 0;
  if (window.ChatbotCore && window.ChatbotCore.chatHistory) {
    userMessageCount = window.ChatbotCore.chatHistory.filter(m => m.role === 'user').length;
  }

  // 如果用户提问次数大于等于2，则隐藏预设问题区域（带动画）
  if (chatbotPreset) {
    // 确保预设问题区域有基本样式和过渡效果
    chatbotPreset.style.transition = 'opacity 0.3s, max-height 0.5s';
    chatbotPreset.style.overflow = 'hidden';

    if (userMessageCount >= 2 && !window.isModelSelectorOpen) {
      if (chatbotPreset.style.opacity !== '0') {
        // 触发淡出动画
        chatbotPreset.style.opacity = '0';
        chatbotPreset.style.maxHeight = '0';
        setTimeout(() => {
          chatbotPreset.style.display = 'none';
        }, 300); // 等待动画完成后隐藏
      }
    } else if (!window.isModelSelectorOpen) {
      // 显示预设问题（带淡入动画）
      chatbotPreset.style.display = '';
      // 使用setTimeout确保display变更已生效
      setTimeout(() => {
        chatbotPreset.style.opacity = '1';
        chatbotPreset.style.maxHeight = '300px'; // 足够大的值以容纳内容
      }, 10);
    }
  }

  // 判断当前是否为自定义模型
  let isCustomModel = false;
  let availableModels = [];
  try {
    const config = window.ChatbotCore.getChatbotConfig();
    isCustomModel = config.model === 'custom' || (typeof config.model === 'string' && config.model.startsWith('custom_source_'));
    if (isCustomModel && Array.isArray(config.siteSpecificAvailableModels)) {
      availableModels = config.siteSpecificAvailableModels;
      localStorage.setItem('availableCustomModels', JSON.stringify(availableModels));
    }
  } catch (e) {}

  // ... rest of the existing code ...
}

function initChatbotUI() {
  let fab = document.getElementById('chatbot-fab');
  if (!fab) {
    fab = document.createElement('div');
    fab.id = 'chatbot-fab';
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
    fab.innerHTML = `
      <button style="width:62px;height:62px;border:none;outline:none;background:linear-gradient(135deg,#3b82f6,#1d4ed8);border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;transform:scale(1);transition:transform 0.2s;color:white;"
        onmouseover="this.style.transform='scale(1.05)';"
        onmouseout="this.style.transform='scale(1)';">
        <i class="fa-solid fa-robot" style="font-size: 24px;"></i>
      </button>
    `;
    document.body.appendChild(fab);
  }
  fab.onclick = function() {
    window.isChatbotOpen = true;
    updateChatbotUI();
  };
  let modal = document.getElementById('chatbot-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'chatbot-modal';
    modal.style.position = 'fixed';
    modal.style.inset = '0';
    modal.style.zIndex = '100000';
    modal.style.background = 'transparent';
    modal.style.display = 'none';
    modal.style.pointerEvents = 'none';
    modal.innerHTML = `
      <div class="chatbot-window" style="background:var(--chat-bg,#ffffff);max-width:720px;width:92vw;min-height:520px;max-height:85vh;border-radius:24px;box-shadow:0 10px 40px rgba(0,0,0,0.18),0 0 0 1px rgba(0,0,0,0.05);position:absolute;bottom:44px;display:flex;flex-direction:column;overflow:hidden;pointer-events:auto;">
        <div style="position:absolute;top:18px;right:58px;z-index:11;">
          <button id="chatbot-position-toggle-btn" title="切换位置" style="width:32px;height:32px;border-radius:16px;border:none;background:rgba(0,0,0,0.06);color:#666;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all 0.2s;box-shadow:0 2px 6px rgba(0,0,0,0.06);" onmouseover="this.style.background='rgba(0,0,0,0.1)';this.style.transform='scale(1.05)'" onmouseout="this.style.background='rgba(0,0,0,0.06)';this.style.transform='scale(1)'">
            {/* Icon will be set by updateChatbotUI */}
          </button>
        </div>
        <div style="position:absolute;top:18px;right:18px;z-index:10;">
          <button id="chatbot-close-btn" style="width:32px;height:32px;border-radius:16px;border:none;background:rgba(0,0,0,0.06);color:#666;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all 0.2s;box-shadow:0 2px 6px rgba(0,0,0,0.06);" onmouseover="this.style.background='rgba(0,0,0,0.1)';this.style.transform='scale(1.05)'" onmouseout="this.style.background='rgba(0,0,0,0.06)';this.style.transform='scale(1)'">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        <div style="padding:20px 24px 16px 24px;display:flex;align-items:center;gap:8px;border-bottom:1px dashed rgba(0,0,0,0.1);">
          <div style="width:36px;height:36px;border-radius:18px;background:linear-gradient(135deg,#3b82f6,#1d4ed8);display:flex;align-items:center;justify-content:center;">
            <i class="fa-solid fa-robot" style="font-size: 16px; color: white;"></i>
          </div>
          <span style="font-weight:600;font-size:1.15em;color:#111;">AI 智能助手</span>
        </div>
        <div style="padding:16px 20px 0 20px;flex:1;display:flex;flex-direction:column;max-height:calc(85vh - 146px);overflow:hidden;">
          <div id="chatbot-preset" style="margin-bottom:16px;display:flex;flex-wrap:wrap;gap:6px 8px;opacity:1;max-height:300px;transition:opacity 0.3s, max-height 0.5s;">
            ${(window.ChatbotPreset && window.ChatbotPreset.PRESET_QUESTIONS ? window.ChatbotPreset.PRESET_QUESTIONS : [
              '总结本文', '有哪些关键公式？', '研究背景与意义？', '研究方法及发现？',
              '应用与前景？', '用通俗语言解释全文', '生成思维导图🧠', '生成流程图🔄'
            ]).map(q => `
              <button style="background:linear-gradient(to bottom, rgba(240,249,255,0.95), rgba(224,242,254,0.95));color:#0369a1;border-radius:20px;border:1px dashed rgba(125,211,252,0.4);padding:4px 10px;font-size:12px;font-weight:500;cursor:pointer;transition:all 0.2s;margin:2px 0;"
                onmouseover="this.style.transform='translateY(-1px)';"
                onmouseout="this.style.transform='translateY(0)';"
                onclick="window.handlePresetQuestion(decodeURIComponent('${encodeURIComponent(q)}'))"
              >${q}</button>
            `).join('')}
          </div>
          <div id="chatbot-body" style="flex:1;overflow-y:auto;padding-right:6px;margin-right:-6px;padding-bottom:10px;scrollbar-width:thin;scrollbar-color:#ddd transparent;scroll-behavior:smooth;"></div>
        </div>

        <div id="chatbot-input-container" style="padding:0px 20px 16px 20px;border-top:1px dashed rgba(0,0,0,0.1);background:rgba(249,250,251,0.7);">
          <div id="chatbot-selected-images-preview" style="display:none;gap:8px;padding-bottom:8px;flex-wrap:wrap;">
            <!-- Selected images will be previewed here by updateSelectedImagesPreview -->
          </div>
          <div style="display:flex;align-items:center;gap:12px;">
            <button id="chatbot-add-image-btn" title="添加图片"
              style="background:transparent; border:2px dashed #e2e8f0; color:#3b82f6; height:44px; width:44px; border-radius:22px; display:flex; align-items:center; justify-content:center; cursor:pointer; transition:all 0.2s; flex-shrink:0;"
              onmouseover="this.style.borderColor='#3b82f6';"
              onmouseout="this.style.borderColor='#e2e8f0';"
              onclick="ChatbotUI.openImageSelectionModal()">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
            </button>
            <div style="position:relative;flex:1;">
              <input id="chatbot-input" type="text" placeholder="请输入问题..."
                style="width:100%;height:44px;border-radius:22px;border:2px dashed #e2e8f0;background:white;padding:0 16px;font-size:15px;transition:all 0.2s;outline:none;box-sizing:border-box;"
                onkeydown="if(event.key==='Enter'){window.handleChatbotSend();}"
                onfocus="this.style.borderColor='#3b82f6';this.style.boxShadow='0 0 0 3px rgba(59,130,246,0.25)'"
                onblur="this.style.borderColor='#e2e8f0';this.style.boxShadow='none'"
              />
            </div>
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
          <div style="margin-top:10px;text-align:center;font-size:12px;color:#6b7280;padding:0 10px;">
            <p style="margin:0;">AI助手可能会犯错。请核实重要信息。</p>
          </div>
        </div>
      </div>
      <style>
        #chatbot-body::-webkit-scrollbar {width:6px;background:transparent;}
        #chatbot-body::-webkit-scrollbar-thumb {background:rgba(0,0,0,0.1);border-radius:6px;}
        #chatbot-body::-webkit-scrollbar-thumb:hover {background:rgba(0,0,0,0.15);}
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
          .message-actions {
            opacity: 0.9 !important;
          }
        }
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
  document.getElementById('chatbot-position-toggle-btn').onclick = function() {
    window.isChatbotPositionedLeft = !window.isChatbotPositionedLeft;
    localStorage.setItem('chatbotPosition', window.isChatbotPositionedLeft ? 'left' : 'right');
    updateChatbotUI();
  };
  document.getElementById('chatbot-close-btn').onclick = function() {
    window.isChatbotOpen = false;
    updateChatbotUI();
  };
  updateChatbotUI();
}