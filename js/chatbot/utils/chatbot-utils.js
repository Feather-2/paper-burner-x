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
  // Phase 3.5: 添加导出状态锁，防止快速点击导致内存泄漏
  if (window.ChatbotRenderState && window.ChatbotRenderState.isExporting) {
    if (typeof showToast === 'function') {
      showToast('正在导出，请稍候...');
    }
    if (window.PerfLogger) {
      window.PerfLogger.warn('导出已在进行中，忽略重复请求');
    }
    return;
  }

  // 设置导出锁
  if (window.ChatbotRenderState) {
    window.ChatbotRenderState.isExporting = true;
  }

  try {
    const messageElements = document.querySelectorAll('.assistant-message');
    const targetElement = document.querySelector(`.assistant-message[data-message-index="${messageIndex}"]`);
    if ((!messageElements || messageElements.length <= messageIndex) && !targetElement) {
      exportContentDirectly(window.ChatbotCore.chatHistory[messageIndex].content);
      return;
    }
    const element = targetElement || messageElements[messageIndex];
    processExport(element);
  } catch (error) {
    if (window.PerfLogger) {
      window.PerfLogger.error('导出失败:', error);
    }
    // 确保即使出错也释放锁
    if (window.ChatbotRenderState) {
      window.ChatbotRenderState.isExporting = false;
    }
    if (typeof showToast === 'function') {
      showToast('导出失败，请重试');
    }
  }
}

/**
 * 为导出优化：内联 KaTeX 关键样式
 * 基于你的 hot-fix v3，只内联最关键的属性
 */
function inlineKatexStyles(container) {
  // 首先处理顶层 KaTeX 容器
  const katexContainers = container.querySelectorAll('.katex');
  katexContainers.forEach(el => {
    const computed = window.getComputedStyle(el);

    // 判断是行内还是行间公式（检查父容器）
    const parent = el.parentElement;
    const isInline = parent && (
      parent.classList.contains('katex-inline') ||
      parent.getAttribute('data-formula-display') === 'inline' ||
      parent.tagName === 'SPAN'
    );

    const containerProps = [
      'position', 'vertical-align',
      'font-size', 'line-height', 'font-family',
      'margin', 'padding',
      'text-align'
    ];

    const inlineStyles = [];

    // 根据类型手动设置 display
    if (isInline) {
      inlineStyles.push('display: inline');
    } else {
      inlineStyles.push('display: block');
    }

    containerProps.forEach(prop => {
      const value = computed.getPropertyValue(prop);
      if (value && value !== 'auto' && value !== 'normal' && value !== 'none' && value !== '0px') {
        inlineStyles.push(`${prop}: ${value}`);
      }
    });

    if (inlineStyles.length > 0) {
      const existing = el.getAttribute('style') || '';
      el.setAttribute('style', existing + '; ' + inlineStyles.join('; '));
    }
  });

  // 然后处理所有子元素
  const katexElements = container.querySelectorAll('.katex *');
  katexElements.forEach(el => {
    const computed = window.getComputedStyle(el);
    const critical = [
      'display', 'position', 'vertical-align',
      'font-size', 'line-height', 'font-family', 'font-weight', 'font-style',
      'margin-top', 'margin-bottom', 'margin-left', 'margin-right',
      'padding-top', 'padding-bottom', 'padding-left', 'padding-right',
      'width', 'height',
      'top', 'bottom', 'left', 'right',
      'transform', 'color', 'border-bottom'
    ];

    const inlineStyles = [];
    critical.forEach(prop => {
      const value = computed.getPropertyValue(prop);
      if (value && value !== 'auto' && value !== 'normal' && value !== 'none' && value !== '0px' && value !== 'rgba(0, 0, 0, 0)') {
        inlineStyles.push(`${prop}: ${value}`);
      }
    });

    if (inlineStyles.length > 0) {
      const existing = el.getAttribute('style') || '';
      el.setAttribute('style', existing + '; ' + inlineStyles.join('; '));
    }
  });
}

