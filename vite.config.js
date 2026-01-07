import { resolve } from 'path';
import { defineConfig } from 'vite';
import { cpSync, mkdirSync, existsSync } from 'fs';

// Phase 7: 依赖现代化配置
// - 开发模式：继续使用 CDN 以加快启动
// - 生产构建：打包核心依赖，减少 CDN 请求

// 暂时排除的模块（待后续重构）
const EXCLUDED_MODULES = [
  'js/agents/'
];

// 大型依赖保持 CDN（可选，设为空数组则全部打包）
const EXTERNAL_DEPS = [
  // 'pdfjs-dist',      // 太大，保持 CDN
  // 'pptxgenjs',       // 无 ESM 版本
  // 'docx-preview',    // 无 ESM 版本
];

// 动态加载的目录（需要在构建后复制）
const DYNAMIC_DIRS = [
  'js/process',
];

// Vite 插件：构建后复制动态加载的目录
function copyDynamicDirs() {
  return {
    name: 'copy-dynamic-dirs',
    closeBundle() {
      for (const dir of DYNAMIC_DIRS) {
        const src = resolve(__dirname, dir);
        const dest = resolve(__dirname, 'dist', dir);
        if (existsSync(src)) {
          mkdirSync(dest, { recursive: true });
          cpSync(src, dest, { recursive: true });
          console.log(`[copy-dynamic-dirs] Copied ${dir} to dist/`);
        }
      }
      // 复制 SVG 到 dist/public/ (因为代码中引用 public/xxx.svg)
      const publicDest = resolve(__dirname, 'dist/public');
      mkdirSync(publicDest, { recursive: true });
      for (const svg of ['h_with_name.svg', 'pure.svg', 'with_name.svg']) {
        const src = resolve(__dirname, 'dist', svg);
        if (existsSync(src)) {
          cpSync(src, resolve(publicDest, svg));
        }
      }
      console.log('[copy-dynamic-dirs] Copied SVGs to dist/public/');
    }
  };
}

export default defineConfig({
  root: '.',
  publicDir: 'public',

  // 插件
  plugins: [copyDynamicDirs()],

  // 关键：使用相对路径，确保 file:// 协议可直接打开
  base: './',

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
        // ppt: resolve(__dirname, 'ppt.html'),  // 暂时排除：依赖 js/agents/ 待重构
        historyDetail: resolve(__dirname, 'views/history/history_detail.html'),
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

      // 外部依赖（继续使用 CDN）+ 排除 agents 模块
      external: (id) => {
        if (EXTERNAL_DEPS.some(dep => id.includes(dep))) return true;
        if (EXCLUDED_MODULES.some(mod => id.includes(mod))) return true;
        return false;
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
