// chatbot-utils.js

// 转义 HTML
function escapeHtml(str) {
  return str.replace(/[&<>"']/g, function (c) {
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c];
  });
}

// 显示操作反馈toast
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

// 复制助手消息到剪贴板
function copyAssistantMessage(messageIndex) {
  if (!window.ChatbotCore || !window.ChatbotCore.chatHistory[messageIndex]) return;
  const text = window.ChatbotCore.chatHistory[messageIndex].content;
  navigator.clipboard.writeText(text).then(() => {
    showToast('已复制到剪贴板');
  }).catch(err => {
    showToast('复制失败，请手动选择文本复制');
  });
}

// 导出消息为PNG图片
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

// 执行PNG导出
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