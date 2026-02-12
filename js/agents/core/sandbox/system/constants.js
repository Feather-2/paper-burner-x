/**
 * 系统级沙箱常量
 * @module core/sandbox/system/constants
 */

/**
 * 沙箱后端类型
 * @readonly
 * @enum {string}
 */
export const SandboxBackend = {
  /** Linux Bubblewrap (namespace 隔离) */
  BUBBLEWRAP: 'bubblewrap',
  /** macOS Seatbelt (sandbox-exec) */
  SEATBELT: 'seatbelt',
  /** Docker 容器 (跨平台) */
  DOCKER: 'docker',
  /** 无沙箱，仅权限审批 */
  PERMISSION_ONLY: 'permission-only',
  /** 无保护 (仅开发环境) */
  NONE: 'none',
};

/**
 * 沙箱策略
 * @readonly
 * @enum {string}
 */
export const SandboxPolicy = {
  /** 网络隔离 */
  NO_NETWORK: 'no-network',
  /** 只读文件系统 */
  READ_ONLY_FS: 'read-only-fs',
  /** 限制写入目录 */
  RESTRICT_WRITE: 'restrict-write',
  /** 禁止子进程 */
  NO_SPAWN: 'no-spawn',
};

/**
 * 默认沙箱配置
 */
export const DefaultSandboxConfig = {
  /** 允许写入的目录 (相对于工作目录) */
  allowedWritePaths: [],
  /** 允许读取的目录 */
  allowedReadPaths: [],
  /** 是否允许网络 */
  allowNetwork: false,
  /** 超时 (ms) */
  timeoutMs: 60000,
  /** 内存限制 (bytes) */
  memoryLimit: 512 * 1024 * 1024, // 512MB
};

/**
 * 平台常量
 */
export const Platform = {
  LINUX: 'linux',
  DARWIN: 'darwin',
  WIN32: 'win32',
};

/**
 * 系统沙箱安全预设
 */
export const SystemSandboxPreset = {
  /** 严格模式 - 最小权限 */
  STRICT: {
    allowedWritePaths: ['./output'],
    allowedReadPaths: ['.'],
    allowNetwork: false,
    timeoutMs: 30000,
    memoryLimit: 256 * 1024 * 1024, // 256MB
  },

  /** 标准模式 - 平衡安全与功能 */
  STANDARD: DefaultSandboxConfig,

  /** 隔离模式 - 完全隔离 */
  ISOLATED: {
    allowedWritePaths: ['.'],
    allowedReadPaths: ['.'],
    allowNetwork: false,
    timeoutMs: 60000,
    memoryLimit: 512 * 1024 * 1024,
  },

  /** 宽松模式 - 开发环境 */
  PERMISSIVE: {
    allowedWritePaths: ['.', './output', './temp', './cache'],
    allowedReadPaths: ['.', '/usr', '/lib', '/lib64', '/bin', '/etc', '/opt'],
    allowNetwork: true,
    timeoutMs: 120000,
    memoryLimit: 1024 * 1024 * 1024, // 1GB
  },
};

export default { SandboxBackend, SandboxPolicy, DefaultSandboxConfig, Platform, SystemSandboxPreset };
