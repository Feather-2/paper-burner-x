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
import { statSync, mkdtempSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
 * @property {number} [profileInlineThresholdBytes] - 使用 `-p` 内联 profile 的长度阈值，超过则写临时文件走 `-f`
 * @property {string} [profileTempDir] - profile 临时文件目录
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

  // 生成唯一日志标签用于违规追踪
  const cmdBase64 = Buffer.from([command, ...args].join(' ')).toString('base64').slice(0, 40);
  const logTag = `PB_${cmdBase64}_${Date.now().toString(36)}`;

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
    logTag,
  });

  const threshold = Number.isFinite(options.profileInlineThresholdBytes)
    ? Math.max(0, Math.floor(options.profileInlineThresholdBytes))
    : 64 * 1024;
  const preferProfileFile = profile.length > threshold;

  /** @type {string | null} */
  let profileTempPath = null;
  /** @type {string[] | null} */
  let sandboxArgs = null;

  if (preferProfileFile) {
    const parentDir = typeof options.profileTempDir === 'string' && options.profileTempDir
      ? options.profileTempDir
      : tmpdir();
    const tempDir = mkdtempSync(join(parentDir, 'pb-seatbelt-'));
    profileTempPath = join(tempDir, 'sandbox.sb');
    writeFileSync(profileTempPath, profile, 'utf8');
    sandboxArgs = ['-f', profileTempPath, command, ...args];
  } else {
    // sandbox-exec -p <profile> <command> [args...]
    sandboxArgs = ['-p', profile, command, ...args];
  }

  let result;
  try {
    result = await execCommand('sandbox-exec', sandboxArgs, { timeout: timeoutMs });
  } finally {
    if (profileTempPath) {
      try {
        rmSync(profileTempPath, { force: true });
      } catch {
        // ignore cleanup failures
      }
      try {
        rmSync(resolve(profileTempPath, '..'), { recursive: true, force: true });
      } catch {
        // ignore cleanup failures
      }
    }
  }

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
    logTag,
  } = options;

  // 日志标签 — 让违规可追溯到具体命令（参考 ASRT macos-sandbox-utils.ts:84-93）
  const denyDefault = logTag
    ? `(deny default (with message "${logTag}"))`
    : '(deny default)';

  const lines = [
    '(version 1)',
    '',
    '; 默认拒绝所有操作（带日志标签用于违规追踪）',
    denyDefault,
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
      const absPath = normalizeSandboxPath(p, workDir, {
        allowAbsolute: true,
        resolveSymlinks: true,
        realpath: realpathSync,
      });
      if (absPath && isSafeForSBPL(absPath)) {
        lines.push(`(allow file-read* (subpath "${escapeForSBPL(absPath)}"))`);
      }
    }
  }

  // 额外的写入路径
  if (allowedWritePaths.length > 0) {
    lines.push('');
    lines.push('; 额外写入路径');
    for (const p of allowedWritePaths) {
      const absPath = normalizeSandboxPath(p, workDir, {
        allowAbsolute: true,
        resolveSymlinks: true,
        realpath: realpathSync,
      });
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

/**
 * Known noisy macOS processes that generate frequent sandbox deny events.
 * These are filtered out by default in the violation monitor.
 */
const NOISY_PROCESSES = new Set([
  'mDNSResponder', 'diagnosticd', 'analyticsd', 'cfprefsd', 'logd',
]);

/** Predicate for macOS log stream to capture sandbox deny events. */
const LOG_STREAM_PREDICATE = 'eventMessage CONTAINS "deny"';

/**
 * Parse a macOS log stream line for sandbox deny information.
 * @param {string} line - Raw log stream output line
 * @returns {{ operation: string, path: string|null, process: string|null, timestamp: string|null, logTag: string|null }|null}
 */
export function parseLogLine(line) {
  if (!line || typeof line !== 'string') return null;

  // Must contain 'deny' to be relevant
  if (!line.includes('deny')) return null;

  // Extract operation: Sandbox: deny(1) file-read-data /some/path
  const opMatch = line.match(/deny(?:\(\d+\))?\s+(\S+)/);
  if (!opMatch) return null;

  const operation = opMatch[1];

  // Extract path or target after operation
  const afterOp = line.slice(opMatch.index + opMatch[0].length).trim();
  let path = null;
  if (afterOp.length > 0) {
    const quoted = afterOp.match(/^"([^"]+)"/);
    if (quoted) {
      path = quoted[1];
    } else {
      path = afterOp.replace(/\s+\([^)]+\)\s*$/, '').trim() || null;
    }
  }

  // Extract process name: processName[pid] format (standard macOS log)
  const procMatch = line.match(/(\w[\w.-]*)\[\d+]/);
  const process = procMatch ? procMatch[1] : null;

  // Extract timestamp: ISO or macOS default format at line start
  const tsMatch = line.match(/^(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}[\d.+-:]*)/);
  const timestamp = tsMatch ? tsMatch[1] : null;

  // Extract PB log tag (from deny default with message)
  const tagMatch = line.match(/PB_([A-Za-z0-9+/=]+_[a-z0-9]+)/);
  const logTag = tagMatch ? `PB_${tagMatch[1]}` : null;

  return { operation, path, process, timestamp, logTag };
}

/**
 * Start a macOS log stream violation monitor.
 * Spawns `log stream` and feeds parsed deny events into a ViolationStore.
 *
 * Requires Node.js (child_process). Will throw in browser environments.
 *
 * @param {Object} options
 * @param {import('../violation-store.js').ViolationStore} options.violationStore
 * @param {RegExp[]} [options.ignorePatterns] - Patterns to skip
 * @param {string} [options.sessionId] - Session identifier for meta
 * @param {Set<string>} [options.noisyProcesses] - Override noisy process filter
 * @returns {Promise<{ stop: () => void }>}
 */
export async function startViolationMonitor(options) {
  const {
    violationStore,
    ignorePatterns = [],
    sessionId = null,
    noisyProcesses = NOISY_PROCESSES,
  } = options;

  if (!violationStore || typeof violationStore.add !== 'function') {
    throw new Error('violationStore with add() method is required');
  }

  // Lazy import child_process for browser compatibility
  const { spawn } = await import('node:child_process');

  const child = spawn('log', [
    'stream',
    '--predicate', LOG_STREAM_PREDICATE,
  ], { stdio: ['ignore', 'pipe', 'ignore'] });

  let buffer = '';

  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const parsed = parseLogLine(line);
      if (!parsed) continue;

      // Filter noisy processes
      if (parsed.process && noisyProcesses.has(parsed.process)) continue;

      // Check ignore patterns
      if (ignorePatterns.length > 0) {
        const full = line;
        if (ignorePatterns.some(re => re.test(full))) continue;
      }

      violationStore.add({
        type: 'sandbox:deny',
        detail: `${parsed.operation}${parsed.path ? ' ' + parsed.path : ''}`,
        meta: {
          operation: parsed.operation,
          path: parsed.path,
          process: parsed.process,
          timestamp: parsed.timestamp,
          logTag: parsed.logTag,
          ...(sessionId ? { sessionId } : {}),
        },
      });
    }
  });

  return {
    stop() {
      child.kill('SIGTERM');
    },
  };
}

export { NOISY_PROCESSES, LOG_STREAM_PREDICATE };

export default { executeInSeatbelt, createSeatbeltExecutor, parseLogLine, startViolationMonitor, NOISY_PROCESSES, LOG_STREAM_PREDICATE };
