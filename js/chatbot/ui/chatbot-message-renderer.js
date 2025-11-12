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
      buttons += `
        <button class="msg-action-btn delete-msg-btn"
                onclick="window.ChatbotActions.deleteMessage(${index})"
                title="删除消息"
                style="background:rgba(0,0,0,0.05);border:none;width:22px;height:22px;border-radius:4px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;margin-left:4px;box-shadow: 0 1px 3px rgba(0,0,0,0.1);transition:all 0.2s;"
                onmouseover="this.style.background='rgba(239,68,68,0.1)';this.style.transform='scale(1.1)'"
                onmouseout="this.style.background='rgba(0,0,0,0.05)';this.style.transform='scale(1)'">
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
                  title="重新发送"
                  style="background:rgba(0,0,0,0.05);border:none;width:22px;height:22px;border-radius:4px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;box-shadow: 0 1px 3px rgba(0,0,0,0.1);transition:all 0.2s;"
                  onmouseover="this.style.background='rgba(59,130,246,0.1)';this.style.transform='scale(1.1)'"
                  onmouseout="this.style.background='rgba(0,0,0,0.05)';this.style.transform='scale(1)'">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="23 4 23 10 17 10"></polyline>
              <polyline points="1 20 1 14 7 14"></polyline>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
            </svg>
          </button>
        ` + buttons;
      }
    }

    // 按消息类型调整按钮位置，添加padding区域以便鼠标移入
    const positionStyle = messageType === 'user'
      ? 'position:absolute;top:-28px;right:8px;display:none;gap:5px;z-index:3;padding:4px;'
      : 'position:absolute;top:-28px;left:8px;display:none;gap:5px;z-index:3;padding:4px;';

    // Phase 3: 移除内联 hover 事件，改用 CSS :hover
    if (USE_EVENT_DELEGATION) {
      return `
        <div class="message-actions action-buttons-container"
             style="${positionStyle}">
          ${buttons}
        </div>
      `;
    } else {
      // 旧版本：保留内联事件
      return `
        <div class="message-actions action-buttons-container"
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
              <div style="margin-bottom:5px; max-width: 200px; max-height:200px; overflow:hidden; border-radius: 8px; border: 1px solid #ddd;">
                <img src="${part.image_url.url}"
                     alt="用户图片"
                     class="user-message-image"
                     data-action="show-image"
                     data-image-url="${imageUrlForModal}">
              </div>`;
          } else {
            // 旧版本：内联事件
            userMessageHtml += `
              <div style="margin-bottom:5px; max-width: 200px; max-height:200px; overflow:hidden; border-radius: 8px; border: 1px solid #ddd;">
                <img src="${part.image_url.url}" alt="用户图片" style="display:block; width:auto; height:auto; max-width:100%; max-height:100%; object-fit:contain; cursor:pointer;" onclick="window.ChatbotImageUtils.showImageModal('${imageUrlForModal}')">
              </div>`;
          }
        }
      });
    } else {
      // 纯文本消息
      userMessageHtml = window.ChatbotUtils.escapeHtml(m.displayContent !== undefined ? m.displayContent : m.content);
    }

    const actionButtons = this._createActionButtonsHTML('user', index);

    // Phase 3: 移除容器的内联 hover 事件，改用 CSS :hover
    if (USE_EVENT_DELEGATION) {
      return `
        <div class="message-container user-message-container" style="display:flex;justify-content:flex-end;margin-bottom:16px;padding-left:20%;position:relative; margin-top: 30px;">
          ${actionButtons}
          <div style="background:linear-gradient(135deg, #3b82f6, #2563eb);color:white;padding:12px 16px;border-radius:18px 4px 18px 18px;font-size:15px;line-height:1.5;border:2px solid #3b82f6; max-width: 80%;">
            ${userMessageHtml}
          </div>
        </div>
      `;
    } else {
      // 旧版本：保留内联 hover 事件
      return `
        <div class="message-container user-message-container" style="display:flex;justify-content:flex-end;margin-bottom:16px;padding-left:20%;position:relative; margin-top: 30px;"
             onmouseenter="this.querySelector('.action-buttons-container').style.display='flex'"
             onmouseleave="var container=this.querySelector('.action-buttons-container'); if(!container.matches(':hover')){container.style.display='none'}">
          ${actionButtons}
          <div style="background:linear-gradient(135deg, #3b82f6, #2563eb);color:white;padding:12px 16px;border-radius:18px 4px 18px 18px;font-size:15px;line-height:1.5;border:2px solid #3b82f6; max-width: 80%;">
            ${userMessageHtml}
          </div>
        </div>
      `;
    }
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
   * @param {string} docName - 文档名。
   * @param {object} dataForMindmap - 思维导图相关数据。
   * @returns {string} HTML字符串。
   */
  renderAssistantMessage: function(m, index, docName, dataForMindmap) {
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
          <div style="position:relative;">
            <div style="width:100%;max-height:180px;overflow-y:auto;height:auto;max-width:100%;border-radius:10px;box-shadow:0 2px 12px #0001;filter:blur(2px);background:#f8fafc;padding:16px 8px 8px 8px;">
              ${window.ChatbotRenderingUtils.renderMindmapShadow(safeMindMapData)}
            </div>
            <div style="position:absolute;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;z-index:2;">
              <button class="mindmap-open-btn"
                      data-action="open-mindmap"
                      data-mindmap-url="${mindmapUrl}">放大查看/编辑思维导图</button>
            </div>
          </div>
        `;
      } else {
        // 旧版本：内联事件
        renderedContent = `
          <div style="position:relative;">
            <div style="width:100%;max-height:180px;overflow-y:auto;height:auto;max-width:100%;border-radius:10px;box-shadow:0 2px 12px #0001;filter:blur(2px);background:#f8fafc;padding:16px 8px 8px 8px;">
              ${window.ChatbotRenderingUtils.renderMindmapShadow(safeMindMapData)}
            </div>
            <div style="position:absolute;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;z-index:2;">
              <button onclick="window.open('${mindmapUrl}','_blank')" style="padding:10px 22px;font-size:15px;background:rgba(59,130,246,0.92);color:#fff;border:none;border-radius:8px;box-shadow:0 2px 8px rgba(59,130,246,0.12);cursor:pointer;">放大查看/编辑思维导图</button>
            </div>
          </div>
        `;
      }
    } else {
      // 普通文本/Markdown/LaTeX
      if (m.role === 'assistant' && (!m.content || String(m.content).trim() === '')) {
        renderedContent = '<span style="color:#6b7280;">思考中...</span>';
      } else {
        try {
          if (typeof marked !== 'undefined' && typeof katex !== 'undefined') {
            if (typeof renderWithKatexStreaming === 'function') {
              renderedContent = renderWithKatexStreaming(m.content);
            } else if (typeof renderWithKatexFailback === 'function') {
              renderedContent = renderWithKatexFailback(m.content);
            } else {
              // XSS 防护：使用 safeRenderMarkdown 替代直接 marked.parse()
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
          <div id="${reasoningId}" style="background:linear-gradient(90deg,#f8fafc 80%,#f1f5f9 100%);color:#475569;padding:12px 16px 12px 16px;border-radius:10px;margin-bottom:14px;margin-top:24px;box-shadow:0 1px 4px rgba(0,0,0,0.05);position:relative;transition:all 0.2s;border:1px solid #e2e8f0;">
            <div style="display:flex;align-items:center;justify-content:space-between;">
              <span style='font-weight:600;font-size:14px;color:#64748b;'>思考过程</span>
              <button class="reasoning-toggle-btn"
                      data-action="toggle-reasoning"
                      data-index="${index}">
                ${collapsed ? '▼' : '▲'}
              </button>
            </div>
            <div style="margin-top:8px;${collapsed ? 'display:none;' : ''}color:#334155;font-size:14px;line-height:1.5;">
              ${renderedReasoningContent}
            </div>
          </div>
        `;
      } else {
        // 旧版本：内联事件
        reasoningBlock = `
          <div id="${reasoningId}" style="background:linear-gradient(90deg,#f8fafc 80%,#f1f5f9 100%);color:#475569;padding:12px 16px 12px 16px;border-radius:10px;margin-bottom:14px;margin-top:24px;box-shadow:0 1px 4px rgba(0,0,0,0.05);position:relative;transition:all 0.2s;border:1px solid #e2e8f0;">
            <div style="display:flex;align-items:center;justify-content:space-between;">
              <span style='font-weight:600;font-size:14px;color:#64748b;'>思考过程</span>
              <button onclick="(function(){window['reasoningCollapsed_${index}']=!window['reasoningCollapsed_${index}'];window.ChatbotUI.updateChatbotUI();})()" style="background:none;border:none;cursor:pointer;padding:2px 6px;color:#64748b;font-size:15px;">
                ${collapsed ? '▼' : '▲'}
              </button>
            </div>
            <div style="margin-top:8px;${collapsed ? 'display:none;' : ''}color:#334155;font-size:14px;line-height:1.5;">
              ${renderedReasoningContent}
            </div>
          </div>
        `;
      }
    }

    // 工具调用块
    let toolCallBlock = '';
    if (m.toolCallHtml) {
      // console.log('[MessageRenderer] 渲染工具调用块，索引:', index, 'HTML长度:', m.toolCallHtml.length);
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
      `;
    }

    // Phase 3: 移除助手消息容器的内联 hover 事件，改用 CSS :hover
    if (USE_EVENT_DELEGATION) {
      return `
        <div class="message-container assistant-message-container" style="display:flex;justify-content:flex-start;margin-bottom:16px;padding-right:20%;position:relative; margin-top: 30px;">
          ${actionButtons}
          <div style="background:linear-gradient(to bottom, #f9fafb, #f3f4f6);color:#111827;padding:12px 16px;border-radius:4px 18px 18px 18px;font-size:15px;line-height:1.5;box-shadow:0 2px 8px rgba(0,0,0,0.08);border:1px solid rgba(0,0,0,0.03);position:relative;">
            ${existingActions}
            <div class="assistant-message" data-message-index="${index}">
              ${toolCallBlock}
              ${reasoningBlock}
              <div class="markdown-content" style="padding-top:22px;">${renderedContent}</div>
            </div>
          </div>
        </div>
      `;
    } else {
      // 旧版本：保留内联 hover 事件
      return `
        <div class="message-container assistant-message-container" style="display:flex;justify-content:flex-start;margin-bottom:16px;padding-right:20%;position:relative; margin-top: 30px;"
             onmouseenter="this.querySelector('.action-buttons-container').style.display='flex'"
             onmouseleave="var container=this.querySelector('.action-buttons-container'); if(!container.matches(':hover')){container.style.display='none'}">
          ${actionButtons}
          <div style="background:linear-gradient(to bottom, #f9fafb, #f3f4f6);color:#111827;padding:12px 16px;border-radius:4px 18px 18px 18px;font-size:15px;line-height:1.5;box-shadow:0 2px 8px rgba(0,0,0,0.08);border:1px solid rgba(0,0,0,0.03);position:relative;">
            ${existingActions}
            <div class="assistant-message" data-message-index="${index}">
              ${toolCallBlock}
              ${reasoningBlock}
              <div class="markdown-content" style="padding-top:22px;">${renderedContent}</div>
            </div>
          </div>
        </div>
      `;
    }
  },

  /**
   * 渲染最终汇总消息。
   *
   * @param {object} m - 消息对象。
   * @returns {string} HTML字符串。
   */
  renderFinalSummaryMessage: function(m) {
    return `
      <div style="display:flex;justify-content:flex-start;margin-bottom:16px;padding-right:20%;">
        <div style="background:linear-gradient(to bottom, #dbeafe, #bfdbfe);color:#1e3a8a;padding:12px 16px;border-radius:4px 18px 18px 18px;font-size:15px;line-height:1.5;box-shadow:0 2px 8px rgba(59,130,246,0.08);border:1px solid #93c5fd;position:relative;">
          <div style="font-weight:bold;margin-bottom:4px;">最终汇总</div>
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
    return `
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
  },

  /**
   * 获取 Markdown 内容的样式。
   *
   * @returns {string} style 标签字符串。
   */
  getMarkdownStyles: function() {
    return `
      <style>
        /* Removed .message-container:hover .top-right-actions as it's handled by JS mouseover/out */

        /* Phase 3.5 防溢出：确保所有内容都在容器内 */
        .markdown-content {
          overflow-x: auto; /* 横向滚动 */
          word-wrap: break-word;
          overflow-wrap: break-word;
          max-width: 100%;
        }

        .markdown-content p {
          margin:8px 0;
          word-wrap: break-word;
          overflow-wrap: break-word;
        }

        .markdown-content h1, .markdown-content h2, .markdown-content h3,
        .markdown-content h4, .markdown-content h5, .markdown-content h6 {
          margin-top:16px;
          margin-bottom:8px;
          font-weight:600;
          word-wrap: break-word;
          overflow-wrap: break-word;
        }

        .markdown-content h1 {font-size:1.5em;}
        .markdown-content h2 {font-size:1.3em;}
        .markdown-content h3 {font-size:1.2em;}

        /* Phase 3.5 代码块防溢出：使用横向滚动 + 保持格式 */
        .markdown-content code {
          background:rgba(0,0,0,0.05);
          padding:2px 4px;
          border-radius:4px;
          font-family:monospace;
          font-size:0.9em;
          /* 行内代码允许换行，但优先保持完整 */
          white-space: normal;
          word-break: break-word;
        }

        .markdown-content pre {
          background:rgba(0,0,0,0.05);
          padding:10px;
          border-radius:8px;
          overflow-x:auto; /* 横向滚动 */
          margin:10px 0;
          max-width: 100%;
          /* 代码块保持原始格式，不换行 */
          white-space: pre;
        }

        .markdown-content pre code {
          background:transparent;
          padding:0;
          /* 代码块内的code保持pre格式 */
          white-space: pre;
          word-break: normal;
        }

        .markdown-content ul, .markdown-content ol {margin:8px 0;padding-left:20px;}

        .markdown-content blockquote {
          border-left:3px solid #cbd5e1;
          padding-left:12px;
          color:#4b5563;
          margin:10px 0;
          word-wrap: break-word;
          overflow-wrap: break-word;
        }

        .markdown-content img {
          max-width:100%;
          height:auto;
          border-radius:6px;
          margin:8px 0;
        }

        /* Phase 3.5 链接防溢出：强制断行 */
        .markdown-content a {
          color:#2563eb;
          text-decoration:underline;
          word-break: break-all; /* URL 强制断行 */
          overflow-wrap: break-word;
        }

        /* Phase 3.5 表格防溢出：横向滚动 */
        .markdown-content table {
          border-collapse:collapse;
          width:100%;
          margin:12px 0;
          display: block;
          overflow-x: auto; /* 横向滚动 */
          max-width: 100%;
        }

        .markdown-content th, .markdown-content td {
          border:1px solid #e5e7eb;
          padding:8px;
          /* 表格单元格内的文本优雅换行 */
          word-wrap: break-word;
          overflow-wrap: break-word;
          min-width: 50px; /* 最小宽度，避免过窄 */
          max-width: 300px; /* 最大宽度，避免过宽 */
        }

        .markdown-content th {background:#f3f4f6;}

        .mermaid { margin: 12px 0; }

        /* Phase 3.5 滚动条美化 */
        .markdown-content pre::-webkit-scrollbar,
        .markdown-content table::-webkit-scrollbar {
          height: 6px;
        }

        .markdown-content pre::-webkit-scrollbar-thumb,
        .markdown-content table::-webkit-scrollbar-thumb {
          background: rgba(0,0,0,0.2);
          border-radius: 3px;
        }

        .markdown-content pre::-webkit-scrollbar-thumb:hover,
        .markdown-content table::-webkit-scrollbar-thumb:hover {
          background: rgba(0,0,0,0.3);
        }
      </style>
    `;
  }
};