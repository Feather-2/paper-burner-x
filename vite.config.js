import { resolve } from 'path';

// 可选的前端构建配置：不改变现有直出模式
// - 输入：根目录 index.html 与 admin/index.html
// - 输出：dist/ （与生产无关，默认不被服务端使用）
// - 可选使用：npm run dev:fe / build:fe / preview:fe

export default {
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin/index.html'),
      },
    },
  },
  server: {
    port: 5173,
    open: false,
  },
};
