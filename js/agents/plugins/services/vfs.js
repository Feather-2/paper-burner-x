/**
 * VFS Plugin
 *
 * 虚拟文件系统服务
 */

import { createPlugin } from '../../core/plugin.js';

/**
 * @typedef {object} VfsLike
 * @property {(path: string, options?: any) => Promise<any>} readFile
 * @property {(path: string, data: any, options?: any) => Promise<any>} writeFile
 * @property {(path: string) => Promise<boolean>} exists
 * @property {(path: string) => Promise<any>} stat
 * @property {(path: string, options?: any) => Promise<any>} readdir
 * @property {(path: string, options?: any) => Promise<any>} [mkdir]
 * @property {(path: string, options?: any) => Promise<any>} [rmdir]
 * @property {(path: string) => Promise<any>} [deleteFile]
 * @property {(path: string) => Promise<any>} [unlink]
 * @property {(path: string, options?: any) => Promise<any>} [rm]
 * @property {(pattern: any, options?: any) => Promise<any>} [glob]
 */

export default createPlugin({
  name: 'service/vfs',
  version: '1.0.0',
  description: '虚拟文件系统',

  defaultConfig: {
    kind: 'auto', // auto | memory | opfs | nodefs
    rootPath: '.',
  },

  async install(ctx) {
    const { createVfs } = await import('../../vfs/index.js');
    /** @type {VfsLike} */
    const vfs = await createVfs(ctx.config);

    ctx.registerService('vfs', {
      // 文件操作
      async readFile(path, options) {
        return vfs.readFile(path, options);
      },

      async writeFile(path, data, options) {
        const result = await vfs.writeFile(path, data, options);
        ctx.events.emit('vfs.write', { path });
        return result;
      },

      async deleteFile(path) {
        const deleter =
          typeof vfs.deleteFile === 'function'
            ? (p) => vfs.deleteFile(p)
            : typeof vfs.unlink === 'function'
              ? (p) => vfs.unlink(p)
              : typeof vfs.rm === 'function'
                ? (p) => vfs.rm(p, { recursive: false })
                : null;

        if (!deleter) {
          throw new Error('VFS does not support deleteFile/unlink/rm');
        }

        const result = await deleter(path);
        ctx.events.emit('vfs.delete', { path });
        return result;
      },

      async exists(path) {
        return vfs.exists(path);
      },

      async stat(path) {
        return vfs.stat(path);
      },

      // 目录操作
      async readdir(path, options) {
        return vfs.readdir(path, options);
      },

      async list(path) {
        const entries = await vfs.readdir(path, { withFileTypes: true });
        if (!Array.isArray(entries)) return [];
        return entries
          .filter((e) => e && typeof e === "object" && typeof e.name === "string")
          .map((e) => ({ name: e.name, kind: e.isDirectory?.() ? "dir" : "file" }));
      },

      async mkdir(path, options) {
        return vfs.mkdir(path, options);
      },

      async rmdir(path, options) {
        return vfs.rmdir(path, options);
      },

      // Glob
      async glob(pattern, options) {
        if (typeof vfs.glob === 'function') {
          return vfs.glob(pattern, options);
        }
        // Fallback
        const { createVfsGlobFn } = await import('../../vfs/glob.js');
        const globFn = createVfsGlobFn(vfs);
        if (typeof globFn !== 'function') return [];

        const request =
          pattern && typeof pattern === 'object'
            ? { ...(pattern || {}), ...(options || {}) }
            : { pattern, ...(options || {}) };

        return globFn(request);
      },

      // 获取底层 VFS 实例
      getInstance() {
        return vfs;
      },

      // 类型信息
      getType() {
        return vfs.constructor.name;
      },
    });

    ctx.log.info(`VFS plugin installed (${vfs.constructor.name})`);
  },
});
