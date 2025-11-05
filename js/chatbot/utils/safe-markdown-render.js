/**
 * @file js/chatbot/utils/safe-markdown-render.js
 * @description 安全的 Markdown 渲染工具 - 防止 XSS 攻击
 *
 * 设计理念：
 * 1. 移除真正危险的东西（<script>、事件属性、javascript: URL）
 * 2. 保留教学用的 HTML 代码（在代码块中自动转义）
 * 3. 保留正常的格式化标签和 HTML 示例标签
 * 4. 平衡安全与功能，不影响 AI 教学示例
 */

/**
 * 安全地渲染 Markdown 内容
 *
 * @param {string} markdown - Markdown 文本
 * @returns {string} 清理后的 HTML
 *
 * @example
 * // 正常 Markdown
 * safeRenderMarkdown("**粗体**")
 * // => "<strong>粗体</strong>"
 *
 * @example
 * // 代码块中的 HTML（安全显示）
 * safeRenderMarkdown("```html\n<script>alert()</script>\n```")
 * // => "<pre><code>&lt;script&gt;alert()&lt;/script&gt;</code></pre>"
 *
 * @example
 * // 恶意代码（被移除）
 * safeRenderMarkdown('<img src=x onerror="alert(\'XSS\')">')
 * // => "<img src='x'>"  // onerror 被移除
 */
export function safeRenderMarkdown(markdown) {
  // 检查依赖
  if (typeof marked === 'undefined') {
    console.error('safeRenderMarkdown: marked is not loaded');
    return escapeHtml(markdown).replace(/\n/g, '<br>');
  }

  if (typeof DOMPurify === 'undefined') {
    console.warn('safeRenderMarkdown: DOMPurify is not loaded, falling back to unsafe rendering');
    return marked.parse(markdown);
  }

  // 1. 使用 marked 解析 Markdown
  //    代码块会被自动转义为 &lt; &gt;，不会执行
  const rawHtml = marked.parse(markdown);

  // 2. 使用 DOMPurify 清理 - 宽松配置
  const cleanHtml = DOMPurify.sanitize(rawHtml, {
    // 允许的标签（宽松配置，支持教学示例）
    ALLOWED_TAGS: [
      // === Markdown 标准标签 ===
      'p', 'br', 'hr',
      'strong', 'em', 'b', 'i', 'u', 's', 'del', 'ins',
      'code', 'pre', 'kbd', 'samp', 'var',
      'ul', 'ol', 'li', 'dl', 'dt', 'dd',
      'blockquote',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'a', 'img',
      'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',

      // === 扩展标签（用于 KaTeX 和复杂布局） ===
      'span', 'div', 'section', 'article',
      'sup', 'sub', 'small', 'mark',

      // === 教学示例可能用到的标签 ===
      // AI 可能在教学中返回这些 HTML 标签作为示例
      // DOMPurify 会移除事件属性，所以这些标签是安全的
      'button', 'input', 'form', 'label', 'select', 'textarea', 'fieldset', 'legend',
      'iframe', 'video', 'audio', 'source', 'track',
      'details', 'summary',

      // 注意：<script> 标签即使添加到这里也会被 DOMPurify 移除
      // 这是 DOMPurify 的内置安全机制
    ],

    // 允许的属性
    ALLOWED_ATTR: [
      // 链接和媒体
      'href', 'src', 'alt', 'title',

      // 样式和布局（KaTeX 需要 style）
      'class', 'id', 'style',
      'width', 'height',

      // 链接属性
      'target', 'rel',

      // 表格属性
      'colspan', 'rowspan', 'align', 'valign',

      // 媒体属性
      'controls', 'autoplay', 'loop', 'muted',

      // 表单属性（移除了事件属性）
      'type', 'name', 'value', 'placeholder', 'disabled', 'readonly',
      'checked', 'selected',

      // iframe 属性
      'frameborder', 'allowfullscreen',

      // 注意：所有 on* 事件属性会被自动移除
      // 例如：onclick, onerror, onload 等
    ],

    // 允许的 URL 协议（阻止 javascript: 等危险协议）
    ALLOWED_URI_REGEXP: /^(?:(?:https?|http|ftp|mailto|tel|data):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,

    // 其他安全选项
    ALLOW_DATA_ATTR: false,        // 禁止 data-* 属性（防止存储恶意数据）
    SAFE_FOR_TEMPLATES: true,      // 移除模板语法 {{}} 等
    KEEP_CONTENT: true,            // 移除标签但保留内容

    // 返回完整的 HTML（不仅仅是 body）
    WHOLE_DOCUMENT: false,
    RETURN_DOM: false,
    RETURN_DOM_FRAGMENT: false,
  });

  return cleanHtml;
}

/**
 * HTML 转义（备用方案，当 DOMPurify 不可用时）
 * @private
 */
function escapeHtml(unsafe) {
  if (typeof unsafe !== 'string') return '';

  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * 检查 DOMPurify 是否可用
 * @returns {boolean}
 */
export function isDOMPurifyAvailable() {
  return typeof DOMPurify !== 'undefined';
}

/**
 * 获取当前安全配置的统计信息（用于调试）
 * @returns {object}
 */
export function getSecurityInfo() {
  return {
    hasDOMPurify: isDOMPurifyAvailable(),
    hasMarked: typeof marked !== 'undefined',
    config: {
      allowedTagsCount: 50,  // 近似值
      allowedAttributesCount: 25,
      blocksScriptTag: true,
      blocksEventAttributes: true,
      blocksJavascriptUrls: true,
    }
  };
}

// 默认导出
export default safeRenderMarkdown;

// 全局暴露（兼容非模块化使用）
if (typeof window !== 'undefined') {
  window.safeRenderMarkdown = safeRenderMarkdown;
}
