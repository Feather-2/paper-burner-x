/**
 * UI 模块兼容层
 * 加载拆分后的子模块，保持 window.initUI 兼容性
 *
 * 模块结构：
 * - config-utils.js  - 配置工具函数
 * - model-config.js  - 模型配置渲染
 * - source-sites.js  - 源站点管理
 * - init.js          - initUI 入口
 */

// 动态加载子模块（相对于当前脚本路径）
(function() {
  'use strict';

  // 获取当前脚本的基础路径
  function getScriptBasePath() {
    try {
      const scripts = document.getElementsByTagName('script');
      for (let i = scripts.length - 1; i >= 0; i--) {
        const src = scripts[i].src || '';
        if (src.includes('ui.js') || src.includes('ui/ui.js')) {
          return src.replace(/ui\.js(\?.*)?$/, '');
        }
      }
    } catch (e) {}
    return './js/ui/';
  }

  const basePath = getScriptBasePath();
  const modules = [
    'config-utils.js',
    'model-config.js',
    'source-sites.js',
    'init.js'
  ];

  // 动态加载脚本
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = false; // 保持顺序
      script.onload = resolve;
      script.onerror = () => reject(new Error('Failed to load: ' + src));
      document.head.appendChild(script);
    });
  }

  // 按顺序加载所有模块
  async function loadModules() {
    for (const mod of modules) {
      try {
        await loadScript(basePath + mod);
      } catch (e) {
        console.warn('[ui.js] Module load warning:', e.message);
      }
    }
  }

  // 如果子模块尚未加载，则加载它们
  if (typeof window.UIConfigUtils === 'undefined') {
    loadModules().catch(console.error);
  }

})();

// 兼容层：确保 window.initUI 可用
if (typeof window !== 'undefined' && typeof window.initUI !== 'function') {
  // 如果 initUI 尚未定义，提供一个延迟执行的版本
  window.initUI = function() {
    console.warn('[ui.js] initUI called before modules loaded, deferring...');
    setTimeout(() => {
      if (typeof window.initUI === 'function' && window.initUI !== arguments.callee) {
        window.initUI();
      }
    }, 100);
  };
}

// ESM 导出（用于 ESM 环境）
export function initUI(...args) {
  return globalThis.window?.initUI?.(...args);
}

export default { initUI };
