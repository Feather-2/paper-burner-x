// key-provider.js - API Key 管理和轮询

/**
 * @const {string} LAST_SUCCESSFUL_KEYS_LS_KEY
 * @description 用于在 localStorage 中存储各模型最后一次成功使用的 API Key ID 的键名。
 */
export const LAST_SUCCESSFUL_KEYS_LS_KEY = 'paperBurnerLastSuccessfulKeys';

/**
 * @class KeyProvider
 * @description 负责加载、筛选、排序和轮询特定模型的API Keys。
 * 它从 localStorage 读取保存的密钥，管理其状态（如'valid', 'untested', 'invalid'），
 * 并在处理过程中提供下一个可用的密钥。
 */
export class KeyProvider {
    /**
     * KeyProvider 构造函数。
     * @param {string} modelName - 需要管理 API Keys 的模型名称 (例如 'mistral', 'gemini', 或自定义源站点 'custom_source_xxx')。
     */
    constructor(modelName) {
        /** @type {string} */
        this.modelName = modelName;
        /**
         * @type {Array<Object>}
         * @description 存储从localStorage加载的原始key对象数组。
         * 每个对象结构: {id: string, value: string, remark: string, status: string, order: number}
         */
        this.keys = [];
        /**
         * @type {Array<Object>}
         * @description 存储经过筛选和排序的、当前轮次可用的key对象数组 (status为 'valid' 或 'untested')。
         */
        this.availableKeys = [];
        /**
         * @type {number}
         * @description 当前轮询可用密钥列表的索引。
         */
        this.currentIndex = 0;
        this.loadAndPrepareKeys();
    }

    /**
     * 加载并准备指定模型的API Keys。
     * 它会调用 `loadModelKeys` 从 localStorage 获取密钥，
     * 然后筛选出状态为 'valid' 或 'untested' 的密钥，并按 `order` 排序。
     */
    loadAndPrepareKeys() {
        this.keys = typeof loadModelKeys === 'function' ? loadModelKeys(this.modelName) : [];
        // 筛选出 'valid' 或 'untested' 的 keys，并按 order 排序 (loadModelKeys 内部已排序)
        this.availableKeys = this.keys.filter(key => key.status === 'valid' || key.status === 'untested');
        this.currentIndex = 0;
        if (this.availableKeys.length === 0) {
            console.warn(`KeyProvider: No 'valid' or 'untested' keys found for model ${this.modelName}`);
        }
    }

    /**
     * 获取下一个可用的API Key对象。
     * 实现轮询机制，循环使用 `availableKeys` 列表中的密钥。
     * @returns {Object|null} 返回一个密钥对象 {id, value, status, remark, order}，如果没有可用密钥则返回 null。
     */
    getNextKey() {
        if (this.availableKeys.length === 0) {
            return null; // 没有可用的key
        }
        const keyObject = this.availableKeys[this.currentIndex];
        this.currentIndex = (this.currentIndex + 1) % this.availableKeys.length;
        return keyObject; // 返回整个key对象，包含 {id, value, status, remark, order}
    }

    /**
     * 将指定的API Key标记为无效。
     * 这会更新该密钥在 `this.keys` 中的状态，并将其从 `this.availableKeys` 中移除。
     * 同时，会尝试异步保存更新后的密钥列表到 localStorage，并刷新Key管理界面的UI（如果存在）。
     * @param {string} keyId - 要标记为无效的密钥的ID。
     * @async
     */
    async markKeyAsInvalid(keyId) {
        const keyIndexInAll = this.keys.findIndex(k => k.id === keyId);
        if (keyIndexInAll !== -1) {
            this.keys[keyIndexInAll].status = 'invalid';
            if (typeof saveModelKeys === 'function') {
                await saveModelKeys(this.modelName, this.keys); // 异步保存
            }
        }
        // 从当前可用列表中移除，并重置索引以确保正确轮询剩余的key
        this.availableKeys = this.availableKeys.filter(k => k.id !== keyId);
        this.currentIndex = this.availableKeys.length > 0 ? this.currentIndex % this.availableKeys.length : 0;

        // 如果Key管理弹窗正好显示这个模型, 更新其UI
        if (typeof window.refreshKeyManagerForModel === 'function') {
            window.refreshKeyManagerForModel(this.modelName, keyId, 'invalid');
        }
    }

    /**
     * 检查是否有可用的 API Keys。
     * @returns {boolean} 如果 `availableKeys` 列表不为空，则返回 true，否则返回 false。
     */
    hasAvailableKeys() {
        return this.availableKeys.length > 0;
    }
}

/**
 * 更新本地存储中指定模型最后成功使用的Key ID。
 * @param {string} modelName - 模型名称 (例如 'mistral', 'gemini', 或 'custom_source_xxx')。
 * @param {string} keyId - 成功使用的 API Key 的 ID。
 */
export function recordLastSuccessfulKey(modelName, keyId) {
    if (!modelName || !keyId) return;
    try {
        let records = JSON.parse(localStorage.getItem(LAST_SUCCESSFUL_KEYS_LS_KEY) || '{}');
        records[modelName] = keyId;
        localStorage.setItem(LAST_SUCCESSFUL_KEYS_LS_KEY, JSON.stringify(records));
    } catch (e) {
        console.error('Failed to record last successful key:', e);
    }
}

/**
 * 获取本地存储中指定模型最后成功使用的Key ID。
 * @param {string} modelName - 模型名称。
 * @returns {string | null} 存储的 Key ID，如果未找到则返回 null。
 */
export function getLastSuccessfulKeyId(modelName) {
    if (!modelName) return null;
    try {
        const records = JSON.parse(localStorage.getItem(LAST_SUCCESSFUL_KEYS_LS_KEY) || '{}');
        return records[modelName] || null;
    } catch (e) {
        console.error('Failed to get last successful key ID:', e);
        return null;
    }
}
