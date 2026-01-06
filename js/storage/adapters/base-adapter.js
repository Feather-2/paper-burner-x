/**
 * @file js/storage/adapters/base-adapter.js
 * @description
 * 存储适配器抽象基类：提供统一的 key-value 存储接口。
 *
 * 约定：
 * - 所有方法均返回 Promise（即使底层是同步存储），方便上层统一以 async/await 使用。
 * - 缺省实现会抛出错误，子类必须覆盖实现。
 */

export class BaseStorageAdapter {
  async get(_key) {
    throw new Error("BaseStorageAdapter.get() not implemented");
  }

  async set(_key, _value) {
    throw new Error("BaseStorageAdapter.set() not implemented");
  }

  async remove(_key) {
    throw new Error("BaseStorageAdapter.remove() not implemented");
  }

  async keys() {
    throw new Error("BaseStorageAdapter.keys() not implemented");
  }

  async clear() {
    throw new Error("BaseStorageAdapter.clear() not implemented");
  }
}

export default BaseStorageAdapter;
