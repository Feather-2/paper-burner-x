/**
 * Permission-only 执行器 (无沙箱 Fallback)
 *
 * 当没有系统级沙箱可用时，使用权限审批流程作为安全屏障。
 * 模仿 OpenCode 的做法：执行前询问用户确认。
 *
 * @module core/sandbox/system/permission
 */

import { SandboxBackend } from './constants.js';
import { execCommand, getPlatform } from './detect.js';

/**
 * 权限请求
 * @typedef {Object} PermissionRequest
 * @property {string} type - 请求类型 (shell/file-write/network)
 * @property {string} command - 命令或操作描述
 * @property {string[]} [args] - 参数
 * @property {string} [path] - 文件路径
 * @property {string} workDir - 工作目录
 */

/**
 * 权限响应
 * @typedef {'allow-once' | 'allow-always' | 'deny'} PermissionResponse
 */

/**
 * 权限处理器
 * @typedef {(request: PermissionRequest) => Promise<PermissionResponse>} PermissionHandler
 */

/**
 * 默认权限处理器 - 默认拒绝
 * @type {PermissionHandler}
 */
const defaultPermissionHandler = async () => 'deny';

/**
 * 权限缓存 - 存储 "allow-always" 的规则
 * @type {Set<string>}
 */
const allowedPatterns = new Set();

/**
 * 生成权限缓存键（包含完整请求信息）
 * @param {PermissionRequest} request
 * @returns {string}
 */
function getPermissionKey(request) {
  const argsHash = request.args?.length ? JSON.stringify(request.args) : '';
  const pathPart = request.path || '';
  return `${request.type}:${request.command}:${request.workDir}:${argsHash}:${pathPart}`;
}

/**
 * 检查是否已授权
 * @param {PermissionRequest} request
 * @returns {boolean}
 */
function isAllowed(request) {
  const key = getPermissionKey(request);
  return allowedPatterns.has(key) || allowedPatterns.has(`${request.type}:*`);
}

/**
 * Permission-only 执行选项
 * @typedef {Object} PermissionOptions
 * @property {string} workDir - 工作目录
 * @property {PermissionHandler} [permissionHandler] - 权限处理器
 * @property {number} [timeoutMs] - ��时
 * @property {Object.<string, string>} [env] - 环境变量
 * @property {boolean} [skipPermission] - 跳过权限检查 (危险)
 */

/**
 * 使用权限检查执行命令 (无沙箱)
 * @param {string} command - 要执行的命令
 * @param {string[]} args - 命令参数
 * @param {PermissionOptions} options - 执行选项
 * @returns {Promise<import('./bubblewrap.js').ExecutionResult>}
 */
export async function executeWithPermission(command, args, options) {
  const {
    workDir,
    permissionHandler = defaultPermissionHandler,
    timeoutMs = 60000,
    skipPermission = false,
  } = options;

  if (!workDir) {
    throw new Error('workDir is required for permission-only executor');
  }

  const request = {
    type: 'shell',
    command,
    args,
    workDir,
  };

  // 检查权限
  if (!skipPermission && !isAllowed(request)) {
    const response = await permissionHandler(request);

    switch (response) {
      case 'allow-always':
        allowedPatterns.add(getPermissionKey(request));
        break;
      case 'deny':
        return {
          code: 1,
          stdout: '',
          stderr: 'Permission denied by user',
          killed: false,
          backend: SandboxBackend.PERMISSION_ONLY,
        };
      case 'allow-once':
      default:
        // 继续执行
        break;
    }
  }

  // 直接执行 (无沙箱)
  const result = await execCommand(command, args, { timeout: timeoutMs });

  return {
    ...result,
    killed: result.code === 137 || result.code === 124,
    backend: SandboxBackend.PERMISSION_ONLY,
  };
}

/**
 * 创建 Permission-only 执行器实例
 * @param {Partial<PermissionOptions>} [defaultOptions]
 * @returns {Object}
 */
export function createPermissionExecutor(defaultOptions = /** @type {Partial<PermissionOptions>} */ ({})) {
  return {
    backend: SandboxBackend.PERMISSION_ONLY,

    async execute(command, args = [], options = {}) {
      return executeWithPermission(
        command,
        args,
        /** @type {PermissionOptions} */ ({ ...defaultOptions, ...options })
      );
    },

    async shell(shellCommand, options = {}) {
      const platform = getPlatform();
      const shell = platform === 'win32' ? 'cmd.exe' : '/bin/sh';
      const shellArgs = platform === 'win32' ? ['/c', shellCommand] : ['-c', shellCommand];
      return this.execute(shell, shellArgs, options);
    },

    /**
     * 添加永久允许规则
     * @param {string} pattern - 模式 (如 "shell:git:*" 或 "shell:*")
     */
    allowPattern(pattern) {
      allowedPatterns.add(pattern);
    },

    /**
     * 清除权限缓存
     */
    clearPermissions() {
      allowedPatterns.clear();
    },
  };
}

/**
 * 创建交互式权限处理器 (CLI 用)
 * @param {Object} options
 * @param {Function} options.prompt - 提示函数 (message) => Promise<string>
 * @returns {PermissionHandler}
 */
export function createInteractivePermissionHandler(options) {
  const { prompt } = options;

  return async (request) => {
    const message = formatPermissionRequest(request);
    const answer = await prompt(message);

    const normalized = answer.toLowerCase().trim();
    if (normalized === 'y' || normalized === 'yes') {
      return 'allow-once';
    }
    if (normalized === 'a' || normalized === 'always') {
      return 'allow-always';
    }
    return 'deny';
  };
}

/**
 * 格式化权限请求为可读字符串
 * @param {PermissionRequest} request
 * @returns {string}
 */
function formatPermissionRequest(request) {
  const parts = [
    `[Permission Required]`,
    `  Type: ${request.type}`,
    `  Command: ${request.command}`,
  ];

  if (request.args?.length) {
    parts.push(`  Args: ${request.args.join(' ')}`);
  }

  parts.push(`  WorkDir: ${request.workDir}`);
  parts.push(`\nAllow? (y/n/a[lways]): `);

  return parts.join('\n');
}

export default {
  executeWithPermission,
  createPermissionExecutor,
  createInteractivePermissionHandler,
};
