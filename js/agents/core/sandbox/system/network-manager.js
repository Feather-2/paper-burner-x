/**
 * Sandbox Network Manager — 沙箱网络出站控制管理器
 *
 * 统一管理 HTTP 代理 + Unix socket 桥接的生命周期。
 * 提供 filterNetworkRequest 域名级过滤。
 *
 * 用法：
 *   const mgr = new SandboxNetworkManager({ policy, askCallback });
 *   await mgr.initialize();
 *   // 传给 bubblewrap: { networkProxy: { httpSocketPath: mgr.getSocketPath() } }
 *   await mgr.shutdown();
 *
 * @module core/sandbox/system/network-manager
 */

import { createNetworkProxy } from './network-proxy.js';
import { initBridge } from './proxy-bridge.js';
import { matchesDomainPattern } from '../network-policy-utils.js';
import { createLogger } from '../../../../shared/index.js';

const logger = createLogger('core/sandbox/system/network-manager');

/**
 * @typedef {Object} NetworkManagerConfig
 * @property {{ allowedDomains?: string[], deniedDomains?: string[] }} [policy]
 * @property {(info: { host: string, port: number }) => Promise<boolean>} [askCallback]
 * @property {(violation: object) => void} [onViolation]
 */

export class SandboxNetworkManager {
  /** @param {NetworkManagerConfig} config */
  constructor(config = {}) {
    this._config = config;
    this._proxy = null;
    this._bridge = null;
    this._initialized = false;
  }

  /**
   * 域名过滤 — deny-first + allow-list + askCallback
   * @param {number} port
   * @param {string} host
   * @returns {Promise<boolean>}
   */
  async filterRequest(port, host) {
    const policy = this._config.policy;
    if (!policy) return true;

    // 1. 黑名单优先
    if (policy.deniedDomains) {
      for (const p of policy.deniedDomains) {
        if (matchesDomainPattern(host, p)) {
          this._reportViolation('network', host, port, 'denied');
          return false;
        }
      }
    }

    // 2. 白名单
    if (policy.allowedDomains) {
      for (const p of policy.allowedDomains) {
        if (matchesDomainPattern(host, p)) return true;
      }
      // 3. 无匹配 → askCallback 或拒绝
      if (this._config.askCallback) {
        const allowed = await this._config.askCallback({ host, port });
        if (!allowed) this._reportViolation('network', host, port, 'user-denied');
        return allowed;
      }
      this._reportViolation('network', host, port, 'no-match');
      return false;
    }

    return true;
  }

  /** @private */
  _reportViolation(type, host, port, reason) {
    logger.debug(`Network violation: ${host}:${port} (${reason})`);
    this._config.onViolation?.({ type, host, port, reason, ts: Date.now() });
  }

  /**
   * 启动代理 + 桥接
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this._initialized) return;

    // 启动 HTTP 代理
    this._proxy = createNetworkProxy({
      filter: (port, host) => this.filterRequest(port, host),
    });
    const proxyPort = await this._proxy.listen(0, '127.0.0.1');
    logger.info(`Network proxy listening on 127.0.0.1:${proxyPort}`);

    // 启动 Unix socket 桥接
    this._bridge = await initBridge(proxyPort);
    logger.info(`Bridge socket: ${this._bridge.httpSocketPath}`);

    this._initialized = true;
  }

  /**
   * 获取 Unix socket 路径（传给 bubblewrap networkProxy 选项）
   * @returns {string|null}
   */
  getSocketPath() {
    return this._bridge?.httpSocketPath ?? null;
  }

  /**
   * 获取代理端口
   * @returns {number|undefined}
   */
  getProxyPort() {
    return this._proxy?.getPort();
  }

  /**
   * 更新网络策略（运行时热更新）
   * @param {{ allowedDomains?: string[], deniedDomains?: string[] }} policy
   */
  updatePolicy(policy) {
    this._config.policy = policy;
  }

  /**
   * 关闭代理和桥接
   * @returns {Promise<void>}
   */
  async shutdown() {
    if (!this._initialized) return;
    this._bridge?.cleanup();
    await this._proxy?.close();
    this._bridge = null;
    this._proxy = null;
    this._initialized = false;
    logger.info('Network manager shut down');
  }
}
