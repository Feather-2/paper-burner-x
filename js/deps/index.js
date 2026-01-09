/**
 * @file js/deps/index.js
 * @description 依赖模块统一导出
 */

export * from './vendor.js';

// CDN 依赖清单（用于文档和构建配置）
export const CDN_DEPS = {
  // 核心依赖 - 建议打包
  bundled: [
    'dompurify',
    'axios',
    'js-base64',
    'file-saver',
    'jszip',
    'marked',
    'markdown-it',
    'katex',
    'animejs',
    'graphlib',
    'dagre',
    'mammoth',
    'turndown'
  ],

  // 运行时 CDN - 保持 CDN 加载（体积大或有特殊要求）
  runtime: [
    'tailwindcss',      // 开发模式 JIT 编译
    'pdfjs-dist',       // 体积大，按需加载
    'pptxgenjs',        // 体积大，按需加载
    'docx-preview',     // 体积大，按需加载
    'html2pdf.js',      // 体积大，按需加载
    'iconify-icon'      // Web Component，CDN 更新频繁
  ],

  // 可选依赖
  optional: [
    'vditor'            // Markdown 编辑器，PPT 模块使用
  ]
};

// 依赖版本锁定
export const DEP_VERSIONS = {
  'dompurify': '3.0.6',
  'axios': 'latest',
  'js-base64': '3.7.5',
  'file-saver': '2.0.5',
  'jszip': '3.10.1',
  'marked': 'latest',
  'markdown-it': '14.0.0',
  'katex': '0.16.9',
  'animejs': '3.2.1',
  'graphlib': '2.1.8',
  'dagre': '0.8.5',
  'mammoth': '1.4.21',
  'turndown': '7.1.2',
  'pdfjs-dist': '3.11.174',
  'pptxgenjs': '3.12.0',
  'docx-preview': '0.3.7',
  'html2pdf.js': '0.10.1',
  'iconify-icon': '2.0.0'
};
