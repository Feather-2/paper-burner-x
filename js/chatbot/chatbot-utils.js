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
    script.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
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
  const docTitle = document.createElement('div');
  docTitle.style.marginBottom = '12px';
  docTitle.style.fontWeight = 'bold';
  docTitle.style.fontSize = '14px';
  docTitle.textContent = `问题: ${questionText}`;
  const watermark = document.createElement('div');
  watermark.style.position = 'absolute';
  watermark.style.bottom = '10px';
  watermark.style.right = '15px';
  watermark.style.fontSize = '8px';
  watermark.style.opacity = '0.4';
  watermark.textContent = 'Created with Paper Burner';
  const contentContainer = document.createElement('div');
  contentContainer.innerHTML = messageElement.innerHTML;
  exportContainer.appendChild(docTitle);
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
    for (let i = window.ChatbotCore.chatHistory.length - 2; i >= 0; i--) {
      if (window.ChatbotCore.chatHistory[i].role === 'user') {
        questionText = window.ChatbotCore.chatHistory[i].content;
        if (questionText.length > 60) {
          questionText = questionText.substring(0, 57) + '...';
        }
        break;
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
  const docTitle = document.createElement('div');
  docTitle.style.marginBottom = '12px';
  docTitle.style.fontWeight = 'bold';
  docTitle.style.fontSize = '14px';
  docTitle.textContent = `问题: ${questionText}`;
  const watermark = document.createElement('div');
  watermark.style.position = 'absolute';
  watermark.style.bottom = '10px';
  watermark.style.right = '15px';
  watermark.style.fontSize = '8px';
  watermark.style.opacity = '0.4';
  watermark.textContent = 'Created with Paper Burner';
  const contentContainer = document.createElement('div');
  contentContainer.textContent = content;
  exportContainer.appendChild(docTitle);
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

window.ChatbotUtils = {
  escapeHtml,
  showToast,
  copyAssistantMessage,
  exportMessageAsPng,
  doExportAsPng,
  exportContentDirectly
};