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
import { existsSync, statSync, lstatSync, unlinkSync, rmdirSync } from 'node:fs';
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
 * @property {SeccompConfig} [seccomp] - Seccomp BPF 二阶段配置
 * @property {NetworkProxyConfig} [networkProxy] - 网络代理配置（代理桥接模式）
 */

/**
 * 网络代理配置 — 启用后 bwrap 使用 --unshare-net + Unix socket 桥接
 * @typedef {object} NetworkProxyConfig
 * @property {string} httpSocketPath - 宿主侧 HTTP 代理 Unix socket 路径
 */

/**
 * Seccomp BPF 配置
 * @typedef {object} SeccompConfig
 * @property {boolean} [enabled=false]
 * @property {string} [bpfPath] - 预编译 BPF 过滤器路径
 * @property {string} [applySeccompPath] - apply-seccomp 二进制路径
 * @property {'x64'|'arm64'} [arch] - 目标架构
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
 * Find a seccomp binary (BPF filter or apply-seccomp launcher).
 * Search priority: user config → vendor/seccomp/{arch}/ → global npm.
 * @param {'bpf'|'apply-seccomp'} type
 * @param {'x64'|'arm64'} [arch]
 * @param {SeccompConfig} [config]
 * @returns {string|null}
 */
export function findSeccompBinary(type, arch, config) {
  const filename = type === 'bpf' ? 'seccomp-bpf.bin' : 'apply-seccomp';

  // 1. User-specified path
  if (config) {
    const explicit = type === 'bpf' ? config.bpfPath : config.applySeccompPath;
    if (explicit && existsSync(explicit)) return explicit;
  }

  const resolvedArch = arch || (process ? (process.arch === 'arm64' ? 'arm64' : 'x64') : 'x64');

  // 2. Project-local vendor/seccomp/{arch}/
  const vendorPath = resolve('vendor', 'seccomp', resolvedArch, filename);
  if (existsSync(vendorPath)) return vendorPath;

  // 3. Global npm prefix
  if (typeof process !== 'undefined' && process.env) {
    const npmPrefix = process.env.NPM_GLOBAL_PREFIX || '/usr/local/lib/node_modules';
    const globalPath = join(npmPrefix, 'paper-burner', 'vendor', 'seccomp', resolvedArch, filename);
    if (existsSync(globalPath)) return globalPath;
  }

  return null;
}

/**
 * Generate a two-stage seccomp command string.
 * Stage 1: bwrap sets up namespaces normally.
 * Stage 2: apply-seccomp loads BPF filter, then exec's the user command.
 * @param {string[]} userCmd - [command, ...args]
 * @param {SeccompConfig} config
 * @returns {{ applySeccompPath: string, bpfPath: string, wrappedCmd: string[] }}
 */
export function generateSeccompCommand(userCmd, config) {
  const arch = config.arch || 'x64';
  const bpfPath = findSeccompBinary('bpf', arch, config);
  const applyPath = findSeccompBinary('apply-seccomp', arch, config);

  if (!bpfPath) throw new Error(`Seccomp BPF filter not found for arch ${arch}`);
  if (!applyPath) throw new Error(`apply-seccomp binary not found for arch ${arch}`);

  return {
    applySeccompPath: applyPath,
    bpfPath,
    wrappedCmd: [applyPath, bpfPath, '--', ...userCmd],
  };
}

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
 * Clean up empty files/directories created by bwrap mount points.
 * bwrap creates empty files/dirs at mount destinations that don't exist.
 * These should be cleaned up after execution.
 * 参考 ASRT linux-sandbox-utils.ts:330-357
 * @param {string} workDir
 * @param {string[]} denyPaths - deny paths that may have created mount artifacts
 */
function cleanupBwrapMountPoints(workDir, denyPaths) {
  for (const dp of denyPaths) {
    // Only clean up paths within workDir
    if (!dp.startsWith(workDir + '/') && dp !== workDir) continue;
    try {
      const stats = lstatSync(dp);
      // Remove empty files created by --ro-bind /dev/null
      if (stats.isFile() && stats.size === 0) {
        try { unlinkSync(dp); } catch { /* ok */ }
      }
      // Remove empty directories created by bwrap
      if (stats.isDirectory()) {
        try { rmdirSync(dp); } catch { /* non-empty, skip */ }
      }
    } catch {
      // doesn't exist, nothing to clean
    }
  }
}

/**
 * Annotate stderr with sandbox failure hints.
 * 参考 ASRT annotateStderrWithSandboxFailures
 * @param {string} stderr
 * @param {number} exitCode
 * @returns {string}
 */
function annotateStderr(stderr, exitCode) {
  const hints = [];
  if (exitCode === 137) hints.push('[sandbox] Process killed (OOM or timeout)');
  if (exitCode === 124) hints.push('[sandbox] Command timed out');
  if (stderr?.includes('Operation not permitted')) {
    hints.push('[sandbox] Operation blocked by sandbox policy — check allowedWritePaths or network settings');
  }
  if (stderr?.includes('Permission denied')) {
    hints.push('[sandbox] Permission denied — path may be in mandatory deny list');
  }
  if (!hints.length) return stderr;
  return `${stderr}\n${hints.join('\n')}`;
}

