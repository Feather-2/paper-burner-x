/**
 * Browser Platform Tools - 浏览器端工具适配器
 *
 * 基于 VFS 实现文件操作，bash 不可用。
 */

import { isPlainObject, toNonEmptyString } from '../../../shared/index.js';
import { globToRegex } from '../../../shared/index.js';

/**
 * @typedef {import('./index.js').PlatformToolsOptions} PlatformToolsOptions
 * @typedef {import('./index.js').PlatformTools} PlatformTools
 */

/**
 * @param {PlatformToolsOptions} options
 * @returns {PlatformTools}
 */
export function createBrowserTools(options = {}) {
  const { vfs, basePath = '', logger } = options;

  if (!vfs) {
    logger?.warn?.('[platform/browser] VFS not provided, file operations will fail');
  }

  /**
   * 规范化路径
   * @param {string} inputPath
   * @returns {string}
   */
  function normalizePath(inputPath) {
    const rawPath = toNonEmptyString(inputPath) || '.';
    const sanitized = rawPath.replace(/\\/g, '/');
    const base = (toNonEmptyString(basePath) || '').replace(/\\/g, '/').replace(/\/+$/, '');

    if (sanitized.startsWith('/')) {
      throw new Error('Absolute paths are not allowed');
    }

    const parts = sanitized.split('/').filter(Boolean);
    for (const part of parts) {
      if (part === '..') {
        throw new Error('Path traversal detected');
      }
    }

    const normalized = parts.filter(part => part !== '.').join('/');
    if (base) {
      const combined = normalized ? `${base}/${normalized}` : base;
      if (combined !== base && !combined.startsWith(`${base}/`)) {
        throw new Error('Path traversal detected');
      }
      return combined;
    }

    return normalized || '.';
  }

  /**
   * glob - 文件模式匹配
   */
  async function glob({ pattern, path }) {
    if (!vfs) {
      return { files: [], error: 'VFS not available' };
    }

    let searchPath;
    try {
      searchPath = normalizePath(path || '.');
    } catch (err) {
      return { files: [], error: err.message };
    }

    try {
      // 尝试使用 VFS 的 glob 方法
      if (typeof vfs.glob === 'function') {
        const files = await vfs.glob(pattern, { cwd: searchPath });
        return { files: Array.isArray(files) ? files : [] };
      }

      // 降级：遍历目录手动匹配
      const files = await walkAndMatch(searchPath, pattern);
      return { files };
    } catch (err) {
      return { files: [], error: err.message };
    }
  }

  /**
   * 简易目录遍历匹配
   */
  async function walkAndMatch(dir, pattern) {
    if (!vfs || typeof vfs.list !== 'function') return [];

    const results = [];
    const regex = globToRegex(pattern);

    async function walk(currentPath) {
      try {
        const entries = await vfs.list(currentPath);
        for (const entry of entries || []) {
          const fullPath = `${currentPath}/${entry}`.replace(/\/+/g, '/');

          // 检查是否匹配
          if (regex.test(fullPath) || regex.test(entry)) {
            results.push(fullPath);
          }

          // 递归子目录 (简化：假设无 . 开头的是目录)
          if (!entry.includes('.') && entry !== '.' && entry !== '..') {
            try {
              await walk(fullPath);
            } catch (err) {
              logger?.debug?.('[platform/browser] walk skip non-directory', {
                path: fullPath,
                error: err?.message,
              });
            }
          }
        }
      } catch (err) {
        logger?.debug?.('[platform/browser] list failed', {
          path: currentPath,
          error: err?.message,
        });
      }
    }

    await walk(dir);
    return results.slice(0, 100); // 限制结果数量
  }

  /**
   * grep - 内容搜索
   */
  async function grep({ pattern, path, regex = false }) {
    if (!vfs) {
      return { matches: [], error: 'VFS not available' };
    }

    let searchPath;
    try {
      searchPath = normalizePath(path || '.');
    } catch (err) {
      return { matches: [], error: err.message };
    }

    try {
      // 在 try 内构造 RegExp 以捕获非法 pattern
      // 不使用 g flag 避免 test() 状态化问题
      const searchPattern = regex ? new RegExp(pattern, 'm') : null;

      // 获取文件列表
      const { files } = await glob({ pattern: '**/*', path: searchPath });
      const matches = [];

      for (const file of files.slice(0, 50)) {
        try {
          const content = await readText(file);
          if (!content) continue;

          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const isMatch = regex
              ? searchPattern.test(line)
              : line.includes(pattern);

            if (isMatch) {
              matches.push({
                file,
                line: i + 1,
                content: line.slice(0, 200),
              });

              if (matches.length >= 100) break;
            }
          }

          if (matches.length >= 100) break;
        } catch (err) {
          logger?.debug?.('[platform/browser] grep read failed', {
            path: file,
            error: err?.message,
          });
        }
      }

      return { matches };
    } catch (err) {
      return { matches: [], error: err.message };
    }
  }

  /**
   * 读取文本内容
   */
  async function readText(filePath) {
    if (typeof vfs.readText === 'function') {
      return await vfs.readText(filePath);
    }
    if (typeof vfs.read === 'function') {
      const data = await vfs.read(filePath);
      if (!data) return null;
      if (typeof data === 'string') return data;
      return new TextDecoder().decode(data);
    }
    return null;
  }

  /**
   * read - 读取文件
   */
  async function read({ path: filePath, startLine, endLine }) {
    if (!vfs) {
      return { content: '', error: 'VFS not available' };
    }

    let normalizedPath;
    try {
      normalizedPath = normalizePath(filePath);
    } catch (err) {
      return { content: '', error: err.message };
    }

    try {
      const content = await readText(normalizedPath);
      if (content === null) {
        return { content: '', error: 'File not found' };
      }

      // 处理行范围
      if (typeof startLine === 'number' || typeof endLine === 'number') {
        const lines = content.split('\n');
        const start = Math.max(0, (startLine || 1) - 1);
        const end = endLine ? Math.min(lines.length, endLine) : lines.length;
        return { content: lines.slice(start, end).join('\n') };
      }

      return { content };
    } catch (err) {
      return { content: '', error: err.message };
    }
  }

  /**
   * write - 写入文件
   */
  async function write({ path: filePath, content }) {
    if (!vfs) {
      return { success: false, error: 'VFS not available' };
    }

    let normalizedPath;
    try {
      normalizedPath = normalizePath(filePath);
    } catch (err) {
      return { success: false, error: err.message };
    }

    try {
      if (typeof vfs.writeText === 'function') {
        await vfs.writeText(normalizedPath, content);
      } else if (typeof vfs.write === 'function') {
        const data = new TextEncoder().encode(content);
        await vfs.write(normalizedPath, data);
      } else {
        return { success: false, error: 'VFS write not supported' };
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * list - 列出目录
   */
  async function list({ path: dirPath }) {
    if (!vfs) {
      return { entries: [], error: 'VFS not available' };
    }

    let normalizedPath;
    try {
      normalizedPath = normalizePath(dirPath);
    } catch (err) {
      return { entries: [], error: err.message };
    }

    try {
      if (typeof vfs.list === 'function') {
        const entries = await vfs.list(normalizedPath);
        return { entries: Array.isArray(entries) ? entries : [] };
      }
      if (typeof vfs.readdir === 'function') {
        const entries = await vfs.readdir(normalizedPath);
        return { entries: Array.isArray(entries) ? entries : [] };
      }

      return { entries: [], error: 'VFS list not supported' };
    } catch (err) {
      return { entries: [], error: err.message };
    }
  }

  /**
   * bash - 浏览器不支持
   */
  const bash = null;

  return {
    glob,
    grep,
    read,
    write,
    list,
    bash,
    platform: 'browser',
  };
}

export default { createBrowserTools };
