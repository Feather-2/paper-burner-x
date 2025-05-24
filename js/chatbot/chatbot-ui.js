// chatbot-ui.js

/**
 * 全局函数，用于强制聊天机器人界面弹出（或切换到）模型选择器。
 * 当需要用户在进行下一步操作前必须选择一个模型时调用。
 * 它会设置 `window.isModelSelectorOpen = true` 并调用 `ChatbotUI.updateChatbotUI` 来刷新界面。
 */
window.showModelSelectorForChatbot = function() {
  window.isModelSelectorOpen = true;
  if (typeof window.ChatbotUI === 'object' && typeof window.ChatbotUI.updateChatbotUI === 'function') {
    window.ChatbotUI.updateChatbotUI();
  }
};

// ====== Mermaid.js 动态引入（仅加载一次） ======
if (typeof window.mermaidLoaded === 'undefined') {
  window.mermaidLoaded = false; // Initialize to false
  const script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/mermaid@10.9.0/dist/mermaid.min.js'; // Using a specific recent version
  script.onload = function() {
    window.mermaidLoaded = true;
    if (window.mermaid) {
      // Initialize Mermaid. `startOnLoad: false` is important because we will
      // call mermaid.init() or mermaid.run() explicitly when content is ready.
      window.mermaid.initialize({ startOnLoad: false });
      console.log('Mermaid.js dynamically loaded and initialized.');
    }
  };
  script.onerror = function() {
    console.error('Failed to load Mermaid.js dynamically.');
    // Optionally, set mermaidLoaded to a specific error state or keep false
  };
  document.head.appendChild(script);
}

window.isChatbotPositionedLeft = localStorage.getItem('chatbotPosition') === 'left' || false;

/**
 * 处理聊天机器人发送按钮的点击事件。
 * 获取输入框内容，如果内容非空，则清空输入框并调用 `ChatbotCore.sendChatbotMessage` 发送消息。
 * 新增：支持发送图片。
 */
function handleChatbotSend() {
  const input = document.getElementById('chatbot-input');
  if (!input) return;
  let val = input.value.trim();

  // 获取已选择的图片 (假设图片选择后存储在 window.selectedChatbotImages)
  const selectedImages = window.selectedChatbotImages || [];

  if (!val && selectedImages.length === 0) return; // 文本和图片都为空则不发送

  let messageContent = [];
  let displayMessageContent = []; // 用于UI显示，可能包含原始图片引用而非base64

  if (val) {
    messageContent.push({ type: 'text', text: val });
    displayMessageContent.push({ type: 'text', text: val });
  }

  selectedImages.forEach(img => {
    // img 对象期望有 fullBase64 和 optional: originalSrc 用于显示
    if (img.fullBase64) {
      messageContent.push({
        type: 'image_url',
        image_url: { url: img.fullBase64 }
      });
      displayMessageContent.push({
        type: 'image_url',
        image_url: {
          url: img.thumbnailBase64 || img.fullBase64, // For inline display
          fullUrl: img.fullBase64, // For modal display
          originalSrc: img.originalSrc
        }
      });
    }
  });

  // 如果只有一个文本部分，则直接发送文本字符串，以兼容旧的单模态模型
  let sendVal = messageContent.length === 1 && messageContent[0].type === 'text' ? messageContent[0].text : messageContent;
  let displayVal = displayMessageContent.length === 1 && displayMessageContent[0].type === 'text' ? displayMessageContent[0].text : displayMessageContent;

  // 拼接详细Mermaid提示词，但只发给AI
  if (typeof sendVal === 'string' && sendVal.includes('流程图') && !sendVal.includes('Mermaid语法')) {
    sendVal += `
请用Mermaid语法输出流程图，节点用[]包裹，箭头用-->连接。
- 每一条流程图语句必须单独一行，不能多条语句写在一行。
- 节点内容必须全部在一行内，不能有任何换行、不能有 <br>、不能有 \\n。
- 不允许在节点内容中出现任何 HTML 标签或特殊符号，只能用纯文本和英文括号。
- **每个节点都必须有连线，不能有孤立节点。**
- 如果文档内容有分支、并行、循环等，请在流程图中体现出来，不要只画一条直线。
- 如需使用subgraph，必须严格遵守Mermaid语法，subgraph必须单独一行，内容缩进，最后用end结束。
- 只输出代码块，不要解释，不要输出除代码块以外的任何内容。
- 例如：
\`\`\`mermaid
graph TD
A[开始] --> B{条件判断}
B -- 是 --> C[处理1]
B -- 否 --> D[处理2]
subgraph 参与者流程
  C --> E[结束]
  D --> E
end
\`\`\`
`;
  } else if (Array.isArray(sendVal)) {
    const textPartIndex = sendVal.findIndex(p => p.type === 'text');
    if (textPartIndex !== -1 && sendVal[textPartIndex].text.includes('流程图') && !sendVal[textPartIndex].text.includes('Mermaid语法')) {
      sendVal[textPartIndex].text += `
请用Mermaid语法输出流程图，节点用[]包裹，箭头用-->连接。
- 每一条流程图语句必须单独一行，不能多条语句写在一行。
- 节点内容必须全部在一行内，不能有任何换行、不能有 <br>、不能有 \\n。
- 不允许在节点内容中出现任何 HTML 标签或特殊符号，只能用纯文本和英文括号。
- **每个节点都必须有连线，不能有孤立节点。**
- 如果文档内容有分支、并行、循环等，请在流程图中体现出来，不要只画一条直线。
- 如需使用subgraph，必须严格遵守Mermaid语法，subgraph必须单独一行，内容缩进，最后用end结束。
- 只输出代码块，不要解释，不要输出除代码块以外的任何内容。
- 例如：
\`\`\`mermaid
graph TD
A[开始] --> B{条件判断}
B -- 是 --> C[处理1]
B -- 否 --> D[处理2]
subgraph 参与者流程
  C --> E[结束]
  D --> E
end
\`\`\`
`;
    }
  }


  input.value = '';
  window.selectedChatbotImages = []; // 清空已选择的图片
  updateSelectedImagesPreview(); // 更新选择图片的预览区域

  window.ChatbotCore.sendChatbotMessage(sendVal, updateChatbotUI, null, displayVal);
}

/**
 * 处理预设问题的点击事件 (UI层面封装)。
 * 将预设问题填充到输入框，并调用 `handleChatbotSend` 发送。
 * @param {string} q 预设问题文本。
 */
function handlePresetQuestion(q) {
  const input = document.getElementById('chatbot-input');
  if (!input) return;
  input.value = q;
  handleChatbotSend();
}

