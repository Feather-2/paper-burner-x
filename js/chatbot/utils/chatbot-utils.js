// chatbot-utils.js

/**
 * 转义 HTML 特殊字符，防止 XSS 攻击。
 * 将 &, <, >, ", ' 替换为相应的 HTML 实体。
 * @param {string} str 需要转义的原始字符串。
 * @returns {string} 转义后的安全字符串。
 */
function escapeHtml(str) {
  return str.replace(/[&<>"']/g, function (c) {
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c];
  });
}

/**
 * 显示一个短暂的浮动提示消息 (Toast)。
 * Toast 用于向用户反馈操作结果，如"已复制到剪贴板"。
 * 如果页面上不存在 ID 为 `chatbot-toast` 的元素，则会创建一个。
 * Toast 会在显示约2秒后自动淡出消失。
 *
 * @param {string} message 要在 Toast 中显示的消息文本。
 */
function showToast(message) {
  let toast = document.getElementById('chatbot-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'chatbot-toast';
    toast.style.position = 'fixed';
    toast.style.bottom = '100px';
    toast.style.left = '50%';
    toast.style.transform = 'translateX(-50%)';
    toast.style.padding = '8px 16px';
    toast.style.background = 'rgba(0,0,0,0.7)';
    toast.style.color = 'white';
    toast.style.borderRadius = '4px';
    toast.style.fontSize = '14px';
    toast.style.zIndex = '100001';
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.style.opacity = '1';
  setTimeout(() => {
    toast.style.opacity = '0';
  }, 2000);
}

/**
 * 复制指定索引的助手消息内容到用户剪贴板。
 * 使用 `navigator.clipboard.writeText` API。
 * 成功或失败时会调用 `showToast` 显示反馈。
 *
 * @param {number} messageIndex `ChatbotCore.chatHistory` 数组中目标助手消息的索引。
 */
function copyAssistantMessage(messageIndex) {
  if (!window.ChatbotCore || !window.ChatbotCore.chatHistory[messageIndex]) return;
  const text = window.ChatbotCore.chatHistory[messageIndex].content;
  navigator.clipboard.writeText(text).then(() => {
    showToast('已复制到剪贴板');
  }).catch(err => {
    showToast('复制失败，请手动选择文本复制');
  });
}

/**
 * 将指定索引的助手消息内容导出为 PNG 图片。
 * 依赖 `html2canvas` 库。如果该库未加载，则会尝试动态加载它。
 * 实际的导出操作由 `doExportAsPng` 函数执行。
 *
 * @param {number} messageIndex `ChatbotCore.chatHistory` 数组中目标助手消息的索引。
 */
function exportMessageAsPng(messageIndex) {
  if (!window.ChatbotCore || !window.ChatbotCore.chatHistory[messageIndex]) return;
  if (typeof html2canvas === 'undefined') {
    showToast('正在加载图片导出组件...');
    const script = document.createElement('script');
    script.src = 'https://gcore.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
    script.onload = function() {
      showToast('组件加载完成，正在生成图片...');
      doExportAsPng(messageIndex);
    };
    script.onerror = function() {
      showToast('导出组件加载失败，请检查网络连接');
    };
    document.head.appendChild(script);
    return;
  }
  doExportAsPng(messageIndex);
}

/**
 * 执行将指定消息元素导出为 PNG 图片的核心逻辑。
 * 此函数在 `html2canvas` 加载完成后被 `exportMessageAsPng` 调用，或者直接被调用（如果库已加载）。
 * 它会查找对应的消息 DOM 元素，如果找不到，则会尝试使用 `exportContentDirectly` 作为后备方案。
 *
 * @param {number} messageIndex 目标助手消息在 `ChatbotCore.chatHistory` 中的索引。
 */
function doExportAsPng(messageIndex) {
  const messageElements = document.querySelectorAll('.assistant-message');
  const targetElement = document.querySelector(`.assistant-message[data-message-index="${messageIndex}"]`);
  if ((!messageElements || messageElements.length <= messageIndex) && !targetElement) {
    exportContentDirectly(window.ChatbotCore.chatHistory[messageIndex].content);
    return;
  }
  const element = targetElement || messageElements[messageIndex];
  processExport(element);
}

/**
 * 处理将消息 DOM 元素转换为 PNG 图片并下载的详细过程。
 * 1. 获取与消息相关的用户问题文本作为图片的一部分。
 * 2. 创建一个临时的、屏幕外渲染的 `div` (`exportContainer`) 用于容纳要导出的内容。
 * 3. 设置 `exportContainer` 的样式，使其在视觉上接近聊天气泡，并包含问题文本、消息内容和水印。
 * 4. 使用 `html2canvas` 将 `exportContainer` 渲染到 `<canvas>` 元素。
 * 5. 将 `<canvas>` 内容转换为 PNG 数据 URL。
 * 6. 创建一个临时的 `<a>` 标签，设置其 `href` 为数据 URL，`download` 属性为文件名，然后模拟点击以下载图片。
 * 7. 清理：移除临时的 `exportContainer`。
 * 8. 显示操作反馈 Toast。
 *
 * @param {HTMLElement} messageElement 要导出为图片的助手消息的 DOM 元素。
 */
function processExport(messageElement) {
  let questionText = "未知问题";
  try {
    const index = parseInt(messageElement.getAttribute('data-message-index'));
    if (!isNaN(index) && index > 0 && window.ChatbotCore.chatHistory[index-1] && window.ChatbotCore.chatHistory[index-1].role === 'user') {
      questionText = window.ChatbotCore.chatHistory[index-1].content;
      if (questionText.length > 60) {
        questionText = questionText.substring(0, 57) + '...';
      }
    }
  } catch (e) {}
  const exportContainer = document.createElement('div');
  exportContainer.style.position = 'absolute';
  exportContainer.style.left = '-9999px';
  exportContainer.style.padding = '20px';
  exportContainer.style.background = 'white';
  exportContainer.style.borderRadius = '8px';
  exportContainer.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
  exportContainer.style.maxWidth = '720px';
  exportContainer.style.width = '80vw';
  exportContainer.style.color = '#111827';
  exportContainer.style.fontSize = '15px';
  exportContainer.style.lineHeight = '1.5';
  const watermark = document.createElement('div');
  watermark.style.position = 'absolute';
  watermark.style.bottom = '10px';
  watermark.style.right = '15px';
  watermark.style.fontSize = '8px';
  watermark.style.opacity = '0.4';
  watermark.textContent = 'Created with Paper Burner';
  const contentContainer = document.createElement('div');
  contentContainer.innerHTML = messageElement.innerHTML;
  exportContainer.appendChild(contentContainer);
  exportContainer.appendChild(watermark);
  document.body.appendChild(exportContainer);

  // Phase 3.5: 导出前临时展开所有表格，确保完整显示
  // 保存原始样式，以便后续恢复
  const tables = exportContainer.querySelectorAll('.markdown-content table');
  const originalTableStyles = [];
  tables.forEach((table, index) => {
    originalTableStyles[index] = {
      overflow: table.style.overflow || '',
      maxWidth: table.style.maxWidth || '',
      display: table.style.display || ''
    };
    // 临时移除滚动，展开完整内容
    table.style.overflow = 'visible';
    table.style.maxWidth = 'none';
    table.style.display = 'table'; // 恢复为标准表格布局
  });

  // 同时移除表格容器的宽度限制
  const messageContainer = exportContainer.querySelector('.assistant-message');
  let originalContainerMaxWidth = '';
  if (messageContainer) {
    originalContainerMaxWidth = messageContainer.style.maxWidth || '';
    messageContainer.style.maxWidth = 'none';
  }

  showToast('正在生成图片...');
  html2canvas(exportContainer, {
    scale: 2,
    useCORS: true,
    backgroundColor: 'white',
    logging: false,
    width: exportContainer.scrollWidth, // 使用完整宽度
    height: exportContainer.scrollHeight // 使用完整高度
  }).then(canvas => {
    try {
      const link = document.createElement('a');
      link.download = `paper-burner-ai-${new Date().toISOString().slice(0,10)}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
      showToast('图片已导出');
    } catch (err) {
      showToast('导出图片失败');
    } finally {
      // Phase 3.5: 清理前恢复表格样式（虽然容器会被删除，但保持代码完整性）
      tables.forEach((table, index) => {
        if (originalTableStyles[index]) {
          table.style.overflow = originalTableStyles[index].overflow;
          table.style.maxWidth = originalTableStyles[index].maxWidth;
          table.style.display = originalTableStyles[index].display;
        }
      });
      if (messageContainer && originalContainerMaxWidth) {
        messageContainer.style.maxWidth = originalContainerMaxWidth;
      }
      document.body.removeChild(exportContainer);
    }
  }).catch(err => {
    showToast('生成图片失败');
    // Phase 3.5: 错误时也要清理
    tables.forEach((table, index) => {
      if (originalTableStyles[index]) {
        table.style.overflow = originalTableStyles[index].overflow;
        table.style.maxWidth = originalTableStyles[index].maxWidth;
        table.style.display = originalTableStyles[index].display;
      }
    });
    if (messageContainer && originalContainerMaxWidth) {
      messageContainer.style.maxWidth = originalContainerMaxWidth;
    }
    document.body.removeChild(exportContainer);
  });
}

/**
 * 当无法直接定位到消息的 DOM 元素时，提供一个后备方案来导出纯文本内容为图片。
 * 这通常发生在 `doExportAsPng` 找不到对应的 `.assistant-message` 元素时。
 * 它会创建一个包含纯文本内容的容器，并尝试将其导出为图片，流程与 `processExport` 类似，
 * 但内容源是直接的字符串而不是 DOM 元素的 innerHTML。
 *
 * @param {string} content 要导出为图片的纯文本内容。
 */
function exportContentDirectly(content) {
  let questionText = "未知问题";
  try {
    // Try to find the last user question in history to associate with this content
    const history = window.ChatbotCore && window.ChatbotCore.chatHistory ? window.ChatbotCore.chatHistory : [];
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].role === 'user' && history[i+1] && history[i+1].content === content) {
        questionText = history[i].content;
        if (questionText.length > 60) {
          questionText = questionText.substring(0, 57) + '...';
        }
        break;
      } else if (history[i].role === 'user' && i === history.length -2) { // Fallback if current content is the last one
        questionText = history[i].content;
         if (questionText.length > 60) {
          questionText = questionText.substring(0, 57) + '...';
        }
        break;
      }
    }
  } catch (e) {
    console.error("Error finding question for direct export:", e);
  }
  const exportContainer = document.createElement('div');
  exportContainer.style.position = 'absolute';
  exportContainer.style.left = '-9999px';
  exportContainer.style.padding = '20px';
  exportContainer.style.background = 'white';
  exportContainer.style.borderRadius = '8px';
  exportContainer.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
  exportContainer.style.maxWidth = '720px';
  exportContainer.style.width = '80vw';
  exportContainer.style.color = '#111827';
  exportContainer.style.fontSize = '15px';
  exportContainer.style.lineHeight = '1.5';
  const watermark = document.createElement('div');
  watermark.style.position = 'absolute';
  watermark.style.bottom = '10px';
  watermark.style.right = '15px';
  watermark.style.fontSize = '8px';
  watermark.style.opacity = '0.4';
  watermark.textContent = 'Created with Paper Burner';
  const contentContainer = document.createElement('div');
  // For direct content, we should escape it before setting textContent if it might contain HTML
  // However, if the 'content' is already supposed to be plain text, textContent is fine.
  // If 'content' is markdown that was rendered to HTML, we'd need a different approach
  // Assuming 'content' here is mostly plain text or pre-formatted for display.
  contentContainer.style.whiteSpace = 'pre-wrap'; // Preserve line breaks
  contentContainer.style.wordBreak = 'break-word';
  contentContainer.textContent = content;
  exportContainer.appendChild(contentContainer);
  exportContainer.appendChild(watermark);
  document.body.appendChild(exportContainer);
  showToast('正在生成图片...');
  html2canvas(exportContainer, {
    scale: 2,
    useCORS: true,
    backgroundColor: 'white',
    logging: false
  }).then(canvas => {
    try {
      const link = document.createElement('a');
      link.download = `paper-burner-ai-${new Date().toISOString().slice(0,10)}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
      showToast('图片已导出');
    } catch (err) {
      showToast('导出图片失败');
    } finally {
      document.body.removeChild(exportContainer);
    }
  }).catch(err => {
    showToast('生成图片失败');
    document.body.removeChild(exportContainer);
  });
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
    // Use escapeHtml from the same utils file
    html += `<span style=\"color:#2563eb;font-weight:${level===0?'bold':'normal'};font-size:${level===0?'1.08em':'1em'};\">${escapeHtml(node.text)}</span>`;
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

/**
 * 显示带进度条的Toast提示
 * @param {string} message 初始消息
 * @param {number} percent 初始进度 (0-100)
 * @returns {object} 包含update和close方法的对象
 */
function showProgressToast(message, percent = 0) {
  let toast = document.getElementById('chatbot-progress-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'chatbot-progress-toast';
    toast.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      min-width: 300px;
      background: white;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      padding: 16px;
      z-index: 100002;
      font-family: system-ui, -apple-system, sans-serif;
    `;

    const messageEl = document.createElement('div');
    messageEl.id = 'progress-toast-message';
    messageEl.style.cssText = 'font-size: 14px; color: #374151; margin-bottom: 8px;';

    const progressBg = document.createElement('div');
    progressBg.style.cssText = 'width: 100%; height: 8px; background: #e5e7eb; border-radius: 4px; overflow: hidden;';

    const progressBar = document.createElement('div');
    progressBar.id = 'progress-toast-bar';
    progressBar.style.cssText = 'height: 100%; background: linear-gradient(90deg, #3b82f6, #2563eb); transition: width 0.3s ease; width: 0%;';

    const percentEl = document.createElement('div');
    percentEl.id = 'progress-toast-percent';
    percentEl.style.cssText = 'font-size: 12px; color: #6b7280; margin-top: 4px; text-align: right;';

    progressBg.appendChild(progressBar);
    toast.appendChild(messageEl);
    toast.appendChild(progressBg);
    toast.appendChild(percentEl);
    document.body.appendChild(toast);
  }

  const messageEl = document.getElementById('progress-toast-message');
  const progressBar = document.getElementById('progress-toast-bar');
  const percentEl = document.getElementById('progress-toast-percent');

  messageEl.textContent = message;
  progressBar.style.width = percent + '%';
  percentEl.textContent = percent + '%';

  return {
    update: function(newMessage, newPercent) {
      if (messageEl) messageEl.textContent = newMessage;
      if (progressBar) progressBar.style.width = newPercent + '%';
      if (percentEl) percentEl.textContent = newPercent + '%';
    },
    close: function() {
      if (toast && toast.parentNode) {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s';
        setTimeout(() => {
          if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 300);
      }
    }
  };
}

window.ChatbotUtils = {
  escapeHtml,
  showToast,
  showProgressToast,
  copyAssistantMessage,
  exportMessageAsPng,
  doExportAsPng,
  exportContentDirectly,
  renderMindmapShadow,
  compressImage
};