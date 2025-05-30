// js/chatbot/chatbot-mermaid-renderer.js

/**
 * 渲染聊天内容中的所有 Mermaid 代码块。
 *
 * 主要流程：
 * 1. 查找所有 code.language-mermaid 代码块。
 * 2. 对每个代码块：
 *    - 清理和修正 Mermaid 代码（如去除 HTML 标签、<br>等）。
 *    - 创建 div.mermaid 容器，设置唯一ID。
 *    - 使用 mermaid.init 渲染 SVG。
 *    - 渲染成功则显示 SVG，并添加"放大"按钮。
 *    - 渲染失败则回退显示上一次成功的 SVG，或显示错误信息。
 *    - 支持多次尝试渲染（异步加载 mermaid.js 时）。
 * @param {HTMLElement} chatBodyElement - 聊天消息容器 DOM 元素。
 */
async function renderAllMermaidBlocksInternal(chatBodyElement) {
  if (!window.mermaidLoaded || typeof window.mermaid === 'undefined') return;
  if (!chatBodyElement) {
    console.warn('ChatbotMermaidRenderer: chatBodyElement 为空，跳过 Mermaid 渲染。');
    return;
  }
  // 查找所有 mermaid 代码块（code.language-mermaid 或 pre code.language-mermaid）
  const mermaidBlocks = chatBodyElement.querySelectorAll('code.language-mermaid, pre code.language-mermaid');
  mermaidBlocks.forEach(async (block, idx) => {
    let currentCodeForError = '';
    try {
      // 只做最基础的清理，不做任何智能修正
      let rawCode = block.textContent || '';
      if (!rawCode.trim()) {
        console.warn('ChatbotMermaidRenderer: 空的Mermaid代码块，跳过处理');
        return;
      }

      currentCodeForError = rawCode; // Assign for potential error reporting

      // 1. 将 <br> 标签替换为换行
      rawCode = rawCode.replace(/<br\s*\/?\>/gi, '\n');

      // 2. 移除所有 HTML 标签，但保留内容
      rawCode = rawCode.replace(/<[^>]+>/g, '');

      // 不再做任何其它正则修正，直接交给 Mermaid 解析
      // 选择父节点（兼容 pre > code 或单独 code）
      let parent;
      try {
        parent = block.parentElement.tagName === 'PRE' ? block.parentElement : block;
      } catch (e) {
        parent = block; // 兜底
      }
      const code = rawCode;
      currentCodeForError = code;
      // 创建 Mermaid 渲染容器
      const mermaidDiv = document.createElement('div');
      const uniqueId = 'mermaid-' + Date.now() + '-' + idx + '-' + Math.floor(Math.random()*10000);
      mermaidDiv.className = 'mermaid';
      mermaidDiv.id = uniqueId;
      // 卡片样式
      mermaidDiv.style.background = 'var(--chatbot-bg, #fff)';
      mermaidDiv.style.borderRadius = '12px';
      mermaidDiv.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.03)';
      mermaidDiv.style.padding = '20px';
      mermaidDiv.style.position = 'relative';
      mermaidDiv.style.width = 'fit-content';
      mermaidDiv.style.maxWidth = '100%';
      mermaidDiv.style.margin = '12px auto';
      mermaidDiv.textContent = code;

      // 检查内容有效性
      const codeTrimmed = code.replace(/\s+/g, '');
      if (!codeTrimmed || /^graph(TD|LR|RL|BT|TB)?$/i.test(codeTrimmed)) {
        mermaidDiv.innerHTML = '<div style="color:#64748b;">无有效Mermaid内容</div>';
        parent.replaceWith(mermaidDiv);
        return;
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
        // 使用 mermaid.init 渲染 SVG
        await window.mermaid.init(undefined, '#' + uniqueId);
        // 渲染成功，清除错误边框
        mermaidDiv.style.border = '';
        const existingWarning = mermaidDiv.querySelector('.mermaid-render-warning');
        if (existingWarning) existingWarning.remove();

        // 延迟添加"查看代码"按钮，避免渲染冲突
        setTimeout(() => {
          try {
            // 查看代码按钮
            if (!mermaidDiv.querySelector('.mermaid-code-btn')) {
              const codeBtn = document.createElement('button');
              codeBtn.className = 'mermaid-action-btn mermaid-code-btn';
              codeBtn.title = '查看/隐藏代码';
              codeBtn.innerHTML = `<svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18"><path d="M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z"></path><path fill-rule="evenodd" d="M.664 10.59a1.651 1.651 0 010-1.186A10.004 10.004 0 0110 3c4.257 0 7.893 2.66 9.336 6.404a1.651 1.651 0 010 1.186A10.004 10.004 0 0110 17c-4.257 0-7.893-2.66-9.336-6.404zM10 15a5 5 0 100-10 5 5 0 000 10z" clip-rule="evenodd"></path></svg>`;
              codeBtn.style.cssText = `
                position:absolute; top:12px; right:48px;
                background: transparent; color: #64748b;
                border: none; border-radius: 6px; padding: 4px;
                cursor: pointer; opacity:0.7; transition: opacity 0.2s, background-color 0.2s;
                display:flex; align-items:center; justify-content:center;
              `;
              codeBtn.onmouseover = function() { this.style.opacity = '1'; this.style.backgroundColor = 'rgba(0,0,0,0.05)'; };
              codeBtn.onmouseout = function() { this.style.opacity = '0.7'; this.style.backgroundColor = 'transparent'; };
              codeBtn.onclick = function() {
                const codeContainer = mermaidDiv.querySelector('.mermaid-original-code');
                if (codeContainer) {
                  // 切换显示/隐藏
                  if (codeContainer.style.display === 'none') {
                    codeContainer.style.display = 'block';
                    codeBtn.textContent = '隐藏代码';
                  } else {
                    codeContainer.style.display = 'none';
                    codeBtn.textContent = '查看代码';
                  }
                } else {
                  // 创建代码显示区域
                  const originalCode = document.createElement('pre');
                  originalCode.className = 'mermaid-original-code';
                  originalCode.style.cssText = `
                    position:relative;
                    background:#f8f9fa;
                    border:1px solid #e9ecef;
                    border-radius:6px;
                    padding:12px;
                    margin-top:12px;
                    font-family:monospace;
                    font-size:13px;
                    white-space:pre-wrap;
                    word-break:break-all;
                    max-height:300px;
                    overflow-y:auto;
                  `;
                  originalCode.textContent = currentCodeForError;
                  // 复制按钮
                  const copyBtn = document.createElement('button');
                  copyBtn.textContent = '复制';
                  copyBtn.style.cssText = `
                    position:absolute;top:8px;right:8px;
                    background:#e9ecef;border:none;
                    border-radius:4px;padding:2px 8px;
                    font-size:12px;cursor:pointer;
                  `;
                  copyBtn.onclick = function(e) {
                    e.stopPropagation();
                    navigator.clipboard.writeText(currentCodeForError)
                      .then(() => {
                        const originalText = copyBtn.textContent;
                        copyBtn.textContent = '已复制!';
                        setTimeout(() => {
                          copyBtn.textContent = originalText;
                        }, 2000);
                      })
                      .catch(err => {
                        console.error('复制失败:', err);
                        alert('复制失败: ' + err);
                      });
                  };
                  originalCode.appendChild(copyBtn);
                  mermaidDiv.appendChild(originalCode);
                  codeBtn.textContent = '隐藏代码';
                }
              };
              mermaidDiv.appendChild(codeBtn);
            }
            // 放大按钮
            if (!mermaidDiv.querySelector('.mermaid-zoom-btn')) {
              const zoomBtn = document.createElement('button');
              zoomBtn.className = 'mermaid-action-btn mermaid-zoom-btn';
              zoomBtn.title = '放大查看';
              zoomBtn.innerHTML = `<svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18"><path fill-rule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clip-rule="evenodd"></path><path fill-rule="evenodd" d="M9 5.5a.5.5 0 01.5.5v2.5h2.5a.5.5 0 010 1h-2.5v2.5a.5.5 0 01-1 0v-2.5h-2.5a.5.5 0 010-1h2.5v-2.5a.5.5 0 01.5-.5z" clip-rule="evenodd"></path></svg>`;
              zoomBtn.style.cssText = `
                position:absolute; top:12px; right:12px;
                background: transparent; color: #64748b;
                border: none; border-radius: 6px; padding: 4px;
                cursor: pointer; opacity:0.7; transition: opacity 0.2s, background-color 0.2s;
                display:flex; align-items:center; justify-content:center;
              `;
              zoomBtn.onmouseover = function() { this.style.opacity = '1'; this.style.backgroundColor = 'rgba(0,0,0,0.05)'; };
              zoomBtn.onmouseout = function() { this.style.opacity = '0.7'; this.style.backgroundColor = 'transparent'; };
              zoomBtn.onclick = function() {
                try {
                  // 创建遮罩和弹窗，显示 SVG 大图
                  const overlay = document.createElement('div');
                  overlay.style.cssText = 'position:fixed;z-index:999999;left:0;top:0;width:100vw;height:100vh;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;';
                  const popup = document.createElement('div');
                  popup.style.cssText = 'background:var(--chatbot-bg, #fff);padding:24px;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,0.1), 0 0 0 1px rgba(0,0,0,0.05);width:95vw;max-width:1200px;height:90vh;overflow:auto;position:relative;display:flex;flex-direction:column;align-items:center;';
                  const title = document.createElement('div');
                  title.textContent = 'Mermaid 图表预览';
                  title.style.cssText = 'font-weight:bold;font-size:18px;margin-bottom:18px;';
                  popup.appendChild(title);
                  const svgInMermaidDiv = mermaidDiv.querySelector('svg');
                  if (svgInMermaidDiv) {
                    const svgClone = svgInMermaidDiv.cloneNode(true);
                    svgClone.style.width = '100%';
                    svgClone.style.maxWidth = '100%';
                    svgClone.style.height = 'auto';
                    svgClone.style.flexGrow = '1';
                    svgClone.style.display = 'block';
                    svgClone.style.margin = '0 auto 16px auto';
                    popup.appendChild(svgClone);
                    // 弹窗底部操作按钮（导出PNG、SVG、代码、Mermaid.live）
                    const popupActions = document.createElement('div');
                    popupActions.style.cssText = 'display:flex; flex-wrap:wrap; gap:12px; justify-content:center; padding-top:16px; border-top: 1px solid rgba(0,0,0,0.08); width:100%;';

                    // Helper function to create icon buttons for popup
                    const createPopupActionButton = (title, svgIcon, onClickAction) => {
                      const button = document.createElement('button');
                      button.title = title;
                      button.innerHTML = svgIcon;
                      button.style.cssText = `
                        background: rgba(0,0,0,0.05); color: #334155;
                        border: none; border-radius: 8px; padding: 8px 12px;
                        cursor: pointer; transition: background-color 0.2s, color 0.2s;
                        display: flex; align-items: center; gap: 6px; font-size: 13px;
                      `;
                      button.onmouseover = function() { this.style.backgroundColor = 'rgba(0,0,0,0.1)'; };
                      button.onmouseout = function() { this.style.backgroundColor = 'rgba(0,0,0,0.05)'; };
                      button.onclick = onClickAction;
                      popupActions.appendChild(button);
                      return button;
                    };

                    // Icons (Heroicons - Outline)
                    const iconDownload = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" width="18" height="18"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>';
                    const iconCode = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" width="18" height="18"><path stroke-linecap="round" stroke-linejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" /></svg>';
                    const iconExternalLink = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" width="18" height="18"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" /></svg>';
                    const iconPhoto = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" width="18" height="18"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.158 0L10.5 9.75M16.5 12L18 10.5m-1.5 1.5l-1.5-1.5m0 0L13.5 9.75M12 12.75l1.5-1.5" /></svg>';

                    // Export PNG Button (Icon + Text)
                    const exportPngBtn = createPopupActionButton('导出PNG', iconPhoto + 'PNG', function() {
                      // ... (PNG export logic -  ensure svgClone is used and it is still in the DOM or passed correctly)
                      // Simplified for brevity, original PNG export logic needs to be adapted to use svgClone from this scope
                        try {
                            const loadingToast = document.createElement('div'); /* ... */ document.body.appendChild(loadingToast);
                            const svgElementForExport = svgClone; // Use the clone from the popup
                            const svgRect = svgElementForExport.getBoundingClientRect();
                            let width = svgRect.width;
                            let height = svgRect.height;
                             if (width === 0 && height === 0) { // Fallback if getBoundingClientRect fails for non-rendered element
                                const viewBox = svgElementForExport.getAttribute('viewBox');
                                if (viewBox) {
                                    const parts = viewBox.split(' ');
                                    width = parseFloat(parts[2]);
                                    height = parseFloat(parts[3]);
                                }
                                if (!width || !height) { // Absolute fallback
                                    width = 800; height = 600;
                                }
                            }

                            if (svgElementForExport.innerHTML.includes('<foreignObject')) {
                              alert('当前图表包含 HTML 元素，PNG 导出不被浏览器支持，请先导出 SVG 再用专业工具转换为 PNG。');
                              document.body.removeChild(loadingToast);
                              return;
                            }

                            const scale = 3; const scaledWidth = Math.round(width * scale); const scaledHeight = Math.round(height * scale);
                            const canvas = document.createElement('canvas'); canvas.width = scaledWidth; canvas.height = scaledHeight;
                            const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, scaledWidth, scaledHeight);
                            const serializer = new XMLSerializer(); let svgString = serializer.serializeToString(svgElementForExport);
                            svgString = '<?xml version="1.0" standalone="no"?>\n' + svgString;
                            svgString = svgString.replace(/<svg/g, '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"');
                            const svgBase64 = btoa(unescape(encodeURIComponent(svgString))); const imgSrc = `data:image/svg+xml;base64,${svgBase64}`;
                            const img = new Image();
                            img.onload = function() {
                                ctx.clearRect(0, 0, scaledWidth, scaledHeight); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, scaledWidth, scaledHeight);
                                ctx.scale(scale, scale); ctx.drawImage(img, 0, 0, width, height); // ensure original dimensions for drawImage
                                const pngUrl = canvas.toDataURL('image/png');
                                if (pngUrl.length <= 22) { throw new Error('图像生成失败'); }
                                const downloadLink = document.createElement('a'); downloadLink.href = pngUrl; downloadLink.download = 'mermaid-diagram-hd.png';
                                document.body.appendChild(downloadLink); downloadLink.click(); document.body.removeChild(downloadLink);
                                document.body.removeChild(loadingToast); /* Show success toast */
                            };
                            img.onerror = function(e) {
                              document.body.removeChild(loadingToast);
                              console.error('图片导出失败: 图像处理错误', e, imgSrc, svgString);
                              alert('图片导出失败: 图像处理错误');
                            };
                            img.src = imgSrc;
                        } catch (e) { if(document.querySelector('div[textContent="正在处理图片..."]')) document.body.removeChild(document.querySelector('div[textContent="正在处理图片..."]')); alert('导出图片失败: ' + (e.message || e)); }
                    });
                    exportPngBtn.innerHTML = iconPhoto + '导出PNG'; // Add text next to icon

                    // Export SVG Button
                    createPopupActionButton('导出SVG', iconDownload + 'SVG', function() {
                      const serializer = new XMLSerializer();
                      let svgString = serializer.serializeToString(svgClone);
                      const blob = new Blob([svgString], {type: 'image/svg+xml'});
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a'); a.href = url; a.download = 'mermaid-diagram.svg';
                      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
                    }).innerHTML = iconDownload + '导出SVG';

                    // Export Code Button
                    createPopupActionButton('导出代码', iconCode + 'MMD', function() {
                      const blob = new Blob([currentCodeForError], {type: 'text/plain'});
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a'); a.href = url; a.download = 'mermaid-code.mmd';
                      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
                    }).innerHTML = iconCode + '导出MMD';

                    // Open in Mermaid.live Button
                    createPopupActionButton('在Mermaid.live中打开', iconExternalLink + 'Mermaid.live', function() {
                      const data = { code: currentCodeForError, mermaid: { theme: 'default' } };
                      const json = JSON.stringify(data);
                      const encoded = btoa(unescape(encodeURIComponent(json)));
                      const liveUrl = `https://mermaid.live/edit#${encoded}`;
                      window.open(liveUrl, '_blank');
                    }).innerHTML = iconExternalLink + 'Mermaid.live';

                    popup.appendChild(popupActions);
                    // 关闭按钮
                    const closeBtn = document.createElement('button');
                    closeBtn.title = '关闭';
                    closeBtn.innerHTML = `<svg viewBox="0 0 20 20" fill="currentColor" width="20" height="20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clip-rule="evenodd"></path></svg>`;
                    closeBtn.style.cssText = `
                      position:absolute; top:16px; right:16px;
                      background: transparent; color: #64748b;
                      border: none; border-radius: 50%; padding: 6px;
                      cursor: pointer; opacity:0.7; transition: opacity 0.2s, background-color 0.2s;
                      display:flex; align-items:center; justify-content:center;
                    `;
                    closeBtn.onmouseover = function() { this.style.opacity = '1'; this.style.backgroundColor = 'rgba(0,0,0,0.05)';};
                    closeBtn.onmouseout = function() { this.style.opacity = '0.7'; this.style.backgroundColor = 'transparent';};
                    closeBtn.onclick = function() { document.body.removeChild(overlay); };
                    popup.appendChild(closeBtn);
                    overlay.appendChild(popup);
                    document.body.appendChild(overlay);
                  } else {
                    const errorDiv = document.createElement('div');
                    errorDiv.style.color = '#e53e3e';
                    errorDiv.textContent = '无法获取SVG内容进行放大预览。';
                    popup.appendChild(errorDiv);
                  }
                } catch (e) {
                  alert('放大预览弹窗出错：'+(e.message||e));
                }
              };
              mermaidDiv.appendChild(zoomBtn);
            }
          } catch (btnError) {
            console.error('添加按钮时发生错误:', btnError);
            const escapedMessage = typeof window.ChatbotUtils !== 'undefined' && typeof window.ChatbotUtils.escapeHtml === 'function' ? window.ChatbotUtils.escapeHtml(btnError.str || btnError.message) : (btnError.str || btnError.message);
            mermaidDiv.innerHTML += '<div style="color:#e53e3e;">渲染按钮失败: ' + escapedMessage + '</div>';
          }
        }, 100);
      } catch (renderError) {
        /**
         * Mermaid 渲染失败处理：
         * 1. 若 data-mermaid-final 属性为 true，尝试多级正则修正。
         * 2. 若有上一次成功 SVG，回退显示。
         * 3. 否则显示错误信息和原始代码。
         */
        const isFinal = block.getAttribute && block.getAttribute('data-mermaid-final') === 'true';
        if (isFinal) {
          // 多级修正函数
          const mermaidFixers = [
            // 0. 修正节点定义后多余的节点名（如 B[...]B --> ...）
            // 例如：B[xxx]B --> C[yyy] 变成 B[xxx] --> C[yyy]
            code => code.replace(/([A-Za-z0-9_]+)\[([^\]]+)\]\1(\s*[-<])/g, '$1[$2]$3'),
            // 1. 修正 subgraph 行
            code => code.replace(/^\s*subgraph\s+([^\n]+)$/gm, (m, name) => {
              let fixed = name.replace(/\([^\)]*\)/g, '');
              fixed = fixed.replace(/[.,，]/g, '');
              fixed = fixed.replace(/\s+/g, ' ').trim();
              return 'subgraph ' + fixed;
            }),
            code => code,
            code => code.replace(/<br\s*\/?\>/gi, '\n'),
            code => code.replace(/<[^>]+>/g, ''),
            code => code.replace(/^\s*graph\s*$/i, ''),
            code => code.replace(/[\u200B-\u200D\uFEFF]/g, ''),
            // 1. 先将括号内的斜杠替换为中文斜杠
            code => code.replace(/\[[^\]]*\([^\)]*\)[^\]]*\]/g, m => m.replace(/\(([^)]*)\)/g, (all, inner) => '(' + inner.replace(/\//g, '／') + ')')),
            // 2. 去除节点文本中的括号及其内容
            code => code.replace(/\[[^\]]*\([^\)]*\)[^\]]*\]/g, m => m.replace(/\([^\)]*\)/g, '')),
            // 3. 将所有括号替换为全角
            code => code.replace(/\(/g, '（').replace(/\)/g, '）'),
            // 4. 去除节点文本中的特殊符号
            code => code.replace(/\[[^\]]*\]/g, m => m.replace(/[:/\-]/g, '')),
            // 5. 极端兜底，只保留节点内的中英文和数字
            code => code.replace(/\[[^\]]*\]/g, m => m.replace(/[^\u4e00-\u9fa5a-zA-Z0-9\[\]]/g, '')),
          ];
          let fixSuccess = false;
          for (let i = 0; i < mermaidFixers.length; i++) {
            const fixedCode = mermaidFixers[i](currentCodeForError);
            mermaidDiv.textContent = fixedCode;
            try {
              await window.mermaid.init(undefined, '#' + uniqueId);
              fixSuccess = true;
              break;
            } catch (e) {}
          }
          if (fixSuccess) return;
        }
        // 兜底：显示上一次 SVG 或错误信息
        const escapedErrorMessage = typeof window.ChatbotUtils !== 'undefined' && typeof window.ChatbotUtils.escapeHtml === 'function' ? window.ChatbotUtils.escapeHtml(renderError.str || renderError.message) : (renderError.str || renderError.message);
        const escapedCode = typeof window.ChatbotUtils !== 'undefined' && typeof window.ChatbotUtils.escapeHtml === 'function' ? window.ChatbotUtils.escapeHtml(currentCodeForError) : currentCodeForError;
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
          warn.textContent = '当前Mermaid内容解析失败，已显示上一次成功渲染。错误: ' + escapedErrorMessage;
        } else {
          mermaidDiv.innerHTML = '<div style="color:#e53e3e;">Mermaid 渲染失败: ' + escapedErrorMessage + '</div>'
            + '<pre style="color:#64748b;font-size:13px;background:#f3f4f6;border-radius:6px;padding:8px 12px;overflow-x:auto;margin-top:8px;">'
            + escapedCode
            + '</pre>';
          mermaidDiv.style.border = '2px solid #e53e3e'; // 红色边框
        }
      }
    } catch (generalBlockError) {
      // 兜底：处理 block 解析或 DOM 操作异常
      const escapedGeneralErrorMessage = typeof window.ChatbotUtils !== 'undefined' && typeof window.ChatbotUtils.escapeHtml === 'function' ? window.ChatbotUtils.escapeHtml(generalBlockError.message) : generalBlockError.message;
      console.error('处理Mermaid block时发生一般错误:', generalBlockError, block);
      let errorDisplayDiv = block.parentElement || document.createElement('div');
      if (block.parentElement) {
         let tempDiv = document.createElement('div');
         tempDiv.innerHTML = '<div style="color:#e53e3e;">Mermaid block处理异常: ' + escapedGeneralErrorMessage + '</div>';
         block.replaceWith(tempDiv);
      } else {
        block.innerHTML = '<div style="color:#e53e3e;">Mermaid block处理异常: ' + escapedGeneralErrorMessage + '</div>';
      }
    }
  });
}

// 挂载到全局命名空间
if (typeof window.ChatbotRenderingUtils === 'undefined') {
  window.ChatbotRenderingUtils = {};
}
window.ChatbotRenderingUtils.renderAllMermaidBlocks = renderAllMermaidBlocksInternal;