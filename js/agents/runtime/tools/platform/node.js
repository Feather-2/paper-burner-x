/**
 * Node Platform Tools - Node.js 端工具适配器
 *
 * 基于 node:fs 和 child_process 实现完整文件操作和命令执行。
 */

import { toNonEmptyString } from '../../../shared/index.js';
import { globToRegex } from '../../../shared/index.js';
import { exec as execCommand } from '../../core/exec/index.js';

/**
 * @typedef {import('./index.js').PlatformToolsOptions} PlatformToolsOptions
 * @typedef {import('./index.js').PlatformTools} PlatformTools
 */

/**
 * Minimal globalThis shape used by this module.
 * (Avoids a hard dependency on @types/node for browser builds.)
 * @typedef {object} GlobalLike
 * @property {{ cwd?: () => string }=} process
 * @property {unknown=} Bun
 * @property {unknown=} Deno
 */

/**
 * @param {PlatformToolsOptions} options
 * @returns {Promise<PlatformTools>}
 */
export async function createNodeTools(options = {}) {
  const g = /** @type {GlobalLike} */ (globalThis);
  const defaultBasePath = typeof g.process?.cwd === 'function' ? g.process.cwd() : '.';

  const {
    basePath = defaultBasePath,
    logger,
    allowedCommands: configuredAllowedCommands,
    maxTimeoutMs: configuredMaxTimeoutMs,
  } = options;

  // 动态导入 Node 模块
  // @ts-ignore
  const fs = await import('node:fs/promises');
  // @ts-ignore
  const path = await import('node:path');
  const baseRealPath = await fs.realpath(basePath).catch(() => path.resolve(basePath));
  const basePrefix = baseRealPath.endsWith(path.sep) ? baseRealPath : `${baseRealPath}${path.sep}`;
  const allowedCommands = Array.isArray(configuredAllowedCommands)
    ? configuredAllowedCommands.filter(cmd => typeof cmd === 'string' && cmd.trim())
    : [];
  const allowedCommandSet = new Set(allowedCommands);
  const maxTimeoutMs = Number.isFinite(configuredMaxTimeoutMs)
    ? Math.max(1, configuredMaxTimeoutMs)
    : 60000;

  /**
   * 规范化并解析路径
   * @param {string} inputPath
   * @returns {string}
   */
  function resolvePath(inputPath) {
    const p = toNonEmptyString(inputPath) || '.';
    if (hasPathTraversal(p)) {
      throw new Error('Path traversal detected');
    }
    if (path.isAbsolute(p)) return p;
    return path.resolve(basePath, p);
  }

  /**
   * 安全路径检查 (防止路径遍历)
   * @param {string} resolvedPath
   * @param {{ allowMissing?: boolean }} [options]
   * @returns {Promise<boolean>}
   */
  async function isSafePath(resolvedPath, options = {}) {
    let targetRealPath;

    try {
      targetRealPath = await fs.realpath(resolvedPath);
    } catch (err) {
      if (!options.allowMissing || err.code !== 'ENOENT') {
        return false;
      }

      try {
        targetRealPath = await realpathExistingAncestor(path.dirname(resolvedPath));
      } catch {
        return false;
      }
    }

    if (targetRealPath === baseRealPath) return true;
    return targetRealPath.startsWith(basePrefix);
  }

  /**
   * 检查路径是否包含父级遍历
   * @param {string} inputPath
   * @returns {boolean}
   */
  function hasPathTraversal(inputPath) {
    return inputPath.split(/[\\/]/).some(part => part === '..');
  }

  /**
   * 获取已存在的父级 realpath
   * @param {string} targetPath
   * @returns {Promise<string>}
   */
  async function realpathExistingAncestor(targetPath) {
    let current = targetPath;

    while (true) {
      try {
        return await fs.realpath(current);
      } catch (err) {
        if (err.code !== 'ENOENT') {
          throw err;
        }
        const parent = path.dirname(current);
        if (parent === current) {
          throw err;
        }
        current = parent;
      }
    }
  }

  /**
   * 解析命令字符串为可执行命令和参数
   * @param {string} input
   * @returns {{ command?: string, args?: string[], error?: string }}
   */
  function parseCommandInput(input) {
    if (typeof input !== 'string' || !input.trim()) {
      return { error: 'Command required' };
    }

    const tokens = [];
    let current = '';
    let quote = null;

    for (let i = 0; i < input.length; i++) {
      const char = input[i];
      if (quote) {
        if (char === quote) {
          quote = null;
        } else if (char === '\\' && quote === '"' && i + 1 < input.length) {
          current += input[i + 1];
          i += 1;
        } else {
          current += char;
        }
      } else if (char === '"' || char === '\'') {
        quote = char;
      } else if (/\s/.test(char)) {
        if (current) {
          tokens.push(current);
          current = '';
        }
      } else {
        current += char;
      }
    }

    if (quote) {
      return { error: 'Unclosed quote in command' };
    }

    if (current) {
      tokens.push(current);
    }

    if (!tokens.length) {
      return { error: 'Command required' };
    }

    return { command: tokens[0], args: tokens.slice(1) };
  }

  /**
   * 判断命令是否在允许列表中
   * @param {string} command
   * @returns {boolean}
   */
  function isCommandAllowed(command) {
    // Empty allowlist means no commands are allowed (fail-close)
    if (allowedCommandSet.size === 0) return false;
    return allowedCommandSet.has(command);
  }

  /**
   * glob - 文件模式匹配
   */
  async function glob({ pattern, path: searchPath }) {
    const patternValue = toNonEmptyString(pattern) || '';
    if (hasPathTraversal(patternValue)) {
      return { files: [], error: 'Path traversal detected' };
    }

    let dir;
    try {
      dir = resolvePath(searchPath || '.');
    } catch (err) {
      return { files: [], error: err.message };
    }

    if (!await isSafePath(dir, { allowMissing: true })) {
      return { files: [], error: 'Path outside allowed directory' };
    }

    try {
      // 尝试使用 fast-glob (如果可用)
      try {
        // @ts-ignore
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
    let dir;
    try {
      dir = resolvePath(searchPath || '.');
    } catch (err) {
      return { matches: [], error: err.message };
    }

    if (!await isSafePath(dir, { allowMissing: true })) {
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
    let resolvedPath;
    try {
      resolvedPath = resolvePath(filePath);
    } catch (err) {
      return { content: '', error: err.message };
    }

    if (!await isSafePath(resolvedPath, { allowMissing: true })) {
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
    let resolvedPath;
    try {
      resolvedPath = resolvePath(filePath);
    } catch (err) {
      return { success: false, error: err.message };
    }

    if (!await isSafePath(resolvedPath, { allowMissing: true })) {
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
    let resolvedPath;
    try {
      resolvedPath = resolvePath(dirPath);
    } catch (err) {
      return { entries: [], error: err.message };
    }

    if (!await isSafePath(resolvedPath, { allowMissing: true })) {
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
    const parsed = parseCommandInput(command);
    if (parsed.error || !parsed.command || !parsed.args) {
      return { stdout: '', stderr: '', exitCode: -1, error: parsed.error || 'Command required' };
    }

    if (!isCommandAllowed(parsed.command)) {
      logger?.warn?.('[platform/node] bash blocked by allowlist', { command: parsed.command });
      return { stdout: '', stderr: '', exitCode: -1, error: 'Command not allowed' };
    }

    const timeoutMs = Math.min(
      Math.max(1, Number.isFinite(timeout) ? timeout : maxTimeoutMs),
      maxTimeoutMs
    );

    try {
      const result = await execCommand(
        parsed.command,
        parsed.args,
        {
          cwd: basePath,
          timeout: timeoutMs,
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
