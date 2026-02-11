/**
 * Bubblewrap 沙箱执行器 (Linux)
 *
 * 使用 Linux namespace 实现进程级隔离：
 * - PID namespace: 独立进程空间（防止沙箱逃逸）
 * - Network namespace: 网络隔离
 * - Mount namespace: 文件系统隔离
 * - User namespace: 用户隔离
 *
 * 安全特性（参考 Anthropic Sandbox Runtime）：
 * - Mandatory deny paths: 自动保护 .bashrc/.gitconfig/.git/hooks 等敏感文件
 * - Symlink 检测: 防止通过符号链接逃逸写保护
 * - PID namespace + /proc: 隔离进程空间，防止信息泄露
 *
 * @module core/sandbox/system/bubblewrap
 */

import { SandboxBackend, DefaultSandboxConfig } from './constants.js';
import { execCommand } from './detect.js';
import { normalizeSandboxPath } from './path-utils.js';
import { existsSync, statSync, lstatSync } from 'node:fs';
import { resolve, join } from 'node:path';

/**
 * Bubblewrap 执行选项
 * @typedef {Object} BubblewrapOptions
 * @property {string} workDir - 工作目录
 * @property {string[]} [allowedReadPaths] - 允许读取的路径
 * @property {string[]} [allowedWritePaths] - 允许写入的路径
 * @property {boolean} [allowNetwork] - 是否允许网络
 * @property {number} [timeoutMs] - 超时
 * @property {Object.<string, string>} [env] - 环境变量
 * @property {string[]} [denyPaths] - 额外的拒绝写入路径
 * @property {boolean} [disableMandatoryDeny] - 禁用自动 mandatory deny paths（默认 false）
 * @property {(info: object) => void} [onViolation] - 违规回调
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
 * Sensitive files that should be read-only inside the sandbox.
 * Inspired by Anthropic Sandbox Runtime mandatory deny paths.
 */
const DANGEROUS_FILES = [
  '.bashrc', '.bash_profile', '.bash_login', '.profile',
  '.zshrc', '.zprofile', '.zlogin',
  '.gitconfig', '.npmrc', '.yarnrc',
  '.env', '.env.local', '.env.production',
];

/**
 * Dangerous directories that should be read-only.
 */
const DANGEROUS_DIRS = ['.ssh', '.gnupg', '.claude'];

/**
 * Get mandatory deny paths for a working directory.
 * These paths are automatically protected even if the user configures broad write access.
 * @param {string} workDir
 * @returns {string[]}
 */
function getMandatoryDenyPaths(workDir) {
  const denyPaths = [];

  // Dangerous files in workDir
  for (const f of DANGEROUS_FILES) {
    denyPaths.push(resolve(workDir, f));
  }

  // Dangerous directories in workDir
  for (const d of DANGEROUS_DIRS) {
    denyPaths.push(resolve(workDir, d));
  }

  // .git/hooks and .git/config — only if .git is a real directory
  // In git worktrees, .git is a file pointing elsewhere, so .git/hooks can never exist
  const dotGitPath = resolve(workDir, '.git');
  try {
    if (statSync(dotGitPath).isDirectory()) {
      denyPaths.push(join(dotGitPath, 'hooks'));
      denyPaths.push(join(dotGitPath, 'config'));
    }
  } catch {
    // .git doesn't exist — skip
  }

  return denyPaths;
}

/**
 * Walk a path from root toward leaf and return the first component that
 * does not exist on disk.  Used to block creation of non-existent deny
 * paths: binding /dev/null at this component prevents mkdir of the
 * entire subtree.
 * @param {string} targetPath - Absolute path to inspect
 * @returns {string|null} First non-existent component, or null if fully exists
 */
function findFirstNonExistentComponent(targetPath) {
  const parts = targetPath.split('/');
  let current = '';
  for (const part of parts) {
    if (!part) continue;
    current += '/' + part;
    if (!existsSync(current)) return current;
  }
  return null;
}

/**
 * Check if a path component is a symlink within allowed write paths.
 * Prevents symlink replacement attacks.
 * @param {string} targetPath
 * @param {string[]} allowedWritePaths
 * @returns {string|null} The symlink path if found
 */
function findSymlinkInPath(targetPath, allowedWritePaths) {
  const parts = targetPath.split('/');
  let currentPath = '';

  for (const part of parts) {
    if (!part) continue;
    const nextPath = currentPath + '/' + part;
    try {
      const stats = lstatSync(nextPath);
      if (stats.isSymbolicLink()) {
        const isWithinAllowed = allowedWritePaths.some(
          ap => nextPath.startsWith(ap + '/') || nextPath === ap,
        );
        if (isWithinAllowed) return nextPath;
      }
    } catch {
      break;
    }
    currentPath = nextPath;
  }
  return null;
}

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
    denyPaths: options.denyPaths,
    disableMandatoryDeny: options.disableMandatoryDeny,
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
    denyPaths = [],
    disableMandatoryDeny = false,
  } = options;

  const args = [
    // 隔离选项
    '--unshare-all', // 隔离所有 namespace
    '--die-with-parent', // 父进程退出时终止
    '--new-session', // 新会话

    // PID namespace + /proc (防止沙箱逃逸和信息泄露)
    '--unshare-pid',
    '--proc', '/proc',

    // 基础文件系统
    '--dev', '/dev',
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

  // Mandatory deny paths — 自动保护敏感文件/目录（参考 ASRT）
  const allDenyPaths = [...(denyPaths || [])];
  if (!disableMandatoryDeny) {
    allDenyPaths.push(...getMandatoryDenyPaths(workDir));
  }
  const resolvedWritePaths = [workDir, ...allowedWritePaths.map(p => normalizeSandboxPath(p, workDir)).filter(Boolean)];
  for (const dp of [...new Set(allDenyPaths)]) {
    // Symlink 攻击检测
    const symlink = findSymlinkInPath(dp, resolvedWritePaths);
    if (symlink) {
      args.push('--ro-bind', '/dev/null', symlink);
      continue;
    }
    if (existsSync(dp)) {
      args.push('--ro-bind', dp, dp);
    } else {
      // Non-existent deny path: block creation via --ro-bind /dev/null
      // at the first missing path component (prevents mkdir subtree).
      const missing = findFirstNonExistentComponent(dp);
      if (missing) {
        args.push('--ro-bind', '/dev/null', missing);
      }
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
export function createBubblewrapExecutor(defaultOptions = /** @type {BubblewrapOptions} */ ({})) {
  return {
    backend: SandboxBackend.BUBBLEWRAP,

    /**
     * 执行命令
     * @param {string} command
     * @param {string[]} args
     * @param {BubblewrapOptions} options
     */
    async execute(command, args = [], options = /** @type {BubblewrapOptions} */ ({})) {
      return executeInBubblewrap(command, args, { ...defaultOptions, ...options });
    },

    /**
     * 执行 shell 命令
     * @param {string} shellCommand
     * @param {BubblewrapOptions} options
     */
    async shell(shellCommand, options = /** @type {BubblewrapOptions} */ ({})) {
      return executeInBubblewrap('/bin/sh', ['-c', shellCommand], {
        ...defaultOptions,
        ...options,
      });
    },
  };
}

export default { executeInBubblewrap, createBubblewrapExecutor };
