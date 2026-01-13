/**
 * UI 配置工具模块
 * 提供通用的配置输入/选择框创建函数
 */

(function(window) {
  'use strict';

  /**
   * HTML 转义
   * @param {*} value - 要转义的值
   * @returns {string} 转义后的字符串
   */
  function escapeHtml(value) {
    const str = String(value ?? '');
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/`/g, '&#96;');
  }

  /**
   * 属性值转义
   * @param {*} value - 要转义的值
   * @returns {string} 转义后的字符串
   */
  function escapeAttr(value) {
    return escapeHtml(value);
  }

  /**
   * 创建配置输入框
   * @param {string} id - 输入框 ID
   * @param {string} label - 标签文本
   * @param {string|number} value - 当前值
   * @param {string} type - 输入类型 (text/number/password/url)
   * @param {string} placeholder - 占位符文本
   * @param {Function} [onChange] - 值变化回调
   * @param {Object} [attrs] - 额外的 HTML 属性
   * @returns {HTMLElement} 包装 div 元素
   */
  function createConfigInput(id, label, value, type = 'text', placeholder = '', onChange = null, attrs = {}) {
    const wrapper = document.createElement('div');
    wrapper.className = 'mb-3';

    const labelEl = document.createElement('label');
    labelEl.className = 'block text-xs font-medium text-gray-600 mb-1';
    labelEl.htmlFor = id;
    labelEl.textContent = label;

    const input = document.createElement('input');
    input.type = type;
    input.id = id;
    input.name = id;
    input.value = value || '';
    input.placeholder = placeholder;
    input.className = 'w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors';

    // 应用额外属性
    Object.entries(attrs).forEach(([key, val]) => {
      input.setAttribute(key, val);
    });

    if (typeof onChange === 'function') {
      input.addEventListener('change', onChange);
      input.addEventListener('input', onChange);
    }

    wrapper.appendChild(labelEl);
    wrapper.appendChild(input);
    return wrapper;
  }

  /**
   * 创建配置选择框
   * @param {string} id - 选择框 ID
   * @param {string} label - 标签文本
   * @param {string} value - 当前值
   * @param {Array<{value: string, text: string}>} options - 选项列表
   * @param {Function} [onChange] - 值变化回调
   * @returns {HTMLElement} 包装 div 元素
   */
  function createConfigSelect(id, label, value, options, onChange = null) {
    const wrapper = document.createElement('div');
    wrapper.className = 'mb-3';

    const labelEl = document.createElement('label');
    labelEl.className = 'block text-xs font-medium text-gray-600 mb-1';
    labelEl.htmlFor = id;
    labelEl.textContent = label;

    const select = document.createElement('select');
    select.id = id;
    select.name = id;
    select.className = 'w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors';

    options.forEach(opt => {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.text;
      if (opt.value === value) {
        option.selected = true;
      }
      select.appendChild(option);
    });

    if (typeof onChange === 'function') {
      select.addEventListener('change', onChange);
    }

    wrapper.appendChild(labelEl);
    wrapper.appendChild(select);
    return wrapper;
  }

  /**
   * 创建带标签的输入框（简化版）
   * @param {string} label - 标签文本
   * @param {string} placeholder - 占位符
   * @param {string|number} value - 当前值
   * @param {string} type - 输入类型
   * @returns {{wrapper: HTMLElement, input: HTMLInputElement}} 包装元素和输入框
   */
  function createLabeledInput(label, placeholder, value, type = 'text') {
    const wrapper = document.createElement('div');
    wrapper.className = 'mb-3';

    const l = document.createElement('label');
    l.className = 'block text-sm font-medium text-slate-700 mb-1';
    l.textContent = label;

    const input = document.createElement('input');
    input.type = type;
    input.placeholder = placeholder;
    input.value = value || '';
    input.className = 'w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500 text-sm';

    wrapper.appendChild(l);
    wrapper.appendChild(input);
    return { wrapper, input };
  }

  /**
   * 创建带标签的选择框（简化版）
   * @param {string} label - 标签文本
   * @param {Array<{value: string, label: string}>} options - 选项列表
   * @param {string} value - 当前值
   * @returns {{wrapper: HTMLElement, select: HTMLSelectElement}} 包装元素和选择框
   */
  function createLabeledSelect(label, options, value) {
    const wrapper = document.createElement('div');
    wrapper.className = 'mb-3';

    const l = document.createElement('label');
    l.className = 'block text-sm font-medium text-slate-700 mb-1';
    l.textContent = label;

    const select = document.createElement('select');
    select.className = 'w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500 text-sm';

    options.forEach(opt => {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.label;
      if (opt.value === value) {
        option.selected = true;
      }
      select.appendChild(option);
    });

    wrapper.appendChild(l);
    wrapper.appendChild(select);
    return { wrapper, select };
  }

  /**
   * 生成 UUID
   * @returns {string} UUID 字符串
   */
  function generateUUID() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  // 导出到全局作用域
  window.UIConfigUtils = {
    escapeHtml,
    escapeAttr,
    createConfigInput,
    createConfigSelect,
    createLabeledInput,
    createLabeledSelect,
    generateUUID
  };

  // 兼容旧代码：将函数暴露到 window
  window.createConfigInput = createConfigInput;
  window.createConfigSelect = createConfigSelect;
  window._generateUUID_ui = generateUUID;

})(window);

// ESM 导出
export const escapeHtml = window.UIConfigUtils?.escapeHtml;
export const escapeAttr = window.UIConfigUtils?.escapeAttr;
export const createConfigInput = window.UIConfigUtils?.createConfigInput;
export const createConfigSelect = window.UIConfigUtils?.createConfigSelect;
export const createLabeledInput = window.UIConfigUtils?.createLabeledInput;
export const createLabeledSelect = window.UIConfigUtils?.createLabeledSelect;
export const generateUUID = window.UIConfigUtils?.generateUUID;

export default {
  escapeHtml,
  escapeAttr,
  createConfigInput,
  createConfigSelect,
  createLabeledInput,
  createLabeledSelect,
  generateUUID
};
