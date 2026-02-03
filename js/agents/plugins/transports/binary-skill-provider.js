/**
 * BinarySkillProvider - 二进制工具作为 Skills
 *
 * 利用微架构特性：
 * - 通过 ServiceBus 注册二进制服务
 * - 通过 EventBus 广播工具事件
 * - 支持连接池和自动重连
 */

import { ProcessTransport } from "./process-transport.js";

const DEFAULT_TIMEOUT_MS = 30000;

/**
 * @typedef {object} Logger
 * @property {(message: string, ...args: unknown[]) => void} [debug] - Debug 日志
 * @property {(message: string, ...args: unknown[]) => void} [info] - Info 日志
 * @property {(message: string, ...args: unknown[]) => void} [warn] - Warn 日志
 * @property {(message: string, ...args: unknown[]) => void} [error] - Error 日志
 */

/**
 * @typedef {ReturnType<typeof setTimeout>} TimeoutHandle
 */

/**
 * Minimal EventEmitter surface used by this module.
 * @typedef {object} EventEmitterLike
 * @property {(event: string, handler: (...args: any[]) => unknown) => unknown} on
 */

/**
 * @typedef {object} BinarySkillConfig
 * @property {string} name - 技能名称
 * @property {string} command - 可执行文件路径或命令名
 * @property {string[]} [args] - 命令行参数
 * @property {Record<string, string>} [env] - 环境变量
 * @property {string} [cwd] - 工作目录
 * @property {number} [timeout] - 请求超时 (ms)
 * @property {boolean} [autoReconnect] - 自动重连
 * @property {string[]} [methods] - 暴露的方法列表
 * @property {string[]} [allowedCommands] - 命令白名单 (命令名或绝对路径)
 * @property {string[]} [allowedCwdRoots] - 工作目录允许的根路径
 * @property {string[]} [allowedEnvKeys] - 可覆盖的环境变量键名
 */

/**
 * @typedef {object} BinarySkillProviderOptions
 * @property {BinarySkillConfig[]} skills - 技能配置列表
 * @property {{ emit?: Function, subscribe?: Function }} [eventBus] - EventBus
 * @property {{ register?: Function }} [serviceBus] - ServiceBus
 * @property {Logger} [logger] - 日志
 */

export class BinarySkillProvider {
  /** @type {BinarySkillConfig[]} */
  skills;
  /** @type {{ emit?: Function, subscribe?: Function } | null} */
  eventBus;
  /** @type {{ register?: Function } | null} */
  serviceBus;
  /** @type {Logger | null} */
  logger;

  /** @type {Map<string, { transport: ProcessTransport, config: BinarySkillConfig }>} */
  _connections;
  /** @type {boolean} */
  _initialized;
  /** @type {boolean} 关闭标记，阻止重连 */
  _shuttingDown;
  /** @type {Map<string, number>} 重试次数 */
  _retryCount;
  /** @type {number} 最大重试次数 */
  _maxRetries;
  /** @type {Map<string, TimeoutHandle>} 自动重连计时器 */
  _reconnectTimers;

  /**
   * @param {BinarySkillProviderOptions} options - Provider 配置
   */
  constructor(options = {}) {
    if (options === null || typeof options !== "object") {
      throw new TypeError("BinarySkillProvider options must be an object");
    }
    this.skills = options.skills || [];
    this.eventBus = options.eventBus || null;
    this.serviceBus = options.serviceBus || null;
    this.logger = options.logger || null;

    /** @type {Map<string, { transport: ProcessTransport, config: BinarySkillConfig }>} */
    this._connections = new Map();
    this._initialized = false;
    /** @type {boolean} 关闭标记，阻止重连 */
    this._shuttingDown = false;
    /** @type {Map<string, number>} 重试次数 */
    this._retryCount = new Map();
    /** @type {number} 最大重试次数 */
    this._maxRetries = 5;
    /** @type {Map<string, TimeoutHandle>} 自动重连计时器 */
    this._reconnectTimers = new Map();
  }

  /**
   * 初始化所有二进制技能
   * @returns {Promise<void>} 初始化完成
   */
  async initialize() {
    if (this._initialized) return;

    for (const config of this.skills) {
      await this._initSkill(config);
    }

    this._initialized = true;
    this._emit("binary:provider:ready", { skills: this.skills.map(s => s.name) });
  }

  /**
   * 初始化单个技能
   * @param {BinarySkillConfig} config - 技能配置
   * @private
   */
  async _initSkill(config) {
    const transportOptions = {
      command: config.command,
      args: config.args,
      env: config.env,
      cwd: config.cwd,
      timeout: config.timeout || DEFAULT_TIMEOUT_MS,
    };
    if (config.allowedCommands) transportOptions.allowedCommands = config.allowedCommands;
    if (config.allowedCwdRoots) transportOptions.allowedCwdRoots = config.allowedCwdRoots;
    if (config.allowedEnvKeys) transportOptions.allowedEnvKeys = config.allowedEnvKeys;

    const transport = /** @type {ProcessTransport & EventEmitterLike} */ (new ProcessTransport(transportOptions));

    // 绑定事件
    transport.on("transport:message", (msg) => {
      this._emit(`binary:${config.name}:message`, msg);
      if (msg.method) {
        this._emit(`binary:${config.name}:${msg.method}`, msg.params);
      }
    });

    transport.on("transport:stderr", (text) => {
      this.logger?.debug?.(`[${config.name}] ${text}`);
    });

    transport.on("transport:exit", ({ code, signal }) => {
      this._emit(`binary:${config.name}:exit`, { code, signal });
      this._connections.delete(config.name);
      this._clearReconnectTimer(config.name);

      // 阻止重连：shutdown 或超过最大重试次数
      if (config.autoReconnect && !this._shuttingDown) {
        this._scheduleReconnect(config);
      }
    });

    transport.on("transport:error", (err) => {
      this._emit(`binary:${config.name}:error`, { error: err.message });
    });

    try {
      await transport.connect();
      this._connections.set(config.name, { transport, config });
      this._emit(`binary:${config.name}:connected`, {});

      // 注册到 ServiceBus
      if (this.serviceBus?.register) {
        this.serviceBus.register(config.name, this._createService(config.name, transport));
      }

      this.logger?.info?.(`Binary skill connected: ${config.name}`);
    } catch (err) {
      this.logger?.error?.(`Failed to connect binary skill: ${config.name}`, err);
      throw err;
    }
  }