/**
 * 更新聊天机器人界面的核心函数。
 * 根据 `window.isChatbotOpen` 状态控制聊天窗口 (modal) 和浮动按钮 (fab) 的显隐。
 * 动态渲染聊天消息列表、预设问题、以及自定义模型的模型选择器（如果适用）。
 *
 * 主要逻辑：
 * 1. **显隐控制**：根据 `isChatbotOpen` 控制 modal 和 fab 的 `display` 样式。
 * 2. **模型信息获取**：调用 `ChatbotCore.getChatbotConfig` 获取当前模型配置，判断是否为自定义模型 (`isCustomModel`)，并获取可用模型列表 (`availableModels`)。
 * 3. **齿轮按钮与模型选择模式** (`window.isModelSelectorOpen`)：
 *    - 如果是自定义模型，则显示一个齿轮按钮，点击可进入模型选择模式。
 *    - 如果进入模型选择模式 (`isModelSelectorOpen` 为 true)：
 *      - 构建并显示模型选择界面 (`chatbot-model-selector`)，包含一个下拉列表供用户选择模型。
 *      - 从 `availableModels` 或 `localStorage.availableCustomModels` 加载模型列表。
 *      - 默认选中 `settings.selectedCustomModelId` 或 `localStorage.lastSelectedCustomModel` 或列表中的第一个模型。
 *      - 监听下拉框的 `onchange` 事件，将选择的模型 ID 保存到 `localStorage.lastSelectedCustomModel` 和主设置中。
 *      - 提供"返回"按钮，点击后退出模型选择模式，恢复聊天界面。
 *      - 在模型选择模式下，隐藏预设问题和聊天内容区域。
 * 4. **聊天消息渲染**：
 *    - 遍历 `ChatbotCore.chatHistory` 数组。
 *    - 根据消息的 `role` ('user', 'assistant', 'segment-summary', 'final-summary') 和特性 (`hasMindMap`) 渲染不同的 HTML 结构。
 *    - 用户消息靠右显示，助手消息靠左显示。
 *    - 助手消息支持 Markdown 解析 (使用 `marked.js` 和 `katex`，带回退机制) 和代码高亮。
 *    - 如果消息包含思维导图 (`hasMindMap`)，则渲染一个模糊的思维导图预览 (`renderMindmapShadow`) 和一个"放大查看/编辑"按钮。
 *    - 助手消息为空（流式思考中）时，显示"思考中..."提示。
 *    - 为每条助手消息添加复制内容和导出为PNG的按钮。
 *    - 如果 `ChatbotCore.isChatbotLoading` 为 true，显示打字动画加载指示器。
 *    - 添加 CSS 样式美化 Markdown 内容。
 *    - 自动滚动聊天区域到底部。
 * 5. **输入框与发送按钮状态更新**：根据 `ChatbotCore.isChatbotLoading` 状态启用/禁用输入框和发送按钮。
 */
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
    // 添加右边距，防止与齿轮按钮接触
    chatbotPreset.style.paddingRight = '40px';

    // 修改第二个问题：将预设问题消失的条件从2个问题改为3个问题
    if (userMessageCount >= 3 && !window.isModelSelectorOpen) {
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

  // ========== 新增：齿轮按钮和模型选择模式 ===========
  if (!window.isModelSelectorOpen) window.isModelSelectorOpen = false;
  // 齿轮按钮
  let gearBtn = document.getElementById('chatbot-model-gear-btn');
  if (gearBtn) gearBtn.remove();
  if (isCustomModel && chatbotPreset) {
    gearBtn = document.createElement('button');
    gearBtn.id = 'chatbot-model-gear-btn';
    gearBtn.title = '选择模型';
    gearBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.5"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 8 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 5 15.4a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 8a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 8 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09A1.65 1.65 0 0 0 16 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 8c.14.31.22.65.22 1v.09A1.65 1.65 0 0 0 21 12c0 .35-.08.69-.22 1z"/></svg>`;
    gearBtn.style.background = 'none';
    gearBtn.style.border = 'none';
    gearBtn.style.position = 'absolute';
    gearBtn.style.top = '24px';
    gearBtn.style.right = '20px';
    gearBtn.style.cursor = 'pointer';
    gearBtn.style.padding = '4px';
    gearBtn.style.borderRadius = '50%';
    gearBtn.style.transition = 'background 0.2s';
    gearBtn.onmouseover = function(){this.style.background='#e0e7ef';};
    gearBtn.onmouseout = function(){this.style.background='none';};
    gearBtn.onclick = function(){window.isModelSelectorOpen = true; updateChatbotUI();};
    chatbotPreset.parentNode.style.position = 'relative';
    chatbotPreset.parentNode.appendChild(gearBtn);
  }
  // 只显示模型选择界面
  if (isCustomModel && window.isModelSelectorOpen) {
    let models = availableModels;
    if (!Array.isArray(models) || models.length === 0) models = [];
    // 获取主设置区的模型ID
    let settings = {};
    try {
      settings = typeof loadSettings === 'function' ? loadSettings() : {};
    } catch (e) {}
    let defaultModelId = settings.selectedCustomModelId || localStorage.getItem('lastSelectedCustomModel') || (models[0]?.id || models[0] || '');
    // 构建下拉框
    modelSelectorDiv = document.createElement('div');
    modelSelectorDiv.id = 'chatbot-model-selector';
    modelSelectorDiv.style.margin = '40px auto 0 auto';
    modelSelectorDiv.style.maxWidth = '340px';
    modelSelectorDiv.style.background = 'linear-gradient(135deg,#f0f9ff 80%,#e0f2fe 100%)';
    modelSelectorDiv.style.border = '2px dashed #93c5fd';
    modelSelectorDiv.style.borderRadius = '16px';
    modelSelectorDiv.style.padding = '32px 24px 24px 24px';
    modelSelectorDiv.style.boxShadow = '0 4px 24px #2563eb11';
    // 读取温度和max_tokens默认值
    let defaultTemperature = 0.5;
    let defaultMaxTokens = 8000;
    try {
      if (settings.customModelSettings) {
        if (typeof settings.customModelSettings.temperature === 'number') {
          defaultTemperature = settings.customModelSettings.temperature;
        }
        if (typeof settings.customModelSettings.max_tokens === 'number') {
          defaultMaxTokens = settings.customModelSettings.max_tokens;
        }
      }
    } catch (e) {}
    modelSelectorDiv.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:18px;justify-content:center;">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.5"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 8 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 5 15.4a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 8a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 8 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09A1.65 1.65 0 0 0 16 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 8c.14.31.22.65.22 1v.09A1.65 1.65 0 0 0 21 12c0 .35-.08.69-.22 1z"/></svg>
        <span style="font-size:17px;font-weight:700;color:#2563eb;">选择自定义模型</span>
      </div>
      <select id="chatbot-model-select" style="width:100%;margin:18px 0 0 0;padding:12px 16px;border-radius:10px;border:2px solid #93c5fd;background:white;color:#1e3a8a;font-size:15px;font-weight:600;outline:none;transition:all 0.2s;">
        ${models.length === 0 ? '<option value="">（无可用模型）</option>' : models.map(m => {
          if (typeof m === 'string') {
            return `<option value="${m}" ${m===defaultModelId?'selected':''}>${m}</option>`;
          } else if (typeof m === 'object' && m) {
            return `<option value="${m.id}" ${m.id===defaultModelId?'selected':''}>${m.name || m.id}</option>`;
          } else {
            return '';
          }
        }).join('')}
      </select>
      <div style="margin-top:22px;margin-bottom:10px;">
        <div style="font-size:14px;color:#1e3a8a;font-weight:500;display:flex;align-items:center;justify-content:space-between;">
          <span>温度（temperature）</span>
          <span style="font-size:12px;color:#64748b;font-weight:400;">（0=更确定，1=更随机）</span>
        </div>
        <div style='display:flex;align-items:center;gap:10px;margin-top:8px;'>
          <input id="chatbot-temp-range" type="range" min="0" max="1" step="0.01" value="${defaultTemperature}" style="flex:1;" />
          <input id="chatbot-temp-input" type="number" min="0" max="1" step="0.01" value="${defaultTemperature}" style="width:60px;padding:4px 6px;border-radius:6px;border:1.5px solid #93c5fd;font-size:14px;" />
        </div>
      </div>
      <div style="margin-bottom:18px;">
        <div style="font-size:14px;color:#1e3a8a;font-weight:500;display:flex;align-items:center;justify-content:space-between;">
          <span>回复长度（max_tokens）</span>
          <span style="font-size:12px;color:#64748b;font-weight:400;">（最大输出Token数）</span>
        </div>
        <div style='display:flex;align-items:center;gap:10px;margin-top:8px;'>
          <input id="chatbot-maxtokens-range" type="range" min="256" max="32768" step="64" value="${defaultMaxTokens}" style="flex:1;" />
          <input id="chatbot-maxtokens-input" type="number" min="256" max="32768" step="1" value="${defaultMaxTokens}" style="width:80px;padding:4px 6px;border-radius:6px;border:1.5px solid #93c5fd;font-size:14px;" />
        </div>
      </div>
      <button id="chatbot-model-back-btn" style="margin-top:8px;width:100%;padding:10px 0;font-size:15px;font-weight:600;background:linear-gradient(90deg,#3b82f6,#2563eb);color:white;border:none;border-radius:8px;box-shadow:0 2px 8px #2563eb22;cursor:pointer;transition:all 0.2s;">返回</button>
    `;
    // 隐藏预设问题和聊天内容
    chatbotPreset.style.display = 'none';
    if (chatBody) chatBody.style.display = 'none';
    // 插入模型选择div
    modal.querySelector('.chatbot-window').insertBefore(modelSelectorDiv, modal.querySelector('.chatbot-window').children[3]);
    // 监听选择
    const select = document.getElementById('chatbot-model-select');
    if (select) {
      select.onchange = function() {
        localStorage.setItem('lastSelectedCustomModel', this.value);
        // 同步写入主设置区
        let settings = {};
        try {
          settings = typeof loadSettings === 'function' ? loadSettings() : {};
        } catch (e) {}
        settings.selectedCustomModelId = this.value;
        if (typeof saveSettings === 'function') {
          saveSettings(settings);
        } else {
          localStorage.setItem('paperBurnerSettings', JSON.stringify(settings));
        }
      };
    }
    // 滑块与输入框联动及保存
    const tempInput = document.getElementById('chatbot-temp-input');
    const tempRange = document.getElementById('chatbot-temp-range');
    const maxTokensInput = document.getElementById('chatbot-maxtokens-input');
    const maxTokensRange = document.getElementById('chatbot-maxtokens-range');
    function saveCustomModelParams() {
      let settings = {};
      try {
        settings = typeof loadSettings === 'function' ? loadSettings() : {};
      } catch (e) {}
      if (!settings.customModelSettings) settings.customModelSettings = {};
      let t = parseFloat(tempInput.value);
      if (isNaN(t) || t < 0) t = 0;
      if (t > 1) t = 1;
      let m = parseInt(maxTokensInput.value);
      if (isNaN(m) || m < 256) m = 256;
      if (m > 32768) m = 32768;
      tempInput.value = t;
      tempRange.value = t;
      maxTokensInput.value = m;
      maxTokensRange.value = m;
      settings.customModelSettings.temperature = t;
      settings.customModelSettings.max_tokens = m;
      if (typeof saveSettings === 'function') {
        saveSettings(settings);
      } else {
        localStorage.setItem('paperBurnerSettings', JSON.stringify(settings));
      }
    }
    if (tempInput && tempRange) {
      tempInput.oninput = function() { tempRange.value = tempInput.value; saveCustomModelParams(); };
      tempRange.oninput = function() { tempInput.value = tempRange.value; saveCustomModelParams(); };
    }
    if (maxTokensInput && maxTokensRange) {
      maxTokensInput.oninput = function() { maxTokensRange.value = maxTokensInput.value; saveCustomModelParams(); };
      maxTokensRange.oninput = function() { maxTokensInput.value = maxTokensRange.value; saveCustomModelParams(); };
    }
    // 返回按钮
    const backBtn = document.getElementById('chatbot-model-back-btn');
    if (backBtn) {
      backBtn.onclick = function() {
        window.isModelSelectorOpen = false;
        if (modelSelectorDiv) modelSelectorDiv.remove();
        if (chatbotPreset) chatbotPreset.style.display = '';
        if (chatBody) chatBody.style.display = '';
        updateChatbotUI();
      };
    }
    return;
  } else {
    // 退出模型选择模式时，确保内容显示
    if (chatbotPreset) chatbotPreset.style.display = '';
    if (chatBody) chatBody.style.display = '';
  }
  if (chatBody) {
    chatBody.innerHTML = window.ChatbotCore.chatHistory.map((m, index) => {
      if (m.role === 'segment-summary') {
        return '';
      }
      if (m.role === 'final-summary') {
        return `
          <div style="display:flex;justify-content:flex-start;margin-bottom:16px;padding-right:20%;">
            <div style="background:linear-gradient(to bottom, #dbeafe, #bfdbfe);color:#1e3a8a;padding:12px 16px;border-radius:4px 18px 18px 18px;font-size:15px;line-height:1.5;box-shadow:0 2px 8px rgba(59,130,246,0.08);border:1px solid #93c5fd;position:relative;">
              <div style="font-weight:bold;margin-bottom:4px;">最终汇总</div>
              <div class="markdown-content">${window.ChatbotUtils.escapeHtml(m.content).replace(/\n/g, '<br>')}</div>
            </div>
          </div>
        `;
      }
      if (m.role === 'user') {
        let userMessageHtml = '';
        if (Array.isArray(m.content)) { // Multimodal user message
          m.content.forEach(part => {
            if (part.type === 'text') {
              userMessageHtml += `<div style="margin-bottom:5px;">${window.ChatbotUtils.escapeHtml(part.text)}</div>`;
            } else if (part.type === 'image_url' && part.image_url && part.image_url.url) {
              // Display a small thumbnail for user-sent images
              const imageUrlForModal = part.image_url.fullUrl || part.image_url.url; // Prefer fullUrl for modal
              userMessageHtml += `
                <div style="margin-bottom:5px; max-width: 200px; max-height:200px; overflow:hidden; border-radius: 8px; border: 1px solid #ddd;">
                  <img src="${part.image_url.url}" alt="用户图片" style="display:block; width:auto; height:auto; max-width:100%; max-height:100%; object-fit:contain; cursor:pointer;" onclick="ChatbotUI.showImageModal('${imageUrlForModal}')">
                </div>`;
            }
          });
        } else { // Plain text user message
          userMessageHtml = window.ChatbotUtils.escapeHtml(m.content);
        }

        return `
          <div style="display:flex;justify-content:flex-end;margin-bottom:16px;padding-left:20%;">
            <div style="background:linear-gradient(135deg, #3b82f6, #2563eb);color:white;padding:12px 16px;border-radius:18px 4px 18px 18px;font-size:15px;line-height:1.5;border:2px solid #3b82f6; max-width: 80%;">
              ${userMessageHtml}
            </div>
          </div>
        `;
      } else {
        let renderedContent = '';
        // markmap预览渲染逻辑
        if (m.hasMindMap && m.mindMapData) {
          // 预览容器ID唯一
          const previewId = `mindmap-markmap-preview-${index}`;
          // 渲染前做兜底，必须有二级标题
          let safeMindMapData = m.mindMapData;
          if (!safeMindMapData.trim() || !/^#/.test(safeMindMapData.trim()) || !/\n##?\s+/.test(safeMindMapData)) {
            safeMindMapData = '# 思维导图\n\n暂无结构化内容';
          }
          // 新增：渲染虚影思维导图
          renderedContent = `
            <div style="position:relative;">
              <div style="width:100%;max-height:180px;overflow-y:auto;height:auto;max-width:100%;border-radius:10px;box-shadow:0 2px 12px #0001;filter:blur(2px);background:#f8fafc;padding:16px 8px 8px 8px;">
                ${renderMindmapShadow(safeMindMapData)}
              </div>
              <div style="position:absolute;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;z-index:2;">
                <button onclick=\"window.open('mindmap.html?docId=${encodeURIComponent(window.ChatbotCore.getCurrentDocContent().name || 'unknown')}_'+((window.data.images||[]).length)+'_'+((window.data.ocr||'').length)+'_'+((window.data.translation||'').length),'_blank')\" style="padding:10px 22px;font-size:15px;background:rgba(59,130,246,0.92);color:#fff;border:none;border-radius:8px;box-shadow:0 2px 8px rgba(59,130,246,0.12);cursor:pointer;">放大查看/编辑思维导图</button>
              </div>
            </div>
          `;
        } else {
          // 新增：流式思考时content为空，显示思考中
          if (m.role === 'assistant' && (!m.content || m.content.trim() === '')) {
            renderedContent = '<span style="color:#6b7280;">思考中...</span>';
          } else {
            try {
              if (typeof marked !== 'undefined' && typeof katex !== 'undefined') {
                if (typeof renderWithKatexFailback === 'function') {
                  renderedContent = renderWithKatexFailback(m.content);
                } else {
                  renderedContent = marked.parse(m.content);
                }
              } else {
                renderedContent = window.ChatbotUtils.escapeHtml(m.content).replace(/\n/g, '<br>');
              }
            } catch (e) {
              renderedContent = window.ChatbotUtils.escapeHtml(m.content).replace(/\n/g, '<br>');
            }
          }
        }
        return `
          <div style="display:flex;justify-content:flex-start;margin-bottom:16px;padding-right:20%;">
            <div style="background:linear-gradient(to bottom, #f9fafb, #f3f4f6);color:#111827;padding:12px 16px;border-radius:4px 18px 18px 18px;font-size:15px;line-height:1.5;box-shadow:0 2px 8px rgba(0,0,0,0.08);border:1px solid rgba(0,0,0,0.03);position:relative;">
              <div class="assistant-message" data-message-index="${index}">
                <div class="markdown-content" style="padding-top:22px;">${renderedContent}</div>
              </div>
              <div class="message-actions" style="position:absolute;top:8px;left:12px;display:flex;gap:6px;opacity:0.6;transition:opacity 0.2s;z-index:2;"
                   onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.6'">
                <button class="copy-btn" onclick="window.ChatbotUtils.copyAssistantMessage(${index})"
                        style="background:rgba(0,0,0,0.05);border:none;width:24px;height:24px;border-radius:4px;cursor:pointer;display:flex;align-items:center;justify-content:center;"
                        title="复制内容">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                  </svg>
                </button>
                <button class="export-png-btn" onclick="window.ChatbotUtils.exportMessageAsPng(${index})"
                        style="background:rgba(0,0,0,0.05);border:1px dashed #e2e8f0;width:24px;height:24px;border-radius:4px;cursor:pointer;display:flex;align-items:center;justify-content:center;"
                        title="导出为PNG">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                  </svg>
                </button>
              </div>
            </div>
          </div>
        `;
      }
    }).join('');
    if (window.ChatbotCore.isChatbotLoading) {
      chatBody.innerHTML += `
        <div style="display:flex;justify-content:flex-start;margin-bottom:16px;padding-right:80%;">
          <div style="background:linear-gradient(to bottom, #f9fafb, #f3f4f6);color:#6b7280;padding:10px 16px;border-radius:4px 18px 18px 18px;font-size:15px;line-height:1.5;border:2px dashed #e2e8f0;">
            <div class="typing-indicator" style="display:flex;align-items:center;gap:3px;">
              <span style="width:6px;height:6px;border-radius:50%;background:#9ca3af;animation:typingAnimation 1.4s infinite;animation-delay:0s;"></span>
              <span style="width:6px;height:6px;border-radius:50%;background:#9ca3af;animation:typingAnimation 1.4s infinite;animation-delay:0.2s;"></span>
              <span style="width:6px;height:6px;border-radius:50%;background:#9ca3af;animation:typingAnimation 1.4s infinite;animation-delay:0.4s;"></span>
            </div>
          </div>
        </div>
        <style>
          @keyframes typingAnimation {
            0%, 100% { transform:translateY(0); opacity:0.6; }
            50% { transform:translateY(-4px); opacity:1; }
          }
        </style>
      `;
    }
    chatBody.innerHTML += `
      <style>
        .markdown-content {overflow-x:auto;}
        .markdown-content p {margin:8px 0;}
        .markdown-content h1, .markdown-content h2, .markdown-content h3,
        .markdown-content h4, .markdown-content h5, .markdown-content h6 {margin-top:16px;margin-bottom:8px;font-weight:600;}
        .markdown-content h1 {font-size:1.5em;}
        .markdown-content h2 {font-size:1.3em;}
        .markdown-content h3 {font-size:1.2em;}
        .markdown-content code {background:rgba(0,0,0,0.05);padding:2px 4px;border-radius:4px;font-family:monospace;font-size:0.9em;}
        .markdown-content pre {background:rgba(0,0,0,0.05);padding:10px;border-radius:8px;overflow-x:auto;margin:10px 0;}
        .markdown-content pre code {background:transparent;padding:0;}
        .markdown-content ul, .markdown-content ol {margin:8px 0;padding-left:20px;}
        .markdown-content blockquote {border-left:3px solid #cbd5e1;padding-left:12px;color:#4b5563;margin:10px 0;}
        .markdown-content img {max-width:100%;height:auto;border-radius:6px;margin:8px 0;}
        .markdown-content a {color:#2563eb;text-decoration:underline;}
        .markdown-content table {border-collapse:collapse;width:100%;margin:12px 0;}
        .markdown-content th, .markdown-content td {border:1px solid #e5e7eb;padding:8px;}
        .markdown-content th {background:#f3f4f6;}
        .mermaid { margin: 12px 0; }
      </style>
    `;
    chatBody.scrollTop = chatBody.scrollHeight;

    // ====== Mermaid 渲染支持 ======
    /**
     * 渲染聊天内容中的所有 Mermaid 代码块。
     * 主要流程：
     * 1. 查找所有 code.language-mermaid 代码块。
     * 2. 对每个代码块：
     *    - 自动修正常见的 Mermaid 语法错误。
     *    - 创建新的 div.mermaid 容器，设置唯一ID。
     *    - 用 mermaid.init 渲染 SVG。
     *    - 渲染成功则显示 SVG，并添加"放大"按钮。
     *    - 渲染失败则回退显示上一次成功的 SVG，或显示错误信息。
     *    - 支持多次尝试渲染（异步加载 mermaid.js 时）。
     */
    function renderAllMermaidBlocks() {
      if (!window.mermaidLoaded || typeof window.mermaid === 'undefined') return;
      // 查找所有 mermaid 代码块（code.language-mermaid 或 pre code.language-mermaid）
      const mermaidBlocks = chatBody.querySelectorAll('code.language-mermaid, pre code.language-mermaid');
      mermaidBlocks.forEach(async (block, idx) => {
        try {
          // 自动修正 Mermaid 代码中的常见错误
          let rawCode = block.textContent;
          // 1. 将 <br> 标签替换为换行
          rawCode = rawCode.replace(/<br\s*\/?>/gi, '\n');
          // 2. 移除所有 HTML 标签
          rawCode = rawCode.replace(/<[^>]+>/g, '');
          // 3. 修正 ]end 拼写错误
          rawCode = rawCode.replace(/]end/g, ']\nend');
          // 4. 合并节点内容中的多余换行
          rawCode = rawCode.replace(/([\[{][^\]}{\[]*)(\n|\r|\r\n|\n)+([^\]}{\[]*[\]}])/g, function(match, p1, p2, p3) {
            return p1 + ' ' + p3;
          });
          // 5. 修正节点后紧跟新节点的换行
          rawCode = rawCode.replace(/([\\]\\}|\\])([A-Za-z0-9_\\-\\[\\{])/g, '$1\n$2');
          // 6. 移除节点内容中的括号
          rawCode = rawCode.replace(/(\[[^\]]*)\([^\)]*\)([^\]]*\])/g, '$1$2');
          rawCode = rawCode.replace(/(\{[^\}]*)\([^\)]*\)([^\}]*\})/g, '$1$2');
          // 7. 移除节点内容中的特殊符号和多余空格
          rawCode = rawCode.replace(/(\[[^\]]*\]|\{[^\}]*\})/g, function(match) {
            return match.replace(/[:|<>{};'"`\/\\\n\r\(\)]/g, '').replace(/\s+/g, ' ');
          });

          // 选择父节点（兼容 pre > code 或单独 code）
          let parent;
          try {
            parent = block.parentElement.tagName === 'PRE' ? block.parentElement : block;
          } catch (e) {
            parent = block; // 兜底
          }
          const code = rawCode;
          // 创建新的 Mermaid 渲染容器
          const mermaidDiv = document.createElement('div');
          const uniqueId = 'mermaid-' + Date.now() + '-' + idx + '-' + Math.floor(Math.random()*10000);
          mermaidDiv.className = 'mermaid';
          mermaidDiv.id = uniqueId;
          mermaidDiv.style.background = '#f8fafc';
          mermaidDiv.style.borderRadius = '8px';
          mermaidDiv.style.padding = '8px';
          mermaidDiv.textContent = code; // 先设置文本内容，供 mermaid 解析

          // 检查是否为空或无有效内容
          const codeTrimmed = code.replace(/\s+/g, '');
          if (!codeTrimmed || /^graph(TD|LR|RL|BT|TB)?$/i.test(codeTrimmed)) {
            mermaidDiv.innerHTML = '<div style="color:#64748b;">无有效Mermaid内容</div>';
            parent.replaceWith(mermaidDiv);
            return; // 跳过
          }

          // 记录上一次渲染成功的 SVG（用于回退）
          let lastSVG = null;
          if (parent.id && parent.id.startsWith('mermaid-') && parent.querySelector('svg')) {
            lastSVG = parent.querySelector('svg').cloneNode(true);
          } else if (parent.firstElementChild && parent.firstElementChild.id && parent.firstElementChild.id.startsWith('mermaid-') && parent.firstElementChild.querySelector('svg')){
            lastSVG = parent.firstElementChild.querySelector('svg').cloneNode(true);
          }

          // 用新的 mermaidDiv 替换原代码块
          parent.replaceWith(mermaidDiv);

          try {
            // 用 mermaid.init 渲染 SVG
            await window.mermaid.init(undefined, '#' + uniqueId);
            // 渲染成功，清除错误边框
            mermaidDiv.style.border = '';
            const existingWarning = mermaidDiv.querySelector('.mermaid-render-warning');
            if (existingWarning) existingWarning.remove();

            // 添加"放大"按钮，点击后弹窗显示大图
            setTimeout(() => {
              try {
                if (!mermaidDiv.querySelector('.mermaid-zoom-btn')) {
                  const zoomBtn = document.createElement('button');
                  zoomBtn.className = 'mermaid-zoom-btn';
                  zoomBtn.textContent = '放大';
                  zoomBtn.title = '放大查看';
                  zoomBtn.style.cssText = `
                    position:absolute;top:8px;right:12px;z-index:1002;
                    background:rgba(243,244,246,0.92);color:#64748b;
                    border:none;border-radius:6px;padding:1px 8px;
                    font-size:12px;cursor:pointer;opacity:0.85;
                    height:22px;line-height:20px;
                    transition:all 0.18s;box-shadow:0 1px 4px #0001;
                  `;
                  zoomBtn.onclick = function() {
                    try {
                      // 创建遮罩和弹窗，显示 SVG 大图
                      const overlay = document.createElement('div');
                      overlay.style.cssText = 'position:fixed;z-index:999999;left:0;top:0;width:100vw;height:100vh;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;';
                      const popup = document.createElement('div');
                      popup.style.cssText = 'background:#fff;padding:32px 24px 24px 24px;border-radius:16px;box-shadow:0 8px 32px #0002;max-width:98vw;max-height:98vh;overflow:auto;position:relative;display:flex;flex-direction:column;align-items:center;';
                      const title = document.createElement('div');
                      title.textContent = 'Mermaid 图表预览';
                      title.style.cssText = 'font-weight:bold;font-size:18px;margin-bottom:18px;';
                      popup.appendChild(title);
                      const svgInMermaidDiv = mermaidDiv.querySelector('svg');
                      if (svgInMermaidDiv) {
                        const svgClone = svgInMermaidDiv.cloneNode(true);
                        svgClone.style.width = '90vw';
                        svgClone.style.maxWidth = '1200px';
                        svgClone.style.height = 'auto';
                        svgClone.style.maxHeight = '80vh';
                        svgClone.style.display = 'block';
                        svgClone.style.margin = '0 auto';
                        popup.appendChild(svgClone);

                        // 添加导出图片按钮
                        const exportBtn = document.createElement('button');
                        exportBtn.textContent = '导出高清图片';
                        exportBtn.style.cssText = 'margin-top:18px;background:#3b82f6;color:#fff;border:none;border-radius:8px;padding:8px 20px;cursor:pointer;font-size:14px;display:flex;align-items:center;gap:6px;transition:all 0.2s;box-shadow:0 2px 8px rgba(59,130,246,0.25);';
                        exportBtn.onmouseover = function() { this.style.transform = 'translateY(-2px)'; this.style.boxShadow = '0 4px 12px rgba(59,130,246,0.35)'; };
                        exportBtn.onmouseout = function() { this.style.transform = 'translateY(0)'; this.style.boxShadow = '0 2px 8px rgba(59,130,246,0.25)'; };

                        // 添加下载图标
                        exportBtn.innerHTML = `
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="7 10 12 15 17 10"/>
                            <line x1="12" y1="15" x2="12" y2="3"/>
                          </svg>
                          导出高清图片
                        `;

                        // 导出按钮点击事件 - 转换SVG为高清PNG
                        exportBtn.onclick = function() {
                          try {
                            // 显示加载提示
                            const loadingToast = document.createElement('div');
                            loadingToast.textContent = '正在处理图片...';
                            loadingToast.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#3b82f6;color:white;padding:8px 16px;border-radius:8px;font-size:14px;z-index:1000000;box-shadow:0 4px 12px rgba(0,0,0,0.15);';
                            document.body.appendChild(loadingToast);

                            // 创建临时Canvas用于渲染SVG
                            const svgElement = svgClone;

                            // 获取SVG的尺寸
                            const svgRect = svgElement.getBoundingClientRect();
                            const width = svgRect.width || 800;
                            const height = svgRect.height || 600;

                            // 计算3倍分辨率的尺寸
                            const scale = 3; // 3x高清
                            const scaledWidth = Math.round(width * scale);
                            const scaledHeight = Math.round(height * scale);

                            // 创建canvas元素
                            const canvas = document.createElement('canvas');
                            canvas.width = scaledWidth;
                            canvas.height = scaledHeight;
                            const ctx = canvas.getContext('2d');

                            // 设置白色背景
                            ctx.fillStyle = 'white';
                            ctx.fillRect(0, 0, scaledWidth, scaledHeight);

                            // 确保SVG具有正确的尺寸和视口
                            const originalViewBox = svgElement.getAttribute('viewBox');
                            if (!originalViewBox) {
                              svgElement.setAttribute('viewBox', `0 0 ${width} ${height}`);
                            }

                            // 设置宽高属性（如果没有）
                            if (!svgElement.getAttribute('width')) {
                              svgElement.setAttribute('width', width);
                            }
                            if (!svgElement.getAttribute('height')) {
                              svgElement.setAttribute('height', height);
                            }

                            // 将SVG转换为XML字符串
                            const serializer = new XMLSerializer();
                            let svgString = serializer.serializeToString(svgElement);

                            // 添加XML和DOCTYPE声明
                            svgString = '<?xml version="1.0" standalone="no"?>\n' + svgString;

                            // 确保所有的CSS都内联到SVG中
                            svgString = svgString.replace(/<svg/g,
                              '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"');

                            // 使用Base64编码SVG
                            const svgBase64 = btoa(unescape(encodeURIComponent(svgString)));
                            const imgSrc = `data:image/svg+xml;base64,${svgBase64}`;

                            // 加载图像并绘制到Canvas
                            const img = new Image();
                            img.onload = function() {
                              // 清除canvas并以3x比例绘制
                              ctx.clearRect(0, 0, scaledWidth, scaledHeight);
                              ctx.fillStyle = 'white';
                              ctx.fillRect(0, 0, scaledWidth, scaledHeight);
                              ctx.scale(scale, scale);
                              ctx.drawImage(img, 0, 0);

                              try {
                                // 转换Canvas为PNG并下载
                                const pngUrl = canvas.toDataURL('image/png');

                                if (pngUrl.length <= 22) { // "data:image/png;base64," 的长度
                                  throw new Error('图像生成失败，请尝试其他方法');
                                }

                                const downloadLink = document.createElement('a');
                                downloadLink.href = pngUrl;
                                downloadLink.download = 'mermaid-diagram-hd.png';
                                document.body.appendChild(downloadLink);
                                downloadLink.click();
                                document.body.removeChild(downloadLink);

                                // 移除加载提示并显示成功提示
                                document.body.removeChild(loadingToast);

                                const toast = document.createElement('div');
                                toast.textContent = '高清图片导出成功！';
                                toast.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#10b981;color:white;padding:8px 16px;border-radius:8px;font-size:14px;z-index:1000000;box-shadow:0 4px 12px rgba(0,0,0,0.15);';
                                document.body.appendChild(toast);
                                setTimeout(() => document.body.removeChild(toast), 3000);
                              } catch (e) {
                                document.body.removeChild(loadingToast);
                                alert('导出图片失败: ' + (e.message || e) + '\n请尝试截图另存为图片');
                              }
                            };

                            img.onerror = function(err) {
                              document.body.removeChild(loadingToast);
                              console.error('图片加载失败:', err);
                              alert('图片导出失败: 图像处理错误\n请尝试截图另存为图片');
                            };

                            // 设置图像源触发加载
                            img.src = imgSrc;

                            // 添加后备方法，使用 html2canvas
                            if (typeof html2canvas === 'function') {
                              img.onerror = function() {
                                document.body.removeChild(loadingToast);

                                // 创建包含SVG的临时div
                                const tempDiv = document.createElement('div');
                                tempDiv.style.position = 'absolute';
                                tempDiv.style.left = '-9999px';
                                tempDiv.style.top = '-9999px';
                                tempDiv.style.width = width + 'px';
                                tempDiv.style.height = height + 'px';
                                tempDiv.style.background = 'white';
                                tempDiv.style.padding = '20px';
                                tempDiv.appendChild(svgElement.cloneNode(true));
                                document.body.appendChild(tempDiv);

                                // 使用html2canvas捕获
                                html2canvas(tempDiv, {
                                  scale: scale,
                                  backgroundColor: 'white',
                                  logging: false
                                }).then(canvas => {
                                  document.body.removeChild(tempDiv);

                                  const pngUrl = canvas.toDataURL('image/png');
                                  const downloadLink = document.createElement('a');
                                  downloadLink.href = pngUrl;
                                  downloadLink.download = 'mermaid-diagram-hd.png';
                                  document.body.appendChild(downloadLink);
                                  downloadLink.click();
                                  document.body.removeChild(downloadLink);

                                  const toast = document.createElement('div');
                                  toast.textContent = '高清图片导出成功！(备用方法)';
                                  toast.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#10b981;color:white;padding:8px 16px;border-radius:8px;font-size:14px;z-index:1000000;box-shadow:0 4px 12px rgba(0,0,0,0.15);';
                                  document.body.appendChild(toast);
                                  setTimeout(() => document.body.removeChild(toast), 3000);
                                }).catch(err => {
                                  alert('图片导出失败（备用方法）: ' + err.message + '\n请尝试截图另存为图片');
                                });
                              };
                            }
                          } catch (e) {
                            alert('导出图片失败: ' + (e.message || e) + '\n请尝试截图另存为图片');
                          }
                        };
                        popup.appendChild(exportBtn);
                      } else {
                        const errorDiv = document.createElement('div');
                        errorDiv.style.color = '#e53e3e';
                        errorDiv.textContent = '无法获取SVG内容进行放大预览。';
                        popup.appendChild(errorDiv);
                      }

                      // 优化关闭按钮
                      const closeBtn = document.createElement('button');
                      closeBtn.innerHTML = `
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18"></line>
                          <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                      `;
                      closeBtn.style.cssText = 'position:absolute;top:16px;right:16px;background:rgba(243,244,246,0.9);color:#64748b;border:none;border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all 0.2s;box-shadow:0 2px 6px rgba(0,0,0,0.1);';
                      closeBtn.onmouseover = function() { this.style.background = 'rgba(243,244,246,1)'; this.style.color = '#475569'; this.style.transform = 'scale(1.05)'; };
                      closeBtn.onmouseout = function() { this.style.background = 'rgba(243,244,246,0.9)'; this.style.color = '#64748b'; this.style.transform = 'scale(1)'; };
                      closeBtn.onclick = function() { document.body.removeChild(overlay); };
                      popup.appendChild(closeBtn);

                      overlay.appendChild(popup);
                      document.body.appendChild(overlay);
                    } catch (e) {
                      alert('放大预览弹窗出错：'+(e.message||e));
                    }
                  };
                  mermaidDiv.appendChild(zoomBtn);
                }
              } catch (zoomError) {
                mermaidDiv.innerHTML += '<div style="color:#e53e3e;">放大按钮渲染失败: ' + (zoomError.str || zoomError.message) + '</div>';
              }
            }, 100);

          } catch (renderError) {
            // Mermaid 渲染失败，回退显示上一次成功的 SVG 或错误信息
            if (lastSVG) {
              mermaidDiv.innerHTML = ''; // 清空内容
              mermaidDiv.appendChild(lastSVG);
              mermaidDiv.style.border = '2px dashed #f59e0b'; // 警告色边框
              let warn = mermaidDiv.querySelector('.mermaid-render-warning');
              if (!warn) {
                warn = document.createElement('div');
                warn.className = 'mermaid-render-warning';
                warn.style.cssText = 'color:#d97706;font-size:12px;margin-top:4px;text-align:center;';
                mermaidDiv.appendChild(warn);
              }
              warn.textContent = '当前Mermaid内容解析失败，已显示上一次成功渲染。错误: ' + (renderError.str || renderError.message);
            } else {
              mermaidDiv.innerHTML = '<div style="color:#e53e3e;">Mermaid 渲染失败: ' + (renderError.str || renderError.message) + '</div>'
                + '<pre style="color:#64748b;font-size:13px;background:#f3f4f6;border-radius:6px;padding:8px 12px;overflow-x:auto;margin-top:8px;">'
                + window.ChatbotUtils.escapeHtml(code)
                + '</pre>';
              mermaidDiv.style.border = '2px solid #e53e3e'; // 红色边框
            }
          }
        } catch (generalBlockError) {
          // 兜底：处理 block 解析或 DOM 操作异常
          console.error('处理Mermaid block时发生一般错误:', generalBlockError, block);
          let errorDisplayDiv = block.parentElement || document.createElement('div');
          if (block.parentElement) {
             let tempDiv = document.createElement('div');
             tempDiv.innerHTML = '<div style="color:#e53e3e;">Mermaid block处理异常: ' + generalBlockError.message + '</div>';
             block.replaceWith(tempDiv);
          } else {
            block.innerHTML = '<div style="color:#e53e3e;">Mermaid block处理异常: ' + generalBlockError.message + '</div>';
          }
        }
      });
    }
    // Mermaid.js 可能异步加载，尝试多次渲染
    if (window.mermaidLoaded && typeof window.mermaid !== 'undefined') {
      renderAllMermaidBlocks();
    } else {
      setTimeout(renderAllMermaidBlocks, 600);
      setTimeout(renderAllMermaidBlocks, 1200);
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

  // 更新免责声明和删除历史记录按钮
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
              window.ChatbotCore.clearCurrentDocChatHistory(updateChatbotUI);
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
}

