/**
 * BinarySkillProvider - 二进制工具作为 Skills
 *
 * 利用微架构特性：
 * - 通过 ServiceBus 注册二进制服务
 * - 通过 EventBus 广播工具事件
 * - 支持连接池和自动重连
 */

import { ProcessTransport } from "./process-transport.js";

/**
 * @typedef {object} BinarySkillConfig
 * @property {string} name - 技能名称
 * @property {string} command - 可执行文件路径
 * @property {string[]} [args] - 命令行参数
 * @property {Record<string, string>} [env] - 环境变量
 * @property {string} [cwd] - 工作目录
 * @property {number} [timeout] - 请求超时 (ms)
 * @property {boolean} [autoReconnect] - 自动重连
 * @property {string[]} [methods] - 暴露的方法列表
 */

/**
 * @typedef {object} BinarySkillProviderOptions
 * @property {BinarySkillConfig[]} skills - 技能配置列表
 * @property {{ emit?: Function, subscribe?: Function }} [eventBus] - EventBus
 * @property {{ register?: Function }} [serviceBus] - ServiceBus
 * @property {any} [logger] - 日志
 */

export class BinarySkillProvider {
  /**
   * @param {BinarySkillProviderOptions} options
   */
  constructor(options = {}) {
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
  }

  /**
   * 初始化所有二进制技能
   * @returns {Promise<void>}
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
   * @param {BinarySkillConfig} config
   * @private
   */
  async _initSkill(config) {
    const transport = new ProcessTransport({
      command: config.command,
      args: config.args,
      env: config.env,
      cwd: config.cwd,
      timeout: config.timeout || 30000,
    });

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

      // 阻止重连：shutdown 或超过最大重试次数
      if (config.autoReconnect && !this._shuttingDown) {
        const retries = (this._retryCount.get(config.name) || 0) + 1;
        if (retries > this._maxRetries) {
          this.logger?.warn?.(`Max reconnect attempts for ${config.name}`);
          this._retryCount.delete(config.name);
          return;
        }
        this._retryCount.set(config.name, retries);
        // 指数退避: 1s, 2s, 4s, 8s, 16s
        const delay = Math.min(1000 * Math.pow(2, retries - 1), 16000);
        setTimeout(() => {
          if (this._shuttingDown) return;
          this._initSkill(config).catch((err) => {
            this.logger?.error?.(`Reconnect failed for ${config.name}`, err);
          });
        }, delay);
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
   * @param {string} name
   * @param {ProcessTransport} transport
   * @returns {object}
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
   * @param {string} skillName
   * @param {string} method
   * @param {any} params
   * @returns {Promise<any>}
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
   * @returns {string[]}
   */
  getConnectedSkills() {
    return Array.from(this._connections.keys());
  }

  /**
   * 检查技能是否已连接
   * @param {string} skillName
   * @returns {boolean}
   */
  isConnected(skillName) {
    const conn = this._connections.get(skillName);
    return conn?.transport.isConnected() ?? false;
  }

  /**
   * 生成 ToolRegistry 工具定义
   * @returns {Array<{ name: string, handler: Function }>}
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
   * @returns {Promise<void>}
   */
  async shutdown() {
    this._shuttingDown = true;
    for (const [name, { transport }] of this._connections) {
      transport.disconnect();
      this._emit(`binary:${name}:disconnected`, {});
    }
    this._connections.clear();
    this._retryCount.clear();
    this._initialized = false;
  }

  /**
   * @param {string} event
   * @param {any} payload
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
 * @param {BinarySkillProviderOptions} options
 * @returns {BinarySkillProvider}
 */
export function createBinarySkillProvider(options) {
  return new BinarySkillProvider(options);
}

export default BinarySkillProvider;
