/**
 * 系统级沙箱统一执行器
 *
 * 自动检测可用后端并选择最强隔离方案。
 * 优先级：Bubblewrap (Linux) > Seatbelt (macOS) > Docker > Permission-only
 *
 * @module core/sandbox/system/executor
 */

import { SandboxBackend, DefaultSandboxConfig } from './constants.js';
import { detectBestBackend, detectAllBackends, getPlatform } from './detect.js';
import { createBubblewrapExecutor } from './bubblewrap.js';
import { createSeatbeltExecutor } from './seatbelt.js';
import { createDockerExecutor } from './docker.js';
import { createPermissionExecutor } from './permission.js';
import { SandboxNetworkManager } from './network-manager.js';
import { createLogger } from '../../../shared/index.js';

const logger = createLogger('core/sandbox/system/executor');

/**
 * @typedef {import('./permission.js').PermissionHandler} PermissionHandler
 */

/**
 * 沙箱执行器配置
 * @typedef {Object} SystemSandboxConfig
 * @property {string} [preferredBackend] - 首选后端
 * @property {string} [workDir] - 工作目录
 * @property {string[]} [allowedReadPaths] - 允许读取的路径
 * @property {string[]} [allowedWritePaths] - 允许写入的路径
 * @property {boolean} [allowNetwork] - 是否允许网络
 * @property {number} [timeoutMs] - 超时
 * @property {PermissionHandler} [permissionHandler] - 权限处理器 (permission-only 模式)
 * @property {Function} [onBackendSelected] - 后端选择回调
 * @property {boolean} [managedNetwork] - 托管网络模式（自动注入 networkProxy）
 * @property {{ allowedDomains?: string[], deniedDomains?: string[] }} [networkPolicy] - 域名策略
 * @property {(info: { host: string, port: number }) => Promise<boolean>} [networkAskCallback] - 动态放行回调
 * @property {(violation: object) => void} [networkOnViolation] - 违规回调
 * @property {(config: object) => SandboxNetworkManager} [networkManagerFactory] - 测试注入工厂
 */

/**
 * 系统级沙箱执行器
 */
export class SystemSandboxExecutor {
  /**
   * @param {SystemSandboxConfig} config
   */
  constructor(config = {}) {
    this.config = {
      ...DefaultSandboxConfig,
      ...config,
    };

    /** @type {string|null} */
    this.activeBackend = null;

    /** @type {Object|null} */
    this.executor = null;

    /** @type {Promise|null} */
    this._initPromise = null;

    /** @type {Set<import('child_process').ChildProcess>} */
    this._activeProcesses = new Set();

    /** @type {boolean} */
    this._cleanupRegistered = false;

    /** @type {SandboxNetworkManager | null} */
    this._managedNetworkManager = null;
    /** @type {(config: object) => SandboxNetworkManager} */
    this._networkManagerFactory = typeof this.config.networkManagerFactory === 'function'
      ? this.config.networkManagerFactory
      : (cfg) => new SandboxNetworkManager(cfg);
  }

  /**
   * 注册进程退出清理钩子（参考 ASRT SandboxManager cleanup）。
   * 确保父进程退出时终止所有活跃的沙箱子进程。
   */
  _registerCleanup() {
    if (this._cleanupRegistered) return;
    if (typeof process === 'undefined' || typeof process.on !== 'function') return;
    this._cleanupRegistered = true;

    const cleanup = () => {
      for (const proc of this._activeProcesses) {
        try { proc.kill('SIGTERM'); } catch { /* already dead */ }
      }
      this._activeProcesses.clear();
    };

    // Use process.on() instead of process.once() to allow multiple handlers
    process.on('exit', cleanup);
    process.on('SIGINT', () => { cleanup(); process.exit?.(130); });
    process.on('SIGTERM', () => { cleanup(); process.exit?.(143); });
  }

  /**
   * 跟踪子进程，退出时自动从 Set 中移除。
   * @param {import('child_process').ChildProcess} proc
   */
  trackProcess(proc) {
    if (!proc || typeof proc.once !== 'function') return;
    this._registerCleanup();
    this._activeProcesses.add(proc);
    proc.once('exit', () => this._activeProcesses.delete(proc));
  }

  /**
   * 初始化执行器
   * @returns {Promise<void>}
   */
  async init() {
    if (this._initPromise) {
      return this._initPromise;
    }

    this._initPromise = this._doInit().catch((error) => {
      this._initPromise = null;
      throw error;
    });
    return this._initPromise;
  }

  /**
   * @private
   */
  async _doInit() {
    // 如果指定了首选后端，尝试使用它
    if (this.config.preferredBackend) {
      const available = await this._tryBackend(this.config.preferredBackend);
      if (available) {
        return;
      }
      logger.warn(
        `[SystemSandbox] Preferred backend '${this.config.preferredBackend}' not available, falling back...`
      );
    }

    // 自动检测最佳后端
    const best = await detectBestBackend();
    await this._tryBackend(best.backend);
  }

