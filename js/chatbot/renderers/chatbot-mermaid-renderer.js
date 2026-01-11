// js/chatbot/chatbot-mermaid-renderer.js

/**
 * 本地 HTML 转义函数（用于错误消息防护）
 * 如果 ChatbotUtils.escapeHtml 不可用时的降级方案
 * @param {string} str - 需要转义的字符串
 * @returns {string} 转义后的安全字符串
 */
function localEscapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[&<>"']/g, function (c) {
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c];
  });
}

/**
 * 安全地转义 HTML（优先使用 ChatbotUtils，降级到本地实现）
 * @param {string} str - 需要转义的字符串
 * @returns {string} 转义后的安全字符串
 */
function safeEscapeHtml(str) {
  if (typeof window !== 'undefined' && window.ChatbotUtils && typeof window.ChatbotUtils.escapeHtml === 'function') {
    return window.ChatbotUtils.escapeHtml(str);
  }
  return localEscapeHtml(str);
}

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
export async function renderAllMermaidBlocksInternal(chatBodyElement) {
  if (typeof window === 'undefined') return;
  if (!window.mermaidLoaded || typeof window.mermaid === 'undefined') return;
  if (!chatBodyElement) {
    console.warn('ChatbotMermaidRenderer: chatBodyElement 为空，跳过 Mermaid 渲染。');
    return;
  }

  // 按钮添加辅助函数（避免代码重复）
  const addMermaidButtons = (mermaidDiv, currentCodeForError) => {
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
              if (codeContainer.style.display === 'none') {
                codeContainer.style.display = 'block';
              } else {
                codeContainer.style.display = 'none';
              }
            } else {
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
                    setTimeout(() => { copyBtn.textContent = originalText; }, 2000);
                  })
                  .catch(err => {
                    console.error('复制失败:', err);
                    alert('复制失败: ' + err);
                  });
              };
              originalCode.appendChild(copyBtn);
              mermaidDiv.appendChild(originalCode);
            }
          };
          mermaidDiv.appendChild(codeBtn);
        }
        // 放大按钮（完整功能复用）
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
                const createPopupActionButton = (btnTitle, svgIcon, onClickAction) => {
                  const button = document.createElement('button');
                  button.title = btnTitle;
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

                // Export PNG Button (使用 html2canvas)
                const exportPngBtn = createPopupActionButton('导出PNG', iconPhoto + 'PNG', async function() {
                  try {
                    exportPngBtn.innerHTML = iconPhoto + '导出中...';
                    exportPngBtn.disabled = true;

                    // 检查 html2canvas 是否可用
                    if (typeof html2canvas === 'undefined') {
                      throw new Error('html2canvas 库未加载');
                    }

                    // 创建一个临时容器来包裹 SVG
                    const tempContainer = document.createElement('div');
                    tempContainer.style.cssText = 'position: absolute; left: -9999px; top: 0; background: white; padding: 20px;';
                    const svgForExport = svgClone.cloneNode(true);

                    // 获取 SVG 的原始尺寸
                    const svgRect = svgClone.getBoundingClientRect();
                    const originalWidth = svgRect.width || 800;
                    const originalHeight = svgRect.height || 600;

                    // 放大 SVG 以提高清晰度
                    const scaleFactor = 4; // 4倍放大
                    svgForExport.setAttribute('width', originalWidth * scaleFactor);
                    svgForExport.setAttribute('height', originalHeight * scaleFactor);
                    svgForExport.style.display = 'block';
                    svgForExport.style.width = (originalWidth * scaleFactor) + 'px';
                    svgForExport.style.height = (originalHeight * scaleFactor) + 'px';

                    tempContainer.appendChild(svgForExport);
                    document.body.appendChild(tempContainer);

                    // 使用 html2canvas 截图容器（高分辨率）
                    const canvas = await html2canvas(tempContainer, {
                      backgroundColor: '#ffffff',
                      scale: 1, // SVG 已经放大了，这里用 1 即可
                      logging: false,
                      useCORS: true,
                      allowTaint: true,
                      width: originalWidth * scaleFactor + 40, // 加上 padding
                      height: originalHeight * scaleFactor + 40
                    });

                    // 清理临时容器
                    document.body.removeChild(tempContainer);

                    // 下载 PNG
                    canvas.toBlob(function(blob) {
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = 'mermaid-diagram.png';
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                      URL.revokeObjectURL(url);

                      exportPngBtn.innerHTML = iconPhoto + '导出PNG';
                      exportPngBtn.disabled = false;
                    }, 'image/png');

                  } catch (e) {
                    console.error('PNG 导出失败:', e);
                    alert('PNG 导出失败: ' + (e.message || e) + '\n\n建议：先导出 SVG，然后使用在线工具转换。');
                    exportPngBtn.innerHTML = iconPhoto + '导出PNG';
                    exportPngBtn.disabled = false;
                  }
                });
                exportPngBtn.innerHTML = iconPhoto + '导出PNG';

                // Export SVG Button
                const exportSvgBtn = createPopupActionButton('导出SVG', iconDownload + 'SVG', function() {
                  try {
                    // 克隆 SVG 用于导出
                    const svgCloneForExport = svgClone.cloneNode(true);

                    // 复制所有计算后的样式到内联样式
                    const copyComputedStyles = (source, target) => {
                      const sourceElements = source.querySelectorAll('*');
                      const targetElements = target.querySelectorAll('*');
                      for (let i = 0; i < sourceElements.length && i < targetElements.length; i++) {
                        const computedStyle = window.getComputedStyle(sourceElements[i]);
                        const cssText = computedStyle.cssText;
                        if (cssText) {
                          targetElements[i].setAttribute('style', cssText);
                        }
                      }
                    };
                    copyComputedStyles(svgClone, svgCloneForExport);

                    const serializer = new XMLSerializer();
                    let svgString = serializer.serializeToString(svgCloneForExport);

                    // 添加 XML 声明
                    svgString = '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n' + svgString;

                    // 确保有正确的命名空间
                    if (!svgString.includes('xmlns="http://www.w3.org/2000/svg"')) {
                      svgString = svgString.replace(/<svg/, '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"');
                    }

                    const blob = new Blob([svgString], {type: 'image/svg+xml;charset=utf-8'});
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'mermaid-diagram.svg';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    setTimeout(() => URL.revokeObjectURL(url), 100);
                  } catch (e) {
                    console.error('SVG 导出失败:', e);
                    alert('SVG 导出失败: ' + (e.message || e));
                  }
                });
                exportSvgBtn.innerHTML = iconDownload + '导出SVG';

                // Export Code Button
                const exportCodeBtn = createPopupActionButton('导出代码', iconCode + 'MMD', function() {
                  const blob = new Blob([currentCodeForError], {type: 'text/plain'});
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'mermaid-code.mmd';
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                });
                exportCodeBtn.innerHTML = iconCode + '导出MMD';

                // Open in Mermaid.live Button
                const openLiveBtn = createPopupActionButton('在Mermaid.live中打开', iconExternalLink + 'Mermaid.live', function() {
                  const data = { code: currentCodeForError, mermaid: { theme: 'default' } };
                  const json = JSON.stringify(data);
                  const encoded = btoa(unescape(encodeURIComponent(json)));
                  const liveUrl = `https://mermaid.live/edit#${encoded}`;
                  const newWindow = window.open(liveUrl, '_blank', 'noopener,noreferrer');
                  if (newWindow) newWindow.opener = null;
                });
                openLiveBtn.innerHTML = iconExternalLink + 'Mermaid.live';

                popup.appendChild(popupActions);
              }

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
            } catch (e) {
              alert('放大预览弹窗出错：'+(e.message||e));
            }
          };
          mermaidDiv.appendChild(zoomBtn);
        }
      } catch (btnError) {
        console.error('添加按钮时发生错误:', btnError);
      }
    }, 100);
  };

  // 查找所有 mermaid 代码块（code.language-mermaid 或 pre code.language-mermaid）
  const mermaidBlocks = chatBodyElement.querySelectorAll('code.language-mermaid, pre code.language-mermaid');

  // 使用 for...of 替代 forEach，确保顺序执行，避免竞态条件
  let blockIndex = 0;
  for (const block of mermaidBlocks) {
    const idx = blockIndex++;
    let currentCodeForError = '';

    try {
      // 检查是否已经渲染过（防止重复渲染）
      if (block.hasAttribute('data-mermaid-rendered')) {
        console.log(`Mermaid 代码块 ${idx} 已渲染，跳过`);
        continue;
      }

      // 标记为正在渲染
      block.setAttribute('data-mermaid-rendered', 'true');
      // 增强的代码清理和预处理
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

      // 3. 移除零宽字符和特殊空白字符
      rawCode = rawCode.replace(/[\u200B-\u200D\uFEFF]/g, '');

      // 4. 统一换行符为 \n
      rawCode = rawCode.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

      // 5. 移除多余的空行（超过2个连续换行）
      rawCode = rawCode.replace(/\n{3,}/g, '\n\n');

      // 6. 移除每行首尾空白，但保持缩进结构
      rawCode = rawCode.split('\n').map(line => line.trimEnd()).join('\n');

      // 7. **关键修正：处理节点标签内的多行文本**
      // Mermaid 不支持 [...] 内的换行符，需要将多行标签转为单行
      rawCode = rawCode.replace(/([A-Za-z0-9_]+)\[([^\]]+)\]/g, (match, nodeId, labelContent) => {
        // 将标签内的换行替换为空格
        let cleanLabel = labelContent.replace(/\n+/g, ' ');
        // 压缩多余空格
        cleanLabel = cleanLabel.replace(/\s+/g, ' ').trim();
        // **替换特殊符号为全角（避免 Mermaid 解析错误）**
        cleanLabel = cleanLabel
          .replace(/\[/g, '［')  // 方括号左
          .replace(/\]/g, '］')  // 方括号右
          .replace(/\(/g, '（')
          .replace(/\)/g, '）')
          .replace(/\|/g, '｜');
        // 限制标签长度（最多80字符）
        if (cleanLabel.length > 80) {
          cleanLabel = cleanLabel.substring(0, 77) + '...';
        }
        return `${nodeId}[${cleanLabel}]`;
      });

      // 8. 修正常见的语法错误
      // 8.1 修正箭头语法（-- > 改为 -->）
      rawCode = rawCode.replace(/--\s+>/g, '-->');
      rawCode = rawCode.replace(/<\s+--/g, '<--');

      // 8.2 修正节点定义后多余的节点名（A[text]A --> B 改为 A[text] --> B）
      // 必须在 8.3 之前执行，避免误判
      // 匹配：节点ID + [ + 内容(可能包含全角］) + ] + 重复的节点ID
      rawCode = rawCode.replace(/([A-Za-z0-9_]+)\[([^\]]*(?:］[^\]]*)*)\]\1(?=\s|$)/g, '$1[$2]');

      // 8.3 修正节点定义后缺少空格的问题（]D --> 改为 ]\nD -->）
      // 只处理半角右括号后紧跟字母的情况
      rawCode = rawCode.replace(/\]([A-Za-z0-9_]+)(\s+-->)/g, ']\n$1$2');
      rawCode = rawCode.replace(/\]([A-Za-z0-9_]+)(\s*$)/gm, ']\n$1');

      // 8.4 修复缺少箭头的节点连接
      // 修复菱形节点缺少结束花括号的情况（如 J{文本 K[...] 改为 J{文本} --> K[...]）
      rawCode = rawCode.replace(/\{([^}]*?)\s{2,}([A-Z][A-Za-z0-9_]*)\[/g, '{$1} --> $2[');
      // 修复 }  [  或 }[  的情况（菱形节点后缺少箭头）
      rawCode = rawCode.replace(/\}(\s{2,}|\s*)\[/g, '} --> [');
      // 修复 ]  [  的情况（方括号节点后缺少箭头，至少2个空格）
      rawCode = rawCode.replace(/\](\s{2,})\[/g, '] --> [');
      // 修复 )  [  的情况（圆括号节点后缺少箭头）
      rawCode = rawCode.replace(/\)(\s{2,})\[/g, ') --> [');

      // 8.5 移除空的 graph 声明
      rawCode = rawCode.replace(/^\s*graph\s*$/gim, '');

      // 9. 修正 subgraph 语法
      rawCode = rawCode.replace(/^\s*subgraph\s+([^\n]+)$/gm, (match, name) => {
        // 移除 subgraph 名称中的括号内容
        let cleanName = name.replace(/\([^\)]*\)/g, '').trim();
        // 移除逗号和句号
        cleanName = cleanName.replace(/[.,，。]/g, '');
        // 压缩多余空格
        cleanName = cleanName.replace(/\s+/g, ' ');
        return cleanName ? `subgraph ${cleanName}` : 'subgraph';
      });

      // 10. 修正 class 语句语法（移除多余的 class 关键字）
      // 例如：class A,B,C class stage1 → class A,B,C stage1
      rawCode = rawCode.replace(/^\s*class\s+([A-Za-z0-9_,\s]+)\s+class\s+([A-Za-z0-9_]+)\s*$/gm, 'class $1 $2');

      // 11. Trim 最终结果
      rawCode = rawCode.trim();
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

      // 生成绝对唯一的 ID（使用时间戳 + 索引 + 随机数 + 性能计时器）
      const uniqueId = `mermaid-${Date.now()}-${idx}-${Math.floor(Math.random()*100000)}-${Math.floor(performance.now()*1000)}`;
      mermaidDiv.className = 'mermaid';
      mermaidDiv.id = uniqueId;
      mermaidDiv.setAttribute('data-mermaid-index', idx.toString());
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

        // 添加按钮
        addMermaidButtons(mermaidDiv, currentCodeForError);
      } catch (renderError) {
        /**
         * Mermaid 渲染失败处理（增强版）：
         * 1. 自动尝试多级修正（无需 data-mermaid-final 标记）
         * 2. 若修正成功则渲染，否则继续下一个修正
         * 3. 若所有修正都失败，显示详细错误信息
         * 4. 若有上一次成功 SVG，可回退显示
         */
        console.warn('Mermaid 初次渲染失败，尝试自动修正...', renderError);

        // 增强的修正函数集合（从最保守到最激进）
        const mermaidFixers = [
          // 修正0a: 修复缺少箭头的节点连接（如 J{text}  K[text] 改为 J{text} --> K[text]）
          code => {
            // 修复菱形节点缺少结束花括号的情况
            code = code.replace(/\{([^}]*?)\s{2,}([A-Z][A-Za-z0-9_]*)\[/g, '{$1} --> $2[');
            // 修复 }  [  或 }[  的情况（菱形节点后缺少箭头）
            code = code.replace(/\}(\s{2,}|\s*)\[/g, '} --> [');
            // 修复 ]  [  的情况（方括号节点后缺少箭头）
            code = code.replace(/\](\s{2,})\[/g, '] --> [');
            // 修复 )  [  的情况（圆括号节点后缺少箭头）
            code = code.replace(/\)(\s{2,})\[/g, ') --> [');
            return code;
          },
          // 修正0b: 处理节点标签中的括号、方括号和管道符（最常见问题）
          code => {
            return code.replace(/\[([^\]]+)\]/g, (match, labelContent) => {
              let cleanLabel = labelContent
                .replace(/\[/g, '［')  // 方括号左
                .replace(/\]/g, '］')  // 方括号右
                .replace(/\(/g, '（')
                .replace(/\)/g, '）')
                .replace(/\|/g, '｜');
              return `[${cleanLabel}]`;
            });
          },
          // 修正1: 处理多行文本和长度限制
          code => {
            return code.replace(/\[([^\]]+)\]/g, (match, labelContent) => {
              let cleanLabel = labelContent.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
              if (cleanLabel.length > 60) {
                cleanLabel = cleanLabel.substring(0, 57) + '...';
              }
              return `[${cleanLabel}]`;
            });
          },
          // 修正2: 修正常见的引号问题
          code => {
            return code.replace(/["']/g, '');
          },
          // 修正3: 将节点标签中的斜杠替换为全角
          code => {
            return code.replace(/\[([^\]]*)\]/g, match => match.replace(/\//g, '／'));
          },
          // 修正4: 移除节点标签中的冒号和破折号
          code => {
            return code.replace(/\[([^\]]*)\]/g, match => match.replace(/[:\-]/g, ''));
          },
          // 修正5: 将所有特殊符号替换为全角或空格
          code => {
            return code.replace(/\[([^\]]*)\]/g, match => {
              return match
                .replace(/\(/g, '（')
                .replace(/\)/g, '）')
                .replace(/\|/g, '｜')
                .replace(/</g, '＜')
                .replace(/>/g, '＞')
                .replace(/\{/g, '｛')
                .replace(/\}/g, '｝');
            });
          },
          // 修正6: 极端修正 - 只保留节点内的中英文、数字和常见符号
          code => {
            return code.replace(/\[([^\]]*)\]/g, match => {
              return match.replace(/[^\u4e00-\u9fa5a-zA-Z0-9\[\]\s\.]/g, '');
            });
          },
          // 修正7: 最激进 - 简化所有节点名称为纯文本
          code => {
            return code.replace(/\[([^\]]*)\]/g, match => {
              const inner = match.slice(1, -1).trim();
              // 只保留前20个字符
              return '[' + inner.substring(0, 20).replace(/[^\u4e00-\u9fa5a-zA-Z0-9\s]/g, '') + ']';
            });
          }
        ];

        let fixSuccess = false;
        let successfulCode = null;

        for (let i = 0; i < mermaidFixers.length && !fixSuccess; i++) {
          try {
            const fixedCode = mermaidFixers[i](code);
            if (fixedCode === code) continue; // 跳过没有改变的修正

            // 重新设置 mermaid div 内容
            mermaidDiv.textContent = fixedCode;
            await window.mermaid.init(undefined, '#' + uniqueId);

            // 验证 SVG 是否真正生成
            const svgElement = mermaidDiv.querySelector('svg');
            if (!svgElement) {
              console.warn(`修正器 ${i + 1} 执行完成但未生成 SVG`);
              continue; // 未生成 SVG，尝试下一个修正器
            }

            // 修正成功！
            fixSuccess = true;
            successfulCode = fixedCode;
            console.log(`Mermaid 修正成功 (修正器 ${i + 1})`, fixedCode);

            // 清除错误边框
            mermaidDiv.style.border = '';

            // 显示警告提示
            const warningDiv = document.createElement('div');
            warningDiv.className = 'mermaid-auto-fix-warning';
            warningDiv.style.cssText = `
              color: #d97706;
              font-size: 12px;
              background: #fef3c7;
              border: 1px solid #fcd34d;
              border-radius: 6px;
              padding: 8px 12px;
              margin-top: 12px;
              text-align: center;
            `;
            warningDiv.innerHTML = `
              <strong>⚠️ 已自动修正语法</strong><br>
              原始代码存在语法问题，已应用修正器 ${i + 1} 进行渲染
            `;
            mermaidDiv.appendChild(warningDiv);

            // 更新 currentCodeForError 为修正后的代码
            currentCodeForError = fixedCode;

            // 添加按钮
            addMermaidButtons(mermaidDiv, currentCodeForError);

            break;
          } catch (e) {
            // 这个修正器失败了，继续尝试下一个
            console.warn(`修正器 ${i + 1} 失败:`, e);
          }
        }

        // 如果所有修正都失败
        if (!fixSuccess) {
          // XSS 防护：安全地转义错误消息和代码
          const escapedErrorMessage = safeEscapeHtml(renderError.str || renderError.message);
          const escapedCode = safeEscapeHtml(currentCodeForError);

          if (lastSVG) {
            // 回退到上一次成功的 SVG
            mermaidDiv.innerHTML = '';
            mermaidDiv.appendChild(lastSVG);
            mermaidDiv.style.border = '2px dashed #f59e0b';
            let warn = mermaidDiv.querySelector('.mermaid-render-warning');
            if (!warn) {
              warn = document.createElement('div');
              warn.className = 'mermaid-render-warning';
              warn.style.cssText = 'color:#d97706;font-size:12px;margin-top:4px;text-align:center;';
              mermaidDiv.appendChild(warn);
            }
            warn.textContent = '⚠️ 当前代码解析失败，显示上一版本。错误: ' + escapedErrorMessage;
          } else {
            // 显示详细错误信息
            mermaidDiv.innerHTML = `
              <div style="color:#e53e3e;font-weight:bold;margin-bottom:8px;">
                ❌ Mermaid 渲染失败
              </div>
              <div style="color:#64748b;font-size:13px;margin-bottom:8px;">
                错误信息: ${escapedErrorMessage}
              </div>
              <details style="margin-top:8px;">
                <summary style="cursor:pointer;color:#6366f1;font-size:13px;font-weight:500;">
                  查看原始代码
                </summary>
                <pre style="color:#64748b;font-size:12px;background:#f3f4f6;border-radius:6px;padding:8px 12px;overflow-x:auto;margin-top:8px;white-space:pre-wrap;word-break:break-all;">${escapedCode}</pre>
              </details>
              <div style="margin-top:12px;font-size:12px;color:#64748b;">
                💡 提示: 可尝试在 <a href="https://mermaid.live" target="_blank" rel="noopener noreferrer" style="color:#6366f1;text-decoration:underline;">Mermaid.live</a> 中调试代码
              </div>
            `;
            mermaidDiv.style.border = '2px solid #e53e3e';
          }
        }
      }
    } catch (generalBlockError) {
      // 兜底：处理 block 解析或 DOM 操作异常
      // XSS 防护：安全地转义错误消息
      const escapedGeneralErrorMessage = safeEscapeHtml(generalBlockError.message);
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
  } // 结束 for...of 循环
}

// 挂载到全局命名空间
export const ChatbotMermaidRenderer = {
  renderAllMermaidBlocksInternal
};

// 向后兼容：暴露到 window
if (typeof window !== 'undefined') {
  if (typeof window.ChatbotRenderingUtils === 'undefined') {
    window.ChatbotRenderingUtils = {};
  }
  window.ChatbotRenderingUtils.renderAllMermaidBlocks = renderAllMermaidBlocksInternal;
}
