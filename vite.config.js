import { resolve } from 'path';
import { defineConfig } from 'vite';

// Phase 7: 依赖现代化配置
// - 开发模式：继续使用 CDN 以加快启动
// - 生产构建：打包核心依赖，减少 CDN 请求

// 保持 CDN 加载的大型依赖（不打包）
const EXTERNAL_DEPS = [
  'pdfjs-dist',
  'pptxgenjs',
  'docx-preview',
  'html2pdf.js'
];

export default defineConfig({
  root: '.',
  publicDir: 'public',

  // 路径别名
  resolve: {
    alias: {
      '@': resolve(__dirname, 'js'),
      '@shared': resolve(__dirname, 'js/shared'),
      '@storage': resolve(__dirname, 'js/storage'),
      '@core': resolve(__dirname, 'js/core'),
      '@ui': resolve(__dirname, 'js/ui'),
      '@annotations': resolve(__dirname, 'js/annotations'),
      '@deps': resolve(__dirname, 'js/deps')
    }
  },

  build: {
    outDir: 'dist',
    emptyOutDir: true,

    // 代码分割配置
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        // ppt: resolve(__dirname, 'ppt.html'), // 可选
      },

      output: {
        // 第三方依赖单独打包
        manualChunks: {
          'vendor-core': [
            'dompurify',
            'axios',
            'js-base64',
            'file-saver',
            'jszip'
          ],
          'vendor-markdown': [
            'marked',
            'markdown-it',
            'katex'
          ],
          'vendor-utils': [
            'animejs',
            'graphlib',
            'dagre'
          ]
        },

        // 资源命名
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]'
      },

      // 外部依赖（继续使用 CDN）
      external: (id) => {
        return EXTERNAL_DEPS.some(dep => id.includes(dep));
      }
    },

    // 压缩配置
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: false, // 保留 console 用于调试
        drop_debugger: true
      }
    },

    // 源码映射（生产环境可选关闭）
    sourcemap: true,

    // 目标浏览器
    target: 'es2020'
  },

  server: {
    port: 5173,
    open: false,

    // 开发服务器代理
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  },

  // 优化配置
  optimizeDeps: {
    include: [
      'dompurify',
      'axios',
      'js-base64',
      'file-saver',
      'jszip',
      'marked',
      'markdown-it',
      'katex',
      'animejs'
    ],
    exclude: EXTERNAL_DEPS
  },

  // Vitest 配置（core/annotations/storage 单测）
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: [
        'js/annotations/core/**/*.js',
        'js/annotations/renderers/**/*.js',
        'js/annotations/services/**/*.js',
        'js/annotations/index.js'
      ],
      exclude: [
        'js/annotations/annotation_logic.js',
        'js/annotations/annotation_highlighter.js',
        'js/annotations/annotations_summary_modal.js',
        'js/annotations/custom_markdown_renderer.js'
      ],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 85,
        statements: 90
      }
    }
  }
});