  /**
   * 尝试使用指定后端
   * @param {string} backend
   * @returns {Promise<boolean>} - 是否成功绑定
   * @private
   */
  async _tryBackend(backend) {
    // 先验证后端可用性（PERMISSION_ONLY 始终可用）
    if (backend !== SandboxBackend.PERMISSION_ONLY) {
      const allBackends = await detectAllBackends();
      const info = allBackends.find((b) => b.backend === backend);
      if (!info || !info.available) {
        return false;
      }
    }

    const executorOptions = {
      workDir: this.config.workDir,
      allowedReadPaths: this.config.allowedReadPaths,
      allowedWritePaths: this.config.allowedWritePaths,
      allowNetwork: this.config.allowNetwork,
      timeoutMs: this.config.timeoutMs,
    };

    await this._prepareManagedNetwork(backend, executorOptions);

    switch (backend) {
      case SandboxBackend.BUBBLEWRAP:
        this.executor = createBubblewrapExecutor(executorOptions);
        this.activeBackend = SandboxBackend.BUBBLEWRAP;
        break;

      case SandboxBackend.SEATBELT:
        this.executor = createSeatbeltExecutor(executorOptions);
        this.activeBackend = SandboxBackend.SEATBELT;
        break;

      case SandboxBackend.DOCKER:
        this.executor = createDockerExecutor(executorOptions);
        this.activeBackend = SandboxBackend.DOCKER;
        break;

      case SandboxBackend.PERMISSION_ONLY:
      default:
        this.executor = createPermissionExecutor({
          ...executorOptions,
          permissionHandler: this.config.permissionHandler,
        });
        this.activeBackend = SandboxBackend.PERMISSION_ONLY;
        break;
    }

    if (this.config.onBackendSelected) {
      this.config.onBackendSelected(this.activeBackend);
    }

    return true;
  }

  /**
   * @param {string} backend
   * @param {Record<string, unknown>} executorOptions
   * @returns {Promise<void>}
   * @private
   */
  async _prepareManagedNetwork(backend, executorOptions) {
    const managedEnabled = this.config.managedNetwork === true
      && this.config.allowNetwork !== false
      && backend === SandboxBackend.BUBBLEWRAP;

    if (!managedEnabled) {
      await this._shutdownManagedNetwork();
      return;
    }

    if (!this._managedNetworkManager) {
      this._managedNetworkManager = this._networkManagerFactory({
        policy: this.config.networkPolicy,
        askCallback: this.config.networkAskCallback,
        onViolation: this.config.networkOnViolation,
      });
      await this._managedNetworkManager.initialize();
    }

    const socketPath = this._managedNetworkManager.getSocketPath();
    if (socketPath) {
      executorOptions.networkProxy = { httpSocketPath: socketPath };
      executorOptions.allowNetwork = true;
    }
  }

  /**
   * @returns {Promise<void>}
   * @private
   */
  async _shutdownManagedNetwork() {
    if (!this._managedNetworkManager) return;
    try {
      await this._managedNetworkManager.shutdown();
    } finally {
      this._managedNetworkManager = null;
    }
  }

  /**
   * 执行命令
   * @param {string} command
   * @param {string[]} args
   * @param {Object} [options]
   * @returns {Promise<import('./bubblewrap.js').ExecutionResult>}
   */
  async execute(command, args = [], options = {}) {
    await this.init();
    const result = await this.executor.execute(command, args, options);
    this._trackProcessFromResult(result);
    return result;
  }

  /**
   * 执行 shell 命令
   * @param {string} shellCommand
   * @param {Object} [options]
   * @returns {Promise<import('./bubblewrap.js').ExecutionResult>}
   */
  async shell(shellCommand, options = {}) {
    await this.init();
    const result = await this.executor.shell(shellCommand, options);
    this._trackProcessFromResult(result);
    return result;
  }

  /**
   * @private
   * @param {any} result
   */
  _trackProcessFromResult(result) {
    const proc = result?.process || result?.childProcess;
    if (!proc) return;
    this.trackProcess(proc);
  }

  /**
   * 获取当前使用的后端
   * @returns {string|null}
   */
  getBackend() {
    return this.activeBackend;
  }

  /**
   * 获取沙箱信息
   * @returns {Promise<Object>}
   */
  async getInfo() {
    await this.init();
    const allBackends = await detectAllBackends();
    return {
      platform: getPlatform(),
      activeBackend: this.activeBackend,
      availableBackends: allBackends.filter((b) => b.available).map((b) => b.backend),
      allBackends,
    };
  }

  /**
   * 释放托管资源（网络代理等）。
   * @returns {Promise<void>}
   */
  async dispose() {
    await this._shutdownManagedNetwork();
  }
}

/**
 * 创建系统级沙箱执行器
 * @param {SystemSandboxConfig} config
 * @returns {SystemSandboxExecutor}
 */
export function createSystemSandbox(config = {}) {
  return new SystemSandboxExecutor(config);
}

/**
 * 快速执行命令 (一次性使用)
 * @param {string} command
 * @param {string[]} args
 * @param {SystemSandboxConfig} [config]
 * @returns {Promise<import('./bubblewrap.js').ExecutionResult>}
 */
export async function execInSandbox(command, args = [], config = {}) {
  const sandbox = createSystemSandbox(config);
  return sandbox.execute(command, args);
}

/**
 * 快速执行 shell 命令 (一次性使用)
 * @param {string} shellCommand
 * @param {SystemSandboxConfig} [config]
 * @returns {Promise<import('./bubblewrap.js').ExecutionResult>}
 */
export async function shellInSandbox(shellCommand, config = {}) {
  const sandbox = createSystemSandbox(config);
  return sandbox.shell(shellCommand);
}

export default {
  SystemSandboxExecutor,
  createSystemSandbox,
  execInSandbox,
  shellInSandbox,
};
