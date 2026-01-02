/**
 * LRU Cache - 通用最近最少使用缓存
 *
 * 用于缓解检索层 I/O 饥饿问题。
 * 特点：
 * - O(1) get/set 操作
 * - 可配置最大条目数和 TTL
 * - 支持统计（命中率、驱逐次数）
 */

/**
 * @template K, V
 */
export class LRUCache {
  /**
   * @param {object} options
   * @param {number} [options.maxSize=100] - 最大缓存条目数
   * @param {number} [options.ttlMs=0] - 条目过期时间（毫秒），0 表示不过期
   * @param {(key: K, value: V) => void} [options.onEvict] - 驱逐回调
   */
  constructor({ maxSize = 100, ttlMs = 0, onEvict } = {}) {
    this._maxSize = Math.max(1, Math.floor(maxSize) || 100);
    this._ttlMs = Math.max(0, Math.floor(ttlMs) || 0);
    this._onEvict = typeof onEvict === "function" ? onEvict : null;

    /** @type {Map<K, {value: V, ts: number}>} */
    this._cache = new Map();

    // 统计
    this._stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      sets: 0,
    };
  }

  /**
   * 获取缓存值
   * @param {K} key
   * @returns {V|undefined}
   */
  get(key) {
    const entry = this._cache.get(key);

    if (!entry) {
      this._stats.misses++;
      return undefined;
    }

    // TTL 检查
    if (this._ttlMs > 0 && Date.now() - entry.ts > this._ttlMs) {
      this._cache.delete(key);
      this._stats.misses++;
      return undefined;
    }

    // LRU：移动到末尾（最近访问）
    this._cache.delete(key);
    this._cache.set(key, entry);

    this._stats.hits++;
    return entry.value;
  }

  /**
   * 设置缓存值
   * @param {K} key
   * @param {V} value
   * @returns {this}
   */
  set(key, value) {
    // 如果已存在，先删除（更新位置）
    if (this._cache.has(key)) {
      this._cache.delete(key);
    }

    // 驱逐最旧条目
    while (this._cache.size >= this._maxSize) {
      const oldestKey = this._cache.keys().next().value;
      const oldestEntry = this._cache.get(oldestKey);
      this._cache.delete(oldestKey);
      this._stats.evictions++;
      if (this._onEvict && oldestEntry) {
        try {
          this._onEvict(oldestKey, oldestEntry.value);
        } catch {
          // 忽略回调错误
        }
      }
    }

    this._cache.set(key, { value, ts: Date.now() });
    this._stats.sets++;
    return this;
  }

  /**
   * 检查是否存在（不更新 LRU 顺序）
   * @param {K} key
   * @returns {boolean}
   */
  has(key) {
    const entry = this._cache.get(key);
    if (!entry) return false;
    if (this._ttlMs > 0 && Date.now() - entry.ts > this._ttlMs) {
      this._cache.delete(key);
      return false;
    }
    return true;
  }

  /**
   * 删除缓存条目
   * @param {K} key
   * @returns {boolean}
   */
  delete(key) {
    return this._cache.delete(key);
  }

  /**
   * 清空缓存
   */
  clear() {
    this._cache.clear();
  }

  /**
   * 获取当前大小
   * @returns {number}
   */
  get size() {
    return this._cache.size;
  }

  /**
   * 获取统计信息
   * @returns {{hits: number, misses: number, evictions: number, sets: number, hitRate: number}}
   */
  getStats() {
    const total = this._stats.hits + this._stats.misses;
    return {
      ...this._stats,
      hitRate: total > 0 ? this._stats.hits / total : 0,
      size: this._cache.size,
      maxSize: this._maxSize,
    };
  }

  /**
   * 重置统计
   */
  resetStats() {
    this._stats.hits = 0;
    this._stats.misses = 0;
    this._stats.evictions = 0;
    this._stats.sets = 0;
  }

  /**
   * 清理过期条目（手动触发）
   * @returns {number} 清理的条目数
   */
  prune() {
    if (this._ttlMs <= 0) return 0;

    const now = Date.now();
    let pruned = 0;

    for (const [key, entry] of this._cache.entries()) {
      if (now - entry.ts > this._ttlMs) {
        this._cache.delete(key);
        pruned++;
      }
    }

    return pruned;
  }

  /**
   * 获取所有键（按 LRU 顺序，最旧在前）
   * @returns {K[]}
   */
  keys() {
    return Array.from(this._cache.keys());
  }

  /**
   * 获取所有值（按 LRU 顺序，最旧在前）
   * @returns {V[]}
   */
  values() {
    return Array.from(this._cache.values()).map((e) => e.value);
  }

  /**
   * 批量获取
   * @param {K[]} keys
   * @returns {Map<K, V>}
   */
  getMany(keys) {
    const result = new Map();
    for (const key of keys) {
      const value = this.get(key);
      if (value !== undefined) {
        result.set(key, value);
      }
    }
    return result;
  }

  /**
   * 批量设置
   * @param {Iterable<[K, V]>} entries
   * @returns {this}
   */
  setMany(entries) {
    for (const [key, value] of entries) {
      this.set(key, value);
    }
    return this;
  }
}

/**
 * 创建带自动清理的 LRU Cache
 * @param {object} options
 * @param {number} [options.maxSize=100]
 * @param {number} [options.ttlMs=60000]
 * @param {number} [options.pruneIntervalMs=30000]
 * @returns {{cache: LRUCache, stop: () => void}}
 */
export function createAutoPruningCache({ maxSize = 100, ttlMs = 60000, pruneIntervalMs = 30000, onEvict } = {}) {
  const cache = new LRUCache({ maxSize, ttlMs, onEvict });

  const intervalId = setInterval(() => {
    cache.prune();
  }, pruneIntervalMs);

  return {
    cache,
    stop: () => clearInterval(intervalId),
  };
}

export default LRUCache;
