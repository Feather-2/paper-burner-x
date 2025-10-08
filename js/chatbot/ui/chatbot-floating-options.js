if (typeof window.ChatbotFloatingOptionsScriptLoaded === 'undefined') {
  /**
   * 聊天机器人应用的浮动高级选项栏 UI 管理模块。
   *
   * 主要功能：
   * 1. 定义高级选项的配置 (_chatbotOptionsConfig)。
   * 2. 创建选项栏的 HTML 结构并绑定交互事件 (createBar)。
   * 3. 更新选项栏中各个按钮的显示状态，包括文本、样式和可见性 (updateDisplay)。
   *
   * 使用方法：
   * - 在主 UI 初始化时，调用 ChatbotFloatingOptionsUI.createBar(parentElement, globalUpdateUICallback) 来创建并插入选项栏。
   * - 在主 UI 更新时，调用 ChatbotFloatingOptionsUI.updateDisplay() 来刷新选项栏的状态。
   */
  const _chatbotOptionsConfig = [
    { key: 'semanticGroups', texts: ['意群'], title: '查看/搜索意群', activeStyleColor: '#059669', isAction: true },
    { key: 'useContext', texts: ['上下文:关', '上下文:开'], values: [false, true], title: '切换是否使用对话历史', activeStyleColor: '#1d4ed8' },
    { key: 'multiHopRetrieval', texts: ['检索Agent:关', '检索Agent:开'], values: [false, true], defaultKey: false, title: '开启后自动启用：多轮取材+流式显示+意群分析+向量搜索+重排', activeStyleColor: '#059669' },
    { key: 'summarySource', texts: ['提供全文:OCR', '提供全文:无', '提供全文:翻译'], values: ['ocr', 'none', 'translation'], defaultKey: 'ocr', title: '切换总结时使用的文本源 (OCR/不使用文档内容/翻译)', activeStyleColor: '#1d4ed8' },
    { key: 'interestPointsActive', texts: ['兴趣点'], activeStyleColor: '#059669', isPlaceholder: true, title: '兴趣点功能 (待实现)' },
    { key: 'memoryManagementActive', texts: ['记忆管理'], activeStyleColor: '#059669', isPlaceholder: true, title: '记忆管理功能 (待实现)' }
  ];

  /**
   * 创建浮动高级选项栏的HTML结构并绑定事件。
   * @param {HTMLElement} parentElement - 选项栏将被添加到的父容器。
   * @param {function} globalUpdateUICallback - 全局UI更新回调函数，例如 window.ChatbotUI.updateChatbotUI。
   */
  function _createFloatingOptionsBar(parentElement, globalUpdateUICallback) {
    if (!parentElement || document.getElementById('chatbot-floating-options')) {
      return; // 如果父元素不存在或选项栏已存在，则不重复创建
    }

    const floatingOptionsContainer = document.createElement('div');
    floatingOptionsContainer.id = 'chatbot-floating-options';
    floatingOptionsContainer.style.cssText = `
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 4px 0 8px 0;
      gap: 5px;
      font-size: 11px;
      color: #555;
      flex-wrap: wrap;
    `;

    _chatbotOptionsConfig.forEach((optConf, index) => {
      const optionButton = document.createElement('button');
      optionButton.id = `chatbot-option-${optConf.key}`;
      optionButton.style.cssText = `
        background: none;
        border: none;
        color: #4b5563;
        cursor: pointer;
        padding: 2px 4px;
        font-size: 11px;
        border-radius: 4px;
        transition: background-color 0.2s, color 0.2s;
      `;
      optionButton.title = optConf.title;

      optionButton.onclick = function() {
        if (optConf.isPlaceholder) {
          console.log(`${optConf.key} clicked, placeholder for future feature.`);
          if (typeof ChatbotUtils !== 'undefined' && ChatbotUtils.showToast) {
            ChatbotUtils.showToast(`${optConf.texts[0]} 功能正在开发中。`, 'info', 2000);
          } else {
            alert(`${optConf.texts[0]} 功能正在开发中。`);
          }
        } else if (optConf.isAction && optConf.key === 'semanticGroups') {
          if (window.SemanticGroupsUI && typeof window.SemanticGroupsUI.toggle === 'function') {
            window.SemanticGroupsUI.toggle();
          } else if (typeof ChatbotUtils !== 'undefined' && ChatbotUtils.showToast) {
            ChatbotUtils.showToast('意群面板未就绪', 'warning', 2000);
          } else {
            alert('意群面板未就绪');
          }
        } else {
          const currentValue = window.chatbotActiveOptions[optConf.key];
          if (optConf.key === 'useContext') {
            window.chatbotActiveOptions.useContext = !currentValue;
          } else if (optConf.key === 'contentLengthStrategy') {
            window.chatbotActiveOptions.contentLengthStrategy = currentValue === optConf.values[0] ? optConf.values[1] : optConf.values[0];
          } else if (optConf.key === 'multiHopRetrieval') {
            window.chatbotActiveOptions.multiHopRetrieval = !currentValue;
          } else if (optConf.key === 'streamingRetrieval') {
            window.chatbotActiveOptions.streamingRetrieval = !currentValue;
          } else if (optConf.key === 'summarySource') {
            const currentIndex = optConf.values.indexOf(currentValue);
            const nextIndex = (currentIndex + 1) % optConf.values.length;
            window.chatbotActiveOptions.summarySource = optConf.values[nextIndex];
          }
        }
        if (typeof globalUpdateUICallback === 'function') {
          globalUpdateUICallback(); // 更新UI以反映选项变化
        } else {
          console.error("ChatbotFloatingOptionsUI: globalUpdateUICallback is not provided or not a function.");
        }
      };
      floatingOptionsContainer.appendChild(optionButton);

      if (index < _chatbotOptionsConfig.length - 1) {
        const nextOptConf = _chatbotOptionsConfig[index + 1];
        const separator = document.createElement('span');
        separator.id = `chatbot-separator-${nextOptConf.key}`;
        separator.textContent = '丨';
        separator.style.color = '#cbd5e1';
        separator.style.margin = '0 2px';
        floatingOptionsContainer.appendChild(separator);
      }
    });

    // 将创建的选项栏插入到父容器的合适位置
    const selectedImagesPreview = parentElement.querySelector('#chatbot-selected-images-preview');
    if (selectedImagesPreview) {
      parentElement.insertBefore(floatingOptionsContainer, selectedImagesPreview);
    } else {
      const mainInputDiv = parentElement.querySelector('div[style*="display:flex;align-items:center;gap:12px;"]');
      if (mainInputDiv) {
        parentElement.insertBefore(floatingOptionsContainer, mainInputDiv);
      } else {
        parentElement.appendChild(floatingOptionsContainer); // Fallback
      }
    }
  }

  /**
   * 更新浮动高级选项栏中各个按钮的显示状态（文本、样式、可见性）。
   */
  function _updateFloatingOptionsDisplay() {
    const floatingOptionsContainer = document.getElementById('chatbot-floating-options');
    if (!floatingOptionsContainer) return;

    _chatbotOptionsConfig.forEach(optConf => {
      const button = document.getElementById(`chatbot-option-${optConf.key}`);
      // 注意：分隔符ID是基于 *下一个* 选项的key来创建的，所以查找ID为 chatbot-separator-NEXT_KEY
      // 但是其显示与否是基于 *当前* 按钮的显示状态

      if (button) {
        let shouldBeVisible = true;
        // 处理 contentLengthStrategy 选项的可见性依赖
        if (optConf.dependsOn) {
          const dependencyKey = optConf.dependsOn;
          const dependencyValue = window.chatbotActiveOptions[dependencyKey];
          shouldBeVisible = dependencyValue !== optConf.dependsValueNot;

          // 特殊逻辑：当全文来源是OCR或翻译，且内容较短时，不显示"全文策略"按钮
          if (shouldBeVisible && optConf.key === 'contentLengthStrategy' && (dependencyValue === 'ocr' || dependencyValue === 'translation')) {
            let relevantContent = '';
            if (window.ChatbotCore && typeof window.ChatbotCore.getCurrentDocContent === 'function') {
              const docContentInfo = window.ChatbotCore.getCurrentDocContent();
              if (docContentInfo) {
                if (dependencyValue === 'ocr') relevantContent = docContentInfo.ocr || '';
                else if (dependencyValue === 'translation') relevantContent = docContentInfo.translation || '';
              }
            }
            // 如果内容长度小于或等于50000字符，则不显示"全文策略"按钮
            if (relevantContent.length <= 50000) {
              shouldBeVisible = false;
            }
          }
        }

        // 语义分组按钮：仅当已有意群数据时显示
        if (optConf.key === 'semanticGroups') {
          const hasGroups = !!(window.data && Array.isArray(window.data.semanticGroups) && window.data.semanticGroups.length > 0);
          shouldBeVisible = hasGroups;
        }

        // 智能检索按钮：仅当文档足够长时显示
        if (optConf.key === 'multiHopRetrieval') {
          let contentLength = 0;
          if (window.ChatbotCore && typeof window.ChatbotCore.getCurrentDocContent === 'function') {
            const docContentInfo = window.ChatbotCore.getCurrentDocContent();
            if (docContentInfo) {
              const translationText = docContentInfo.translation || '';
              const ocrText = docContentInfo.ocr || '';
              const chunkCandidates = [];
              if (Array.isArray(docContentInfo.translatedChunks)) {
                chunkCandidates.push(...docContentInfo.translatedChunks);
              }
              if (Array.isArray(docContentInfo.ocrChunks)) {
                chunkCandidates.push(...docContentInfo.ocrChunks);
              }

              contentLength = Math.max(translationText.length, ocrText.length);
              if (contentLength < 50000 && chunkCandidates.length > 0) {
                const chunkLength = chunkCandidates.reduce((sum, chunk) => sum + (typeof chunk === 'string' ? chunk.length : 0), 0);
                contentLength = Math.max(contentLength, chunkLength);
              }
            }
          }

          // 如果文档长度小于50000，则隐藏智能检索按钮
          if (contentLength < 50000) {
            shouldBeVisible = false;
          }
        }

        button.style.display = shouldBeVisible ? '' : 'none';
      }
    });

    // 第二遍：更新所有分隔符的显示状态
    // 分隔符只在两个连续可见按钮之间显示
    _chatbotOptionsConfig.forEach((optConf, index) => {
      if (index < _chatbotOptionsConfig.length - 1) {
        const currentButton = document.getElementById(`chatbot-option-${optConf.key}`);
        const nextOptConf = _chatbotOptionsConfig[index + 1];
        const nextButton = document.getElementById(`chatbot-option-${nextOptConf.key}`);
        const separator = document.getElementById(`chatbot-separator-${nextOptConf.key}`);

        if (separator) {
          // 只有当前按钮和下一个按钮都可见时，才显示分隔符
          const currentVisible = currentButton && currentButton.style.display !== 'none';
          const nextVisible = nextButton && nextButton.style.display !== 'none';
          separator.style.display = (currentVisible && nextVisible) ? '' : 'none';
        }
      }
    });

    // 第三遍：更新按钮文本和样式
    _chatbotOptionsConfig.forEach(optConf => {
      const button = document.getElementById(`chatbot-option-${optConf.key}`);

      if (!button || button.style.display === 'none') {
        return; // 跳过不可见的按钮
      }

      const currentOptionValue = window.chatbotActiveOptions[optConf.key];
      let currentText = '';
      let color = '#4b5563';
      let fontWeight = 'normal';
      let isActiveStyle = false;

      if (optConf.isAction && optConf.key === 'semanticGroups') {
        const count = (window.data && Array.isArray(window.data.semanticGroups)) ? window.data.semanticGroups.length : 0;
        currentText = count > 0 ? `意群(${count})` : '意群';
        // 显示为激活风格以便更醒目（当有意群时）
        if (count > 0) { color = optConf.activeStyleColor; fontWeight = '600'; isActiveStyle = true; }
      } else if (optConf.isPlaceholder) {
        currentText = optConf.texts[0];
      } else if (optConf.key === 'useContext') {
        currentText = currentOptionValue ? optConf.texts[1] : optConf.texts[0];
        if (currentOptionValue) { color = optConf.activeStyleColor; fontWeight = '600'; isActiveStyle = true; }
      } else if (optConf.key === 'contentLengthStrategy') {
        currentText = currentOptionValue === optConf.defaultKey ? optConf.texts[0] : optConf.texts[1];
        if (currentOptionValue !== optConf.defaultKey) {
           color = optConf.activeStyleColor; fontWeight = '600'; isActiveStyle = true;
        }
      } else if (optConf.key === 'multiHopRetrieval') {
        currentText = currentOptionValue ? optConf.texts[1] : optConf.texts[0];
        if (currentOptionValue) { color = optConf.activeStyleColor; fontWeight = '600'; isActiveStyle = true; }
      } else if (optConf.key === 'streamingRetrieval') {
        currentText = currentOptionValue ? optConf.texts[1] : optConf.texts[0];
        if (currentOptionValue) { color = optConf.activeStyleColor; fontWeight = '600'; isActiveStyle = true; }
      } else if (optConf.key === 'summarySource') {
        const currentIndex = optConf.values.indexOf(currentOptionValue);
        currentText = optConf.texts[currentIndex] || optConf.texts[0];
        // 对于 summarySource, 'ocr' (index 0) 是默认状态，'none' (index 1) 和 'translation' (index 2) 算作激活状态
        if (currentOptionValue !== optConf.defaultKey) {
            color = optConf.activeStyleColor; fontWeight = '600'; isActiveStyle = true;
        }
      }
      button.textContent = currentText;
      button.style.color = color;
      button.style.fontWeight = fontWeight;

      if (isActiveStyle) {
          button.style.backgroundColor = 'rgba(59, 130, 246, 0.1)'; // 淡蓝色背景表示激活
      } else {
          button.style.backgroundColor = 'transparent';
      }
    });
  }

  // 将核心函数挂载到 window 对象和 ChatbotFloatingOptionsUI 命名空间下，便于外部调用
  window.ChatbotFloatingOptionsUI = {
    createBar: _createFloatingOptionsBar,
    updateDisplay: _updateFloatingOptionsDisplay,
    // 也暴露配置，以防外部需要引用（例如测试或进一步定制）
    // 但通常情况下，外部不应直接修改 _chatbotOptionsConfig
    _internalConfig: _chatbotOptionsConfig
  };
  window.ChatbotFloatingOptionsScriptLoaded = true;
}