/**
 * 初始化聊天机器人浮动按钮 (FAB) 和主弹窗 (Modal) 的 UI。
 * 如果对应的 DOM 元素不存在，则创建并添加到 `document.body`。
 * 设置 FAB 的点击事件以打开聊天弹窗，设置弹窗关闭按钮的事件以关闭弹窗。
 * 调用 `updateChatbotUI` 进行首次渲染。
 *
 * 主要步骤：
 * 1. **FAB 初始化**：
 *    - 检查 `chatbot-fab` 是否存在，不存在则创建。
 *    - 设置 FAB 的样式、图标和交互效果 (鼠标悬浮放大)。
 *    - 绑定 `onclick` 事件，设置为 `window.isChatbotOpen = true` 并调用 `updateChatbotUI`。
 * 2. **Modal 初始化**：
 *    - 检查 `chatbot-modal` 是否存在，不存在则创建。
 *    - 设置 Modal 的基本样式、结构 (包含头部、预设问题区、聊天内容区、输入区)。
 *    - 头部包含标题和关闭按钮。
 *    - 预设问题区通过 `window.ChatbotPreset.PRESET_QUESTIONS` (带兜底) 动态生成按钮。
 *    - 输入区包含文本输入框和发送按钮。
 *    - 底部包含免责声明。
 *    - 添加响应式样式，适配小屏幕设备。
 *    - 添加暗黑模式样式。
 * 3. **关闭按钮事件**：为 `chatbot-close-btn` 绑定 `onclick` 事件，设置为 `window.isChatbotOpen = false` 并调用 `updateChatbotUI`。
 * 4. **初始UI更新**：调用 `updateChatbotUI`。
 */
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
          <div id="chatbot-preset" style="margin-bottom:16px;display:flex;flex-wrap:wrap;gap:6px 8px;opacity:1;max-height:300px;transition:opacity 0.3s, max-height 0.5s;padding-right:40px;position:relative;z-index:1;">
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
          <div id="chatbot-body" style="flex:1;overflow-y:auto;padding-right:6px;margin-right:-6px;padding-bottom:10px;scrollbar-width:thin;scrollbar-color:#ddd transparent;scroll-behavior:smooth;position:relative;z-index:0;"></div>
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

