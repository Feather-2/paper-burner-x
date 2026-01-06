/**
 * @file js/storage/repositories/base-repository.js
 * @description
 * Repository 基类：封装存储 adapter（key-value 接口）。
 *
 * 约定：
 * - adapter 需实现：get/set/remove/keys/clear，且均返回 Promise。
 * - 子类仅关注业务 key 与数据结构，不直接依赖具体存储实现。
 */

import BaseStorageAdapter from "../adapters/base-adapter.js";

function assertAdapter(adapter) {
  if (!adapter) {
    throw new Error("BaseRepository: adapter is required");
  }

  // 允许 duck-typing（便于测试注入），也兼容 BaseStorageAdapter 实例。
  if (adapter instanceof BaseStorageAdapter) return;

  const required = ["get", "set", "remove", "keys", "clear"];
  for (const method of required) {
    if (typeof adapter?.[method] !== "function") {
      throw new Error(`BaseRepository: adapter.${method}() is required`);
    }
  }
}

export class BaseRepository {
  /**
   * @param {BaseStorageAdapter} adapter
   */
  constructor(adapter) {
    assertAdapter(adapter);
    this.adapter = adapter;
  }
}

export default BaseRepository;

