/**
 * @file js/storage/adapters/memory-adapter.js
 * @description
 * 内存适配器：用于测试或临时存储，基于 Map 实现。
 */

import BaseStorageAdapter from "./base-adapter.js";

export class MemoryAdapter extends BaseStorageAdapter {
  /**
   * @param {Object} [options]
   * @param {Map<any, any>|Array<[any, any]>|Object} [options.initial] - 可选的初始化数据。
   */
  constructor({ initial } = {}) {
    super();
    this.map = new Map();

    if (initial instanceof Map) {
      for (const [k, v] of initial.entries()) this.map.set(k, v);
    } else if (Array.isArray(initial)) {
      for (const [k, v] of initial) this.map.set(k, v);
    } else if (initial && typeof initial === "object") {
      for (const [k, v] of Object.entries(initial)) this.map.set(k, v);
    }
  }

  async get(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }

  async set(key, value) {
    if (typeof value === "undefined") {
      await this.remove(key);
      return;
    }
    this.map.set(key, value);
  }

  async remove(key) {
    this.map.delete(key);
  }

  async keys() {
    return Array.from(this.map.keys());
  }

  async clear() {
    this.map.clear();
  }
}

export default MemoryAdapter;