window.handleChatbotSend = handleChatbotSend;
window.handlePresetQuestion = handlePresetQuestion;
window.ChatbotUI = {
  updateChatbotUI,
  initChatbotUI
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initChatbotUI);
} else {
  initChatbotUI();
}

/**
 * 根据 Markdown 文本生成思维导图的静态 HTML 预览 (虚影效果)。
 * 主要用于在聊天界面快速展示思维导图的结构概览。
 *
 * 实现逻辑：
 * 1. **解析 Markdown 为树结构 (`parseTree`)**：
 *    - 按行分割 Markdown 文本。
 *    - 识别 `#` (一级)、`##` (二级)、`###` (三级) 标题，构建层级关系。
 *    - 返回一个包含 `text` 和 `children` 属性的树状对象。
 * 2. **递归渲染树节点 (`renderNode`)**：
 *    - 接受节点对象、当前层级和是否为最后一个兄弟节点的标记。
 *    - 为不同层级的节点应用不同的背景色、圆点颜色和字体样式，以区分层级。
 *    - 使用绝对定位和相对定位创建连接线和层级缩进的视觉效果。
 *    - 递归渲染子节点。
 * 3. **调用与返回**：
 *    - 调用 `parseTree` 解析传入的 `md` 文本。
 *    - 调用 `renderNode` 渲染根节点。
 *    - 如果生成的 HTML 为空或解析失败，返回一个提示"暂无结构化内容"的 div。
 *
 * @param {string} md Markdown 格式的思维导图文本。
 * @returns {string} 生成的思维导图预览 HTML 字符串。
 */
