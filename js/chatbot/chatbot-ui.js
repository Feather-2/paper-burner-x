// chatbot-ui.js

// 发送按钮事件
function handleChatbotSend() {
  const input = document.getElementById('chatbot-input');
  if (!input) return;
  const val = input.value.trim();
  if (!val) return;
  input.value = '';
  window.ChatbotCore.sendChatbotMessage(val, updateChatbotUI);
}

// 预设问题点击
function handlePresetQuestion(q) {
  const input = document.getElementById('chatbot-input');
  if (!input) return;
  input.value = q;
  handleChatbotSend();
}

// 更新 Chatbot UI
function updateChatbotUI() {
  const modal = document.getElementById('chatbot-modal');
  const fab = document.getElementById('chatbot-fab');
  if (!modal || !fab) return;
  if (window.isChatbotOpen) {
    modal.style.display = 'flex';
    fab.style.display = 'none';
  } else {
    modal.style.display = 'none';
    fab.style.display = 'block';
  }
  const chatBody = document.getElementById('chatbot-body');
  const chatbotPreset = document.getElementById('chatbot-preset');
  let modelSelectorDiv = document.getElementById('chatbot-model-selector');
  // 先移除旧的
  if (modelSelectorDiv) modelSelectorDiv.remove();
  // 判断当前是否为自定义模型
  let isCustomModel = false;
  try {
    const config = window.ChatbotCore.getChatbotConfig();
    isCustomModel = config.model === 'custom';
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
    // 读取模型列表
    let models = [];
    try {
      const saved = localStorage.getItem('availableCustomModels');
      if (saved) models = JSON.parse(saved);
    } catch (e) {}
    if (!Array.isArray(models) || models.length === 0) models = [];
    let lastSelected = localStorage.getItem('lastSelectedCustomModel') || '';
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
    modelSelectorDiv.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:18px;justify-content:center;">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.5"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 8 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 5 15.4a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 8a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 8 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09A1.65 1.65 0 0 0 16 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 8c.14.31.22.65.22 1v.09A1.65 1.65 0 0 0 21 12c0 .35-.08.69-.22 1z"/></svg>
        <span style="font-size:17px;font-weight:700;color:#2563eb;">选择自定义模型</span>
      </div>
      <select id="chatbot-model-select" style="width:100%;margin:18px 0 0 0;padding:12px 16px;border-radius:10px;border:2px solid #93c5fd;background:white;color:#1e3a8a;font-size:15px;font-weight:600;outline:none;transition:all 0.2s;">
        ${models.length === 0 ? '<option value="">（无可用模型）</option>' : models.map(m => {
          if (typeof m === 'string') {
            return `<option value="${m}" ${m===lastSelected?'selected':''}>${m}</option>`;
          } else if (typeof m === 'object' && m) {
            return `<option value="${m.id}" ${m.id===lastSelected?'selected':''}>${m.name || m.id}</option>`;
          } else {
            return '';
          }
        }).join('')}
      </select>
      <button id="chatbot-model-back-btn" style="margin-top:28px;width:100%;padding:10px 0;font-size:15px;font-weight:600;background:linear-gradient(90deg,#3b82f6,#2563eb);color:white;border:none;border-radius:8px;box-shadow:0 2px 8px #2563eb22;cursor:pointer;transition:all 0.2s;">返回</button>
    `;
    // 隐藏预设问题和聊天内容
    chatbotPreset.style.display = 'none';
    if (chatBody) chatBody.style.display = 'none';
    // 插入模型选择div
    modal.querySelector('.chatbot-window').insertBefore(modelSelectorDiv, modal.querySelector('.chatbot-window').children[2]);
    // 监听选择
    const select = document.getElementById('chatbot-model-select');
    if (select) {
      select.onchange = function() {
        localStorage.setItem('lastSelectedCustomModel', this.value);
      };
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
        return `
          <div style="display:flex;justify-content:flex-end;margin-bottom:16px;padding-left:20%;">
            <div style="background:linear-gradient(135deg, #3b82f6, #2563eb);color:white;padding:12px 16px;border-radius:18px 4px 18px 18px;font-size:15px;line-height:1.5;border:2px solid #3b82f6;">
              ${window.ChatbotUtils.escapeHtml(m.content)}
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
      </style>
    `;
    chatBody.scrollTop = chatBody.scrollHeight;
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
}

// 初始化 Chatbot 浮动按钮和弹窗
function initChatbotUI() {
  let fab = document.getElementById('chatbot-fab');
  if (!fab) {
    fab = document.createElement('div');
    fab.id = 'chatbot-fab';
    fab.style.position = 'fixed';
    fab.style.bottom = '32px';
    fab.style.right = '32px';
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
    modal.innerHTML = `
      <div class="chatbot-window" style="background:var(--chat-bg,#ffffff);max-width:720px;width:92vw;min-height:520px;max-height:85vh;border-radius:24px;box-shadow:0 10px 40px rgba(0,0,0,0.18),0 0 0 1px rgba(0,0,0,0.05);position:absolute;right:44px;bottom:44px;display:flex;flex-direction:column;overflow:hidden;">
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
          <div id="chatbot-preset" style="margin-bottom:20px;display:flex;flex-wrap:wrap;gap:8px 10px;">
            ${(window.ChatbotPreset && window.ChatbotPreset.PRESET_QUESTIONS ? window.ChatbotPreset.PRESET_QUESTIONS : [
              '请总结本文',
              '有哪些关键公式？',
              '研究背景与意义？',
              '研究方法是什么，有什么发现？',
              '应用与前景如何？',
              '请用通俗语言解释全文',
              '为本文内容生成思维导图'
            ]).map(q => `
              <button style="background:linear-gradient(to bottom, rgba(240,249,255,0.95), rgba(224,242,254,0.95));color:#0369a1;border-radius:32px;border:2px dashed rgba(125,211,252,0.4);padding:8px 16px;font-size:13px;font-weight:500;cursor:pointer;transition:all 0.2s;margin:4px 0;"
                onmouseover="this.style.transform='translateY(-2px)';"
                onmouseout="this.style.transform='translateY(0)';"
                onclick="window.handlePresetQuestion(decodeURIComponent('${encodeURIComponent(q)}'))"
              >${q}</button>
            `).join('')}
          </div>
          <div id="chatbot-body" style="flex:1;overflow-y:auto;padding-right:6px;margin-right:-6px;padding-bottom:10px;scrollbar-width:thin;scrollbar-color:#ddd transparent;scroll-behavior:smooth;"></div>
        </div>
        <div style="padding:16px 20px;border-top:1px dashed rgba(0,0,0,0.1);background:rgba(249,250,251,0.7);">
          <div style="display:flex;align-items:center;gap:12px;">
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