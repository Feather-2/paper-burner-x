// 沙箱能力定义
export const SandboxCapability = {
  CONSOLE: 'console',      // console.log/warn/error
  STATE: 'state',          // 只读 state 访问
  EMIT: 'emit',            // 事件发射
  FETCH: 'fetch',          // 受限 HTTP 请求
  FS_READ: 'fs:read',      // 只读文件访问
  FS_WRITE: 'fs:write',    // 文件写入（高危）
  EXEC: 'exec',            // 子进程执行（高危）
};

// 预设能力组合
export const SandboxPreset = {
  // 最小权限 - 仅 console
  MINIMAL: [SandboxCapability.CONSOLE],

  // 标准 Skill - console + state + emit
  SKILL: [
    SandboxCapability.CONSOLE,
    SandboxCapability.STATE,
    SandboxCapability.EMIT,
  ],

  // 网络 Skill - 允许 fetch
  NETWORK: [
    SandboxCapability.CONSOLE,
    SandboxCapability.STATE,
    SandboxCapability.EMIT,
    SandboxCapability.FETCH,
  ],

  // 完整权限 - 仅用于可信 Skill
  TRUSTED: Object.values(SandboxCapability),
};

// 资源限制预设
export const ResourceLimits = {
  // 轻量级 - 1MB 内存，1s 超时
  LIGHT: {
    memoryLimit: 1 * 1024 * 1024,
    timeoutMs: 1000,
    maxStackDepth: 100,
  },

  // 标准 - 8MB 内存，30s 超时
  STANDARD: {
    memoryLimit: 8 * 1024 * 1024,
    timeoutMs: 30000,
    maxStackDepth: 500,
  },

  // 重型 - 64MB 内存，5min 超时
  HEAVY: {
    memoryLimit: 64 * 1024 * 1024,
    timeoutMs: 300000,
    maxStackDepth: 1000,
  },
};

export default { SandboxCapability, SandboxPreset, ResourceLimits };
