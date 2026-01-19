import { toNonEmptyString } from "../../shared/utils/value-utils.js";

/**
 * 内存存储适配器
 * @implements {import("./storage-adapter.js").StorageAdapter}
 */
export class MapAdapter {
  /** @type {Map<string, any>} */
  store;

  constructor() {
    this.store = new Map();
  }

  /**
   * 获取存储值
   * @param {string} key - 键
   * @returns {Promise<any|null>} 值或 null
   */
  async get(key) {
    const k = String(key);
    if (!this.store.has(k)) return null;
    return this.store.get(k);
  }

  /**
   * 设置存储值
   * @param {string} key - 键
   * @param {any} value - 值
   * @returns {Promise<boolean>} 成功返回 true
   */
  async set(key, value) {
    const k = String(key);
    this.store.set(k, value);
    return true;
  }

  /**
   * 删除存储值
   * @param {string} key - 键
   * @returns {Promise<boolean>} 是否删除成功
   */
  async delete(key) {
    const k = String(key);
    return this.store.delete(k);
  }

  /**
   * 按模式列出键
   * @param {string} [pattern="*"] - glob 模式 (仅支持 *)
   * @returns {Promise<string[]>} 匹配的键列表
   */
  async keys(pattern) {
    const p = toNonEmptyString(pattern) ?? "*";
    const escaped = p.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`^${escaped.replace(/\*/g, ".*")}$`);
    const matches = Array.from(this.store.keys()).filter((key) => regex.test(key));
    matches.sort();
    return matches;
  }
}
