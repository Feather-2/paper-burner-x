/**
 * Bubblewrap 沙箱执行器 (Linux)
 *
 * 使用 Linux namespace 实现进程级隔离：
 * - PID namespace: 独立进程空间
 * - Network namespace: 网络隔离
 * - Mount namespace: 文件系统隔离
 * - User namespace: 用户隔离
 *
 * @module core/sandbox/system/bubblewrap
 */

import { SandboxBackend, DefaultSandboxConfig } from './constants.js';
import { execCommand } from './detect.js';
import { normalizeSandboxPath } from './path-utils.js';

/**
 * Bubblewrap 执行选项
 * @typedef {Object} BubblewrapOptions
 * @property {string} workDir - 工作目录
 * @property {string[]} [allowedReadPaths] - 允许读取的路径
 * @property {string[]} [allowedWritePaths] - 允许写入的路径
 * @property {boolean} [allowNetwork] - 是否允许网络
 * @property {number} [timeoutMs] - 超时
 * @property {Object.<string, string>} [env] - 环境变量
 */

/**
 * 执行结果
 * @typedef {Object} ExecutionResult
 * @property {number} code - 退出码
 * @property {string} stdout - 标准输出
 * @property {string} stderr - 标准错误
 * @property {boolean} killed - 是否被终止
 * @property {string} backend - 使用的后端
 */

/**
 * 在 Bubblewrap 沙箱中执行命令
 * @param {string} command - 要执行的命令
 * @param {string[]} args - 命令参数
 * @param {BubblewrapOptions} options - 执行选项
 * @returns {Promise<ExecutionResult>}
 */
export async function executeInBubblewrap(command, args, options) {
  const {
    workDir,
    allowedReadPaths = DefaultSandboxConfig.allowedReadPaths,
    allowedWritePaths = DefaultSandboxConfig.allowedWritePaths,
    allowNetwork = DefaultSandboxConfig.allowNetwork,
    timeoutMs = DefaultSandboxConfig.timeoutMs,
    env = {},
  } = options;

  if (!workDir) {
    throw new Error('workDir is required for Bubblewrap sandbox');
  }

  const bwrapArgs = buildBubblewrapArgs({
    workDir,
    allowedReadPaths,
    allowedWritePaths,
    allowNetwork,
    command,
    commandArgs: args,
    env,
  });

  const result = await execCommand('bwrap', bwrapArgs, { timeout: timeoutMs });

  return {
    ...result,
    killed: result.code === 137 || result.code === 124,
    backend: SandboxBackend.BUBBLEWRAP,
  };
}

/**
 * 构建 Bubblewrap 参数
 * @param {Object} options
 * @returns {string[]}
 */
function buildBubblewrapArgs(options) {
  const {
    workDir,
    allowedReadPaths,
    allowedWritePaths,
    allowNetwork,
    command,
    commandArgs,
    env,
  } = options;

  const args = [
    // 隔离选项
    '--unshare-all', // 隔离所有 namespace
    '--die-with-parent', // 父进程退出时终止
    '--new-session', // 新会话

    // 基础文件系统
    '--dev', '/dev',
    '--proc', '/proc',
    '--tmpfs', '/tmp',

    // 只读绑定必要目录
    '--ro-bind', '/usr', '/usr',
    '--ro-bind', '/lib', '/lib',
    '--ro-bind', '/bin', '/bin',
  ];

  // 如果存在 /lib64，绑定它
  args.push('--ro-bind-try', '/lib64', '/lib64');

  // /etc 部分文件
  args.push(
    '--ro-bind', '/etc/resolv.conf', '/etc/resolv.conf',
    '--ro-bind-try', '/etc/hosts', '/etc/hosts',
    '--ro-bind-try', '/etc/ssl', '/etc/ssl',
    '--ro-bind-try', '/etc/ca-certificates', '/etc/ca-certificates',
  );

  // 允许读取的路径
  for (const p of allowedReadPaths) {
    if (p.startsWith('/')) {
      args.push('--ro-bind-try', p, p);
    }
  }

  // 工作目录 (可写)
  args.push('--bind', workDir, workDir);
  args.push('--chdir', workDir);

  // 额外的写入路径
  for (const p of allowedWritePaths) {
    const absPath = normalizeSandboxPath(p, workDir);
    if (absPath && absPath !== workDir) {
      args.push('--bind-try', absPath, absPath);
    }
  }

  // 网络隔离
  if (!allowNetwork) {
    args.push('--unshare-net');
  } else {
    args.push('--share-net');
  }

  // 环境变量
  args.push('--clearenv');
  const defaultEnv = {
    PATH: '/usr/local/bin:/usr/bin:/bin',
    HOME: '/tmp',
    LANG: 'C.UTF-8',
    ...env,
  };
  for (const [key, value] of Object.entries(defaultEnv)) {
    args.push('--setenv', key, value);
  }

  // 要执行的命令
  args.push('--', command, ...commandArgs);

  return args;
}

/**
 * 创建 Bubblewrap 执行器实例
 * @param {BubblewrapOptions} defaultOptions - 默认选项
 * @returns {Object}
 */
export function createBubblewrapExecutor(defaultOptions = /** @type {any} */ ({})) {
  return {
    backend: SandboxBackend.BUBBLEWRAP,

    /**
     * 执行命令
     * @param {string} command
     * @param {string[]} args
     * @param {BubblewrapOptions} options
     */
    async execute(command, args = [], options = /** @type {any} */ ({})) {
      return executeInBubblewrap(command, args, { ...defaultOptions, ...options });
    },

    /**
     * 执行 shell 命令
     * @param {string} shellCommand
     * @param {BubblewrapOptions} options
     */
    async shell(shellCommand, options = /** @type {any} */ ({})) {
      return executeInBubblewrap('/bin/sh', ['-c', shellCommand], {
        ...defaultOptions,
        ...options,
      });
    },
  };
}

export default { executeInBubblewrap, createBubblewrapExecutor };
