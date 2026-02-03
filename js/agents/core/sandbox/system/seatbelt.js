/**
 * Seatbelt 沙箱执行器 (macOS)
 *
 * 使用 macOS 内置的 sandbox-exec 实现应用级隔离。
 * 通过 SBPL (Sandbox Profile Language) 定义权限策略。
 *
 * @module core/sandbox/system/seatbelt
 */

import { SandboxBackend, DefaultSandboxConfig } from './constants.js';
import { execCommand } from './detect.js';
import { normalizeSandboxPath, isSafeForSBPL } from './path-utils.js';

/**
 * Seatbelt 执行选项
 * @typedef {Object} SeatbeltOptions
 * @property {string} workDir - 工作目录
 * @property {string[]} [allowedReadPaths] - 允许读取的路径
 * @property {string[]} [allowedWritePaths] - 允许写入的路径
 * @property {boolean} [allowNetwork] - 是否允许网络
 * @property {number} [timeoutMs] - 超时
 * @property {Object.<string, string>} [env] - 环境变量
 */

/**
 * 在 Seatbelt 沙箱中执行命令
 * @param {string} command - 要执行的命令
 * @param {string[]} args - 命令参数
 * @param {SeatbeltOptions} options - 执行选项
 * @returns {Promise<import('./bubblewrap.js').ExecutionResult>}
 */
export async function executeInSeatbelt(command, args, options) {
  const {
    workDir,
    allowedReadPaths = DefaultSandboxConfig.allowedReadPaths,
    allowedWritePaths = DefaultSandboxConfig.allowedWritePaths,
    allowNetwork = DefaultSandboxConfig.allowNetwork,
    timeoutMs = DefaultSandboxConfig.timeoutMs,
  } = options;

  if (!workDir) {
    throw new Error('workDir is required for Seatbelt sandbox');
  }

  // 生成 SBPL profile
  const profile = generateSBPLProfile({
    workDir,
    allowedReadPaths,
    allowedWritePaths,
    allowNetwork,
  });

  // sandbox-exec -p <profile> <command> [args...]
  const sandboxArgs = ['-p', profile, command, ...args];

  const result = await execCommand('sandbox-exec', sandboxArgs, { timeout: timeoutMs });

  return {
    ...result,
    killed: result.code === 137 || result.code === 124,
    backend: SandboxBackend.SEATBELT,
  };
}

/**
 * 生成 SBPL (Sandbox Profile Language) 配置
 * @param {Object} options
 * @returns {string}
 */
function generateSBPLProfile(options) {
  const { workDir, allowedReadPaths, allowedWritePaths, allowNetwork } = options;

  const lines = [
    '(version 1)',
    '',
    '; 默认拒绝所有操作',
    '(deny default)',
    '',
    '; 允许基础进程操作',
    '(allow process-fork)',
    '(allow process-exec)',
    '(allow signal)',
    '(allow sysctl-read)',
    '',
    '; 允许 mach 服务 (必要的系统调用)',
    '(allow mach-lookup)',
    '',
    '; 允许读取系统库',
    '(allow file-read*',
    '  (subpath "/usr/lib")',
    '  (subpath "/usr/share")',
    '  (subpath "/System/Library")',
    '  (subpath "/Library/Frameworks")',
    '  (subpath "/private/var/db/dyld")',
    '  (literal "/dev/null")',
    '  (literal "/dev/random")',
    '  (literal "/dev/urandom")',
    ')',
    '',
    '; 允许读取可执行文件',
    '(allow file-read*',
    '  (subpath "/usr/bin")',
    '  (subpath "/usr/local/bin")',
    '  (subpath "/bin")',
    '  (subpath "/sbin")',
    ')',
  ];

  // 工作目录可读写
  if (!isSafeForSBPL(workDir)) {
    throw new Error('workDir contains unsafe characters for SBPL profile');
  }
  lines.push('');
  lines.push('; 工作目录权限');
  lines.push(`(allow file-read* (subpath "${escapeForSBPL(workDir)}"))`);
  lines.push(`(allow file-write* (subpath "${escapeForSBPL(workDir)}"))`);

  // 额外的读取路径
  if (allowedReadPaths.length > 0) {
    lines.push('');
    lines.push('; 额外读取路径');
    for (const p of allowedReadPaths) {
      if (p.startsWith('/') && isSafeForSBPL(p)) {
        lines.push(`(allow file-read* (subpath "${escapeForSBPL(p)}"))`);
      }
    }
  }

  // 额外的写入路径
  if (allowedWritePaths.length > 0) {
    lines.push('');
    lines.push('; 额外写入路径');
    for (const p of allowedWritePaths) {
      const absPath = normalizeSandboxPath(p, workDir);
      if (absPath && isSafeForSBPL(absPath)) {
        lines.push(`(allow file-write* (subpath "${escapeForSBPL(absPath)}"))`);
      }
    }
  }

  // 网络权限
  lines.push('');
  if (allowNetwork) {
    lines.push('; 允许网络');
    lines.push('(allow network*)');
  } else {
    lines.push('; 网络已禁用');
    lines.push('(deny network*)');
  }

  // 临时文件
  lines.push('');
  lines.push('; 临时文件');
  lines.push('(allow file-read* (subpath "/private/tmp"))');
  lines.push('(allow file-write* (subpath "/private/tmp"))');
  lines.push('(allow file-read* (subpath "/var/folders"))');
  lines.push('(allow file-write* (subpath "/var/folders"))');

  return lines.join('\n');
}

/**
 * 转义 SBPL 字符串
 * @param {string} str
 * @returns {string}
 */
function escapeForSBPL(str) {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * 创建 Seatbelt 执行器实例
 * @param {SeatbeltOptions} defaultOptions
 * @returns {Object}
 */
export function createSeatbeltExecutor(defaultOptions = /** @type {any} */ ({})) {
  return {
    backend: SandboxBackend.SEATBELT,

    async execute(command, args = [], options = {}) {
      return executeInSeatbelt(command, args, { ...defaultOptions, ...options });
    },

    async shell(shellCommand, options = {}) {
      return executeInSeatbelt('/bin/sh', ['-c', shellCommand], {
        ...defaultOptions,
        ...options,
      });
    },
  };
}

export default { executeInSeatbelt, createSeatbeltExecutor };
