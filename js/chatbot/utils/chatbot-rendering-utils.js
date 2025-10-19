// js/chatbot/chatbot-rendering-utils.js

/**
 * ChatbotRenderingUtils 聊天渲染相关工具函数集合
 *
 * 主要功能：
 * 1. 渲染思维导图的模糊/静态预览（Markdown转HTML或纯文本）。
 * 2. 渲染父元素下所有 Mermaid 代码块为 SVG。
 * 3. 提供与安全相关的HTML转义辅助（如有需要）。
 */
window.ChatbotRenderingUtils = {
  /**
   * 渲染思维导图的模糊预览（通常是Markdown的简化版或特定结构）。
   *
   * 主要逻辑：
   * 1. 优先使用 marked.js 将 Markdown 转为 HTML。
   * 2. 若 marked 不可用，则转为纯文本并做 HTML 转义。
   * 3. 返回带有样式的 HTML 字符串。
   *
   * @param {string} markdownData - 思维导图的Markdown数据。
   * @returns {string} HTML字符串，表示思维导图的预览。
   */
  renderMindmapShadow: function(markdownData) {
    if (typeof marked !== 'undefined') {
      try {
        // 使用 marked 解析 Markdown 为 HTML
        let html = marked.parse(markdownData || '# 思维导图预览\n- 暂无内容');
        // 可选：移除潜在危险标签，如 <script>（视 marked 配置而定）
        // html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
        return `<div class="mindmap-shadow-content" style="font-size: 0.8em; opacity: 0.7;">${html}</div>`;
      } catch (e) {
        console.error("Error rendering mindmap shadow with marked.js:", e);
        return '<div class="mindmap-shadow-content" style="font-size: 0.8em; opacity: 0.7;">思维导图预览加载失败</div>';
      }
    } else {
      console.warn("marked.js is not available for mindmap shadow rendering.");
      // 退化为纯文本预览
      const plainTextPreview = (markdownData || '')
        .split('\n')
        .map(line => window.ChatbotUtils.escapeHtml(line))
        .join('<br>');
      return `<div class="mindmap-shadow-content" style="font-size: 0.8em; opacity: 0.7; white-space: pre-wrap;">${plainTextPreview || '思维导图预览 (marked.js 未加载)'}</div>`;
    }
  },

  /**
   * 渲染指定父元素内所有 Mermaid 代码块。
   *
   * 主要逻辑：
   * 1. 查找 parentElement 下所有 Mermaid 代码块（pre code.language-mermaid, code.language-mermaid）。
   * 2. 对每个代码块：
   *    - 跳过已渲染的块，避免重复渲染。
   *    - 创建 mermaid 容器 div，调用 mermaid.render 渲染 SVG。
   *    - 渲染成功则插入 SVG，失败则显示错误信息。
   *    - 隐藏原始 pre/code 块，SVG插入其后。
   * 3. 全局异常时恢复原始 pre 块。
   *
   * @param {HTMLElement} parentElement - 包含 Mermaid 代码块的父 DOM 元素。
   */
  renderAllMermaidBlocks: function(parentElement) {
    if (typeof mermaid === 'undefined' || !window.mermaidLoaded) {
      // Mermaid 未加载，直接返回
      return;
    }

    if (!parentElement) {
      return;
    }

    try {
      const mermaidBlocks = parentElement.querySelectorAll('pre code.language-mermaid, code.language-mermaid');
      if (mermaidBlocks.length === 0) return;

      mermaidBlocks.forEach((block, index) => {
        const containerId = `mermaid-container-${Date.now()}-${index}`;
        let preElement = block.tagName === 'CODE' ? block.parentElement : block;
        if (preElement && preElement.tagName !== 'PRE') preElement = null;

        // 跳过已渲染的块
        if (preElement && preElement.dataset.mermaidRendered === 'true') {
          return;
        }
        if (preElement) {
          preElement.dataset.mermaidRendered = 'true';
        }

        const mermaidCode = block.textContent || '';
        if (!mermaidCode.trim()) {
          if(preElement) preElement.dataset.mermaidRendered = 'false';
          return;
        }

        const container = document.createElement('div');
        container.id = containerId;
        container.classList.add('mermaid');

        // 处理插入位置：优先插入到 pre 后面，或替换 code
        if (preElement && preElement.parentNode) {
          // 隐藏原始 pre 块，将 SVG 插入其后
          if (preElement.dataset.mermaidOriginalDisplay === undefined) {
               preElement.dataset.mermaidOriginalDisplay = preElement.style.display;
          }
          preElement.style.display = 'none';
          preElement.parentNode.insertBefore(container, preElement.nextSibling);
        } else {
          // code 直接替换
          block.innerHTML = '';
          block.appendChild(container);
          block.style.background = 'transparent';
          block.style.padding = '0';
        }

        // Mermaid 渲染
        try {
            mermaid.render(containerId, mermaidCode, (svgCode, bindFunctions) => {
                container.innerHTML = svgCode;
                if (typeof bindFunctions === 'function') {
                    bindFunctions(container);
                }
                if (preElement && preElement.parentNode) {
                    if (preElement.dataset.mermaidOriginalDisplay === undefined) {
                         preElement.dataset.mermaidOriginalDisplay = preElement.style.display;
                    }
                    preElement.style.display = 'none';
                    preElement.parentNode.insertBefore(container, preElement.nextSibling);
                }
            });
        } catch (err) {
            console.error("Mermaid rendering error:", err, "for code:", mermaidCode.substring(0,100));
            container.innerHTML = `<pre style="color:red; background:#fff0f0; padding:10px; border:1px solid red;">Mermaid渲染错误:\n${window.ChatbotUtils.escapeHtml(String(err))}\n--- 源 代 码 ---\n${window.ChatbotUtils.escapeHtml(mermaidCode)}</pre>`;
            if (preElement && preElement.parentNode) {
                 if (preElement.dataset.mermaidOriginalDisplay === undefined) {
                     preElement.dataset.mermaidOriginalDisplay = preElement.style.display;
                 }
                 preElement.style.display = 'none';
                 preElement.parentNode.insertBefore(container, preElement.nextSibling);
            } else if (block.parentNode) {
                // code已append，无需额外操作
            }
            if(preElement) preElement.dataset.mermaidRendered = 'error';
        }
      });
    } catch (e) {
      console.error("Error processing Mermaid blocks:", e);
      // 全局异常时恢复原始 pre 块
      parentElement.querySelectorAll('pre[data-mermaid-rendered]').forEach(pre => {
        if (pre.dataset.mermaidOriginalDisplay !== undefined) {
            pre.style.display = pre.dataset.mermaidOriginalDisplay;
        }
        delete pre.dataset.mermaidRendered;
        delete pre.dataset.mermaidOriginalDisplay;
        // 清理可能添加的兄弟节点 (mermaid-container)
        let sibling = pre.nextSibling;
        if (sibling && sibling.classList && sibling.classList.contains('mermaid')) {
            sibling.remove();
        }
      });
    }
  }
};

// 可选：escapeHtml 辅助函数（推荐直接用 ChatbotUtils.escapeHtml）
// if (window.ChatbotUtils && typeof window.ChatbotUtils.escapeHtml === 'function') {
//   ChatbotRenderingUtils.escapeHtml = window.ChatbotUtils.escapeHtml;
// } else {
//   // 简易的兜底 escapeHtml，但强烈建议使用 ChatbotUtils 中的版本
//   ChatbotRenderingUtils.escapeHtml = function(str) {
//     return String(str)
//       .replace(/&/g, '&amp;')
//       .replace(/</g, '&lt;')
//       .replace(/>/g, '&gt;')
//       .replace(/"/g, '&quot;')
//       .replace(/'/g, '&#39;');
//   };
// }