  /**
   * 创建服务代理
   * @param {string} name - 服务名
   * @param {ProcessTransport} transport - Transport 实例
   * @returns {{ name: string, call: Function, notify: Function, isConnected: Function }} 服务代理
   * @private
   */
  _createService(name, transport) {
    return {
      name,
      call: (method, params) => transport.request(method, params),
      notify: (method, params) => transport.notify(method, params),
      isConnected: () => transport.isConnected(),
    };
  }

  /**
   * 调用技能方法
   * @param {string} skillName - 技能名称
   * @param {string} method - 方法名
   * @param {unknown} params - 调用参数
   * @returns {Promise<unknown>} 调用结果
   */
  async call(skillName, method, params) {
    const conn = this._connections.get(skillName);
    if (!conn) {
      throw new Error(`Binary skill not found: ${skillName}`);
    }

    this._emit(`binary:${skillName}:call`, { method, params });

    try {
      const result = await conn.transport.request(method, params);
      this._emit(`binary:${skillName}:result`, { method, result });
      return result;
    } catch (err) {
      this._emit(`binary:${skillName}:error`, { method, error: err.message });
      throw err;
    }
  }

  /**
   * 获取所有已连接的技能
   * @returns {string[]} 技能名称列表
   */
  getConnectedSkills() {
    return Array.from(this._connections.keys());
  }

  /**
   * 检查技能是否已连接
   * @param {string} skillName - 技能名称
   * @returns {boolean} 是否已连接
   */
  isConnected(skillName) {
    const conn = this._connections.get(skillName);
    return conn?.transport.isConnected() ?? false;
  }

  /**
   * 生成 ToolRegistry 工具定义
   * @returns {Array<{ name: string, handler: Function }>} Tool 定义列表
   */
  getToolDefinitions() {
    const tools = [];

    for (const [name, { config }] of this._connections) {
      const methods = config.methods || ["run"];

      for (const method of methods) {
        tools.push({
          name: `${name}.${method}`,
          handler: (params, context) => this.call(name, method, params),
        });
      }
    }

    return tools;
  }

  /**
   * 关闭所有连接
   * @returns {Promise<void>} 关闭完成
   */
  async shutdown() {
    this._shuttingDown = true;
    for (const timer of this._reconnectTimers.values()) {
      clearTimeout(timer);
    }
    this._reconnectTimers.clear();
    for (const [name, { transport }] of this._connections) {
      transport.disconnect();
      this._emit(`binary:${name}:disconnected`, {});
    }
    this._connections.clear();
    this._retryCount.clear();
    this._initialized = false;
  }

  /**
   * @param {string} skillName - 技能名称
   * @private
   */
  _clearReconnectTimer(skillName) {
    const timer = this._reconnectTimers.get(skillName);
    if (!timer) return;
    clearTimeout(timer);
    this._reconnectTimers.delete(skillName);
  }

  /**
   * @param {BinarySkillConfig} config - 技能配置
   * @private
   */
  _scheduleReconnect(config) {
    const skillName = config.name;
    this._clearReconnectTimer(skillName);

    const retries = (this._retryCount.get(skillName) || 0) + 1;
    if (retries > this._maxRetries) {
      this.logger?.warn?.(`Max reconnect attempts for ${skillName}`);
      this._retryCount.delete(skillName);
      return;
    }
    this._retryCount.set(skillName, retries);

    // 指数退避: 1s, 2s, 4s, 8s, 16s
    const delay = Math.min(1000 * Math.pow(2, retries - 1), 16000);
    const timer = setTimeout(() => {
      this._reconnectTimers.delete(skillName);
      if (this._shuttingDown) return;
      this._initSkill(config).catch((err) => {
        this.logger?.error?.(`Reconnect failed for ${skillName}`, err);
      });
    }, delay);
    (/** @type {{ unref?: () => void }} */ (timer)).unref?.();
    this._reconnectTimers.set(skillName, timer);
  }

  /**
   * @param {string} event - 事件名
   * @param {unknown} payload - 事件 payload
   * @private
   */
  _emit(event, payload) {
    if (typeof this.eventBus?.emit === "function") {
      this.eventBus.emit(event, { actor: "binary-provider", status: "info", payload });
    }
  }
}

/**
 * 创建 BinarySkillProvider 实例
 * @param {BinarySkillProviderOptions} options - Provider 配置
 * @returns {BinarySkillProvider} BinarySkillProvider 实例
 */
export function createBinarySkillProvider(options) {
  return new BinarySkillProvider(options);
}

export default BinarySkillProvider;
