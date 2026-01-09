/**
 * @file js/storage/repositories/api-keys-repository.js
 * @description
 * API 密钥仓库（多模型 key 存取与兼容迁移）。
 *
 * 参考实现：js/storage/storage.js:958-1073 的 loadModelKeys/saveModelKeys
 * 默认值需与 storage.js 保持一致。
 */

import BaseRepository from "./base-repository.js";
import LocalStorageAdapter from "../adapters/local-storage-adapter.js";

const MODEL_KEYS_KEY = "translationModelKeys";

function generateUUID() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function normalizeKeysArray(keysArray) {
  // keysArray: 可能为 string[] 或 object[]
  if (!Array.isArray(keysArray)) return [];
  if (keysArray.length === 0) return [];

  const first = keysArray[0];
  if (typeof first === "object" && first !== null && "value" in first) {
    return keysArray;
  }

  if (typeof first === "string") {
    return keysArray.map((keyString, index) => ({
      id: generateUUID(),
      value: keyString,
      remark: "",
      status: "untested",
      order: index,
    }));
  }

  return [];
}

export class ApiKeysRepository extends BaseRepository {
  /**
   * @param {import("../adapters/base-adapter.js").BaseStorageAdapter} [adapter]
   */
  constructor(adapter = new LocalStorageAdapter()) {
    super(adapter);
  }

  /**
   * 保存某个模型的 key 列表（对象数组）
   * @param {string} model
   * @param {Array<Object>} keysArray
   * @returns {Promise<void>}
   */
  async saveModelKeys(model, keysArray) {
    let allModelKeyStores = {};
    try {
      const stored = await this.adapter.get(MODEL_KEYS_KEY);
      if (stored && typeof stored === "object") allModelKeyStores = stored;
    } catch (e) {
      console.error("ApiKeysRepository.saveModelKeys: error reading existing keys:", e);
    }

    if (!Array.isArray(keysArray)) {
      console.error(`ApiKeysRepository.saveModelKeys: attempted to save non-array for model "${model}".`);
      return;
    }

    allModelKeyStores[model] = keysArray;

    try {
      await this.adapter.set(MODEL_KEYS_KEY, allModelKeyStores);
    } catch (e) {
      console.error("ApiKeysRepository.saveModelKeys: failed to persist keys:", e);
    }
  }

  /**
   * 加载某个模型的 key 列表（返回对象数组，带兼容迁移）
   * @param {string} model
   * @returns {Promise<Array<Object>>}
   */
  async loadModelKeys(model) {
    let modelKeyStore = [];

    // 1) 读取当前统一存储（translationModelKeys）
    try {
      const allModelKeyStores = await this.adapter.get(MODEL_KEYS_KEY);
      if (allModelKeyStores && typeof allModelKeyStores === "object" && Array.isArray(allModelKeyStores[model])) {
        const loadedKeys = allModelKeyStores[model];

        if (loadedKeys.length > 0 && typeof loadedKeys[0] === "object" && loadedKeys[0] !== null && "value" in loadedKeys[0]) {
          modelKeyStore = loadedKeys.sort((a, b) => (a.order || 0) - (b.order || 0));
          return modelKeyStore;
        }

        if (loadedKeys.length > 0 && typeof loadedKeys[0] === "string") {
          console.log(`Migrating keys for model ${model} to new format.`);
          modelKeyStore = normalizeKeysArray(loadedKeys);
          await this.saveModelKeys(model, modelKeyStore);
          return modelKeyStore.sort((a, b) => (a.order || 0) - (b.order || 0));
        }

        if (loadedKeys.length === 0) return [];
      }
    } catch (e) {
      console.error(`ApiKeysRepository.loadModelKeys: error loading/migrating keys for model "${model}":`, e);
    }

    // 2) 兼容迁移：将旧命名的通义/火山 Key 合并到新命名下
    try {
      const allModelKeyStores = await this.adapter.get(MODEL_KEYS_KEY);
      if (allModelKeyStores && typeof allModelKeyStores === "object") {
        if (model === "tongyi") {
          const old1 = Array.isArray(allModelKeyStores["tongyi-deepseek-v3"]) ? allModelKeyStores["tongyi-deepseek-v3"] : [];
          const old2 = Array.isArray(allModelKeyStores["tongyi-qwen-turbo"]) ? allModelKeyStores["tongyi-qwen-turbo"] : [];
          const merged = [...old1, ...old2];
          if (merged.length > 0) {
            const normalized = merged.map((k, idx) =>
              typeof k === "string" ? { id: generateUUID(), value: k, remark: "", status: "untested", order: idx } : k,
            );
            await this.saveModelKeys("tongyi", normalized);
            return normalized.sort((a, b) => (a.order || 0) - (b.order || 0));
          }
        }

        if (model === "volcano") {
          const old1 = Array.isArray(allModelKeyStores["volcano-deepseek-v3"]) ? allModelKeyStores["volcano-deepseek-v3"] : [];
          const old2 = Array.isArray(allModelKeyStores["volcano-doubao"]) ? allModelKeyStores["volcano-doubao"] : [];
          const merged = [...old1, ...old2];
          if (merged.length > 0) {
            const normalized = merged.map((k, idx) =>
              typeof k === "string" ? { id: generateUUID(), value: k, remark: "", status: "untested", order: idx } : k,
            );
            await this.saveModelKeys("volcano", normalized);
            return normalized.sort((a, b) => (a.order || 0) - (b.order || 0));
          }
        }
      }
    } catch {
      // ignore
    }

    // 3) 进一步兼容非常旧的、独立的 localStorage key (mistralApiKeys, translationApiKeys)
    let legacyKeysArray = [];
    try {
      if (model === "mistral") {
        const mistralKeysText = await this.adapter.get("mistralApiKeys");
        if (typeof mistralKeysText === "string" && mistralKeysText) {
          legacyKeysArray = mistralKeysText.split("\n").map((k) => k.trim()).filter(Boolean);
        }
      } else if (model !== "custom" && model !== "mistral") {
        const translationKeysText = await this.adapter.get("translationApiKeys");
        if (typeof translationKeysText === "string" && translationKeysText) {
          legacyKeysArray = translationKeysText.split("\n").map((k) => k.trim()).filter(Boolean);
        }
      }
    } catch {
      legacyKeysArray = [];
    }

    if (legacyKeysArray.length > 0) {
      console.log(`Migrating legacy keys for model ${model} from separate localStorage items.`);
      modelKeyStore = legacyKeysArray.map((keyString, index) => ({
        id: generateUUID(),
        value: keyString,
        remark: "",
        status: "untested",
        order: index,
      }));
      await this.saveModelKeys(model, modelKeyStore);
      return modelKeyStore.sort((a, b) => (a.order || 0) - (b.order || 0));
    }

    return [];
  }
}

export default ApiKeysRepository;

