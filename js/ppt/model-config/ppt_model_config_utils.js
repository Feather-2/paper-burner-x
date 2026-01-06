/**
 * PPT 模型配置 - 轻量工具函数
 * IIFE module: window.PPTModelConfig.utils
 */
(function(global) {
  'use strict';

  global.PPTModelConfig = global.PPTModelConfig || {};
  const ns = global.PPTModelConfig;
  ns.utils = ns.utils || {};

  function normalizeObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value;
  }

  function uniqueByKey(list) {
    const out = [];
    const seen = new Set();
    for (const item of Array.isArray(list) ? list : []) {
      const key = item?.key;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
    return out;
  }

  function safe(str) {
    return String(str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));
  }

  Object.assign(ns.utils, { normalizeObject, uniqueByKey, safe });
})(typeof window !== 'undefined' ? window : globalThis);
