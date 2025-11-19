// js/chatbot/chatbot-message-renderer.js

/**
 * Phase 3: 事件委托特性开关
 * 设置为 true 启用事件委托（减少内存占用 40-60%）
 * 设置为 false 回滚到内联事件（用于紧急回滚）
 */
const USE_EVENT_DELEGATION = true;  // 已修复流式更新配置加载问题

/**
 * ChatbotMessageRenderer 聊天消息渲染工具
 *
 * 主要功能：
 * 1. 渲染用户和助手的消息内容（支持文本、图片、思维导图等）。
 * 2. 生成消息操作按钮（删除、重发、复制、导出等）。
 * 3. 支持消息的富文本、Markdown、LaTeX 渲染。
 * 4. 渲染特殊消息（最终汇总、输入中指示器等）。
 * 5. 提供 Markdown 内容的样式。
 */
window.ChatbotMessageRenderer = {
  /**
   * 生成消息操作按钮的 HTML（如删除、重发等）。
   *
   * 主要逻辑：
   * 1. 用户消息包含"重发"和"删除"按钮，助手消息仅有"删除"按钮。
   * 2. 按钮位置根据消息类型自动调整。
   *
   * @param {string} messageType - 'user' 或 'assistant'。
   * @param {number} index - 消息在 chatHistory 中的索引。
   * @returns {string} HTML字符串。
   * @private
   */
  _createActionButtonsHTML: function(messageType, index) {
    let buttons = '';

    // Phase 3: 使用事件委托
    if (USE_EVENT_DELEGATION) {
      // 通用删除按钮（事件委托版本）
      buttons += `
        <button class="msg-action-btn delete-msg-btn"
                data-action="delete"
                data-index="${index}"
                title="删除消息">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            <line x1="10" y1="11" x2="10" y2="17"></line>
            <line x1="14" y1="11" x2="14" y2="17"></line>
          </svg>
        </button>
      `;

      if (messageType === 'user') {
        // 用户消息增加重发按钮，且重发按钮在前
        buttons = `
          <button class="msg-action-btn resend-msg-btn"
                  data-action="resend"
                  data-index="${index}"
                  title="重新发送">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="23 4 23 10 17 10"></polyline>
              <polyline points="1 20 1 14 7 14"></polyline>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
            </svg>
          </button>
        ` + buttons;
      }
    } else {
      // 旧版本：内联事件（用于回滚）
      // 为了代码简洁，这里仅保留核心功能，样式由 CSS 控制
      buttons += `
        <button class="msg-action-btn delete-msg-btn"
                onclick="window.ChatbotActions.deleteMessage(${index})"
                title="删除消息">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            <line x1="10" y1="11" x2="10" y2="17"></line>
            <line x1="14" y1="11" x2="14" y2="17"></line>
          </svg>
        </button>
      `;

      if (messageType === 'user') {
        buttons = `
          <button class="msg-action-btn resend-msg-btn"
                  onclick="window.ChatbotActions.resendUserMessage(${index})"
                  title="重新发送">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="23 4 23 10 17 10"></polyline>
              <polyline points="1 20 1 14 7 14"></polyline>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
            </svg>
          </button>
        ` + buttons;
      }
    }

    // 按消息类型调整按钮位置
    const positionClass = messageType === 'user' ? 'user-actions' : 'assistant-actions';
    const positionStyle = messageType === 'user'
      ? 'position:absolute;top:-28px;right:8px;display:none;gap:5px;z-index:3;padding:4px;'
      : 'position:absolute;top:-28px;left:8px;display:none;gap:5px;z-index:3;padding:4px;';

    // Phase 3: 移除内联 hover 事件，改用 CSS :hover
    if (USE_EVENT_DELEGATION) {
      // 使用 CSS 类控制位置 (需要在 message-actions.css 中添加相应类，或暂时保留内联样式以确保兼容)
      // 暂时保留内联样式以确保位置正确，后续可迁移到 CSS
      return `
        <div class="message-actions action-buttons-container ${positionClass}"
             style="${positionStyle}">
          ${buttons}
        </div>
      `;
    } else {
      return `
        <div class="message-actions action-buttons-container ${positionClass}"
             style="${positionStyle}"
             onmouseenter="this.style.display='flex'"
             onmouseleave="this.style.display='none'">
          ${buttons}
        </div>
      `;
    }
  },

  /**
   * 渲染用户消息内容。
   *
   * 主要逻辑：
   * 1. 支持富文本（多段文本、图片）和纯文本两种格式。
   * 2. 图片支持点击放大。
   * 3. 鼠标悬停时显示操作按钮。
   *
   * @param {object} m - 消息对象。
   * @param {number} index - 消息索引。
   * @returns {string} HTML字符串。
   */
  renderUserMessage: function(m, index) {
    let userMessageHtml = '';
    // 判断是否为富文本结构
    if (Array.isArray(m.displayContent) ? Array.isArray(m.displayContent) : Array.isArray(m.content)) {
      const contentToDisplay = Array.isArray(m.displayContent) ? m.displayContent : m.content;
      contentToDisplay.forEach(part => {
        if (part.type === 'text') {
          userMessageHtml += `<div style="margin-bottom:5px;">${window.ChatbotUtils.escapeHtml(part.text)}</div>`;
        } else if (part.type === 'image_url' && part.image_url && part.image_url.url) {
          const imageUrlForModal = part.image_url.fullUrl || part.image_url.url;

          // Phase 3: 图片点击事件委托
          if (USE_EVENT_DELEGATION) {
            userMessageHtml += `
              <div class="message-image-container">
                <img src="${part.image_url.url}"
                     alt="用户图片"
                     class="user-message-image"
                     data-action="show-image"
                     data-image-url="${imageUrlForModal}">
              </div>`;
          } else {
            // 旧版本：内联事件
            userMessageHtml += `
              <div class="message-image-container">
                <img src="${part.image_url.url}" alt="用户图片" class="user-message-image" onclick="window.ChatbotImageUtils.showImageModal('${imageUrlForModal}')">
              </div>`;
          }
        }
      });
    } else {
      // 纯文本消息
      userMessageHtml = window.ChatbotUtils.escapeHtml(m.displayContent !== undefined ? m.displayContent : m.content);
    }

    const actionButtons = this._createActionButtonsHTML('user', index);

    // CSS Refactor: 使用类名替代内联样式
    return `
      <div class="message-container user-message-container">
        ${actionButtons}
        <div class="chat-bubble user">
          ${userMessageHtml}
        </div>
      </div>
    `;
  },

  /**
   * 渲染助手消息内容。
   *
   * 主要逻辑：
   * 1. 支持思维导图、富文本、Markdown、LaTeX 等多种格式。
   * 2. 支持"思考过程"折叠块。
   * 3. 鼠标悬停时显示操作按钮。
   * 4. 提供复制、导出等快捷操作。
   *
   * @param {object} m - 消息对象。
   * @param {number} index - 消息索引。
   * @param {string} docName - 文档名（用于思维导图）。
   * @param {object} dataForMindmap - 思维导图相关数据。
   * @param {string} docId - 完整的文档 ID。
   * @returns {string} HTML字符串。
   */
  renderAssistantMessage: function(m, index, docName, dataForMindmap, docId) {
    let renderedContent = '';
    // 思维导图消息特殊处理
    if (m.hasMindMap && m.mindMapData) {
      let safeMindMapData = m.mindMapData;
      if (!safeMindMapData.trim() || !/^#/.test(safeMindMapData.trim()) || !/\n##?\s+/.test(safeMindMapData)) {
        safeMindMapData = '# 思维导图\n\n暂无结构化内容';
      }
      const mindmapUrlParams = `docId=${encodeURIComponent(docName || 'unknown')}_${(dataForMindmap.images||[]).length}_${(dataForMindmap.ocr|| '').length}_${(dataForMindmap.translation|| '').length}`;
      const mindmapUrl = (window.location.pathname.endsWith('/history_detail.html') ? '../mindmap/mindmap.html' : 'views/mindmap/mindmap.html') + '?' + mindmapUrlParams;

      // Phase 3: 思维导图按钮事件委托
      if (USE_EVENT_DELEGATION) {
        renderedContent = `
          <div class="mindmap-preview-container">
            <div class="mindmap-preview-content">
              ${window.ChatbotRenderingUtils.renderMindmapShadow(safeMindMapData)}
            </div>
            <div class="mindmap-preview-overlay">
              <button class="mindmap-open-btn"
                      data-action="open-mindmap"
                      data-mindmap-url="${mindmapUrl}">放大查看/编辑思维导图</button>
            </div>
          </div>
        `;
      } else {
        renderedContent = `
          <div class="mindmap-preview-container">
            <div class="mindmap-preview-content">
              ${window.ChatbotRenderingUtils.renderMindmapShadow(safeMindMapData)}
            </div>
            <div class="mindmap-preview-overlay">
              <button class="mindmap-open-btn" onclick="window.open('${mindmapUrl}','_blank')">放大查看/编辑思维导图</button>
            </div>
          </div>
        `;
      }
    } else if (m.isDrawioPictures) {
      // draw.io 配图消息特殊处理
      const docIdSafe = docId || 'unknown';
      const drawioUrl = (window.location.pathname.endsWith('/history_detail.html')
        ? '../drawio/drawio.html'
        : 'views/drawio/drawio.html') + `?docId=${encodeURIComponent(docIdSafe)}`;

      if (USE_EVENT_DELEGATION) {
        renderedContent = `
          <div class="drawio-preview-container">
            <div class="drawio-preview-text">
              已生成 draw.io 兼容的配图 XML，可点击下方按钮在新窗口中查看和编辑。
            </div>
            <div class="drawio-preview-overlay">
              <button class="mindmap-open-btn"
                      data-action="open-drawio"
                      data-drawio-url="${drawioUrl}">放大查看/编辑配图</button>
            </div>
          </div>
        `;
      } else {
        renderedContent = `
          <div class="drawio-preview-container">
            <div class="drawio-preview-text">
              已生成 draw.io 兼容的配图 XML，可点击下方按钮在新窗口中查看和编辑。
            </div>
            <div class="drawio-preview-overlay">
              <button class="mindmap-open-btn" onclick="window.open('${drawioUrl}','_blank')">放大查看/编辑配图</button>
            </div>
          </div>
        `;
      }
    } else {
      // 普通文本/Markdown/LaTeX
      // Only show the logo if there is NO content, NO reasoning, and NO tool calls.
      // If there is reasoning or tool calls, they serve as the "activity indicator".
      const isPurelyEmpty = (!m.content || String(m.content).trim() === '') && !m.reasoningContent && !m.toolCallHtml;

      if (m.role === 'assistant' && isPurelyEmpty) {
        // Determine the correct path for the logo based on the current page
        const isHistoryDetail = window.location.pathname.includes('/history_detail.html');
        const logoPath = isHistoryDetail ? '../../public/pure.svg' : 'public/pure.svg';
        renderedContent = `
          <div class="typing-indicator">
            <img src="${logoPath}" class="typing-logo" alt="Thinking..." />
          </div>
        `;
      } else {
        try {
          if (typeof marked !== 'undefined' && typeof katex !== 'undefined') {
            if (typeof renderWithKatexStreaming === 'function') {
              renderedContent = renderWithKatexStreaming(m.content);
            } else if (typeof renderWithKatexFailback === 'function') {
              renderedContent = renderWithKatexFailback(m.content);
            } else {
              // XSS 防护
              if (typeof window.safeRenderMarkdown === 'function') {
                renderedContent = window.safeRenderMarkdown(m.content);
              } else {
                renderedContent = marked.parse(m.content);
              }
            }
          } else {
            renderedContent = window.ChatbotUtils.escapeHtml(m.content).replace(/\n/g, '<br>');
          }
        } catch (e) {
          renderedContent = window.ChatbotUtils.escapeHtml(m.content).replace(/\n/g, '<br>');
        }
      }
    }

    // 思考过程折叠块
    let reasoningBlock = '';
    if (m.reasoningContent) {
      const reasoningId = `reasoning-block-${index}`;
      const collapsed = window[`reasoningCollapsed_${index}`] === true;
      let renderedReasoningContent = '';
      try {
        if (typeof renderWithKatexStreaming === 'function') {
          renderedReasoningContent = renderWithKatexStreaming(m.reasoningContent);
        } else {
          renderedReasoningContent = window.ChatbotUtils.escapeHtml(m.reasoningContent).replace(/\n/g, '<br>');
        }
      } catch (e) {
        renderedReasoningContent = window.ChatbotUtils.escapeHtml(m.reasoningContent).replace(/\n/g, '<br>');
      }

      // Phase 3: 思考过程折叠按钮事件委托
      if (USE_EVENT_DELEGATION) {
        reasoningBlock = `
          <div id="${reasoningId}" class="reasoning-block">
            <div class="reasoning-header">
              <span class="reasoning-title">思考过程</span>
              <button class="reasoning-toggle-btn"
                      data-action="toggle-reasoning"
                      data-index="${index}">
                ${collapsed ? '▼' : '▲'}
              </button>
            </div>
            <div class="reasoning-content" style="${collapsed ? 'display:none;' : ''}">
              ${renderedReasoningContent}
            </div>
          </div>
        `;
      } else {
        // 旧版本：内联事件
        reasoningBlock = `
          <div id="${reasoningId}" class="reasoning-block">
            <div class="reasoning-header">
              <span class="reasoning-title">思考过程</span>
              <button class="reasoning-toggle-btn" onclick="(function(){window['reasoningCollapsed_${index}']=!window['reasoningCollapsed_${index}'];window.ChatbotUI.updateChatbotUI();})()">
                ${collapsed ? '▼' : '▲'}
              </button>
            </div>
            <div class="reasoning-content" style="${collapsed ? 'display:none;' : ''}">
              ${renderedReasoningContent}
            </div>
          </div>
        `;
      }
    }

    // ReAct Visualization Block
    let reactVizBlock = '';
    if (m.reactLog && m.reactLog.length > 0) {
        const vizId = `react-viz-${index}`;
        // Create a container for the visualization
        // Note: The actual visualization will be rendered by the ReActVisualization class
        // We just provide the container here.
        // To make it work with the static HTML string return, we might need to trigger the render after insertion.
        // However, since we are returning HTML string, we can't easily bind the instance here.
        // A better approach for this specific architecture might be to render the static HTML structure
        // that matches what ReActVisualization produces, or use a placeholder and hydrate it later.
        
        // Let's try to render a static snapshot of the ReAct log if available
        let stepsHtml = '';
        m.reactLog.forEach((step, i) => {
            let icon = '';
            let title = '';
            let typeClass = '';
            let content = '';

            if (step.type === 'thought') {
                icon = 'carbon:idea';
                title = `Thought ${step.iteration || i+1}`;
                typeClass = 'step-thought';
                content = step.content;
            } else if (step.type === 'action') {
                icon = 'carbon:tools';
                title = `Action ${step.iteration || i+1}`;
                typeClass = 'step-action';
                content = `Tool: ${step.tool}\nInput: ${JSON.stringify(step.params, null, 2)}`;
            } else if (step.type === 'observation') {
                icon = 'carbon:view';
                title = `Observation ${step.iteration || i+1}`;
                typeClass = 'step-observation';
                content = typeof step.result === 'string' ? step.result : JSON.stringify(step.result, null, 2);
                if (content.length > 500) content = content.slice(0, 500) + '... (truncated)';
            }

            if (content) {
                // Escape HTML and preserve newlines
                content = window.ChatbotUtils.escapeHtml(content);
                content = content.replace(/\n/g, '<br>');

                stepsHtml += `
                    <div class="react-step-item ${typeClass}">
                        <div class="react-step-header">
                            <iconify-icon icon="${icon}"></iconify-icon>
                            <span>${title}</span>
                        </div>
                        <div class="react-step-content">${content}</div>
                    </div>
                `;
            }
        });

        if (stepsHtml) {
            reactVizBlock = `
                <div id="${vizId}" class="react-viz-container">
                    <div class="react-viz-header">
                        <div class="react-viz-title">
                            <iconify-icon icon="carbon:ibm-watson-discovery" width="18"></iconify-icon>
                            <span>ReAct Reasoning Engine</span>
                        </div>
                        <div class="react-status-badge react-status-completed">Completed</div>
                    </div>
                    <div class="react-steps-container">
                        ${stepsHtml}
                    </div>
                </div>
            `;
        }
    }

    // 工具调用块 (Legacy or Fallback)
    let toolCallBlock = '';
    if (m.toolCallHtml && !reactVizBlock) {
      toolCallBlock = m.toolCallHtml;
    }

    const actionButtons = this._createActionButtonsHTML('assistant', index);

    // Phase 3: 复制、导出等快捷操作按钮
    let existingActions = '';
    if (USE_EVENT_DELEGATION) {
      existingActions = `
        <div class="message-actions original-actions">
          <button class="copy-btn"
                  data-action="copy"
                  data-index="${index}"
                  title="复制内容">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          </button>
          <button class="export-png-btn"
                  data-action="export-png"
                  data-index="${index}"
                  title="导出为PNG">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
          </button>
        </div>
      `;
    } else {
      // 旧版本：内联事件
      existingActions = `
        <div class="message-actions original-actions" style="position:absolute;top:8px;left:12px;display:flex;gap:6px;opacity:0.6;transition:opacity 0.2s;z-index:2;"
             onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.6'">
          <button class="copy-btn" onclick="window.ChatbotUtils.copyAssistantMessage(${index})"
                  title="复制内容">
             <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
          </button>
          <button class="export-png-btn" onclick="window.ChatbotUtils.exportMessageAsPng(${index})"
                  title="导出为PNG">
             <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
          </button>
        </div>
      `;
    }

    // CSS Refactor: 使用类名替代内联样式
    const isThinkingOnly = m.role === 'assistant' && (!m.content || String(m.content).trim() === '') && !m.reasoningContent && !m.toolCallHtml;

    return `
      <div class="message-container assistant-message-container">
        ${actionButtons}
        <div class="chat-bubble assistant ${isThinkingOnly ? 'typing-bubble' : ''}">
          ${existingActions}
          <div class="assistant-message" data-message-index="${index}">
            ${reactVizBlock}
            ${toolCallBlock}
            ${reasoningBlock}
            <div class="markdown-content">${renderedContent}</div>
          </div>
        </div>
      </div>
    `;
  },

  /**
   * 渲染最终汇总消息。
   *
   * @param {object} m - 消息对象。
   * @returns {string} HTML字符串。
   */
  renderFinalSummaryMessage: function(m) {
    return `
      <div class="message-container assistant-message-container">
        <div class="chat-bubble summary">
          <div class="summary-title">最终汇总</div>
          <div class="markdown-content">${window.ChatbotUtils.escapeHtml(m.content).replace(/\n/g, '<br>')}</div>
        </div>
      </div>
    `;
  },

  /**
   * 渲染"输入中..."指示器。
   *
   * @returns {string} HTML字符串。
   */
  renderTypingIndicator: function() {
    // Determine the correct path for the logo based on the current page
    const isHistoryDetail = window.location.pathname.includes('/history_detail.html');
    const logoPath = isHistoryDetail ? '../../public/pure.svg' : 'public/pure.svg';

    return `
      <div class="message-container assistant-message-container">
        <div class="chat-bubble assistant typing-bubble">
          <div class="typing-indicator">
            <img src="${logoPath}" class="typing-logo" alt="Thinking..." />
          </div>
        </div>
      </div>
    `;
  },

  /**
   * 获取 Markdown 内容的样式。
   *
   * @returns {string} style 标签字符串。
   */
  getMarkdownStyles: function() {
    // CSS 现已移至外部文件 (css/history_detail/03-components/chatbot/index.css)
    // 此处返回空字符串以保持 API 兼容性，或仅返回必要的动态样式
    return '';
  }
};
