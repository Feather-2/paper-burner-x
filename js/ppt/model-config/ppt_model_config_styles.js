/**
 * PPT 模型配置 - 样式加载器
 * IIFE module: window.PPTModelConfig.styles
 */
(function(global) {
  'use strict';

  global.PPTModelConfig = global.PPTModelConfig || {};
  const ns = global.PPTModelConfig;
  ns.styles = ns.styles || {};

  /**
   * 现在的样式已经迁移到了外部 CSS 文件：css/ppt/ppt_model_config.css
   * 这里的 getInjectedCss 仅返回空，或可以用于动态注入一些计算样式
   */
  function getInjectedCss() {
    return `/* Styles moved to css/ppt/ppt_model_config.css */`;
  }

  Object.assign(ns.styles, { 
    getInjectedCss 
  });
})(typeof window !== 'undefined' ? window : globalThis);