/**
 * Build read-only mount plan.
 *
 * Semantics:
 * - `allowedReadPaths` empty: backward-compatible full read-only root (`--ro-bind / /`)
 * - `allowedReadPaths` includes `/`: full read-only root
 * - otherwise: explicit read whitelist (plus minimal runtime system paths)
 *
 * @param {string} workDir
 * @param {string[]} allowedReadPaths
 * @returns {{ bindReadonlyRoot: boolean, readOnlyPaths: string[] }}
 */
function buildReadOnlyMountPlan(workDir, allowedReadPaths) {
  const normalizedAllowed = Array.isArray(allowedReadPaths)
    ? allowedReadPaths
      .map((path) => normalizeSandboxPath(path, workDir))
      .filter(Boolean)
    : [];

  const bindReadonlyRoot = normalizedAllowed.length === 0 || normalizedAllowed.includes('/');
  if (bindReadonlyRoot) {
    return { bindReadonlyRoot: true, readOnlyPaths: [] };
  }

  const minimalSystemReadPaths = ['/usr', '/lib', '/lib64', '/bin', '/sbin', '/etc', '/opt'];
  const readOnlyPaths = [...new Set([
    ...minimalSystemReadPaths,
    ...normalizedAllowed,
    workDir,
  ])];
  return { bindReadonlyRoot: false, readOnlyPaths };
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
    seccomp: options.seccomp,
    networkProxy: options.networkProxy,
  });

  const result = await execCommand('bwrap', bwrapArgs, { timeout: timeoutMs });

  // 清理 bwrap 创建的 mount point 残留（参考 ASRT cleanupBwrapMountPoints）
  const allDenyPaths = [...(options.denyPaths || [])];
  if (!options.disableMandatoryDeny) {
    allDenyPaths.push(...getMandatoryDenyPaths(workDir));
  }
  cleanupBwrapMountPoints(workDir, allDenyPaths);

  // 如果命令失败且有 onViolation 回调，注入违规信息到 stderr
  const stderr = result.code !== 0 && options.onViolation
    ? annotateStderr(result.stderr, result.code)
    : result.stderr;

  return {
    ...result,
    stderr,
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
    seccomp,
    networkProxy,
  } = options;

  const args = [
    // 隔离选项
    '--unshare-all', // 隔离所有 namespace
    '--die-with-parent', // 父进程退出时终止
    '--new-session', // 新会话

    // PID namespace + /proc (防止沙箱逃逸和信息泄露)
    '--unshare-pid',
    '--proc', '/proc',

    // 覆盖 /dev 和 /tmp（需要可写）
    '--dev', '/dev',
    '--tmpfs', '/tmp',
  ];

  const { bindReadonlyRoot, readOnlyPaths } = buildReadOnlyMountPlan(workDir, allowedReadPaths);
  if (bindReadonlyRoot) {
    // 全局只读根 — 比逐个挂载更安全（不会遗漏路径）
    // 参考 ASRT linux-sandbox-utils.ts:647
    args.push('--ro-bind', '/', '/');
  } else {
    // 显式只读白名单（当 allowedReadPaths 提供具体路径时）
    for (const readPath of readOnlyPaths) {
      if (!readPath || readPath === workDir) continue;
      args.push('--ro-bind-try', readPath, readPath);
    }
  }

  // 工作目录 (可写) — 覆盖全局只读根中的对应路径
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
  if (networkProxy?.httpSocketPath) {
    // 代理桥接模式：隔离网络 + 绑定 Unix socket 进沙箱
    args.push('--unshare-net');
    args.push('--bind', networkProxy.httpSocketPath, networkProxy.httpSocketPath);
  } else if (!allowNetwork) {
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

  // 要执行的命令 (seccomp 二阶段: bwrap -- apply-seccomp <bpf> -- <cmd>)
  // 代理桥接模式：包装用户命令，在沙箱内启动 socat → Unix socket
  let finalCommand = command;
  let finalArgs = commandArgs;

  if (networkProxy?.httpSocketPath) {
    // 将用户命令包装为 shell 脚本：socat 桥接 + 代理环境变量 + 用户命令
    const userCmd = [command, ...commandArgs].map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ');
    const bridgedScript = [
      `socat TCP-LISTEN:3128,fork,reuseaddr UNIX-CONNECT:${networkProxy.httpSocketPath} &`,
      'SOCAT_PID=$!',
      'trap "kill $SOCAT_PID 2>/dev/null" EXIT',
      'export http_proxy=http://127.0.0.1:3128',
      'export https_proxy=http://127.0.0.1:3128',
      'export HTTP_PROXY=http://127.0.0.1:3128',
      'export HTTPS_PROXY=http://127.0.0.1:3128',
      'sleep 0.1',
      userCmd,
    ].join('; ');
    finalCommand = '/bin/sh';
    finalArgs = ['-c', bridgedScript];
  }

  if (seccomp?.enabled) {
    const { wrappedCmd } = generateSeccompCommand([finalCommand, ...finalArgs], seccomp);
    args.push('--', ...wrappedCmd);
  } else {
    args.push('--', finalCommand, ...finalArgs);
  }

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

export default { executeInBubblewrap, createBubblewrapExecutor, findSeccompBinary, generateSeccompCommand };
