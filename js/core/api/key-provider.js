/**
 * @file js/core/api/key-provider.js
 * @description API 密钥提供者，支持密钥轮询、失效标记、优先使用上次成功的密钥
 */

import { storage } from '../../storage/storage-facade.js';

const LAST_SUCCESSFUL_KEYS_KEY = 'paperBurnerLastSuccessfulKeys';

/**
 * API 密钥提供者类
 * 负责加载、筛选、排序和轮询特定模型的 API Keys
 */
export class KeyProvider {
  /**
   * @param {string} modelName - 模型名称
   */
  constructor(modelName) {
    this.modelName = modelName;
    this.keys = [];
    this.availableKeys = [];
    this.currentIndex = 0;
    this._initialized = false;
  }

  /**
   * 初始化密钥提供者
   * @returns {Promise<void>}
   */
  async init() {
    if (this._initialized) return;

    // 加载密钥
    this.keys = await this._loadKeys();

    // 筛选可用密钥
    this.availableKeys = this.keys.filter(
      key => key.status === 'valid' || key.status === 'untested'
    );

    // 尝试使用上次成功的密钥
    const lastSuccessId = await this._getLastSuccessfulKeyId();
    if (lastSuccessId) {
      const idx = this.availableKeys.findIndex(k => k.id === lastSuccessId);
      if (idx >= 0) {
        this.currentIndex = idx;
      }
    }

    this._initialized = true;

    if (this.availableKeys.length === 0) {
      console.warn(`[KeyProvider] No available keys for model: ${this.modelName}`);
    }
  }

  /**
   * 加载密钥（兼容旧版 loadModelKeys）
   * @private
   */
  async _loadKeys() {
    // 优先使用新的 Repository
    try {
      const keys = await storage.apiKeys.getKeysForModel(this.modelName);
      if (keys && keys.length > 0) {
        return keys;
      }
    } catch (e) {
      console.warn('[KeyProvider] Failed to load from repository:', e);
    }

    // 兼容旧版 loadModelKeys
    if (typeof window !== 'undefined' && typeof window.loadModelKeys === 'function') {
      return window.loadModelKeys(this.modelName) || [];
    }

    return [];
  }

  /**
   * 获取下一个可用密钥
   * @returns {Promise<{id: string, value: string, status: string} | null>}
   */
  async getNextKey() {
    await this.init();

    if (this.availableKeys.length === 0) {
      return null;
    }

    const keyObject = this.availableKeys[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.availableKeys.length;
    return keyObject;
  }

  /**
   * 标记密钥为无效
   * @param {string} keyId - 密钥 ID
   */
  async markKeyAsInvalid(keyId) {
    // 更新内存中的状态
    const keyIndex = this.keys.findIndex(k => k.id === keyId);
    if (keyIndex !== -1) {
      this.keys[keyIndex].status = 'invalid';
    }

    // 从可用列表中移除
    this.availableKeys = this.availableKeys.filter(k => k.id !== keyId);
    if (this.availableKeys.length > 0) {
      this.currentIndex = this.currentIndex % this.availableKeys.length;
    } else {
      this.currentIndex = 0;
    }

    // 保存到存储
    try {
      await storage.apiKeys.markKeyInvalid(this.modelName, keyId);
    } catch (e) {
      // 兼容旧版
      if (typeof window !== 'undefined' && typeof window.saveModelKeys === 'function') {
        await window.saveModelKeys(this.modelName, this.keys);
      }
    }

    // 通知 UI 刷新
    if (typeof window !== 'undefined' && typeof window.refreshKeyManagerForModel === 'function') {
      window.refreshKeyManagerForModel(this.modelName, keyId, 'invalid');
    }
  }

  /**
   * 记录成功使用的密钥
   * @param {string} keyId - 密钥 ID
   */
  async recordSuccess(keyId) {
    try {
      let records = {};
      const stored = localStorage.getItem(LAST_SUCCESSFUL_KEYS_KEY);
      if (stored) {
        records = JSON.parse(stored);
      }
      records[this.modelName] = keyId;
      localStorage.setItem(LAST_SUCCESSFUL_KEYS_KEY, JSON.stringify(records));
    } catch (e) {
      console.warn('[KeyProvider] Failed to record success:', e);
    }
  }

  /**
   * 获取上次成功使用的密钥 ID
   * @private
   */
  async _getLastSuccessfulKeyId() {
    try {
      const stored = localStorage.getItem(LAST_SUCCESSFUL_KEYS_KEY);
      if (stored) {
        const records = JSON.parse(stored);
        return records[this.modelName] || null;
      }
    } catch (e) {
      // 忽略解析错误
    }
    return null;
  }

  /**
   * 检查是否有可用密钥
   * @returns {boolean}
   */
  hasAvailableKeys() {
    return this.availableKeys.length > 0;
  }

  /**
   * 获取可用密钥数量
   * @returns {number}
   */
  getAvailableCount() {
    return this.availableKeys.length;
  }

  /**
   * 重新加载密钥
   */
  async reload() {
    this._initialized = false;
    await this.init();
  }
}

// 浏览器全局兼容
if (typeof window !== 'undefined') {
  window.KeyProvider = KeyProvider;
}

// 默认导出
export default KeyProvider;