function renderMindmapShadow(md) {
  // 解析 markdown 为树结构
  function parseTree(md) {
    const lines = md.split(/\r?\n/).filter(l => l.trim());
    const root = { text: '', children: [] };
    let last1 = null, last2 = null;
    lines.forEach(line => {
      let m1 = line.match(/^# (.+)/);
      let m2 = line.match(/^## (.+)/);
      let m3 = line.match(/^### (.+)/);
      if (m1) {
        last1 = { text: m1[1], children: [] };
        root.children.push(last1);
        last2 = null;
      } else if (m2 && last1) {
        last2 = { text: m2[1], children: [] };
        last1.children.push(last2);
      } else if (m3 && last2) {
        last2.children.push({ text: m3[1], children: [] });
      }
    });
    return root;
  }
  // 递归渲染树状结构
  function renderNode(node, level = 0, isLast = true) {
    if (!node.text && node.children.length === 0) return '';
    if (!node.text) {
      // 根节点
      return `<div class=\"mindmap-shadow-root\">${node.children.map((c,i,a)=>renderNode(c,0,i===a.length-1)).join('')}</div>`;
    }
    // 节点样式
    const colors = [
      'rgba(59,130,246,0.13)', // 主节点
      'rgba(59,130,246,0.09)', // 二级
      'rgba(59,130,246,0.06)'  // 三级
    ];
    const dotColors = [
      'rgba(59,130,246,0.35)',
      'rgba(59,130,246,0.22)',
      'rgba(59,130,246,0.15)'
    ];
    let html = `<div class=\"mindmap-shadow-node level${level}\" style=\"position:relative;margin-left:${level*28}px;padding:3px 8px 3px 12px;background:${colors[level]||colors[2]};border-radius:8px;min-width:60px;max-width:260px;margin-bottom:2px;opacity:0.7;border:1px dashed rgba(59,130,246,0.2);\">`;
    // 圆点
    html += `<span style=\"position:absolute;left:-10px;top:50%;transform:translateY(-50%);width:7px;height:7px;border-radius:4px;background:${dotColors[level]||dotColors[2]};box-shadow:0 0 0 1px #e0e7ef;\"></span>`;
    // 线条（如果不是根节点且不是最后一个兄弟）
    if (level > 0) {
      html += `<span style=\"position:absolute;left:-6px;top:0;height:100%;width:1.5px;background:linear-gradient(to bottom,rgba(59,130,246,0.10),rgba(59,130,246,0.03));z-index:0;\"></span>`;
    }
    html += `<span style=\"color:#2563eb;font-weight:${level===0?'bold':'normal'};font-size:${level===0?'1.08em':'1em'};\">${window.ChatbotUtils.escapeHtml(node.text)}</span>`;
    if (node.children && node.children.length > 0) {
      html += `<div class=\"mindmap-shadow-children\" style=\"margin-top:4px;\">${node.children.map((c,i,a)=>renderNode(c,level+1,i===a.length-1)).join('')}</div>`;
    }
    html += '</div>';
    return html;
  }
  const tree = parseTree(md);
  const html = renderNode(tree);
  return html || '<div style=\"color:#94a3b8;opacity:0.5;\">暂无结构化内容</div>';
}

function updateSelectedImagesPreview() {
  const previewContainer = document.getElementById('chatbot-selected-images-preview');
  if (!previewContainer) {
    // console.error('ChatbotUI: chatbot-selected-images-preview element not found.');
    return;
  }
  previewContainer.innerHTML = ''; // 清除之前的预览
  if (window.selectedChatbotImages && window.selectedChatbotImages.length > 0) {
    previewContainer.style.display = 'flex';
    previewContainer.style.flexWrap = 'wrap';
    previewContainer.style.gap = '8px';
    previewContainer.style.paddingBottom = '8px';

    window.selectedChatbotImages.forEach(imgInfo => {
      const imgElement = document.createElement('img');
      imgElement.src = imgInfo.thumbnailBase64 || imgInfo.fullBase64; // 使用缩略图（如果可用）
      imgElement.alt = 'Selected image';
      imgElement.style.width = '50px';
      imgElement.style.height = '50px';
      imgElement.style.objectFit = 'cover';
      imgElement.style.borderRadius = '4px';
      previewContainer.appendChild(imgElement);
    });
  } else {
    previewContainer.style.display = 'none';
  }
}

/**
 * 打开图片选择模态框，允许用户从当前文档的图片中选择。
 */
ChatbotUI.openImageSelectionModal = function() {
  // Ensure selected images array exists
  if (!window.selectedChatbotImages) {
    window.selectedChatbotImages = [];
  }

  let modal = document.getElementById('chatbot-image-selection-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'chatbot-image-selection-modal';
    // Basic styling - can be enhanced
    modal.style.position = 'fixed';
    modal.style.top = '0';
    modal.style.left = '0';
    modal.style.width = '100vw';
    modal.style.height = '100vh';
    modal.style.backgroundColor = 'rgba(0,0,0,0.5)';
    modal.style.zIndex = '100002'; // Higher than chatbot modal
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    modal.onclick = function(e) { if (e.target === modal) modal.style.display = 'none'; };

    const contentDiv = document.createElement('div');
    contentDiv.style.background = 'white';
    contentDiv.style.padding = '20px';
    contentDiv.style.borderRadius = '8px';
    contentDiv.style.maxWidth = '80vw';
    contentDiv.style.maxHeight = '80vh';
    contentDiv.style.overflowY = 'auto';
    contentDiv.onclick = function(e) { e.stopPropagation(); };


    const title = document.createElement('h3');
    title.textContent = '选择要添加到消息的图片';
    title.style.marginTop = '0';
    contentDiv.appendChild(title);

    const imageGrid = document.createElement('div');
    imageGrid.id = 'chatbot-doc-image-grid';
    imageGrid.style.display = 'grid';
    imageGrid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(120px, 1fr))';
    imageGrid.style.gap = '10px';
    imageGrid.style.marginTop = '15px';
    contentDiv.appendChild(imageGrid);

    const footer = document.createElement('div');
    footer.style.marginTop = '20px';
    footer.style.textAlign = 'right';

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '完成选择';
    closeBtn.style.padding = '8px 16px';
    closeBtn.style.border = 'none';
    closeBtn.style.background = '#3b82f6';
    closeBtn.style.color = 'white';
    closeBtn.style.borderRadius = '6px';
    closeBtn.style.cursor = 'pointer';
    closeBtn.onclick = function() {
      modal.style.display = 'none';
      updateSelectedImagesPreview();
    };
    footer.appendChild(closeBtn);
    contentDiv.appendChild(footer);
    modal.appendChild(contentDiv);
    document.body.appendChild(modal);
  }

  const imageGrid = modal.querySelector('#chatbot-doc-image-grid');
  imageGrid.innerHTML = ''; // Clear previous images

  const docImages = (window.data && window.data.images) ? window.data.images : [];

  if (docImages.length === 0) {
    imageGrid.innerHTML = '<p>当前文档没有图片可供选择。</p>';
  } else {
    docImages.forEach((imgData, index) => {
      const imgContainer = document.createElement('div');
      imgContainer.style.position = 'relative';
      imgContainer.style.border = '2px solid transparent';
      imgContainer.style.borderRadius = '6px';
      imgContainer.style.cursor = 'pointer';
      imgContainer.style.transition = 'border-color 0.2s';

      // Check if already selected
      const isSelected = window.selectedChatbotImages.some(sImg => sImg.originalSrc === (imgData.name || `doc-img-${index}`));


      if (isSelected) {
        imgContainer.style.borderColor = '#3b82f6'; // Highlight if selected
      }

      const imgElement = document.createElement('img');
      let imgSrc = '';
      if(imgData.data && imgData.data.startsWith('data:image')) {
        imgSrc = imgData.data;
      } else if (imgData.data) {
        imgSrc = 'data:image/png;base64,' + imgData.data; // Assuming png if not specified
      }
      imgElement.src = imgSrc;
      imgElement.style.width = '100%';
      imgElement.style.height = 'auto';
      imgElement.style.maxHeight = '120px';
      imgElement.style.objectFit = 'contain';
      imgElement.style.display = 'block';
      imgElement.style.borderRadius = '4px';

      imgContainer.appendChild(imgElement);

      const MAX_IMAGE_SIZE_BYTES = 1 * 1024 * 1024; // 1MB
      const MAX_THUMBNAIL_SIZE_BYTES = 60 * 1024; // 60KB for thumbnail
      const MAX_DIMENSION = 1024; // Max width/height for full image
      const THUMB_DIMENSION = 200; // Max width/height for thumbnail

      imgContainer.onclick = async function() {
        const originalSrcIdentifier = imgData.name || `doc-img-${index}`; // Unique ID for this image from doc
        const selectedIndex = window.selectedChatbotImages.findIndex(sImg => sImg.originalSrc === originalSrcIdentifier);

        if (selectedIndex > -1) { // Already selected, so deselect
          window.selectedChatbotImages.splice(selectedIndex, 1);
          imgContainer.style.borderColor = 'transparent';
        } else { // Not selected, so select and process
          if (window.selectedChatbotImages.length >= 5) { // Limit to 5 images for now
             ChatbotUtils.showToast('最多选择 5 张图片。');
             return;
          }
          imgContainer.style.borderColor = '#3b82f6';
          // Compress and add
          try {
            const fullBase64 = await compressImage(imgSrc, MAX_IMAGE_SIZE_BYTES, MAX_DIMENSION, 0.85);
            const thumbnailBase64 = await compressImage(imgSrc, MAX_THUMBNAIL_SIZE_BYTES, THUMB_DIMENSION, 0.7);

            window.selectedChatbotImages.push({
              originalSrc: originalSrcIdentifier,
              fullBase64: fullBase64,
              thumbnailBase64: thumbnailBase64,
              // name: imgData.name // or any other identifier
            });
          } catch (error) {
            ChatbotUtils.showToast('图片处理失败: ' + error.message);
            imgContainer.style.borderColor = 'transparent'; // Revert selection
          }
        }
      };
      imageGrid.appendChild(imgContainer);
    });
  }
  modal.style.display = 'flex';
}

/**
 * 压缩图片到目标大小和尺寸。
 * @param {string} base64Src - Base64 编码的源图片数据。
 * @param {number} targetSizeBytes - 目标文件大小（字节）。
 * @param {number} maxDimension - 图片的最大宽度/高度。
 * @param {number} initialQuality - 初始压缩质量 (0-1)。
 * @returns {Promise<string>} - 压缩后的 Base64 图片数据。
 */
async function compressImage(base64Src, targetSizeBytes, maxDimension, initialQuality = 0.85) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let canvas = document.createElement('canvas');
      let ctx = canvas.getContext('2d');
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxDimension) {
          height = Math.round(height * (maxDimension / width));
          width = maxDimension;
        }
      } else {
        if (height > maxDimension) {
          width = Math.round(width * (maxDimension / height));
          height = maxDimension;
        }
      }
      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);

      let quality = initialQuality;
      let compressedBase64 = canvas.toDataURL('image/jpeg', quality);
      let iterations = 0;
      const maxIterations = 10; // Prevent infinite loop

      // Iteratively reduce quality to meet size target (simplified)
      while (compressedBase64.length * 0.75 > targetSizeBytes && quality > 0.1 && iterations < maxIterations) {
        quality -= 0.1;
        compressedBase64 = canvas.toDataURL('image/jpeg', Math.max(0.1, quality));
        iterations++;
      }

      if (compressedBase64.length * 0.75 > targetSizeBytes && targetSizeBytes < 100 * 1024) { // if still too large for small targets, warn but proceed
         console.warn(`Image compression for small target (${targetSizeBytes}B) resulted in ${Math.round(compressedBase64.length * 0.75 / 1024)}KB. Quality: ${quality.toFixed(2)}`);
      }


      resolve(compressedBase64);
    };
    img.onerror = (err) => {
      console.error("Image loading error for compression:", err, base64Src.substring(0,100));
      reject(new Error('无法加载图片进行压缩'));
    };
    img.src = base64Src;
  });
}
// Global array to store selected images
window.selectedChatbotImages = [];

