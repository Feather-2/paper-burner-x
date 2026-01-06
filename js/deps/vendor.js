/**
 * @file js/deps/vendor.js
 * @description 第三方依赖统一入口 - Phase 7 依赖现代化
 *
 * 此文件用于 Vite 构建时打包核心依赖，替代 CDN 脚本标签。
 * 开发模式仍可使用 CDN 以加快启动速度。
 */

// === 核心工具库 ===
// 这些库在生产构建中会被打包，开发时继续使用 CDN

// DOMPurify - XSS 防护
export { default as DOMPurify } from 'dompurify';

// axios - HTTP 客户端
export { default as axios } from 'axios';

// js-base64 - Base64 编解码
export { Base64 } from 'js-base64';

// file-saver - 文件下载
export { saveAs } from 'file-saver';

// JSZip - ZIP 处理
export { default as JSZip } from 'jszip';

// marked - Markdown 解析
export { marked } from 'marked';

// markdown-it - AST Markdown 解析
export { default as markdownIt } from 'markdown-it';

// KaTeX - 数学公式渲染
export { default as katex } from 'katex';

// anime.js - 动画库
export { default as anime } from 'animejs';

// === 图形/布局 ===
// graphlib + dagre - 图布局
export * as graphlib from 'graphlib';
export { default as dagre } from 'dagre';

// === 文档处理 ===
// mammoth - DOCX 转 HTML
export { default as mammoth } from 'mammoth';

// turndown - HTML 转 Markdown
export { default as TurndownService } from 'turndown';

// pdfjs-dist - PDF 解析
export * as pdfjs from 'pdfjs-dist';

// === 兼容层：暴露到 window ===
// 为了向后兼容，在浏览器环境中暴露全局变量
if (typeof window !== 'undefined') {
  // 延迟导入以支持 tree-shaking
  import('dompurify').then(m => { window.DOMPurify = m.default; });
  import('axios').then(m => { window.axios = m.default; });
  import('js-base64').then(m => { window.Base64 = m.Base64; });
  import('file-saver').then(m => { window.saveAs = m.saveAs; });
  import('jszip').then(m => { window.JSZip = m.default; });
  import('marked').then(m => { window.marked = m.marked; });
  import('markdown-it').then(m => { window.markdownit = m.default; });
  import('katex').then(m => { window.katex = m.default; });
  import('animejs').then(m => { window.anime = m.default; });
}

/**
 * 初始化所有依赖（用于确保全局变量可用）
 */
export async function initializeDeps() {
  const [
    DOMPurify,
    axios,
    { Base64 },
    { saveAs },
    JSZip,
    { marked },
    markdownIt,
    katex,
    anime
  ] = await Promise.all([
    import('dompurify'),
    import('axios'),
    import('js-base64'),
    import('file-saver'),
    import('jszip'),
    import('marked'),
    import('markdown-it'),
    import('katex'),
    import('animejs')
  ]);

  if (typeof window !== 'undefined') {
    window.DOMPurify = DOMPurify.default;
    window.axios = axios.default;
    window.Base64 = Base64;
    window.saveAs = saveAs;
    window.JSZip = JSZip.default;
    window.marked = marked;
    window.markdownit = markdownIt.default;
    window.katex = katex.default;
    window.anime = anime.default;
  }

  return {
    DOMPurify: DOMPurify.default,
    axios: axios.default,
    Base64,
    saveAs,
    JSZip: JSZip.default,
    marked,
    markdownIt: markdownIt.default,
    katex: katex.default,
    anime: anime.default
  };
}
