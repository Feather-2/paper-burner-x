/**
 * 统一沙箱接口定义 — 纯类型 + 验证，无实现逻辑
 *
 * @module sandbox-interface
 */

// ── 类型定义 ──────────────────────────────────────────────

/**
 * 沙箱隔离级别
 * @typedef {'wasm'|'worker'|'iframe'|'main'|'auto'} SandboxLevel
 */

/**
 * 沙箱配置
 * @typedef {object} SandboxConfig
 * @property {SandboxLevel} [level='auto'] - 隔离级别
 * @property {object} [vfs] - VFS 实例
 * @property {string[]} [capabilities] - 能力列表 (SandboxCapability values)
 * @property {number} [timeout=30000] - 执行超时 ms
 * @property {string} [cwd='/'] - 工作目录
 * @property {Record<string, string>} [env] - 环境变量
 * @property {(method: string, args: unknown[]) => void} [onConsole] - console 回调
 * @property {boolean} [mainThreadFallback=false] - 是否允许主线程 fallback
 */

/**
 * 执行结果
 * @typedef {object} SandboxResult
 * @property {boolean} ok - 是否成功
 * @property {unknown} [value] - 返回值
 * @property {string} [error] - 错误消息
 * @property {string} [stack] - 错误堆栈
 * @property {number} durationMs - 执行耗时
 */

// ── 统一 CodeExecutor 接口 ─────────────────────────────────
// 桥接 WASM sandbox 和 System sandbox 的统一执行接口
// 参考 SmolAgents PythonExecutor ABC 设计

/**
 * 执行器后端类型
 * @typedef {'wasm'|'worker'|'iframe'|'main'|'bubblewrap'|'seatbelt'|'docker'|'permission'} ExecutorBackend
 */

/**
 * 统一执行结果 — 兼容 WASM SandboxResult 和 System ExecutionResult
 * @typedef {object} ExecutionResult
 * @property {boolean} ok - 是否成功
 * @property {unknown} [value] - 返回值 (WASM: JS value, System: stdout)
 * @property {string} [error] - 错误消息 (WASM: error, System: stderr)
 * @property {string} [stack] - 错误堆栈
 * @property {string} [logs] - 合并的 console/stdout 输出
 * @property {number} durationMs - 执行耗时
 * @property {ExecutorBackend} backend - 使用的后端
 */

/**
 * 统一代码执行器接口
 * @typedef {object} CodeExecutor
 * @property {ExecutorBackend} backend - 后端类型
 * @property {(code: string, opts?: object) => Promise<ExecutionResult>} execute - 执行代码
 * @property {() => Promise<void>} terminate - 终止并清理
 * @property {boolean} terminated - 是否已终止
 */

/**
 * 将 System sandbox 的 {code, stdout, stderr, killed, backend} 转换为统一 ExecutionResult
 * @param {{ code: number, stdout: string, stderr: string, killed?: boolean, backend?: string }} raw
 * @param {number} [durationMs=0]
 * @returns {ExecutionResult}
 */
export function normalizeSystemResult(raw, durationMs = 0) {
  return {
    ok: raw.code === 0,
    value: raw.stdout || null,
    error: raw.code !== 0 ? (raw.stderr || `Exit code ${raw.code}`) : undefined,
    stack: undefined,
    logs: raw.stdout || undefined,
    durationMs,
    backend: /** @type {ExecutorBackend} */ (raw.backend || 'bubblewrap'),
  };
}

/**
 * 将 WASM SandboxResult 转换为统一 ExecutionResult
 * @param {SandboxResult} raw
 * @param {ExecutorBackend} backend
 * @returns {ExecutionResult}
 */
export function normalizeWasmResult(raw, backend = 'wasm') {
  return {
    ok: raw.ok,
    value: raw.value,
    error: raw.error,
    stack: raw.stack,
    logs: undefined,
    durationMs: raw.durationMs,
    backend,
  };
}

/**
 * 统一沙箱接口 — 所有沙箱实现必须满足此契约
 * @typedef {object} Sandbox
 * @property {SandboxLevel} level - 当前隔离级别
 * @property {(code: string, filename?: string) => Promise<SandboxResult>} execute - 执行代码
 * @property {(path: string) => Promise<SandboxResult>} runFile - 执行 VFS 中的文件
 * @property {() => Promise<void>} terminate - 终止并清理资源
 * @property {boolean} terminated - 是否已终止
 */

// ── 常量 ──────────────────────────────────────────────────

/** 有效隔离级别 */
export const SANDBOX_LEVELS = ['wasm', 'worker', 'iframe', 'main'];

/** auto 模式的优先级顺序 */
export const AUTO_PRIORITY = ['wasm', 'iframe', 'worker', 'main'];

/** @type {SandboxConfig} */
export const DEFAULT_CONFIG = {
  level: 'auto',
  vfs: undefined,
  capabilities: [],
  timeout: 30000,
  cwd: '/',
  env: {},
  onConsole: undefined,
  mainThreadFallback: false,
};

// ── 验证 ──────────────────────────────────────────────────

const VALID_LEVELS = new Set([...SANDBOX_LEVELS, 'auto']);

/**
 * 验证沙箱配置，返回合并了默认值的完整配置
 *
 * @param {Partial<SandboxConfig>} config
 * @returns {SandboxConfig}
 * @throws {Error} 参数无效时抛出
 */
export function validateConfig(config) {
  if (config.level !== undefined && !VALID_LEVELS.has(config.level)) {
    throw new Error(
      `Invalid sandbox level "${config.level}". ` +
      `Must be one of: ${[...VALID_LEVELS].join(', ')}`
    );
  }
  if (config.timeout !== undefined && (typeof config.timeout !== 'number' || config.timeout <= 0)) {
    throw new Error(`Invalid timeout: ${config.timeout}. Must be a positive number.`);
  }
  if (config.capabilities !== undefined && !Array.isArray(config.capabilities)) {
    throw new Error('capabilities must be an array.');
  }
  return { ...DEFAULT_CONFIG, ...config };
}