/**
 * 智能内联关键样式（仅用于特定元素）
 * 与旧版不同，这个版本不会盲目复制所有样式
 * @param {HTMLElement} element 需要内联样式的元素
 * @param {string[]} props 需要内联的属性列表
 */
function inlineSpecificStyles(element, props) {
  const computed = window.getComputedStyle(element);
  const existingStyle = element.getAttribute('style') || '';
  const inlineStyle = [];

  props.forEach(prop => {
    const value = computed.getPropertyValue(prop);
    if (value && value !== 'none' && value !== 'normal' && value !== 'auto' && value !== 'initial') {
      // 避免覆盖已有的内联样式
      if (!existingStyle.includes(prop + ':')) {
        inlineStyle.push(`${prop}: ${value}`);
      }
    }
  });

  if (inlineStyle.length > 0) {
    element.setAttribute('style', existingStyle + '; ' + inlineStyle.join('; '));
  }
}

/**
 * Phase 10.9: 内联部分 Markdown 元素的关键样式（简化版）
 * 只处理不会影响垂直对齐的元素，避免破坏列表等元素的布局
 * @param {HTMLElement} container 导出容器
 */
function inlineMarkdownStyles(container) {
  // 只内联不会影响垂直对齐的元素
  // 不处理 ul、ol、li，避免破坏列表的原生布局
  const markdownElements = [
    {
      selector: 'code',
      props: ['background-color', 'padding', 'border-radius', 'font-family', 'font-size', 'color']
    },
    {
      selector: 'pre',
      props: ['background-color', 'padding', 'border-radius', 'overflow-x', 'margin-top', 'margin-bottom']
    },
    {
      selector: 'blockquote',
      props: ['margin-left', 'margin-right', 'padding-left', 'border-left', 'color', 'font-style']
    }
  ];

  markdownElements.forEach(({ selector, props }) => {
    const elements = container.querySelectorAll(selector);
    elements.forEach(el => {
      const computed = window.getComputedStyle(el);
      const existingStyle = el.getAttribute('style') || '';
      const inlineStyles = [];

      props.forEach(prop => {
        const value = computed.getPropertyValue(prop);
        if (value && value !== 'none' && value !== 'normal' && value !== 'auto' && value !== 'initial' && value !== '0px') {
          // 避免覆盖已有的内联样式
          if (!existingStyle.includes(prop + ':')) {
            inlineStyles.push(`${prop}: ${value}`);
          }
        }
      });

      if (inlineStyles.length > 0) {
        el.setAttribute('style', existingStyle + '; ' + inlineStyles.join('; '));
      }
    });
  });
}

/**
 * 处理将消息 DOM 元素转换为 PNG 图片并下载的详细过程。
 *
 * Phase 10: 修复 CSS 重构后的导出问题
 * - 在导出容器中加载完整的 KaTeX CSS
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

  // Phase 10.5: 检查是否有未渲染的公式占位符
  const placeholders = messageElement.querySelectorAll('.katex-placeholder, .katex-block-placeholder, .katex-inline-placeholder');
  if (placeholders.length > 0) {
    showToast(`检测到 ${placeholders.length} 个公式正在渲染，请稍候...`);
    console.log(`[Export] 检测到 ${placeholders.length} 个占位符，等待渲染完成...`);

    // 等待渐进式渲染完成
    const checkInterval = setInterval(() => {
      const remaining = messageElement.querySelectorAll('.katex-placeholder, .katex-block-placeholder, .katex-inline-placeholder');
      if (remaining.length === 0) {
        clearInterval(checkInterval);
        console.log('[Export] 公式渲染完成，开始导出');
        showToast('开始导出...');
        // 短暂延迟确保 DOM 稳定
        setTimeout(() => doActualExport(messageElement), 100);
      }
    }, 200);

    // 超时保护：最多等待 10 秒
    setTimeout(() => {
      clearInterval(checkInterval);
      const remaining = messageElement.querySelectorAll('.katex-placeholder, .katex-block-placeholder, .katex-inline-placeholder');
      if (remaining.length > 0) {
        console.warn(`[Export] 等待超时，仍有 ${remaining.length} 个公式未渲染，强制导出`);
      }
      doActualExport(messageElement);
    }, 10000);

    return;
  }

  // 没有占位符，直接导出
  doActualExport(messageElement);
}

/**
 * 实际执行导出的函数
 */
