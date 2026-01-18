/**
 * Node Platform Tools - Node.js 端工具适配器
 *
 * 基于 node:fs 和 child_process 实现完整文件操作和命令执行。
 */

import { toNonEmptyString } from '../../../shared/utils/value-utils.js';
import { globToRegex } from '../../../shared/utils/safe-regex.js';
import { exec as execCommand } from '../../exec/index.js';

/**
 * @typedef {import('./index.js').PlatformToolsOptions} PlatformToolsOptions
 * @typedef {import('./index.js').PlatformTools} PlatformTools
 */

/**
 * @param {PlatformToolsOptions} options
 * @returns {Promise<PlatformTools>}
 */
export async function createNodeTools(options = {}) {
  const { basePath = process.cwd(), logger } = options;

  // 动态导入 Node 模块
  const fs = await import('node:fs/promises');
  const path = await import('node:path');

  /**
   * 规范化并解析路径
   * @param {string} inputPath
   * @returns {string}
   */
  function resolvePath(inputPath) {
    const p = toNonEmptyString(inputPath) || '.';
    if (path.isAbsolute(p)) return p;
    return path.resolve(basePath, p);
  }

  /**
   * 安全路径检查 (防止路径遍历)
   * @param {string} resolvedPath
   * @returns {boolean}
   */
  function isSafePath(resolvedPath) {
    const normalized = path.normalize(resolvedPath);
    const normalizedBase = path.normalize(basePath);
    // 使用 relative 校验：相对路径不应以 '..' 开头或为绝对路径
    const rel = path.relative(normalizedBase, normalized);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return false;
    }
    return true;
  }

  /**
   * glob - 文件模式匹配
   */
  async function glob({ pattern, path: searchPath }) {
    const dir = resolvePath(searchPath || '.');

    if (!isSafePath(dir)) {
      return { files: [], error: 'Path outside allowed directory' };
    }

    try {
      // 尝试使用 fast-glob (如果可用)
      try {
        const fg = await import('fast-glob');
        const files = await fg.default(pattern, {
          cwd: dir,
          absolute: false,
          onlyFiles: true,
          ignore: ['**/node_modules/**', '**/.git/**'],
        });
        return { files };
      } catch {
        // fast-glob 不可用，使用简易实现
      }

      // 降级：简易递归遍历
      const files = await walkDir(dir, pattern);
      return { files: files.map(f => path.relative(dir, f)) };
    } catch (err) {
      return { files: [], error: err.message };
    }
  }

  /**
   * 简易目录遍历
   */
  async function walkDir(dir, pattern, results = []) {
    const regex = globToRegex(pattern);

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        // 跳过隐藏文件和常见忽略目录
        if (entry.name.startsWith('.') || entry.name === 'node_modules') {
          continue;
        }

        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          await walkDir(fullPath, pattern, results);
        } else if (regex.test(entry.name) || regex.test(fullPath)) {
          results.push(fullPath);
          if (results.length >= 500) break;
        }
      }
    } catch {
      // 目录不存在或无权访问
    }

    return results;
  }

  /**
   * grep - 内容搜索
   */
  async function grep({ pattern, path: searchPath, regex = false, caseSensitive = true }) {
    const dir = resolvePath(searchPath || '.');

    if (!isSafePath(dir)) {
      return { matches: [], error: 'Path outside allowed directory' };
    }

    try {
      // 尝试使用 ripgrep (如果可用)
      const rgArgs = [
        regex ? '-e' : '-F',
        pattern,
        '--line-number',
        '--no-heading',
        '--max-count=100',
        caseSensitive ? '' : '-i',
        dir,
      ].filter(Boolean);

      const rgResult = await execCommand('rg', rgArgs, { timeout: 30000 });
      if (rgResult.success) {
        const matches = parseRgOutput(rgResult.stdout);
        return { matches };
      }

      // ripgrep 不可用，降级到手动搜索
      return await manualGrep(dir, pattern, regex, caseSensitive);
    } catch (err) {
      // 尝试手动搜索
      try {
        return await manualGrep(dir, pattern, regex, caseSensitive);
      } catch (e) {
        return { matches: [], error: e.message };
      }
    }
  }

  /**
   * 解析 ripgrep 输出
   */
  function parseRgOutput(stdout) {
    const lines = stdout.split('\n').filter(Boolean);
    return lines.slice(0, 100).map(line => {
      const match = line.match(/^(.+?):(\d+):(.*)$/);
      if (match) {
        return {
          file: match[1],
          line: parseInt(match[2], 10),
          content: match[3].slice(0, 200),
        };
      }
      return { file: '', line: 0, content: line.slice(0, 200) };
    });
  }

  /**
   * 手动 grep 实现
   */
  async function manualGrep(dir, pattern, isRegex, caseSensitive) {
    const { files } = await glob({ pattern: '**/*', path: dir });
    const matches = [];
    // 不使用 global flag 避免 lastIndex 累积问题
    const searchPattern = isRegex
      ? new RegExp(pattern, caseSensitive ? 'm' : 'im')
      : null;

    for (const file of files.slice(0, 50)) {
      try {
        const fullPath = path.resolve(dir, file);
        const content = await fs.readFile(fullPath, 'utf-8');
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const isMatch = isRegex
            ? searchPattern.test(line)
            : caseSensitive
              ? line.includes(pattern)
              : line.toLowerCase().includes(pattern.toLowerCase());

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
      } catch {
        // 读取失败，跳过
      }
    }

    return { matches };
  }

  /**
   * read - 读取文件
   */
  async function read({ path: filePath, startLine, endLine }) {
    const resolvedPath = resolvePath(filePath);

    if (!isSafePath(resolvedPath)) {
      return { content: '', error: 'Path outside allowed directory' };
    }

    try {
      const content = await fs.readFile(resolvedPath, 'utf-8');

      // 处理行范围
      if (typeof startLine === 'number' || typeof endLine === 'number') {
        const lines = content.split('\n');
        const start = Math.max(0, (startLine || 1) - 1);
        const end = endLine ? Math.min(lines.length, endLine) : lines.length;
        return { content: lines.slice(start, end).join('\n') };
      }

      return { content };
    } catch (err) {
      if (err.code === 'ENOENT') {
        return { content: '', error: 'File not found' };
      }
      return { content: '', error: err.message };
    }
  }

  /**
   * write - 写入文件
   */
  async function write({ path: filePath, content }) {
    const resolvedPath = resolvePath(filePath);

    if (!isSafePath(resolvedPath)) {
      return { success: false, error: 'Path outside allowed directory' };
    }

    try {
      // 确保父目录存在
      const dir = path.dirname(resolvedPath);
      await fs.mkdir(dir, { recursive: true });

      await fs.writeFile(resolvedPath, content, 'utf-8');
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * list - 列出目录
   */
  async function list({ path: dirPath }) {
    const resolvedPath = resolvePath(dirPath);

    if (!isSafePath(resolvedPath)) {
      return { entries: [], error: 'Path outside allowed directory' };
    }

    try {
      const entries = await fs.readdir(resolvedPath);
      return { entries };
    } catch (err) {
      if (err.code === 'ENOENT') {
        return { entries: [], error: 'Directory not found' };
      }
      return { entries: [], error: err.message };
    }
  }

  /**
   * bash - 执行命令
   */
  async function bash({ command, timeout = 60000 }) {
    if (!command) {
      return { stdout: '', stderr: '', exitCode: -1, error: 'Command required' };
    }

    try {
      const result = await execCommand(
        process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
        process.platform === 'win32' ? ['/c', command] : ['-c', command],
        {
          cwd: basePath,
          timeout,
        }
      );

      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        ...(result.error ? { error: result.error } : {}),
      };
    } catch (err) {
      return {
        stdout: '',
        stderr: '',
        exitCode: -1,
        error: err.message,
      };
    }
  }

  // 检测平台类型
  const g = globalThis;
  let platform = 'node';
  if (typeof g.Bun !== 'undefined') platform = 'bun';
  else if (typeof g.Deno !== 'undefined') platform = 'deno';

  return {
    glob,
    grep,
    read,
    write,
    list,
    bash,
    platform,
  };
}

export default { createNodeTools };
