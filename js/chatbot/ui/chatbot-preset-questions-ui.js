window.ChatbotPresetQuestionsUI = {
  /**
   * 渲染预设问题区域。
   * @param {HTMLElement} parentElement - presetContainer 将被添加到的父元素 (通常是 chatbotWindow 或 mainContentArea)。
   * @param {boolean} isCustomModel - 当前是否为自定义模型。
   * @param {string} currentDocId - 当前文档ID，用于自动收起逻辑。
   * @param {function} updateChatbotUICallback - 用于在按钮点击时触发主UI更新的回调。
   * @param {function} handlePresetQuestionCallback - 处理预设问题点击的回调。
   * @returns {HTMLElement} 创建的 presetContainer 元素，或在失败时返回 null。
   */
  render: function(parentElement, isCustomModel, currentDocId, updateChatbotUICallback, handlePresetQuestionCallback) {
    // 确保清除旧的 presetContainer (如果存在)
    let existingPresetContainer = document.getElementById('chatbot-preset-container');
    if (existingPresetContainer) existingPresetContainer.remove();

    const presetContainer = document.createElement('div');
    presetContainer.id = 'chatbot-preset-container';
    presetContainer.style.position = 'absolute';
    presetContainer.style.top = '73px'; // 初始值，可能由父级CSS或后续调整覆盖
    presetContainer.style.left = '0px';
    presetContainer.style.right = '0px';
    presetContainer.style.zIndex = '5'; // 确保在聊天内容之上但在模态框之内
    presetContainer.style.padding = '8px 20px'; // 默认内边距

    const newPresetHeader = document.createElement('div');
    newPresetHeader.id = 'chatbot-preset-header';
    newPresetHeader.style.display = 'flex';
    newPresetHeader.style.alignItems = 'center';
    newPresetHeader.style.justifyContent = 'space-between';
    newPresetHeader.style.marginBottom = '8px';
    newPresetHeader.style.padding = '0';

    const presetTitle = document.createElement('span');
    presetTitle.textContent = '快捷指令';
    presetTitle.style.fontWeight = '600';
    presetTitle.style.fontSize = '0.9em';
    presetTitle.style.color = '#4b5563'; // 深灰色标题

    const presetToggleBtn = document.createElement('button');
    presetToggleBtn.id = 'chatbot-preset-toggle-btn';
    presetToggleBtn.style.background = 'none';
    presetToggleBtn.style.border = 'none';
    presetToggleBtn.style.cursor = 'pointer';
    presetToggleBtn.style.padding = '4px';
    presetToggleBtn.style.color = '#4b5563';
    presetToggleBtn.innerHTML = window.isPresetQuestionsCollapsed
      ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>' // 向下箭头表示"显示"
      : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>'; // 向上箭头表示"隐藏"
    presetToggleBtn.title = window.isPresetQuestionsCollapsed ? "展开快捷指令" : "收起快捷指令";
    presetToggleBtn.onclick = function() {
      window.isPresetQuestionsCollapsed = !window.isPresetQuestionsCollapsed;
      updateChatbotUICallback(); // 调用主UI更新
    };

    const headerLeftGroup = document.createElement('div');
    headerLeftGroup.style.display = 'flex';
    headerLeftGroup.style.alignItems = 'center';
    headerLeftGroup.style.gap = '8px';
    headerLeftGroup.appendChild(presetTitle);
    headerLeftGroup.appendChild(presetToggleBtn);
    newPresetHeader.appendChild(headerLeftGroup);

    if (isCustomModel) {
      const gearBtn = document.createElement('button');
      gearBtn.id = 'chatbot-model-gear-btn';
      gearBtn.title = '选择模型';
      gearBtn.innerHTML = '<i class="fa-solid fa-gear" style="color:#2563eb;font-size:16px;display:block;"></i>';
      gearBtn.style.display = 'flex';
      gearBtn.style.alignItems = 'center';
      gearBtn.style.justifyContent = 'center';
      gearBtn.style.background = 'none';
      gearBtn.style.border = 'none';
      gearBtn.style.cursor = 'pointer';
      gearBtn.style.padding = '2.5px';
      gearBtn.style.borderRadius = '50%';
      gearBtn.style.transition = 'background 0.16s, box-shadow 0.16s';
      gearBtn.onmouseover = function(){
        this.style.background = '#e0f2fe';
        this.style.boxShadow = '0 1.5px 6px 0 rgba(59,130,246,0.10)';
      };
      gearBtn.onmouseout = function(){
        this.style.background = 'none';
        this.style.boxShadow = 'none';
      };
      gearBtn.onclick = function(){
        window.isModelSelectorOpen = true; // 设置全局状态
        updateChatbotUICallback();        // 调用主UI更新
      };
      newPresetHeader.appendChild(gearBtn);
    }
    presetContainer.appendChild(newPresetHeader);

    const newPresetBody = document.createElement('div');
    newPresetBody.id = 'chatbot-preset-body';
    newPresetBody.style.display = 'flex';
    newPresetBody.style.flexWrap = 'wrap';
    newPresetBody.style.gap = '6px 8px';
    newPresetBody.style.transition = 'opacity 0.3s ease-out, max-height 0.4s ease-out, margin-bottom 0.4s ease-out, visibility 0.3s ease-out';
    newPresetBody.style.overflow = 'hidden';
    newPresetBody.style.width = '100%'; // 确保它占据其父容器的全部宽度
    presetContainer.appendChild(newPresetBody);

    if (!parentElement) {
        console.error("ChatbotPresetQuestionsUI: Parent element for presetContainer is not provided or not found.");
        return null;
    }
    // 将 presetContainer 添加到指定的父元素
    parentElement.appendChild(presetContainer);


    // 填充预设问题按钮
    const presetQuestions = (window.ChatbotPreset && window.ChatbotPreset.PRESET_QUESTIONS) ? window.ChatbotPreset.PRESET_QUESTIONS : [
      '总结本文', '有哪些关键公式？', '研究背景与意义？', '研究方法及发现？',
      '应用与前景？', '用通俗语言解释全文', '生成思维导图🧠', '生成流程图🔄'
    ];
    presetQuestions.forEach(q => {
      const button = document.createElement('button');
      button.style.cssText = `
        background: #f3f4f6; /* 浅灰色背景 */
        color: #374151; /* 深灰色文字 */
        border-radius: 12px; /* 圆角调整 */
        border: 1px solid #e5e7eb; /* 更细的边框 */
        box-shadow: none; /* 移除阴影 */
        padding: 4px 10px; /* 内边距调整 */
        font-size: 12px; /* 字体大小调整 */
        font-weight: 500;
        cursor: pointer;
        transition: background-color 0.2s, color 0.2s, border-color 0.2s;
        margin: 2px 0;
        outline: none;
      `;
      button.onmouseover = function(){
        this.style.background='#e5e7eb'; /* 悬浮时背景变深一点 */
        this.style.borderColor='#d1d5db';
        this.style.color='#1f2937';
      };
      button.onmouseout = function(){
        this.style.background='#f3f4f6';
        this.style.borderColor='#e5e7eb';
        this.style.color='#374151';
      };
      // 使用 encodeURIComponent/decodeURIComponent 来处理特殊字符
      button.onclick = function() { handlePresetQuestionCallback(decodeURIComponent(encodeURIComponent(q))); };
      button.textContent = q;
      newPresetBody.appendChild(button);
    });

    // 自动收起逻辑 (依赖全局状态 window.isPresetQuestionsCollapsed, window.presetAutoCollapseTriggeredForDoc, window.isModelSelectorOpen 和 ChatbotCore)
    let userMessageCount = 0;
    if (window.ChatbotCore && window.ChatbotCore.chatHistory) {
      userMessageCount = window.ChatbotCore.chatHistory.filter(m => m.role === 'user').length;
    }

    if (userMessageCount >= 3 &&
        currentDocId && window.presetAutoCollapseTriggeredForDoc && !window.presetAutoCollapseTriggeredForDoc[currentDocId] &&
        !window.isPresetQuestionsCollapsed &&
        !window.isModelSelectorOpen) {
      window.isPresetQuestionsCollapsed = true;
      window.presetAutoCollapseTriggeredForDoc[currentDocId] = true;
      // 按钮的图标和标题将在下一次 updateChatbotUICallback 调用时由 presetToggleBtn 自身逻辑更新
      // 但为了即时性，如果状态因此改变，可以手动更新一下按钮
       presetToggleBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';
       presetToggleBtn.title = "展开快捷指令";
    }

    // 控制 chatbot-preset-body 和 presetContainer 的显隐与动画
    // (依赖全局状态 window.isPresetQuestionsCollapsed, window.isModelSelectorOpen)
    if (window.isPresetQuestionsCollapsed || window.isModelSelectorOpen) {
      newPresetBody.style.opacity = '0';
      newPresetBody.style.maxHeight = '0';
      newPresetBody.style.marginBottom = '0';
      newPresetBody.style.visibility = 'hidden';
      presetContainer.style.boxShadow = 'none';
      presetContainer.style.background = 'transparent';
      presetContainer.style.paddingTop = '0px';    // 折叠时移除垂直内边距
      presetContainer.style.paddingBottom = '0px';
    } else {
      newPresetBody.style.opacity = '1';
      newPresetBody.style.maxHeight = '150px'; // 或者一个更合适的计算值
      newPresetBody.style.marginBottom = '0px'; // 或者根据需要调整
      newPresetBody.style.visibility = 'visible';
      presetContainer.style.boxShadow = 'none'; // 可以设置展开时的阴影
      presetContainer.style.paddingTop = '8px';     // 恢复垂直内边距
      presetContainer.style.paddingBottom = '8px';

      // 背景渐变逻辑 (依赖父窗口背景色)
      const chatWindowBgElement = document.querySelector('#chatbot-modal .chatbot-window');
      let chatWinBg = 'rgb(255,255,255)'; // 默认背景
      if (chatWindowBgElement) {
          chatWinBg = getComputedStyle(chatWindowBgElement).getPropertyValue('background-color') || 'rgb(255,255,255)';
      }
      let opaqueBg = chatWinBg;
      if (opaqueBg.startsWith('rgba')) { // 转换为不透明的rgb
          const parts = opaqueBg.match(/[\d.]+/g);
          if (parts && parts.length === 4) { // rgba(r,g,b,a)
              opaqueBg = `rgb(${parts[0]}, ${parts[1]}, ${parts[2]})`;
          } else if (parts && parts.length === 3) { // 可能已经是 rgb 字符串
              opaqueBg = `rgb(${parts[0]}, ${parts[1]}, ${parts[2]})`;
          }
      } else if (opaqueBg === 'transparent') {
          opaqueBg = 'rgb(255,255,255)'; // 透明时的回退
      }
      presetContainer.style.background = `linear-gradient(to bottom, ${opaqueBg} 0%, ${opaqueBg} 70%, transparent 100%)`;
    }
    return presetContainer; // 返回创建的容器，主UI函数可以用它来计算布局
  }
};