/**
 * 显示一个包含指定图片的模态框。
 * @param {string} imageSrc - 要显示的图片的源 (URL 或 Base64 data)。
 */
ChatbotUI.showImageModal = function(imageSrc) {
  let modal = document.getElementById('chatbot-image-display-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'chatbot-image-display-modal';
    modal.style.position = 'fixed';
    modal.style.top = '0';
    modal.style.left = '0';
    modal.style.width = '100vw';
    modal.style.height = '100vh';
    modal.style.backgroundColor = 'rgba(0,0,0,0.75)';
    modal.style.zIndex = '100003'; // Higher than image selection modal
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    modal.style.cursor = 'pointer';
    modal.onclick = function(e) {
      if (e.target === modal || e.target.id === 'chatbot-image-display-close-btn') {
        modal.style.display = 'none';
      }
    };

    const imageContainer = document.createElement('div');
    imageContainer.style.position = 'relative';
    imageContainer.style.maxWidth = '90vw';
    imageContainer.style.maxHeight = '90vh';

    const imgElement = document.createElement('img');
    imgElement.id = 'chatbot-displayed-image';
    imgElement.style.display = 'block';
    imgElement.style.maxWidth = '100%';
    imgElement.style.maxHeight = '100%';
    imgElement.style.borderRadius = '8px';
    imgElement.style.boxShadow = '0 5px 25px rgba(0,0,0,0.3)';
    imgElement.style.objectFit = 'contain';
    imgElement.style.cursor = 'default';
    imgElement.onclick = function(e) { e.stopPropagation(); }; // Prevent modal close when clicking image itself

    const closeButton = document.createElement('button');
    closeButton.id = 'chatbot-image-display-close-btn';
    closeButton.textContent = '×';
    closeButton.style.position = 'absolute';
    closeButton.style.top = '10px';
    closeButton.style.right = '10px';
    closeButton.style.background = 'rgba(0,0,0,0.5)';
    closeButton.style.color = 'white';
    closeButton.style.border = 'none';
    closeButton.style.borderRadius = '50%';
    closeButton.style.width = '30px';
    closeButton.style.height = '30px';
    closeButton.style.fontSize = '20px';
    closeButton.style.lineHeight = '30px';
    closeButton.style.textAlign = 'center';
    closeButton.style.cursor = 'pointer';
    closeButton.style.zIndex = '10';

    imageContainer.appendChild(closeButton);
    imageContainer.appendChild(imgElement);
    modal.appendChild(imageContainer);
    document.body.appendChild(modal);
  }

  const displayedImage = modal.querySelector('#chatbot-displayed-image');
  if (displayedImage) {
    displayedImage.src = imageSrc;
  }
  modal.style.display = 'flex';
};