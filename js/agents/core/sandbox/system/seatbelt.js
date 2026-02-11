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
import { statSync } from 'node:fs';
import { resolve, join } from 'node:path';

/**
 * Default mach-lookup service whitelist.
 * Covers essential macOS services required for process execution.
 */
const DEFAULT_MACH_SERVICES = [
  'com.apple.SecurityServer',
  'com.apple.lsd.mapdb',
  'com.apple.system.opendirectoryd.membership',
  'com.apple.CoreServices.coreservicesd',
  'com.apple.DiskArbitration.diskarbitrationd',
  'com.apple.FileCoordination',
  'com.apple.FSEvents',
  'com.apple.distributed_notifications@Uid',
  'com.apple.coreservices.launchservicesd',
  'com.apple.system.notification_center',
  'com.apple.logd',
  'com.apple.cfprefsd.daemon',
  'com.apple.cfprefsd.agent',
];

/** Regex patterns for mach-lookup whitelist. */
const DEFAULT_MACH_REGEX_PATTERNS = [
  '#"^com\\.apple\\.sandbox\\."',
];

/**
 * Default sysctl-read whitelist.
 * Covers hardware/kernel introspection needed by runtimes.
 */
const DEFAULT_SYSCTL_NAMES = [
  'hw.memsize',
  'hw.ncpu',
  'hw.logicalcpu',
  'hw.physicalcpu',
  'hw.pagesize',
  'kern.ostype',
  'kern.osrelease',
  'kern.hostname',
  'kern.version',
];

/** Sysctl prefix whitelist. */
const DEFAULT_SYSCTL_PREFIXES = [
  'hw.',
  'kern.',
  'sysctl.',
  'net.',
];

/** System directories protected from file-write-unlink. */
const UNLINK_DENY_PATHS = [
  '/etc',
  '/usr',
  '/System',
];

/**
 * Sensitive files that should be deny-write inside the sandbox.
 * Inspired by Anthropic Sandbox Runtime mandatory deny paths.
 */
const DANGEROUS_FILES = [
  '.bashrc', '.bash_profile', '.profile',
  '.zshrc', '.gitconfig', '.npmrc', '.yarnrc',
  '.env', '.env.local', '.env.production',
];

/**
 * Dangerous directories that should be deny-write.
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

  for (const f of DANGEROUS_FILES) {
    denyPaths.push(resolve(workDir, f));
  }

  for (const d of DANGEROUS_DIRS) {
    denyPaths.push(resolve(workDir, d));
  }

  // .git/hooks and .git/config — only if .git is a real directory
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
 * Seatbelt 执行选项
 * @typedef {Object} SeatbeltOptions
 * @property {string} workDir - 工作目录
 * @property {string[]} [allowedReadPaths] - 允许读取的路径
 * @property {string[]} [allowedWritePaths] - 允许写入的路径
 * @property {boolean} [allowNetwork] - 是否允许网络
 * @property {number} [timeoutMs] - 超时
 * @property {Object.<string, string>} [env] - 环境变量
 * @property {string[]} [denyPaths] - 额外的拒绝写入路径
 * @property {boolean} [disableMandatoryDeny] - 禁用自动 mandatory deny paths（默认 false）
 * @property {string[]} [extraMachServices] - 额外的 mach-lookup 服务白名单
 * @property {string[]} [extraSysctlNames] - 额外的 sysctl-read 名称白名单
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

  const denyPaths = options.denyPaths || [];
  const disableMandatoryDeny = options.disableMandatoryDeny || false;

  // 生成 SBPL profile
  const profile = generateSBPLProfile({
    workDir,
    allowedReadPaths,
    allowedWritePaths,
    allowNetwork,
    denyPaths,
    disableMandatoryDeny,
    extraMachServices: options.extraMachServices,
    extraSysctlNames: options.extraSysctlNames,
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
  const {
    workDir, allowedReadPaths, allowedWritePaths, allowNetwork,
    denyPaths = [], disableMandatoryDeny = false,
  } = options;

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
    '',
    '; sysctl 精细白名单',
    '(allow sysctl-read',
    ...DEFAULT_SYSCTL_NAMES.map(n => `  (sysctl-name "${n}")`),
    ...DEFAULT_SYSCTL_PREFIXES.map(p => `  (sysctl-name-prefix "${p}")`),
    ...(options.extraSysctlNames || []).filter(n => typeof n === 'string' && n.length > 0).map(n => `  (sysctl-name "${n}")`),
    ')',
    '',
    '; mach-lookup 精细白名单',
    '(allow mach-lookup',
    ...DEFAULT_MACH_SERVICES.map(s => `  (global-name "${s}")`),
    ...DEFAULT_MACH_REGEX_PATTERNS.map(r => `  (global-name-regex ${r})`),
    ...(options.extraMachServices || []).filter(s => typeof s === 'string' && s.length > 0).map(s => `  (global-name "${s}")`),
    ')',
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

  // Mandatory deny paths — 覆盖上面的 allow，SBPL 后出现的 deny 优先
  const allDenyPaths = [...denyPaths];
  if (!disableMandatoryDeny) {
    allDenyPaths.push(...getMandatoryDenyPaths(workDir));
  }
  if (allDenyPaths.length > 0) {
    lines.push('');
    lines.push('; 拒绝写入敏感路径 (mandatory deny)');
    for (const dp of allDenyPaths) {
      if (!isSafeForSBPL(dp)) continue;
      const escaped = escapeForSBPL(dp);
      // 目录用 subpath，文件用 literal
      const isDirPath = DANGEROUS_DIRS.some(d => dp.endsWith('/' + d))
        || dp.endsWith('/hooks') || dp.endsWith('/hooks/');
      if (isDirPath) {
        lines.push(`(deny file-write* (subpath "${escaped}"))`);
      } else {
        lines.push(`(deny file-write* (literal "${escaped}"))`);
      }
    }
  }

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

  // 防止通过 rename/unlink 绕过只读限制
  lines.push('');
  lines.push('; 禁止对系统目录 unlink');
  for (const up of UNLINK_DENY_PATHS) {
    lines.push(`(deny file-write-unlink (subpath "${up}"))`);
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
 * @param {Partial<SeatbeltOptions>} [defaultOptions]
 * @returns {Object}
 */
export function createSeatbeltExecutor(defaultOptions = /** @type {Partial<SeatbeltOptions>} */ ({})) {
  return {
    backend: SandboxBackend.SEATBELT,

    async execute(command, args = [], options = {}) {
      return executeInSeatbelt(command, args, /** @type {SeatbeltOptions} */ ({ ...defaultOptions, ...options }));
    },

    async shell(shellCommand, options = {}) {
      return executeInSeatbelt(
        '/bin/sh',
        ['-c', shellCommand],
        /** @type {SeatbeltOptions} */ ({ ...defaultOptions, ...options })
      );
    },
  };
}

export default { executeInSeatbelt, createSeatbeltExecutor };
