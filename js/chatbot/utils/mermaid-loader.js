/**
 * @file js/chatbot/utils/mermaid-loader.js
 * @description Mermaid.js 动态加载器（ESM + window.* facade）
 *
 * - 浏览器环境：首次加载时自动注入 <script> 并初始化 mermaid
 * - 非浏览器环境：导出函数但不触发任何副作用
 */

const DEFAULT_MERMAID_LOCAL_SRC = 'lib/mermaid.min.js';
const DEFAULT_MERMAID_CDN_SRC = 'https://gcore.jsdelivr.net/npm/mermaid@10.9.0/dist/mermaid.min.js';

/**
 * 确保 Mermaid 已加载并初始化
 * @param {Object} [options]
 * @param {string} [options.src] Mermaid CDN 地址
 * @returns {Promise<boolean>} 是否成功加载（已存在也返回 true）
 */
export function ensureMermaidLoaded(options = {}) {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.resolve(false);
  }

  const src = typeof options.src === 'string' && options.src ? options.src : DEFAULT_MERMAID_LOCAL_SRC;
  const cdnSrc = typeof options.cdnSrc === 'string' && options.cdnSrc ? options.cdnSrc : DEFAULT_MERMAID_CDN_SRC;

  // 如果外部已通过 <script> 预加载 mermaid，则无需重复加载
  if (typeof window.mermaidLoaded === 'undefined') {
    window.mermaidLoaded = typeof window.mermaid !== 'undefined';
  }

  if (window.mermaidLoaded && typeof window.mermaid !== 'undefined') {
    try {
      window.mermaid.initialize({ startOnLoad: false });
    } catch (e) {
      console.warn('[MermaidLoader] mermaid.initialize failed:', e);
    }
    return Promise.resolve(true);
  }

  // 去重：同一页面只发起一次加载
  if (window.__pbMermaidLoadPromise) return window.__pbMermaidLoadPromise;

  window.mermaidLoaded = false;

  window.__pbMermaidLoadPromise = new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.pbMermaidLoader = '1';

    script.onload = function() {
      window.mermaidLoaded = true;
      if (window.mermaid) {
        try {
          window.mermaid.initialize({ startOnLoad: false });
        } catch (e) {
          console.warn('[MermaidLoader] mermaid.initialize failed:', e);
        }
      }
      resolve(true);
    };

    script.onerror = function() {
      if (cdnSrc && cdnSrc !== src) {
        console.warn('[MermaidLoader] Local Mermaid failed, trying CDN:', cdnSrc);
        const cdnScript = document.createElement('script');
        cdnScript.src = cdnSrc;
        cdnScript.async = true;
        cdnScript.dataset.pbMermaidLoader = '1';
        cdnScript.onload = script.onload;
        cdnScript.onerror = function() {
          console.error('[MermaidLoader] Failed to load Mermaid.js dynamically (local+CDN).');
          resolve(false);
        };
        document.head.appendChild(cdnScript);
        return;
      }

      console.error('[MermaidLoader] Failed to load Mermaid.js dynamically.');
      resolve(false);
    };

    document.head.appendChild(script);
  });

  return window.__pbMermaidLoadPromise;
}

// 向后兼容：浏览器环境下按旧行为自动触发一次加载（仅在未初始化时）
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (typeof window.mermaidLoaded === 'undefined' || window.mermaidLoaded === false) {
    void ensureMermaidLoaded();
  }
}
