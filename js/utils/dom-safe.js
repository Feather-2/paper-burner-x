/**
 * @file js/utils/dom-safe.js
 * @description 安全的 DOM 操作工具 - 防止 XSS 攻击
 *
 * 核心原则：
 * 1. 优先使用 textContent 而不是 innerHTML
 * 2. 必须使用 innerHTML 时，先转义或使用白名单
 * 3. 禁止设置事件属性（onclick, onload 等）
 */

(function(window) {
  'use strict';

  /**
   * 安全的 DOM 操作工具集
   */
  const DomSafe = {
  /**
   * 安全地设置文本内容（推荐）
   * @param {HTMLElement} element - 目标元素
   * @param {string} text - 要设置的文本
   */
  setText(element, text) {
    if (!element) {
      console.error('DomSafe.setText: element is null');
      return;
    }
    element.textContent = text;
  },

  /**
   * 安全地创建元素
   * @param {string} tag - 元素标签名
   * @param {string} text - 文本内容（可选）
   * @param {Object} attributes - 属性对象（可选）
   * @returns {HTMLElement}
   */
  createElement(tag, text = '', attributes = {}) {
    const el = document.createElement(tag);

    if (text) {
      el.textContent = text;
    }

    // 安全地设置属性
    for (const [key, value] of Object.entries(attributes)) {
      this.setAttribute(el, key, value);
    }

    return el;
  },

  /**
   * 转义 HTML 特殊字符
   * @param {string} str - 要转义的字符串
   * @returns {string}
   */
  escapeHtml(str) {
    if (typeof str !== 'string') return str;

    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  /**
   * 安全地设置属性
   * @param {HTMLElement} element - 目标元素
   * @param {string} attr - 属性名
   * @param {string} value - 属性值
   */
  setAttribute(element, attr, value) {
    // 禁止设置事件属性
    if (attr.toLowerCase().startsWith('on')) {
      console.error(`DomSafe: 不允许设置事件属性: ${attr}`);
      return;
    }

    // 检查危险的 URL 协议
    if (attr === 'href' || attr === 'src') {
      const urlStr = String(value).trim().toLowerCase();
      if (urlStr.startsWith('javascript:') || urlStr.startsWith('data:text/html')) {
        console.error(`DomSafe: 不允许的 URL 协议: ${urlStr}`);
        return;
      }
    }

    element.setAttribute(attr, value);
  },

  /**
   * 安全地清空元素内容
   * @param {HTMLElement} element - 目标元素
   */
  empty(element) {
    if (!element) return;
    element.innerHTML = '';
  },

  /**
   * 安全地添加 HTML（使用白名单）
   * 仅用于必须使用 HTML 的场景（如渲染 Markdown）
   * @param {HTMLElement} element - 目标元素
   * @param {string} html - HTML 字符串
   * @param {Array<string>} allowedTags - 允许的标签白名单（可选）
   */
  setHTML(element, html, allowedTags = null) {
    if (!element) {
      console.error('DomSafe.setHTML: element is null');
      return;
    }

    if (!html) {
      element.innerHTML = '';
      return;
    }

    // 如果没有白名单，使用纯文本
    if (!allowedTags || allowedTags.length === 0) {
      element.textContent = html;
      return;
    }

    // 简单的白名单过滤（仅用于基本场景）
    // 注意：这不是完整的 HTML sanitizer，复杂场景请使用 DOMPurify
    const allowedPattern = allowedTags.join('|');
    const regex = new RegExp(`<(?!\/?(${allowedPattern})\\b)[^>]*>`, 'gi');
    const sanitized = html.replace(regex, '');

    element.innerHTML = sanitized;
  },

  /**
   * 批量替换元素的 innerHTML 为安全方式
   * 用于迁移旧代码
   * @param {HTMLElement} element - 父元素
   * @param {string} selector - 选择器
   * @param {Function} contentFn - 返回内容的函数 (element) => content
   */
  batchSetText(element, selector, contentFn) {
    const elements = element.querySelectorAll(selector);
    elements.forEach(el => {
      const content = contentFn(el);
      this.setText(el, content);
    });
  }
  };

  /**
   * 检查字符串是否包含潜在的 XSS 攻击
   * @param {string} str - 要检查的字符串
   * @returns {boolean}
   */
  function hasPotentialXSS(str) {
    if (typeof str !== 'string') return false;

    const patterns = [
      /<script[^>]*>.*?<\/script>/gi,
      /javascript:/gi,
      /on\w+\s*=/gi, // onclick, onload, etc.
      /<iframe/gi,
      /<object/gi,
      /<embed/gi
    ];

    return patterns.some(pattern => pattern.test(str));
  }

  /**
   * 记录不安全的 innerHTML 使用（开发模式）
   * 用于迁移期间的监控
   */
  function warnUnsafeInnerHTML(location, content) {
    if (hasPotentialXSS(content)) {
      console.warn(`⚠️  检测到潜在的 XSS 风险: ${location}`, content.substring(0, 100));
    }
  }

  // 导出到全局
  window.DomSafe = DomSafe;
  window.DomSafe.hasPotentialXSS = hasPotentialXSS;
  window.DomSafe.warnUnsafeInnerHTML = warnUnsafeInnerHTML;

  console.log('[DomSafe] 安全 DOM 工具已加载');

})(window);
