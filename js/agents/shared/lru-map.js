/**
 * 简单 LRU Map，超过容量自动驱逐最老条目
 */
export class LRUMap extends Map {
  constructor(maxSize = 5000) {
    super();
    this.maxSize = maxSize;
  }

  set(key, value) {
    if (this.has(key)) this.delete(key); // 移到末尾
    super.set(key, value);
    if (this.size > this.maxSize) {
      const firstKey = this.keys().next().value;
      this.delete(firstKey);
    }
    return this;
  }

  get(key) {
    if (!this.has(key)) return undefined;
    const value = super.get(key);
    this.delete(key);
    super.set(key, value); // 移到末尾
    return value;
  }
}