function doActualExport(messageElement) {

  const exportContainer = document.createElement('div');
  exportContainer.style.position = 'absolute';
  exportContainer.style.left = '-9999px';
  exportContainer.style.padding = '20px';
  exportContainer.style.background = 'white';
  exportContainer.style.borderRadius = '8px';
  exportContainer.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
  exportContainer.style.maxWidth = '800px';
  exportContainer.style.width = '800px';
  exportContainer.style.boxSizing = 'border-box';
  exportContainer.style.color = '#111827';
  exportContainer.style.fontSize = '15px';
  exportContainer.style.lineHeight = '1.5';
  exportContainer.style.overflow = 'visible';
  exportContainer.style.height = 'auto';

  const watermark = document.createElement('div');
  watermark.style.position = 'absolute';
  watermark.style.bottom = '10px';
  watermark.style.right = '15px';
  watermark.style.fontSize = '8px';
  watermark.style.opacity = '0.4';
  watermark.textContent = 'Created with Paper Burner';

  // Phase 10.5: 使用 cloneNode 而不是 innerHTML，完整保留 KaTeX 结构
  const contentContainer = messageElement.cloneNode(true);

  // 移除克隆元素的 data-message-index 避免 ID 冲突
  contentContainer.removeAttribute('data-message-index');
  contentContainer.style.maxWidth = 'none';

  exportContainer.appendChild(contentContainer);
  exportContainer.appendChild(watermark);
  document.body.appendChild(exportContainer);

  // Phase 10: 内联 KaTeX 样式（hot-fix v3 优化版）
  inlineKatexStyles(exportContainer);

  // Phase 10.9: 内联所有 Markdown 元素的关键样式
  inlineMarkdownStyles(exportContainer);

  // Phase 10.10: 修复列表样式（从原始元素复制计算样式）
  const originalLists = messageElement.querySelectorAll('ul, ol');
  const exportLists = exportContainer.querySelectorAll('ul, ol');
  exportLists.forEach((list, index) => {
    if (originalLists[index]) {
      const computed = window.getComputedStyle(originalLists[index]);
      list.style.paddingLeft = computed.paddingLeft;
      list.style.marginBottom = computed.marginBottom;
      list.style.listStyleType = computed.listStyleType;
      list.style.listStylePosition = computed.listStylePosition || 'outside';
    }
  });

  const originalItems = messageElement.querySelectorAll('li');
  const exportItems = exportContainer.querySelectorAll('li');
  exportItems.forEach((li, index) => {
    if (originalItems[index]) {
      const computed = window.getComputedStyle(originalItems[index]);
      li.style.display = 'list-item';
      li.style.lineHeight = computed.lineHeight;
      li.style.marginBottom = computed.marginBottom;
    }
  });

  // Phase 10.7: 强制修正父容器的 display 属性
  const inlineContainers = exportContainer.querySelectorAll('.katex-inline, [data-formula-display="inline"]');
  inlineContainers.forEach(container => {
    container.style.display = 'inline';
    container.style.verticalAlign = 'baseline';
    container.style.margin = '0 2px';
  });

  const blockContainers = exportContainer.querySelectorAll('.katex-block, [data-formula-display="block"]');
  blockContainers.forEach(container => {
    container.style.display = 'block';
    container.style.margin = '16px auto';
    container.style.textAlign = 'center';
  });

  // Phase 10.6: 强制移除所有 KaTeX 的高度和溢出限制
  const katexBlocks = exportContainer.querySelectorAll('.katex-display, .katex-display-fixed, .katex-block');
  katexBlocks.forEach(block => {
    block.style.overflow = 'visible';
    block.style.overflowY = 'visible';
    block.style.maxHeight = 'none';
    block.style.height = 'auto';
  });

  // 移除所有 KaTeX 元素的高度限制
  const allKatexElements = exportContainer.querySelectorAll('.katex, .katex *');
  allKatexElements.forEach(el => {
    if (el.style.overflow === 'hidden') el.style.overflow = 'visible';
    if (el.style.overflowY === 'hidden') el.style.overflowY = 'visible';
    if (el.style.maxHeight && el.style.maxHeight !== 'none') el.style.maxHeight = 'none';
  });

  // Phase 3.5: 导出前临时展开所有表格，确保完整显示
  const tables = exportContainer.querySelectorAll('.markdown-content table');
  const originalTableStyles = [];
  tables.forEach((table, index) => {
    originalTableStyles[index] = {
      overflow: table.style.overflow || '',
      maxWidth: table.style.maxWidth || '',
      display: table.style.display || ''
    };
    table.style.overflow = 'visible';
    table.style.maxWidth = 'none';
    table.style.display = 'table';
  });

  // 同时移除表格容器的宽度限制
  const messageContainer = exportContainer.querySelector('.assistant-message');
  let originalContainerMaxWidth = '';
  if (messageContainer) {
    originalContainerMaxWidth = messageContainer.style.maxWidth || '';
    messageContainer.style.maxWidth = 'none';
  }

  // Phase 3.5: 动态计算导出容器的最大宽度
  const originalExportContainerMaxWidth = exportContainer.style.maxWidth;
  const originalExportContainerWidth = exportContainer.style.width;

  // 计算所有表格的最大宽度
  let maxTableWidth = 0;
  tables.forEach(table => {
    const tableWidth = table.scrollWidth || 0;
    if (maxTableWidth < tableWidth) {
      maxTableWidth = tableWidth;
    }
  });

  // 根据实际内容动态设置宽度
  const config = window.PerformanceConfig?.EXPORT || { MAX_WIDTH: 800, ABSOLUTE_MAX_WIDTH: 1000 };
  const calculatedWidth = maxTableWidth > 0 && maxTableWidth > 800
    ? Math.min(maxTableWidth + 40, config.ABSOLUTE_MAX_WIDTH)
    : 800;

  exportContainer.style.maxWidth = `${calculatedWidth}px`;
  exportContainer.style.width = `${calculatedWidth}px`;

  // Phase 10: KaTeX 已完全渲染，短暂延迟让 DOM 布局稳定
  const hasKatex = exportContainer.querySelectorAll('.katex').length > 0;
  const layoutDelay = hasKatex ? 300 : 50;

  // 等待DOM重新布局
  setTimeout(() => {
    showToast('正在生成图片...');

    // 强制重排
    exportContainer.offsetHeight;

    const scale = window.PerformanceConfig?.EXPORT?.SCALE || 2;
    html2canvas(exportContainer, {
      scale: scale,
      useCORS: true,
      backgroundColor: 'white',
      logging: false,
      allowTaint: false,
      foreignObjectRendering: false
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
        // 清理前恢复所有样式
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
        exportContainer.style.maxWidth = originalExportContainerMaxWidth;
        exportContainer.style.width = originalExportContainerWidth;
        document.body.removeChild(exportContainer);

        // 释放导出锁
        if (window.ChatbotRenderState) {
          window.ChatbotRenderState.isExporting = false;
        }
      }
    }).catch(err => {
      if (window.PerfLogger) {
        window.PerfLogger.error('生成图片失败:', err);
      }
      showToast('生成图片失败');
      // 错误时也要清理所有样式
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
      exportContainer.style.maxWidth = originalExportContainerMaxWidth;
      exportContainer.style.width = originalExportContainerWidth;
      document.body.removeChild(exportContainer);

      // 释放导出锁
      if (window.ChatbotRenderState) {
        window.ChatbotRenderState.isExporting = false;
      }
    });
  }, layoutDelay);
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