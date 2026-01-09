/**
 * @file js/storage/adapters/local-storage-adapter.js
 * @description
 * localStorage 适配器实现：支持 key 前缀命名空间。
 */

import BaseStorageAdapter from "./base-adapter.js";

export class LocalStorageAdapter extends BaseStorageAdapter {
  /**
   * @param {Object} [options]
   * @param {string} [options.prefix] - key 前缀（命名空间），例如 "pbx:"。
   * @param {Storage} [options.storage] - 注入 Storage 实例，默认使用 globalThis.localStorage。
   */
  constructor({ prefix = "", storage = globalThis?.localStorage } = {}) {
    super();
    this.prefix = String(prefix || "");
    this.storage = storage;

    if (!this.storage) {
      throw new Error("LocalStorageAdapter: localStorage is not available");
    }
  }

  _fullKey(key) {
    return `${this.prefix}${String(key)}`;
  }

  async get(key) {
    const raw = this.storage.getItem(this._fullKey(key));
    if (raw === null) return null;

    try {
      return JSON.parse(raw);
    } catch {
      // 兼容历史：如果不是 JSON，则直接返回字符串
      return raw;
    }
  }

  async set(key, value) {
    if (typeof value === "undefined") {
      await this.remove(key);
      return;
    }

    this.storage.setItem(this._fullKey(key), JSON.stringify(value));
  }

  async remove(key) {
    this.storage.removeItem(this._fullKey(key));
  }

  async keys() {
    const out = [];
    const prefix = this.prefix;

    for (let i = 0; i < this.storage.length; i++) {
      const k = this.storage.key(i);
      if (k === null) continue;

      if (!prefix || k.startsWith(prefix)) {
        out.push(prefix ? k.slice(prefix.length) : k);
      }
    }

    return out;
  }

  async clear() {
    if (!this.prefix) {
      this.storage.clear();
      return;
    }

    const ks = await this.keys();
    for (const k of ks) {
      this.storage.removeItem(this._fullKey(k));
    }
  }
}

export default LocalStorageAdapter;
