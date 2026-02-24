/**
 * VFS Plugin
 *
 * 虚拟文件系统服务
 */

import { createPlugin } from '../../core/plugin.js';

/**
 * @typedef {string} BufferEncoding
 */

/**
 * @typedef {object} VfsReadOptions
 * @property {BufferEncoding} [encoding] - 文件编码
 */

/**
 * @typedef {object} VfsWriteOptions
 * @property {BufferEncoding} [encoding] - 文件编码
 * @property {boolean} [recursive] - 是否递归创建目录
 */

/**
 * @typedef {object} VfsDirEntry
 * @property {string} name - 文件/目录名
 * @property {'file' | 'dir'} kind - 类型
 */

/**
 * @typedef {object} VfsStat
 * @property {number} size - 文件大小（字节）
 * @property {Date} mtime - 修改时间
 * @property {boolean} isFile - 是否是文件
 * @property {boolean} isDirectory - 是否是目录
 */

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
 * @property {(path: string) => Promise<string>} [readText]
 * @property {(path: string, text: string) => Promise<void>} [writeText]
 * @property {(path: string, text: string) => Promise<void>} [appendText]
 */

/**
 * @typedef {object} VfsGlobRequest
 * @property {string} [pattern]
 * @property {string} [path]
 * @property {AbortSignal} [signal]
 * @property {number} [yieldEvery]
 * @property {boolean} [useScanWorker]
 * @property {string} [cwd]
 * @property {string[]} [ignore]
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
    /** @type {((request: VfsGlobRequest) => Promise<string[]>) | null} */
    let fallbackGlobFn = null;
    let fallbackGlobInitialized = false;

    ctx.registerService('vfs', {
      /**
       * 读取文件内容
       * @param {string} path - 文件路径
       * @param {VfsReadOptions} [options] - 读取选项
       * @returns {Promise<string | Uint8Array>} 文件内容
       * @throws {Error} 文件不存在或读取失败
       */
      async readFile(path, options) {
        return vfs.readFile(path, options);
      },

      /**
       * 写入文件内容
       * @param {string} path - 文件路径
       * @param {string | Uint8Array} data - 文件内容
       * @param {VfsWriteOptions} [options] - 写入选项
       * @returns {Promise<void>}
       * @throws {Error} 写入失败
       */
      async writeFile(path, data, options) {
        const result = await vfs.writeFile(path, data, options);
        ctx.events.emit('vfs:write', { path });
        return result;
      },

      /**
       * 删除文件
       * @param {string} path - 文件路径
       * @returns {Promise<void>}
       * @throws {Error} 文件不存在或删除失败
       */
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
        ctx.events.emit('vfs:delete', { path });
        return result;
      },

      /**
       * 检查路径是否存在
       * @param {string} path - 文件或目录路径
       * @returns {Promise<boolean>}
       */
      async exists(path) {
        return vfs.exists(path);
      },

      /**
       * 获取文件/目录状态信息
       * @param {string} path - 文件或目录路径
       * @returns {Promise<VfsStat>}
       * @throws {Error} 路径不存在
       */
      async stat(path) {
        return vfs.stat(path);
      },

      /**
       * 读取目录内容（原始）
       * @param {string} path - 目录路径
       * @param {{withFileTypes?: boolean}} [options] - 选项
       * @returns {Promise<string[] | object[]>}
       */
      async readdir(path, options) {
        return vfs.readdir(path, options);
      },

      /**
       * 读取目录内容（结构化）
       * @param {string} path - 目录路径
       * @returns {Promise<VfsDirEntry[]>}
       */
      async list(path) {
        const entries = await vfs.readdir(path, { withFileTypes: true });
        if (!Array.isArray(entries)) return [];
        return entries
          .filter((e) => e && typeof e === "object" && typeof e.name === "string")
          .map((e) => ({ name: e.name, kind: e.isDirectory?.() ? "dir" : "file" }));
      },

      /**
       * 创建目录
       * @param {string} path - 目录路径
       * @param {{recursive?: boolean}} [options] - 选项
       * @returns {Promise<void>}
       */
      async mkdir(path, options) {
        return vfs.mkdir(path, options);
      },

      /**
       * 删除目录
       * @param {string} path - 目录路径
       * @param {{recursive?: boolean}} [options] - 选项
       * @returns {Promise<void>}
       * @throws {Error} 目录不存在或非空
       */
      async rmdir(path, options) {
        return vfs.rmdir(path, options);
      },

      /**
       * 使用 glob 模式匹配文件
       * @param {string | {pattern: string}} pattern - glob 模式
       * @param {{cwd?: string, ignore?: string[]}} [options] - 选项
       * @returns {Promise<string[]>} 匹配的文件路径列表
       */
      async glob(pattern, options) {
        if (typeof vfs.glob === 'function') {
          return vfs.glob(pattern, options);
        }

        if (!fallbackGlobInitialized) {
          fallbackGlobInitialized = true;
          try {
            const { createVfsGlobFn } = await import('../../vfs/glob.js');
            const maybeGlobFn = typeof createVfsGlobFn === 'function' ? createVfsGlobFn(vfs) : null;
            fallbackGlobFn = typeof maybeGlobFn === 'function' ? maybeGlobFn : null;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            ctx.log.warn(`VFS glob fallback unavailable: ${message}`);
            fallbackGlobFn = null;
          }
        }

        if (typeof fallbackGlobFn !== 'function') return [];

        const request = /** @type {VfsGlobRequest} */ (
          /** @type {unknown} */ (
            pattern && typeof pattern === 'object'
              ? { ...(pattern || {}), ...(options || {}) }
              : { pattern, ...(options || {}) }
          )
        );

        return fallbackGlobFn(request);
      },

      /**
       * 读取文本文件
       * @param {string} path - 文件路径
       * @returns {Promise<string>}
       */
      async readText(path) {
        if (typeof vfs.readText === 'function') return vfs.readText(path);
        return vfs.readFile(path, { encoding: 'utf8' });
      },

      /**
       * 写入文本文件
       * @param {string} path - 文件路径
       * @param {string} text - 文本内容
       * @returns {Promise<void>}
       */
      async writeText(path, text) {
        if (typeof vfs.writeText === 'function') return vfs.writeText(path, text);
        const result = await vfs.writeFile(path, text, { encoding: 'utf8' });
        ctx.events.emit('vfs:write', { path });
        return result;
      },

      /**
       * 追加文本到文件
       * @param {string} path - 文件路径
       * @param {string} text - 追加内容
       * @returns {Promise<void>}
       */
      async appendText(path, text) {
        if (typeof vfs.appendText === 'function') {
          const result = await vfs.appendText(path, text);
          ctx.events.emit('vfs:write', { path });
          return result;
        }
        // 降级：read + append + write
        let existing = '';
        try { existing = await this.readText(path); } catch { /* new file */ }
        return this.writeText(path, existing + text);
      },

      /**
       * 获取底层 VFS 实例
       * @returns {VfsLike}
       */
      getInstance() {
        return vfs;
      },

      /**
       * 获取 VFS 类型名称
       * @returns {string}
       */
      getType() {
        return vfs.constructor.name;
      },
    });

    ctx.log.info(`VFS plugin installed (${vfs.constructor.name})`);
  },
});
